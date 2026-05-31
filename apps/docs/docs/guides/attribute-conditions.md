---
title: Attribute Conditions (ABAC)
sidebar_position: 6
---

# Attribute Conditions (ABAC)

Sometimes relationship-based access control (ReBAC) isn't enough on its own. You might want to restrict access based on dynamic runtime context, such as a user's subscription tier, their IP address range, their department, or the current time. 

polizy supports **Attribute-Based Access Control (ABAC)** by letting you attach conditional predicates to your grants.

This guide shows you how to define attribute conditions on your grants and pass context during checks.

:::note[Theory & Concepts]

To learn more about how polizy evaluates permissions and conditions, check out the **[How Checks Resolve](../core-concepts/how-checks-resolve.md)** page.

:::

## 1. Granting Access with Attributes

You can attach attribute requirements to a grant using the `when.attributes` block inside `allow()`. 

```ts
import { AuthSystem, InMemoryStorageAdapter } from "polizy";

// ... initialize authz with your schema ...

await authz.allow({
  who: { type: "user", id: "alice" },
  toBe: "viewer",
  onWhat: { type: "document", id: "doc1" },
  when: {
    attributes: [
      {
        attribute: "user.tier",
        operator: "eq",
        value: "premium",
      },
    ],
  },
});
```

---

## 2. Checking Access with Context

When checking permissions for a conditional grant, you must pass the matching runtime data inside the `context` object.

```ts
const canView = await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "view",
  onWhat: { type: "document", id: "doc1" },
  // Pass dynamic attributes here
  context: {
    user: {
      tier: "premium",
    },
  },
});

console.log(canView); // true
```

---

## 3. Supported Operators

The `operator` field supports the following comparison operations:

| Operator | Description | Example Condition |
| :--- | :--- | :--- |
| `eq` | Matches if the context value is strictly equal to `value`. | `{ attribute: "status", operator: "eq", value: "active" }` |
| `ne` | Matches if the context value is not equal to `value`. | `{ attribute: "user.role", operator: "ne", value: "guest" }` |
| `in` | Matches if the context value is elements of the array in `value`. | `{ attribute: "department", operator: "in", value: ["engineering", "product"] }` |
| `nin` | Matches if the context value is not in the array in `value`. | `{ attribute: "user.country", operator: "nin", value: ["US", "CA"] }` |
| `gt` | Matches if the context value is greater than `value`. | `{ attribute: "user.age", operator: "gt", value: 18 }` |
| `gte` | Matches if the context value is greater than or equal to `value`. | `{ attribute: "user.score", operator: "gte", value: 100 }` |
| `lt` | Matches if the context value is less than `value`. | `{ attribute: "attempts", operator: "lt", value: 5 }` |
| `lte` | Matches if the context value is less than or equal to `value`. | `{ attribute: "filesize", operator: "lte", value: 1048576 }` |

---

## 4. Nested Paths (Dot-Notation)

The `attribute` path supports dot-notation to access nested properties within the `context` object. 

For example, checking against:
```ts
context: {
  user: {
    profile: {
      department: "marketing"
    }
  }
}
```
Requires this attribute condition:
```ts
{
  attribute: "user.profile.department",
  operator: "eq",
  value: "marketing"
}
```

---

## 5. Fail-Closed Behavior

:::warning[Fail-Closed Security]

If a check evaluates a grant with an attribute condition, but the required value is missing from the `context` parameter or has a mismatched type, **the condition immediately fails** (fail-closed).

:::

For example:
- If a grant requires `user.tier` to be `"premium"`, but your `check()` call only passes `{}` as the context, it will return `false`.
- If a grant requires `user.age` to be `gte: 18` (number), but you pass `{ user: { age: "18" } }` (string), the check will fail.

Always ensure the `context` properties provided in `check()` match the structures expected by your grants' attribute conditions.

---

## 6. Combining Attributes and Time Windows

You can combine attribute conditions and time-based constraints in the same `when` block. **All conditions must pass** (logical `AND`) for the grant to be authorized.

```ts
await authz.allow({
  who: { type: "user", id: "bob" },
  toBe: "editor",
  onWhat: { type: "document", id: "project-plan" },
  when: {
    // 1. Time-window constraints
    validSince: new Date("2026-06-01T00:00:00Z"),
    validUntil: new Date("2026-06-07T23:59:59Z"),
    
    // 2. Attribute conditions
    attributes: [
      {
        attribute: "user.clearance",
        operator: "eq",
        value: "high",
      },
    ],
  },
});
```

To learn more about time-based settings, see the **[Temporary Access](./temporary-access.md)** guide.
