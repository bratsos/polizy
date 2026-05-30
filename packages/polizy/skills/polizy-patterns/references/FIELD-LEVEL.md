# Field-Level Permissions Pattern

Protect sensitive fields within records (salary, SSN, medical data).

## When to Use

- Sensitive personal information (PII)
- Salary and compensation data
- Medical records
- Financial information
- Any field that needs stricter access than the containing record

## How It Works

Polizy uses a field separator (default: `#`) to identify field-level ids:

```
document:doc1          → Base object
document:doc1#salary   → Salary field of doc1
document:doc1#ssn      → SSN field of doc1
```

When checking `doc1#salary`, polizy checks, in order:
1. Does the subject have permission on `doc1#salary` specifically?
2. Does the subject have permission on the **base** object `doc1`?

So **a grant on the base authorizes every field of that object** — through
direct, group, *and* hierarchy paths (a folder viewer reaches `doc#field` of
documents in that folder). A grant on a specific field stays scoped to that one
field. Field permissions therefore add *narrower* access on top of base access;
they don't subtract from it.

> **Consequence:** you cannot give someone the base record while hiding one of
> its fields with a field grant. To keep a field private from a subject, simply
> don't grant them the base object — grant only the fields they should see.

## Schema Setup (opt-in)

**Field-level ids are opt-in in 0.3.0.** List every object type that uses field
ids in `fieldLevelObjects`. Types you don't list never split on the separator,
so ids that naturally contain `#` can't accidentally inherit access.

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
  fieldLevelObjects: ["employee"], // ← required to enable "employee:emp123#salary"
  // fieldSeparator: "#"  (default)
});

const authz = new AuthSystem({
  storage: new InMemoryStorageAdapter(),
  schema,
});
```

If a type is **not** in `fieldLevelObjects`, an id like `emp123#salary` is treated
as a literal opaque id — no base fallback. If you relied on `#` inheritance in
0.2.x and earlier and don't add the type here, those checks now return `false`.

## Basic Field-Level Pattern

The key design rule: **base grants see everything, field grants see only their
field.** Give the base object to roles allowed full access, and give scoped field
grants to roles allowed partial access.

### Granting Field Access

```typescript
const employee = { type: "employee", id: "emp123" };
const salaryField = { type: "employee", id: "emp123#salary" };

// HR manager sees the whole record — base grant authorizes all fields too
await authz.allow({
  who: { type: "user", id: "hr_manager" },
  toBe: "viewer",
  onWhat: employee
});

// Payroll sees ONLY the salary field — scoped field grant, no base grant
await authz.allow({
  who: { type: "user", id: "payroll" },
  toBe: "editor",
  onWhat: salaryField
});
```

### Checking Field Access

```typescript
const hr = { type: "user", id: "hr_manager" };
const payroll = { type: "user", id: "payroll" };

// HR can view the record
await authz.check({
  who: hr,
  canThey: "view",
  onWhat: { type: "employee", id: "emp123" }
}); // true

// HR can view the salary field (base → field)
await authz.check({
  who: hr,
  canThey: "view",
  onWhat: { type: "employee", id: "emp123#salary" }
}); // true

// Payroll can edit the salary field
await authz.check({
  who: payroll,
  canThey: "edit",
  onWhat: { type: "employee", id: "emp123#salary" }
}); // true

// Payroll CANNOT view the rest of the record (no base grant)
await authz.check({
  who: payroll,
  canThey: "view",
  onWhat: { type: "employee", id: "emp123" }
}); // false
```

### Field Access via Group and Hierarchy

Base-to-field propagation works through groups and hierarchy too — not just
direct grants. A folder viewer reaches every field of documents in that folder:

```typescript
// Folder hierarchy (schema needs a hierarchy relation + hierarchyPropagation)
await authz.setParent({
  child: { type: "document", id: "doc1" },
  parent: { type: "folder", id: "folder1" }
});

// Team viewer at folder level
await authz.allow({
  who: { type: "team", id: "legal" },
  toBe: "viewer",
  onWhat: { type: "folder", id: "folder1" }
});
await authz.addMember({
  member: { type: "user", id: "dana" },
  group: { type: "team", id: "legal" }
});

// dana reaches doc1#summary through team → folder → doc base → field
await authz.check({
  who: { type: "user", id: "dana" },
  canThey: "view",
  onWhat: { type: "document", id: "doc1#summary" }
}); // true
```

## Custom Field Separator

If your base ids contain `#`, use a different separator. Set it on the schema
(or override per-instance via the constructor's `fieldSeparator`):

```typescript
// On the schema
const schema = defineSchema({
  relations: { viewer: { type: "direct" } },
  actionToRelations: { view: ["viewer"] },
  fieldLevelObjects: ["employee"],
  fieldSeparator: "::"  // Use :: instead of #
});

// Or override at construction (takes precedence over the schema's separator)
const authz = new AuthSystem({ storage, schema, fieldSeparator: "::" });

// Now use :: for fields
await authz.allow({
  who: { type: "user", id: "hr_manager" },
  toBe: "viewer",
  onWhat: { type: "employee", id: "emp123::salary" }
});
```

## Application Integration

### API Handler with Field Filtering

Because a base grant authorizes every field, check **each field independently**
rather than gating on the base record (which would let a base-holder see all of
them — that's intended; the redaction below is for subjects who only hold
specific fields):

```typescript
async function getEmployee(requesterId: string, employeeId: string) {
  const requester = { type: "user", id: requesterId };

  // Fields the endpoint can return
  const allFields = ["name", "title", "email", "salary", "ssn", "bankAccount"];

  // Get full record from database
  const data = await db.employees.findUnique({ where: { id: employeeId } });

  // Check every field — base-holders pass them all, field-grantees pass a subset
  const checks = await authz.checkMany(
    allFields.map((field) => ({
      who: requester,
      canThey: "view",
      onWhat: { type: "employee", id: `${employeeId}#${field}` }
    }))
  );

  allFields.forEach((field, i) => {
    if (!checks[i]) delete (data as Record<string, unknown>)[field];
  });

  // No fields visible at all → 403
  if (allFields.every((_, i) => !checks[i])) {
    throw new ForbiddenError("Cannot view this employee");
  }

  return data;
}
```

### Batched Field Check

Use `checkMany` to resolve every field in one call (no N+1 loop):

```typescript
async function getEmployeeWithPermissions(requesterId: string, employeeId: string) {
  const requester = { type: "user", id: requesterId };

  // Get data
  const data = await db.employees.findUnique({ where: { id: employeeId } });

  const sensitiveFields = ["salary", "ssn", "bankAccount"];

  // One batched call instead of N checks
  const results = await authz.checkMany(
    sensitiveFields.map((field) => ({
      who: requester,
      canThey: "view",
      onWhat: { type: "employee", id: `${employeeId}#${field}` }
    }))
  );

  // Build permissions map
  const fieldPermissions: Record<string, boolean> = {};
  sensitiveFields.forEach((field, i) => {
    fieldPermissions[field] = results[i];
    if (!results[i]) delete (data as Record<string, unknown>)[field];
  });

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

Remember: a base grant authorizes every field. So to keep salary hidden from the
employee and their manager, grant them **only the non-salary fields** (not the
base record). Only roles allowed to see salary get the base grant.

```typescript
const employeeId = "emp123";
const employee = { type: "employee", id: employeeId };
const nonSalaryFields = ["name", "title", "email", "department"];

// Employee can view own non-salary fields (NOT the base record)
for (const field of nonSalaryFields) {
  await authz.allow({
    who: { type: "user", id: employeeId },
    toBe: "viewer",
    onWhat: { type: "employee", id: `${employeeId}#${field}` }
  });
}

// Manager can view the same non-salary fields for a team member
for (const field of nonSalaryFields) {
  await authz.allow({
    who: { type: "user", id: "manager1" },
    toBe: "viewer",
    onWhat: { type: "employee", id: `${employeeId}#${field}` }
  });
}

// HR can view everything — a single base grant covers salary and every field
await authz.allow({
  who: { type: "user", id: "hr1" },
  toBe: "viewer",
  onWhat: employee
});

// Payroll can edit only salary
await authz.allow({
  who: { type: "user", id: "payroll1" },
  toBe: "editor",
  onWhat: { type: "employee", id: `${employeeId}#salary` }
});
```

> If you'd rather grant the base record broadly and protect *only* a couple of
> fields, polizy's grants-only model can't "subtract" — you'd instead model the
> sensitive field as a **separate object type** (e.g. `salary_record`) that the
> base record does not contain. Choose the field-grant approach above when the
> default should be *no* access.

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

Multiple separators are supported, but the base fallback is **one level deep**
(it splits on the *last* separator only):

```typescript
const hr = { type: "user", id: "hr_manager" };

// Permission on the compensation section
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
}); // true
// Polizy checks: doc1#compensation#bonus
// Falls back to: doc1#compensation (last separator)
// HR can edit because they hold the compensation section.
```

> The fallback is single-level. A grant on the top-level base `doc1` authorizes
> `doc1#compensation` (one hop) but **not** `doc1#compensation#bonus` (two hops).
> If you need deep sections to inherit from the top, grant at each section level
> or model sections as a hierarchy. (`document` must be in `fieldLevelObjects`.)

## Best Practices

1. **Declare `fieldLevelObjects`** - Field ids do nothing until the type opts in
2. **Don't grant the base to partial-access roles** - Base grants see every field
3. **Check each field, not the record** - Gating on base access leaks all fields
4. **Use consistent field names** - `salary` not sometimes `pay` or `compensation`
5. **Filter in the API layer** - Never return un-checked sensitive fields to the client

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

### Don't: Grant the base record to subjects who shouldn't see every field

In 0.3.0 a base grant authorizes **all** fields. Granting the base "to be safe"
silently exposes salary/PII.

```typescript
// ❌ Bad - base grant leaks every field (including salary)
await authz.allow({ who: employee, toBe: "viewer", onWhat: { type: "employee", id } });
await authz.check({ who: employee, canThey: "view",
  onWhat: { type: "employee", id: `${id}#salary` } }); // true — leaked!

// ✅ Good - grant only the fields they may see; never the base
for (const field of ["name", "title", "email"]) {
  await authz.allow({ who: employee, toBe: "viewer",
    onWhat: { type: "employee", id: `${id}#${field}` } });
}
```

### Don't: Forget to declare `fieldLevelObjects`

```typescript
// ❌ Bad - field ids do nothing; check treats them as literal opaque ids
const schema = defineSchema({
  relations: { viewer: { type: "direct" } },
  actionToRelations: { view: ["viewer"] },
  // fieldLevelObjects missing → "employee:emp1#salary" never falls back to base
});

// ✅ Good - opt the type in
const schema = defineSchema({
  relations: { viewer: { type: "direct" } },
  actionToRelations: { view: ["viewer"] },
  fieldLevelObjects: ["employee"],
});
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
