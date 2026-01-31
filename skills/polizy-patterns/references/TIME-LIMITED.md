# Time-Limited Access Pattern

Grant temporary permissions that automatically expire or start at a future date.

## When to Use

- Contractor access with end date
- Trial periods
- Scheduled access (starts in future)
- Project-based permissions with deadlines
- Temporary elevated privileges

## How It Works

Tuples can have a `condition` with time constraints:

```typescript
await authz.allow({
  who: { type: "user", id: "contractor" },
  toBe: "editor",
  onWhat: { type: "project", id: "project1" },
  when: {
    validSince: new Date("2024-01-01"),   // Starts
    validUntil: new Date("2024-03-31")    // Ends
  }
});
```

During `check()`, polizy evaluates:
- If `validSince` is set and current time is before it → permission not yet active
- If `validUntil` is set and current time is after it → permission expired
- Both must be satisfied for permission to be valid

## Condition Types

### Expires On Date

```typescript
await authz.allow({
  who: contractor,
  toBe: "editor",
  onWhat: project,
  when: {
    validUntil: new Date("2024-03-31T23:59:59Z")
  }
});

// Permission is valid from now until end of March 31
```

### Starts On Date

```typescript
await authz.allow({
  who: newHire,
  toBe: "viewer",
  onWhat: internalDocs,
  when: {
    validSince: new Date("2024-02-15T09:00:00Z")
  }
});

// Permission becomes active on Feb 15 at 9 AM
```

### Time Window

```typescript
await authz.allow({
  who: auditor,
  toBe: "viewer",
  onWhat: financialRecords,
  when: {
    validSince: new Date("2024-01-01T00:00:00Z"),
    validUntil: new Date("2024-01-31T23:59:59Z")
  }
});

// Permission only valid during January
```

## Common Scenarios

### Contractor with End Date

```typescript
async function grantContractorAccess(
  contractorId: string,
  projectId: string,
  endDate: Date
) {
  await authz.allow({
    who: { type: "user", id: contractorId },
    toBe: "editor",
    onWhat: { type: "project", id: projectId },
    when: {
      validUntil: endDate
    }
  });
}

// Grant 90-day access
const endDate = new Date();
endDate.setDate(endDate.getDate() + 90);
await grantContractorAccess("contractor123", "project1", endDate);
```

### Trial Period

```typescript
async function startTrial(userId: string, trialDays: number = 14) {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + trialDays);

  await authz.allow({
    who: { type: "user", id: userId },
    toBe: "viewer",
    onWhat: { type: "feature", id: "premium" },
    when: {
      validUntil: endDate
    }
  });

  return { trialEndsAt: endDate };
}
```

### Scheduled Onboarding

```typescript
async function scheduleOnboarding(userId: string, startDate: Date) {
  // Schedule access to onboarding materials
  await authz.allow({
    who: { type: "user", id: userId },
    toBe: "viewer",
    onWhat: { type: "docs", id: "onboarding" },
    when: {
      validSince: startDate
    }
  });

  // Schedule access to team resources
  await authz.allow({
    who: { type: "user", id: userId },
    toBe: "viewer",
    onWhat: { type: "project", id: "team-resources" },
    when: {
      validSince: startDate
    }
  });
}

// New hire starts Feb 15
await scheduleOnboarding("newhire123", new Date("2024-02-15T09:00:00Z"));
```

### Temporary Elevated Access

```typescript
async function grantEmergencyAccess(
  userId: string,
  resourceId: string,
  hours: number = 4
) {
  const endTime = new Date();
  endTime.setHours(endTime.getHours() + hours);

  await authz.allow({
    who: { type: "user", id: userId },
    toBe: "owner",  // Elevated access
    onWhat: { type: "system", id: resourceId },
    when: {
      validUntil: endTime
    }
  });

  // Log for audit
  console.log(`Emergency access granted to ${userId} until ${endTime}`);

  return { expiresAt: endTime };
}
```

### Project-Based Access

```typescript
async function grantProjectAccess(
  userId: string,
  projectId: string,
  projectDeadline: Date
) {
  // Access ends when project ends
  await authz.allow({
    who: { type: "user", id: userId },
    toBe: "editor",
    onWhat: { type: "project", id: projectId },
    when: {
      validUntil: projectDeadline
    }
  });
}
```

## Extending Access

To extend expiring access, grant a new permission with later date:

```typescript
async function extendAccess(
  userId: string,
  resourceId: string,
  additionalDays: number
) {
  const user = { type: "user", id: userId };
  const resource = { type: "resource", id: resourceId };

  // Find current permission
  const tuples = await authz.listTuples({
    subject: user,
    object: resource
  });

  const currentTuple = tuples[0];
  if (!currentTuple) {
    throw new Error("No existing access to extend");
  }

  // Calculate new end date
  const currentEnd = currentTuple.condition?.validUntil || new Date();
  const newEnd = new Date(currentEnd);
  newEnd.setDate(newEnd.getDate() + additionalDays);

  // Remove old permission
  await authz.disallowAllMatching({
    who: user,
    was: currentTuple.relation,
    onWhat: resource
  });

  // Grant with new end date
  await authz.allow({
    who: user,
    toBe: currentTuple.relation,
    onWhat: resource,
    when: {
      validUntil: newEnd
    }
  });

  return { newEndDate: newEnd };
}
```

## Expired Permission Cleanup

**Important:** Expired tuples remain in storage. They're ignored during checks but take up space.

### Manual Cleanup

```typescript
async function cleanupExpiredPermissions() {
  const allTuples = await authz.listTuples({});
  const now = new Date();
  let cleaned = 0;

  for (const tuple of allTuples) {
    if (tuple.condition?.validUntil && tuple.condition.validUntil < now) {
      await authz.disallowAllMatching({
        who: tuple.subject,
        was: tuple.relation,
        onWhat: tuple.object
      });
      cleaned++;
    }
  }

  console.log(`Cleaned up ${cleaned} expired permissions`);
  return cleaned;
}

// Run periodically (e.g., daily cron job)
```

### With Pagination for Large Datasets

```typescript
async function cleanupExpiredPermissionsPaginated(batchSize = 100) {
  let offset = 0;
  let totalCleaned = 0;
  const now = new Date();

  while (true) {
    const tuples = await authz.listTuples({}, { limit: batchSize, offset });
    if (tuples.length === 0) break;

    const expired = tuples.filter(
      t => t.condition?.validUntil && t.condition.validUntil < now
    );

    for (const tuple of expired) {
      await authz.disallowAllMatching({
        who: tuple.subject,
        was: tuple.relation,
        onWhat: tuple.object
      });
    }

    totalCleaned += expired.length;
    offset += batchSize;
  }

  return totalCleaned;
}
```

## Checking Time-Based Access

Standard `check()` automatically evaluates conditions:

```typescript
// Permission valid until March 31
await authz.allow({
  who: contractor,
  toBe: "editor",
  onWhat: project,
  when: { validUntil: new Date("2024-03-31") }
});

// Before expiry - access granted
// (assuming current date is March 15)
await authz.check({
  who: contractor,
  canThey: "edit",
  onWhat: project
}); // true

// After expiry - access denied
// (assuming current date is April 1)
await authz.check({
  who: contractor,
  canThey: "edit",
  onWhat: project
}); // false
```

## Listing Expiring Permissions

```typescript
async function getExpiringPermissions(withinDays: number) {
  const allTuples = await authz.listTuples({});
  const now = new Date();
  const threshold = new Date();
  threshold.setDate(threshold.getDate() + withinDays);

  return allTuples.filter(tuple => {
    const expiry = tuple.condition?.validUntil;
    return expiry && expiry > now && expiry <= threshold;
  });
}

// Get permissions expiring in next 7 days
const expiringSoon = await getExpiringPermissions(7);
for (const tuple of expiringSoon) {
  console.log(`${tuple.subject.id}'s ${tuple.relation} on ${tuple.object.id} expires ${tuple.condition.validUntil}`);
}
```

## Notification System

```typescript
async function notifyExpiringAccess() {
  const expiringIn7Days = await getExpiringPermissions(7);

  for (const tuple of expiringIn7Days) {
    await sendEmail({
      to: await getUserEmail(tuple.subject.id),
      subject: "Access Expiring Soon",
      body: `Your ${tuple.relation} access to ${tuple.object.id} expires on ${tuple.condition.validUntil}`
    });
  }
}

// Run daily
```

## Best Practices

1. **Use UTC dates** - Avoid timezone confusion
2. **Set appropriate granularity** - End of day, not random times
3. **Clean up expired tuples** - Run periodic cleanup jobs
4. **Notify before expiry** - Give users time to request extension
5. **Audit time-based grants** - Log who granted temporary access

## Anti-Patterns

### Don't: Use far-future dates as "permanent"

```typescript
// ❌ Bad - using 2099 as "permanent"
when: { validUntil: new Date("2099-12-31") }

// ✅ Good - no condition for permanent access
// (omit the `when` parameter entirely)
await authz.allow({
  who: user,
  toBe: "editor",
  onWhat: resource
  // No `when` = permanent
});
```

### Don't: Forget timezone handling

```typescript
// ❌ Bad - ambiguous timezone
when: { validUntil: new Date("2024-03-31") }

// ✅ Good - explicit UTC
when: { validUntil: new Date("2024-03-31T23:59:59Z") }
```

### Don't: Grant overlapping time windows

```typescript
// ❌ Confusing - multiple permissions with different times
await authz.allow({ who, toBe: "viewer", onWhat, when: { validUntil: march } });
await authz.allow({ who, toBe: "viewer", onWhat, when: { validUntil: april } });

// ✅ Good - single permission, extend if needed
await authz.allow({ who, toBe: "viewer", onWhat, when: { validUntil: march } });
// Later: extend to april
```
