import { PrismaClient } from "@prisma/client-generated";
import { AuthSystem, defineSchema, everyone } from "polizy";
import { PrismaStorageAdapter } from "polizy/prisma-storage";

const prisma = new PrismaClient();

/**
 * The authorization model for PolizyDocs.
 *
 * - `owner`/`editor`/`viewer` are direct relations on a resource.
 * - `member` is a group relation: a `member` of a team inherits whatever the
 *   team itself can do.
 * - `parent` is a hierarchy relation: a document inside a folder inherits the
 *   folder's access (per `hierarchyPropagation`).
 * - `document` is opted into field-level identifiers, so an id like
 *   `doc-payroll#summary` inherits from its base `doc-payroll` — and can be
 *   granted independently to expose a single field.
 */
const docSchema = defineSchema({
  subjectTypes: ["user", "team"],
  objectTypes: ["document", "folder", "team"],
  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
    member: { type: "group" },
    parent: { type: "hierarchy" },
  },
  actionToRelations: {
    view: ["owner", "editor", "viewer", "member"],
    edit: ["owner", "editor"],
    delete: ["owner"],
    share: ["owner", "editor"],
    manage_members: ["owner"],
  },
  hierarchyPropagation: {
    view: ["view"],
    edit: ["edit"],
    delete: [],
    share: [],
    manage_members: [],
  },
  fieldLevelObjects: ["document"],
});

export type DocSchema = typeof docSchema;

const storage = PrismaStorageAdapter<
  "user" | "team",
  "document" | "folder" | "team"
>(prisma as never);

const authz = new AuthSystem({ schema: docSchema, storage });

const USERS = [
  { id: "alice", name: "Alice" },
  { id: "bob", name: "Bob" },
  { id: "charlie", name: "Charlie" },
  { id: "david", name: "David" },
];

const FOLDERS = [
  { id: "folder-engineering", name: "Engineering" },
  { id: "folder-design", name: "Design" },
];

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
      '# Public Roadmap\n\nShared with **everyone** via `everyone("user")`. Switch to any persona — they can all read it.',
  },
  {
    id: "doc-payroll",
    title: "Payroll 2026",
    content:
      "# Payroll 2026 (confidential)\n\nBase salaries, equity, and bonuses.\n\nOnly Alice (owner) sees this body. Bob was granted just the `#summary` field — a field-level grant.",
  },
  {
    id: "doc-nda",
    title: "Contractor NDA",
    content:
      "# Contractor NDA\n\nBob has a 7-day time-limited grant to review it; Charlie's grant does not start until next week.",
  },
  {
    id: "doc-eu",
    title: "EU Market Strategy",
    content:
      '# EU Market Strategy\n\nVisible to the Engineering team only when the request context says `region = "eu"` — an attribute (ABAC) condition.',
  },
];

const TEAMS = [
  { id: "team-eng", name: "Engineering Team" },
  { id: "team-design", name: "Design Team" },
];

const user = (id: string) => ({ type: "user" as const, id });
const team = (id: string) => ({ type: "team" as const, id });
const doc = (id: string) => ({ type: "document" as const, id });
const folder = (id: string) => ({ type: "folder" as const, id });

/** Wipe every table and re-create the demo world from scratch. */
export async function resetDatabase(): Promise<void> {
  await prisma.$transaction([
    prisma.polizyTuple.deleteMany({}),
    prisma.document.deleteMany({}),
    prisma.folder.deleteMany({}),
    prisma.team.deleteMany({}),
    prisma.user.deleteMany({}),
  ]);
  await seedDatabase();
}

/** Create the seeded world. Assumes empty tables (run after a reset/push). */
export async function seedDatabase(): Promise<void> {
  await prisma.user.createMany({ data: USERS });
  await prisma.folder.createMany({ data: FOLDERS });
  await prisma.document.createMany({ data: DOCUMENTS });
  await prisma.team.createMany({ data: TEAMS });

  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();

  // 1. DIRECT grants.
  await authz.allowMany([
    {
      who: user("alice"),
      toBe: "owner",
      onWhat: folder("folder-engineering"),
    },
    { who: user("alice"), toBe: "owner", onWhat: doc("doc-arch") },
    { who: user("alice"), toBe: "owner", onWhat: doc("doc-api") },
    { who: user("alice"), toBe: "owner", onWhat: doc("doc-payroll") },
    { who: user("alice"), toBe: "owner", onWhat: doc("doc-nda") },
    { who: user("bob"), toBe: "editor", onWhat: doc("doc-arch") },
    { who: user("charlie"), toBe: "owner", onWhat: folder("folder-design") },
    { who: user("charlie"), toBe: "owner", onWhat: doc("doc-brand") },
    { who: user("charlie"), toBe: "owner", onWhat: doc("doc-eu") },
  ]);

  // 2. HIERARCHY: documents live inside folders.
  await authz.setParent({
    child: doc("doc-arch"),
    parent: folder("folder-engineering"),
  });
  await authz.setParent({
    child: doc("doc-api"),
    parent: folder("folder-engineering"),
  });
  await authz.setParent({
    child: doc("doc-brand"),
    parent: folder("folder-design"),
  });

  // 3. GROUPS: team membership + a team-level grant. Members of team-eng inherit
  //    the team's view of the Engineering folder, and its documents inherit that.
  await authz.addMember({ member: user("charlie"), group: team("team-eng") });
  await authz.addMember({ member: user("david"), group: team("team-eng") });
  await authz.addMember({ member: user("bob"), group: team("team-design") });
  await authz.allow({
    who: user("alice"),
    toBe: "owner",
    onWhat: team("team-eng"),
  });
  await authz.allow({
    who: user("charlie"),
    toBe: "owner",
    onWhat: team("team-design"),
  });
  await authz.allow({
    who: team("team-eng"),
    toBe: "viewer",
    onWhat: folder("folder-engineering"),
  });

  // 4. PUBLIC: shared with everyone.
  await authz.allow({
    who: everyone("user"),
    toBe: "viewer",
    onWhat: doc("doc-roadmap"),
  });

  // 5. TIME-LIMITED: a valid window on the grant.
  await authz.allow({
    who: user("bob"),
    toBe: "viewer",
    onWhat: doc("doc-nda"),
    when: { validUntil: new Date(now + 7 * DAY) },
  });
  await authz.allow({
    who: user("charlie"),
    toBe: "viewer",
    onWhat: doc("doc-nda"),
    when: { validSince: new Date(now + 7 * DAY) },
  });

  // 6. ABAC: attribute condition evaluated against the check() context.
  await authz.allow({
    who: team("team-eng"),
    toBe: "viewer",
    onWhat: doc("doc-eu"),
    when: {
      attributes: [{ attribute: "region", operator: "eq", value: "eu" }],
    },
  });

  // 7. FIELD-LEVEL: grant a single field of a document.
  await authz.allow({
    who: user("bob"),
    toBe: "viewer",
    onWhat: doc("doc-payroll#summary"),
  });
}

export { prisma, authz, storage, docSchema };
