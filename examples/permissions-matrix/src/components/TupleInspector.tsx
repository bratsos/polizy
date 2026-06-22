import { useStore } from "../state.tsx";
import { Badge, Card, CardHeader } from "./ui.tsx";

function relTone(relation: string) {
  if (relation.startsWith("cap_")) return "text-indigo-600";
  if (relation === "assignee") return "text-amber-600";
  if (relation === "parent") return "text-slate-400";
  return "text-emerald-600";
}

export function TupleInspector() {
  const { snapshot } = useStore();
  const tuples = snapshot?.tuples ?? [];

  return (
    <Card>
      <CardHeader
        title="Stored tuples"
        subtitle="Every role, capability, and assignment above is just data — no schema change"
        action={<Badge tone="slate">{tuples.length} tuples</Badge>}
      />
      <div className="max-h-72 overflow-y-auto px-6 pb-5">
        <div className="space-y-1 font-mono text-[12px] leading-relaxed">
          {tuples.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 whitespace-nowrap"
            >
              <span className="text-slate-700">
                {t.subject.type}:{t.subject.id}
              </span>
              <span className={`font-semibold ${relTone(t.relation)}`}>
                —{t.relation}→
              </span>
              <span className="text-slate-700">
                {t.object.type}:{t.object.id}
              </span>
              {t.condition?.validUntil && <Badge tone="amber">⏱ expires</Badge>}
            </div>
          ))}
          {tuples.length === 0 && (
            <p className="text-slate-400">No tuples for this workspace.</p>
          )}
        </div>
      </div>
    </Card>
  );
}
