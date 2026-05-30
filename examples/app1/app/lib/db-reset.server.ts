import { resetDatabase } from "./polizy.server";

/**
 * In-process database-reset scheduler.
 *
 * The demo is intentionally ephemeral: it resets to the seeded world on a fixed
 * interval so visitors always see a clean, illustrative state. The previous
 * design ran this from a separate pm2 process (`reset-scheduler.js`), which does
 * not run on hosts that only invoke `pnpm start` (e.g. Railway). Running it
 * inside the server process makes the reset work wherever the app runs.
 *
 * Two paths keep it honest:
 *  - `maybeReset()` is awaited by the loader, so the very next page load after a
 *    boundary always returns fresh data (guaranteed, host-agnostic).
 *  - a background interval is the backstop so the world still resets without
 *    visitors. Safe on a single replica; a `resetting` lock prevents overlap.
 */

const intervalMinutes = (() => {
  const raw = process.env.DB_RESET_INTERVAL_MINUTES ?? "15";
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) || n <= 0 ? 15 : n;
})();

const intervalMs = intervalMinutes * 60_000;

/** Next wall-clock boundary that is a whole multiple of the interval. */
function boundaryAfter(t: number): number {
  return Math.ceil((t + 1) / intervalMs) * intervalMs;
}

let nextResetAt = boundaryAfter(Date.now());
let resetting: Promise<void> | null = null;
let started = false;

export function getIntervalMinutes(): number {
  return intervalMinutes;
}

export function getNextResetAt(): number {
  return nextResetAt;
}

/** Reset if the current boundary has passed. Concurrent callers share one run. */
export async function maybeReset(): Promise<void> {
  if (Date.now() < nextResetAt) return;
  if (resetting) return resetting;

  resetting = (async () => {
    try {
      await resetDatabase();
      // Advance only on success, so a failed reset retries on the next tick
      // instead of being silently skipped until the following boundary.
      nextResetAt = boundaryAfter(Date.now());
    } finally {
      resetting = null;
    }
  })();

  return resetting;
}

/** Start the background backstop once per server process. */
export function ensureSchedulerStarted(): void {
  if (started) return;
  started = true;
  const tick = () => {
    maybeReset().catch((error) => {
      console.error("[db-reset] background reset failed:", error);
    });
  };
  const timer = setInterval(tick, 20_000);
  // Don't keep the event loop alive solely for the scheduler.
  if (typeof timer.unref === "function") timer.unref();
}
