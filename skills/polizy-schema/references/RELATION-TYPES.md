# Relation Types Deep Dive

Polizy has three relation types, each serving a distinct purpose in your authorization model.

## The Tuple Model

Every permission in polizy is stored as a **tuple**:

```
(subject, relation, object)
```

Examples:
- `(user:alice, owner, document:doc1)` - Alice is owner of doc1
- `(user:bob, member, team:engineering)` - Bob is in engineering team
- `(document:doc1, parent, folder:folder1)` - doc1 is inside folder1

The relation type determines how polizy interprets and traverses these tuples during permission checks.

---

## 1. Direct Relations

**Definition:** A simple, explicit permission from a subject to an object.

```typescript
relations: {
  owner: { type: "direct" },
  editor: { type: "direct" },
  viewer: { type: "direct" },
}
```

### How It Works

When you call:
```typescript
await authz.allow({
  who: { type: "user", id: "alice" },
  toBe: "owner",
  onWhat: { type: "document", id: "doc1" }
});
```

Polizy stores the tuple:
```
(user:alice, owner, document:doc1)
```

When you call:
```typescript
await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "edit",
  onWhat: { type: "document", id: "doc1" }
});
```

Polizy:
1. Looks up `actionToRelations.edit` → `["owner", "editor"]`
2. Checks if alice has `owner` OR `editor` relation on doc1
3. Finds `(user:alice, owner, document:doc1)` → returns `true`

### When to Use Direct Relations

- **Specific user access:** Alice is the owner of this particular document
- **No inheritance needed:** Permission is explicit, not derived
- **Role-based access on specific resources:** Bob is an editor on project X

### Common Direct Relations

| Relation | Typical Actions | Use Case |
|----------|-----------------|----------|
| `owner` | All actions | Creator, full control |
| `editor` | Edit, view | Can modify but not delete |
| `viewer` | View only | Read-only access |
| `commenter` | Comment, view | Can discuss but not edit |
| `admin` | All administrative | System administrators |
| `approver` | Approve, view | Workflow approval |

### Direct Relation Example

```typescript
const schema = defineSchema({
  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
  },
  actionToRelations: {
    delete: ["owner"],
    edit: ["owner", "editor"],
    view: ["owner", "editor", "viewer"],
    share: ["owner"],
  },
});

// Grant permissions
await authz.allow({ who: alice, toBe: "owner", onWhat: doc1 });
await authz.allow({ who: bob, toBe: "editor", onWhat: doc1 });
await authz.allow({ who: charlie, toBe: "viewer", onWhat: doc1 });

// Check permissions
await authz.check({ who: alice, canThey: "delete", onWhat: doc1 });   // true
await authz.check({ who: bob, canThey: "delete", onWhat: doc1 });     // false
await authz.check({ who: bob, canThey: "edit", onWhat: doc1 });       // true
await authz.check({ who: charlie, canThey: "edit", onWhat: doc1 });   // false
await authz.check({ who: charlie, canThey: "view", onWhat: doc1 });   // true
```

---

## 2. Group Relations

**Definition:** Membership in a group that can have permissions. Members inherit all permissions granted to the group.

```typescript
relations: {
  member: { type: "group" },
}
```

### How It Works

When you call:
```typescript
await authz.addMember({
  member: { type: "user", id: "alice" },
  group: { type: "team", id: "engineering" }
});
```

Polizy stores the tuple:
```
(user:alice, member, team:engineering)
```

When you grant permission to the group:
```typescript
await authz.allow({
  who: { type: "team", id: "engineering" },
  toBe: "editor",
  onWhat: { type: "project", id: "project1" }
});
```

Polizy stores:
```
(team:engineering, editor, project:project1)
```

When checking alice's permission:
```typescript
await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "edit",
  onWhat: { type: "project", id: "project1" }
});
```

Polizy:
1. Checks if alice has direct `editor` on project1 → No
2. Checks if alice is `member` of any groups → Yes, `team:engineering`
3. Checks if `team:engineering` has `editor` on project1 → Yes
4. Returns `true`

### Nested Groups

Groups can be members of other groups:

```typescript
// Alice is in frontend team
await authz.addMember({ member: alice, group: frontendTeam });

// Frontend team is part of engineering
await authz.addMember({ member: frontendTeam, group: engineeringDept });

// Engineering has access to the repo
await authz.allow({ who: engineeringDept, toBe: "viewer", onWhat: codeRepo });

// Alice can view the repo (through nested groups)
await authz.check({ who: alice, canThey: "view", onWhat: codeRepo }); // true
```

The traversal path:
```
alice → member → frontendTeam → member → engineeringDept → viewer → codeRepo
```

### When to Use Group Relations

- **Team-based access:** Engineering team can edit all engineering projects
- **Organizational structure:** Department → Team → User
- **Role groups:** All admins, all moderators
- **Bulk permission management:** Add 1 tuple instead of N

### Important: Depth Limits

Polizy has a default depth limit of 10 to prevent infinite loops. If your group nesting is deeper, increase it:

```typescript
const authz = new AuthSystem({
  storage,
  schema,
  defaultCheckDepth: 20,  // Increase if needed
});
```

### Group Relation Example

```typescript
const schema = defineSchema({
  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
    member: { type: "group" },
  },
  actionToRelations: {
    delete: ["owner"],
    edit: ["owner", "editor"],
    view: ["owner", "editor", "viewer"],
  },
});

// Setup teams
const engineering = { type: "team", id: "engineering" };
const frontend = { type: "team", id: "frontend" };

// Nested groups
await authz.addMember({ member: frontend, group: engineering });
await authz.addMember({ member: alice, group: frontend });
await authz.addMember({ member: bob, group: engineering });

// Grant team access
await authz.allow({ who: engineering, toBe: "editor", onWhat: project1 });

// Both can edit (through group membership)
await authz.check({ who: alice, canThey: "edit", onWhat: project1 }); // true
await authz.check({ who: bob, canThey: "edit", onWhat: project1 });   // true
```

---

## 3. Hierarchy Relations

**Definition:** Parent-child relationships between resources. Permissions on parents propagate to children.

```typescript
relations: {
  parent: { type: "hierarchy" },
}
```

### How It Works

When you call:
```typescript
await authz.setParent({
  child: { type: "document", id: "doc1" },
  parent: { type: "folder", id: "folder1" }
});
```

Polizy stores the tuple:
```
(document:doc1, parent, folder:folder1)
```

When checking permission on the child:
```typescript
// Alice has viewer on folder1
await authz.allow({ who: alice, toBe: "viewer", onWhat: folder1 });

// Check if alice can view doc1 (child of folder1)
await authz.check({ who: alice, canThey: "view", onWhat: doc1 });
```

Polizy:
1. Checks if alice has direct `viewer` on doc1 → No
2. Checks if doc1 has a `parent` → Yes, `folder:folder1`
3. Checks if `view` action propagates (via `hierarchyPropagation.view`) → Yes
4. Checks if alice can `view` folder1 → Yes
5. Returns `true`

### Hierarchy Propagation Configuration

**Critical:** Without `hierarchyPropagation`, parent permissions do NOT flow to children.

```typescript
const schema = defineSchema({
  relations: {
    viewer: { type: "direct" },
    editor: { type: "direct" },
    parent: { type: "hierarchy" },
  },
  actionToRelations: {
    edit: ["editor"],
    view: ["viewer", "editor"],
  },
  hierarchyPropagation: {
    // Key: action on child
    // Value: actions on parent that grant it
    view: ["view"],  // view on parent → view on child
    edit: ["edit"],  // edit on parent → edit on child
  },
});
```

### Advanced Propagation

You can configure complex propagation rules:

```typescript
hierarchyPropagation: {
  // View propagates from view or edit on parent
  view: ["view", "edit"],

  // Edit only propagates from edit
  edit: ["edit"],

  // Delete does NOT propagate (not listed)
}
```

### Multi-Level Hierarchies

Hierarchies can be nested:

```
document:doc1
  └── parent → folder:subfolder
                  └── parent → folder:root
```

```typescript
await authz.setParent({ child: doc1, parent: subfolder });
await authz.setParent({ child: subfolder, parent: rootFolder });

await authz.allow({ who: alice, toBe: "viewer", onWhat: rootFolder });

// Alice can view doc1 (propagates through subfolder → root)
await authz.check({ who: alice, canThey: "view", onWhat: doc1 }); // true
```

### When to Use Hierarchy Relations

- **Folder/file structures:** Files in folders
- **Project/task hierarchies:** Tasks inherit project permissions
- **Organization/resource:** Resources belong to organizations
- **Nested categories:** Category → Subcategory → Item

### Hierarchy Relation Example

```typescript
const schema = defineSchema({
  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
    parent: { type: "hierarchy" },
  },
  actionToRelations: {
    delete: ["owner"],
    edit: ["owner", "editor"],
    view: ["owner", "editor", "viewer"],
  },
  hierarchyPropagation: {
    view: ["view", "edit"],  // view OR edit on parent → view on child
    edit: ["edit"],          // only edit on parent → edit on child
    // delete does not propagate
  },
});

// Setup hierarchy
const rootFolder = { type: "folder", id: "root" };
const subFolder = { type: "folder", id: "sub" };
const doc1 = { type: "document", id: "doc1" };

await authz.setParent({ child: subFolder, parent: rootFolder });
await authz.setParent({ child: doc1, parent: subFolder });

// Grant access at root level
await authz.allow({ who: alice, toBe: "editor", onWhat: rootFolder });
await authz.allow({ who: bob, toBe: "viewer", onWhat: rootFolder });

// Check nested permissions
await authz.check({ who: alice, canThey: "edit", onWhat: doc1 });   // true (editor propagates)
await authz.check({ who: alice, canThey: "view", onWhat: doc1 });   // true (editor → view too)
await authz.check({ who: bob, canThey: "view", onWhat: doc1 });     // true (viewer propagates)
await authz.check({ who: bob, canThey: "edit", onWhat: doc1 });     // false (viewer doesn't grant edit)
await authz.check({ who: alice, canThey: "delete", onWhat: doc1 }); // false (delete doesn't propagate)
```

---

## Combining All Three

A complete authorization system often uses all three relation types:

```typescript
const schema = defineSchema({
  relations: {
    // Direct permissions
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },

    // Group membership
    member: { type: "group" },

    // Resource hierarchy
    parent: { type: "hierarchy" },
  },
  actionToRelations: {
    delete: ["owner"],
    edit: ["owner", "editor"],
    view: ["owner", "editor", "viewer"],
  },
  hierarchyPropagation: {
    view: ["view"],
    edit: ["edit"],
  },
});

// Example: Alice is in engineering, which has editor on a project folder
// Documents in that folder inherit the permission

await authz.addMember({ member: alice, group: engineering });
await authz.allow({ who: engineering, toBe: "editor", onWhat: projectFolder });
await authz.setParent({ child: doc1, parent: projectFolder });

// Alice can edit doc1 through: group membership + hierarchy
await authz.check({ who: alice, canThey: "edit", onWhat: doc1 }); // true
```

The check traverses:
```
alice → member → engineering → editor → projectFolder ← parent ← doc1
```

---

## Comparison Table

| Aspect | Direct | Group | Hierarchy |
|--------|--------|-------|-----------|
| Tuple format | `(user, role, resource)` | `(user, member, group)` | `(child, parent, parent)` |
| API method | `allow()` | `addMember()` | `setParent()` |
| Inheritance | None | Members inherit group permissions | Children inherit parent permissions |
| Use case | Specific access | Team-based access | Folder/file structures |
| Requires config | Just relation definition | Just relation definition | Also needs `hierarchyPropagation` |
| Traversal direction | Direct lookup | User → Groups → Permissions | Resource → Parents → Permissions |
