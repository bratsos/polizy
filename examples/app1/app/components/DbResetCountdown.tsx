import * as React from "react";
import { useRevalidator } from "react-router";

/**
 * Counts down to the server-provided `nextResetAt` (epoch ms). When it elapses,
 * the server has already reset on the next request, so we revalidate to pull the
 * fresh world in place (no full page reload needed).
 */
export default function DbResetCountdown({
  nextResetAt,
}: {
  nextResetAt: number;
}) {
  const revalidator = useRevalidator();
  // Start null so SSR and first client paint agree (avoids a hydration mismatch);
  // the real countdown is filled in once mounted.
  const [label, setLabel] = React.useState<string | null>(null);

  React.useEffect(() => {
    let revalidated = false;
    setLabel(fmt(nextResetAt - Date.now()));
    const id = setInterval(() => {
      const remaining = nextResetAt - Date.now();
      setLabel(fmt(remaining));
      if (remaining <= 0 && !revalidated) {
        revalidated = true;
        // Give the server a beat to perform the reset, then refetch.
        setTimeout(() => revalidator.revalidate(), 800);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [nextResetAt, revalidator]);

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 font-mono text-xs text-zinc-400"
      title="The demo database resets to its seeded state on a fixed interval."
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
      resets in {label ?? "--:--"}
    </span>
  );
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
