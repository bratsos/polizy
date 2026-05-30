import type { ExplainNode } from "polizy";
import * as React from "react";
import { Form, Link, useNavigate, useSearchParams } from "react-router";
import type { Action, Inspect, TupleRow } from "../routes/home";

const ACTIONS: Action[] = ["view", "edit", "delete", "share", "manage_members"];

/**
 * The Authorization Inspector makes a polizy decision legible. For the focused
 * resource it shows: the explain() granting path, a checkMany() matrix, the
 * listSubjects() reverse lookup, and the raw tuples behind it all.
 */
export default function Inspector({
  persona,
  inspect,
  region,
}: {
  persona: string;
  inspect: Inspect;
  region: string | null;
}) {
  const [params] = useSearchParams();
  const href = (over: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(over)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    return `/?${next.toString()}`;
  };

  const navigate = useNavigate();
  const closeHref = href({ inspect: null, action: null });
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") navigate(closeHref);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, closeHref]);

  return (
    <>
      <Link
        to={closeHref}
        aria-label="Close inspector"
        className="fixed inset-0 z-20 hidden bg-zinc-900/10 backdrop-blur-[2px] sm:block"
      />
      <aside
        role="dialog"
        aria-modal="false"
        aria-labelledby="inspector-title"
        className="fixed right-0 top-0 z-30 flex h-screen w-full flex-col border-l border-zinc-200/80 bg-white/95 shadow-[-10px_0_40px_rgba(16,16,24,0.07)] backdrop-blur-xl sm:w-[440px]"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <h2
            id="inspector-title"
            className="flex items-center gap-2 text-sm font-semibold text-zinc-900"
          >
            🔍 Authorization Inspector
          </h2>
          <Link
            to={closeHref}
            aria-label="Close inspector"
            className="rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"
          >
            ✕
          </Link>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {/* Decision: authz.check(...) */}
          <section>
            <div
              className={`rounded-lg border p-3 ${
                inspect.allowed
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-rose-200 bg-rose-50"
              }`}
            >
              <p className="text-sm text-zinc-600">
                Can <b className="capitalize text-zinc-900">{persona}</b>{" "}
                <code className="text-indigo-700">{inspect.action}</code>{" "}
                <b className="text-zinc-900">{inspect.target.name}</b>?
              </p>
              <p
                className={`mt-1 text-lg font-bold ${inspect.allowed ? "text-emerald-600" : "text-rose-600"}`}
              >
                {inspect.allowed ? "✓ ALLOWED" : "✗ DENIED"}
              </p>
              {region === "eu" && (
                <p className="mt-1 text-[11px] text-amber-700">
                  evaluated with context region = "eu"
                </p>
              )}
            </div>

            <div className="mt-2 flex flex-wrap gap-1">
              {ACTIONS.map((a) => (
                <Link
                  key={a}
                  to={href({ action: a })}
                  className={`rounded px-2 py-0.5 text-xs ${
                    a === inspect.action
                      ? "bg-indigo-600 text-white"
                      : "bg-zinc-100 text-zinc-500 hover:text-zinc-900"
                  }`}
                >
                  {a}
                </Link>
              ))}
            </div>
          </section>

          {/* explain(): the granting path */}
          <Section title="Why — explain() trace">
            {inspect.via ? (
              <div className="rounded-lg border border-zinc-200/70 bg-zinc-50 p-3">
                <Trace node={inspect.via} />
              </div>
            ) : (
              <p className="text-sm text-zinc-500">
                No granting path. No tuple (direct, group, hierarchy, public, or
                field) connects {persona} to this with a relation that satisfies{" "}
                <code>{inspect.action}</code>.
              </p>
            )}
          </Section>

          {/* checkMany(): users × actions */}
          <Section title="Permission matrix — checkMany()">
            <div className="overflow-hidden rounded-lg border border-zinc-200/70">
              <table className="w-full text-center text-xs">
                <caption className="sr-only">
                  Permission matrix: which user can perform which action on this
                  object
                </caption>
                <thead className="bg-zinc-50 text-zinc-500">
                  <tr>
                    <th
                      scope="col"
                      className="px-2 py-1.5 text-left font-medium"
                    >
                      user
                    </th>
                    {ACTIONS.map((a) => (
                      <th
                        key={a}
                        scope="col"
                        title={a}
                        className="px-1 py-1.5 font-medium"
                      >
                        {a.slice(0, 4)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inspect.matrix.map((row) => (
                    <tr key={row.user} className="border-t border-zinc-200">
                      <th
                        scope="row"
                        className="px-2 py-1.5 text-left font-normal capitalize text-zinc-700"
                      >
                        {row.user}
                      </th>
                      {ACTIONS.map((a) => (
                        <td key={a} className="px-1 py-1.5">
                          {row.actions[a] ? (
                            <span className="text-emerald-600">✓</span>
                          ) : (
                            <span className="text-zinc-300">·</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* listSubjects(): the reverse lookup */}
          <Section title="Who can access — listSubjects()">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <WhoBox label="can view" users={inspect.whoCanView} />
              <WhoBox label="can edit" users={inspect.whoCanEdit} />
            </div>
          </Section>

          {/* The stored facts behind the decision. */}
          <Section
            title={`Tuples on this object & its ancestors (${inspect.tuples.length})`}
          >
            <ul className="space-y-1">
              {inspect.tuples.map((t) => (
                <TupleLine key={t.id} t={t} persona={persona} />
              ))}
              {inspect.tuples.length === 0 && (
                <li className="text-sm text-zinc-400">
                  No tuples reference this object.
                </li>
              )}
            </ul>
          </Section>
        </div>
      </aside>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {title}
      </h3>
      {children}
    </section>
  );
}

function WhoBox({ label, users }: { label: string; users: string[] }) {
  return (
    <div className="rounded-lg border border-zinc-200/70 bg-zinc-50 p-2">
      <p className="text-[11px] uppercase tracking-wide text-zinc-400">
        {label}
      </p>
      {users.length ? (
        <p className="mt-1 capitalize text-zinc-800">{users.join(", ")}</p>
      ) : (
        <p className="mt-1 text-zinc-400">nobody</p>
      )}
    </div>
  );
}

const KIND_LABEL: Record<ExplainNode["kind"], string> = {
  direct: "direct relation",
  wildcard: "public (everyone)",
  field: "field inherits from base",
  group: "via group membership",
  hierarchy: "inherited from parent",
};

/** Renders the explain() path as a nested, indented chain. */
function Trace({ node, depth = 0 }: { node: ExplainNode; depth?: number }) {
  let detail: React.ReactNode = null;
  let child: ExplainNode | null = null;

  if (node.kind === "direct" || node.kind === "wildcard") {
    detail = (
      <>
        relation <code className="text-indigo-700">{node.relation}</code>
      </>
    );
  } else if (node.kind === "field") {
    detail = (
      <>
        base{" "}
        <code className="text-zinc-700">
          {node.base.type}:{node.base.id}
        </code>
      </>
    );
    child = node.via;
  } else if (node.kind === "group") {
    detail = (
      <>
        <code className="text-indigo-700">{node.relation}</code> of{" "}
        <code className="text-zinc-700">
          {node.through.type}:{node.through.id}
        </code>
      </>
    );
    child = node.via;
  } else if (node.kind === "hierarchy") {
    detail = (
      <>
        parent{" "}
        <code className="text-zinc-700">
          {node.parent.type}:{node.parent.id}
        </code>{" "}
        via <code className="text-indigo-700">{node.relation}</code>
      </>
    );
    child = node.via;
  }

  return (
    <div style={{ marginLeft: depth * 14 }} className="text-sm">
      <p className="flex items-center gap-2 text-zinc-700">
        <span className="text-emerald-600">{depth === 0 ? "✓" : "↳"}</span>
        <span className="text-zinc-500">{KIND_LABEL[node.kind]}</span>
        <span>{detail}</span>
      </p>
      {child && <Trace node={child} depth={depth + 1} />}
    </div>
  );
}

function TupleLine({ t, persona }: { t: TupleRow; persona: string }) {
  return (
    <li className="flex items-center justify-between gap-2 rounded border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-[11px] text-zinc-500">
      <span className="truncate">
        ({t.subjectType}:<span className="text-zinc-800">{t.subjectId}</span>,{" "}
        <span className="text-indigo-700">{t.relation}</span>, {t.objectType}:
        {t.objectId})
        {t.condition && (
          <span className="text-amber-600" title={t.condition}>
            {" "}
            ⏱/⚖
          </span>
        )}
      </span>
      <Form method="post" className="inline shrink-0">
        <input type="hidden" name="intent" value="revoke" />
        <input type="hidden" name="actingUserId" value={persona} />
        <input type="hidden" name="subjectType" value={t.subjectType} />
        <input type="hidden" name="subjectId" value={t.subjectId} />
        <input type="hidden" name="relation" value={t.relation} />
        <input type="hidden" name="objectType" value={t.objectType} />
        <input type="hidden" name="objectId" value={t.objectId} />
        <button
          className="text-rose-600 hover:underline"
          type="submit"
          title="revoke"
          aria-label={`Revoke ${t.subjectType} ${t.subjectId} ${t.relation}`}
        >
          ✕
        </button>
      </Form>
    </li>
  );
}
