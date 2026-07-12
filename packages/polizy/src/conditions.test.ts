import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { isConditionValid } from "./conditions.ts";
import type { Condition } from "./types.ts";

describe("isConditionValid", () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ["Date"] });
    mock.timers.setTime(1_000_000); // fixed "now"
  });
  afterEach(() => {
    mock.timers.reset();
  });

  it("returns true when there is no condition", () => {
    assert.equal(isConditionValid(undefined), true);
    assert.equal(isConditionValid({}), true);
  });

  describe("time window", () => {
    it("validUntil in the past => false, in the future => true", () => {
      assert.equal(isConditionValid({ validUntil: new Date(999_999) }), false);
      assert.equal(isConditionValid({ validUntil: new Date(1_000_001) }), true);
    });
    it("validUntil exactly now => false (exclusive upper bound)", () => {
      assert.equal(
        isConditionValid({ validUntil: new Date(1_000_000) }),
        false,
      );
    });
    it("validSince in the future => false; exactly now => true (inclusive lower)", () => {
      assert.equal(
        isConditionValid({ validSince: new Date(1_000_001) }),
        false,
      );
      assert.equal(isConditionValid({ validSince: new Date(1_000_000) }), true);
    });
    it("coerces ISO-string dates (Prisma JSON round-trip shape)", () => {
      // Use real time here: node:test's mocked Date makes `new Date(isoString)`
      // ignore its argument, which would mask the real coercion behaviour.
      mock.timers.reset();
      const future = new Date(Date.now() + 3_600_000).toISOString();
      const past = new Date(Date.now() - 3_600_000).toISOString();
      assert.equal(
        isConditionValid({ validUntil: future } as unknown as Condition),
        true,
      );
      assert.equal(
        isConditionValid({ validUntil: past } as unknown as Condition),
        false,
      );
    });
    it("fails closed on an unparseable date instead of throwing", () => {
      assert.doesNotThrow(() =>
        isConditionValid({ validUntil: "not-a-date" } as unknown as Condition),
      );
      assert.equal(
        isConditionValid({ validUntil: "not-a-date" } as unknown as Condition),
        false,
      );
    });
  });

  describe("attribute predicates", () => {
    const cond = (
      attribute: string,
      operator: string,
      value: unknown,
    ): Condition =>
      ({
        attributes: [{ attribute, operator, value }],
      }) as unknown as Condition;

    it("eq: match => true, mismatch => false, missing key => false", () => {
      assert.equal(
        isConditionValid(cond("dept", "eq", "eng"), { dept: "eng" }),
        true,
      );
      assert.equal(
        isConditionValid(cond("dept", "eq", "eng"), { dept: "sales" }),
        false,
      );
      assert.equal(isConditionValid(cond("dept", "eq", "eng"), {}), false);
      assert.equal(
        isConditionValid(cond("dept", "eq", "eng"), undefined),
        false,
      );
    });
    it("ne", () => {
      assert.equal(
        isConditionValid(cond("tier", "ne", "free"), { tier: "pro" }),
        true,
      );
      assert.equal(
        isConditionValid(cond("tier", "ne", "free"), { tier: "free" }),
        false,
      );
    });
    it("in / nin", () => {
      assert.equal(
        isConditionValid(cond("role", "in", ["a", "b"]), { role: "b" }),
        true,
      );
      assert.equal(
        isConditionValid(cond("role", "in", ["a", "b"]), { role: "c" }),
        false,
      );
      assert.equal(
        isConditionValid(cond("role", "nin", ["a", "b"]), { role: "c" }),
        true,
      );
      assert.equal(
        isConditionValid(cond("role", "nin", ["a", "b"]), { role: "a" }),
        false,
      );
    });
    it("gt/gte/lt/lte numeric, with type-mismatch failing closed", () => {
      assert.equal(isConditionValid(cond("age", "gt", 18), { age: 21 }), true);
      assert.equal(isConditionValid(cond("age", "gt", 18), { age: 18 }), false);
      assert.equal(isConditionValid(cond("age", "gte", 18), { age: 18 }), true);
      assert.equal(isConditionValid(cond("age", "lt", 18), { age: 17 }), true);
      assert.equal(isConditionValid(cond("age", "lte", 18), { age: 18 }), true);
      assert.equal(
        isConditionValid(cond("age", "gt", 18), { age: "21" }),
        false,
      );
    });
    it("resolves nested dot-paths", () => {
      assert.equal(
        isConditionValid(cond("user.dept", "eq", "eng"), {
          user: { dept: "eng" },
        }),
        true,
      );
      assert.equal(
        isConditionValid(cond("user.dept", "eq", "eng"), { user: {} }),
        false,
      );
    });
    it("ANDs multiple predicates", () => {
      const c = {
        attributes: [
          { attribute: "dept", operator: "eq", value: "eng" },
          { attribute: "level", operator: "gte", value: 3 },
        ],
      } as unknown as Condition;
      assert.equal(isConditionValid(c, { dept: "eng", level: 5 }), true);
      assert.equal(isConditionValid(c, { dept: "eng", level: 2 }), false);
      assert.equal(isConditionValid(c, { dept: "sales", level: 5 }), false);
    });
  });

  it("combines time window AND predicates", () => {
    const c = {
      validUntil: new Date(2_000_000),
      attributes: [{ attribute: "dept", operator: "eq", value: "eng" }],
    } as unknown as Condition;
    assert.equal(isConditionValid(c, { dept: "eng" }), true);
    assert.equal(isConditionValid(c, { dept: "sales" }), false);
    mock.timers.setTime(3_000_000); // now past validUntil
    assert.equal(isConditionValid(c, { dept: "eng" }), false);
  });

  describe("malformed condition shapes fail closed and do not throw", () => {
    it("handles attributes that is a plain object instead of an array", () => {
      const c = {
        attributes: { attribute: "dept", operator: "eq", value: "eng" },
      } as unknown as Condition;
      assert.doesNotThrow(() => isConditionValid(c, { dept: "eng" }));
      assert.equal(isConditionValid(c, { dept: "eng" }), false);
    });

    it("handles attributes containing a null entry", () => {
      const c = {
        attributes: [null],
      } as unknown as Condition;
      assert.doesNotThrow(() => isConditionValid(c, { dept: "eng" }));
      assert.equal(isConditionValid(c, { dept: "eng" }), false);
    });

    it("handles predicate whose attribute is not a string", () => {
      const c = {
        attributes: [{ attribute: 123, operator: "eq", value: "eng" }],
      } as unknown as Condition;
      assert.doesNotThrow(() => isConditionValid(c, { dept: "eng" }));
      assert.equal(isConditionValid(c, { dept: "eng" }), false);
    });
  });
});
