import { PrismaClient } from "@prisma/client-generated";
import { defineSchema, AuthSystem, PrismaAdapter } from "polizy";

const prisma = new PrismaClient();

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
});

export type DocSchema = typeof docSchema;

const storage = PrismaAdapter<"user" | "team", "document" | "folder" | "team">(
  prisma as any,
);

const authz = new AuthSystem({ schema: docSchema, storage });

async function seedDatabase() {
  console.log("Seeding database...");

  const usersData = [
    { id: "alice", name: "Alice" },
    { id: "bob", name: "Bob" },
    { id: "charlie", name: "Charlie" },
    { id: "david", name: "David" },
  ];
  for (const userData of usersData) {
    await prisma.user.upsert({
      where: { id: userData.id },
      update: {},
      create: userData,
    });
  }
  console.log("Users seeded.");

  await prisma.folder.upsert({
    where: { id: "folder-a" },
    update: {},
    create: { id: "folder-a", name: "Folder A" },
  });
  await prisma.document.upsert({
    where: { id: "doc1" },
    update: {},
    create: { id: "doc1", title: "Document 1", content: "Content for Doc 1" },
  });
  await prisma.document.upsert({
    where: { id: "doc2" },
    update: {},
    create: { id: "doc2", title: "Document 2", content: "Content for Doc 2" },
  });
  await prisma.document.upsert({
    where: { id: "doc3" },
    update: {},
    create: { id: "doc3", title: "Document 3", content: "Content for Doc 3" },
  });
  await prisma.team.upsert({
    where: { id: "team-alpha" },
    update: {},
    create: { id: "team-alpha", name: "Team Alpha" },
  });
  console.log("Resources seeded.");

  console.log("Seeding Polizy tuples...");

  const parseId = (str: string): { type: string; id: string } => {
    const parts = str.split(":");
    if (parts.length < 2 || !parts[0]) {
      throw new Error(`Invalid ID format: "${str}". Expected "type:id".`);
    }
    const type = parts[0];
    const id = parts.slice(1).join(":");
    return { type, id };
  };

  const allowTuples = [
    { who: "user:alice", relation: "owner", on: "folder:folder-a" },
    { who: "user:alice", relation: "owner", on: "document:doc1" },
    { who: "user:alice", relation: "owner", on: "document:doc2" },
    { who: "user:alice", relation: "owner", on: "team:team-alpha" },
    { who: "user:bob", relation: "owner", on: "document:doc3" },
    { who: "user:bob", relation: "editor", on: "document:doc1" },
    { who: "team:team-alpha", relation: "viewer", on: "folder:folder-a" },
    { who: "user:david", relation: "viewer", on: "document:doc2" },
  ];

  const parentTuples = [{ child: "document:doc1", parent: "folder:folder-a" }];

  const memberTuples = [{ member: "user:charlie", group: "team:team-alpha" }];

  for (const t of allowTuples) {
    try {
      const subject = parseId(t.who);
      const object = parseId(t.on);
      await authz.allow({
        who: { type: subject.type as any, id: subject.id },
        toBe: t.relation as any,
        onWhat: { type: object.type as any, id: object.id },
      });
    } catch (error: any) {
      if (
        error.code !== "P2002" &&
        !error.message?.includes("already exists")
      ) {
        console.warn(
          `Warning seeding allow tuple ${JSON.stringify(t)}:`,
          error.message,
        );
      }
    }
  }

  for (const t of parentTuples) {
    try {
      const child = parseId(t.child);
      const parent = parseId(t.parent);
      await authz.setParent({
        child: { type: child.type as any, id: child.id },
        parent: { type: parent.type as any, id: parent.id },
      });
    } catch (error: any) {
      if (
        error.code !== "P2002" &&
        !error.message?.includes("already exists")
      ) {
        console.warn(
          `Warning seeding parent tuple ${JSON.stringify(t)}:`,
          error.message,
        );
      }
    }
  }

  for (const t of memberTuples) {
    try {
      const member = parseId(t.member);
      const group = parseId(t.group);
      await authz.addMember({
        member: { type: member.type as any, id: member.id },
        group: { type: group.type as any, id: group.id },
      });
    } catch (error: any) {
      if (
        error.code !== "P2002" &&
        !error.message?.includes("already exists")
      ) {
        console.warn(
          `Warning seeding member tuple ${JSON.stringify(t)}:`,
          error.message,
        );
      }
    }
  }
  console.log("Polizy tuples seeded.");
  console.log("Database seeding complete.");
}

export { prisma, authz, storage, seedDatabase, docSchema };
