import { useEffect, useState } from "react";
import { type Action, GRANTABLE, PERMISSION_LABELS } from "../authz/schema.ts";
import { describeExplain } from "../authz/store.ts";
import { useStore } from "../state.tsx";
import { Badge, Card, CardHeader } from "./ui.tsx";

const selectClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

export function AccessTester() {
  const { store, workspaceId, snapshot } = useStore();
  const users = snapshot?.users ?? [];
  const bookings = snapshot?.bookings ?? [];

  const [userId, setUserId] = useState("");
  const [action, setAction] = useState<Action>("issue_refunds");
  const [target, setTarget] = useState(""); // "" = workspace, else booking id
  const [result, setResult] = useState<{
    allowed: boolean;
    steps: string[];
  } | null>(null);

  // Default the user once data loads.
  useEffect(() => {
    if (!userId && users[0]) setUserId(users[0].id);
  }, [users, userId]);

  // Re-run the check whenever inputs change — and whenever the underlying data
  // changes (a toggle/assignment elsewhere can flip this decision), tracked via
  // the `snapshot` reference.
  // biome-ignore lint/correctness/useExhaustiveDependencies: snapshot is an intentional re-check trigger
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const booking = target || undefined;
    Promise.all([
      store.check(workspaceId, userId, action, booking),
      store.explain(workspaceId, userId, action, booking),
    ]).then(([allowed, why]) => {
      if (active) setResult({ allowed, steps: describeExplain(why) });
    });
    return () => {
      active = false;
    };
  }, [store, workspaceId, userId, action, target, snapshot]);

  return (
    <Card className="h-full">
      <CardHeader
        title="Live access check"
        subtitle="The real authorization decision, run through the engine"
      />
      <div className="space-y-3 px-6 pb-6">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-400">
              User
            </span>
            <select
              className={selectClass}
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
              <option value="newcomer">New employee (no roles)</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-400">
              Permission
            </span>
            <select
              className={selectClass}
              value={action}
              onChange={(e) => setAction(e.target.value as Action)}
            >
              {GRANTABLE.map((a) => (
                <option key={a} value={a}>
                  {PERMISSION_LABELS[a]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-400">
            On
          </span>
          <select
            className={selectClass}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">Workspace (all bookings)</option>
            {bookings.map((b) => (
              <option key={b.id} value={b.id}>
                Booking · {b.label}
              </option>
            ))}
          </select>
        </label>

        {result && (
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div className="flex items-center gap-2">
              {result.allowed ? (
                <Badge tone="emerald">● Allowed</Badge>
              ) : (
                <Badge tone="rose">● Denied</Badge>
              )}
              <span className="text-[12px] text-slate-400">
                authz.check(...) → {String(result.allowed)}
              </span>
            </div>
            <ol className="mt-3 space-y-1.5">
              {result.steps.map((step) => (
                <li
                  key={step}
                  className="flex items-start gap-2 text-[12.5px] text-slate-600"
                >
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-indigo-400" />
                  {step}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </Card>
  );
}
