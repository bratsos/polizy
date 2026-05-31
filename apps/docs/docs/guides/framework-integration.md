---
title: Framework Integration
sidebar_position: 11
---

# Framework Integration

Once you have defined your schema and setup permission rules, you need to integrate polizy into your application's request pipeline. 

The general integration pattern works in three steps:
1. **Resolve the subject**: Extract the current user/client identifier from your session, JWT, or request context.
2. **Determine the action and object**: Extract the resource type, identifier, and action from the route parameters.
3. **Assert access**: Call `check()` to return a boolean, or `checkOrThrow()` to throw an error, and handle the unauthorized state.

This guide shows how to write a generic Express-style middleware and adapt this pattern to any web framework.

:::note[Theory & Concepts]

To learn more about checking permissions and passing targets, read **[Relations and Actions](../core-concepts/relations-and-actions.md)**.

:::

## 1. Using `check()` (Boolean Flow)

This is the standard approach. Call `check()`, and if it returns `false`, return a `403 Forbidden` response to the client.

Here is a generic Express-style middleware:

```ts
import { Request, Response, NextFunction } from "express";
import { authz } from "./authz-system"; // Your initialized AuthSystem instance

export function authorize(action: string, objectType: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // 1. Resolve subject from the authenticated session
    const userId = req.user?.id; 
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // 2. Resolve target object from the route parameters (e.g. /documents/:id)
    const objectId = req.params.id;
    if (!objectId) {
      return res.status(400).json({ error: "Missing resource ID" });
    }

    // 3. Perform the check
    const allowed = await authz.check({
      who: { type: "user", id: userId },
      canThey: action,
      onWhat: { type: objectType, id: objectId },
    });

    if (!allowed) {
      return res.status(403).json({ error: "Forbidden" });
    }

    next();
  };
}
```

Usage in a route:
```ts
import { Router } from "express";
const router = Router();

// Only users with "edit" permission on document:<id> can access this route
router.put("/documents/:id", authorize("edit", "document"), (req, res) => {
  res.json({ message: "Document updated successfully" });
});
```

---

## 2. Using `checkOrThrow()` (Error-Handling Flow)

Alternatively, you can call `checkOrThrow()`, which throws a `NotAuthorizedError` if the check fails. This is highly effective when combined with a global error handler or error boundary.

```ts
import { Request, Response, NextFunction } from "express";
import { authz } from "./authz-system";
import { NotAuthorizedError } from "polizy";

export async function editDocumentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    const documentId = req.params.id;

    if (!userId || !documentId) {
      return res.status(400).json({ error: "Bad Request" });
    }

    // Throws NotAuthorizedError if not allowed
    await authz.checkOrThrow({
      who: { type: "user", id: userId },
      canThey: "edit",
      onWhat: { type: "document", id: documentId },
    });

    // Proceed with business logic...
    res.json({ message: "Saved changes." });
  } catch (error) {
    if (error instanceof NotAuthorizedError) {
      return res.status(403).json({ error: "Forbidden: You do not have permission to edit this document." });
    }
    next(error);
  }
}
```

---

## 3. Adapting to Other Frameworks

This pattern applies cleanly to other frameworks (such as NestJS, Fastify, Next.js App Router, or Koa):

- **Next.js Route Handlers**: Resolve the user session using your auth provider (e.g. Auth0, Clerk, or NextAuth), invoke `check()` or `checkOrThrow()`, and return `new NextResponse("Forbidden", { status: 403 })` or let the global error boundary catch `NotAuthorizedError`.
- **NestJS Guards**: Inject your `AuthSystem` provider into a custom Guard, fetch the request metadata, run the check, and return `boolean` or throw `ForbiddenException`.
- **Fastify Hook**: Add an `onRequest` or `preHandler` hook that extracts parameters, validates access via polizy, and calls `reply.code(403).send(...)`.
