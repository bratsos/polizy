import type { AttributePredicate, Condition, JsonScalar } from "./types.ts";

/**
 * Coerce a date-ish value to epoch milliseconds. Accepts `Date`, ISO strings,
 * and numbers (covering the Prisma JSON round-trip where `Date`s come back as
 * strings). Returns `NaN` for anything unparseable so callers can fail closed.
 */
const toMillis = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") {
    return new Date(value).getTime();
  }
  return Number.NaN;
};

/** Resolve a dot-path (e.g. `"user.dept"`) from the context object. */
const resolvePath = (
  context: Record<string, unknown> | undefined,
  path: string,
): unknown =>
  path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, context);

const compare = (predicate: AttributePredicate, actual: unknown): boolean => {
  const { operator, value } = predicate;
  switch (operator) {
    case "eq":
      return actual === value;
    case "ne":
      return actual !== value;
    case "in":
      return Array.isArray(value) && value.includes(actual as JsonScalar);
    case "nin":
      return Array.isArray(value) && !value.includes(actual as JsonScalar);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (typeof actual !== "number" || typeof value !== "number") return false;
      if (operator === "gt") return actual > value;
      if (operator === "gte") return actual >= value;
      if (operator === "lt") return actual < value;
      return actual <= value;
    }
    default:
      return false;
  }
};

/**
 * Returns whether a tuple's condition currently grants access.
 *
 * - No condition → always valid.
 * - Time window: `validSince <= now < validUntil` (lower inclusive, upper
 *   exclusive). Values are coerced; unparseable dates are treated as invalid.
 * - Attribute predicates: every predicate must pass against `context`. A missing
 *   context value or a type mismatch fails the predicate.
 *
 * Evaluation never throws — a malformed condition fails closed (denies) rather
 * than aborting the surrounding authorization check.
 */
export const isConditionValid = (
  condition: Condition | undefined,
  context?: Record<string, unknown>,
): boolean => {
  if (!condition) return true;

  const now = Date.now();

  if (condition.validSince !== undefined) {
    const since = toMillis(condition.validSince);
    if (Number.isNaN(since) || since > now) return false;
  }
  if (condition.validUntil !== undefined) {
    const until = toMillis(condition.validUntil);
    if (Number.isNaN(until) || until <= now) return false;
  }

  if (condition.attributes) {
    for (const predicate of condition.attributes) {
      if (!compare(predicate, resolvePath(context, predicate.attribute))) {
        return false;
      }
    }
  }

  return true;
};
