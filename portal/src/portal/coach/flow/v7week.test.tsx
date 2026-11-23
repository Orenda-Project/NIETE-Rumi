import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { loadApp, net, renderApp, resetAll } from "../card/harness.testdata";
import { EMIS, schoolCard } from "../card/fixtures.testdata";

vi.mock("axios", async () => (await import("../card/harness.testdata")).axiosMock());
vi.mock("./track", () => ({ trackFlow: vi.fn() }));
vi.setConfig({ testTimeout: 20_000 });

/**
 * bd-o15qnr.28.1 (queue #204, v7; #188's c8-home-monday board) — the coach Home on the v6/v7 switch, with the real guard,
 * flag hooks, Home and menu (only the network is mocked):
 *
 *   Monday   on the first open each Monday (Pakistan's day), while last week's report is ready and not yet opened, the
 *            Focus card's ONE slot shows "Your week": n/12 complete observations, the Key Focus Area and its count with
 *            the goal at 6 of 10. It opens the week page. Counts, never a % (the operator, 20 Nov 15:04).
 *            The ready card above does not repeat the week (one thing, once).
 *   other    any other day, or no week ready (opened, closed, none), or no weekly report for her: today's Focus card
 *   tile     "My progress", right after Observe (v7 only)
 */
function config(features: Record<string, unknown>) {
  net.answers.set("/config", { success: true, features: { coachV2: true, schoolCard: true, coachip: false, coachFullApp: true, coachFlowV2: true, coachReportsApp: true, ...features } });
  net.answers.set("/coach/people", { success: true, schools: [{ emis: EMIS, name: "Model School Nine", teachers: 12, visits: 1, daysSinceVisit: 1, avgHitl: 60 }], teachers: [] });
  net.answers.set(`/coach/school/${EMIS}/card`, schoolCard());
  net.answers.set("/coach/home", { success: true, home: { today: [], next: null, counts: { week: 5, overdue: 0, waiting: 1, inProgress: 0, teachers: 20, schools: 6 } } });
  net.answers.set("/coach/schedule", { success: true, visits: [], overdue: [] });
  net.answers.set("/coach/reports", { success: true, inProgress: [], all: { total: 1, page: 1, pageSize: 20, items: [] },
    waiting: [{ id: "r2", createdAt: "2026-11-10T05:00:00Z", teacherName: "Lubna Arif", teacherPhone: null, teacherExtId: null, schoolName: "IMSG (I-V) G-7/3", schoolExtId: null, status: "x", step: "talk", score: null, portal: true }] });
}
const READY_WEEK = { kind: "week", id: "2026-11-16", monday: "2026-11-16", friday: "2026-11-20", at: "2026-11-20T11:00:00.000Z", debriefs: 5 };
const both = (en: string, ur: string) => ({ en, ur });
const WEEK = {
  monday: "2026-11-16", friday: "2026-11-20", target: 12, complete: 5, debriefs: 5, small: false, respectAll: true, training: 3,
  focus: { key: "asked_and_waited", name: both("Asked & waited", "سوال کے بعد انتظار"), why: both("w", "و"), week: { done: 2, of: 5 }, last: null, days: [],
    last10: { done: 4, of: 10 }, doneAt: 6, reached: false, next: null, nextName: null, steps: null },
  strengths: [], keepInMind: [], table: [],
};
function ready(reports: unknown[]) {
  net.answers.set("/coach/reports/ready", { success: true, reports });
  net.answers.set("/coach/week/2026-11-16", { success: true, week: WEEK });
}
const MONDAY = new Date("2026-11-23T05:00:00Z"); // Monday 10:00 in Pakistan
const TUESDAY = new Date("2026-11-24T05:00:00Z");

beforeAll(async () => { await loadApp(); }, 120_000);
beforeEach(async () => {
  await resetAll();
  (await import("./useCoachFlowV2")).resetCoachFlowV2Memory();
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => { vi.useRealTimers(); });

describe("Home on Monday: Your week in the Focus card", () => {
  it("last week's report ready and not opened: Your week, its count against 12 and the Key Focus Area; it opens the week page", async () => {
    vi.setSystemTime(MONDAY);
    config({});
    ready([READY_WEEK]);
    await renderApp("/portal/coach");
    const card = await screen.findByTestId("focus-week");
    expect(card).toHaveTextContent("Your week · 16–20 Nov");
    expect(card).toHaveTextContent("5/12");
    expect(card).toHaveTextContent("complete observations");
    expect(card.querySelectorAll('[data-segment="on"]')).toHaveLength(5);
    expect(card).toHaveTextContent("Key Focus Area: Asked & waited");
    expect(card).toHaveTextContent("4 of 10");
    expect(card).toHaveTextContent("Goal 6 of 10");
    expect(within(card).getByTestId("goal-bar").getAttribute("data-goal")).toBe("60");
    expect(card.textContent).not.toMatch(/%/);
    expect(card.closest("a")).toHaveAttribute("href", "/portal/coach/week/2026-11-16");
    // the one slot: nothing else in it, and the ready card does not repeat the week
    expect(screen.queryByTestId("focus-waiting")).toBeNull();
    expect(screen.queryByTestId("coach-report-card")).toBeNull();
  });

  it("in Urdu", async () => {
    vi.setSystemTime(MONDAY);
    config({});
    ready([READY_WEEK]);
    await renderApp("/portal/coach", "ur");
    const card = await screen.findByTestId("focus-week");
    expect(card).toHaveTextContent("آپ کا ہفتہ");
    expect(card).toHaveTextContent("مکمل مشاہدات");
    expect(card).toHaveTextContent("سوال کے بعد انتظار");
    expect(card).toHaveTextContent("ہدف: 10 میں سے 6");
  });

  it("not Monday: today's Focus card (what waits on her)", async () => {
    vi.setSystemTime(TUESDAY);
    config({});
    ready([READY_WEEK]);
    await renderApp("/portal/coach");
    expect(await screen.findByTestId("focus-waiting")).toBeInTheDocument();
    expect(screen.queryByTestId("focus-week")).toBeNull();
  });

  it("Monday, but the week is opened or closed (no week in the ready list): today's Focus card", async () => {
    vi.setSystemTime(MONDAY);
    config({});
    ready([]);
    await renderApp("/portal/coach");
    expect(await screen.findByTestId("focus-waiting")).toBeInTheDocument();
    expect(screen.queryByTestId("focus-week")).toBeNull();
  });

  it("Monday, no weekly report for her (coach_reports_app off): today's Focus card, the ready list never asked", async () => {
    vi.setSystemTime(MONDAY);
    config({ coachReportsApp: false });
    ready([READY_WEEK]);
    await renderApp("/portal/coach");
    expect(await screen.findByTestId("focus-waiting")).toBeInTheDocument();
    expect(screen.queryByTestId("focus-week")).toBeNull();
    expect(net.calls).not.toContain("/coach/reports/ready");
  });
});

describe("the My progress tile", () => {
  it("switch on: right after Observe, opening My progress", async () => {
    vi.setSystemTime(TUESDAY);
    config({});
    ready([]);
    await renderApp("/portal/coach");
    const tiles = await screen.findByTestId("feature-tiles");
    await waitFor(() => expect(Array.from(tiles.querySelectorAll("a")).map((a) => a.getAttribute("href")).slice(0, 2))
      .toEqual(["/portal/coach/observe", "/portal/coach/progress"]));
    expect(tiles.querySelectorAll("a")[1]).toHaveTextContent("My progress");
  });

  it("in Urdu: میری پیش رفت", async () => {
    vi.setSystemTime(TUESDAY);
    config({});
    ready([]);
    await renderApp("/portal/coach", "ur");
    const tiles = await screen.findByTestId("feature-tiles");
    await waitFor(() => expect(tiles).toHaveTextContent("میری پیش رفت"));
  });

  it.each([false, undefined, "true"])("switch off (coachFlowV2 = %s): no tile, no Your week", async (value) => {
    vi.setSystemTime(MONDAY);
    config({ coachFlowV2: value });
    ready([READY_WEEK]);
    await renderApp("/portal/coach");
    const tiles = await screen.findByTestId("feature-tiles");
    await waitFor(() => expect(Array.from(tiles.querySelectorAll("a")).map((a) => a.getAttribute("href")).slice(0, 2))
      .toEqual(["/portal/coach/scheduling", "/portal/coach/observe"]));
    expect(tiles.querySelector('a[href="/portal/coach/progress"]')).toBeNull();
    expect(screen.queryByTestId("focus-week")).toBeNull();
  });
});
