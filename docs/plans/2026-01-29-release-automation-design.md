# Release Automation Design

## Overview

Set up automated release infrastructure for the Polizy npm package using GitHub Actions and Changesets.

## Goals

- Automate version bumping and changelog generation
- Run CI (lint, typecheck, test, build) on every PR
- Publish to npm automatically when releases are triggered
- Maintain developer control over release timing

## Architecture

```
PR opened/updated
       │
       ▼
┌─────────────────────────┐
│   CI Workflow (ci.yml)  │
│  • pnpm install         │
│  • biome check          │
│  • tsc --noEmit         │
│  • pnpm test            │
│  • pnpm build           │
└─────────────────────────┘
       │
       ▼
PR merged to main
       │
       ▼
┌─────────────────────────┐
│ Release Workflow        │
│ (release.yml)           │
│  • Changesets action    │
│  • Creates/updates      │
│    "Version Packages"   │
│    PR with changelog    │
└─────────────────────────┘
       │
       ▼
Version PR merged
       │
       ▼
┌─────────────────────────┐
│ Publish to npm          │
│  • pnpm build           │
│  • npm publish          │
│  • Git tag created      │
└─────────────────────────┘
```

## Files to Create

### 1. `.github/workflows/ci.yml`

CI workflow that runs on PRs and pushes to main:

- Checkout code
- Setup pnpm with caching
- Setup Node.js 22
- Install dependencies (frozen-lockfile)
- Run Biome linting
- Run TypeScript type-checking
- Run tests (in-memory storage)
- Run build

### 2. `.github/workflows/release.yml`

Release workflow using changesets/action:

- Triggers on push to main
- If changesets exist: creates/updates "Version Packages" PR
- If version was bumped: builds and publishes to npm
- Creates git tags automatically

### 3. `.changeset/config.json`

Changesets configuration:

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

### 4. Root `package.json` scripts

Add convenience scripts:

```json
"changeset": "changeset",
"version": "changeset version",
"release": "pnpm build && changeset publish"
```

## Developer Workflow

1. Create a branch and make changes
2. Run `pnpm changeset` to create a changeset file
3. Answer prompts (major/minor/patch, description)
4. Commit changeset file with the PR
5. PR triggers CI workflow
6. Merge PR to main
7. Release workflow creates "Version Packages" PR
8. Review and merge Version PR to publish

## Manual Setup Required

1. **NPM Token**: Generate at npmjs.com (Access Tokens → Classic Token → Automation type)
2. **GitHub Secret**: Add `NPM_TOKEN` to repo Settings → Secrets → Actions
3. **npm access**: Ensure account has publish rights to `polizy` package

## Dependencies to Install

```bash
pnpm add -Dw @changesets/cli @changesets/changelog-github
```
