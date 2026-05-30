import { Link, useSearchParams } from "react-router";
import DbResetCountdown from "./DbResetCountdown";

type Props = {
  persona: string;
  users: Array<{ id: string; name: string }>;
  region: string | null;
  nextResetAt: number;
  intervalMinutes: number;
  tupleCount: number;
};

export default function TopBar({
  persona,
  users,
  region,
  nextResetAt,
  tupleCount,
}: Props) {
  const [params] = useSearchParams();

  const withParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    return `/?${next.toString()}`;
  };

  return (
    <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-zinc-50">
            PolizyDocs
          </h1>
          <span className="hidden text-xs text-zinc-500 sm:inline">
            authorization, made visible
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span
            id="persona-label"
            className="text-xs uppercase tracking-wide text-zinc-500"
          >
            acting as
          </span>
          <nav
            aria-labelledby="persona-label"
            className="flex items-center gap-1 rounded-lg bg-zinc-900 p-1"
          >
            {users.map((u) => {
              const active = u.id === persona;
              return (
                <Link
                  key={u.id}
                  to={withParam("as", u.id)}
                  aria-current={active ? "true" : undefined}
                  className={`rounded-md px-2.5 py-1 text-sm capitalize transition-colors ${
                    active
                      ? "bg-indigo-500 font-medium text-white"
                      : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  }`}
                >
                  {u.name}
                </Link>
              );
            })}
          </nav>
        </div>

        <Link
          to={withParam("region", region === "eu" ? null : "eu")}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
            region === "eu"
              ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
              : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
          }`}
          title="Toggles the request context `region=eu`, used by an ABAC attribute condition."
        >
          context: region = {region === "eu" ? "eu" : "—"}
        </Link>

        <div className="ml-auto flex items-center gap-3">
          <span className="font-mono text-xs text-zinc-500">
            {tupleCount} tuples
          </span>
          <DbResetCountdown nextResetAt={nextResetAt} />
        </div>
      </div>
    </header>
  );
}
