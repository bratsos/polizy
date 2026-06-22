/**
 * Headless walkthrough of polizy's runtime-roles feature — the same logic that
 * backs the UI, printed to the terminal. Run with: `pnpm demo`.
 */

import { type Action, PERMISSION_LABELS } from "../src/authz/schema.ts";
import { AuthStore, describeExplain } from "../src/authz/store.ts";

const CHECK = "✓";
const DASH = "—";

function printMatrix(
  title: string,
  permissions: Action[],
  roles: { label: string; can: Set<Action> }[],
) {
  const rowLabelW =
    Math.max(...permissions.map((p) => PERMISSION_LABELS[p].length)) + 2;
  const colW = Math.max(10, ...roles.map((r) => r.label.length + 2));
  const header =
    "".padEnd(rowLabelW) + roles.map((r) => r.label.padStart(colW)).join("");
  console.log(`\n${title}`);
  console.log(header);
  console.log("-".repeat(header.length));
  for (const p of permissions) {
    const cells = roles
      .map((r) => (r.can.has(p) ? CHECK : DASH).padStart(colW))
      .join("");
    console.log(PERMISSION_LABELS[p].padEnd(rowLabelW) + cells);
  }
}

async function main() {
  // In-memory PGlite (no dataDir) — the same code path the browser app runs,
  // just without IndexedDB persistence.
  const store = await AuthStore.boot();

  // 1. The seeded Acme matrix (mirrors the reference UI).
  let acme = await store.snapshot("acme");
  printMatrix("Acme Tours · seeded roles", acme.permissions, acme.roles);

  // 2. Create a brand-new role AT RUNTIME (no schema change, no redeploy).
  console.log(
    '\n> addRole("acme", "marketing")  + grant view_bookings, manage_pricing',
  );
  await store.addRole("acme", "marketing", "Marketing");
  await store.toggle("acme", "marketing", "view_bookings", true);
  await store.toggle("acme", "marketing", "manage_pricing", true);
  await store.assign("acme", "marketing", "frank");

  acme = await store.snapshot("acme");
  printMatrix(
    "Acme Tours · after adding Marketing",
    acme.permissions,
    acme.roles,
  );

  // 3. Live authorization checks (what the app actually calls to gate actions).
  console.log("\nLive checks:");
  const checks: [string, Action, string?][] = [
    ["alice", "manage_settings"],
    ["bob", "issue_refunds"],
    ["carol", "view_finances"],
    ["frank", "manage_pricing"],
    ["dave", "edit_bookings"],
    ["alice", "view_bookings", "bk-101"], // per-booking via hierarchy
  ];
  for (const [user, action, booking] of checks) {
    const ok = await store.check("acme", user, action, booking);
    const target = booking ? `booking ${booking}` : "workspace";
    console.log(
      `  ${user} can ${action} on ${target}? ${ok ? "ALLOW" : "deny"}`,
    );
  }

  // 4. Explain WHY a role-derived permission resolves.
  const why = await store.explain("acme", "carol", "issue_refunds");
  console.log("\nWhy can carol issue_refunds?");
  for (const step of describeExplain(why)) console.log(`  - ${step}`);

  // 5. Per-tenant divergence: Globex has a completely different role set.
  const globex = await store.snapshot("globex");
  printMatrix(
    "Globex Travel · independent roles",
    globex.permissions,
    globex.roles,
  );
  console.log(
    `\nSame user 'alice' is Admin in Acme but only 'Travel Agent' in Globex:`,
  );
  console.log(
    `  alice manage_settings @ acme = ${await store.check("acme", "alice", "manage_settings")}`,
  );
  console.log(
    `  alice manage_settings @ globex = ${await store.check("globex", "alice", "manage_settings")}`,
  );

  // 6. Wildcard role: the seeded "Guide" role is assigned to everyone().
  const newcomer = await store.check("acme", "newcomer-9999", "view_bookings");
  console.log(
    `\nA brand-new user can view bookings via the everyone-> Guide role: ${newcomer}`,
  );

  // 7. Delete a role and watch access disappear.
  console.log('\n> deleteRole("acme", "marketing")');
  await store.deleteRole("acme", "marketing");
  console.log(
    `  frank manage_pricing after delete = ${await store.check("acme", "frank", "manage_pricing")}`,
  );

  console.log(
    "\nDone. Every change above was pure tuple data on the existing engine.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
