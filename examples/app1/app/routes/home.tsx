import type { AnyObject, SchemaObjectTypes } from "polizy";
import * as React from "react";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useActionData, useLoaderData } from "react-router";
import { z } from "zod";
import DbResetCountdown from "../components/DbResetCountdown";
import UserResourceView from "../components/UserResourceView";

import { authz, type docSchema, prisma } from "../lib/polizy.server";

type Action = keyof typeof docSchema.actionToRelations;

export type DbEntity = {
  id: string;
  name: string;
  type: "folder" | "document" | "team";
};

export type ResourceData = {
  id: string;
  name: string;
  type: "folder" | "document" | "team";
  parent?: string;
  allowedActions: Action[];
};

export type AllEntitiesData = {
  id: string;
  name: string;
  type: "folder" | "document" | "team";
};

export type HomeLoaderData = {
  userData: Record<
    string,
    {
      userId: string;
      resources: ResourceData[];
    }
  >;
  allEntities: AllEntitiesData[];

  allTuples: {
    id: string;
    subjectType: string;
    subjectId: string;
    relation: string;
    objectType: string;
    objectId: string;
    condition?: any;
  }[];
  dbResetIntervalMinutes: number;
};

const ResourceTypeSchema = z.enum(["document", "folder", "team"]);

const BaseActionSchema = z.object({
  actingUserId: z.string().min(1, "Acting user ID is required."),
});

const ShareActionSchema = BaseActionSchema.extend({
  intent: z.literal("share"),
  resourceId: z.string().min(1, "Resource ID is required."),
  resourceType: ResourceTypeSchema,
  targetUserId: z.string().optional().default("charlie"),
});

const DeleteActionSchema = BaseActionSchema.extend({
  intent: z.literal("delete"),
  resourceId: z.string().min(1, "Resource ID is required."),
  resourceType: ResourceTypeSchema,
});

const CreateDocumentActionSchema = BaseActionSchema.extend({
  intent: z.literal("createDocument"),
  title: z.string().min(1, "Document title is required."),
});

const CreateFolderActionSchema = BaseActionSchema.extend({
  intent: z.literal("createFolder"),
  name: z.string().min(1, "Folder name is required."),
});

const CreateTeamActionSchema = BaseActionSchema.extend({
  intent: z.literal("createTeam"),
  name: z.string().min(1, "Team name is required."),
});

const ActionSchema = z.discriminatedUnion("intent", [
  ShareActionSchema,
  DeleteActionSchema,
  CreateDocumentActionSchema,
  CreateFolderActionSchema,
  CreateTeamActionSchema,
]);

/** Fetches all relevant entities (documents, folders, teams) from the database. */
async function fetchDatabaseEntities(): Promise<DbEntity[]> {
  const allDocs = await prisma.document.findMany();
  const allFolders = await prisma.folder.findMany();
  const allTeams = await prisma.team.findMany();

  const allDbResources: DbEntity[] = [
    ...allDocs.map((d) => ({
      id: d.id,
      name: d.title,
      type: "document" as const,
    })),
    ...allFolders.map((f) => ({
      id: f.id,
      name: f.name,
      type: "folder" as const,
    })),
    ...allTeams.map((t) => ({ id: t.id, name: t.name, type: "team" as const })),
  ];

  return allDbResources.sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.name.localeCompare(b.name);
  });
}

/** Fetches all Polizy tuples from the database. */
async function fetchPolicyTuples() {
  const allDbTuples = await prisma.polizyTuple.findMany({});
  return allDbTuples
    .map((t) => ({
      ...t,

      condition: t.condition ? JSON.stringify(t.condition) : null,
    }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** Fetches accessible resources for a specific user. */
async function fetchUserResources(userId: string): Promise<ResourceData[]> {
  const userSubject = { type: "user" as const, id: userId };

  const accessibleDocsResult = await authz.listAccessibleObjects({
    who: userSubject,
    ofType: "document",
  });
  const accessibleFoldersResult = await authz.listAccessibleObjects({
    who: userSubject,
    ofType: "folder",
  });
  const accessibleTeamsResult = await authz.listAccessibleObjects({
    who: userSubject,
    ofType: "team",
  });

  const allAccessible = [
    ...accessibleDocsResult.accessible,
    ...accessibleFoldersResult.accessible,
    ...accessibleTeamsResult.accessible,
  ];

  const relevantIds = new Set<string>();
  allAccessible.forEach((acc) => {
    relevantIds.add(acc.object.id);
    if (acc.parent?.id) {
      relevantIds.add(acc.parent.id);
    }
  });
  const relevantIdsArray = Array.from(relevantIds);

  const [docs, folders, teams] = await Promise.all([
    prisma.document.findMany({
      where: { id: { in: relevantIdsArray } },
      select: { id: true, title: true },
    }),
    prisma.folder.findMany({
      where: { id: { in: relevantIdsArray } },
      select: { id: true, name: true },
    }),
    prisma.team.findMany({
      where: { id: { in: relevantIdsArray } },
      select: { id: true, name: true },
    }),
  ]);

  const localResourceNameMap = new Map<string, string>();
  docs.forEach((d) => localResourceNameMap.set(d.id, d.title));
  folders.forEach((f) => localResourceNameMap.set(f.id, f.name));
  teams.forEach((t) => localResourceNameMap.set(t.id, t.name));

  const userResources = allAccessible.map((acc): ResourceData => {
    const name = localResourceNameMap.get(acc.object.id) || acc.object.id;

    return {
      id: acc.object.id,
      name: name,
      type: acc.object.type as "document" | "folder" | "team",
      parent: acc.parent?.id,
      allowedActions: acc.actions as Action[],
    };
  });

  return userResources.sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.name.localeCompare(b.name);
  });
}

export async function loader() {
  const users = ["alice", "bob", "charlie", "david"];

  const allDbEntities = await fetchDatabaseEntities();
  const allPolicyTuples = await fetchPolicyTuples();

  const userData: HomeLoaderData["userData"] = {};

  await Promise.all(
    users.map(async (userId) => {
      const userResources = await fetchUserResources(userId);
      userData[userId] = { userId, resources: userResources };
    }),
  );

  console.log("process.env.DB_RESET_INTERVAL_MINUTES");
  console.log(process.env.DB_RESET_INTERVAL_MINUTES);

  const intervalMinutesStr = process.env.DB_RESET_INTERVAL_MINUTES || "15";
  let intervalMinutes = Number.parseInt(intervalMinutesStr, 10);
  if (Number.isNaN(intervalMinutes) || intervalMinutes <= 0) {
    console.warn(
      `Loader: Invalid DB_RESET_INTERVAL_MINUTES value "${intervalMinutesStr}". Defaulting to 15 minutes.`,
    );
    intervalMinutes = 15;
  }

  const loaderData: HomeLoaderData = {
    userData,
    allEntities: allDbEntities,
    allTuples: allPolicyTuples,
    dbResetIntervalMinutes: intervalMinutes,
  };

  return data(loaderData);
}

export async function action({ request }: ActionFunctionArgs) {
  const formDataObject = Object.fromEntries(await request.formData());
  const parseResult = ActionSchema.safeParse(formDataObject);

  if (!parseResult.success) {
    const errorMessages = parseResult.error.errors
      .map((e) => `${e.path.join(".")}: ${e.message}`)
      .join("; ");
    return data(
      { ok: false, error: `Invalid form data: ${errorMessages}` },
      { status: 400 },
    );
  }

  const actionData = parseResult.data;
  const actingUserSubject = {
    type: "user" as const,
    id: actionData.actingUserId,
  };

  try {
    switch (actionData.intent) {
      case "share": {
        const { resourceId, resourceType, targetUserId, actingUserId } =
          actionData;
        const targetResource = { type: resourceType, id: resourceId };

        const canShare = await authz.check({
          who: actingUserSubject,
          canThey: "share",
          onWhat: targetResource,
        });

        if (!canShare) {
          return data(
            {
              ok: false,
              error: `User ${actingUserId} cannot share ${targetResource.type}:${targetResource.id}.`,
            },
            { status: 403 },
          );
        }

        const targetUserSubject = { type: "user" as const, id: targetUserId };
        await authz.allow({
          who: targetUserSubject,
          toBe: "viewer",
          onWhat: targetResource,
        });

        return data({
          ok: true,
          message: `Successfully shared ${targetResource.type}:${targetResource.id} with ${targetUserId}.`,
        });
      }
      case "delete": {
        const { resourceId, resourceType } = actionData;
        const targetObject: AnyObject<SchemaObjectTypes<typeof docSchema>> = {
          type: resourceType,
          id: resourceId,
        };

        const canDelete = await authz.check({
          who: actingUserSubject,
          canThey: "delete",
          onWhat: targetObject,
        });

        if (!canDelete) {
          return data({ ok: false, error: "Forbidden" }, { status: 403 });
        }

        switch (resourceType) {
          case "document":
            await prisma.document.delete({ where: { id: resourceId } });
            break;
          case "folder":
            await prisma.folder.delete({ where: { id: resourceId } });
            break;
          case "team":
            await prisma.team.delete({ where: { id: resourceId } });
            break;
          default:
            console.warn(
              `Attempted to delete unknown resource type: ${resourceType}`,
            );
            break;
        }

        await authz.disallowAllMatching({
          onWhat: { type: resourceType, id: resourceId },
        });
        await authz.disallowAllMatching({
          was: "parent",
        });

        return redirect("/");
      }
      case "createDocument": {
        const { title, actingUserId } = actionData;
        const newDocId = title
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, "");
        if (!newDocId) {
          return data(
            { ok: false, error: "Invalid title (results in empty ID)." },
            { status: 400 },
          );
        }
        const newDoc = await prisma.document.create({
          data: { id: newDocId, title: title, content: "" },
        });
        await authz.allow({
          who: { type: "user", id: actingUserId },
          toBe: "owner",
          onWhat: { type: "document", id: newDoc.id },
        });
        return data({ ok: true, message: `Document "${title}" created.` });
      }
      case "createFolder": {
        const { name, actingUserId } = actionData;
        const newFolderId = name
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, "");
        if (!newFolderId) {
          return data(
            { ok: false, error: "Invalid name (results in empty ID)." },
            { status: 400 },
          );
        }
        const newFolder = await prisma.folder.create({
          data: { id: newFolderId, name: name },
        });
        await authz.allow({
          who: { type: "user", id: actingUserId },
          toBe: "owner",
          onWhat: { type: "folder", id: newFolder.id },
        });
        return data({ ok: true, message: `Folder "${name}" created.` });
      }
      case "createTeam": {
        const { name, actingUserId } = actionData;
        const newTeamId = name
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, "");
        if (!newTeamId) {
          return data(
            { ok: false, error: "Invalid name (results in empty ID)." },
            { status: 400 },
          );
        }
        const newTeam = await prisma.team.create({
          data: { id: newTeamId, name: name },
        });
        await authz.allow({
          who: { type: "user", id: actingUserId },
          toBe: "owner",
          onWhat: { type: "team", id: newTeam.id },
        });
        return data({ ok: true, message: `Team "${name}" created.` });
      }
      default: {
        const _exhaustiveCheck: never = actionData;
        console.error("Unhandled action intent:", _exhaustiveCheck);
        return data(
          { ok: false, error: "Unhandled action intent." },
          { status: 500 },
        );
      }
    }
  } catch (error: any) {
    return data(
      {
        ok: false,
        error:
          error.message || `Failed to perform action "${actionData.intent}".`,
      },
      { status: 500 },
    );
  }
}

export default function Home() {
  const actionData = useActionData() as
    | { ok: boolean; error?: string; message?: string }
    | undefined;
  const { userData, allEntities, allTuples, dbResetIntervalMinutes } =
    useLoaderData<HomeLoaderData>();
  const users = Object.keys(userData);

  console.log("userData", userData);
  return (
    <main className="p-4 md:p-8">
      <h1 className="text-2xl md:text-3xl font-bold text-center mb-6 md:mb-8">
        PolizyDocs - Simple Sharing Demo
      </h1>
      <DbResetCountdown intervalMinutes={dbResetIntervalMinutes} />{" "}
      {/* Pass the interval as a prop */}
      {actionData && !actionData.ok && (
        <p className="text-red-500 text-center text-sm mb-4">
          Error: {actionData.error}
        </p>
      )}
      {actionData?.ok && (
        <p className="text-green-500 text-center text-sm mb-4">
          {actionData.message}
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        {users.map((userId) => {
          const data = userData[userId];
          if (!data) return null;
          return (
            <div
              key={userId}
              className="border border-gray-300 dark:border-gray-700 rounded-lg shadow-md p-4"
            >
              <h2 className="text-xl font-semibold mb-3 capitalize border-b pb-2 dark:border-gray-600">
                {userId}'s View
              </h2>
              <UserResourceView userId={userId} resources={data.resources} />
            </div>
          );
        })}
        <div className="md:col-span-2 mt-6 md:mt-0 grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          <div className="border border-gray-300 dark:border-gray-700 rounded-lg shadow-md p-4">
            <h2 className="text-xl font-semibold mb-3 border-b pb-2 dark:border-gray-600">
              All Database Entities
            </h2>
            <ul className="list-disc pl-5 space-y-1 text-sm">
              {allEntities.map((entity) => (
                <li key={`${entity.type}:${entity.id}`}>
                  <span className="font-medium capitalize">{entity.type}:</span>{" "}
                  {entity.name} ({entity.id})
                </li>
              ))}
            </ul>
            {allEntities.length === 0 && (
              <p className="text-sm text-gray-500">
                No entities found in database.
              </p>
            )}
          </div>

          <div className="border border-gray-300 dark:border-gray-700 rounded-lg shadow-md p-4">
            <h2 className="text-xl font-semibold mb-3 border-b pb-2 dark:border-gray-600">
              All Polizy Tuples (Sorted by ID)
            </h2>
            <ul className="space-y-1 text-xs font-mono">
              {allTuples.map((tuple) => {
                return (
                  <li key={tuple.id}>
                    ({tuple.subjectType}:{tuple.subjectId},{" "}
                    <span className="font-semibold">{tuple.relation}</span>,{" "}
                    {tuple.objectType}:{tuple.objectId})
                    {tuple.condition && (
                      <span className="text-gray-500"> [cond]</span>
                    )}
                  </li>
                );
              })}
            </ul>
            {allTuples.length === 0 && (
              <p className="text-sm text-gray-500">No tuples found.</p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
