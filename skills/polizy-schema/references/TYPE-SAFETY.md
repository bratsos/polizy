# Type Safety in Polizy

Polizy provides full TypeScript support with compile-time checking for relations and actions.

## How Type Inference Works

When you use `defineSchema`, TypeScript captures the literal types of your relations and actions:

```typescript
import { defineSchema } from "polizy";

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
  },
});

// TypeScript now knows:
// - Valid relations: "owner" | "editor" | "viewer"
// - Valid actions: "delete" | "edit" | "view"
```

## Type-Safe API Usage

### AuthSystem is Generic

```typescript
import { AuthSystem, InMemoryStorageAdapter } from "polizy";

const authz = new AuthSystem({
  storage: new InMemoryStorageAdapter(),
  schema,
});

// ✅ Valid - "owner" is a defined relation
await authz.allow({
  who: { type: "user", id: "alice" },
  toBe: "owner",
  onWhat: { type: "document", id: "doc1" },
});

// ❌ Compile error - "admin" is not a defined relation
await authz.allow({
  who: { type: "user", id: "alice" },
  toBe: "admin",  // Error: Type '"admin"' is not assignable to type '"owner" | "editor" | "viewer"'
  onWhat: { type: "document", id: "doc1" },
});
```

### Type-Safe Checks

```typescript
// ✅ Valid - "edit" is a defined action
await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "edit",
  onWhat: { type: "document", id: "doc1" },
});

// ❌ Compile error - "manage" is not a defined action
await authz.check({
  who: { type: "user", id: "alice" },
  canThey: "manage",  // Error: Type '"manage"' is not assignable to type '"delete" | "edit" | "view"'
  onWhat: { type: "document", id: "doc1" },
});
```

## Extracting Types from Schema

You can extract relation and action types for use elsewhere:

```typescript
import { defineSchema, AuthSystem, InMemoryStorageAdapter } from "polizy";

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

// Extract the schema type
type MySchema = typeof schema;

// Extract relation names
type MyRelations = keyof MySchema["relations"];
// = "owner" | "editor" | "viewer" | "member"

// Extract action names
type MyActions = keyof MySchema["actionToRelations"];
// = "delete" | "edit" | "view"
```

## Using Types in Application Code

### Type-Safe Permission Helpers

```typescript
// Create a typed authorization helper
function createPermissionChecker(authz: AuthSystem<typeof schema>) {
  return {
    canView: (userId: string, docId: string) =>
      authz.check({
        who: { type: "user", id: userId },
        canThey: "view",
        onWhat: { type: "document", id: docId },
      }),

    canEdit: (userId: string, docId: string) =>
      authz.check({
        who: { type: "user", id: userId },
        canThey: "edit",
        onWhat: { type: "document", id: docId },
      }),

    canDelete: (userId: string, docId: string) =>
      authz.check({
        who: { type: "user", id: userId },
        canThey: "delete",
        onWhat: { type: "document", id: docId },
      }),
  };
}

const permissions = createPermissionChecker(authz);

// Type-safe usage
await permissions.canView("alice", "doc1");
```

### Type-Safe Middleware

```typescript
import { AuthSystem } from "polizy";

// Generic middleware factory
function authorize<S extends AuthSchema>(
  authz: AuthSystem<S>,
  action: keyof S["actionToRelations"],
  getObject: (req: Request) => { type: string; id: string }
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const allowed = await authz.check({
      who: { type: "user", id: req.user.id },
      canThey: action,
      onWhat: getObject(req),
    });

    if (!allowed) {
      return res.status(403).json({ error: "Forbidden" });
    }

    next();
  };
}

// Usage - TypeScript ensures action is valid
app.get(
  "/documents/:id",
  authorize(authz, "view", (req) => ({ type: "document", id: req.params.id })),
  handler
);

// ❌ Compile error if action doesn't exist
app.get(
  "/documents/:id",
  authorize(authz, "invalid_action", (req) => ({ type: "document", id: req.params.id })),
  // Error: Argument of type '"invalid_action"' is not assignable...
  handler
);
```

## Subject and Object Types

Polizy uses these core types:

```typescript
// Subject - who is performing the action
type Subject = {
  type: string;
  id: string;
};

// Object - what is being accessed
type AnyObject = {
  type: string;
  id: string;
};

// Example usage
const user: Subject = { type: "user", id: "alice" };
const doc: AnyObject = { type: "document", id: "doc1" };
```

### Custom Type Constraints

You can create stricter types for your domain:

```typescript
// Define your subject types
type UserSubject = { type: "user"; id: string };
type ServiceSubject = { type: "service"; id: string };
type TeamSubject = { type: "team"; id: string };

type MySubject = UserSubject | ServiceSubject | TeamSubject;

// Define your object types
type DocumentObject = { type: "document"; id: string };
type FolderObject = { type: "folder"; id: string };
type ProjectObject = { type: "project"; id: string };

type MyObject = DocumentObject | FolderObject | ProjectObject;

// Type-safe helper
async function checkPermission(
  who: MySubject,
  canThey: MyActions,
  onWhat: MyObject
): Promise<boolean> {
  return authz.check({ who, canThey, onWhat });
}

// ✅ Valid
await checkPermission(
  { type: "user", id: "alice" },
  "edit",
  { type: "document", id: "doc1" }
);

// ❌ Compile error - invalid subject type
await checkPermission(
  { type: "robot", id: "r2d2" },  // Error
  "edit",
  { type: "document", id: "doc1" }
);
```

## Stored Tuple Types

When listing tuples, you get typed results:

```typescript
const tuples = await authz.listTuples({
  subject: { type: "user", id: "alice" },
});

// Each tuple has the structure:
type StoredTuple = {
  subject: { type: string; id: string };
  relation: string;  // One of your defined relations
  object: { type: string; id: string };
  condition?: {
    validSince?: Date;
    validUntil?: Date;
  };
};

for (const tuple of tuples) {
  console.log(`${tuple.subject.id} is ${tuple.relation} on ${tuple.object.id}`);
}
```

## Generic AuthSystem Usage

When passing AuthSystem around, preserve the type:

```typescript
// ❌ Loses type information
function badHelper(authz: AuthSystem<any>) {
  // No autocomplete, no compile-time checking
}

// ✅ Preserves type information
function goodHelper<S extends AuthSchema>(authz: AuthSystem<S>) {
  // Full autocomplete and compile-time checking
}

// ✅ Or use the specific schema type
const schema = defineSchema({ ... });
type MySchema = typeof schema;

function specificHelper(authz: AuthSystem<MySchema>) {
  // Full type safety
}
```

## IDE Support

With proper TypeScript setup, you get:

1. **Autocomplete** for relations and actions
2. **Inline errors** for invalid values
3. **Hover documentation** for types
4. **Refactoring support** when renaming relations/actions

```typescript
// In your IDE, typing "toBe:" will show:
// - owner
// - editor
// - viewer
// - member

await authz.allow({
  who: user,
  toBe: "ed|",  // Autocomplete suggests "editor"
  onWhat: doc,
});
```

## Best Practices

1. **Define schema in a central file** - Import everywhere for consistent types
2. **Export the schema type** - `export type MySchema = typeof schema;`
3. **Use const assertions** - Already built into `defineSchema`
4. **Avoid `any`** - Preserve type information in helpers
5. **Create typed wrappers** - Domain-specific permission helpers

```typescript
// auth/schema.ts
export const schema = defineSchema({ ... });
export type Schema = typeof schema;
export type Relation = keyof Schema["relations"];
export type Action = keyof Schema["actionToRelations"];

// auth/authz.ts
import { schema, Schema } from "./schema";
import { AuthSystem, InMemoryStorageAdapter } from "polizy";

export const authz = new AuthSystem<Schema>({
  storage: new InMemoryStorageAdapter(),
  schema,
});

// Now import authz anywhere with full type safety
```
