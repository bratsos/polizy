# Group Access Pattern

Grant access through team/group membership. Members inherit all permissions granted to the group.

## When to Use

- Team-based access (engineering team can edit projects)
- Department access (HR can view all employee records)
- Role-based groups (all admins, all moderators)
- Organizational structure (department → team → user)

## Schema Setup

```typescript
import { defineSchema, AuthSystem, InMemoryStorageAdapter } from "polizy";

const schema = defineSchema({
  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
    member: { type: "group" },  // Required for addMember()
  },
  actionToRelations: {
    delete: ["owner"],
    edit: ["owner", "editor"],
    view: ["owner", "editor", "viewer"],
  },
});

const authz = new AuthSystem({
  storage: new InMemoryStorageAdapter(),
  schema,
});
```

## Basic Group Pattern

### 1. Add Users to Groups

```typescript
const alice = { type: "user", id: "alice" };
const bob = { type: "user", id: "bob" };
const engineering = { type: "team", id: "engineering" };

// Add users to team
await authz.addMember({ member: alice, group: engineering });
await authz.addMember({ member: bob, group: engineering });
```

### 2. Grant Access to Group

```typescript
const project = { type: "project", id: "project1" };

// Grant team editor access
await authz.allow({
  who: engineering,
  toBe: "editor",
  onWhat: project
});
```

### 3. Members Inherit Permission

```typescript
// Both alice and bob can now edit
const canAliceEdit = await authz.check({
  who: alice,
  canThey: "edit",
  onWhat: project
}); // true

const canBobEdit = await authz.check({
  who: bob,
  canThey: "edit",
  onWhat: project
}); // true
```

## Nested Groups

Groups can contain other groups, creating organizational hierarchies.

### Example: Department → Team → User

```typescript
// Organization structure
const engineering = { type: "department", id: "engineering" };
const frontend = { type: "team", id: "frontend" };
const backend = { type: "team", id: "backend" };

// Teams are part of department
await authz.addMember({ member: frontend, group: engineering });
await authz.addMember({ member: backend, group: engineering });

// Users are in teams
await authz.addMember({ member: alice, group: frontend });
await authz.addMember({ member: bob, group: backend });

// Grant access at department level
const codeRepo = { type: "repository", id: "main-repo" };
await authz.allow({ who: engineering, toBe: "viewer", onWhat: codeRepo });

// All engineers can view (through nested groups)
await authz.check({ who: alice, canThey: "view", onWhat: codeRepo }); // true
await authz.check({ who: bob, canThey: "view", onWhat: codeRepo });   // true
```

### Permission Flow

```
alice → member → frontend → member → engineering → viewer → codeRepo
bob   → member → backend  → member → engineering → viewer → codeRepo
```

## Managing Group Membership

### Adding Members

```typescript
// Add user to group
await authz.addMember({
  member: { type: "user", id: "charlie" },
  group: { type: "team", id: "engineering" }
});

// Add group to group (nesting)
await authz.addMember({
  member: { type: "team", id: "frontend" },
  group: { type: "department", id: "engineering" }
});
```

### Removing Members

```typescript
// Remove user from group
await authz.removeMember({
  member: { type: "user", id: "charlie" },
  group: { type: "team", id: "engineering" }
});

// User immediately loses inherited permissions
const canView = await authz.check({
  who: { type: "user", id: "charlie" },
  canThey: "view",
  onWhat: project
}); // false (no longer in team)
```

### Listing Group Members

```typescript
async function getGroupMembers(groupType: string, groupId: string) {
  const tuples = await authz.listTuples({
    object: { type: groupType, id: groupId },
    relation: "member"
  });

  return tuples.map(t => t.subject);
}

// Get all members of engineering team
const members = await getGroupMembers("team", "engineering");
// [{ type: "user", id: "alice" }, { type: "user", id: "bob" }]
```

### Listing User's Groups

```typescript
async function getUserGroups(userId: string) {
  const tuples = await authz.listTuples({
    subject: { type: "user", id: userId },
    relation: "member"
  });

  return tuples.map(t => t.object);
}

// Get all groups alice is in
const groups = await getUserGroups("alice");
// [{ type: "team", id: "frontend" }]
```

## Common Scenarios

### Onboarding New Team Member

```typescript
async function onboardUser(
  userId: string,
  teamId: string,
  role: "admin" | "member"
) {
  const user = { type: "user", id: userId };
  const team = { type: "team", id: teamId };

  // Add to team
  await authz.addMember({ member: user, group: team });

  // If admin, also grant direct admin role on team
  if (role === "admin") {
    await authz.allow({
      who: user,
      toBe: "admin",
      onWhat: team
    });
  }
}
```

### Offboarding User

```typescript
async function offboardUser(userId: string) {
  const user = { type: "user", id: userId };

  // Get all groups user is in
  const groupTuples = await authz.listTuples({
    subject: user,
    relation: "member"
  });

  // Remove from all groups
  for (const tuple of groupTuples) {
    await authz.removeMember({
      member: user,
      group: tuple.object
    });
  }

  // Also remove direct permissions
  await authz.disallowAllMatching({ who: user });
}
```

### Cross-Team Collaboration

```typescript
// Create a project-specific group
const projectTeam = { type: "project-team", id: "project-x" };

// Add members from different teams
await authz.addMember({
  member: { type: "user", id: "alice" },  // From frontend
  group: projectTeam
});
await authz.addMember({
  member: { type: "user", id: "charlie" },  // From backend
  group: projectTeam
});
await authz.addMember({
  member: { type: "user", id: "diana" },  // From design
  group: projectTeam
});

// Grant access to project
await authz.allow({
  who: projectTeam,
  toBe: "editor",
  onWhat: { type: "project", id: "project-x" }
});
```

### Role-Based Groups

```typescript
// Create role groups
const admins = { type: "role", id: "admins" };
const moderators = { type: "role", id: "moderators" };

// Add users to roles
await authz.addMember({ member: alice, group: admins });
await authz.addMember({ member: bob, group: moderators });

// Grant role-based permissions
await authz.allow({
  who: admins,
  toBe: "owner",
  onWhat: { type: "settings", id: "global" }
});

await authz.allow({
  who: moderators,
  toBe: "editor",
  onWhat: { type: "content", id: "all" }
});
```

## Depth Considerations

### Default Depth Limit

Polizy limits group traversal depth to prevent infinite loops (default: 10).

```typescript
const authz = new AuthSystem({
  storage,
  schema,
  defaultCheckDepth: 10,  // Default
});
```

### Deep Nesting Warning

If you have deep nesting:

```
user → team → department → division → region → company
```

That's 5 levels. Each check must traverse all levels.

**Recommendations:**
- Keep nesting to 2-3 levels
- If deeper needed, increase `defaultCheckDepth`
- Enable `throwOnMaxDepth: true` to detect issues

### Detecting Depth Issues

```typescript
const authz = new AuthSystem({
  storage,
  schema,
  throwOnMaxDepth: true,  // Throws instead of silent false
});

try {
  await authz.check({ who: user, canThey: "view", onWhat: resource });
} catch (error) {
  if (error instanceof MaxDepthExceededError) {
    console.error("Group nesting too deep:", error.depth);
  }
}
```

## Best Practices

1. **Use groups for common access patterns** - Don't duplicate permissions across users
2. **Keep nesting shallow** - 2-3 levels is usually enough
3. **Name groups semantically** - "engineering", "hr", "admins" not "group1"
4. **Grant minimum role to group** - Then add direct permissions for special cases
5. **Clean up on user departure** - Remove from all groups

## Anti-Patterns

### Don't: Create per-resource groups

```typescript
// ❌ Bad - defeats the purpose of groups
await authz.addMember({ member: alice, group: { type: "group", id: "doc1-viewers" } });
await authz.addMember({ member: bob, group: { type: "group", id: "doc1-viewers" } });

// ✅ Good - use team and grant team access
await authz.addMember({ member: alice, group: engineering });
await authz.addMember({ member: bob, group: engineering });
await authz.allow({ who: engineering, toBe: "viewer", onWhat: doc1 });
```

### Don't: Deeply nest groups

```typescript
// ❌ Bad - 10+ levels of nesting
user → team → subteam → department → subdept → division → region → country → continent → global

// ✅ Good - flat structure
user → team → organization
```

### Don't: Forget to remove from groups

```typescript
// ❌ Bad - user leaves but keeps access
await db.users.delete({ where: { id: userId } });
// Forgot to remove from groups!

// ✅ Good - clean up permissions
await offboardUser(userId);  // Removes from all groups
await db.users.delete({ where: { id: userId } });
```
