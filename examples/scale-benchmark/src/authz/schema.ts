import { defineSchema } from "polizy";

/**
 * A classic docs/folders/teams ReBAC model — the kind of graph that exercises
 * every expensive path: direct grants, nested group membership, and deep
 * hierarchy propagation. We grow it to tens of thousands of tuples to see where
 * polizy's engine bends.
 */
export const schema = defineSchema({
  subjectTypes: ["user", "team"],
  objectTypes: ["document", "folder", "team"],
  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
    member: { type: "group" }, // user --member--> team, team --member--> team (nested)
    parent: { type: "hierarchy" }, // document/folder --parent--> folder
  },
  actionToRelations: {
    view: ["owner", "editor", "viewer", "member"],
    edit: ["owner", "editor"],
    delete: ["owner"],
  },
  hierarchyPropagation: {
    view: ["view"],
    edit: ["edit"],
    delete: [],
  },
});

export type Schema = typeof schema;
export type Action = "view" | "edit" | "delete";
