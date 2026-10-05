import { describe, it, expect, vi } from "vitest";
import { findContinue } from "./continue";
import type { ModuleSummary } from "./trainingApi";
import { COURSES_L2, LEVELS, MODULES_C3, VENDORS, level } from "../../../test/trainingFixtures";

/**
 * bd-5rz1v.25 — "Continue <provider>" on the Training page takes her to the part she was last
 * on, derived from the data the training endpoints already send: each part's completed_at is
 * the only timestamp, so the course holding her latest completion is where she was, and its
 * next part (not done, not locked) is where she goes.
 */

type Table = Record<string, (p: Record<string, unknown>) => unknown>;

function fakeGet(table: Table) {
  const calls: string[] = [];
  const get = vi.fn(async (url: string, params?: Record<string, unknown>) => {
    calls.push(`${url}${params ? ` ${JSON.stringify(params)}` : ""}`);
    const f = table[url];
    if (!f) throw new Error(`unexpected ${url}`);
    const out = f(params || {});
    if (out instanceof Error) throw out;
    return out;
  });
  return { get: get as never, calls };
}

const NIETE_ONLY = LEVELS.filter((l) => l.vendor_key === "TALEEMABAD");

describe("findContinue", () => {
  it("goes to the next part of the course she was last in (NIETE · Level 2 · Group Work → Noise and rules)", async () => {
    const { get, calls } = fakeGet({
      "/training/courses": () => ({ courses: COURSES_L2 }),
      "/training/modules": (p) => ({ modules: p.course_id === "c-3" ? MODULES_C3 : [] }),
    });
    const t = await findContinue(VENDORS, NIETE_ONLY, "/portal/training", get);
    expect(t).toEqual({ vendorKey: "TALEEMABAD", levelId: 2, to: "/portal/training/unit/m-4" });
    // One course list and one module list: only the course she is part-way through is opened.
    expect(calls).toEqual(['/training/courses {"level_id":2}', '/training/modules {"course_id":"c-3"}']);
  });

  it("picks the provider whose latest completed part is the most recent", async () => {
    const beaconCourses = [{ id: "bh-1", title: "Phonics", order_index: 0, module_count: 10, completed_count: 1 }];
    const beaconParts = [
      { id: "b-1", title: "Sounds", order_index: 0, duration_seconds: 300, has_video: true, has_audio: false, has_pdf: false, completed_at: "2026-10-02T09:00:00Z" },
      { id: "b-2", title: "Blends", order_index: 1, duration_seconds: 300, has_video: true, has_audio: false, has_pdf: false, completed_at: null },
    ];
    const { get } = fakeGet({
      "/training/courses": (p) => ({ courses: p.level_id === 18 ? beaconCourses : p.level_id === 2 ? COURSES_L2 : [] }),
      "/training/modules": (p) => ({ modules: p.course_id === "bh-1" ? beaconParts : p.course_id === "c-3" ? MODULES_C3 : [] }),
    });
    const levels = LEVELS.filter((l) => l.vendor_key === "TALEEMABAD" || l.vendor_key === "BEACONHOUSE");
    // Group Work's latest completion is 1 Oct; Beacon House English's is 2 Oct.
    const t = await findContinue(VENDORS, levels, "/portal/training", get);
    expect(t).toEqual({ vendorKey: "BEACONHOUSE", levelId: 18, to: "/portal/training/unit/b-2" });
  });

  it("with nothing started, starts the first open level of the first provider in the page's order (NIETE first)", async () => {
    const fresh = [
      level({ id: 18, name: "English", vendor_key: "BEACONHOUSE", order_index: 0, state: "not_started", unlock_logic: "all_modules" }),
      level({ id: 1, name: "Aspiring", vendor_key: "TALEEMABAD", order_index: 0, state: "not_started" }),
      level({ id: 2, name: "Emerging", vendor_key: "TALEEMABAD", order_index: 1, state: "locked" }),
    ];
    const courses = [{ id: "c-a", title: "Routines", order_index: 0, module_count: 3, completed_count: 0 }];
    const parts = [{ id: "p-1", title: "Start", order_index: 0, duration_seconds: 60, has_video: true, has_audio: false, has_pdf: false, completed_at: null }];
    const { get, calls } = fakeGet({
      "/training/courses": () => ({ courses }),
      "/training/modules": () => ({ modules: parts }),
    });
    const t = await findContinue(VENDORS, fresh, "/portal/training", get);
    expect(t).toEqual({ vendorKey: "TALEEMABAD", levelId: 1, to: "/portal/training/unit/p-1" });
    expect(calls[0]).toBe('/training/courses {"level_id":1}');
  });

  it("when the course she was in is finished, opens the level's next unfinished course", async () => {
    const courses = COURSES_L2.map((c) => (c.id === "c-3" ? { ...c, completed_count: 7 } : c));
    const done = MODULES_C3.map((m) => ({ ...m, completed_at: m.completed_at ?? "2026-10-02T08:00:00Z", lock: "passed" }));
    const { get } = fakeGet({
      "/training/courses": () => ({ courses }),
      "/training/modules": (p) => ({ modules: p.course_id === "c-3" ? done : [] }),
    });
    const t = await findContinue(VENDORS, NIETE_ONLY, "/portal/training", get);
    expect(t?.to).toBe("/portal/training/provider/TALEEMABAD/level/2/course/c-4");
  });

  it("when every course of the level is done, opens the level page (its exam)", async () => {
    const levels = [level({ id: 2, name: "Emerging", vendor_key: "TALEEMABAD", order_index: 1, state: "ready_for_quiz", courses_completed: 5, completed_count: 30 })];
    const courses = COURSES_L2.map((c) => ({ ...c, completed_count: c.module_count }));
    const { get } = fakeGet({
      "/training/courses": () => ({ courses }),
      "/training/modules": () => ({ modules: MODULES_C3.map((m) => ({ ...m, completed_at: "2026-10-02T08:00:00Z" })) }),
    });
    const t = await findContinue(VENDORS, levels, "/portal/training", get);
    expect(t?.to).toBe("/portal/training/provider/TALEEMABAD/level/2");
  });

  it("a locked next part sends her to the course page, not into a part she cannot open", async () => {
    const parts = MODULES_C3.map((m) => (m.id === "m-4" ? { ...m, lock: "locked" } : m));
    const { get } = fakeGet({
      "/training/courses": () => ({ courses: COURSES_L2 }),
      "/training/modules": () => ({ modules: parts }),
    });
    const t = await findContinue(VENDORS, NIETE_ONLY, "/portal/training", get);
    expect(t?.to).toBe("/portal/training/provider/TALEEMABAD/level/2/course/c-3");
  });

  it("a failed request still answers: that level's page", async () => {
    const { get } = fakeGet({ "/training/courses": () => new Error("network") });
    const t = await findContinue(VENDORS, NIETE_ONLY, "/portal/training", get);
    expect(t).toEqual({ vendorKey: "TALEEMABAD", levelId: 2, to: "/portal/training/provider/TALEEMABAD/level/2" });
  });

  it("a certified level with parts left still continues (sandbox: I-SAPS certified at 53/54, bd-5rz1v.25.5)", async () => {
    const levels = [level({ id: 26, name: "Level 1: Novice", vendor_key: "ISAPS", order_index: 0, state: "certified", unlock_logic: "all_modules", module_count: 54, completed_count: 53, courses_total: 9, courses_completed: 8 })];
    const courses = [
      { id: "58", title: "Module 1", order_index: 0, module_count: 6, completed_count: 6 },
      { id: "66", title: "Module 9", order_index: 8, module_count: 6, completed_count: 5 },
    ];
    const parts: ModuleSummary[] = [
      ...["433", "434", "435", "436", "437"].map((id, i): ModuleSummary => ({ id, title: `Unit ${i}`, order_index: i, duration_seconds: 60, has_video: true, has_audio: false, has_pdf: false, completed_at: "2026-10-01T00:00:00Z", lock: "passed" })),
      { id: "438", title: "Unit 606", order_index: 5, duration_seconds: 60, has_video: true, has_audio: false, has_pdf: false, completed_at: null, lock: "next" },
    ];
    const { get } = fakeGet({
      "/training/courses": () => ({ courses }),
      "/training/modules": (p) => ({ modules: p.course_id === "66" ? parts : [] }),
    });
    const t = await findContinue(VENDORS, levels, "/portal/training", get);
    expect(t).toEqual({ vendorKey: "ISAPS", levelId: 26, to: "/portal/training/unit/438" });
  });

  it("everything done or locked: nothing to continue", async () => {
    const levels = [
      level({ id: 1, name: "Aspiring", vendor_key: "TALEEMABAD", order_index: 0, state: "certified", module_count: 30, completed_count: 30 }),
      level({ id: 2, name: "Emerging", vendor_key: "TALEEMABAD", order_index: 1, state: "locked" }),
    ];
    const { get, calls } = fakeGet({});
    expect(await findContinue(VENDORS, levels, "/portal/training", get)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("keeps her on the /v2 review URL when she came in on it", async () => {
    const { get } = fakeGet({
      "/training/courses": () => ({ courses: COURSES_L2 }),
      "/training/modules": () => ({ modules: MODULES_C3 }),
    });
    const t = await findContinue(VENDORS, NIETE_ONLY, "/portal/training/v2", get);
    expect(t?.to).toBe("/portal/training/v2/unit/m-4");
  });
});
