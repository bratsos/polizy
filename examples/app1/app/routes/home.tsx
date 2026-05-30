import type { ExplainNode } from "polizy";
import {
  type ClientActionFunctionArgs,
  type ClientLoaderFunctionArgs,
  data,
  redirect,
  useActionData,
  useLoaderData,
  useSearchParams,
} from "react-router";
import Inspector from "../components/Inspector";
import TopBar from "../components/TopBar";
import { TooltipProvider } from "../components/ui/tooltip";
import Workspace from "../components/Workspace";
import {
  type DocSchema,
  everyone,
  FIELD_CONTENT,
  getDb,
  resetWorld,
} from "../lib/db.client";

export type ObjType = "document" | "folder" | "team";
export type Action = keyof DocSchema["actionToRelations"];

const ACTIONS: Action[] = ["view", "edit", "delete", "share", "manage_members"];
const USERS = ["alice", "bob", "charlie", "david"];

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

export type DocField = {
  id: string;
  field: string;
  canView: boolean;
  content: string | null;
};

export type Opened = {
  key: string;
  type: ObjType;
  id: string;
  name: string;
  actions: Action[];
  canView: boolean;
  content?: string | null;
  fields?: DocField[];
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
};

// --- tiny form/URL helpers (not polizy abstractions) -----------------------
const keyOf = (type: string, id: string) => `${type}:${id}`;
const baseId = (id: string) => id.split("#")[0] ?? id;
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

type DbTuple = {
  id: string;
  subject_type: string;
  subject_id: string;
  relation: string;
  object_type: string;
  object_id: string;
  condition: unknown;
};

const rowToTuple = (r: DbTuple) =>
  toRow({
    id: r.id,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    relation: r.relation,
    objectType: r.object_type,
    objectId: r.object_id,
    condition: r.condition,
  });

export async function clientLoader({ request }: ClientLoaderFunctionArgs) {
  // The whole authorization story runs right here in the browser: a real
  // Postgres (PGlite) in this visitor's IndexedDB, with the polizy engine on
  // top. Nothing is shared with anyone else.
  const { db, authz: engine } = await getDb();

  const url = new URL(request.url);
  const persona = USERS.includes(url.searchParams.get("as") ?? "")
    ? (url.searchParams.get("as") as string)
    : "alice";
  const region = url.searchParams.get("region");
  // ABAC context: passed to every check() below; the EU-strategy grant requires region="eu".
  const context = region ? { region } : undefined;
  const openKey = url.searchParams.get("open");
  const inspectKey = url.searchParams.get("inspect");
  const inspectAction = (url.searchParams.get("action") as Action) ?? "view";

  const who = { type: "user" as const, id: persona };

  const [usersRes, foldersRes, docsRes, teamsRes, tuplesRes] =
    await Promise.all([
      db.query<{ id: string; name: string }>(
        "SELECT id, name FROM users ORDER BY id",
      ),
      db.query<{ id: string; name: string }>(
        "SELECT id, name FROM folders ORDER BY name",
      ),
      db.query<{ id: string; title: string }>(
        "SELECT id, title FROM documents ORDER BY title",
      ),
      db.query<{ id: string; name: string }>(
        "SELECT id, name FROM teams ORDER BY name",
      ),
      db.query<DbTuple>("SELECT * FROM polizy_tuple ORDER BY created_at, id"),
    ]);

  // Run the whole page's read checks in ONE read scope: every check / checkMany
  // / explain / listSubjects below shares a single reader, and `preload` loads
  // the tuple set once so they all resolve in memory — no per-operation
  // round-trips to PGlite. PGlite stays the source of truth for writes.
  return engine.withReadScope(
    async (authz) => {
      // Hierarchy edges (document -> folder) come straight from the `parent` tuples.
      const parentOf = new Map<string, string>();
      for (const t of tuplesRes.rows) {
        if (t.relation === "parent") {
          parentOf.set(
            keyOf(t.subject_type, t.subject_id),
            keyOf(t.object_type, t.object_id),
          );
        }
      }

      const raw: Array<{ type: ObjType; id: string; name: string }> = [
        ...foldersRes.rows.map((f) => ({
          type: "folder" as const,
          id: f.id,
          name: f.name,
        })),
        ...docsRes.rows.map((d) => ({
          type: "document" as const,
          id: d.id,
          name: d.title,
        })),
        ...teamsRes.rows.map((t) => ({
          type: "team" as const,
          id: t.id,
          name: t.name,
        })),
      ];

      // For each resource, ask polizy which actions this persona can perform.
      // `checkMany` answers all five in one call and correctly expands public
      // (wildcard) grants — which is why we don't use `listAccessibleObjects` here.
      const entities: Entity[] = await Promise.all(
        raw.map(async (e): Promise<Entity> => {
          const target = { type: e.type, id: e.id };
          const results = await authz.checkMany(
            ACTIONS.map((a) => ({ who, canThey: a, onWhat: target, context })),
          );
          const actions = ACTIONS.filter((_, i) => results[i]);
          return {
            key: keyOf(e.type, e.id),
            type: e.type,
            id: e.id,
            name: e.name,
            parentKey: parentOf.get(keyOf(e.type, e.id)),
            actions,
            accessible: actions.includes("view"),
          };
        }),
      );

      // --- opened resource detail ---
      let opened: Opened | null = null;
      if (openKey) {
        const { type, id } = parseTarget(openKey);
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
            if (canView) {
              const res = await db.query<{ content: string | null }>(
                "SELECT content FROM documents WHERE id = $1",
                [id],
              );
              base.content = res.rows[0]?.content ?? null;
            } else {
              base.content = null;
            }
            // Field-level: a doc may expose individual `#field` ids the persona can
            // see even when the base document is locked (and vice-versa).
            const fieldIds = Object.keys(FIELD_CONTENT).filter(
              (fid) => baseId(fid) === id,
            );
            base.fields = await Promise.all(
              fieldIds.map(async (fid): Promise<DocField> => {
                const canViewField = await authz.check({
                  who,
                  canThey: "view",
                  onWhat: { type: "document", id: fid },
                  context,
                });
                return {
                  id: fid,
                  field: fid.slice(id.length + 1),
                  canView: canViewField,
                  content: canViewField ? (FIELD_CONTENT[fid] ?? null) : null,
                };
              }),
            );
          } else if (type === "folder") {
            base.children = entities
              .filter((e) => e.parentKey === openKey)
              .map((e) => ({
                key: e.key,
                type: e.type,
                id: e.id,
                name: e.name,
              }));
          } else {
            const names = new Map(
              usersRes.rows.map((u) => [u.id, u.name] as const),
            );
            base.members = tuplesRes.rows
              .filter(
                (t) =>
                  t.relation === "member" &&
                  t.object_type === "team" &&
                  t.object_id === id,
              )
              .map((t) => ({
                id: t.subject_id,
                name: names.get(t.subject_id) ?? t.subject_id,
              }));
          }
          opened = base;
        }
      }

      // --- inspector ---
      let inspect: Inspect | null = null;
      if (inspectKey) {
        const { type, id } = parseTarget(inspectKey);
        const ent = entities.find((e) => e.key === inspectKey);
        const target = { type, id };

        // explain(): the path that grants (or null when denied).
        const explained = await authz.explain({
          who,
          canThey: inspectAction,
          onWhat: target,
          context,
        });

        // checkMany(): a users × actions matrix for this resource.
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

        // listSubjects(): the reverse question — who can view / edit this?
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

        // Tuples on this object, its field-base, and its hierarchy ancestors.
        const relevant = new Set<string>([
          keyOf(type, id),
          keyOf(type, baseId(id)),
        ]);
        let ancestor =
          parentOf.get(keyOf(type, baseId(id))) ??
          parentOf.get(keyOf(type, id));
        while (ancestor) {
          relevant.add(ancestor);
          ancestor = parentOf.get(ancestor);
        }
        const tuples = tuplesRes.rows
          .filter(
            (t) =>
              relevant.has(keyOf(t.object_type, t.object_id)) ||
              (t.subject_type === type && t.subject_id === baseId(id)),
          )
          .map(rowToTuple);

        inspect = {
          action: inspectAction,
          target: { type, id, name: ent?.name ?? id },
          allowed: explained.allowed,
          via: explained.via,
          matrix,
          whoCanView: whoCanView.map((s) => s.id),
          whoCanEdit: whoCanEdit.map((s) => s.id),
          tuples,
        };
      }

      return data<HomeLoaderData>({
        persona,
        users: usersRes.rows,
        region,
        entities,
        opened,
        inspect,
        allTuples: tuplesRes.rows.map(rowToTuple),
      });
    },
    { preload: true },
  );
}

export async function clientAction({ request }: ClientActionFunctionArgs) {
  const { db, authz } = await getDb();
  const fd = await request.formData();
  const intent = str(fd, "intent");

  if (intent === "reset") {
    await resetWorld();
    return ok("World reset to the seeded state.");
  }

  const actingUserId = str(fd, "actingUserId");
  if (!actingUserId) return fail("Missing acting user.");
  // The acting subject — every check below asks "can THIS user do X?".
  const me = { type: "user" as const, id: actingUserId };

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
          await db.query(
            "INSERT INTO documents (id, title, content) VALUES ($1, $2, $3)",
            [id, name, `# ${name}\n\n`],
          );
          await authz.allow({
            who: me,
            toBe: "owner",
            onWhat: { type: "document", id },
          });
        } else if (intent === "createFolder") {
          await db.query("INSERT INTO folders (id, name) VALUES ($1, $2)", [
            id,
            name,
          ]);
          await authz.allow({
            who: me,
            toBe: "owner",
            onWhat: { type: "folder", id },
          });
        } else {
          await db.query("INSERT INTO teams (id, name) VALUES ($1, $2)", [
            id,
            name,
          ]);
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
        // Enforce: you can only share what you can `share`.
        if (!(await authz.check({ who: me, canThey: "share", onWhat: target })))
          return fail(`${actingUserId} can't share this.`, 403);
        // Conferring ownership is a transfer — only an owner may do it.
        if (
          relation === "owner" &&
          !(await authz.check({ who: me, canThey: "delete", onWhat: target }))
        )
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
        if (!(await authz.check({ who: me, canThey: "share", onWhat: target })))
          return fail(`${actingUserId} can't share this.`, 403);
        // everyone("user") is a wildcard subject — one grant for all users.
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
        if (!(await authz.check({ who: me, canThey: "share", onWhat: target })))
          return fail(`${actingUserId} can't share this.`, 403);
        // `when.validUntil` is a time condition stored on the tuple itself.
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
        if (!(await authz.check({ who: me, canThey: "share", onWhat: target })))
          return fail(`${actingUserId} can't share this.`, 403);
        // Grant a single `#field` id — exposes only that field of the document.
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
        if (
          !(await authz.check({
            who: me,
            canThey: "manage_members",
            onWhat: team,
          }))
        )
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
        if (!(await authz.check({ who: me, canThey: "edit", onWhat: child })))
          return fail(`${actingUserId} can't move this.`, 403);
        if (!(await authz.check({ who: me, canThey: "edit", onWhat: parent })))
          return fail(`${actingUserId} can't file into that folder.`, 403);
        await authz.setParent({ child, parent });
        return ok(`Moved ${child.id} into ${parent.id}.`);
      }

      case "saveEdit": {
        const target = parseTarget(str(fd, "resourceKey"));
        const content = (fd.get("content") ?? "").toString();
        if (!(await authz.check({ who: me, canThey: "edit", onWhat: target })))
          return fail(`${actingUserId} can't edit this.`, 403);
        await db.query("UPDATE documents SET content = $1 WHERE id = $2", [
          content,
          target.id,
        ]);
        return ok(`Saved ${target.id}.`);
      }

      case "delete": {
        const target = parseTarget(str(fd, "resourceKey"));
        if (
          !(await authz.check({ who: me, canThey: "delete", onWhat: target }))
        )
          return fail(`${actingUserId} can't delete this.`, 403);
        const table =
          target.type === "document"
            ? "documents"
            : target.type === "folder"
              ? "folders"
              : "teams";
        await db.query(`DELETE FROM ${table} WHERE id = $1`, [target.id]);
        // Clean up every tuple that referenced the object.
        await authz.disallowAllMatching({ onWhat: target });
        return redirect(`/?as=${actingUserId}`);
      }

      case "revoke": {
        const onWhat = {
          type: str(fd, "objectType") as ObjType,
          id: str(fd, "objectId"),
        };
        if (!(await authz.check({ who: me, canThey: "share", onWhat })))
          return fail(`${actingUserId} can't change sharing here.`, 403);
        const subjectType = str(fd, "subjectType") as "user" | "team";
        const subjectId = str(fd, "subjectId");
        const was = str(fd, "relation");
        if (
          was === "owner" &&
          !(await authz.check({ who: me, canThey: "delete", onWhat }))
        )
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
    // Postgres unique-violation = duplicate id.
    if (code === "23505")
      return fail("That name is already taken — pick another.", 409);
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
    <TooltipProvider>
      <div className="min-h-screen bg-zinc-50 text-zinc-900">
        <TopBar
          persona={ld.persona}
          users={ld.users}
          region={ld.region}
          tupleCount={ld.allTuples.length}
        />
        {flash?.message && (
          <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-center text-sm text-emerald-700">
            {flash.message}
          </div>
        )}
        {flash?.error && (
          <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-center text-sm text-rose-700">
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
    </TooltipProvider>
  );
}
