import type { ExplainNode } from "polizy";
import {
  data,
  type LoaderFunctionArgs,
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
        const results = await authz.checkMany({
          who: { type: "user" as const, id: u },
          checks: ACTIONS.map((a) => ({ canThey: a, onWhat: target })),
          context,
        });
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

    const base = baseId(id);
    const tuples = allTupleRows
      .filter(
        (t) =>
          (t.objectType === type &&
            (t.objectId === id || t.objectId === base)) ||
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

export { action } from "../lib/home-action.server";

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
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-0 lg:grid-cols-[300px_1fr]">
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
