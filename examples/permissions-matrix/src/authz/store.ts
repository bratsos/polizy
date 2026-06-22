import { PGlite } from "@electric-sql/pglite";
import {
  AuthSystem,
  type ExplainNode,
  type ExplainResult,
  everyone,
  RoleRegistry,
  type SchemaObjectTypes,
  type SchemaSubjectTypes,
  type StoredTuple,
} from "polizy";
import { createPGliteAdapter, POLIZY_TUPLE_DDL } from "./pglite-adapter.ts";
import {
  createPGliteRoleCatalog,
  POLIZY_ROLE_DDL,
} from "./pglite-role-catalog.ts";
import { type Action, GRANTABLE, schema } from "./schema.ts";
import { SEED, type SeedUser } from "./seed.ts";

export type WorkspaceId = string;

export interface RoleColumn {
  name: string;
  label: string;
  can: Set<Action>;
  members: SeedUser[];
  everyone: boolean;
}

export interface MatrixSnapshot {
  permissions: Action[];
  roles: RoleColumn[];
  bookings: { id: string; label: string }[];
  users: SeedUser[];
  tuples: StoredTuple[];
}

const ws = (id: WorkspaceId) => ({ type: "workspace" as const, id });
const EVERYONE = everyone("user");

/**
 * A thin, framework-agnostic facade over polizy's RoleRegistry for the demo.
 *
 * Everything is persisted to a real Postgres running **in the browser** via
 * PGlite (WASM): the relationship tuples go through a PGlite `StorageAdapter`,
 * and the role catalog through a PGlite `RoleCatalogStore`. Nothing in this class
 * is demo-specific authorization logic — the polizy engine does the resolving.
 */
export class AuthStore {
  private readonly db: PGlite;
  readonly authz: AuthSystem<typeof schema>;
  readonly roles: RoleRegistry<typeof schema>;

  private constructor(db: PGlite) {
    this.db = db;
    this.authz = new AuthSystem({
      storage: createPGliteAdapter<
        SchemaSubjectTypes<typeof schema>,
        SchemaObjectTypes<typeof schema>
      >(db),
      schema,
      // The scaffold adds a second group relation (`assignee`); keep the app's
      // own `member` relation inferred for addMember without `as`.
      defaultGroupRelation: "member",
    });
    this.roles = new RoleRegistry(this.authz, schema, {
      catalog: createPGliteRoleCatalog(db),
    });
  }

  /**
   * Boot PGlite, migrate, and seed if empty. Pass `dataDir` (e.g.
   * `"idb://polizy-matrix"`) to persist per-visitor in IndexedDB; omit it for an
   * in-memory database (used by the headless demo / Node).
   */
  static async boot(dataDir?: string): Promise<AuthStore> {
    const db = dataDir ? new PGlite(dataDir) : new PGlite();
    await db.waitReady;
    await db.exec(`${POLIZY_TUPLE_DDL}\n${POLIZY_ROLE_DDL}`);
    const store = new AuthStore(db);
    const { rows } = await db.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM polizy_tuple",
    );
    if (!rows[0] || rows[0].n === 0) await store.seed();
    return store;
  }

  /** Wipe and re-seed (the demo's "Reset" button). */
  async reset(): Promise<void> {
    await this.db.exec("TRUNCATE polizy_tuple, polizy_role");
    await this.seed();
  }

  /** Seed two workspaces with divergent roles, members, and bookings. */
  async seed(): Promise<void> {
    for (const workspace of SEED.workspaces) {
      for (const booking of workspace.bookings) {
        await this.authz.setParent({
          child: { type: "booking", id: booking.id },
          parent: ws(workspace.id),
        });
      }
      for (const role of workspace.roles) {
        const ref = await this.roles.defineRole({
          tenant: ws(workspace.id),
          name: role.name,
          label: role.label,
          can: role.can,
        });
        for (const userId of role.members) {
          await this.roles.assignRole({ type: "user", id: userId }, ref);
        }
        if (role.everyone) {
          await this.roles.assignRole(EVERYONE, ref);
        }
      }
    }
  }

  private ref(workspace: WorkspaceId, name: string) {
    return this.roles.roleRef(ws(workspace), name);
  }

  // --- mutations -----------------------------------------------------------

  async addRole(workspace: WorkspaceId, name: string, label?: string) {
    await this.roles.defineRole({
      tenant: ws(workspace),
      name,
      label: label ?? name,
      can: [],
    });
  }

  async deleteRole(workspace: WorkspaceId, name: string) {
    await this.roles.deleteRole(this.ref(workspace, name));
  }

  async toggle(
    workspace: WorkspaceId,
    role: string,
    action: Action,
    on: boolean,
  ) {
    const ref = this.ref(workspace, role);
    if (on) await this.roles.grantToRole(ref, action);
    else await this.roles.revokeFromRole(ref, action);
  }

  async assign(workspace: WorkspaceId, role: string, userId: string) {
    await this.roles.assignRole(
      { type: "user", id: userId },
      this.ref(workspace, role),
    );
  }

  async unassign(workspace: WorkspaceId, role: string, userId: string) {
    await this.roles.unassignRole(
      { type: "user", id: userId },
      this.ref(workspace, role),
    );
  }

  async setEveryone(workspace: WorkspaceId, role: string, on: boolean) {
    const ref = this.ref(workspace, role);
    if (on) await this.roles.assignRole(EVERYONE, ref);
    else await this.roles.unassignRole(EVERYONE, ref);
  }

  // --- reads ---------------------------------------------------------------

  /** Real authorization check — what the app would call to gate an action. */
  check(
    workspace: WorkspaceId,
    userId: string,
    action: Action,
    bookingId?: string,
  ) {
    return this.authz.check({
      who: { type: "user", id: userId },
      canThey: action,
      onWhat: bookingId ? { type: "booking", id: bookingId } : ws(workspace),
    });
  }

  explain(
    workspace: WorkspaceId,
    userId: string,
    action: Action,
    bookingId?: string,
  ): Promise<ExplainResult> {
    return this.authz.explain({
      who: { type: "user", id: userId },
      canThey: action,
      onWhat: bookingId ? { type: "booking", id: bookingId } : ws(workspace),
    });
  }

  /** Everything the UI needs to render a workspace, in one batch. */
  async snapshot(workspace: WorkspaceId): Promise<MatrixSnapshot> {
    const seed = SEED.workspaces.find((w) => w.id === workspace);
    const users = SEED.users;
    const matrix = await this.roles.permissionMatrix(ws(workspace));

    const roles: RoleColumn[] = [];
    for (const role of matrix.roles) {
      const members = await this.roles.listRoleMembers(
        this.ref(workspace, role.name),
      );
      const memberIds = new Set(members.map((m) => m.id));
      roles.push({
        name: role.name,
        label: role.label ?? role.name,
        can: role.can,
        members: users.filter((u) => memberIds.has(u.id)),
        everyone: memberIds.has("*"),
      });
    }
    roles.sort((a, b) => a.label.localeCompare(b.label));

    const tuples = await this.authz.listTuples({});
    return {
      permissions: [...GRANTABLE],
      roles,
      bookings: seed?.bookings ?? [],
      users,
      tuples: tuples.filter(
        (t) =>
          t.object.id === workspace ||
          t.object.id.startsWith(`workspace:${workspace}/`) ||
          t.subject.id.startsWith(`workspace:${workspace}/`) ||
          (seed?.bookings ?? []).some((b) => b.id === t.subject.id),
      ),
    };
  }
}

/** Render an explain() path as a readable, role-aware chain of steps. */
export function describeExplain(result: ExplainResult): string[] {
  if (!result.allowed || !result.via) return ["No granting path — denied."];
  const steps: string[] = [];
  const friendlyRel = (r: string) =>
    r.startsWith("cap_")
      ? `grants "${r.slice(4)}"`
      : r === "assignee"
        ? "assigned to role"
        : r === "parent"
          ? "belongs to"
          : r;
  const walk = (node: ExplainNode) => {
    switch (node.kind) {
      case "direct":
        steps.push(`directly ${friendlyRel(node.relation)}`);
        break;
      case "wildcard":
        steps.push(`everyone ${friendlyRel(node.relation)}`);
        break;
      case "field":
        steps.push(`on field of ${node.base.type}:${node.base.id}`);
        walk(node.via);
        break;
      case "group":
        steps.push(
          node.relation === "assignee"
            ? `is assigned role ${node.through.id}`
            : `is member of ${node.through.type}:${node.through.id}`,
        );
        walk(node.via);
        break;
      case "hierarchy":
        steps.push(`via parent ${node.parent.type}:${node.parent.id}`);
        walk(node.via);
        break;
    }
  };
  walk(result.via);
  return steps;
}
