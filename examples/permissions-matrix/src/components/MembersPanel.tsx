import type { RoleColumn } from "../authz/store.ts";
import { useStore } from "../state.tsx";
import { Avatar, Card, CardHeader, IconX } from "./ui.tsx";

function RoleMembers({ role }: { role: RoleColumn }) {
  const { workspaceId, snapshot, mutate } = useStore();
  const allUsers = snapshot?.users ?? [];
  const memberIds = new Set(role.members.map((m) => m.id));
  const available = allUsers.filter((u) => !memberIds.has(u.id));

  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-slate-800">
          {role.label}
        </span>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <input
            type="checkbox"
            checked={role.everyone}
            onChange={(e) =>
              mutate((s) =>
                s.setEveryone(workspaceId, role.name, e.target.checked),
              )
            }
            className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-200"
          />
          Everyone
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {role.everyone && (
          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">
            ✦ all users
          </span>
        )}
        {role.members.map((m) => (
          <span
            key={m.id}
            className="group inline-flex items-center gap-1.5 rounded-full bg-slate-100 py-0.5 pl-0.5 pr-1.5 text-[12px] text-slate-700"
          >
            <Avatar initials={m.initials} />
            {m.name}
            <button
              type="button"
              title={`Remove ${m.name}`}
              onClick={() =>
                mutate((s) => s.unassign(workspaceId, role.name, m.id))
              }
              className="text-slate-300 hover:text-rose-500"
            >
              <IconX className="h-3 w-3" />
            </button>
          </span>
        ))}
        {role.members.length === 0 && !role.everyone && (
          <span className="text-[11px] text-slate-300">no members</span>
        )}
        {available.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const userId = e.target.value;
              if (userId)
                mutate((s) => s.assign(workspaceId, role.name, userId));
            }}
            className="rounded-full border border-dashed border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-500 outline-none hover:border-indigo-400"
          >
            <option value="">+ assign</option>
            {available.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

export function MembersPanel() {
  const { snapshot } = useStore();
  return (
    <Card className="h-full">
      <CardHeader
        title="Team & roles"
        subtitle="Assign people to roles, or grant a role to everyone"
      />
      <div className="divide-y divide-slate-100 px-6 pb-5">
        {snapshot?.roles.map((role) => (
          <RoleMembers key={role.name} role={role} />
        ))}
        {snapshot && snapshot.roles.length === 0 && (
          <p className="py-4 text-[13px] text-slate-400">
            No roles in this workspace yet.
          </p>
        )}
      </div>
    </Card>
  );
}
