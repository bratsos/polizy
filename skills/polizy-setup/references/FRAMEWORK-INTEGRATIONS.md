# Framework Integrations

## Express.js

### Middleware Setup

```typescript
// auth.ts
import { defineSchema, AuthSystem } from "polizy";
import { PrismaAdapter } from "polizy/prisma-storage";
import { PrismaClient } from "@prisma/client";

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

const prisma = new PrismaClient();
export const authz = new AuthSystem({
  storage: PrismaAdapter(prisma),
  schema,
});
```

### Authorization Middleware

```typescript
// middleware/authorize.ts
import { Request, Response, NextFunction } from "express";
import { authz } from "../auth";

export function authorize(action: string, getObject: (req: Request) => { type: string; id: string }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const object = getObject(req);
    const allowed = await authz.check({
      who: { type: "user", id: userId },
      canThey: action,
      onWhat: object,
    });

    if (!allowed) {
      return res.status(403).json({ error: "Forbidden" });
    }

    next();
  };
}
```

### Route Usage

```typescript
// routes/documents.ts
import { Router } from "express";
import { authorize } from "../middleware/authorize";

const router = Router();

router.get(
  "/documents/:id",
  authorize("view", (req) => ({ type: "document", id: req.params.id })),
  async (req, res) => {
    const doc = await getDocument(req.params.id);
    res.json(doc);
  }
);

router.put(
  "/documents/:id",
  authorize("edit", (req) => ({ type: "document", id: req.params.id })),
  async (req, res) => {
    const doc = await updateDocument(req.params.id, req.body);
    res.json(doc);
  }
);

router.delete(
  "/documents/:id",
  authorize("delete", (req) => ({ type: "document", id: req.params.id })),
  async (req, res) => {
    await deleteDocument(req.params.id);
    res.status(204).send();
  }
);
```

---

## Next.js (App Router)

### Auth Module

```typescript
// lib/auth.ts
import { defineSchema, AuthSystem } from "polizy";
import { PrismaAdapter } from "polizy/prisma-storage";
import { prisma } from "./prisma";

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

export const authz = new AuthSystem({
  storage: PrismaAdapter(prisma),
  schema,
});
```

### Server Action

```typescript
// app/documents/actions.ts
"use server";

import { authz } from "@/lib/auth";
import { getCurrentUser } from "@/lib/session";

export async function updateDocument(docId: string, content: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");

  const allowed = await authz.check({
    who: { type: "user", id: user.id },
    canThey: "edit",
    onWhat: { type: "document", id: docId },
  });

  if (!allowed) throw new Error("Forbidden");

  return await prisma.document.update({
    where: { id: docId },
    data: { content },
  });
}
```

### API Route

```typescript
// app/api/documents/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { authz } from "@/lib/auth";
import { getCurrentUser } from "@/lib/session";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allowed = await authz.check({
    who: { type: "user", id: user.id },
    canThey: "view",
    onWhat: { type: "document", id: params.id },
  });

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const doc = await getDocument(params.id);
  return NextResponse.json(doc);
}
```

### React Component with Permission Check

```typescript
// components/DocumentActions.tsx
"use client";

import { useEffect, useState } from "react";
import { checkPermission } from "@/app/documents/actions";

export function DocumentActions({ docId }: { docId: string }) {
  const [canEdit, setCanEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);

  useEffect(() => {
    async function loadPermissions() {
      const [edit, del] = await Promise.all([
        checkPermission(docId, "edit"),
        checkPermission(docId, "delete"),
      ]);
      setCanEdit(edit);
      setCanDelete(del);
    }
    loadPermissions();
  }, [docId]);

  return (
    <div>
      {canEdit && <button>Edit</button>}
      {canDelete && <button>Delete</button>}
    </div>
  );
}
```

---

## React Router v7

### Loader Authorization

```typescript
// routes/document.tsx
import { data, LoaderFunctionArgs } from "react-router";
import { authz } from "~/lib/auth";
import { getSession } from "~/lib/session.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const session = await getSession(request);
  if (!session.userId) {
    throw data({ error: "Unauthorized" }, { status: 401 });
  }

  const allowed = await authz.check({
    who: { type: "user", id: session.userId },
    canThey: "view",
    onWhat: { type: "document", id: params.id! },
  });

  if (!allowed) {
    throw data({ error: "Forbidden" }, { status: 403 });
  }

  const document = await getDocument(params.id!);
  return { document };
}
```

### Action Authorization

```typescript
// routes/document.tsx
export async function action({ request, params }: ActionFunctionArgs) {
  const session = await getSession(request);
  if (!session.userId) {
    throw data({ error: "Unauthorized" }, { status: 401 });
  }

  const allowed = await authz.check({
    who: { type: "user", id: session.userId },
    canThey: "edit",
    onWhat: { type: "document", id: params.id! },
  });

  if (!allowed) {
    throw data({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await request.formData();
  await updateDocument(params.id!, Object.fromEntries(formData));
  return { success: true };
}
```

---

## Fastify

```typescript
import Fastify from "fastify";
import { authz } from "./auth";

const fastify = Fastify();

// Decorator for authorization
fastify.decorateRequest("authorize", async function (action: string, object: { type: string; id: string }) {
  const userId = this.user?.id;
  if (!userId) return false;

  return authz.check({
    who: { type: "user", id: userId },
    canThey: action,
    onWhat: object,
  });
});

// Route with authorization
fastify.get("/documents/:id", async (request, reply) => {
  const { id } = request.params as { id: string };

  const allowed = await request.authorize("view", { type: "document", id });
  if (!allowed) {
    return reply.status(403).send({ error: "Forbidden" });
  }

  const doc = await getDocument(id);
  return doc;
});
```

---

## tRPC

```typescript
// server/trpc.ts
import { initTRPC, TRPCError } from "@trpc/server";
import { authz } from "./auth";

const t = initTRPC.context<Context>().create();

export const authorizedProcedure = t.procedure.use(async ({ ctx, next, input }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

// router/documents.ts
export const documentRouter = t.router({
  get: authorizedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const allowed = await authz.check({
        who: { type: "user", id: ctx.user.id },
        canThey: "view",
        onWhat: { type: "document", id: input.id },
      });

      if (!allowed) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      return getDocument(input.id);
    }),
});
```
