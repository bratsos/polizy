import type { Action } from "./schema.ts";

export interface SeedUser {
  id: string;
  name: string;
  initials: string;
}

interface SeedRole {
  name: string;
  label: string;
  can: Action[];
  members: string[];
  everyone?: boolean;
}

interface SeedWorkspace {
  id: string;
  name: string;
  bookings: { id: string; label: string }[];
  roles: SeedRole[];
}

export const SEED: {
  users: SeedUser[];
  workspaces: SeedWorkspace[];
} = {
  users: [
    { id: "alice", name: "Alice Ng", initials: "AN" },
    { id: "bob", name: "Bob Ito", initials: "BI" },
    { id: "carol", name: "Carol Vex", initials: "CV" },
    { id: "dave", name: "Dave Roe", initials: "DR" },
    { id: "erin", name: "Erin Sol", initials: "ES" },
    { id: "frank", name: "Frank Lee", initials: "FL" },
  ],
  workspaces: [
    {
      id: "acme",
      name: "Acme Tours",
      bookings: [
        { id: "bk-101", label: "Reykjavík · Northern Lights" },
        { id: "bk-102", label: "Kyoto · Cherry Blossom" },
      ],
      // Mirrors the reference permissions-matrix UI.
      roles: [
        {
          name: "admin",
          label: "Admin",
          can: [
            "view_bookings",
            "edit_bookings",
            "issue_refunds",
            "view_finances",
            "manage_pricing",
            "manage_settings",
          ],
          members: ["alice"],
        },
        {
          name: "ops",
          label: "Ops",
          can: ["view_bookings", "edit_bookings", "manage_pricing"],
          members: ["bob"],
        },
        {
          name: "finance",
          label: "Finance",
          can: [
            "view_bookings",
            "issue_refunds",
            "view_finances",
            "manage_pricing",
          ],
          members: ["carol"],
        },
        {
          name: "guide",
          label: "Guide",
          can: ["view_bookings"],
          members: ["dave"],
          everyone: true,
        },
        {
          name: "support",
          label: "Support",
          can: ["view_bookings", "edit_bookings"],
          members: ["erin"],
        },
      ],
    },
    {
      id: "globex",
      name: "Globex Travel",
      bookings: [{ id: "bk-201", label: "Lisbon · Coastline" }],
      // A deliberately DIFFERENT role set — same engine, divergent per tenant.
      roles: [
        {
          name: "owner",
          label: "Owner",
          can: [
            "view_bookings",
            "edit_bookings",
            "issue_refunds",
            "view_finances",
            "manage_pricing",
            "manage_settings",
          ],
          members: ["frank"],
        },
        {
          name: "agent",
          label: "Travel Agent",
          can: ["view_bookings", "edit_bookings"],
          members: ["alice"],
        },
        {
          name: "accountant",
          label: "Accountant",
          can: ["view_finances", "issue_refunds"],
          members: [],
        },
      ],
    },
  ],
};
