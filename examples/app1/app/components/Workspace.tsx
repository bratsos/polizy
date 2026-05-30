import * as React from "react";
import { Form, Link, useSearchParams } from "react-router";
import type { Action, Entity, Opened } from "../routes/home";

const ICON: Record<string, string> = {
  folder: "📁",
  document: "📄",
  team: "👥",
};

const btn =
  "inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40";
const input =
  "w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none";

type Props = {
  persona: string;
  entities: Entity[];
  opened: Opened | null;
  openKey: string | null;
};

export default function Workspace({
  persona,
  entities,
  opened,
  openKey,
}: Props) {
  const [params] = useSearchParams();
  const href = (over: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(over)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    return `/?${next.toString()}`;
  };

  const folders = entities.filter((e) => e.type === "folder");
  const looseDocs = entities.filter(
    (e) => e.type === "document" && !e.parentKey,
  );
  const teams = entities.filter((e) => e.type === "team");

  const Row = ({ e, nested }: { e: Entity; nested?: boolean }) => (
    <Link
      to={href({ open: e.key, inspect: null, action: null })}
      title={e.accessible ? undefined : `No access to ${e.name} as ${persona}`}
      className={`group flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors ${
        nested ? "ml-4" : ""
      } ${openKey === e.key ? "bg-indigo-50 text-indigo-700" : "hover:bg-zinc-100"} ${
        e.accessible ? "text-zinc-800" : "text-zinc-400"
      }`}
    >
      <span className="flex items-center gap-2 truncate">
        <span aria-hidden>{ICON[e.type]}</span>
        <span className="truncate">{e.name}</span>
        {!e.accessible && (
          <span aria-label="no access" title="No access">
            🔒
          </span>
        )}
      </span>
      {e.accessible && e.actions.length > 0 && (
        <span className="ml-2 hidden shrink-0 gap-1 group-hover:flex group-focus-within:flex">
          {e.actions.slice(0, 3).map((a) => (
            <span
              key={a}
              className="rounded bg-zinc-100 px-1 text-[10px] text-zinc-500"
            >
              {a}
            </span>
          ))}
        </span>
      )}
    </Link>
  );

  return (
    <>
      <aside className="border-r border-zinc-200 bg-white p-3 lg:min-h-[calc(100vh-57px)]">
        <nav className="space-y-0.5">
          {folders.map((f) => (
            <div key={f.key}>
              <Row e={f} />
              {entities
                .filter((e) => e.parentKey === f.key)
                .map((c) => (
                  <Row key={c.key} e={c} nested />
                ))}
            </div>
          ))}
          {looseDocs.map((d) => (
            <Row key={d.key} e={d} />
          ))}
          {teams.length > 0 && (
            <div className="pt-2 text-[10px] uppercase tracking-wide text-zinc-400">
              Teams
            </div>
          )}
          {teams.map((t) => (
            <Row key={t.key} e={t} />
          ))}
        </nav>

        <div className="mt-4 space-y-2 border-t border-zinc-200 pt-4">
          <p className="text-[10px] uppercase tracking-wide text-zinc-400">
            Create (you become owner)
          </p>
          {(
            [
              ["createDocument", "title", "New document…"],
              ["createFolder", "name", "New folder…"],
              ["createTeam", "name", "New team…"],
            ] as const
          ).map(([intent, field, placeholder]) => (
            <Form key={intent} method="post" className="flex gap-1">
              <input type="hidden" name="intent" value={intent} />
              <input type="hidden" name="actingUserId" value={persona} />
              <input
                className={input}
                name={field}
                placeholder={placeholder}
                required
              />
              <button className={btn} type="submit">
                +
              </button>
            </Form>
          ))}
        </div>
      </aside>

      <main className="min-h-[calc(100vh-57px)] p-6">
        {!opened ? (
          <Empty persona={persona} />
        ) : (
          <ResourceView persona={persona} opened={opened} href={href} />
        )}
      </main>
    </>
  );
}

function Empty({ persona }: { persona: string }) {
  return (
    <div className="mx-auto mt-20 max-w-md text-center text-zinc-500">
      <div className="text-4xl">🗂️</div>
      <p className="mt-3 text-sm">
        Select a resource to open it. You're acting as{" "}
        <span className="font-medium capitalize text-zinc-800">{persona}</span>.
        Locked items (🔒) are visible but inaccessible — open one and hit{" "}
        <em>Inspect</em> to see exactly why.
      </p>
    </div>
  );
}

function ResourceView({
  persona,
  opened,
  href,
}: {
  persona: string;
  opened: Opened;
  href: (over: Record<string, string | null>) => string;
}) {
  const [editing, setEditing] = React.useState(false);
  const allow = (a: Action) => opened.actions.includes(a);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-semibold text-zinc-900">
          <span aria-hidden>{ICON[opened.type]}</span>
          {opened.name}
          <span className="font-mono text-xs font-normal text-zinc-400">
            {opened.key}
          </span>
        </h2>
        <Link
          to={href({
            inspect: opened.key,
            action: opened.type === "team" ? "manage_members" : "view",
          })}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          🔍 Inspect access
        </Link>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {(
          ["view", "edit", "delete", "share", "manage_members"] as Action[]
        ).map((a) => (
          <span
            key={a}
            className={`rounded px-1.5 py-0.5 text-[11px] ${
              allow(a)
                ? "bg-emerald-50 text-emerald-700"
                : "bg-zinc-100 text-zinc-400"
            }`}
          >
            {allow(a) ? "✓" : "✗"} {a}
          </span>
        ))}
      </div>

      <div className="mt-5 rounded-lg border border-zinc-200 bg-white p-5">
        {opened.type === "document" ? (
          <DocumentBody
            persona={persona}
            opened={opened}
            allow={allow}
            editing={editing}
            setEditing={setEditing}
          />
        ) : !opened.canView ? (
          <p className="text-sm text-zinc-500">
            🔒 You can't view this as {persona}. Hit <em>Inspect access</em> to
            see why, then switch persona or grant access.
          </p>
        ) : opened.type === "folder" ? (
          <ul className="space-y-1 text-sm">
            {(opened.children ?? []).map((c) => (
              <li key={c.key}>
                <Link
                  className="text-indigo-600 hover:underline"
                  to={href({ open: c.key, inspect: null, action: null })}
                >
                  {ICON[c.type]} {c.name}
                </Link>
              </li>
            ))}
            {(opened.children ?? []).length === 0 && (
              <li className="text-zinc-400">
                No documents in this folder yet.
              </li>
            )}
          </ul>
        ) : (
          <TeamMembers persona={persona} opened={opened} allow={allow} />
        )}
      </div>

      <Toolbar
        persona={persona}
        opened={opened}
        allow={allow}
        editing={editing}
        setEditing={setEditing}
      />
    </div>
  );
}

function DocumentBody({
  persona,
  opened,
  allow,
  editing,
  setEditing,
}: {
  persona: string;
  opened: Opened;
  allow: (a: Action) => boolean;
  editing: boolean;
  setEditing: (v: boolean) => void;
}) {
  return (
    <div>
      {opened.canView ? (
        editing && allow("edit") ? (
          <Form
            method="post"
            onSubmit={() => setEditing(false)}
            className="space-y-2"
          >
            <input type="hidden" name="intent" value="saveEdit" />
            <input type="hidden" name="actingUserId" value={persona} />
            <input type="hidden" name="resourceKey" value={opened.key} />
            <textarea
              name="content"
              defaultValue={opened.content ?? ""}
              rows={12}
              className={`${input} font-mono`}
            />
            <div className="flex gap-2">
              <button className={btn} type="submit">
                Save
              </button>
              <button
                className={btn}
                type="button"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            </div>
          </Form>
        ) : (
          <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-zinc-700">
            {opened.content || "(empty)"}
          </pre>
        )
      ) : (
        <p className="text-sm text-zinc-500">
          🔒 You can't view the full document as {persona}.
        </p>
      )}

      {/* Field-level access: an id like `doc-payroll#summary` is granted on its
          own, so a persona can see a single field even when the base is locked. */}
      {opened.fields && opened.fields.length > 0 && (
        <div className="mt-4 border-t border-zinc-200 pt-4">
          <p className="text-[10px] uppercase tracking-wide text-zinc-400">
            Field-level access (doc#field)
          </p>
          <div className="mt-2 space-y-2">
            {opened.fields.map((f) => (
              <div
                key={f.id}
                className="rounded-md border border-zinc-200 bg-zinc-50 p-3"
              >
                <code className="text-xs text-indigo-700">{f.id}</code>
                {f.canView ? (
                  <p className="mt-1 text-sm text-zinc-700">{f.content}</p>
                ) : (
                  <p className="mt-1 text-sm text-zinc-400">
                    🔒 no access to this field
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TeamMembers({
  persona,
  opened,
  allow,
}: {
  persona: string;
  opened: Opened;
  allow: (a: Action) => boolean;
}) {
  return (
    <div className="space-y-2">
      <ul className="space-y-1 text-sm">
        {(opened.members ?? []).map((m) => (
          <li key={m.id} className="flex items-center justify-between">
            <span className="capitalize text-zinc-700">👤 {m.name}</span>
            {allow("manage_members") && (
              <Form method="post" className="inline">
                <input type="hidden" name="intent" value="removeMember" />
                <input type="hidden" name="actingUserId" value={persona} />
                <input type="hidden" name="teamKey" value={opened.key} />
                <input type="hidden" name="userId" value={m.id} />
                <button
                  className="text-xs text-rose-600 hover:underline"
                  type="submit"
                >
                  remove
                </button>
              </Form>
            )}
          </li>
        ))}
        {(opened.members ?? []).length === 0 && (
          <li className="text-zinc-400">No members.</li>
        )}
      </ul>
      {allow("manage_members") && (
        <Form method="post" className="flex gap-1 pt-2">
          <input type="hidden" name="intent" value="addMember" />
          <input type="hidden" name="actingUserId" value={persona} />
          <input type="hidden" name="teamKey" value={opened.key} />
          <input
            className={input}
            name="userId"
            placeholder="user id to add (e.g. bob)"
            required
          />
          <button className={btn} type="submit">
            Add
          </button>
        </Form>
      )}
    </div>
  );
}

function Toolbar({
  persona,
  opened,
  allow,
  editing,
  setEditing,
}: {
  persona: string;
  opened: Opened;
  allow: (a: Action) => boolean;
  editing: boolean;
  setEditing: (v: boolean) => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {opened.type === "document" && allow("edit") && !editing && (
        <button className={btn} type="button" onClick={() => setEditing(true)}>
          ✏️ Edit
        </button>
      )}
      {allow("delete") && (
        <Form
          method="post"
          onSubmit={(e) => {
            if (!confirm(`Delete ${opened.name}?`)) e.preventDefault();
          }}
        >
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="actingUserId" value={persona} />
          <input type="hidden" name="resourceKey" value={opened.key} />
          <button
            className={`${btn} border-rose-200 text-rose-600 hover:bg-rose-50`}
            type="submit"
          >
            🗑 Delete
          </button>
        </Form>
      )}
      {allow("share") && <ShareControls persona={persona} opened={opened} />}
    </div>
  );
}

function ShareControls({
  persona,
  opened,
}: {
  persona: string;
  opened: Opened;
}) {
  const hidden = (
    <>
      <input type="hidden" name="actingUserId" value={persona} />
      <input type="hidden" name="resourceKey" value={opened.key} />
    </>
  );
  return (
    <details className="w-full rounded-lg border border-zinc-200 bg-white p-3">
      <summary className="cursor-pointer text-sm font-medium text-zinc-700">
        🔗 Share — every grant type
      </summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Form method="post" className="space-y-1.5">
          <input type="hidden" name="intent" value="share" />
          {hidden}
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">
            Direct grant
          </p>
          <input
            className={input}
            name="targetUserId"
            placeholder="user id"
            required
          />
          <select className={input} name="relation" defaultValue="viewer">
            <option value="viewer">viewer</option>
            <option value="editor">editor</option>
            <option value="owner">owner</option>
          </select>
          <button className={btn} type="submit">
            Grant
          </button>
        </Form>

        <Form method="post" className="space-y-1.5">
          <input type="hidden" name="intent" value="shareTimed" />
          {hidden}
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">
            Time-limited (validUntil)
          </p>
          <input
            className={input}
            name="targetUserId"
            placeholder="user id"
            required
          />
          <input
            className={input}
            name="days"
            type="number"
            min={1}
            defaultValue={7}
          />
          <button className={btn} type="submit">
            Grant for N days
          </button>
        </Form>

        <Form method="post" className="space-y-1.5">
          <input type="hidden" name="intent" value="sharePublic" />
          {hidden}
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">
            Public — everyone(user)
          </p>
          <button className={btn} type="submit">
            Make public
          </button>
        </Form>

        {opened.type === "document" && (
          <Form method="post" className="space-y-1.5">
            <input type="hidden" name="intent" value="shareField" />
            {hidden}
            <p className="text-[11px] uppercase tracking-wide text-zinc-400">
              Field-level (doc#field)
            </p>
            <input
              className={input}
              name="field"
              placeholder="field (e.g. summary)"
              required
            />
            <input
              className={input}
              name="targetUserId"
              placeholder="user id"
              required
            />
            <button className={btn} type="submit">
              Grant field
            </button>
          </Form>
        )}
      </div>
    </details>
  );
}
