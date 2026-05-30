/**
 * polizy self-benchmark.
 *
 * Measures two things for a set of representative authorization workloads:
 *   - storage reads: how many findTuples/findSubjects/findObjects the engine
 *     issues for one operation (counted via a proxy adapter). This is the
 *     adapter-independent signal for the read-batching / memo work.
 *   - wall-clock: median ms over warmed-up iterations, using a plain
 *     InMemoryStorageAdapter.
 *
 * It benchmarks ONLY the current package (no npm/network), so it is safe to run
 * in CI or locally. To compare against a published release, install it
 * elsewhere and point a second import at it — see bench/README.md.
 *
 *   pnpm bench                 # all workloads, table
 *   pnpm bench --json          # machine-readable
 *   pnpm bench --workload=explain-deny
 *   pnpm bench --quick         # fewer/ smaller sizes (CI smoke)
 */
import { performance } from "node:perf_hooks";
import { InMemoryStorageAdapter } from "../src/polizy.in-memory.storage.ts";
import type { StorageAdapter } from "../src/polizy.storage.ts";
import { AuthSystem } from "../src/polizy.ts";
import {
  type AnyObject,
  defineSchema,
  everyone,
  type InputTuple,
  type Subject,
} from "../src/types.ts";

// --- tiny deterministic PRNG (so runs are reproducible) ---------------------
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// --- a storage adapter that counts read calls -------------------------------
class CountingAdapter<S extends string, O extends string>
  implements StorageAdapter<S, O>
{
  reads = 0;
  private readonly inner: StorageAdapter<S, O>;
  constructor(inner: StorageAdapter<S, O>) {
    this.inner = inner;
  }
  write: StorageAdapter<S, O>["write"] = (t) => this.inner.write(t);
  delete: StorageAdapter<S, O>["delete"] = (f) => this.inner.delete(f);
  findTuples: StorageAdapter<S, O>["findTuples"] = (f, o) => {
    this.reads++;
    return this.inner.findTuples(f, o);
  };
  findSubjects: StorageAdapter<S, O>["findSubjects"] = (a, b, c) => {
    this.reads++;
    return this.inner.findSubjects(a, b, c);
  };
  findObjects: StorageAdapter<S, O>["findObjects"] = (a, b, c) => {
    this.reads++;
    return this.inner.findObjects(a, b, c);
  };
}

type Sub = "user" | "team";
type Obj = "document" | "folder" | "team";
type Tuple = InputTuple<Sub, Obj>;
type Check = {
  who: Subject<Sub> | AnyObject<Obj>;
  canThey: string;
  onWhat: AnyObject<Obj>;
};

const schema = defineSchema({
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
    manage: ["owner"],
  },
  hierarchyPropagation: { view: ["view"], edit: ["edit"] },
});

const U = (id: string): Subject<Sub> => ({ type: "user", id });
const D = (id: string): AnyObject<Obj> => ({ type: "document", id });
const F = (id: string): AnyObject<Obj> => ({ type: "folder", id });
const T = (id: string): AnyObject<Obj> => ({ type: "team", id });
const ACTIONS = ["view", "edit", "delete", "share", "manage"];

// --- workloads --------------------------------------------------------------
// Each builds the SAME tuple list deterministically and returns the operation
// to benchmark. `op` runs against a freshly-built AuthSystem.

type Workload = {
  tuples: Tuple[];
  /** What to measure. */
  op: (authz: AuthSystem<typeof schema>) => Promise<unknown>;
};

function pageLoad(docs: number): Workload {
  // alice views a folder of `docs` documents (hierarchy inheritance), plus a
  // few directly-granted and team-granted docs. The op renders her permissions.
  const tuples: Tuple[] = [
    { subject: U("alice"), relation: "viewer", object: F("root") },
  ];
  for (let i = 0; i < docs; i++) {
    tuples.push({ subject: D(`d${i}`), relation: "parent", object: F("root") });
  }
  return {
    tuples,
    op: (authz) =>
      authz.listAccessibleObjects({ who: U("alice"), ofType: "document" }),
  };
}

function checkMany(n: number): Workload {
  // n documents in a folder alice owns; check `view` on each (a list endpoint).
  const tuples: Tuple[] = [
    { subject: U("alice"), relation: "owner", object: F("root") },
  ];
  const checks: Check[] = [];
  for (let i = 0; i < n; i++) {
    tuples.push({ subject: D(`d${i}`), relation: "parent", object: F("root") });
    checks.push({ who: U("alice"), canThey: "view", onWhat: D(`d${i}`) });
  }
  return { tuples, op: (authz) => authz.checkMany(checks) };
}

function listSubjects(users: number): Workload {
  // `users` people reach doc:secret: some directly, most via a team that views
  // the parent folder. listSubjects expands all of them.
  const tuples: Tuple[] = [
    { subject: D("secret"), relation: "parent", object: F("root") },
    { subject: T("eng"), relation: "viewer", object: F("root") },
  ];
  for (let i = 0; i < users; i++) {
    tuples.push({ subject: U(`u${i}`), relation: "member", object: T("eng") });
  }
  return {
    tuples,
    op: (authz) => authz.listSubjects({ canThey: "view", onWhat: D("secret") }),
  };
}

function nestedGroups(depth: number): Workload {
  // alice ∈ g0 ∈ g1 ∈ ... ∈ g(depth-1), and the top group owns doc:x.
  const tuples: Tuple[] = [
    { subject: U("alice"), relation: "member", object: T("g0") },
  ];
  for (let i = 0; i < depth - 1; i++) {
    tuples.push({
      subject: T(`g${i}`),
      relation: "member",
      object: T(`g${i + 1}`),
    });
  }
  tuples.push({
    subject: T(`g${depth - 1}`),
    relation: "owner",
    object: D("x"),
  });
  return {
    tuples,
    op: (authz) =>
      authz.check({ who: U("alice"), canThey: "edit", onWhat: D("x") }),
  };
}

function deepHierarchy(depth: number): Workload {
  // doc:x is `depth` folders deep; alice owns the top folder.
  const tuples: Tuple[] = [
    { subject: U("alice"), relation: "owner", object: F(`f${depth - 1}`) },
    { subject: D("x"), relation: "parent", object: F("f0") },
  ];
  for (let i = 0; i < depth - 1; i++) {
    tuples.push({
      subject: F(`f${i}`),
      relation: "parent",
      object: F(`f${i + 1}`),
    });
  }
  return {
    tuples,
    op: (authz) =>
      authz.check({ who: U("alice"), canThey: "view", onWhat: D("x") }),
  };
}

function explainDeny(depth: number): Workload {
  // A layered diamond: each layer has 2 teams, fully cross-connected to the next
  // (2^depth distinct membership paths over 2*depth nodes). No one grants doc:x,
  // so explain must walk the whole DAG to return "denied". The stable-negative
  // memo keeps this polynomial.
  const tuples: Tuple[] = [];
  for (let layer = 0; layer < depth; layer++) {
    for (let a = 0; a < 2; a++) {
      const node = T(`L${layer}_${a}`);
      if (layer === 0) {
        tuples.push({ subject: U("alice"), relation: "member", object: node });
      } else {
        for (let b = 0; b < 2; b++) {
          tuples.push({
            subject: T(`L${layer - 1}_${b}`),
            relation: "member",
            object: node,
          });
        }
      }
    }
  }
  return {
    tuples,
    op: (authz) =>
      authz.explain({ who: U("alice"), canThey: "view", onWhat: D("x") }),
  };
}

const WORKLOADS: Record<string, { label: string; build: () => Workload }[]> = {
  "page-load": [
    { label: "10 docs", build: () => pageLoad(10) },
    { label: "100 docs", build: () => pageLoad(100) },
    { label: "500 docs", build: () => pageLoad(500) },
  ],
  "check-many": [
    { label: "50", build: () => checkMany(50) },
    { label: "500", build: () => checkMany(500) },
    { label: "2000", build: () => checkMany(2000) },
  ],
  "list-subjects": [
    { label: "50 users", build: () => listSubjects(50) },
    { label: "500 users", build: () => listSubjects(500) },
  ],
  "nested-groups": [
    { label: "depth 5", build: () => nestedGroups(5) },
    { label: "depth 15", build: () => nestedGroups(15) },
  ],
  "deep-hierarchy": [
    { label: "depth 5", build: () => deepHierarchy(5) },
    { label: "depth 15", build: () => deepHierarchy(15) },
  ],
  "explain-deny": [
    { label: "depth 6", build: () => explainDeny(6) },
    { label: "depth 10", build: () => explainDeny(10) },
    { label: "depth 14", build: () => explainDeny(14) },
  ],
};

// --- measurement ------------------------------------------------------------
async function seed(
  storage: StorageAdapter<Sub, Obj>,
  tuples: Tuple[],
): Promise<AuthSystem<typeof schema>> {
  const authz = new AuthSystem({ schema, storage, maxDepthBehavior: "deny" });
  await storage.write(tuples);
  return authz;
}

async function measureReads(w: Workload): Promise<number> {
  const counter = new CountingAdapter(new InMemoryStorageAdapter<Sub, Obj>());
  const authz = await seed(counter, w.tuples);
  counter.reads = 0; // exclude seeding
  await w.op(authz);
  return counter.reads;
}

async function measureMs(w: Workload, iters: number): Promise<number> {
  const authz = await seed(new InMemoryStorageAdapter<Sub, Obj>(), w.tuples);
  for (let i = 0; i < Math.min(20, iters); i++) await w.op(authz); // warmup
  const samples: number[] = [];
  for (let i = 0; i < iters; i++) {
    if (globalThis.gc) globalThis.gc();
    const t0 = performance.now();
    await w.op(authz);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const quick = args.includes("--quick");
  const only = args.find((a) => a.startsWith("--workload="))?.split("=")[1];

  const results: Array<{
    workload: string;
    size: string;
    reads: number;
    ms: number;
  }> = [];

  for (const [name, sizes] of Object.entries(WORKLOADS)) {
    if (only && only !== name) continue;
    const cases = quick ? sizes.slice(0, 1) : sizes;
    for (const { label, build } of cases) {
      const reads = await measureReads(build());
      const slow = reads > 5000 || name === "explain-deny";
      const ms = quick ? 0 : await measureMs(build(), slow ? 15 : 50);
      results.push({ workload: name, size: label, reads, ms });
    }
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return;
  }

  process.stdout.write("\npolizy self-benchmark (current package)\n");
  process.stdout.write(
    `${"workload".padEnd(16)}${"size".padEnd(12)}${"reads".padStart(8)}${"median ms".padStart(12)}\n`,
  );
  process.stdout.write(`${"-".repeat(48)}\n`);
  for (const r of results) {
    const ms = quick ? "-" : r.ms.toFixed(3);
    process.stdout.write(
      `${r.workload.padEnd(16)}${r.size.padEnd(12)}${String(r.reads).padStart(8)}${ms.padStart(12)}\n`,
    );
  }
  process.stdout.write(
    "\nreads = storage round-trips for one operation (lower is better).\n" +
      "Run `node --expose-gc` for steadier ms. See bench/README.md.\n",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
