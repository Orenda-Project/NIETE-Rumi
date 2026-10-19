import { describe, it, expect, beforeEach } from "vitest";
import { asFlowPlan, holdPlan, heldPlan } from "./legacyLive";

// bd-v0toag.31.1 — the older record screen's plan, as the live-moves hook reads it, and kept for her return.

const PICK = { lessonId: "g4-sci-ch2-seg3" } as never;

beforeEach(() => holdPlan(null));

describe("legacyLive", () => {
  it("a library plan becomes the hook's library plan", () => {
    expect(asFlowPlan({ kind: "library", pick: PICK, title: "Leaves", sub: "G4" }))
      .toEqual({ kind: "library", pick: PICK, title: "Leaves", chips: [] });
  });

  it("a file plan or none gives the hook nothing", () => {
    expect(asFlowPlan(null)).toBeNull();
    expect(asFlowPlan({ kind: "file", file: new File(["x"], "p.pdf"), title: "p.pdf", sub: "" })).toBeNull();
  });

  it("the plan she picked before Record is held for her return, and cleared", () => {
    const plan = { kind: "library" as const, pick: PICK, title: "Leaves", sub: "" };
    holdPlan(plan);
    expect(heldPlan()).toBe(plan);
    holdPlan(null);
    expect(heldPlan()).toBeNull();
  });
});
