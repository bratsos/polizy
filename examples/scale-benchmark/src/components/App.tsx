import type { PGlite } from "@electric-sql/pglite";
import { useEffect, useMemo, useState } from "react";
import {
  countTuples,
  generate,
  handlesFor,
  makeAuthz,
  PRESETS,
  type Scale,
} from "../authz/db.ts";
import { type BenchResult, runSuite } from "../bench.ts";
import { Badge, Button, Card, CardHeader, IconPlus } from "./ui.tsx";

const SCALES: { id: Scale; label: string }[] = [
  { id: "small", label: "Small" },
  { id: "medium", label: "Medium" },
  { id: "large", label: "Large" },
];

/** Approx tuple count for a preset, for the label before generating. */
function approxTuples(s: Scale): string {
  const p = PRESETS[s];
  const n =
    p.folders +
    p.docs * 1.3 +
    p.users +
    p.teams * 2 +
    p.deptDocs +
    p.deptMembers;
  return `~${Math.round(n / 1000)}k tuples`;
}

function msColor(ms: number): string {
  if (ms < 5) return "text-emerald-600";
  if (ms < 100) return "text-slate-700";
  if (ms < 1000) return "text-amber-600";
  return "text-rose-600";
}

function num(n: number, digits = 2): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function App({ db }: { db: PGlite }) {
  // Both modes use the output-linear list paths (reverse expansion + single-pass
  // derivation); "deny" bounds at the depth cap, "throw" raises past it. We use
  // "deny" here so a pathological dataset never aborts the run.
  const authz = useMemo(() => makeAuthz(db, "deny"), [db]);
  const [scale, setScale] = useState<Scale>("medium");
  const [tupleCount, setTupleCount] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [includeBroad, setIncludeBroad] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<BenchResult[]>([]);

  useEffect(() => {
    countTuples(db).then(setTupleCount);
  }, [db]);

  const yieldToPaint = () => new Promise((r) => setTimeout(r, 0));

  const onGenerate = async () => {
    setGenerating(true);
    setResults([]);
    setProgress(0);
    await yieldToPaint();
    const total = await generate(db, scale, (done, totl) => {
      setProgress(done / totl);
    });
    setTupleCount(total);
    setGenerating(false);
  };

  const onRun = async () => {
    setResults([]);
    setRunning("starting…");
    await yieldToPaint();
    const res = await runSuite(authz, handlesFor(scale), {
      includeBroad,
      onStep: (name) => setRunning(name),
    });
    setRunning(null);
    setResults(res);
  };

  const busy = generating || running !== null;
  const hasData = (tupleCount ?? 0) > 0;

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
      <header className="mb-8 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white shadow-sm shadow-indigo-600/30">
          p
        </div>
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight text-slate-900">
            polizy · scale benchmark
          </h1>
          <p className="text-[13px] text-slate-500">
            Tens of thousands of tuples in a real Postgres in your browser
            (PGlite). See where the engine bends.
          </p>
        </div>
      </header>

      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Dataset"
            subtitle="A docs / folders / teams graph: direct grants, nested groups, deep hierarchy"
            action={
              <Badge tone={hasData ? "indigo" : "slate"}>
                {tupleCount === null
                  ? "…"
                  : `${tupleCount.toLocaleString()} tuples`}
              </Badge>
            }
          />
          <div className="flex flex-wrap items-center gap-3 px-6 pb-6">
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
              {SCALES.map((s) => {
                const active = s.id === scale;
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={busy}
                    onClick={() => setScale(s.id)}
                    className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-40 ${
                      active
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {s.label}
                    <span
                      className={`ml-1.5 text-[11px] ${active ? "text-indigo-100" : "text-slate-400"}`}
                    >
                      {approxTuples(s.id)}
                    </span>
                  </button>
                );
              })}
            </div>
            <Button variant="primary" disabled={busy} onClick={onGenerate}>
              <IconPlus className="h-3.5 w-3.5" />
              {generating ? "Generating…" : "Generate dataset"}
            </Button>
            {generating && (
              <div className="h-1.5 w-40 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Benchmarks"
            subtitle="Each op runs warm, over the generated graph; lower latency is better"
            action={
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-[12px] text-slate-500">
                  <input
                    type="checkbox"
                    checked={includeBroad}
                    disabled={busy}
                    onChange={(e) => setIncludeBroad(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                  />
                  include broad-list (slow)
                </label>
                <Button
                  variant="primary"
                  disabled={busy || !hasData}
                  onClick={onRun}
                >
                  {running ? "Running…" : "Run benchmarks"}
                </Button>
              </div>
            }
          />
          <div className="px-6 pb-6">
            {!hasData && (
              <p className="py-6 text-center text-[13px] text-slate-400">
                Generate a dataset first.
              </p>
            )}
            {hasData && running && (
              <p className="py-6 text-center text-[13px] text-slate-500">
                <span className="mr-2 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-500 align-[-2px]" />
                running <span className="font-medium">{running}</span>…
              </p>
            )}
            {hasData && !running && results.length === 0 && (
              <p className="py-6 text-center text-[13px] text-slate-400">
                Run the benchmarks to see latencies.
              </p>
            )}
            {results.length > 0 && (
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="px-2 py-2 text-left">Operation</th>
                    <th className="px-2 py-2 text-right">avg ms</th>
                    <th className="px-2 py-2 text-right">p50</th>
                    <th className="px-2 py-2 text-right">p95</th>
                    <th className="px-2 py-2 text-right">ops/sec</th>
                    <th className="px-2 py-2 text-right">result</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {results.map((r) => (
                    <tr key={r.name} className="border-b border-slate-50">
                      <td className="px-2 py-2 font-sans">
                        <div className="font-medium text-slate-800">
                          {r.name}
                        </div>
                        {r.detail && (
                          <div className="text-[11px] text-slate-400">
                            {r.detail}
                          </div>
                        )}
                      </td>
                      <td
                        className={`px-2 py-2 text-right font-semibold ${msColor(r.avgMs)}`}
                      >
                        {num(r.avgMs)}
                      </td>
                      <td className="px-2 py-2 text-right text-slate-500">
                        {num(r.p50)}
                      </td>
                      <td className="px-2 py-2 text-right text-slate-500">
                        {num(r.p95)}
                      </td>
                      <td className="px-2 py-2 text-right text-slate-600">
                        {r.opsPerSec ? num(r.opsPerSec, 0) : "—"}
                      </td>
                      <td className="px-2 py-2 text-right text-slate-600">
                        {r.resultSize !== undefined
                          ? `${r.resultSize.toLocaleString()} objs`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        <Card>
          <div className="px-6 py-5 text-[13px] leading-relaxed text-slate-600">
            <p className="mb-1 font-semibold text-slate-800">
              What to look for
            </p>
            <ul className="list-inside list-disc space-y-1">
              <li>
                <span className="font-medium">check()</span> stays ~constant (a
                few ms) as the dataset grows — it touches only the query's
                subgraph, not the whole table.
              </li>
              <li>
                <span className="font-medium">checkMany()</span> beats N
                separate checks by sharing one read pass.
              </li>
              <li>
                <span className="font-medium">listSubjects</span> /{" "}
                <span className="font-medium">listAccessibleObjects</span> are
                now near-linear and sub-second even at 83k tuples — reverse
                expansion / single-pass derivation (both depth modes) compute
                the answer directly instead of a check per candidate, and the
                adapter indexes both read paths.
              </li>
              <li>
                <span className="font-medium">readScope + preload</span> loads
                the whole tuple set up front — useful for remote/slow stores;
                with a properly indexed local store the direct path is already
                fast.
              </li>
            </ul>
          </div>
        </Card>

        <footer className="pt-2 text-center text-[12px] text-slate-400">
          Powered by <span className="font-medium text-slate-500">polizy</span>{" "}
          over PGlite (Postgres in WASM), running entirely in your browser —
          in-memory, so latencies reflect the engine, not IndexedDB I/O.
        </footer>
      </div>
    </div>
  );
}
