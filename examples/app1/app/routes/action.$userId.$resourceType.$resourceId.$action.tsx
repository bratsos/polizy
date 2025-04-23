import * as React from "react";
import {
  useLoaderData,
  Link,
  useRouteError,
  isRouteErrorResponse,
  data,
  Form,
} from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { authz, prisma, storage, docSchema } from "../lib/polizy.server";
import type {
  SchemaObjectTypes,
  Subject,
  SchemaSubjectTypes,
  AnyObject,
} from "polizy";
import { redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { Button } from "@synopsisapp/symbiosis-ui";

type LoaderData = {
  userId: string;
  resourceType: SchemaObjectTypes<typeof docSchema>;
  resourceId: string;
  action: string;
  resourceName?: string;
  resourceContent?: string | null;
  folderContents?: { id: string; name: string }[];
  teamMembers?: { id: string; type: string }[];
  canEditFolder?: boolean; // Flag for folder edit permission
  addableDocuments?: { id: string; name: string }[]; // Docs user can edit but aren't in this folder

  allUsers?: { id: string; name: string }[];
  allTeams?: { id: string; name: string }[];

  currentPermissions?: Record<
    string,
    Set<"viewer" | "editor" | "owner" | "member">
  >;

  error?: string;
};

export async function loader({ params }: LoaderFunctionArgs) {
  const { userId, resourceType, resourceId, action } = params;

  if (!userId || !resourceType || !resourceId || !action) {
    throw new Response("Missing parameters", { status: 400 });
  }

  if (!(docSchema as any).objectTypes.includes(resourceType as any)) {
    throw new Response("Invalid resource type", { status: 400 });
  }

  if (
    !(docSchema as any).actionToRelations[
      action as keyof typeof docSchema.actionToRelations
    ]
  ) {
    throw new Response("Invalid action", { status: 400 });
  }

  const userSubject: Subject<SchemaSubjectTypes<typeof docSchema>> = {
    type: "user",
    id: userId,
  };

  const targetObject: AnyObject<SchemaObjectTypes<typeof docSchema>> = {
    type: resourceType as any,
    id: resourceId,
  };

  const requiredActionForLoader =
    action === "manage_members" ? "share" : action;
  const canPerformAction = await authz.check({
    who: userSubject,
    canThey: requiredActionForLoader as any,
    onWhat: targetObject,
  });

  if (!canPerformAction) {
    throw new Response("Forbidden", { status: 403 });
  }

  const loaderData: LoaderData = {
    userId,
    resourceType: resourceType as any,
    resourceId,
    action,
  };

  try {
    if (action === "view") {
      if (resourceType === "document") {
        const doc = await prisma.document.findUnique({
          where: { id: resourceId },
        });
        loaderData.resourceName = doc?.title;
        loaderData.resourceContent = doc?.content;
      } else if (resourceType === "folder") {
        const folder = await prisma.folder.findUnique({
          where: { id: resourceId },
        });
        loaderData.resourceName = folder?.name;

        const accessibleDocs = await authz.listAccessibleObjects({
          who: userSubject,
          ofType: "document",
          canThey: "view",
        });
        const docsInFolder: { id: string; name: string }[] = [];
        for (const accDoc of accessibleDocs.accessible) {
          const parentTuple = await storage.findTuples({
            relation: "parent",
            subject: accDoc.object,
          });
          const parentTupleObject = parentTuple[0]?.object;
          if (
            parentTuple.length > 0 &&
            parentTupleObject?.type === "folder" &&
            parentTupleObject.id === resourceId
          ) {
            const docDetails = await prisma.document.findUnique({
              where: { id: accDoc.object.id },
            });
            if (docDetails) {
              docsInFolder.push({ id: docDetails.id, name: docDetails.title });
            }
          }
        }
        loaderData.folderContents = docsInFolder;

        // Check if user can edit this folder (needed for 'Create Document' button)
        // Removed duplicate direct assignment check
        const canEditFolderResult = await authz.check({
          // Store result in variable
          who: userSubject,
          canThey: "edit",
          onWhat: targetObject,
        });
        loaderData.canEditFolder = canEditFolderResult; // Assign to loaderData

        // If user can edit the folder, find documents they can add
        if (canEditFolderResult) {
          // Use the variable here
          const editableDocsResult = await authz.listAccessibleObjects({
            who: userSubject,
            ofType: "document",
            canThey: "edit", // User must be able to edit the doc to add it
          });

          const editableDocIds = new Set(
            editableDocsResult.accessible.map((d) => d.object.id),
          );
          const currentFolderDocIds = new Set(docsInFolder.map((d) => d.id)); // Use already fetched folder contents

          const addableDocIds = [...editableDocIds].filter(
            (id) => !currentFolderDocIds.has(id),
          );

          if (addableDocIds.length > 0) {
            const addableDocDetails = await prisma.document.findMany({
              where: { id: { in: addableDocIds } },
              select: { id: true, title: true },
            });
            loaderData.addableDocuments = addableDocDetails.map((d) => ({
              id: d.id,
              name: d.title,
            }));
          } else {
            loaderData.addableDocuments = [];
          }
        }
        loaderData.canEditFolder = canEditFolderResult; // Use correct variable name

        // If user can edit the folder, find documents they can add
        if (canEditFolderResult) {
          // Use correct variable name
          const editableDocsResult = await authz.listAccessibleObjects({
            who: userSubject,
            ofType: "document",
            canThey: "edit", // User must be able to edit the doc to add it
          });

          const editableDocIds = new Set(
            editableDocsResult.accessible.map((d) => d.object.id),
          );
          const currentFolderDocIds = new Set(docsInFolder.map((d) => d.id)); // Use already fetched folder contents

          const addableDocIds = [...editableDocIds].filter(
            (id) => !currentFolderDocIds.has(id),
          );

          if (addableDocIds.length > 0) {
            const addableDocDetails = await prisma.document.findMany({
              where: { id: { in: addableDocIds } },
              select: { id: true, title: true },
            });
            loaderData.addableDocuments = addableDocDetails.map((d) => ({
              id: d.id,
              name: d.title,
            }));
          } else {
            loaderData.addableDocuments = [];
          }
        }
      } else if (resourceType === "team") {
        const team = await prisma.team.findUnique({
          where: { id: resourceId },
        });
        loaderData.resourceName = team?.name;

        const memberTuples = await storage.findTuples({
          relation: "member",
          object: { type: "team", id: resourceId },
        });
        loaderData.teamMembers = memberTuples.map((t) => ({
          id: t.subject.id,
          type: t.subject.type,
        }));
      }
    } else if (action === "edit") {
      if (resourceType === "document") {
        const doc = await prisma.document.findUnique({
          where: { id: resourceId },
        });
        loaderData.resourceName = doc?.title;
        loaderData.resourceContent = doc?.content;
      } else {
        if (resourceType === "folder") {
          const resource = await prisma.folder.findUnique({
            where: { id: resourceId },
          });
          loaderData.resourceName = resource?.name;
          // Also check edit permission when editing the folder itself
          loaderData.canEditFolder = await authz.check({
            who: userSubject,
            canThey: "edit",
            onWhat: targetObject,
          });
          const canEditFolderResult = await authz.check({
            // Store result in variable
            who: userSubject,
            canThey: "edit",
            onWhat: targetObject,
          });
          loaderData.canEditFolder = canEditFolderResult; // Assign to loaderData

          // Also fetch addable documents when editing the folder
          if (canEditFolderResult) {
            // Use the variable here
            const editableDocsResult = await authz.listAccessibleObjects({
              who: userSubject,
              ofType: "document",
              canThey: "edit",
            });

            // Need to know current children to exclude them
            const childTuples = await storage.findTuples({
              relation: "parent",
              object: targetObject, // Find children of the current folder
            });
            const currentFolderDocIds = new Set(
              childTuples
                .filter((t) => t.subject.type === "document")
                .map((t) => t.subject.id),
            );

            const editableDocIds = new Set(
              editableDocsResult.accessible.map((d) => d.object.id),
            );
            const addableDocIds = [...editableDocIds].filter(
              (id) => !currentFolderDocIds.has(id),
            );

            if (addableDocIds.length > 0) {
              const addableDocDetails = await prisma.document.findMany({
                where: { id: { in: addableDocIds } },
                select: { id: true, title: true },
              });
              loaderData.addableDocuments = addableDocDetails.map((d) => ({
                id: d.id,
                name: d.title,
              }));
            } else {
              loaderData.addableDocuments = [];
            }
          }
          loaderData.canEditFolder = canEditFolderResult; // Use correct variable name

          // Also fetch addable documents when editing the folder
          if (canEditFolderResult) {
            // Use correct variable name
            const editableDocsResult = await authz.listAccessibleObjects({
              who: userSubject,
              ofType: "document",
              canThey: "edit",
            });

            // Need to know current children to exclude them
            const childTuples = await storage.findTuples({
              relation: "parent",
              object: targetObject, // Find children of the current folder
            });
            const currentFolderDocIds = new Set(
              childTuples
                .filter((t) => t.subject.type === "document")
                .map((t) => t.subject.id),
            );

            const editableDocIds = new Set(
              editableDocsResult.accessible.map((d) => d.object.id),
            );
            const addableDocIds = [...editableDocIds].filter(
              (id) => !currentFolderDocIds.has(id),
            );

            if (addableDocIds.length > 0) {
              const addableDocDetails = await prisma.document.findMany({
                where: { id: { in: addableDocIds } },
                select: { id: true, title: true },
              });
              loaderData.addableDocuments = addableDocDetails.map((d) => ({
                id: d.id,
                name: d.title,
              }));
            } else {
              loaderData.addableDocuments = [];
            }
          }
        } else if (resourceType === "team") {
          const resource = await prisma.team.findUnique({
            where: { id: resourceId },
          });
          loaderData.resourceName = resource?.name;
        }
      }
    } else if (action === "manage_members") {
      let resourceName: string | undefined;
      if (resourceType === "document") {
        const resource = await prisma.document.findUnique({
          where: { id: resourceId },
        });
        resourceName = resource?.title;
      } else if (resourceType === "folder") {
        const resource = await prisma.folder.findUnique({
          where: { id: resourceId },
        });
        resourceName = resource?.name;
      } else if (resourceType === "team") {
        const resource = await prisma.team.findUnique({
          where: { id: resourceId },
        });
        resourceName = resource?.name;
      }
      loaderData.resourceName = resourceName;

      loaderData.allUsers = await prisma.user.findMany({
        select: { id: true, name: true },
      });
      loaderData.allTeams = await prisma.team.findMany({
        select: { id: true, name: true },
      });

      const relevantRelations: ("viewer" | "editor" | "owner" | "member")[] = [
        "viewer",
        "editor",
        "owner",
      ];
      if (resourceType === "team") {
        relevantRelations.push("member");
      }

      const currentPermissionsMap: Record<
        string,
        Set<"viewer" | "editor" | "owner" | "member">
      > = {};

      const tuplePromises = relevantRelations.map((relation) =>
        storage.findTuples({ relation, object: targetObject }),
      );
      const tupleResults = await Promise.all(tuplePromises);

      tupleResults.flat().forEach((tuple) => {
        const subjectKey = `${tuple.subject.type}:${tuple.subject.id}`;
        if (!currentPermissionsMap[subjectKey]) {
          currentPermissionsMap[subjectKey] = new Set<
            "viewer" | "editor" | "owner" | "member"
          >();
        }

        const relation = tuple.relation as
          | "viewer"
          | "editor"
          | "owner"
          | "member";
        currentPermissionsMap[subjectKey].add(relation);
      });

      loaderData.currentPermissions = currentPermissionsMap;
    }
  } catch (error) {
    console.error("Error fetching resource details:", error);
    loaderData.error = "Failed to fetch resource details.";
  }

  return data(loaderData);
}

export async function action({ request, params }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "saveEdit") {
    const userId = formData.get("userId") as string;
    const resourceType = formData.get("resourceType") as SchemaObjectTypes<
      typeof docSchema
    >;
    const resourceId = formData.get("resourceId") as string;
    const title = formData.get("title") as string | undefined;
    const content = formData.get("content") as string | undefined;
    const name = formData.get("name") as string | undefined;

    if (!userId || !resourceType || !resourceId) {
      return data(
        { ok: false, error: "Missing required edit data." },
        { status: 400 },
      );
    }

    const userSubject: Subject<SchemaSubjectTypes<typeof docSchema>> = {
      type: "user",
      id: userId,
    };
    const targetObject: AnyObject<SchemaObjectTypes<typeof docSchema>> = {
      type: resourceType,
      id: resourceId,
    };

    const canEdit = await authz.check({
      who: userSubject,
      canThey: "edit",
      onWhat: targetObject,
    });

    if (!canEdit) {
      return data({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    try {
      if (resourceType === "document") {
        if (title === undefined || content === undefined) {
          return data(
            { ok: false, error: "Missing title or content for document." },
            { status: 400 },
          );
        }
        await prisma.document.update({
          where: { id: resourceId },
          data: { title, content },
        });
      } else if (resourceType === "folder") {
        if (name === undefined) {
          return data(
            { ok: false, error: "Missing name for folder." },
            { status: 400 },
          );
        }
        await prisma.folder.update({
          where: { id: resourceId },
          data: { name },
        });
      } else if (resourceType === "team") {
        if (name === undefined) {
          return data(
            { ok: false, error: "Missing name for team." },
            { status: 400 },
          );
        }
        await prisma.team.update({
          where: { id: resourceId },
          data: { name },
        });
      }

      return redirect("/");
    } catch (error: any) {
      console.error("Error saving edit:", error);
      return data(
        { ok: false, error: "Failed to save changes." },
        { status: 500 },
      );
    }
  } else if (intent === "savePermissions") {
    const actingUserId = params.userId as string;
    const resourceId = params.resourceId as string;
    const resourceType = params.resourceType as SchemaObjectTypes<
      typeof docSchema
    >;

    if (!actingUserId || !resourceId || !resourceType) {
      return data(
        { ok: false, error: "Missing parameters for saving permissions." },
        { status: 400 },
      );
    }

    const actingUserSubject: Subject<SchemaSubjectTypes<typeof docSchema>> = {
      type: "user",
      id: actingUserId,
    };
    const targetObject: AnyObject<SchemaObjectTypes<typeof docSchema>> = {
      type: resourceType,
      id: resourceId,
    };

    const canManagePermissions = await authz.check({
      who: actingUserSubject,
      canThey: "share",
      onWhat: targetObject,
    });

    if (!canManagePermissions) {
      return data(
        {
          ok: false,
          error: "Forbidden: You cannot manage permissions for this resource.",
        },
        { status: 403 },
      );
    }

    const desiredPermissions: Record<
      string,
      Set<"viewer" | "editor" | "member">
    > = {};

    for (const [key, value] of formData.entries()) {
      const match = key.match(
        /^permission\[(user|team):([^\]]+)\]\[(viewer|editor|member)\]$/,
      );
      if (match && value === "true") {
        const subjectType = match[1] as "user" | "team";
        const subjectId = match[2];
        const relation = match[3] as "viewer" | "editor" | "member";
        const subjectKey = `${subjectType}:${subjectId}`;

        if (!desiredPermissions[subjectKey]) {
          desiredPermissions[subjectKey] = new Set();
        }
        desiredPermissions[subjectKey].add(relation);
      }
    }

    try {
      const relevantRelations: ("viewer" | "editor" | "owner" | "member")[] = [
        "viewer",
        "editor",
        "owner",
      ];
      if (resourceType === "team") {
        relevantRelations.push("member");
      }
      const currentPermissionsMap: Record<
        string,
        Set<"viewer" | "editor" | "owner" | "member">
      > = {};
      const tuplePromises = relevantRelations.map((relation) =>
        storage.findTuples({ relation, object: targetObject }),
      );
      const tupleResults = await Promise.all(tuplePromises);
      tupleResults.flat().forEach((tuple) => {
        const subjectKey = `${tuple.subject.type}:${tuple.subject.id}`;
        if (!currentPermissionsMap[subjectKey]) {
          currentPermissionsMap[subjectKey] = new Set();
        }
        currentPermissionsMap[subjectKey].add(
          tuple.relation as "viewer" | "editor" | "owner" | "member",
        );
      });

      const allSubjectKeys = new Set([
        ...Object.keys(desiredPermissions),
        ...Object.keys(currentPermissionsMap),
      ]);

      for (const subjectKey of allSubjectKeys) {
        const [subjectType, subjectId] = subjectKey.split(":");
        if (!subjectType || !subjectId) {
          console.warn(`Skipping invalid subjectKey: ${subjectKey}`);
          continue;
        }

        const subject: Subject<SchemaSubjectTypes<typeof docSchema>> = {
          type: subjectType as any,
          id: subjectId,
        };

        const currentRoles = currentPermissionsMap[subjectKey] ?? new Set();
        const desiredRoles = desiredPermissions[subjectKey] ?? new Set();

        if (currentRoles.has("owner")) {
          continue;
        }

        const manageableRelations: ("viewer" | "editor" | "member")[] = [
          "viewer",
          "editor",
        ];
        if (resourceType === "team" && subjectType === "user") {
          manageableRelations.push("member");
        }

        for (const relation of manageableRelations) {
          const hasCurrently = currentRoles.has(relation);
          const wantsRelation = desiredRoles.has(relation);

          if (wantsRelation && !hasCurrently) {
            if (relation === "member") {
              await authz.addMember({ member: subject, group: targetObject });
            } else {
              await authz.allow({
                who: subject,
                toBe: relation,
                onWhat: targetObject,
              });
            }
          } else if (!wantsRelation && hasCurrently) {
            if (relation === "member") {
              await authz.removeMember({
                member: subject,
                group: targetObject,
              });
            } else {
              await authz.disallowAllMatching({
                who: subject,
                was: relation,
                onWhat: targetObject,
              });
            }
          }
        }
      }

      return redirect(
        `/${actingUserId}/${resourceType}/${resourceId}/manage_members`,
      );
    } catch (error: any) {
      console.error("Error updating permissions:", error);
      return data(
        { ok: false, error: "Failed to update permissions." },
        { status: 500 },
      );
    } // This brace closes the 'catch' block for savePermissions
  } // <-- THIS brace closes the 'else if (intent === "savePermissions")' block
  else if (intent === "createDocumentInFolder") {
    const actingUserId = formData.get("actingUserId") as string;
    const parentFolderId = formData.get("parentFolderId") as string;
    const title = formData.get("title") as string;

    if (!actingUserId || !parentFolderId || !title) {
      return data(
        { ok: false, error: "Missing required data for document creation." },
        { status: 400 },
      );
    }

    const actingUserSubject: Subject<SchemaSubjectTypes<typeof docSchema>> = {
      type: "user",
      id: actingUserId,
    };
    const parentFolderObject: AnyObject<SchemaObjectTypes<typeof docSchema>> = {
      type: "folder",
      id: parentFolderId,
    };

    // Server-side authorization check: Can the user edit the parent folder?
    const canEditFolder = await authz.check({
      who: actingUserSubject,
      canThey: "edit",
      onWhat: parentFolderObject,
    });

    if (!canEditFolder) {
      return data(
        {
          ok: false,
          error: "Forbidden: You cannot create documents in this folder.",
        },
        { status: 403 },
      );
    }

    // Generate document ID (similar to home.tsx action)
    const newDocId = title
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    if (!newDocId) {
      return data(
        { ok: false, error: "Invalid title for document ID generation." },
        { status: 400 },
      );
    }
    const newDocObject: AnyObject<SchemaObjectTypes<typeof docSchema>> = {
      type: "document",
      id: newDocId,
    };

    try {
      await prisma.$transaction(async (tx) => {
        // 1. Create the document
        await tx.document.create({
          data: { id: newDocId, title: title, content: "" },
        });

        // 2. Grant ownership to the creator
        await authz.allow({
          who: actingUserSubject,
          toBe: "owner",
          onWhat: newDocObject,
        });

        // 3. Set the parent folder relationship
        await authz.setParent({
          child: newDocObject,
          parent: parentFolderObject,
        });
      });

      // Redirect back to the folder view page
      return redirect(`/${actingUserId}/folder/${parentFolderId}/view`);
    } catch (error: any) {
      console.error("Error creating document in folder:", error);
      if (error.code === "P2002") {
        // Handle potential duplicate ID
        return data(
          {
            ok: false,
            error: `Document with ID "${newDocId}" already exists.`,
          },
          { status: 409 },
        );
      }
      return data(
        { ok: false, error: "Failed to create document in folder." },
        { status: 500 },
      );
    }
  } // Closes the 'else if (intent === "createDocumentInFolder")' block
  else if (intent === "addExistingDocumentToFolder") {
    const actingUserId = formData.get("actingUserId") as string;
    const targetFolderId = formData.get("targetFolderId") as string;
    const documentId = formData.get("documentId") as string;

    if (!actingUserId || !targetFolderId || !documentId) {
      return data(
        { ok: false, error: "Missing required data for adding document." },
        { status: 400 },
      );
    }

    const actingUserSubject: Subject<SchemaSubjectTypes<typeof docSchema>> = {
      type: "user",
      id: actingUserId,
    };
    const targetFolderObject: AnyObject<SchemaObjectTypes<typeof docSchema>> = {
      type: "folder",
      id: targetFolderId,
    };
    const documentObject: AnyObject<SchemaObjectTypes<typeof docSchema>> = {
      type: "document",
      id: documentId,
    };

    // Server-side authorization checks:
    const canEditFolder = await authz.check({
      who: actingUserSubject,
      canThey: "edit",
      onWhat: targetFolderObject,
    });
    const canEditDocument = await authz.check({
      who: actingUserSubject,
      canThey: "edit", // User must be able to edit the document to move it
      onWhat: documentObject,
    });

    if (!canEditFolder) {
      return data(
        {
          ok: false,
          error: "Forbidden: You cannot add documents to this folder.",
        },
        { status: 403 },
      );
    }
    if (!canEditDocument) {
      return data(
        {
          ok: false,
          error: "Forbidden: You do not have permission to move this document.",
        },
        { status: 403 },
      );
    }

    try {
      // Use setParent - this automatically removes the old parent relationship if one exists
      await authz.setParent({
        child: documentObject,
        parent: targetFolderObject,
      });

      // Redirect back to the folder view page
      return redirect(`/${actingUserId}/folder/${targetFolderId}/view`);
    } catch (error: any) {
      console.error("Error adding existing document to folder:", error);
      // Handle potential errors, e.g., if the document or folder doesn't exist
      // (though checks should ideally prevent this)
      return data(
        { ok: false, error: "Failed to add document to folder." },
        { status: 500 },
      );
    }
  } else {
    // Final 'else' block for unsupported intents
    // Handle unsupported intents
    console.warn(`Unsupported intent received: ${intent}`);
    return data(
      { ok: false, error: `Unsupported intent: ${intent}` },
      { status: 400 },
    );
  } // Closes the final 'else' block
} // Closes the 'action' function

export default function ActionPage() {
  const loadedData = useLoaderData<LoaderData>();

  return (
    <main className="p-4 md:p-8">
      <h1 className="text-2xl font-bold mb-4 capitalize">
        {loadedData.action} {loadedData.resourceType}:{" "}
        {loadedData.resourceName ?? loadedData.resourceId}
      </h1>
      <p className="text-sm text-gray-600 mb-4">
        Performed by: {loadedData.userId}
      </p>

      {loadedData.error && (
        <p className="text-red-500">Error: {loadedData.error}</p>
      )}

      {/* Render content based on action */}
      {loadedData.action === "view" &&
        loadedData.resourceType === "document" && (
          <div className="prose dark:prose-invert">
            <pre>{loadedData.resourceContent ?? "No content."}</pre>
          </div>
        )}

      {loadedData.action === "view" && loadedData.resourceType === "folder" && (
        <div>
          <h2 className="text-lg font-semibold mb-2">Folder Contents:</h2>
          {loadedData.folderContents && loadedData.folderContents.length > 0 ? (
            <ul className="list-disc pl-5">
              {loadedData.folderContents.map(
                (doc: { id: string; name: string }) => (
                  <li key={doc.id}>
                    <Link
                      to={`/${loadedData.userId}/document/${doc.id}/view`}
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      📄 {doc.name}
                    </Link>
                  </li>
                ),
              )}
            </ul>
          ) : (
            <p className="text-sm text-gray-500 italic mt-2">
              No documents found in this folder.
            </p>
          )}

          {/* Add "Create Document in Folder" form if user has edit rights */}
          {loadedData.canEditFolder &&
            loadedData.resourceType === "folder" &&
            (loadedData.action === "view" || loadedData.action === "edit") && (
              <div className="mt-6 pt-4 border-t border-gray-300 dark:border-gray-600">
                <h3 className="text-md font-semibold mb-2">
                  Create Document in this Folder
                </h3>
                <Form method="post" className="flex items-end space-x-2">
                  <input
                    type="hidden"
                    name="intent"
                    value="createDocumentInFolder"
                  />
                  <input
                    type="hidden"
                    name="actingUserId"
                    value={loadedData.userId}
                  />
                  <input
                    type="hidden"
                    name="parentFolderId"
                    value={loadedData.resourceId}
                  />
                  {/* Using basic input for simplicity, replace with TextField if available/needed */}
                  <div className="flex-grow">
                    <label
                      htmlFor="newDocTitle"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                      Document Title
                    </label>
                    <input
                      type="text"
                      id="newDocTitle"
                      name="title"
                      required
                      placeholder="New Document Title"
                      className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    />
                  </div>
                  <Button
                    type="submit"
                    label="📄 Add Document"
                    layout="inline"
                    variant="outline"
                  />
                </Form>
              </div>
            )}

          {/* Add "Add Existing Document to Folder" form */}
          {loadedData.canEditFolder &&
            loadedData.addableDocuments &&
            loadedData.addableDocuments.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-300 dark:border-gray-600">
                <h3 className="text-md font-semibold mb-2">
                  Add Existing Document to this Folder
                </h3>
                <Form method="post" className="flex items-end space-x-2">
                  <input
                    type="hidden"
                    name="intent"
                    value="addExistingDocumentToFolder"
                  />
                  <input
                    type="hidden"
                    name="actingUserId"
                    value={loadedData.userId}
                  />
                  <input
                    type="hidden"
                    name="targetFolderId"
                    value={loadedData.resourceId}
                  />
                  <div className="flex-grow">
                    <label
                      htmlFor="existingDocId"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                      Select Document
                    </label>
                    <select
                      id="existingDocId"
                      name="documentId" // Send the ID of the selected document
                      required
                      className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    >
                      <option value="" disabled>
                        -- Select a document --
                      </option>
                      {loadedData.addableDocuments.map((doc) => (
                        <option key={doc.id} value={doc.id}>
                          {doc.name} ({doc.id})
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    type="submit"
                    label="➕ Add Selected Document"
                    layout="inline"
                    variant="outline"
                  />
                </Form>
              </div>
            )}
        </div>
      )}

      {loadedData.action === "view" && loadedData.resourceType === "team" && (
        <div>
          <h2 className="text-lg font-semibold mb-2">Team Members:</h2>
          {loadedData.teamMembers && loadedData.teamMembers.length > 0 ? (
            <ul className="list-disc pl-5">
              {loadedData.teamMembers.map(
                (member: { id: string; type: string }) => (
                  <li key={`${member.type}:${member.id}`}>
                    {member.type === "user" ? "👤" : "👥"} {member.id} (
                    {member.type})
                  </li>
                ),
              )}
            </ul>
          ) : (
            <p className="text-sm text-gray-500 italic mt-2">
              No members found in this team.
            </p>
          )}
        </div>
      )}

      {/* Edit Form */}
      {loadedData.action === "edit" && (
        <Form method="post" className="mt-4 space-y-4">
          <input type="hidden" name="intent" value="saveEdit" />
          <input type="hidden" name="userId" value={loadedData.userId} />
          <input
            type="hidden"
            name="resourceType"
            value={loadedData.resourceType}
          />
          <input
            type="hidden"
            name="resourceId"
            value={loadedData.resourceId}
          />

          {loadedData.resourceType === "document" && (
            <>
              <div>
                <label
                  htmlFor="title"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Title
                </label>
                <input
                  type="text"
                  id="title"
                  name="title"
                  defaultValue={loadedData.resourceName}
                  required
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>
              <div>
                <label
                  htmlFor="content"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Content
                </label>
                <textarea
                  id="content"
                  name="content"
                  rows={10}
                  defaultValue={loadedData.resourceContent ?? ""}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>
            </>
          )}

          {(loadedData.resourceType === "folder" ||
            loadedData.resourceType === "team") && (
            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Name
              </label>
              <input
                type="text"
                id="name"
                name="name"
                defaultValue={loadedData.resourceName}
                required
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              />
            </div>
          )}

          <Button type="submit" label="Save Changes" />
        </Form>
      )}

      {/* Manage Members/Permissions Form */}
      {loadedData.action === "manage_members" && (
        <Form method="post" className="mt-4 space-y-6">
          <input type="hidden" name="intent" value="savePermissions" />
          {/* No need to send userId, resourceType, resourceId again as they are in params */}

          <p className="text-sm text-gray-600 dark:text-gray-400">
            Manage who has access to{" "}
            <strong>{loadedData.resourceName ?? loadedData.resourceId}</strong>.
            Owners cannot be changed here.
          </p>

          {/* User Permissions */}
          <fieldset>
            <legend className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              User Permissions
            </legend>
            <div className="space-y-3">
              {loadedData.allUsers?.map((user) => {
                const subjectKey = `user:${user.id}`;
                const currentRoles =
                  loadedData.currentPermissions?.[subjectKey] ?? new Set();
                const isOwner = currentRoles.has("owner");

                return (
                  <div
                    key={user.id}
                    className="p-3 border rounded-md dark:border-gray-700"
                  >
                    <p className="font-semibold dark:text-gray-200">
                      👤 {user.name} ({user.id}){" "}
                      {isOwner && (
                        <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                          (Owner)
                        </span>
                      )}
                    </p>
                    {isOwner ? (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Owner permissions cannot be changed.
                      </p>
                    ) : (
                      <div className="flex space-x-4 mt-2">
                        <div className="flex items-center">
                          <input
                            id={`perm-${user.id}-viewer`}
                            name={`permission[user:${user.id}][viewer]`}
                            type="checkbox"
                            value="true"
                            defaultChecked={currentRoles.has("viewer")}
                            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <label
                            htmlFor={`perm-${user.id}-viewer`}
                            className="ml-2 block text-sm text-gray-900 dark:text-gray-300"
                          >
                            Viewer
                          </label>
                        </div>
                        <div className="flex items-center">
                          <input
                            id={`perm-${user.id}-editor`}
                            name={`permission[user:${user.id}][editor]`}
                            type="checkbox"
                            value="true"
                            defaultChecked={currentRoles.has("editor")}
                            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <label
                            htmlFor={`perm-${user.id}-editor`}
                            className="ml-2 block text-sm text-gray-900 dark:text-gray-300"
                          >
                            Editor
                          </label>
                        </div>
                        {/* Only show Member checkbox if managing a Team */}
                        {loadedData.resourceType === "team" && (
                          <div className="flex items-center">
                            <input
                              id={`perm-${user.id}-member`}
                              name={`permission[user:${user.id}][member]`}
                              type="checkbox"
                              value="true"
                              defaultChecked={currentRoles.has("member")}
                              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <label
                              htmlFor={`perm-${user.id}-member`}
                              className="ml-2 block text-sm text-gray-900 dark:text-gray-300"
                            >
                              Member
                            </label>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>

          {/* Team Permissions (Only if not managing a Team resource itself) */}
          {loadedData.resourceType !== "team" && (
            <fieldset>
              <legend className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                Team Permissions
              </legend>
              <div className="space-y-3">
                {loadedData.allTeams?.map((team) => {
                  const subjectKey = `team:${team.id}`;
                  const currentRoles =
                    loadedData.currentPermissions?.[subjectKey] ?? new Set();
                  const isOwner = currentRoles.has("owner"); // Teams can own things too

                  return (
                    <div
                      key={team.id}
                      className="p-3 border rounded-md dark:border-gray-700"
                    >
                      <p className="font-semibold dark:text-gray-200">
                        👥 {team.name} ({team.id}){" "}
                        {isOwner && (
                          <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                            (Owner)
                          </span>
                        )}
                      </p>
                      {isOwner ? (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                          Owner permissions cannot be changed.
                        </p>
                      ) : (
                        <div className="flex space-x-4 mt-2">
                          <div className="flex items-center">
                            <input
                              id={`perm-${team.id}-viewer`}
                              name={`permission[team:${team.id}][viewer]`}
                              type="checkbox"
                              value="true"
                              defaultChecked={currentRoles.has("viewer")}
                              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <label
                              htmlFor={`perm-${team.id}-viewer`}
                              className="ml-2 block text-sm text-gray-900 dark:text-gray-300"
                            >
                              Viewer
                            </label>
                          </div>
                          <div className="flex items-center">
                            <input
                              id={`perm-${team.id}-editor`}
                              name={`permission[team:${team.id}][editor]`}
                              type="checkbox"
                              value="true"
                              defaultChecked={currentRoles.has("editor")}
                              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <label
                              htmlFor={`perm-${team.id}-editor`}
                              className="ml-2 block text-sm text-gray-900 dark:text-gray-300"
                            >
                              Editor
                            </label>
                          </div>
                          {/* Teams cannot be members of other things in this schema */}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          )}

          <Button type="submit" label="Save Permissions" />
        </Form>
      )}

      {/* Back Link */}
      <div className="mt-8">
        <Link
          to="/"
          className="text-blue-600 hover:underline dark:text-blue-400"
        >
          <Button variant="link" label="← Back to Home" layout="inline" />
        </Link>
      </div>
    </main>
  );
}

// Error Boundary Component
export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <main className="p-4 md:p-8 text-center">
        <h1 className="text-2xl font-bold text-red-600">
          {error.status} {error.statusText}
        </h1>
        <p className="mt-2">{error.data}</p>
        <div className="mt-4">
          <Link to="/">
            <Button label="Go Back Home" />
          </Link>
        </div>
      </main>
    );
  }

  // Handle unexpected errors
  let errorMessage = "An unexpected error occurred.";
  if (error instanceof Error) {
    errorMessage = error.message;
  }

  return (
    <main className="p-4 md:p-8 text-center">
      <h1 className="text-2xl font-bold text-red-600">Something went wrong</h1>
      <p className="mt-2 text-gray-600 dark:text-gray-400">{errorMessage}</p>
      <div className="mt-4">
        <Link to="/">
          <Button label="Go Back Home" />
        </Link>
      </div>
    </main>
  );
}
