# Field-Level Permissions Pattern

Protect sensitive fields within records (salary, SSN, medical data).

## When to Use

- Sensitive personal information (PII)
- Salary and compensation data
- Medical records
- Financial information
- Any field that needs stricter access than the containing record

## How It Works

Polizy uses a field separator (default: `#`) to identify field-level permissions:

```
document:doc1          → Base object
document:doc1#salary   → Salary field of doc1
document:doc1#ssn      → SSN field of doc1
```

When checking `doc1#salary`, polizy checks:
1. Does user have permission on `doc1#salary` specifically?
2. Falls back to `doc1` base object if no field-specific permission

## Schema Setup

No special schema configuration needed - field-level works with standard direct relations:

```typescript
import { defineSchema, AuthSystem, InMemoryStorageAdapter } from "polizy";

const schema = defineSchema({
  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
  },
  actionToRelations: {
    edit: ["owner", "editor"],
    view: ["owner", "editor", "viewer"],
  },
});

const authz = new AuthSystem({
  storage: new InMemoryStorageAdapter(),
  schema,
});
```

## Basic Field-Level Pattern

### Granting Field Access

```typescript
const employee = { type: "employee", id: "emp123" };
const salaryField = { type: "employee", id: "emp123#salary" };

// General employee can view their own record
await authz.allow({
  who: { type: "user", id: "emp123" },
  toBe: "viewer",
  onWhat: employee
});

// HR manager can view and edit salary
await authz.allow({
  who: { type: "user", id: "hr_manager" },
  toBe: "editor",
  onWhat: salaryField
});
```

### Checking Field Access

```typescript
const emp = { type: "user", id: "emp123" };
const hr = { type: "user", id: "hr_manager" };

// Employee can view their record
await authz.check({
  who: emp,
  canThey: "view",
  onWhat: { type: "employee", id: "emp123" }
}); // true

// Employee CANNOT view salary field
await authz.check({
  who: emp,
  canThey: "view",
  onWhat: { type: "employee", id: "emp123#salary" }
}); // false

// HR can view salary field
await authz.check({
  who: hr,
  canThey: "view",
  onWhat: { type: "employee", id: "emp123#salary" }
}); // true
```

## Custom Field Separator

If your IDs contain `#`, use a different separator:

```typescript
const authz = new AuthSystem({
  storage,
  schema,
  fieldSeparator: "::"  // Use :: instead of #
});

// Now use :: for fields
await authz.allow({
  who: hr,
  toBe: "viewer",
  onWhat: { type: "employee", id: "emp123::salary" }
});
```

## Application Integration

### API Handler with Field Filtering

```typescript
async function getEmployee(requesterId: string, employeeId: string) {
  const requester = { type: "user", id: requesterId };
  const employee = { type: "employee", id: employeeId };

  // Check base record access
  const canView = await authz.check({
    who: requester,
    canThey: "view",
    onWhat: employee
  });

  if (!canView) {
    throw new ForbiddenError("Cannot view this employee");
  }

  // Get full record from database
  const data = await db.employees.findUnique({
    where: { id: employeeId }
  });

  // Define sensitive fields
  const sensitiveFields = ["salary", "ssn", "bankAccount", "medicalInfo"];

  // Filter based on field-level permissions
  for (const field of sensitiveFields) {
    const canViewField = await authz.check({
      who: requester,
      canThey: "view",
      onWhat: { type: "employee", id: `${employeeId}#${field}` }
    });

    if (!canViewField) {
      delete data[field];  // Redact field
    }
  }

  return data;
}
```

### Optimized Field Check

Use parallel checks for better performance:

```typescript
async function getEmployeeWithPermissions(requesterId: string, employeeId: string) {
  const requester = { type: "user", id: requesterId };

  // Get data
  const data = await db.employees.findUnique({ where: { id: employeeId } });

  const sensitiveFields = ["salary", "ssn", "bankAccount"];

  // Check all fields in parallel
  const checks = await Promise.all(
    sensitiveFields.map(field =>
      authz.check({
        who: requester,
        canThey: "view",
        onWhat: { type: "employee", id: `${employeeId}#${field}` }
      }).then(allowed => ({ field, allowed }))
    )
  );

  // Build permissions map
  const fieldPermissions: Record<string, boolean> = {};
  for (const { field, allowed } of checks) {
    fieldPermissions[field] = allowed;
    if (!allowed) {
      delete data[field];
    }
  }

  return { data, fieldPermissions };
}
```

### Edit Handler with Field Validation

```typescript
async function updateEmployee(
  requesterId: string,
  employeeId: string,
  updates: Partial<Employee>
) {
  const requester = { type: "user", id: requesterId };

  // Check which fields are being updated
  const sensitiveFields = ["salary", "ssn", "bankAccount"];
  const updatingFields = Object.keys(updates);

  for (const field of updatingFields) {
    // Determine if field is sensitive
    const isSensitive = sensitiveFields.includes(field);
    const objectId = isSensitive ? `${employeeId}#${field}` : employeeId;

    const canEdit = await authz.check({
      who: requester,
      canThey: "edit",
      onWhat: { type: "employee", id: objectId }
    });

    if (!canEdit) {
      throw new ForbiddenError(`Cannot edit field: ${field}`);
    }
  }

  // All checks passed, perform update
  return db.employees.update({
    where: { id: employeeId },
    data: updates
  });
}
```

## Common Scenarios

### HR System with Role-Based Field Access

```typescript
const employeeId = "emp123";
const employee = { type: "employee", id: employeeId };

// Employee can view own record (except salary)
await authz.allow({
  who: { type: "user", id: employeeId },
  toBe: "viewer",
  onWhat: employee
});

// Manager can view team member records (except salary)
await authz.allow({
  who: { type: "user", id: "manager1" },
  toBe: "viewer",
  onWhat: employee
});

// HR can view everything including salary
await authz.allow({
  who: { type: "user", id: "hr1" },
  toBe: "viewer",
  onWhat: employee
});
await authz.allow({
  who: { type: "user", id: "hr1" },
  toBe: "viewer",
  onWhat: { type: "employee", id: `${employeeId}#salary` }
});

// Payroll can edit salary
await authz.allow({
  who: { type: "user", id: "payroll1" },
  toBe: "editor",
  onWhat: { type: "employee", id: `${employeeId}#salary` }
});
```

### Performance Review with Section Access

```typescript
const reviewId = "review1";
const review = { type: "review", id: reviewId };

// Manager owns the review
await authz.allow({
  who: { type: "user", id: "manager1" },
  toBe: "owner",
  onWhat: review
});

// Employee can initially only view "strengths" section
await authz.allow({
  who: { type: "user", id: "emp1" },
  toBe: "viewer",
  onWhat: { type: "review", id: `${reviewId}#strengths` }
});

// Later, grant employee edit access to self-assessment
await authz.allow({
  who: { type: "user", id: "emp1" },
  toBe: "editor",
  onWhat: { type: "review", id: `${reviewId}#self_assessment` }
});
```

### Medical Records with Specialty Access

```typescript
const patientId = "patient123";
const record = { type: "medical_record", id: patientId };

// Primary physician has full access
await authz.allow({
  who: { type: "user", id: "dr_primary" },
  toBe: "owner",
  onWhat: record
});

// Specialist can only access relevant sections
await authz.allow({
  who: { type: "user", id: "dr_cardio" },
  toBe: "viewer",
  onWhat: { type: "medical_record", id: `${patientId}#cardiology` }
});
await authz.allow({
  who: { type: "user", id: "dr_cardio" },
  toBe: "editor",
  onWhat: { type: "medical_record", id: `${patientId}#cardiology_notes` }
});

// Mental health records are extra protected
// Only psychiatrist can access
await authz.allow({
  who: { type: "user", id: "dr_psych" },
  toBe: "viewer",
  onWhat: { type: "medical_record", id: `${patientId}#mental_health` }
});
```

## Nested Fields

Multiple separators are supported:

```typescript
// Permission on section
await authz.allow({
  who: hr,
  toBe: "editor",
  onWhat: { type: "document", id: "doc1#compensation" }
});

// Check nested field
await authz.check({
  who: hr,
  canThey: "edit",
  onWhat: { type: "document", id: "doc1#compensation#bonus" }
});
// Polizy checks: doc1#compensation#bonus
// Falls back to: doc1#compensation (uses last separator)
// HR can edit because they have access to compensation section
```

## Best Practices

1. **Define sensitive fields upfront** - Know what needs protection
2. **Default to restricted** - Check field permission, not just record
3. **Use consistent field names** - `salary` not sometimes `pay` or `compensation`
4. **Audit field access** - Log who accessed sensitive fields
5. **Filter in API layer** - Never return sensitive fields to frontend without checking

## Anti-Patterns

### Don't: Return sensitive data and filter on frontend

```typescript
// ❌ Bad - sensitive data sent over wire
return {
  employee: fullEmployeeRecord,
  canViewSalary: await checkSalaryAccess()
};
// Frontend filters, but data already exposed

// ✅ Good - filter on server
const data = await getEmployee(requesterId, employeeId);
// Salary already removed if not authorized
return { employee: data };
```

### Don't: Rely on base record access for fields

```typescript
// ❌ Bad - assuming record access means field access
const canView = await authz.check({ who, canThey: "view", onWhat: employee });
if (canView) {
  return fullRecord;  // Exposes salary!
}

// ✅ Good - check each sensitive field
const canView = await authz.check({ who, canThey: "view", onWhat: employee });
const canViewSalary = await authz.check({ who, canThey: "view", onWhat: salaryField });
return filterRecord(fullRecord, { salary: canViewSalary });
```

### Don't: Use inconsistent separators

```typescript
// ❌ Bad - inconsistent
"emp123#salary"
"emp123.ssn"
"emp123/medical"

// ✅ Good - consistent separator
"emp123#salary"
"emp123#ssn"
"emp123#medical"
```
