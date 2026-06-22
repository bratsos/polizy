import type { PGlite } from "@electric-sql/pglite";
import type { RoleCatalogRecord, RoleCatalogStore } from "polizy";

/**
 * A polizy RoleCatalogStore backed by PGlite — the same in-browser-Postgres trick
 * as the tuple adapter, applied to the role catalog. This is the SQL analogue of
 * the bundled `PrismaRoleCatalog`, so empty roles stay listable and persist
 * across refreshes. The polizy engine never reads this table; it only tracks role
 * existence + labels for the UI.
 */

export const POLIZY_ROLE_DDL = `
  CREATE TABLE IF NOT EXISTS polizy_role (
    tenant  TEXT NOT NULL,
    key     TEXT NOT NULL,
    label   TEXT,
    actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    PRIMARY KEY (tenant, key)
  );
`;

type Row = {
  tenant: string;
  key: string;
  label: string | null;
  actions: unknown;
};

function reviveActions(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((a): a is string => typeof a === "string");
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((a): a is string => typeof a === "string")
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toRecord(r: Row): RoleCatalogRecord {
  return {
    tenant: r.tenant,
    key: r.key,
    label: r.label ?? undefined,
    actions: reviveActions(r.actions),
  };
}

export function createPGliteRoleCatalog(db: PGlite): RoleCatalogStore {
  return {
    async upsert(record: RoleCatalogRecord): Promise<void> {
      await db.query(
        `INSERT INTO polizy_role (tenant, key, label, actions)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (tenant, key)
         DO UPDATE SET label = EXCLUDED.label, actions = EXCLUDED.actions`,
        [
          record.tenant,
          record.key,
          record.label ?? null,
          JSON.stringify(record.actions),
        ],
      );
    },

    async remove(tenant: string, key: string): Promise<void> {
      await db.query("DELETE FROM polizy_role WHERE tenant = $1 AND key = $2", [
        tenant,
        key,
      ]);
    },

    async get(tenant: string, key: string): Promise<RoleCatalogRecord | null> {
      const { rows } = await db.query<Row>(
        "SELECT * FROM polizy_role WHERE tenant = $1 AND key = $2",
        [tenant, key],
      );
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async list(tenant: string): Promise<RoleCatalogRecord[]> {
      const { rows } = await db.query<Row>(
        "SELECT * FROM polizy_role WHERE tenant = $1 ORDER BY key",
        [tenant],
      );
      return rows.map(toRecord);
    },
  };
}
