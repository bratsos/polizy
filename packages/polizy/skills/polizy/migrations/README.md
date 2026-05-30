---
name: polizy-upgrade-router
description: Use when the user wants to upgrade the `polizy` authorization library in their project. Detects the installed version and the previous version, then loads and applies the relevant migration guides in order — walking step by step (0.1→0.2→0.3→…) up to the newest version available.
---

# polizy upgrade router

This skill activates when a user says things like:

- "upgrade my project to the latest polizy version"
- "I just bumped polizy, walk me through the migration"
- "what do I need to change after upgrading polizy?"
- "get me from polizy 0.1 to the newest version"

The router's job is to figure out **which migration guides to apply, in order**,
given the version delta — and to apply them **step by step** even across several
releases (e.g. `0.2.0 → 0.5.0` applies `0.2→0.3`, then `0.3→0.4`, then
`0.4→0.5`). The user should already have run their package manager's upgrade
command before invoking this; if not, run it for them (see "Package manager
reference" below).

## How multi-version upgrades work (why this is future-proof)

Every published `polizy` release bundles the **complete** `migrations/` history
inside the npm package. So once the user upgrades to the newest version, the
installed package contains every `migrate-X.Y-to-A.B.md` from the beginning up to
that version. The router:

1. Reads the **previously installed** version (what they were on).
2. Reads the **now-installed** version (what they upgraded to — the newest they
   could resolve).
3. Loads every migration guide whose step lies in `(previous, installed]` and
   applies them in ascending order.

This works for any gap and any future release: a user on `0.2.0` upgrading to a
future `1.0.0` will have `migrate-0.2-to-0.3`, `0.3-to-0.4`, … `0.9-to-1.0`
bundled in the `1.0.0` package, and the router walks them in sequence.

## Step 0 — Detect the project layout

Figure out the **package manager** and whether it's a **monorepo** first.

### Package manager — check in this order

| Signal | Manager |
|---|---|
| `pnpm-lock.yaml` exists | pnpm |
| `bun.lockb` or `bun.lock` exists | bun |
| `yarn.lock` + `.yarnrc.yml` exists | yarn berry (v2+, may use PnP — no node_modules) |
| `yarn.lock`, no `.yarnrc.yml` | yarn classic (v1) |
| `package-lock.json` exists | npm |
| none | ask; default to npm |

```bash
ls pnpm-lock.yaml bun.lockb bun.lock yarn.lock package-lock.json .yarnrc.yml 2>/dev/null
```

### Monorepo detection

```bash
cat pnpm-workspace.yaml 2>/dev/null
grep -A 5 '"workspaces"' package.json 2>/dev/null
ls turbo.json nx.json 2>/dev/null
```

If it's a monorepo, run `grep -rl '"polizy"' --include=package.json` from the
root to find every workspace that depends on `polizy`. **Code** migrations apply
to each; the **Prisma schema** migration (the `@@unique` in 0.1→0.2) runs once,
in whichever workspace owns the database.

## Step 1 — Detect the currently installed version

The `version` field in the installed `package.json` is authoritative — not the
range (`^0.2.0`) declared in the project's `package.json`.

```bash
# pnpm (add --filter <ws> in a workspace)
pnpm list polizy --depth 0 --json
# npm
npm list polizy --depth 0 --json
# yarn classic
yarn list --pattern polizy --depth 0
# yarn berry (PnP-safe)
yarn info polizy --json | head -5
# bun
bun pm ls | grep ' polizy@'
```

Fallback — read it directly:

```bash
cat node_modules/polizy/package.json | grep '"version"'
# pnpm strict / non-hoisted, or a workspace:
cat packages/<ws>/node_modules/polizy/package.json | grep '"version"'
# yarn berry PnP (no node_modules):
yarn info polizy | grep version
```

If you can't find it, ask the user to run their install command (table at the
bottom), then retry.

## Step 2 — Detect the previous version

Try these in order.

### Strategy 1 — Git diff on the lockfile (preferred)

```bash
git log -p -- pnpm-lock.yaml   | grep -B1 -A2 "polizy@"  | head -30   # pnpm
git log -p -- package-lock.json| grep -B1 -A2 '"polizy"' | head -30   # npm
git log -p -- yarn.lock        | grep -B1 -A2 'polizy@'  | head -30   # yarn
git log -p -- bun.lock         | grep -B1 -A2 'polizy@'  | head -30   # bun (text lockfile)
# bun.lockb is binary — use Strategy 2
```

The most recent commit touching the dep shows `-` (previous) and `+` (new).

### Strategy 2 — Diff the project's `package.json`

```bash
git log -p -- package.json | grep '"polizy"' | head -10
git log -p -- 'packages/*/package.json' | grep '"polizy"' | head -10   # monorepo
```

### Strategy 3 — Uncommitted working tree

```bash
git diff HEAD -- pnpm-lock.yaml package-lock.json yarn.lock bun.lock package.json
```

### Strategy 4 — Ask

"Before the upgrade, what version of `polizy` were you on?" Quote the installed
version (Step 1) to anchor the question. The first shipped migration guide is
`migrate-0.2-to-0.3.md`; if the previous version is `0.2.x` or earlier there is
nothing before it (the `0.1.x`→`0.2.0` step had no breaking API changes) — review
the README/changelog for anything specific.

## Step 3 — List available migrations

Look in the installed package's bundled skill directory:

```
node_modules/polizy/skills/polizy/migrations/
```

Files are named `migrate-X.Y-to-A.B.md`. If the package didn't ship a
`migrations/` dir (very old build), fall back to the repo on GitHub:
`https://github.com/bratsos/polizy/tree/main/skills/polizy/migrations`.

```bash
ls node_modules/polizy/skills/polizy/migrations/ 2>/dev/null
```

## Step 4 — Build the ordered migration chain

Given previous = `P` and installed = `I`, select every `migrate-X.Y-to-A.B.md`
whose **source** `X.Y >= P` and **target** `A.B <= I`, sorted ascending by source
version, and apply them in that order. Example for `0.2.0 → 0.4.0`:

1. `migrate-0.2-to-0.3.md`
2. `migrate-0.3-to-0.4.md`

**Patch releases** (e.g. `0.2.1 → 0.2.3`) have no guide — they ship no breaking
changes. If the user reports breaking behavior on a patch bump, check the
changelog. Treat the `X.Y` minor as the migration unit.

## Step 5 — Walk through each migration, in order

For each guide, oldest first:

1. Read the full migration doc.
2. Do every item under **Required actions** — these are non-optional (breaking
   API/default changes, schema migrations).
3. If it includes a **Prisma schema migration** (0.2→0.3 adds the `@@unique`),
   apply it once in the DB-owning workspace — confirm before running
   `prisma migrate dev` / `prisma db push`, and dedupe rows first if needed.
4. Apply code changes — usually grep + edit. Use the repo root in a monorepo:
   ```bash
   grep -rln "polizy" --include='*.ts' --include='*.tsx' --include='*.js' \
     packages/ apps/ src/ 2>/dev/null
   ```
5. Note **Behavior / bug fixes** — not breaking, but verify them against your app
   (e.g. revocation no longer over-deletes; depth now throws).
6. Note **Deprecations** — still work now, plan to address before they're removed.
7. Run the project's tests/typecheck after each step (or at least at the end).

Apply guides strictly in sequence — a later guide assumes the earlier ones ran.

## Step 6 — Final check

```bash
# typecheck
pnpm typecheck || npm run typecheck || npx tsc --noEmit
# tests
pnpm test || npm test || yarn test || bun test
```

Surface any **Behavior / bug fixes** sections from the guides you applied so the
user knows what to re-verify in their app.

## Package manager reference — upgrade commands

If the user hasn't upgraded yet, run it for them, then re-run Step 1:

| Manager | Upgrade to latest |
|---|---|
| pnpm | `pnpm update polizy --latest` |
| npm | `npm install polizy@latest` |
| yarn classic | `yarn upgrade polizy --latest` |
| yarn berry | `yarn up polizy` |
| bun | `bun update polizy --latest` |

In a monorepo, the upgrade usually updates all workspaces at once for
pnpm/yarn/npm; for bun, re-run Step 1 per workspace to confirm.

## Convention for writing new migration docs

Each `migrate-X.Y-to-A.B.md` uses this structure:

```markdown
# Migrating from X.Y to A.B

## Summary
One paragraph: what changed and why.

## Required actions
Non-optional steps: breaking API/default changes, schema migrations.

## New features
Available but optional to adopt.

## Behavior / bug fixes
Behavior changes to verify. Not breaking, but worth knowing.

## Deprecations
Still works in this version; removed in a later one.

## Quick checklist
Tick-box recap of the required actions.
```

## Maintainer note

When publishing a new minor/major version of `polizy`:

1. Write `skills/polizy/migrations/migrate-PREV-to-CURRENT.md` **before** tagging.
2. Bump `metadata.version` in `skills/polizy/SKILL.md` to the new version.
3. Keep `"skills"` in the package's `files` array and keep the **full**
   `migrations/` history in the published package — consumers need every step to
   walk multi-version upgrades.
4. Update this router only if the detection/chaining convention itself changes.
