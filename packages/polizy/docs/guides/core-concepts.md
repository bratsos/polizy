# Core Concepts

Understanding these concepts is essential for designing effective authorization systems with Polizy.

## The Tuple Model

Polizy uses a **relationship-based** authorization model. Every permission is stored as a **tuple**:

```
(subject, relation, object)
```

For example:
- `(user:alice, owner, document:doc1)` - Alice is owner of doc1
- `(team:engineering, viewer, project:alpha)` - Engineering team can view project alpha
- `(user:bob, member, team:engineering)` - Bob is a member of engineering team

### Why Tuples?

Tuples are powerful because they:
1. **Separate data from logic** - The schema defines rules, tuples store facts
2. **Enable auditing** - You can see exactly who has what access
3. **Support revocation** - Remove a tuple, remove the access
4. **Allow inheritance** - Through groups and hierarchies

## Relations

Relations define the types of connections between subjects and objects. There are three types:

### Direct Relations

Direct relations are simple subject-to-object permissions:

```typescript
relations: {
  owner: { type: "direct" },
  editor: { type: "direct" },
  viewer: { type: "direct" }
}
```

Use direct relations when:
- A specific user needs access to a specific resource
- The permission doesn't need to be inherited

### Group Relations

Group relations define membership in groups:

```typescript
relations: {
  member: { type: "group" }
}
```

When a subject is a member of a group, they inherit all permissions granted to that group.

```
user:alice --member--> team:engineering --editor--> document:doc1
```

Alice can edit doc1 because:
1. Alice is a member of engineering team
2. Engineering team is editor on doc1
3. Editor relation grants edit action

**Groups can be nested:**

```
user:alice --member--> team:frontend --member--> team:engineering
```

Alice inherits permissions from both frontend and engineering teams.

### Hierarchy Relations

Hierarchy relations define parent-child relationships for permission propagation:

```typescript
relations: {
  parent: { type: "hierarchy" }
},
hierarchyPropagation: {
  view: ["view"],   // view on parent => view on child
  edit: ["edit"]    // edit on parent => edit on child
}
```

Example:
```
document:doc1 --parent--> folder:folder1

user:bob --viewer--> folder:folder1
```

Bob can view doc1 because:
1. doc1's parent is folder1
2. Bob is viewer on folder1
3. Schema says view propagates from parent to child

## Actions

Actions are what users want to do: `view`, `edit`, `delete`, `share`, etc.

Actions are **not stored in tuples**. Instead, the schema maps actions to relations:

```typescript
actionToRelations: {
  delete: ["owner"],
  edit: ["owner", "editor"],
  view: ["owner", "editor", "viewer"]
}
```

This means:
- To delete, you need `owner` relation
- To edit, you need `owner` OR `editor` relation
- To view, you need `owner` OR `editor` OR `viewer` relation

### Why Separate Actions from Relations?

1. **Semantic clarity** - Actions describe intent, relations describe roles
2. **Flexibility** - Change what "editor" can do without touching data
3. **Least privilege** - Grant the minimal relation needed

## Subjects and Objects

### Subjects

A subject is "who" in the tuple. It can be:
- A user: `{ type: "user", id: "alice" }`
- A group: `{ type: "team", id: "engineering" }`
- Any entity: `{ type: "service", id: "api-gateway" }`

### Objects

An object is "what" in the tuple. It can be:
- A document: `{ type: "document", id: "doc123" }`
- A folder: `{ type: "folder", id: "folder456" }`
- A field: `{ type: "document", id: "doc123#salary" }` (field-level)
- Any resource: `{ type: "api-endpoint", id: "/users" }`

## Conditions (Time-Based Access)

Tuples can have time-based conditions:

```typescript
await authz.allow({
  who: { type: "user", id: "contractor" },
  toBe: "editor",
  onWhat: { type: "project", id: "project1" },
  when: {
    validSince: new Date("2024-01-01"),
    validUntil: new Date("2024-03-31")
  }
});
```

The permission is only valid within the specified time range.

Use cases:
- Temporary access for contractors
- Project-based permissions with deadlines
- Trial access periods
- Scheduled permission changes

## The Check Algorithm

When you call `authz.check()`, Polizy evaluates:

1. **Direct check**: Does the subject have a required relation on the object?
2. **Field fallback**: If object is `doc1#field`, also check `doc1`
3. **Group expansion**: Is the subject in any groups? Check each group recursively
4. **Hierarchy traversal**: Does the object have parents? Check permissions on parents

```
check(alice, edit, doc1)
  │
  ├── Direct: Does alice have owner/editor on doc1? No
  │
  ├── Groups: Is alice in any groups?
  │   └── alice is member of team:engineering
  │       └── Does engineering have owner/editor on doc1? Yes! ✓
  │
  └── Hierarchy: Does doc1 have a parent?
      └── doc1's parent is folder1
          └── Does alice have owner/editor on folder1? (check recursively)
```

The check stops as soon as it finds a valid path (returns `true`).

## Depth Limits

To prevent infinite loops (circular group memberships), Polizy has a depth limit:

```typescript
const authz = new AuthSystem({
  storage,
  schema,
  defaultCheckDepth: 10  // Default, can be customized
});
```

If the check exceeds this depth, it returns `false` (or throws if `throwOnMaxDepth: true`).

## Next Steps

- **[Patterns](./patterns.md)** - Best practices for authorization design
- **[Anti-Patterns](./anti-patterns.md)** - Common mistakes to avoid
- **[Advanced Usage](./advanced-usage.md)** - Field-level permissions, optimization
