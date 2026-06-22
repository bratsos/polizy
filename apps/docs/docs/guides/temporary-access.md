---
title: Temporary Access
sidebar_position: 5
---

# Temporary Access

Sometimes you need to grant permissions that are short-lived. For example, a customer support agent might need access to a user's account for one hour, or a contractor might have access to a repository until their contract ends.

This guide shows you how to grant time-boxed permissions using `validSince` and `validUntil`, and explains the database uniqueness rules you must follow.

:::note[How Checks Resolve]

To learn how polizy evaluates conditions during a permission check, check out the **[How Checks Resolve](../core-concepts/how-checks-resolve.md)** guide.

:::

## The Coexistence Rule: Use Distinct Relations

In polizy, database tuples are **idempotent** on the `(subject, relation, object)` triple. 

If you grant a user `viewer` access to a document unconditionally, and then try to grant them a temporary `viewer` access to the same document, the new grant will **overwrite** the standing one instead of creating a second record.

To allow both standing and temporary access to coexist, you must model them as **distinct relations** in your schema.

### 1. Configure the schema

Define separate relations for standing and temporary access, and map them to the same action:

```ts
import { defineSchema } from "polizy";

const schema = defineSchema({
  subjectTypes: ["user"],
  objectTypes: ["document"],

  relations: {
    viewer: { type: "direct" },       // For standing (permanent) access
    temp_viewer: { type: "direct" },  // For temporary access
  },

  actionToRelations: {
    // Both standing and temporary viewers can perform the "view" action
    view: ["viewer", "temp_viewer"],
  },
});
```

---

## 2. Grant temporary access

Use the `when` parameter to specify when a grant is active. You can set a start time with `validSince`, an expiration time with `validUntil`, or both.

```ts
import { AuthSystem, InMemoryStorageAdapter } from "polizy";

const authz = new AuthSystem({
  storage: new InMemoryStorageAdapter(),
  schema,
});

const document = { type: "document", id: "confidential-plan" };
const user = { type: "user", id: "bob" };

// Grant access that expires in 1 hour
await authz.allow({
  who: user,
  toBe: "temp_viewer",
  onWhat: document,
  when: {
    validUntil: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
  },
});

// Grant access that starts tomorrow and lasts for 2 days
await authz.allow({
  who: user,
  toBe: "temp_viewer",
  onWhat: document,
  when: {
    validSince: new Date(Date.now() + 24 * 60 * 60 * 1000), // Starts in 24h
    validUntil: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // Ends in 3 days
  },
});
```

---

## 3. Check access

When you call `check`, polizy automatically evaluates the system's current time against the `validSince` and `validUntil` constraints.

```ts
const canView = await authz.check({
  who: user,
  canThey: "view",
  onWhat: document,
});

console.log(canView); 
// Returns true if the current time is within the granted window, false otherwise.
```

:::warning[Timezone and Server Time]

Polizy uses the local system time of the application server running the code to evaluate `validSince` and `validUntil`. Ensure your application servers have their clocks synchronized (e.g., via NTP).

:::
