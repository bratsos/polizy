import { defineSchema, withRoleScaffold } from "polizy";

/**
 * The permission ROWS of the matrix: the fixed, app-defined action vocabulary.
 * These are compile-time literals — `defineRole`/`grantToRole`/`check` reject
 * any action not in this list. Only the role COLUMNS are created at runtime.
 */
export const GRANTABLE = [
  "view_bookings",
  "edit_bookings",
  "issue_refunds",
  "view_finances",
  "manage_pricing",
  "manage_settings",
] as const;

export type Action = (typeof GRANTABLE)[number];

export const PERMISSION_LABELS: Record<Action, string> = {
  view_bookings: "View bookings",
  edit_bookings: "Edit bookings",
  issue_refunds: "Issue refunds",
  view_finances: "View finances",
  manage_pricing: "Manage pricing",
  manage_settings: "Manage settings",
};

const base = defineSchema({
  subjectTypes: ["user"],
  objectTypes: ["workspace", "booking"],
  relations: {
    owner: { type: "direct" },
    member: { type: "group" },
    parent: { type: "hierarchy" },
  },
  actionToRelations: {
    view_bookings: ["owner"],
    edit_bookings: ["owner"],
    issue_refunds: ["owner"],
    view_finances: ["owner"],
    manage_pricing: ["owner"],
    manage_settings: ["owner"],
  },
  // Workspace-scoped capabilities flow down to the workspace's bookings.
  hierarchyPropagation: {
    view_bookings: ["view_bookings"],
    edit_bookings: ["edit_bookings"],
    issue_refunds: ["issue_refunds"],
    view_finances: ["view_finances"],
    manage_pricing: ["manage_pricing"],
    manage_settings: ["manage_settings"],
  },
});

/** The schema with the runtime-roles scaffold merged in (still fully typed). */
export const schema = withRoleScaffold(base, { grantable: GRANTABLE });
export type Schema = typeof schema;
