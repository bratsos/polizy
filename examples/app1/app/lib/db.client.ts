import { PGlite } from "@electric-sql/pglite";
import {
  AuthSystem,
  defineSchema,
  everyone,
  InMemoryStorageAdapter,
} from "polizy";
import {
  createPGliteAdapter,
  POLIZY_TUPLE_DDL,
  reviveCondition,
} from "./pglite-adapter";

/**
 * THE AUTHORIZATION MODEL
 * -----------------------
 * Polizy is a ReBAC (relationship-based) library, à la Google Zanzibar. Every
 * permission is a *tuple*: (subject, relation, object). The tuple
 *   (user:alice, owner, document:doc-arch)
 * reads "alice is an owner of doc-arch". There are no permission columns on your
 * models — authorization is just these relationship facts, queried on demand.
 *
 * `defineSchema` declares the shape of that graph:
 *  - `relations` are the edges you may store. Each has a `type`:
 *      • "direct"    — a plain grant on an object (owner / editor / viewer).
 *      • "group"     — membership; a subject inherits whatever the group can do.
 *      • "hierarchy" — containment; an object inherits from its parent.
 *  - `actionToRelations` maps a high-level action to the relations that satisfy
 *    it. A `check` for an action passes if the subject holds ANY of them
 *    (directly, or inherited through groups / hierarchy).
 *  - `hierarchyPropagation` says which actions flow from parent to child.
 *  - `fieldLevelObjects` opts a type into `#field` ids (e.g. `doc-payroll#summary`)
 *    that inherit from their base object. Off by default — a safe default.
 */
export const docSchema = defineSchema({
  subjectTypes: ["user", "team"],
  objectTypes: ["document", "folder", "team"],
  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
    member: { type: "group" }, //  user --member--> team
    parent: { type: "hierarchy" }, //  document --parent--> folder
  },
  actionToRelations: {
    view: ["owner", "editor", "viewer", "member"],
    edit: ["owner", "editor"],
    delete: ["owner"],
    share: ["owner", "editor"],
    manage_members: ["owner"],
  },
  // `view`/`edit` on a folder reach the documents inside it; `delete` etc. do not.
  hierarchyPropagation: {
    view: ["view"],
    edit: ["edit"],
    delete: [],
    share: [],
    manage_members: [],
  },
  // Opt `document` into field-level ids like `doc-payroll#summary`.
  fieldLevelObjects: ["document"],
});

export type DocSchema = typeof docSchema;

/** Domain tables (the app's own data) + the polizy tuple table. */
const SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS users     (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS folders   (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT);
  CREATE TABLE IF NOT EXISTS teams     (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  ${POLIZY_TUPLE_DDL}
`;

export async function migrate(db: PGlite): Promise<void> {
  await db.exec(SCHEMA_DDL);
}

/** Wire the polizy engine to this database via the PGlite storage adapter. */
export function makeAuthz(db: PGlite) {
  return new AuthSystem({
    schema: docSchema,
    storage: createPGliteAdapter<
      "user" | "team",
      "document" | "folder" | "team"
    >(db),
  });
}

export type Authz = ReturnType<typeof makeAuthz>;

type TupleRow = {
  subject_type: string;
  subject_id: string;
  relation: string;
  object_type: string;
  object_id: string;
  condition: unknown;
};

/**
 * Evaluate a page's read checks against an in-memory copy of the tuples — a
 * request-scoped read cache.
 *
 * The polizy engine batches its reads (one broadened range read per
 * subject/object/relation, reused within an operation), so reading straight
 * from `getDb().authz` works. But this demo's PGlite lives in WASM + IndexedDB,
 * where every query is a ~20ms round-trip, and a single page render runs many
 * operations (one `checkMany` per resource, the inspector matrix, …) — dozens of
 * round-trips, ~1s. The whole tuple set is tiny, so we load it ONCE and run all
 * read checks against an in-memory adapter (microseconds). PGlite stays the
 * source of truth; *writes* still go through `getDb().authz`, and the next load
 * re-reads the result. (A server-backed app over a real Postgres wouldn't need
 * this — there a round-trip is cheap and you'd read directly.)
 */
export async function authzFromSnapshot(rows: TupleRow[]): Promise<Authz> {
  const mem = new InMemoryStorageAdapter<
    "user" | "team",
    "document" | "folder" | "team"
  >();
  await mem.write(
    rows.map((r) => {
      const condition = reviveCondition(r.condition);
      return {
        subject: { type: r.subject_type as "user" | "team", id: r.subject_id },
        relation: r.relation,
        object: {
          type: r.object_type as "document" | "folder" | "team",
          id: r.object_id,
        },
        ...(condition ? { condition } : {}),
      };
    }),
  );
  return new AuthSystem({ schema: docSchema, storage: mem });
}

const DOCUMENTS = [
  {
    id: "doc-arch",
    title: "Architecture Spec",
    content:
      "# Architecture Spec\n\nEvery permission is a fact: (subject, relation, object).\n\nAlice owns this; Bob can edit it. The Engineering team can view the whole folder, so its members inherit access here through group + hierarchy.",
  },
  {
    id: "doc-api",
    title: "API Reference",
    content:
      "# API Reference\n\ncheck · explain · checkMany · listSubjects · listAccessibleObjects.\n\nThis document lives in the Engineering folder and inherits its permissions through the `parent` hierarchy relation.",
  },
  {
    id: "doc-brand",
    title: "Brand Guidelines",
    content: "# Brand Guidelines\n\nColors, type, and tone. Owned by Charlie.",
  },
  {
    id: "doc-roadmap",
    title: "Public Roadmap",
    content:
      '# Public Roadmap\n\nShared with **everyone** via `everyone("user")`. Switch persona — they can all read it.',
  },
  {
    id: "doc-payroll",
    title: "Payroll 2026",
    content:
      "# Payroll 2026 (confidential)\n\nFull salary, equity, and bonus tables for every employee.\n\nOnly Alice (owner) sees this body. Bob was granted just the `#summary` field — a field-level grant — so he sees the summary, not this.",
    summary:
      "Total comp budget grew 12% YoY. Headcount +8. No individual figures here.",
  },
  {
    id: "doc-nda",
    title: "Contractor NDA",
    content:
      "# Contractor NDA\n\nBob has a 7-day grant to review it; Charlie's grant doesn't start until next week.",
  },
  {
    id: "doc-eu",
    title: "EU Market Strategy",
    content:
      '# EU Market Strategy\n\nVisible to the Engineering team only when the request context says `region = "eu"` — an attribute (ABAC) condition.',
  },
];

/** Public summary fields, keyed by `document#field` id (see field-level grant below). */
export const FIELD_CONTENT: Record<string, string> = {
  "doc-payroll#summary": DOCUMENTS[4]?.summary ?? "",
};

/**
 * Build the demo world. Domain rows go in with plain SQL; every *tuple* is
 * written through the polizy API directly, so each call shows the real shape of
 * the library. Each numbered block demonstrates one capability.
 */
export async function seedWorld(db: PGlite, authz: Authz): Promise<void> {
  for (const [id, name] of [
    ["alice", "Alice"],
    ["bob", "Bob"],
    ["charlie", "Charlie"],
    ["david", "David"],
  ]) {
    await db.query("INSERT INTO users (id, name) VALUES ($1, $2)", [id, name]);
  }
  for (const [id, name] of [
    ["folder-engineering", "Engineering"],
    ["folder-design", "Design"],
  ]) {
    await db.query("INSERT INTO folders (id, name) VALUES ($1, $2)", [
      id,
      name,
    ]);
  }
  for (const [id, name] of [
    ["team-eng", "Engineering Team"],
    ["team-design", "Design Team"],
  ]) {
    await db.query("INSERT INTO teams (id, name) VALUES ($1, $2)", [id, name]);
  }
  for (const d of DOCUMENTS) {
    await db.query(
      "INSERT INTO documents (id, title, content) VALUES ($1, $2, $3)",
      [d.id, d.title, d.content],
    );
  }

  // 1) DIRECT grants — the simplest tuple. `allow` writes (subject, relation, object).
  await authz.allow({
    who: { type: "user", id: "alice" },
    toBe: "owner",
    onWhat: { type: "folder", id: "folder-engineering" },
  });
  await authz.allow({
    who: { type: "user", id: "alice" },
    toBe: "owner",
    onWhat: { type: "document", id: "doc-arch" },
  });
  await authz.allow({
    who: { type: "user", id: "alice" },
    toBe: "owner",
    onWhat: { type: "document", id: "doc-api" },
  });
  await authz.allow({
    who: { type: "user", id: "alice" },
    toBe: "owner",
    onWhat: { type: "document", id: "doc-payroll" },
  });
  await authz.allow({
    who: { type: "user", id: "alice" },
    toBe: "owner",
    onWhat: { type: "document", id: "doc-nda" },
  });
  await authz.allow({
    who: { type: "user", id: "bob" },
    toBe: "editor",
    onWhat: { type: "document", id: "doc-arch" },
  });
  await authz.allow({
    who: { type: "user", id: "charlie" },
    toBe: "owner",
    onWhat: { type: "folder", id: "folder-design" },
  });
  await authz.allow({
    who: { type: "user", id: "charlie" },
    toBe: "owner",
    onWhat: { type: "document", id: "doc-brand" },
  });
  await authz.allow({
    who: { type: "user", id: "charlie" },
    toBe: "owner",
    onWhat: { type: "document", id: "doc-eu" },
  });

  // 2) HIERARCHY — `setParent` links a child object to a parent. Because
  //    hierarchyPropagation sends `view`/`edit` downward, whoever can view the
  //    folder can view the documents inside it.
  await authz.setParent({
    child: { type: "document", id: "doc-arch" },
    parent: { type: "folder", id: "folder-engineering" },
  });
  await authz.setParent({
    child: { type: "document", id: "doc-api" },
    parent: { type: "folder", id: "folder-engineering" },
  });
  await authz.setParent({
    child: { type: "document", id: "doc-brand" },
    parent: { type: "folder", id: "folder-design" },
  });

  // 3) GROUPS — `addMember` makes a user a member of a team; a grant to the TEAM
  //    is then inherited by every member. The Engineering team can view the
  //    Engineering folder, so charlie & david (members) inherit view on the
  //    folder AND, via the hierarchy above, on its documents.
  await authz.addMember({
    member: { type: "user", id: "charlie" },
    group: { type: "team", id: "team-eng" },
  });
  await authz.addMember({
    member: { type: "user", id: "david" },
    group: { type: "team", id: "team-eng" },
  });
  await authz.addMember({
    member: { type: "user", id: "bob" },
    group: { type: "team", id: "team-design" },
  });
  await authz.allow({
    who: { type: "user", id: "alice" },
    toBe: "owner",
    onWhat: { type: "team", id: "team-eng" },
  });
  await authz.allow({
    who: { type: "user", id: "charlie" },
    toBe: "owner",
    onWhat: { type: "team", id: "team-design" },
  });
  await authz.allow({
    who: { type: "team", id: "team-eng" },
    toBe: "viewer",
    onWhat: { type: "folder", id: "folder-engineering" },
  });

  // 4) PUBLIC — `everyone("user")` is a wildcard subject; one tuple grants view
  //    to every user, present or future.
  await authz.allow({
    who: everyone("user"),
    toBe: "viewer",
    onWhat: { type: "document", id: "doc-roadmap" },
  });

  // 5) TIME-LIMITED — a `when` validity window. Bob can view the NDA for 7 days;
  //    Charlie's grant doesn't start until next week, so it denies right now.
  await authz.allow({
    who: { type: "user", id: "bob" },
    toBe: "viewer",
    onWhat: { type: "document", id: "doc-nda" },
    when: { validUntil: new Date(Date.now() + 7 * 86_400_000) },
  });
  await authz.allow({
    who: { type: "user", id: "charlie" },
    toBe: "viewer",
    onWhat: { type: "document", id: "doc-nda" },
    when: { validSince: new Date(Date.now() + 7 * 86_400_000) },
  });

  // 6) ABAC — a `when.attributes` predicate, checked against the `context` you
  //    pass to `check()` at request time. The Engineering team can view the EU
  //    strategy only when region === "eu". Fail-closed: no context ⇒ denied.
  await authz.allow({
    who: { type: "team", id: "team-eng" },
    toBe: "viewer",
    onWhat: { type: "document", id: "doc-eu" },
    when: {
      attributes: [{ attribute: "region", operator: "eq", value: "eu" }],
    },
  });

  // 7) FIELD-LEVEL — `document` is a fieldLevelObject, so an id can carry a
  //    `#field` suffix. Granting `doc-payroll#summary` exposes only that field:
  //    Bob can read the payroll summary but NOT the confidential base document.
  await authz.allow({
    who: { type: "user", id: "bob" },
    toBe: "viewer",
    onWhat: { type: "document", id: "doc-payroll#summary" },
  });
}

// --- per-visitor instance (browser only) -----------------------------------
// `idb://` persists this visitor's Postgres in their own IndexedDB. Nothing is
// shared between visitors, and tinkering survives a refresh. `resetWorld()`
// rebuilds the seed.
let ready: Promise<{ db: PGlite; authz: Authz }> | null = null;

export function getDb(): Promise<{ db: PGlite; authz: Authz }> {
  if (!ready) ready = boot();
  return ready;
}

async function boot() {
  const db = new PGlite("idb://polizy-demo");
  await db.waitReady;
  await migrate(db);
  const authz = makeAuthz(db);
  const { rows } = await db.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM polizy_tuple",
  );
  if (!rows[0] || rows[0].n === 0) await seedWorld(db, authz);
  return { db, authz };
}

export async function resetWorld(): Promise<void> {
  const { db, authz } = await getDb();
  await db.exec("TRUNCATE polizy_tuple, documents, folders, teams, users");
  await seedWorld(db, authz);
}

export { everyone };
