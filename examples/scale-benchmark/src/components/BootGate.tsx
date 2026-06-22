import type { PGlite } from "@electric-sql/pglite";
import { useEffect, useState } from "react";
import { bootDb } from "../authz/db.ts";
import { App } from "./App.tsx";

function BootScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center text-slate-500">
      <div className="text-center">
        <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-500" />
        <p className="text-sm">Booting Postgres in your browser…</p>
      </div>
    </div>
  );
}

/** Boots the in-browser Postgres, showing a loading screen until it is ready. */
export function BootGate() {
  const [db, setDb] = useState<PGlite | null>(null);

  useEffect(() => {
    let active = true;
    // In-memory (not idb://): this is a performance benchmark, and an
    // IndexedDB-backed VFS pays async page-I/O on every query — that swamps the
    // engine's cost by ~100× and would measure the browser's disk, not polizy.
    // The dataset is regenerated each session anyway, so persistence adds nothing.
    bootDb().then((d) => {
      if (active) setDb(d);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!db) return <BootScreen />;
  return <App db={db} />;
}
