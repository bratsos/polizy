import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { defineSchema } from "./types.ts";

describe("defineSchema validation", () => {
  let originalWarn: typeof console.warn;
  let warnCalls: string[];

  beforeEach(() => {
    warnCalls = [];
    originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args.join(" "));
    };
  });

  afterEach(() => {
    console.warn = originalWarn;
  });

  it("should warn when action references undefined relation", () => {
    defineSchema({
      relations: {
        owner: { type: "direct" },
      },
      actionToRelations: {
        read: ["owner", "viewer"] as const, // 'viewer' is not defined in relations
      },
    });

    assert.equal(warnCalls.length, 1);
    assert.ok(
      warnCalls[0].includes("undefined relation"),
      "Warning should mention undefined relation"
    );
    assert.ok(
      warnCalls[0].includes("viewer"),
      "Warning should mention the undefined relation name 'viewer'"
    );
    assert.ok(
      warnCalls[0].includes("read"),
      "Warning should mention the action 'read'"
    );
  });

  it("should warn when hierarchyPropagation references undefined child action", () => {
    defineSchema({
      relations: {
        owner: { type: "direct" },
      },
      actionToRelations: {
        read: ["owner"],
      },
      hierarchyPropagation: {
        write: ["read"], // 'write' is not defined in actionToRelations
      } as Record<string, readonly string[]>,
    });

    assert.equal(warnCalls.length, 1);
    assert.ok(
      warnCalls[0].includes("undefined child action"),
      "Warning should mention undefined child action"
    );
    assert.ok(
      warnCalls[0].includes("write"),
      "Warning should mention the undefined child action name 'write'"
    );
  });

  it("should warn when hierarchyPropagation references undefined parent action", () => {
    defineSchema({
      relations: {
        owner: { type: "direct" },
      },
      actionToRelations: {
        read: ["owner"],
      },
      hierarchyPropagation: {
        read: ["manage"], // 'manage' is not defined in actionToRelations
      } as Record<string, readonly string[]>,
    });

    assert.equal(warnCalls.length, 1);
    assert.ok(
      warnCalls[0].includes("undefined parent action"),
      "Warning should mention undefined parent action"
    );
    assert.ok(
      warnCalls[0].includes("manage"),
      "Warning should mention the undefined parent action name 'manage'"
    );
  });

  it("should not warn for valid schema", () => {
    defineSchema({
      relations: {
        owner: { type: "direct" },
        viewer: { type: "direct" },
        parent: { type: "hierarchy" },
      },
      actionToRelations: {
        read: ["owner", "viewer"],
        write: ["owner"],
        manage: ["owner"],
      },
      hierarchyPropagation: {
        read: ["manage"],
        write: ["manage"],
      },
    });

    assert.equal(
      warnCalls.length,
      0,
      "No warnings should be produced for a valid schema"
    );
  });
});
