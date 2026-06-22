/**
 * Headless polizy scale benchmark. Boots an in-memory PGlite, generates a large
 * dataset, and runs the benchmark suite — the same code the browser UI runs.
 *
 *   pnpm bench            # medium (~35k tuples)
 *   pnpm bench small      # ~7k
 *   pnpm bench large      # ~80k  (adds the broad-list bottleneck case)
 */
import {
  bootDb,
  countTuples,
  generate,
  handlesFor,
  makeAuthz,
  type Scale,
} from "../src/authz/db.ts";
import { type BenchResult, runSuite } from "../src/bench.ts";

const scale = (process.argv[2] as Scale) || "medium";

function fmt(n: number, digits = 2): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function table(results: BenchResult[]): void {
  const nameW = Math.max(...results.map((r) => r.name.length), 12) + 2;
  const head =
    "BENCHMARK".padEnd(nameW) +
    "avg ms".padStart(10) +
    "p50".padStart(9) +
    "p95".padStart(9) +
    "ops/sec".padStart(12) +
    "  result";
  console.log(head);
  console.log("-".repeat(head.length));
  for (const r of results) {
    console.log(
      r.name.padEnd(nameW) +
        fmt(r.avgMs).padStart(10) +
        fmt(r.p50).padStart(9) +
        fmt(r.p95).padStart(9) +
        (r.opsPerSec ? fmt(r.opsPerSec, 0) : "—").padStart(12) +
        "  " +
        (r.resultSize !== undefined ? `${r.resultSize} objs` : r.detail || ""),
    );
  }
}

async function main() {
  console.log(`\npolizy scale benchmark · scale = ${scale}`);
  const t0 = performance.now();
  const db = await bootDb();
  console.log("Generating dataset…");
  const total = await generate(db, scale);
  console.log(
    `Seeded ${total.toLocaleString()} tuples in ${fmt((performance.now() - t0) / 1000)}s.\n`,
  );

  const mode = (process.argv[3] as "throw" | "deny") || "deny";
  console.log(`maxDepthBehavior = ${mode}\n`);
  const authz = makeAuthz(db, mode);
  const handles = handlesFor(scale);

  const results = await runSuite(authz, handles, {
    // The broad-list bottleneck case is demonstrated at "small"; skip it for the
    // larger scales (it grows with the reachable set and would dominate the run).
    includeBroad: scale === "small",
    onStep: (name) => process.stdout.write(`  running ${name}…\r`),
  });
  process.stdout.write(`${" ".repeat(60)}\r`);

  table(results);
  console.log(
    `\nTotal tuples in DB: ${(await countTuples(db)).toLocaleString()}`,
  );
  console.log(
    "Takeaway: single check() stays ~constant regardless of table size;",
  );
  console.log(
    "list operations scale with the reachable set, not the tuple count.\n",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
