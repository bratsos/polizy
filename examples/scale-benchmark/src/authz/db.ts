import { PGlite } from "@electric-sql/pglite";
import {
  AuthSystem,
  type SchemaObjectTypes,
  type SchemaSubjectTypes,
} from "polizy";
import { createPGliteAdapter, POLIZY_TUPLE_DDL } from "./pglite-adapter.ts";
import { schema } from "./schema.ts";

export type Authz = AuthSystem<typeof schema>;

export type Scale = "small" | "medium" | "large";

interface Preset {
  users: number;
  teams: number;
  folders: number;
  docs: number;
  deptDocs: number; // docs in the bounded "department" subtree
  deptMembers: number; // members of the department team
  batchK: number; // batch size for the throughput benchmark
}

export const PRESETS: Record<Scale, Preset> = {
  small: {
    users: 1_000,
    teams: 100,
    folders: 200,
    docs: 4_000,
    deptDocs: 300,
    deptMembers: 300,
    batchK: 100,
  },
  medium: {
    users: 5_000,
    teams: 500,
    folders: 1_000,
    docs: 20_000,
    deptDocs: 1_000,
    deptMembers: 1_000,
    batchK: 200,
  },
  large: {
    users: 10_000,
    teams: 1_000,
    folders: 2_000,
    docs: 50_000,
    deptDocs: 2_000,
    deptMembers: 2_000,
    batchK: 300,
  },
};

export interface Request {
  who: { type: "user"; id: string };
  canThey: "view" | "edit" | "delete";
  onWhat: { type: "document"; id: string };
}

export interface Handles {
  /** Resolves TRUE via membership -> dept team -> folder hierarchy (bounded path). */
  checkAllow: Request;
  /** Resolves FALSE — exercises the full fail-closed exploration. */
  checkDeny: Request;
  /** A user with BOUNDED reach (dept team only): listAccessibleObjects ~ deptDocs. */
  listUser: { type: "user"; id: string };
  /** A user with BROAD reach (root-folder viewer): the listAccessibleObjects bottleneck. */
  broadUser: { type: "user"; id: string };
  /** A document many subjects can reach (for listSubjects). */
  listDoc: { type: "document"; id: string };
  /** A batch of checks that share reads (same dept folder/team) — read-scope shines. */
  batch: Request[];
}

export function handlesFor(scale: Scale): Handles {
  const p = PRESETS[scale];
  const batch: Request[] = [];
  for (let i = 0; i < p.batchK; i++) {
    batch.push({
      who: { type: "user", id: `user-${i % p.deptMembers}` },
      canThey: "view",
      onWhat: { type: "document", id: `deptdoc-${i % p.deptDocs}` },
    });
  }
  return {
    checkAllow: {
      who: { type: "user", id: "auditor" },
      canThey: "view",
      onWhat: { type: "document", id: "deptdoc-1" },
    },
    checkDeny: {
      who: { type: "user", id: "auditor" },
      canThey: "delete",
      onWhat: { type: "document", id: "deptdoc-1" },
    },
    listUser: { type: "user", id: "auditor" },
    broadUser: { type: "user", id: "user-0" },
    listDoc: { type: "document", id: "deptdoc-1" },
    batch,
  };
}

type RawTuple = {
  id: string;
  st: string;
  si: string;
  rel: string;
  ot: string;
  oi: string;
};

function buildTuples(scale: Scale): RawTuple[] {
  const p = PRESETS[scale];
  const rows: RawTuple[] = [];
  let c = 0;
  const push = (
    st: string,
    si: string,
    rel: string,
    ot: string,
    oi: string,
  ) => {
    rows.push({ id: `t${c++}`, st, si, rel, ot, oi });
  };

  // Folder tree (branching factor 4): folder-0 is the root of everything.
  for (let i = 1; i < p.folders; i++) {
    push(
      "folder",
      `folder-${i}`,
      "parent",
      "folder",
      `folder-${Math.floor((i - 1) / 4)}`,
    );
  }
  // Documents spread across folders; the first 30% also get a direct owner.
  const owners = Math.floor(p.docs * 0.3);
  for (let i = 0; i < p.docs; i++) {
    push("document", `doc-${i}`, "parent", "folder", `folder-${i % p.folders}`);
    if (i < owners) {
      push("user", `user-${i % p.users}`, "owner", "document", `doc-${i}`);
    }
  }
  // Each user is a member of one team.
  for (let i = 0; i < p.users; i++) {
    push("user", `user-${i}`, "member", "team", `team-${i % p.teams}`);
  }
  // Nested teams: teams 10+ are members of one of the 10 "root" teams.
  for (let j = 10; j < p.teams; j++) {
    push("team", `team-${j}`, "member", "team", `team-${j % 10}`);
  }
  // Each team is a viewer of one folder (team-0 -> folder-0 = the whole tree).
  for (let j = 0; j < p.teams; j++) {
    push("team", `team-${j}`, "viewer", "folder", `folder-${j % p.folders}`);
  }
  // A bounded "department" subtree under the root, with its own team + members.
  push("folder", "folder-dept", "parent", "folder", "folder-0");
  for (let i = 0; i < p.deptDocs; i++) {
    push("document", `deptdoc-${i}`, "parent", "folder", "folder-dept");
  }
  push("team", "deptteam", "viewer", "folder", "folder-dept");
  for (let i = 0; i < p.deptMembers; i++) {
    push("user", `user-${i}`, "member", "team", "deptteam");
  }
  // The bounded-reach probe user: ONLY in the department team.
  push("user", "auditor", "member", "team", "deptteam");

  return rows;
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Generate a dataset and bulk-insert it. Returns the total tuple count. */
export async function generate(
  db: PGlite,
  scale: Scale,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  await db.exec("TRUNCATE polizy_tuple");
  const rows = buildTuples(scale);
  const BATCH = 5_000;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const values = chunk
      .map(
        (t) =>
          `(${q(t.id)},${q(t.st)},${q(t.si)},${q(t.rel)},${q(t.ot)},${q(t.oi)})`,
      )
      .join(",");
    await db.exec(
      `INSERT INTO polizy_tuple (id, subject_type, subject_id, relation, object_type, object_id)
       VALUES ${values} ON CONFLICT DO NOTHING;`,
    );
    onProgress?.(Math.min(i + BATCH, rows.length), rows.length);
  }
  return countTuples(db);
}

export async function countTuples(db: PGlite): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM polizy_tuple",
  );
  return rows[0]?.n ?? 0;
}

export function makeAuthz(
  db: PGlite,
  maxDepthBehavior: "throw" | "deny" = "throw",
): Authz {
  return new AuthSystem({
    schema,
    storage: createPGliteAdapter<
      SchemaSubjectTypes<typeof schema>,
      SchemaObjectTypes<typeof schema>
    >(db),
    // The structural list optimizations (reverse expansion / single-pass
    // derivation) engage in BOTH modes; deny bounds at the depth cap, throw
    // raises past it.
    maxDepthBehavior,
  });
}

/** Boot PGlite and migrate. In-memory by default (`dataDir` omitted); pass an
 *  `idb://`/path data dir only when persistence is wanted — note that the
 *  IndexedDB VFS adds ~100× per-query I/O, so the benchmark uses in-memory. */
export async function bootDb(dataDir?: string): Promise<PGlite> {
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.waitReady;
  await db.exec(POLIZY_TUPLE_DDL);
  return db;
}
