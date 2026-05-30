import { Form, Link, useSearchParams } from "react-router";
import { InfoTip } from "./ui/tooltip";

type Props = {
  persona: string;
  users: Array<{ id: string; name: string }>;
  region: string | null;
  tupleCount: number;
};

export default function TopBar({ persona, users, region, tupleCount }: Props) {
  const [params] = useSearchParams();

  const withParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    return `/?${next.toString()}`;
  };

  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
            PolizyDocs
          </h1>
          <span className="hidden text-xs text-zinc-500 sm:inline">
            authorization, made visible
          </span>
        </div>

        {/* Switch identity to watch how access changes per user. */}
        <div className="flex items-center gap-2">
          <span
            id="persona-label"
            className="text-xs uppercase tracking-wide text-zinc-500"
          >
            acting as
          </span>
          <nav
            aria-labelledby="persona-label"
            className="flex items-center gap-1 rounded-lg bg-zinc-100 p-1"
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
                      ? "bg-indigo-600 font-medium text-white"
                      : "text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900"
                  }`}
                >
                  {u.name}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* ABAC toggle: adds `region=eu` to the request context. The EU-strategy
            doc has an attribute condition granting the Eng team only when region=eu. */}
        <InfoTip label="Sets the request context to region=eu. The EU Market Strategy doc grants the Engineering team only when region=eu — an ABAC attribute condition.">
          <Link
            to={withParam("region", region === "eu" ? null : "eu")}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
              region === "eu"
                ? "border-amber-300 bg-amber-50 text-amber-700"
                : "border-zinc-200 bg-white text-zinc-500 hover:text-zinc-800"
            }`}
          >
            ctx: region = {region === "eu" ? "eu" : "—"}
          </Link>
        </InfoTip>

        <div className="ml-auto flex items-center gap-3">
          <span className="font-mono text-xs text-zinc-400">
            {tupleCount} tuples
          </span>
          <Form
            method="post"
            onSubmit={(e) => {
              if (!confirm("Reset your demo world back to the seeded state?"))
                e.preventDefault();
            }}
          >
            <input type="hidden" name="intent" value="reset" />
            <InfoTip label="Your data lives only in your browser (PGlite + IndexedDB). Reset rebuilds the seeded world.">
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
              >
                ↻ Reset world
              </button>
            </InfoTip>
          </Form>
        </div>
      </div>
    </header>
  );
}
