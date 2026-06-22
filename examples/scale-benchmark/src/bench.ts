import type { Authz, Handles } from "./authz/db.ts";

export interface BenchResult {
  name: string;
  detail?: string;
  iterations: number;
  avgMs: number;
  p50: number;
  p95: number;
  /** Operations per second (for throughput benchmarks). */
  opsPerSec?: number;
  /** Size of the returned set (for list operations). */
  resultSize?: number;
  /** "fast" (single ops) | "batch" | "list" — for grouping/coloring. */
  kind: "single" | "batch" | "list";
}

function summarize(
  name: string,
  samples: number[],
  kind: BenchResult["kind"],
  extra?: { detail?: string; opsPerSec?: number; resultSize?: number },
): BenchResult {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const total = samples.reduce((s, x) => s + x, 0);
  return {
    name,
    kind,
    iterations: samples.length,
    avgMs: total / samples.length,
    p50: at(0.5),
    p95: at(0.95),
    ...extra,
  };
}

/** Run `fn` `iterations` times (after one warmup), collecting per-call latency. */
async function measure(fn: () => Promise<unknown>, iterations: number) {
  await fn(); // warm any one-time costs
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  return samples;
}

/** Time a whole batch `iterations` times; report per-batch latency + ops/sec. */
async function measureBatch(
  run: () => Promise<unknown>,
  batchSize: number,
  iterations: number,
) {
  const samples = await measure(run, iterations);
  const avgMs = samples.reduce((s, x) => s + x, 0) / samples.length;
  return { samples, opsPerSec: batchSize / (avgMs / 1000) };
}

export async function runSuite(
  authz: Authz,
  handles: Handles,
  opts?: { includeBroad?: boolean; onStep?: (name: string) => void },
): Promise<BenchResult[]> {
  const out: BenchResult[] = [];
  const step = async (
    name: string,
    fn: () => Promise<BenchResult>,
  ): Promise<void> => {
    opts?.onStep?.(name);
    out.push(await fn());
  };
  const K = handles.batch.length;

  await step("check · allow", async () => {
    const s = await measure(() => authz.check(handles.checkAllow), 300);
    return summarize("check · allow", s, "single", {
      detail: "member → team → folder hierarchy",
      opsPerSec: 1000 / (mean(s) || 1),
    });
  });

  await step("check · deny", async () => {
    const s = await measure(() => authz.check(handles.checkDeny), 100);
    return summarize("check · deny", s, "single", {
      detail: "fail-closed full exploration",
      opsPerSec: 1000 / (mean(s) || 1),
    });
  });

  await step(`batch ×${K} · individual check()`, async () => {
    const { samples, opsPerSec } = await measureBatch(
      () => Promise.all(handles.batch.map((r) => authz.check(r))),
      K,
      5,
    );
    return summarize(`batch ×${K} · individual check()`, samples, "batch", {
      detail: "no shared reads",
      opsPerSec,
      resultSize: K,
    });
  });

  await step(`batch ×${K} · checkMany()`, async () => {
    const { samples, opsPerSec } = await measureBatch(
      () => authz.checkMany(handles.batch),
      K,
      5,
    );
    return summarize(`batch ×${K} · checkMany()`, samples, "batch", {
      detail: "one shared reader",
      opsPerSec,
      resultSize: K,
    });
  });

  await step(`batch ×${K} · readScope + preload`, async () => {
    const { samples, opsPerSec } = await measureBatch(
      () =>
        authz.withReadScope((scope) => scope.checkMany(handles.batch), {
          preload: true,
        }),
      K,
      5,
    );
    return summarize(`batch ×${K} · readScope + preload`, samples, "batch", {
      detail: "single up-front read pass",
      opsPerSec,
      resultSize: K,
    });
  });

  await step("listAccessibleObjects · bounded user", async () => {
    let size = 0;
    const s = await measure(async () => {
      const r = await authz.listAccessibleObjects({
        who: handles.listUser,
        ofType: "document",
      });
      size = r.accessible.length;
    }, 5);
    return summarize("listAccessibleObjects · bounded user", s, "list", {
      detail: "auditor (department team only)",
      resultSize: size,
    });
  });

  await step("listAccessibleObjects · preload scope", async () => {
    let size = 0;
    const s = await measure(async () => {
      const r = await authz.withReadScope(
        (scope) =>
          scope.listAccessibleObjects({
            who: handles.listUser,
            ofType: "document",
          }),
        { preload: true },
      );
      size = r.accessible.length;
    }, 5);
    return summarize("listAccessibleObjects · preload scope", s, "list", {
      detail: "one up-front read pass — the recommended mode at scale",
      resultSize: size,
    });
  });

  await step("listSubjects · popular doc", async () => {
    let size = 0;
    const s = await measure(async () => {
      const subs = await authz.listSubjects({
        canThey: "view",
        onWhat: handles.listDoc,
      });
      size = subs.length;
    }, 5);
    return summarize("listSubjects · popular doc", s, "list", {
      detail: "reverse expansion over team members",
      resultSize: size,
    });
  });

  await step("listSubjects · preload scope", async () => {
    let size = 0;
    const s = await measure(async () => {
      const subs = await authz.withReadScope(
        (scope) =>
          scope.listSubjects({ canThey: "view", onWhat: handles.listDoc }),
        { preload: true },
      );
      size = subs.length;
    }, 5);
    return summarize("listSubjects · preload scope", s, "list", {
      detail: "one up-front read pass — the recommended mode at scale",
      resultSize: size,
    });
  });

  await step("explain · allow", async () => {
    const s = await measure(() => authz.explain(handles.checkAllow), 50);
    return summarize("explain · allow", s, "single", {
      detail: "granting path",
      opsPerSec: 1000 / (mean(s) || 1),
    });
  });

  if (opts?.includeBroad) {
    await step("listAccessibleObjects · BROAD user", async () => {
      let size = 0;
      const s = await measure(async () => {
        const r = await authz.listAccessibleObjects({
          who: handles.broadUser,
          ofType: "document",
        });
        size = r.accessible.length;
      }, 2);
      return summarize("listAccessibleObjects · BROAD user", s, "list", {
        detail: "user-0 reaches the whole tree — the bottleneck",
        resultSize: size,
      });
    });
  }

  return out;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}
