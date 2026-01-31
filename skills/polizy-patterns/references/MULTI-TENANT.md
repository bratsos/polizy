# Multi-Tenant Pattern

Isolate permissions between organizations/tenants in SaaS applications.

## When to Use

- SaaS with multiple customer organizations
- B2B platforms with team workspaces
- White-label applications
- Any system needing tenant isolation

## Strategy Overview

There are two main approaches:

| Approach | Description | Use Case |
|----------|-------------|----------|
| **Hierarchy-Based** | Resources have parent → organization | Simpler, recommended for most |
| **Tenant-Prefixed** | IDs include tenant: `acme:doc1` | Complete isolation |

## Approach 1: Hierarchy-Based (Recommended)

Use organizations as parent of all resources.

### Schema

```typescript
const schema = defineSchema({
  relations: {
    // Organization roles
    org_owner: { type: "direct" },
    org_admin: { type: "direct" },
    org_member: { type: "direct" },

    // Resource roles
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },

    // Structure
    member: { type: "group" },
    parent: { type: "hierarchy" },
  },
  actionToRelations: {
    // Organization management
    manage_org: ["org_owner"],
    manage_members: ["org_owner", "org_admin"],
    invite_member: ["org_owner", "org_admin"],

    // Resource actions
    delete: ["owner", "org_admin"],
    edit: ["owner", "editor", "org_admin"],
    view: ["owner", "editor", "viewer", "org_admin", "org_member"],
  },
  hierarchyPropagation: {
    view: ["view"],
    edit: ["edit"],
  },
});
```

### Creating Organization

```typescript
async function createOrganization(ownerId: string, orgName: string) {
  // Create in database
  const org = await db.organizations.create({
    data: { name: orgName, ownerId }
  });

  const orgObj = { type: "org", id: org.id };
  const owner = { type: "user", id: ownerId };

  // Grant owner role
  await authz.allow({
    who: owner,
    toBe: "org_owner",
    onWhat: orgObj
  });

  // Owner is also a member
  await authz.allow({
    who: owner,
    toBe: "org_member",
    onWhat: orgObj
  });

  return org;
}
```

### Adding Members

```typescript
async function inviteMember(
  inviterId: string,
  orgId: string,
  inviteeId: string,
  role: "org_admin" | "org_member"
) {
  const org = { type: "org", id: orgId };
  const inviter = { type: "user", id: inviterId };

  // Check inviter can invite
  const canInvite = await authz.check({
    who: inviter,
    canThey: "invite_member",
    onWhat: org
  });

  if (!canInvite) {
    throw new Error("Cannot invite members to this organization");
  }

  // Grant role
  await authz.allow({
    who: { type: "user", id: inviteeId },
    toBe: role,
    onWhat: org
  });
}
```

### Creating Resources Within Org

```typescript
async function createDocument(userId: string, orgId: string, content: string) {
  const user = { type: "user", id: userId };
  const org = { type: "org", id: orgId };

  // Verify user is member of org
  const isMember = await authz.check({
    who: user,
    canThey: "view",  // org_member has view
    onWhat: org
  });

  if (!isMember) {
    throw new Error("Not a member of this organization");
  }

  // Create document
  const doc = await db.documents.create({
    data: { content, orgId, createdBy: userId }
  });

  const docObj = { type: "document", id: doc.id };

  // Grant owner
  await authz.allow({
    who: user,
    toBe: "owner",
    onWhat: docObj
  });

  // Set org as parent (enables org-level access)
  await authz.setParent({
    child: docObj,
    parent: org
  });

  return doc;
}
```

### Tenant Isolation Check

```typescript
async function getDocument(userId: string, docId: string) {
  const user = { type: "user", id: userId };
  const doc = { type: "document", id: docId };

  // Check includes both direct and org-level permissions
  const canView = await authz.check({
    who: user,
    canThey: "view",
    onWhat: doc
  });

  if (!canView) {
    throw new ForbiddenError("Cannot access this document");
  }

  return db.documents.findUnique({ where: { id: docId } });
}
```

### Listing Accessible Resources

```typescript
async function getMyDocuments(userId: string) {
  const result = await authz.listAccessibleObjects({
    who: { type: "user", id: userId },
    ofType: "document"
  });

  return result.accessible;
}

// Returns only documents user can access through:
// - Direct permissions
// - Org membership (via hierarchy)
```

## Approach 2: Tenant-Prefixed IDs

Include tenant in object IDs for complete isolation.

### ID Format

```
{tenant}:{resource_type}:{resource_id}
acme:document:doc123
globex:document:doc456
```

### Schema

```typescript
const schema = defineSchema({
  relations: {
    org_admin: { type: "direct" },
    org_member: { type: "direct" },
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
    member: { type: "group" },
  },
  actionToRelations: {
    manage: ["org_admin"],
    delete: ["owner", "org_admin"],
    edit: ["owner", "editor", "org_admin"],
    view: ["owner", "editor", "viewer", "org_admin", "org_member"],
  },
});
```

### Creating Resources

```typescript
function tenantId(orgId: string, type: string, id: string) {
  return `${orgId}:${type}:${id}`;
}

async function createDocument(userId: string, orgId: string, content: string) {
  const doc = await db.documents.create({
    data: { content, orgId, createdBy: userId }
  });

  // ID includes tenant
  const docObj = { type: "document", id: tenantId(orgId, "document", doc.id) };

  await authz.allow({
    who: { type: "user", id: userId },
    toBe: "owner",
    onWhat: docObj
  });

  return doc;
}
```

### Checking Access

```typescript
async function getDocument(userId: string, orgId: string, docId: string) {
  const doc = { type: "document", id: tenantId(orgId, "document", docId) };

  const canView = await authz.check({
    who: { type: "user", id: userId },
    canThey: "view",
    onWhat: doc
  });

  if (!canView) {
    throw new ForbiddenError();
  }

  return db.documents.findUnique({ where: { id: docId } });
}
```

## Teams Within Organizations

Organizations often have teams:

```typescript
async function createTeam(orgId: string, teamName: string, adminId: string) {
  const team = await db.teams.create({
    data: { name: teamName, orgId }
  });

  const teamObj = { type: "team", id: team.id };
  const org = { type: "org", id: orgId };

  // Team is part of org
  await authz.addMember({
    member: teamObj,
    group: org
  });

  // Admin is member of team
  await authz.addMember({
    member: { type: "user", id: adminId },
    group: teamObj
  });

  return team;
}

// Now users in team inherit org-level permissions
// And can be granted team-specific permissions
```

## Cross-Org Sharing

Sometimes you need to share across organizations:

```typescript
async function shareWithExternalUser(
  docId: string,
  ownerId: string,
  externalUserId: string,
  permission: "viewer" | "editor"
) {
  const doc = { type: "document", id: docId };
  const owner = { type: "user", id: ownerId };

  // Verify owner
  const isOwner = await authz.check({
    who: owner,
    canThey: "delete",  // Proxy for ownership
    onWhat: doc
  });

  if (!isOwner) {
    throw new Error("Only owner can share externally");
  }

  // Grant direct access (bypasses org hierarchy)
  await authz.allow({
    who: { type: "user", id: externalUserId },
    toBe: permission,
    onWhat: doc
  });

  // Optionally: Set expiry for external access
  // await authz.allow({
  //   who: { type: "user", id: externalUserId },
  //   toBe: permission,
  //   onWhat: doc,
  //   when: { validUntil: new Date(...) }
  // });
}
```

## Organization Roles Pattern

```typescript
// Define org-level roles
const ORG_ROLES = {
  owner: "org_owner",      // Full control
  admin: "org_admin",      // Manage members, resources
  member: "org_member",    // Basic access
  billing: "org_billing",  // Billing only
  readonly: "org_readonly" // View only
} as const;

async function setOrgRole(
  orgId: string,
  userId: string,
  role: keyof typeof ORG_ROLES
) {
  const org = { type: "org", id: orgId };
  const user = { type: "user", id: userId };

  // Remove existing roles
  for (const roleValue of Object.values(ORG_ROLES)) {
    await authz.disallowAllMatching({
      who: user,
      was: roleValue,
      onWhat: org
    });
  }

  // Grant new role
  await authz.allow({
    who: user,
    toBe: ORG_ROLES[role],
    onWhat: org
  });
}
```

## Switching Organizations

For users in multiple orgs:

```typescript
async function getUserOrganizations(userId: string) {
  const user = { type: "user", id: userId };

  // Find all org-related tuples for user
  const tuples = await authz.listTuples({
    subject: user
  });

  const orgs = tuples
    .filter(t => t.object.type === "org")
    .map(t => ({
      orgId: t.object.id,
      role: t.relation
    }));

  return orgs;
}

// Get available orgs for user
const orgs = await getUserOrganizations("alice");
// [
//   { orgId: "acme", role: "org_owner" },
//   { orgId: "globex", role: "org_member" }
// ]
```

## Best Practices

1. **Use hierarchy for tenant isolation** - Simpler than prefixed IDs
2. **Always check org membership first** - Before resource access
3. **Grant org roles, not just resource roles** - For consistent access patterns
4. **Handle cross-org sharing explicitly** - Time-limited if possible
5. **Audit org-level operations** - Log member additions/removals

## Anti-Patterns

### Don't: Check resource without org context

```typescript
// ❌ Bad - no tenant context
await authz.check({
  who: user,
  canThey: "view",
  onWhat: { type: "document", id: docId }
});
// User might access wrong tenant's doc!

// ✅ Good - hierarchy provides context
// (Document has parent → org, so check is scoped)
await authz.setParent({ child: doc, parent: org });
await authz.check({
  who: user,
  canThey: "view",
  onWhat: doc
});
```

### Don't: Forget to set parent org

```typescript
// ❌ Bad - orphaned resource
const doc = await db.documents.create({ ... });
await authz.allow({ who: user, toBe: "owner", onWhat: docObj });
// No parent = no tenant isolation!

// ✅ Good - always set parent
const doc = await db.documents.create({ ... });
await authz.allow({ who: user, toBe: "owner", onWhat: docObj });
await authz.setParent({ child: docObj, parent: org });
```

### Don't: Share tenant-prefixed IDs externally

```typescript
// ❌ Bad - exposes tenant structure
return { id: "acme:document:doc123" };

// ✅ Good - use clean IDs externally
return { id: "doc123", orgId: "acme" };
```
