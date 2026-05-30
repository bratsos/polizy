import { type ExplainNode, everyone } from "polizy";
import {
  type ActionFunctionArgs,
  data,
  type LoaderFunctionArgs,
  redirect,
  useActionData,
  useLoaderData,
  useSearchParams,
} from "react-router";
import Inspector from "../components/Inspector";
import TopBar from "../components/TopBar";
import Workspace from "../components/Workspace";
import {
  ensureSchedulerStarted,
  getIntervalMinutes,
  getNextResetAt,
  maybeReset,
} from "../lib/db-reset.server";
import { authz, type docSchema, prisma } from "../lib/polizy.server";

export type ObjType = "document" | "folder" | "team";
export type Action = keyof typeof docSchema.actionToRelations;

const ACTIONS: Action[] = ["view", "edit", "delete", "share", "manage_members"];
const USERS = ["alice", "bob", "charlie", "david"];
const FIELD_SEP = "#";

export type Entity = {
  key: string;
  type: ObjType;
  id: string;
  name: string;
  parentKey?: string;
  actions: Action[];
  accessible: boolean;
};

export type TupleRow = {
  id: string;
  subjectType: string;
  subjectId: string;
  relation: string;
  objectType: string;
  objectId: string;
  condition: string | null;
};

export type Opened = {
  key: string;
  type: ObjType;
  id: string;
  name: string;
  actions: Action[];
  canView: boolean;
  content?: string | null;
  children?: Array<{ key: string; type: ObjType; id: string; name: string }>;
  members?: Array<{ id: string; name: string }>;
};

export type Inspect = {
  action: Action;
  target: { type: ObjType; id: string; name: string };
  allowed: boolean;
  via: ExplainNode | null;
  matrix: Array<{ user: string; actions: Record<string, boolean> }>;
  whoCanView: string[];
  whoCanEdit: string[];
  tuples: TupleRow[];
};

export type HomeLoaderData = {
  persona: string;
  users: Array<{ id: string; name: string }>;
  region: string | null;
  entities: Entity[];
  opened: Opened | null;
  inspect: Inspect | null;
  allTuples: TupleRow[];
  nextResetAt: number;
  intervalMinutes: number;
};

const parseKey = (key: string): { type: ObjType; id: string } => {
  const idx = key.indexOf(":");
  return { type: key.slice(0, idx) as ObjType, id: key.slice(idx + 1) };
};
const keyOf = (type: string, id: string) => `${type}:${id}`;
const baseId = (id: string) => id.split(FIELD_SEP)[0] ?? id;

// --- action helpers ---
const slug = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
const str = (fd: FormData, k: string) => (fd.get(k) ?? "").toString().trim();
const ok = (message: string) => data({ ok: true, message });
const fail = (error: string, status = 400) =>
  data({ ok: false, error }, { status });
const parseTarget = (key: string): { type: ObjType; id: string } => {
  const idx = key.indexOf(":");
  const type = key.slice(0, idx);
  const id = key.slice(idx + 1);
  if (idx <= 0 || !id || !["document", "folder", "team"].includes(type))
    throw new Error(`Invalid resource key: "${key}".`);
  return { type: type as ObjType, id };
};

const toRow = (t: {
  id: string;
  subjectType: string;
  subjectId: string;
  relation: string;
  objectType: string;
  objectId: string;
  condition: unknown;
}): TupleRow => ({
  id: t.id,
  subjectType: t.subjectType,
  subjectId: t.subjectId,
  relation: t.relation,
  objectType: t.objectType,
  objectId: t.objectId,
  condition: t.condition ? JSON.stringify(t.condition) : null,
});

export async function loader({ request }: LoaderFunctionArgs) {
  ensureSchedulerStarted();
  await maybeReset();

  const url = new URL(request.url);
  const persona = USERS.includes(url.searchParams.get("as") ?? "")
    ? (url.searchParams.get("as") as string)
    : "alice";
  const region = url.searchParams.get("region");
  const context = region ? { region } : undefined;
  const openKey = url.searchParams.get("open");
  const inspectKey = url.searchParams.get("inspect");
  const inspectAction = (url.searchParams.get("action") as Action) ?? "view";

  const who = { type: "user" as const, id: persona };

  // Accessible objects (with allowed actions) for the current persona.
  const accessMap = new Map<string, { actions: Action[]; parent?: string }>();
  for (const ofType of ["folder", "document", "team"] as ObjType[]) {
    const res = await authz.listAccessibleObjects({ who, ofType, context });
    for (const a of res.accessible) {
      accessMap.set(keyOf(a.object.type, a.object.id), {
        actions: a.actions as Action[],
        parent: a.parent ? keyOf(a.parent.type, a.parent.id) : undefined,
      });
    }
  }

  // Every entity in the world (so we can show locked ones too).
  const [docs, folders, teams, allTupleRows] = await Promise.all([
    prisma.document.findMany({ select: { id: true, title: true } }),
    prisma.folder.findMany({ select: { id: true, name: true } }),
    prisma.team.findMany({ select: { id: true, name: true } }),
    prisma.polizyTuple.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  const parentOf = new Map<string, string>();
  for (const t of allTupleRows) {
    if (t.relation === "parent") {
      parentOf.set(
        keyOf(t.subjectType, t.subjectId),
        keyOf(t.objectType, t.objectId),
      );
    }
  }

  const mkEntity = (type: ObjType, id: string, name: string): Entity => {
    const key = keyOf(type, id);
    const acc = accessMap.get(key);
    return {
      key,
      type,
      id,
      name,
      parentKey: acc?.parent ?? parentOf.get(key),
      actions: acc?.actions ?? [],
      accessible: !!acc,
    };
  };

  const entities: Entity[] = [
    ...folders.map((f) => mkEntity("folder", f.id, f.name)),
    ...docs.map((d) => mkEntity("document", d.id, d.title)),
    ...teams.map((t) => mkEntity("team", t.id, t.name)),
  ];

  // Opened resource detail.
  let opened: Opened | null = null;
  if (openKey) {
    const { type, id } = parseKey(openKey);
    const ent = entities.find((e) => e.key === openKey);
    if (ent) {
      const canView = await authz.check({
        who,
        canThey: "view",
        onWhat: { type, id },
        context,
      });
      const base: Opened = {
        key: openKey,
        type,
        id,
        name: ent.name,
        actions: ent.actions,
        canView,
      };
      if (type === "document") {
        const row = canView
          ? await prisma.document.findUnique({ where: { id } })
          : null;
        base.content = row?.content ?? null;
      } else if (type === "folder") {
        base.children = entities
          .filter((e) => e.parentKey === openKey)
          .map((e) => ({ key: e.key, type: e.type, id: e.id, name: e.name }));
      } else if (type === "team") {
        const memberTuples = allTupleRows.filter(
          (t) =>
            t.relation === "member" &&
            t.objectType === "team" &&
            t.objectId === id,
        );
        const names = new Map(
          (await prisma.user.findMany()).map((u) => [u.id, u.name] as const),
        );
        base.members = memberTuples.map((t) => ({
          id: t.subjectId,
          name: names.get(t.subjectId) ?? t.subjectId,
        }));
      }
      opened = base;
    }
  }

  // Inspector: explain + matrix + who-can-access + relevant tuples.
  let inspect: Inspect | null = null;
  if (inspectKey) {
    const { type, id } = parseKey(inspectKey);
    const ent = entities.find((e) => e.key === inspectKey);
    const name = ent?.name ?? id;
    const target = { type, id };

    const explained = await authz.explain({
      who,
      canThey: inspectAction,
      onWhat: target,
      context,
    });

    const matrix = await Promise.all(
      USERS.map(async (u) => {
        const results = await authz.checkMany(
          ACTIONS.map((a) => ({
            who: { type: "user" as const, id: u },
            canThey: a,
            onWhat: target,
            context,
          })),
        );
        const actions: Record<string, boolean> = {};
        ACTIONS.forEach((a, i) => {
          actions[a] = results[i] ?? false;
        });
        return { user: u, actions };
      }),
    );

    const [whoCanView, whoCanEdit] = await Promise.all([
      authz.listSubjects({
        onWhat: target,
        canThey: "view",
        ofType: "user",
        context,
      }),
      authz.listSubjects({
        onWhat: target,
        canThey: "edit",
        ofType: "user",
        context,
      }),
    ]);

    // Surface tuples on the object, its field-base, and its hierarchy ancestors,
    // so e.g. a team→folder grant shows when inspecting a document inside it.
    const base = baseId(id);
    const relevantObjects = new Set<string>([
      keyOf(type, id),
      keyOf(type, base),
    ]);
    let ancestor =
      parentOf.get(keyOf(type, base)) ?? parentOf.get(keyOf(type, id));
    while (ancestor) {
      relevantObjects.add(ancestor);
      ancestor = parentOf.get(ancestor);
    }
    const tuples = allTupleRows
      .filter(
        (t) =>
          relevantObjects.has(keyOf(t.objectType, t.objectId)) ||
          (t.subjectType === type && t.subjectId === base),
      )
      .map(toRow);

    inspect = {
      action: inspectAction,
      target: { type, id, name },
      allowed: explained.allowed,
      via: explained.via,
      matrix,
      whoCanView: whoCanView.map((s) => s.id),
      whoCanEdit: whoCanEdit.map((s) => s.id),
      tuples,
    };
  }

  const users = (
    await prisma.user.findMany({ select: { id: true, name: true } })
  ).sort((a, b) => a.id.localeCompare(b.id));

  return data<HomeLoaderData>({
    persona,
    users,
    region,
    entities,
    opened,
    inspect,
    allTuples: allTupleRows.map(toRow),
    nextResetAt: getNextResetAt(),
    intervalMinutes: getIntervalMinutes(),
  });
}

// Inlined (rather than imported from a `.server` module) because React Router's
// route analysis only registers an `action` declared in the route module
// itself — an imported binding yields 405s on POST.
export async function action({ request }: ActionFunctionArgs) {
  const fd = await request.formData();
  const intent = str(fd, "intent");
  const actingUserId = str(fd, "actingUserId");
  if (!actingUserId) return fail("Missing acting user.");
  const me = { type: "user" as const, id: actingUserId };
  const can = (canThey: Action, onWhat: { type: ObjType; id: string }) =>
    authz.check({ who: me, canThey, onWhat });

  try {
    switch (intent) {
      case "createDocument":
      case "createFolder":
      case "createTeam": {
        const name = str(fd, "name") || str(fd, "title");
        if (!name) return fail("A name is required.");
        const id = slug(name);
        if (!id) return fail("Name produced an empty id.");
        if (intent === "createDocument") {
          await prisma.document.create({
            data: { id, title: name, content: `# ${name}\n\n` },
          });
          await authz.allow({
            who: me,
            toBe: "owner",
            onWhat: { type: "document", id },
          });
        } else if (intent === "createFolder") {
          await prisma.folder.create({ data: { id, name } });
          await authz.allow({
            who: me,
            toBe: "owner",
            onWhat: { type: "folder", id },
          });
        } else {
          await prisma.team.create({ data: { id, name } });
          await authz.allow({
            who: me,
            toBe: "owner",
            onWhat: { type: "team", id },
          });
        }
        return ok(
          `Created ${intent.replace("create", "").toLowerCase()} "${name}". You are its owner.`,
        );
      }

      case "share": {
        const target = parseTarget(str(fd, "resourceKey"));
        const targetUserId = str(fd, "targetUserId");
        const relation = str(fd, "relation") || "viewer";
        if (!targetUserId) return fail("Pick someone to share with.");
        if (
          relation !== "viewer" &&
          relation !== "editor" &&
          relation !== "owner"
        )
          return fail("Role must be viewer, editor, or owner.");
        if (!(await can("share", target)))
          return fail(`${actingUserId} can't share this.`, 403);
        // Conferring ownership is a transfer — only an owner may do it, not
        // anyone who merely has `share` (an editor has `share`, not `owner`).
        if (relation === "owner" && !(await can("delete", target)))
          return fail("Only an owner can grant ownership.", 403);
        await authz.allow({
          who: { type: "user", id: targetUserId },
          toBe: relation,
          onWhat: target,
        });
        return ok(`Shared ${target.id} with ${targetUserId} as ${relation}.`);
      }

      case "sharePublic": {
        const target = parseTarget(str(fd, "resourceKey"));
        if (!(await can("share", target)))
          return fail(`${actingUserId} can't share this.`, 403);
        await authz.allow({
          who: everyone("user"),
          toBe: "viewer",
          onWhat: target,
        });
        return ok(`${target.id} is now public — everyone can view it.`);
      }

      case "shareTimed": {
        const target = parseTarget(str(fd, "resourceKey"));
        const targetUserId = str(fd, "targetUserId");
        const days = Math.max(1, Number.parseInt(str(fd, "days") || "7", 10));
        if (!targetUserId) return fail("Pick someone to share with.");
        if (!(await can("share", target)))
          return fail(`${actingUserId} can't share this.`, 403);
        await authz.allow({
          who: { type: "user", id: targetUserId },
          toBe: "viewer",
          onWhat: target,
          when: { validUntil: new Date(Date.now() + days * 86_400_000) },
        });
        return ok(
          `Granted ${targetUserId} ${days}-day access to ${target.id}.`,
        );
      }

      case "shareField": {
        const target = parseTarget(str(fd, "resourceKey"));
        const field = str(fd, "field");
        const targetUserId = str(fd, "targetUserId");
        if (!field || !targetUserId)
          return fail("Field and recipient are required.");
        if (target.type !== "document")
          return fail("Field grants are for documents.");
        if (!(await can("share", target)))
          return fail(`${actingUserId} can't share this.`, 403);
        await authz.allow({
          who: { type: "user", id: targetUserId },
          toBe: "viewer",
          onWhat: { type: "document", id: `${target.id}#${field}` },
        });
        return ok(
          `Granted ${targetUserId} the "${field}" field of ${target.id}.`,
        );
      }

      case "addMember":
      case "removeMember": {
        const team = parseTarget(str(fd, "teamKey"));
        const userId = str(fd, "userId");
        if (team.type !== "team")
          return fail("Members can only be managed on teams.");
        if (!userId) return fail("Pick a user.");
        if (!(await can("manage_members", team)))
          return fail(`${actingUserId} can't manage this team.`, 403);
        const member = { type: "user" as const, id: userId };
        if (intent === "addMember") {
          await authz.addMember({
            member,
            group: { type: "team", id: team.id },
          });
          return ok(`Added ${userId} to ${team.id}.`);
        }
        await authz.removeMember({
          member,
          group: { type: "team", id: team.id },
        });
        return ok(`Removed ${userId} from ${team.id}.`);
      }

      case "setParent": {
        const child = parseTarget(str(fd, "childKey"));
        const parent = parseTarget(str(fd, "parentKey"));
        if (!(await can("edit", child)))
          return fail(`${actingUserId} can't move this.`, 403);
        if (!(await can("edit", parent)))
          return fail(`${actingUserId} can't file into that folder.`, 403);
        await authz.setParent({ child, parent });
        return ok(`Moved ${child.id} into ${parent.id}.`);
      }

      case "saveEdit": {
        const target = parseTarget(str(fd, "resourceKey"));
        const content = (fd.get("content") ?? "").toString();
        if (!(await can("edit", target)))
          return fail(`${actingUserId} can't edit this.`, 403);
        await prisma.document.update({
          where: { id: target.id },
          data: { content },
        });
        return ok(`Saved ${target.id}.`);
      }

      case "delete": {
        const target = parseTarget(str(fd, "resourceKey"));
        if (!(await can("delete", target)))
          return fail(`${actingUserId} can't delete this.`, 403);
        if (target.type === "document")
          await prisma.document.delete({ where: { id: target.id } });
        else if (target.type === "folder")
          await prisma.folder.delete({ where: { id: target.id } });
        else await prisma.team.delete({ where: { id: target.id } });
        await authz.disallowAllMatching({ onWhat: target });
        return redirect(`/?as=${actingUserId}`);
      }

      case "revoke": {
        const onWhat = {
          type: str(fd, "objectType") as ObjType,
          id: str(fd, "objectId"),
        };
        if (!(await can("share", onWhat)))
          return fail(`${actingUserId} can't change sharing here.`, 403);
        const subjectType = str(fd, "subjectType") as "user" | "team";
        const subjectId = str(fd, "subjectId");
        const was = str(fd, "relation");
        // Revoking an ownership grant is owner-level, not merely `share`.
        if (was === "owner" && !(await can("delete", onWhat)))
          return fail("Only an owner can revoke an ownership grant.", 403);
        await authz.disallowAllMatching({
          who: { type: subjectType, id: subjectId },
          was: was as "owner" | "editor" | "viewer" | "member" | "parent",
          onWhat,
        });
        return ok(
          `Revoked ${subjectType}:${subjectId} ${was} on ${onWhat.id}.`,
        );
      }

      default:
        return fail(`Unknown intent "${intent}".`);
    }
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "P2002")
      return fail("That name is already taken — pick another.", 409);
    if (code === "P2025")
      return fail(
        "That item no longer exists (the demo may have just reset).",
        404,
      );
    return fail(error instanceof Error ? error.message : "Action failed.", 500);
  }
}

export default function Home() {
  const ld = useLoaderData<HomeLoaderData>();
  const flash = useActionData() as
    | { ok?: boolean; message?: string; error?: string }
    | undefined;
  const [params] = useSearchParams();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <TopBar
        persona={ld.persona}
        users={ld.users}
        region={ld.region}
        nextResetAt={ld.nextResetAt}
        intervalMinutes={ld.intervalMinutes}
        tupleCount={ld.allTuples.length}
      />
      {flash?.message && (
        <div className="border-b border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-center text-sm text-emerald-300">
          {flash.message}
        </div>
      )}
      {flash?.error && (
        <div className="border-b border-rose-500/30 bg-rose-500/10 px-4 py-2 text-center text-sm text-rose-300">
          {flash.error}
        </div>
      )}
      <div
        className={`mx-auto grid max-w-[1400px] grid-cols-1 gap-0 lg:grid-cols-[300px_1fr] ${
          ld.inspect ? "sm:pr-[440px]" : ""
        }`}
      >
        <Workspace
          persona={ld.persona}
          entities={ld.entities}
          opened={ld.opened}
          openKey={params.get("open")}
        />
      </div>
      {ld.inspect && (
        <Inspector
          persona={ld.persona}
          inspect={ld.inspect}
          region={ld.region}
        />
      )}
    </div>
  );
}
