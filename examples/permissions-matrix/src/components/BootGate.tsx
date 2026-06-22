import { useEffect, useState } from "react";
import { AuthStore } from "../authz/store.ts";
import { StoreProvider } from "../state.tsx";
import { App } from "./App.tsx";

/** Shown on first paint while PGlite (Postgres in WASM) boots in the browser. */
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

/**
 * Boots the per-visitor in-browser database, showing a loading screen until it
 * is ready — the same beat app1 covers with React Router's HydrateFallback.
 */
export function BootGate() {
  const [store, setStore] = useState<AuthStore | null>(null);

  useEffect(() => {
    let active = true;
    AuthStore.boot("idb://polizy-matrix-demo").then((s) => {
      if (active) setStore(s);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!store) return <BootScreen />;
  return (
    <StoreProvider store={store}>
      <App />
    </StoreProvider>
  );
}
