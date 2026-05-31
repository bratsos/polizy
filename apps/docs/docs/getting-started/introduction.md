---
sidebar_position: 1
title: Introduction
slug: /getting-started/introduction
---

# Introduction

**polizy** is a Zanzibar-inspired authorization library for TypeScript and
Node.js. Instead of scattering `if (user.role === "admin")` checks across your
codebase, you describe _who relates to what_ as data — and ask polizy questions
like "can Alice edit this document?".

## The core idea: relationship tuples

Every permission in polizy is a stored fact called a **tuple**:

```
(subject)        (relation)   (object)
{user: "alice"}   owner        {document: "readme"}
```

Read it as a sentence: _Alice is an **owner** of document readme._ From a small
set of these facts, polizy answers access questions by walking the relationships
between subjects and objects — including indirect ones, like "members of the
team that owns the parent folder."

| Term | Meaning | Example |
| --- | --- | --- |
| **Subject** | Who is acting | `{ type: "user", id: "alice" }` |
| **Object** | What is acted upon | `{ type: "document", id: "readme" }` |
| **Relation** | How they're connected | `owner`, `editor`, `viewer`, `member`, `parent` |
| **Action** | The intent you check | `view`, `edit`, `delete` |

Relations are the facts you store; actions are what you check. A **schema** maps
actions to the relations that satisfy them — e.g. `edit` is allowed for an
`owner` or an `editor`.

## A 60-second example

```typescript
import { defineSchema, AuthSystem, InMemoryStorageAdapter } from "polizy";

const schema = defineSchema({
  relations: {
    owner: { type: "direct" },
    viewer: { type: "direct" },
  },
  actionToRelations: {
    edit: ["owner"],
    view: ["owner", "viewer"],
  },
});

const authz = new AuthSystem({
  storage: new InMemoryStorageAdapter(),
  schema,
});

await authz.allow({
  who: { type: "user", id: "alice" },
  toBe: "owner",
  onWhat: { type: "document", id: "doc1" },
});

await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "edit",
  onWhat: { type: "document", id: "doc1" },
}); // => true
```

## When to reach for polizy

polizy fits when authorization is **relational** rather than a flat list of
roles: teams that grant access to projects, folders whose permissions flow down
to the files inside them, documents shared with specific people, or temporary
access that expires. If you've found yourself reinventing this logic with ad-hoc
database joins, polizy gives you a single, queryable model instead.

## Where to next

- **[Installation](./installation.md)** — add polizy to your project and pick a storage adapter.
- **[Quickstart](./quickstart.md)** — build a working permission check end to end.
- **[Core Concepts](../core-concepts/overview.md)** — tuples, relations vs. actions, and how a check is resolved.
