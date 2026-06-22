---
title: Public Access
sidebar_position: 6
---

# Public Access

Sometimes you want to make a resource public to every user in your system—like a public roadmap, documentation article, or landing page. Instead of writing custom logic bypasses or adding permissions for every single user, you can use polizy's wildcard subject.

This guide shows you how to grant access to all subjects of a specific type.

:::note[Grants-Only Model]

Polizy is a grants-only system. For details on how authorization flows exclusively through positive permissions, see **[Grants-Only System](../core-concepts/grants-only.md)**.

:::

## 1. Import the `everyone` helper

Polizy provides an `everyone` helper function to represent a wildcard subject.

```ts
import { everyone } from "polizy";
```

## 2. Grant public access to a resource

Pass `everyone("subjectType")` as the `who` argument in your call to `allow`. This tells polizy that *any* subject of that specific type is granted the relation.

```ts
import { AuthSystem, InMemoryStorageAdapter, defineSchema } from "polizy";

const schema = defineSchema({
  subjectTypes: ["user"],
  objectTypes: ["document"],
  relations: {
    viewer: { type: "direct" },
  },
  actionToRelations: {
    view: ["viewer"],
  },
});

const authz = new AuthSystem({
  storage: new InMemoryStorageAdapter(),
  schema,
});

// Make "public-roadmap" viewable by every "user"
await authz.allow({
  who: everyone("user"),
  toBe: "viewer",
  onWhat: { type: "document", id: "public-roadmap" },
});
```

## 3. Verify access

Now, when you check access for *any* subject with type `"user"`, the check will return `true` regardless of their ID or other memberships.

```ts
// Checking access for a completely new user
const canView = await authz.check({
  who: { type: "user", id: "some-new-user-id" },
  canThey: "view",
  onWhat: { type: "document", id: "public-roadmap" },
});

console.log(canView); // true
```

:::warning[Subject Type Constraint]

`everyone("user")` only matches subjects whose type is exactly `"user"`. If you have other subject types in your schema (e.g., `client` or `partner`), they will not match this wildcard unless you also grant access to `everyone("client")` or `everyone("partner")`.

:::
