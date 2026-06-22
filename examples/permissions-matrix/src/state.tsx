import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { SEED } from "./authz/seed.ts";
import type { AuthStore, MatrixSnapshot } from "./authz/store.ts";

interface StoreContextValue {
  store: AuthStore;
  workspaceId: string;
  workspaces: { id: string; name: string }[];
  setWorkspaceId: (id: string) => void;
  snapshot: MatrixSnapshot | null;
  /** Run a registry mutation, then refresh the snapshot. */
  mutate: (fn: (store: AuthStore) => Promise<unknown>) => Promise<void>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({
  store,
  children,
}: {
  store: AuthStore;
  children: ReactNode;
}) {
  const [workspaceId, setWorkspaceId] = useState(
    SEED.workspaces[0]?.id ?? "acme",
  );
  const [snapshot, setSnapshot] = useState<MatrixSnapshot | null>(null);
  const [version, setVersion] = useState(0);

  // `version` is bumped by `mutate` to force a snapshot refresh after writes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is an intentional refresh trigger
  useEffect(() => {
    let active = true;
    setSnapshot(null);
    store.snapshot(workspaceId).then((snap) => {
      if (active) setSnapshot(snap);
    });
    return () => {
      active = false;
    };
  }, [store, workspaceId, version]);

  const mutate = useCallback(
    async (fn: (store: AuthStore) => Promise<unknown>) => {
      await fn(store);
      setVersion((v) => v + 1);
    },
    [store],
  );

  return (
    <StoreContext.Provider
      value={{
        store,
        workspaceId,
        workspaces: SEED.workspaces.map((w) => ({ id: w.id, name: w.name })),
        setWorkspaceId,
        snapshot,
        mutate,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within a StoreProvider");
  return ctx;
}
