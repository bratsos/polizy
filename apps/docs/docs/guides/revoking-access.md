---
title: Revoking Access
sidebar_position: 9
---

# Revoking Access

In any permission system, removing permissions is just as important as granting them. Whether a user is changing roles, an asset is being deleted, or a user account is being deactivated, you need a safe and clean way to revoke access.

polizy provides target-oriented APIs for removing permission tuples: `disallowAllMatching()` for revoking direct grants, and `removeMember()` and `removeParent()` for modifying group memberships and hierarchies.

This guide walks you through the common scenarios for revoking access.

:::note[Theory & Concepts]

Because polizy only stores positive assertions (grants), revoking access is done by deleting those stored tuples. To understand this design decision, read **[Grants-Only Authorization](../core-concepts/grants-only.md)**.

:::

## 1. Direct Revocation with `disallowAllMatching`

The `disallowAllMatching` method is a powerful utility that cleans up stored direct grants. You can use it in three primary shapes depending on the scope of the revocation.

### Scenario A: Revoking a Specific Grant (Single Tuple)

When a specific user loses a specific role on an object, pass all three parameters: `who`, `was`, and `onWhat`.

```ts
// Revoke Alice's owner permissions on doc1
await authz.disallowAllMatching({
  who: { type: "user", id: "alice" },
  was: "owner",
  onWhat: { type: "document", id: "doc1" },
});
```

### Scenario B: Deleting an Object (Object Cleanup)

When an object is deleted from your system, you want to clean up all authorization rules referencing it to prevent dangling tuples. Pass only the `onWhat` parameter to remove all tuples touching that object.

```ts
// Remove all permissions referencing doc1 (owners, viewers, editors, etc.)
await authz.disallowAllMatching({
  onWhat: { type: "document", id: "doc1" },
});
```

### Scenario C: Deactivating a User (Subject Cleanup)

When a user deactivates their account or is removed from the organization, you can wipe out all of their direct grants across the entire system. Pass only the `who` parameter.

```ts
// Remove all direct permissions granted to Bob
await authz.disallowAllMatching({
  who: { type: "user", id: "bob" },
});
```

---

## 2. Revoking Group Memberships

To remove a subject from a group or team, use `removeMember()`.

```ts
// Remove Carol from the "alpha" team
await authz.removeMember({
  member: { type: "user", id: "carol" },
  group: { type: "team", id: "alpha" },
});
```

:::tip[Multiple Group Relations]

If your schema defines multiple relations between a member and a group, you must pass the `as` parameter to specify which relationship to remove:
```ts
await authz.removeMember({
  member: { type: "user", id: "carol" },
  group: { type: "team", id: "alpha" },
  as: "admin_member",
});
```
If there is only one relation configured between the subject type and the group type, polizy infers it automatically.

:::

---

## 3. Revoking Folder & Resource Hierarchies

To disconnect a resource or folder from a parent hierarchy (for example, when moving a file to another directory), use `removeParent()`.

```ts
// Remove the parent folder relation from doc2
await authz.removeParent({
  child: { type: "document", id: "doc2" },
  parent: { type: "folder", id: "fA" },
});
```

:::tip[Multiple Hierarchy Relations]

Similar to groups, if there are multiple hierarchical relations possible between the child and parent, specify which one to remove using the `as` parameter:
```ts
await authz.removeParent({
  child: { type: "document", id: "doc2" },
  parent: { type: "folder", id: "fA" },
  as: "direct_parent",
});
```

:::

---

## 4. Preventing the In-Flight Revocation Race ("Pin the Path")

If a permission check passes and a concurrent revocation commits before your protected action commits, the action runs on access that no longer exists.

Because polizy is grants-only, access can only disappear when a tuple in the granting path is deleted, its `condition` is changed, or time passes its `validUntil`. You can close this window by pinning the granting path's tuple rows inside the transaction that performs the action:

1. **Bind the adapter to the action transaction**:
   ```ts
   const authz = new AuthSystem({ storage: PrismaAdapter(tx), schema });
   ```
2. **Run `explain` to get the granting path**:
   ```ts
   const { allowed, via } = await authz.explain({ who, canThey, onWhat });
   if (!allowed) throw new Error("forbidden");
   ```
3. **Collect the stored tuple IDs from the path**, skipping any contextual tuples (`ctx:`):
   ```ts
   import type { ExplainNode } from "polizy";
   function pathTupleIds(node?: ExplainNode): string[] {
     if (!node) return [];
     const own = "tuple" in node && !node.tuple.id.startsWith("ctx:") ? [node.tuple.id] : [];
     return "via" in node ? [...own, ...pathTupleIds(node.via)] : own;
   }
   ```
4. **Lock those rows `FOR SHARE`**:
   ```ts
   import { Prisma } from "@prisma/client"; // Prisma 7 with the prisma-client generator: import from your generated client

   const ids = pathTupleIds(via ?? undefined);
   // Empty only when every step came from contextualTuples: nothing to lock.
   const locked = ids.length
     ? await tx.$queryRaw<{ id: string }[]>`
         SELECT id FROM "PolizyTuple" WHERE id IN (${Prisma.join(ids)}) FOR SHARE
       `
     : [];
   ```
   Use the same SQL with any SQL driver. A concurrent `DELETE` (revocation) or `UPDATE` (condition change) on those rows now waits until this transaction ends.

   :::warning[Use `FOR SHARE`, not `FOR KEY SHARE`]

   `FOR KEY SHARE` does not block an `UPDATE` of non-key columns such as `condition`. Always use `FOR SHARE`.

   :::

5. **Re-verify after acquiring the lock**:
   * **Under `READ COMMITTED`**: a revocation or condition change may have committed between step 2 and step 4. A deleted row is omitted from the `SELECT ... FOR SHARE` result, and an updated row is returned with its new condition. Run `explain` again and verify that `allowed` is still `true` and every ID returned by `pathTupleIds` is in the locked set. If not, retry from step 2 (bounded) or deny.
   * **Under `REPEATABLE READ`**: if any pinned row changed after the snapshot started, `FOR SHARE` fails with a serialization error (SQLSTATE `40001`). Retry the transaction.
6. **Perform the action and commit**. Concurrent revocations on the pinned rows proceed after the commit.

### Limits of Pinning

* Only the single path returned by `explain` is pinned. That is sufficient because access holds while that path holds.
* Time-based conditions cannot be locked at the row level. Compare `validUntil` against the action's own timestamp if expiry during the transaction matters.
* Requires a database that supports row-level shared locks (such as PostgreSQL or MySQL). SQLite does not support `FOR SHARE`.
