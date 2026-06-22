import { useState } from "react";
import { type Action, PERMISSION_LABELS } from "../authz/schema.ts";
import type { RoleColumn } from "../authz/store.ts";
import { useStore } from "../state.tsx";
import {
  Avatar,
  Button,
  Card,
  CardHeader,
  IconCheck,
  IconPlus,
  IconX,
} from "./ui.tsx";

function slug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function RoleHeader({ role }: { role: RoleColumn }) {
  const { workspaceId, mutate } = useStore();
  return (
    <th className="group/col px-3 pb-3 align-bottom">
      <div className="flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {role.label}
          </span>
          <button
            type="button"
            title={`Delete ${role.label}`}
            onClick={() => mutate((s) => s.deleteRole(workspaceId, role.name))}
            className="opacity-0 transition-opacity group-hover/col:opacity-100 text-slate-300 hover:text-rose-500"
          >
            <IconX className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center -space-x-1.5">
          {role.everyone && (
            <span className="inline-flex h-6 items-center rounded-full bg-amber-100 px-2 text-[10px] font-semibold text-amber-700 ring-2 ring-white">
              all
            </span>
          )}
          {role.members.slice(0, 3).map((m) => (
            <Avatar key={m.id} initials={m.initials} />
          ))}
          {role.members.length > 3 && (
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-500 ring-2 ring-white">
              +{role.members.length - 3}
            </span>
          )}
          {role.members.length === 0 && !role.everyone && (
            <span className="text-[10px] text-slate-300">no members</span>
          )}
        </div>
      </div>
    </th>
  );
}

function Cell({ role, action }: { role: RoleColumn; action: Action }) {
  const { workspaceId, mutate } = useStore();
  const on = role.can.has(action);
  return (
    <td className="px-3 py-0 text-center">
      <button
        type="button"
        aria-pressed={on}
        title={`${on ? "Revoke" : "Grant"} ${PERMISSION_LABELS[action]} for ${role.label}`}
        onClick={() =>
          mutate((s) => s.toggle(workspaceId, role.name, action, !on))
        }
        className={`mx-auto flex h-8 w-8 items-center justify-center rounded-lg transition-all ${
          on
            ? "bg-indigo-50 text-indigo-600 hover:bg-indigo-100"
            : "text-slate-300 hover:bg-slate-100 hover:text-slate-400"
        }`}
      >
        {on ? (
          <IconCheck className="h-4 w-4" />
        ) : (
          <span className="h-px w-3 bg-current" />
        )}
      </button>
    </td>
  );
}

function AddRole({ onClose }: { onClose: () => void }) {
  const { workspaceId, mutate, snapshot } = useStore();
  const [value, setValue] = useState("");
  const existing = new Set(snapshot?.roles.map((r) => r.name) ?? []);
  const key = slug(value);
  const invalid = key.length === 0 || existing.has(key);

  const submit = async () => {
    if (invalid) return;
    await mutate((s) => s.addRole(workspaceId, key, value.trim()));
    setValue("");
    onClose();
  };

  return (
    <div className="flex items-center gap-2">
      <input
        // biome-ignore lint/a11y/noAutofocus: focus the field when the form opens
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onClose();
        }}
        placeholder="Role name (e.g. Marketing)"
        className="w-48 rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
      />
      <Button variant="primary" disabled={invalid} onClick={submit}>
        Create
      </Button>
      <Button variant="ghost" onClick={onClose}>
        Cancel
      </Button>
    </div>
  );
}

export function PermissionsMatrix() {
  const { snapshot, workspaces, workspaceId } = useStore();
  const [adding, setAdding] = useState(false);
  const workspaceName =
    workspaces.find((w) => w.id === workspaceId)?.name ?? workspaceId;

  return (
    <Card>
      <CardHeader
        title="Permissions matrix"
        subtitle={`What each role can do across ${workspaceName} · click a cell to toggle`}
        action={
          adding ? (
            <AddRole onClose={() => setAdding(false)} />
          ) : (
            <Button onClick={() => setAdding(true)}>
              <IconPlus className="h-3.5 w-3.5" /> Add role
            </Button>
          )
        }
      />
      <div className="overflow-x-auto px-2 pb-4">
        {!snapshot ? (
          <div className="px-4 py-10 text-center text-sm text-slate-400">
            Loading…
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="px-4 pb-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Permission
                </th>
                {snapshot.roles.map((role) => (
                  <RoleHeader key={role.name} role={role} />
                ))}
                {snapshot.roles.length === 0 && (
                  <th className="px-4 pb-3 text-left text-[13px] font-normal text-slate-400">
                    No roles yet — add one →
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {snapshot.permissions.map((action, i) => (
                <tr
                  key={action}
                  className={i % 2 ? "bg-slate-50/40" : undefined}
                >
                  <td className="px-4 py-2.5 text-[13px] font-medium text-slate-700">
                    {PERMISSION_LABELS[action]}
                  </td>
                  {snapshot.roles.map((role) => (
                    <Cell key={role.name} role={role} action={action} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}
