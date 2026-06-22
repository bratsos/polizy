---
title: Guides
sidebar_position: 1
---

# Guides

Learn how to model common authorization patterns in your application using polizy. These guides provide task-oriented instructions and copy-pasteable examples for everything from simple team permissions to complex, attribute-based access control.

## Relationship-Modeling How-Tos

- **[Team & Group Access](./team-access.md)** — Model team-level permissions, manage memberships, and handle nested group structures.
- **[Runtime Custom Roles](./runtime-roles.md)** — Let end users define their own roles in-app (a permissions matrix) with no schema change, while keeping the action vocabulary type-safe.
- **[Folder Inheritance](./folder-inheritance.md)** — Propagate access controls down nested document structures and folders.
- **[Temporary Access](./temporary-access.md)** — Grant time-bound permissions that automatically become active or expire.
- **[Attribute Conditions (ABAC)](./attribute-conditions.md)** — Combine relationships with dynamic attributes like department or IP address.
- **[Field-Level Permissions](./field-level-permissions.md)** — Restrict access to specific fields or columns on your resources.
- **[Public Access](./public-access.md)** — Make resources available to all users or specific user types.
- **[Revoking Access](./revoking-access.md)** — Safely remove permissions and clean up relationship tuples.
- **[Listing & Debugging](./listing-and-debugging.md)** — Check who has access, audit queries, and explain authorization decisions.
- **[Read Your Writes](./read-your-writes.md)** — Handle cache consistency and transaction boundaries for immediate permission updates.
- **[Framework Integration](./framework-integration.md)** — Plug polizy into web frameworks, APIs, and middleware.

:::tip[Need the basics first?]

If you are new to polizy, we recommend checking out **[Core Concepts](../core-concepts/overview.md)** and the **[Quickstart](../getting-started/quickstart.md)** to get comfortable with subjects, relations, and objects.

:::
