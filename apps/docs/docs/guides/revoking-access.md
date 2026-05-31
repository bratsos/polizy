---
title: Revoking Access
sidebar_position: 8
---

# Revoking Access

In any permission system, removing permissions is just as important as granting them. Whether a user is changing roles, an asset is being deleted, or a user account is being deactivated, you need a safe and clean way to revoke access.

polizy provides target-oriented APIs for removing permission tuples: `disallowAllMatching()` for revoking direct grants, and `removeMember()` and `removeParent()` for modifying group memberships and hierarchies.

This guide walks you through the common scenarios for revoking access.

:::note Theory & Concepts
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

:::tip Multiple Group Relations
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

:::tip Multiple Hierarchy Relations
Similar to groups, if there are multiple hierarchical relations possible between the child and parent, specify which one to remove using the `as` parameter:
```ts
await authz.removeParent({
  child: { type: "document", id: "doc2" },
  parent: { type: "folder", id: "fA" },
  as: "direct_parent",
});
```
:::
