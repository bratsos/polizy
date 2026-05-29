# Patterns & Best Practices

## Design Principles

### 1. Use Semantic Action Names

**Do this:**
```typescript
actionToRelations: {
  view: ["viewer", "editor", "owner"],
  edit: ["editor", "owner"],
  delete: ["owner"],
  share: ["owner"],
  comment: ["viewer", "editor", "owner"]
}
```

**Not this:**
```typescript
actionToRelations: {
  read: ["r"],
  write: ["w"],
  admin: ["a"]
}
```

**Why?** Semantic names make authorization checks self-documenting:
```typescript
// Clear intent
await authz.check({ who: user, canThey: "share", onWhat: doc });

// Unclear
await authz.check({ who: user, canThey: "admin", onWhat: doc });
```

### 2. Use Descriptive Relation Names

**Do this:**
```typescript
relations: {
  owner: { type: "direct" },
  editor: { type: "direct" },
  viewer: { type: "direct" },
  approver: { type: "direct" },
  member: { type: "group" },
  parent: { type: "hierarchy" }
}
```

**Not this:**
```typescript
relations: {
  rel1: { type: "direct" },
  rel2: { type: "direct" },
  grp: { type: "group" }
}
```

### 3. Prefer Groups Over Individual Permissions

**Do this:**
```typescript
// Create a team
await authz.addMember({ member: alice, group: engineering });
await authz.addMember({ member: bob, group: engineering });
await authz.addMember({ member: charlie, group: engineering });

// Grant team access (one tuple)
await authz.allow({ who: engineering, toBe: "editor", onWhat: project });
```

**Not this:**
```typescript
// Grant individual access (three tuples)
await authz.allow({ who: alice, toBe: "editor", onWhat: project });
await authz.allow({ who: bob, toBe: "editor", onWhat: project });
await authz.allow({ who: charlie, toBe: "editor", onWhat: project });
```

**Why?**
- Easier to manage (add/remove from group)
- Fewer tuples in storage
- Clear organizational structure
- When someone joins the team, they automatically get access

### 4. Use Hierarchies for Nested Resources

**Do this:**
```typescript
// Set up hierarchy
await authz.setParent({ child: file1, parent: folder1 });
await authz.setParent({ child: file2, parent: folder1 });
await authz.setParent({ child: folder1, parent: rootFolder });

// Grant access at folder level
await authz.allow({ who: user, toBe: "viewer", onWhat: folder1 });
// User can now view file1 and file2
```

**Not this:**
```typescript
// Grant access to each file individually
await authz.allow({ who: user, toBe: "viewer", onWhat: file1 });
await authz.allow({ who: user, toBe: "viewer", onWhat: file2 });
// ... repeat for every file
```

**Why?**
- Mirrors natural resource organization
- Automatic permission inheritance
- Easier bulk permission changes

### 5. Design Actions Around User Intent

Think about what users want to do, not implementation details:

```typescript
actionToRelations: {
  // Good: User-centric actions
  "view-document": ["viewer", "editor", "owner"],
  "edit-document": ["editor", "owner"],
  "publish-document": ["publisher", "owner"],
  "archive-document": ["owner"],

  // Also consider sub-actions for complex workflows
  "view-comments": ["viewer", "editor", "owner"],
  "add-comment": ["commenter", "editor", "owner"],
  "delete-own-comment": ["commenter", "editor", "owner"],
  "delete-any-comment": ["moderator", "owner"]
}
```

## Common Authorization Patterns

### Pattern: Role-Based Access Control (RBAC)

Use groups to implement roles:

```typescript
const schema = defineSchema({
  relations: {
    member: { type: "group" },
    admin: { type: "direct" },
    moderator: { type: "direct" },
    user: { type: "direct" }
  },
  actionToRelations: {
    "manage-users": ["admin"],
    "moderate-content": ["admin", "moderator"],
    "create-content": ["admin", "moderator", "user"],
    "view-content": ["admin", "moderator", "user"]
  }
});

// Assign role
await authz.allow({
  who: { type: "user", id: "alice" },
  toBe: "admin",
  onWhat: { type: "application", id: "app1" }
});
```

### Pattern: Resource-Based Access Control

Permissions tied to specific resources:

```typescript
// Alice owns specific documents
await authz.allow({ who: alice, toBe: "owner", onWhat: doc1 });
await authz.allow({ who: alice, toBe: "owner", onWhat: doc2 });

// Bob can view specific documents
await authz.allow({ who: bob, toBe: "viewer", onWhat: doc1 });
```

### Pattern: Organizational Hierarchy

Nested groups for organizational structure:

```typescript
// Department > Team > User
await authz.addMember({ member: frontendTeam, group: engineeringDept });
await authz.addMember({ member: backendTeam, group: engineeringDept });
await authz.addMember({ member: alice, group: frontendTeam });
await authz.addMember({ member: bob, group: backendTeam });

// Grant access at department level
await authz.allow({ who: engineeringDept, toBe: "viewer", onWhat: codeRepo });
// All engineers can now view the code repo
```

### Pattern: Temporary Access

Use conditions for time-limited permissions:

```typescript
// Contractor access for Q1
await authz.allow({
  who: contractor,
  toBe: "editor",
  onWhat: project,
  when: {
    validSince: new Date("2024-01-01"),
    validUntil: new Date("2024-03-31")
  }
});

// Scheduled access (starts in the future)
await authz.allow({
  who: newHire,
  toBe: "viewer",
  onWhat: onboardingDocs,
  when: {
    validSince: new Date("2024-02-15") // Start date
  }
});
```

### Pattern: Multi-Tenant Isolation

Use object types to separate tenants:

```typescript
// Each tenant is a separate "organization" object
await authz.allow({
  who: { type: "user", id: "alice" },
  toBe: "admin",
  onWhat: { type: "org", id: "acme-corp" }
});

// Resources belong to organizations via hierarchy
await authz.setParent({
  child: { type: "document", id: "doc1" },
  parent: { type: "org", id: "acme-corp" }
});

// Check includes organization context
const canAccess = await authz.check({
  who: alice,
  canThey: "view",
  onWhat: { type: "document", id: "doc1" }
});
```

### Pattern: Approval Workflows

Use separate relations for different stages:

```typescript
const schema = defineSchema({
  relations: {
    creator: { type: "direct" },
    reviewer: { type: "direct" },
    approver: { type: "direct" },
    publisher: { type: "direct" }
  },
  actionToRelations: {
    "create-draft": ["creator"],
    "edit-draft": ["creator"],
    "submit-for-review": ["creator"],
    "review": ["reviewer", "approver"],
    "approve": ["approver"],
    "publish": ["publisher"]
  }
});
```

### Pattern: Field-Level Access

Protect sensitive fields within documents:

```typescript
// See Advanced Usage guide for details
await authz.allow({
  who: manager,
  toBe: "viewer",
  onWhat: { type: "employee", id: "emp1#salary" }
});

await authz.allow({
  who: hrTeam,
  toBe: "editor",
  onWhat: { type: "employee", id: "emp1#salary" }
});

// General access to employee record
await authz.allow({
  who: employee,
  toBe: "viewer",
  onWhat: { type: "employee", id: "emp1" }
});
```

## Schema Design Tips

### Start Simple, Expand Later

Begin with basic relations and actions:

```typescript
// v1: Simple
const schema = defineSchema({
  relations: {
    owner: { type: "direct" },
    viewer: { type: "direct" }
  },
  actionToRelations: {
    edit: ["owner"],
    view: ["owner", "viewer"]
  }
});
```

Add complexity only when needed:

```typescript
// v2: Added groups and editor role
const schema = defineSchema({
  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
    member: { type: "group" }
  },
  actionToRelations: {
    delete: ["owner"],
    edit: ["owner", "editor"],
    view: ["owner", "editor", "viewer"]
  }
});
```

### Document Your Schema

Add comments explaining the intent:

```typescript
const schema = defineSchema({
  relations: {
    // Direct ownership - can do everything
    owner: { type: "direct" },

    // Can edit but not delete or transfer ownership
    editor: { type: "direct" },

    // Read-only access
    viewer: { type: "direct" },

    // Group membership for team-based access
    member: { type: "group" },

    // Folder/file hierarchy for inheritance
    parent: { type: "hierarchy" }
  },

  actionToRelations: {
    // Destructive actions - owner only
    delete: ["owner"],
    transfer: ["owner"],

    // Modification actions
    edit: ["owner", "editor"],

    // Read actions
    view: ["owner", "editor", "viewer"],
    download: ["owner", "editor", "viewer"]
  },

  hierarchyPropagation: {
    // View permission flows down the hierarchy
    view: ["view"],
    download: ["view", "download"]
  }
});
```

## Next Steps

- **[Anti-Patterns](./anti-patterns.md)** - Common mistakes to avoid
- **[Advanced Usage](./advanced-usage.md)** - Field-level permissions, performance
