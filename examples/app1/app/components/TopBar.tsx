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
    <header className="sticky top-0 z-20 border-b border-zinc-200/80 bg-white/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-5 gap-y-3 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-6 w-6 place-items-center rounded-[7px] bg-indigo-600 text-[13px] font-bold text-white shadow-sm"
          >
            P
          </span>
          <h1 className="text-[15px] font-semibold tracking-tight text-zinc-900">
            PolizyDocs
          </h1>
          <span className="hidden text-xs text-zinc-400 sm:inline">
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
            className="flex items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 ring-1 ring-inset ring-zinc-200/60"
          >
            {users.map((u) => {
              const active = u.id === persona;
              return (
                <Link
                  key={u.id}
                  to={withParam("as", u.id)}
                  aria-current={active ? "true" : undefined}
                  className={`rounded-[7px] px-2.5 py-1 text-[13px] capitalize transition-all ${
                    active
                      ? "bg-white font-medium text-zinc-900 shadow-sm ring-1 ring-zinc-200"
                      : "text-zinc-500 hover:text-zinc-900"
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
