import { Button, TextField } from "@synopsisapp/symbiosis-ui";
import React from "react";
import { Form, Link } from "react-router";
import type { ResourceData } from "../routes/home";

const ALL_POSSIBLE_ACTIONS = [
  "view",
  "edit",
  "delete",
  "share",
  "manage_members",
] as const;
type Action = (typeof ALL_POSSIBLE_ACTIONS)[number];

interface UserResourceViewProps {
  userId: string;
  resources: ResourceData[];
}

const renderActionButtons = (
  resource: ResourceData,
  userId: string,
  allowedActions: Action[],
) => {
  return (
    <span className="space-x-1 flex-shrink-0 ml-2">
      {ALL_POSSIBLE_ACTIONS.map((action: Action) => {
        const canPerformAction = allowedActions.includes(action);

        if (action === "share") {
          return (
            <Form
              method="post"
              key={`${resource.id}-share`}
              className="inline-block"
            >
              <input type="hidden" name="intent" value="share" />
              <input type="hidden" name="actingUserId" value={userId} />
              <input type="hidden" name="resourceId" value={resource.id} />
              <input type="hidden" name="resourceType" value={resource.type} />
              <Button
                type="submit"
                variant="primary"
                label="Share"
                layout="inline"
                isDisabled={!canPerformAction}
              />
            </Form>
          );
        }

        if (action === "delete") {
          return (
            <Form
              method="post"
              key={`${resource.id}-delete`}
              className="inline-block"
              onSubmit={(event) => {
                if (
                  !confirm(
                    `Are you sure you want to delete ${resource.type} "${resource.name}"? This cannot be undone.`,
                  )
                ) {
                  event.preventDefault();
                }
              }}
            >
              <input type="hidden" name="intent" value="delete" />
              <input type="hidden" name="actingUserId" value={userId} />
              <input type="hidden" name="resourceId" value={resource.id} />
              <input type="hidden" name="resourceType" value={resource.type} />
              <Button
                type="submit"
                tone="destructive"
                label="Delete"
                layout="inline"
                isDisabled={!canPerformAction}
              />
            </Form>
          );
        }

        if (
          canPerformAction &&
          ["view", "edit", "manage_members"].includes(action)
        ) {
          const id = resource.id.replace(`${resource.type}:`, "");
          return (
            <Link
              to={`/${userId}/${resource.type}/${id}/${action}`}
              key={`${resource.id}-${action}`}
              className="inline-block"
            >
              <Button variant="link" label={action} layout="inline" />
            </Link>
          );
        }

        return (
          <Button
            key={`${resource.id}-${action}`}
            variant="link"
            label={action}
            layout="inline"
            isDisabled
          />
        );
      })}
    </span>
  );
};

const renderResourcesRecursive = (
  parentId: string | null,
  allResources: ResourceData[],
  userId: string,
  level = 0,
): JSX.Element[] => {
  const children = allResources

    .filter((r) =>
      parentId === null
        ? r.parent === undefined || r.parent === null
        : r.parent === parentId,
    )
    .sort((a, b) => {
      const typeOrder = { folder: 1, document: 2, team: 3 };
      const orderA = typeOrder[a.type] ?? 99;
      const orderB = typeOrder[b.type] ?? 99;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    });

  return children.map((resource) => (
    <React.Fragment key={resource.id}>
      <li
        className={`flex justify-between items-center py-1 ${
          level > 0
            ? "ml-4 pl-2 border-l border-gray-300 dark:border-gray-600"
            : ""
        }`}
      >
        <span className="flex items-center">
          <span className="mr-1 w-4 inline-block text-center">
            {resource.type === "folder" && "📁"}
            {resource.type === "document" && "📄"}
            {resource.type === "team" && "👥"}
          </span>
          {resource.name}
        </span>
        {renderActionButtons(resource, userId, resource.allowedActions)}
      </li>

      {resource.type === "folder" && (
        <ul className="space-y-1">
          {" "}
          {renderResourcesRecursive(
            resource.id,
            allResources,
            userId,
            level + 1,
          )}
        </ul>
      )}
    </React.Fragment>
  ));
};

const UserResourceView: React.FC<UserResourceViewProps> = ({
  userId,
  resources,
}) => {
  return (
    <div>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
        Resources visible to {userId}:
      </p>
      {resources.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No resources visible.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {renderResourcesRecursive(null, resources, userId)}
        </ul>
      )}

      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
          Create New:
        </p>

        <Form method="post" className="flex items-end space-x-2">
          <input type="hidden" name="intent" value="createDocument" />
          <input type="hidden" name="actingUserId" value={userId} />
          <TextField
            name="title"
            placeholder="New Document Title"
            required
            label="New Document Title"
          />
          <Button
            type="submit"
            label="📄 Add"
            layout="inline"
            variant="outline"
          />
        </Form>

        <Form method="post" className="flex items-end space-x-2">
          <input type="hidden" name="intent" value="createFolder" />
          <input type="hidden" name="actingUserId" value={userId} />
          <TextField
            name="name"
            placeholder="New Folder Name"
            required
            label="New Folder Name"
          />
          <Button
            type="submit"
            label="📁 Add"
            layout="inline"
            variant="outline"
          />
        </Form>

        <Form method="post" className="flex items-end space-x-2">
          <input type="hidden" name="intent" value="createTeam" />
          <input type="hidden" name="actingUserId" value={userId} />
          <TextField
            name="name"
            placeholder="New Team Name"
            required
            label="New Team Name"
          />
          <Button
            type="submit"
            label="👥 Add"
            layout="inline"
            variant="outline"
          />
        </Form>
      </div>
    </div>
  );
};

export default UserResourceView;
