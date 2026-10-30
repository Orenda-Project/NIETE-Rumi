import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";

vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, expectContract, F, renderRm, rmWorld, serve } from "./harness";
import { RM_COPY } from "../rm.copy";

/**
 * fix-r5 s2 items 3 (RM half) + 5 (red-3 B10 082603; qa-rm 072623; panel b1, e4): a count whose base is 0 is a state with
 * nothing to count, so it is WORDS, never "0 of 0" (and never a number node). S8 coach rows, S9 steps, S10 open-steps
 * line and chips; S8's cluster card with no date drops the date slot (no " ·  · ").
 */
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const C03 = "00000000-0000-4000-8000-070000000003";
const zero = (window_id: string) => ({ n: 0, d: 0, window_id });
const ZERO_OF_ZERO = /\b0 of 0\b|۰ میں سے ۰/;
const strip = (s: string | null | undefined) => (s || "").replace(/[⁦-⁩]/g, "");

describe.each(["en", "ur"] as const)("B10 words on the RM pages (%s)", (lang) => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T05:00:00Z"));
    await boot(lang);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

  it("S8 coach row: d = 0 debriefs / checks / schools are words, no number node, no '0 of 0'", async () => {
    const h = clone(F.rm_home);
    const a = h.groups.needs_me[0].activity;
    a.debriefs_with_step = zero(a.debriefs_with_step.window_id);
    a.checks_overdue = zero(a.checks_overdue.window_id);
    a.schools_unvisited = zero(a.schools_unvisited.window_id);
    serve(rmWorld({ "/coachip/rm/home": h }));
    await renderRm("");
    const row = screen.getAllByTestId("coach-row")[0];
    expect(ZERO_OF_ZERO.test(row.textContent || "")).toBe(false);
    expect(row.querySelector('[data-num][data-den="0"]')).toBeNull();
    const text = strip(row.textContent);
    expect(text).toContain(RM_COPY["s8.activity.steps.none"][lang]);
    expect(text).toContain(RM_COPY["s8.activity.overdue.none"][lang]);
    expect(text).toContain(RM_COPY["s8.activity.unvisited.none"][lang]);
    expectContract(screen.getByTestId("rm-home"), expect);
  });

  it("S8 cluster with no date: the no-date sentence, no empty slot", async () => {
    const h = clone(F.rm_home);
    h.cluster.date = null;
    serve(rmWorld({ "/coachip/rm/home": h }));
    await renderRm("");
    const t = strip(screen.getByTestId("rm-cluster").textContent);
    expect(/·\s*·|،\s*،/.test(t)).toBe(false);
    expect(t).toBe(RM_COPY["s8.cluster.no_date"][lang].replace("{title}", h.cluster.title[lang]));
  });

  it("S8 cluster with a date: unchanged", async () => {
    serve(rmWorld());
    await renderRm("");
    expect(screen.getByTestId("rm-cluster").querySelector("[data-date]")).toBeTruthy();
  });

  it("S9 steps with d = 0: 'No steps set this month', no number node", async () => {
    const c = clone(F.rm_coach);
    const w = c.steps.open.window_id;
    c.steps = { open: zero(w), completed: zero(w), overdue: zero(w) };
    serve(rmWorld({ [`/coachip/rm/coach/${C03}`]: c }));
    await renderRm(`/coach/${C03}`);
    const card = screen.getByTestId("s9-steps");
    expect(ZERO_OF_ZERO.test(card.textContent || "")).toBe(false);
    expect(card.querySelector("[data-num]")).toBeNull();
    expect(card.textContent).toContain(RM_COPY["s9.steps.none"][lang]);
    expectContract(screen.getByTestId("rm-coach"), expect);
  });

  it("S10: a 0-of-0 chip says the coach and words, no count; the open-steps line at d = 0 is words", async () => {
    const c = clone(F.rm_circle);
    serve(rmWorld({ "/coachip/rm/circle": c }));
    await renderRm("/circle");
    const chips = screen.getAllByTestId("s10-check");
    const z = chips[c.checks_due.findIndex((x: { count: { d: number } }) => x.count.d === 0)];
    expect(ZERO_OF_ZERO.test(z.textContent || "")).toBe(false);
    expect(z.querySelector("[data-num]")).toBeNull();
    expect(strip(z.textContent)).toBe(RM_COPY["s10.checks.row.none"][lang].replace("{coach}", "C-10"));
    cleanup();
    const all0 = clone(F.rm_circle);
    all0.checks_due = all0.checks_due.map((x: { coach_label: string; count: { window_id: string } }) => ({ ...x, count: zero(x.count.window_id) }));
    serve(rmWorld({ "/coachip/rm/circle": all0 }));
    await renderRm("/circle");
    const card = screen.getByTestId("s10-checks");
    expect(ZERO_OF_ZERO.test(card.textContent || "")).toBe(false);
    expect(card.querySelector("[data-num]")).toBeNull();
    expect(within(card).getByTestId("s10-checks-none").textContent).toBe(RM_COPY["s10.checks.sub.none"][lang]);
  });
});
