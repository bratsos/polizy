---
title: Troubleshooting
sidebar_position: 1
---

# Troubleshooting

If polizy isn't behaving as you expect, don't worry. This guide covers the most common gotchas, error messages, and configuration issues you might encounter.

:::tip[First Step: Use `explain()`]

When a permission check returns an unexpected result, your first tool should always be the `explain()` API. It traces the exact evaluation path polizy took to compute its decision:

```ts
const explanation = await authz.explain({
  who: { type: "user", id: "alice" },
  canThey: "edit",
  onWhat: { type: "document", id: "doc1" }
});

console.log(explanation);
// Traces the graph path or shows why evaluation stopped
```
For details on interpreting traces, see [Listing & Debugging](../guides/listing-and-debugging.md).

:::

---

## check() returns false but I expected true

* **Symptom:** A check returns `false` when you believe the subject should have access.
* **Cause:** The permission grant (relationship tuple) might be missing, or your schema does not map the checked action to the relation you granted.
* **Fix:** 
  1. Call `explain()` to trace the evaluation path and see where it breaks.
  2. Verify that your schema's `actionToRelations` mapping associates the action (e.g., `edit`) with the relation you granted (e.g., `owner`).
  3. Query your storage backend or use `listTuples()` to confirm the relationship tuple actually exists in the database.

For more information, see [Listing & Debugging](../guides/listing-and-debugging.md).

---

## MaxDepthExceededError thrown

* **Symptom:** A check fails and throws a `MaxDepthExceededError`.
* **Cause:** The evaluation traversed a chain of group memberships or parent-child hierarchies deeper than `defaultCheckDepth` (which defaults to 20), or encountered a cycle in your relationships (e.g., Team A is a member of Team B, and Team B is a member of Team A).
* **Fix:**
  * If your nested hierarchy is legitimately deeper than 20 levels, raise `defaultCheckDepth` in your `AuthSystem` configuration:
    ```ts
    const authz = new AuthSystem({
      storage,
      schema,
      defaultCheckDepth: 30, // Increase depth limit
    });
    ```
  * If you want checks to fail silently with `false` instead of throwing an error when the depth limit is reached, set `maxDepthBehavior: "deny"`:
    ```ts
    const authz = new AuthSystem({
      storage,
      schema,
      maxDepthBehavior: "deny", // Returns false instead of throwing MaxDepthExceededError
    });
    ```
  * Check your relationship graph for cyclic memberships and break the cycle.

For more information, see [How Checks Resolve](../core-concepts/how-checks-resolve.md).

---

## SchemaError at startup

* **Symptom:** The application throws a `SchemaError` when calling `defineSchema` at startup.
* **Cause:** A dangling reference in your schema configuration. This occurs when:
  * An action in `actionToRelations` maps to a relation that is not defined in `relations`.
  * A rule in `hierarchyPropagation` references an action that is not defined in `actionToRelations`.
* **Fix:** Check your schema definition and ensure that every referenced relation and action is explicitly defined.
  ```ts
  // Incorrect: "editor" is mapped to "writer", but "writer" is not defined
  const schema = defineSchema({
    relations: {
      owner: { type: "direct" }
    },
    actionToRelations: {
      edit: ["writer"] // SchemaError!
    }
  });
  ```

---

## Prisma grants duplicate / upserts fail

* **Symptom:** Duplicate relationship tuples appear in your database, or upsert writes fail with unique constraint violations.
* **Cause:** The database is missing the compound unique constraint on the tuple table. Without this constraint, the database cannot safely deduplicate writes.
* **Fix:** Add the required `@@unique` block to your Prisma model:
  1. Open your `schema.prisma` file and add the constraint to the model representing your tuples:
     ```prisma
     model Tuple {
       subjectType String
       subjectId   String
       relation    String
       objectType  String
       objectId    String

       @@unique([subjectType, subjectId, relation, objectType, objectId])
     }
     ```
  2. Run `prisma generate` to update the client.
  3. Run `prisma migrate dev` to apply the unique constraint to your database.

For more information, see [Prisma Storage Adapter](../storage/prisma.md).

---

## An id containing '#' didn't behave as expected

* **Symptom:** You use an object ID containing a `#` (e.g., `document:doc1#summary`) but permissions from the base object (`doc1`) do not flow to the field, or the ID is treated as a literal string.
* **Cause:** Starting in version 0.3.0, field splitting is opt-in for safety. IDs containing `#` are treated as literal strings unless the object type is explicitly listed in `fieldLevelObjects`.
* **Fix:** Add the object type to the `fieldLevelObjects` array in your `AuthSystem` configuration:
  ```ts
  const authz = new AuthSystem({
    storage,
    schema,
    fieldLevelObjects: ["document"], // Opt-in to enable splitting for this type
  });
  ```

For more information, see [Field-Level Permissions](../guides/field-level-permissions.md).

---

## addMember/setParent throws about ambiguous relation

* **Symptom:** Calling helper methods like `addMember`, `removeMember`, `setParent`, or `removeParent` throws an error.
* **Cause:** The helper cannot infer which relation to use because your schema defines multiple group or hierarchy relations.
* **Fix:** Explicitly specify the relation name using the `as` option. Inference only works when there is exactly one group or hierarchy relation in the schema:
  ```ts
  // If your schema defines both "member" and "admin_member" relations
  await authz.addMember(user, group, { as: "member" });
  ```

---

## No warnings/logs appear

* **Symptom:** The console remains completely silent when warnings or potential system configuration errors occur.
* **Cause:** By default, polizy suppresses all logs to keep your application output clean.
* **Fix:** Pass a logger (e.g., `console` or a custom logger object) to the `AuthSystem` options:
  ```ts
  const authz = new AuthSystem({
    storage,
    schema,
    logger: console, // Enables warnings and debug logs
  });
  ```

---

## consistency: 'strong' seems ignored

* **Symptom:** You request a check with `{ consistency: "strong" }` but reads do not feel consistent, or isolated snapshots are not used.
* **Cause:** The storage adapter in use does not support snapshot reads (it does not implement `withSnapshot`). polizy transparently falls back to live reads when the adapter cannot serve a snapshot.
* **Fix:**
  * Ensure you are using a storage adapter that implements `withSnapshot` (such as `InMemoryStorageAdapter` or `PrismaStorageAdapter`).
  * If using `PrismaStorageAdapter`, pass `snapshotIsolationLevel: "RepeatableRead"` to support isolation (e.g., when running Postgres MVCC).

For more information, see [Consistency](../performance/consistency.md).
