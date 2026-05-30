# polizy benchmark

A small, self-contained benchmark for the authorization engine. It runs entirely
against the current package — no network, no published install — so it's safe in
CI and reproducible.

```bash
pnpm bench                      # all workloads, table
pnpm bench -- --json            # machine-readable
pnpm bench -- --workload=explain-deny
pnpm bench -- --quick           # one small size per workload (fast smoke)
```

(With pnpm, flags after the script name need `--`, e.g. `pnpm bench -- --json`.)

## What it measures

For each workload it reports two numbers:

- **reads** — storage round-trips (`findTuples` + `findSubjects` + `findObjects`)
  for one operation, counted via a proxy adapter. This is the
  adapter-independent signal for the read-batching and memoization work: it
  doesn't depend on machine speed, so it's the stable number to watch and to
  guard against regressions. (Lower is better.)
- **median ms** — wall-clock median over warmed-up iterations against a plain
  `InMemoryStorageAdapter`. Run with `node --expose-gc` (the `pnpm bench` script
  already does) for steadier numbers. Treat these as indicative, not precise —
  small/sub-millisecond cases are noise-dominated.

## Workloads

| workload | what it exercises |
|---|---|
| `page-load` | `listAccessibleObjects` over a folder of N documents (hierarchy inheritance) |
| `check-many` | `checkMany` over N documents in a folder (a list endpoint) |
| `list-subjects` | reverse expansion of N users reaching a doc via a team |
| `nested-groups` | a single `check` through a deep transitive group chain |
| `deep-hierarchy` | a single `check` through a deep parent chain |
| `explain-deny` | `explain` on a deny answer in a diamond group graph (2^depth paths) — shows the stable-negative memo keeping reads polynomial (`~2·depth+4`) where a naive walk is exponential |

## Comparing against a published release

This harness benchmarks only the current tree. To compare against a release,
install it in a scratch directory and import both into a script:

```bash
mkdir /tmp/polizy-cmp && cd /tmp/polizy-cmp && npm i polizy@latest
# then import { AuthSystem } from "polizy" (published) and from the local
# packages/polizy/dist alongside, feeding both the same tuples.
```

The read counts are directly comparable across versions; wall-clock should use
each version's own `InMemoryStorageAdapter`.
