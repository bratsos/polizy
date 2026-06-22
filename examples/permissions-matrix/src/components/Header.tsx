import { useStore } from "../state.tsx";
import { Button } from "./ui.tsx";

export function Header() {
  const { workspaces, workspaceId, setWorkspaceId, mutate } = useStore();
  return (
    <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white shadow-sm shadow-indigo-600/30">
          p
        </div>
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight text-slate-900">
            polizy · runtime roles
          </h1>
          <p className="text-[13px] text-slate-500">
            End users define custom roles in-app — zero schema changes, fully
            type-safe.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="inline-flex rounded-xl border border-slate-200 bg-white/80 p-1 shadow-sm">
          {workspaces.map((w) => {
            const active = w.id === workspaceId;
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => setWorkspaceId(w.id)}
                className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                  active
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {w.name}
              </button>
            );
          })}
        </div>
        <Button
          variant="ghost"
          title="Wipe the in-browser database and re-seed"
          onClick={() => mutate((s) => s.reset())}
        >
          Reset
        </Button>
      </div>
    </header>
  );
}
