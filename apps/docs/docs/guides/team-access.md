---
title: Team & Group Access
sidebar_position: 2
---

# Team & Group Access

Managing access for individual users can quickly become overwhelming. Instead of assigning permissions user-by-user, you can group users into teams, departments, or roles, and grant permissions to the entire group.

This guide shows you how to define a group relation, add users to groups, and check if members inherit access.

:::note Theory & Concepts
To learn more about how subjects, objects, and relationships work under the hood, read the **[Relations and Actions](../core-concepts/relations-and-actions.md)** guide.
:::

## 1. Configure the schema

To support groups, your schema must include at least one relation with `type: "group"`. This relation tells polizy that a subject is a member of another subject (which acts as a group).

```ts
import { defineSchema } from "polizy";

const schema = defineSchema({
  subjectTypes: ["user", "team"],
  objectTypes: ["document", "team"],

  relations: {
    // Declares that subjects can belong to teams
    member: { type: "group" },
    
    // Standard direct relations
    owner: { type: "direct" },
    viewer: { type: "direct" },
  },

  actionToRelations: {
    view: ["viewer", "owner", "member"],
    edit: ["owner"],
  },
});
```

For more options, check out the **[Schema Reference](../schema/schema-reference.md)**.

## 2. Add members to a group

Use `addMember` to add a user (or another subject) to a group.

```ts
import { AuthSystem, InMemoryStorageAdapter } from "polizy";

const authz = new AuthSystem({
  storage: new InMemoryStorageAdapter(),
  schema,
});

// Add Alice to the engineering team
await authz.addMember({
  member: { type: "user", id: "alice" },
  group: { type: "team", id: "engineering" },
});
```

## 3. Grant access to the group

In polizy, groups are subjects. You can grant access to a group using `allow`, just like you would for an individual user:

```ts
await authz.allow({
  who: { type: "team", id: "engineering" },
  toBe: "viewer",
  onWhat: { type: "document", id: "design-doc" },
});
```

## 4. Check inherited access

When you run `check` for a user, polizy automatically traverses group memberships to see if they inherit the permission:

```ts
const canView = await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "view",
  onWhat: { type: "document", id: "design-doc" },
});

console.log(canView); // true (inherited through engineering team membership)
```

## 5. Remove members from a group

When a user leaves the group, use `removeMember` to revoke their membership. They will immediately lose all inherited permissions:

```ts
await authz.removeMember({
  member: { type: "user", id: "alice" },
  group: { type: "team", id: "engineering" },
});

const canViewAfterLeaving = await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "view",
  onWhat: { type: "document", id: "design-doc" },
});

console.log(canViewAfterLeaving); // false
```

---

## Advanced Scenarios

### Nested groups (teams within teams)

Polizy automatically traverses nested memberships. If the `frontend` team is a member of the `engineering` team, members of `frontend` will inherit anything granted to `engineering`:

```ts
// Add frontend team as a member of the engineering team
await authz.addMember({
  member: { type: "team", id: "frontend" },
  group: { type: "team", id: "engineering" },
});

// Add Bob to the frontend team
await authz.addMember({
  member: { type: "user", id: "bob" },
  group: { type: "team", id: "frontend" },
});

// Bob inherits viewer access on the design-doc granted to engineering
const bobCanView = await authz.check({
  who: { type: "user", id: "bob" },
  canThey: "view",
  onWhat: { type: "document", id: "design-doc" },
});

console.log(bobCanView); // true
```

### Multiple group relations (using the `as` parameter)

If your schema defines more than one group relation (for example, `member` and `manager`), you must explicitly specify which relation to use with the `as` parameter:

```ts
// Schema with multiple group relations
const multiGroupSchema = defineSchema({
  subjectTypes: ["user", "team"],
  objectTypes: ["document", "team"],
  relations: {
    member: { type: "group" },
    manager: { type: "group" },
  },
  actionToRelations: {
    view: ["member", "manager"],
  }
});

// ... instantiate authz ...

// Specify "as" because the system cannot infer which relation to use
await authz.addMember({
  member: { type: "user", id: "alice" },
  group: { type: "team", id: "engineering" },
  as: "manager",
});

// The same requirement applies when removing a member
await authz.removeMember({
  member: { type: "user", id: "alice" },
  group: { type: "team", id: "engineering" },
  as: "manager",
});
```

:::warning Inference Behavior
The `as` parameter is optional and inferred automatically **only** when there is exactly one `group` relation defined in your schema.
:::
