---
title: Stability and versioning
sidebar_position: 4
---

# Stability and versioning

polizy follows semantic versioning.

## Before 1.0

Before `1.0.0`, minor releases (for example, `0.6` to `0.7`) may contain breaking changes. Each breaking change is listed in the changelog and covered by a migration guide, shipped in the npm package under `skills/polizy/migrations/`.

Patch releases fix bugs and do not change the public API.

## After 1.0

Starting at `1.0.0`, breaking changes are introduced only in major releases.

## What is part of the public API

The following surfaces are covered by the versioning guarantees:

* Everything exported from `polizy`, `polizy/prisma-storage`, and `polizy/storage-tests`.
* The `StorageAdapter` contract as checked by the shared test suite.
* Documented behavior.

## `explain()` guarantees

`ExplainNode` kinds and their fields are part of the public API:

* New fields may be added in a minor release (for example, `0.7.0` adds `tuple`).
* Existing node kinds and fields are not removed or renamed in a patch release.
* When multiple paths grant access, the path reported by `explain()` is deterministic for the same tuples and version, but which path is chosen may change between minor releases. Do not persist the chosen path as a contract.

## Storage adapter guarantees

Which adapter methods the engine calls and which filter shapes it passes to `findTuples` may change in a minor release. Any adapter that passes the shared test suite (`defineStorageAdapterTestSuite`) for that release continues to work. New tests may be added to the shared suite in minor releases.
