import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: { children: unknown }) => <>{children as never}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hina", role: "coach" }, loading: false }) }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
const getCoachProgress = vi.fn();
vi.mock("./api", async (orig) => ({ ...(await orig<typeof import("./api")>()), getCoachProgress: () => getCoachProgress() }));
const flow = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("../flow/useCoachFlowV2", async (orig) => ({ ...(await orig<object>()), useFlowV6: () => flow.on, useFlowV2: () => flow.on }));
vi.mock("../../services/api", async (orig) => {
  const real = await orig<typeof import("../../services/api")>();
  return { ...real, language: { get: async () => ({ language: "en", locked: false }), set: async () => ({}) } };
});

import CoachProgressPage from "./CoachProgressPage";
import type { CoachProgress } from "./api";

/**
 * bd-o15qnr.28.1 (queue #204, v7; #188's c8-progress board, "My progress, closer to the reports") — the coach's own
 * progress, read-only, behind the v6/v7 switch (useFlowV6):
 *
 *   1 the reports' dark top card: THIS WEEK, n/12 complete observations, twelve segments
 *   2 the Key Focus Area (option B: tinted card, purple start edge, target icon): its name, "4 of 10", a bar with the goal
 *     mark at 6 of 10, "Goal 6 of 10"
 *   3 Respect held on its own green line ("a must every time; not one of the 8"), above the 8
 *   4 Your behaviours, last 10 debriefs: exactly 8 rows, "9 of 10" with a bar, green from 60%, amber below
 *   5 Observations: the 3 most recent (the debrief's behaviours seen as a %, or where the visit stands), See all observations
 *   6 Weekly reports: each opens its week page
 *
 * Counts, never a %, except a debrief's own score (the operator 20 Nov 15:04: "Just the debrief scores like 2/8, 5/8").
 * No buttons that act, no averages, no stars. Every number from the server. Off: today (no page, back to Home).
 */
const both = (en: string, ur: string) => ({ en, ur });
const B = (key: string, en: string, ur: string, done: number, of = 10) => ({ key, name: both(en, ur), done, of });
const PROGRESS: CoachProgress = {
  week: { monday: "2026-11-16", friday: "2026-11-20", complete: 3, target: 12 },
  focus: { key: "asked_and_waited", name: both("Asked & waited", "سوال کے بعد انتظار"), last10: { done: 4, of: 10 }, doneAt: 6, window: 10 },
  behaviours: [
    B("opened_with_specific_praise", "Specific praise", "مخصوص تعریف", 10),
    B("moves_not_teacher", "Moves, not person", "تدریس پر بات", 9),
    B("rehearsed_the_step", "Rehearsed aloud", "زبانی مشق", 6),
    B("righting_reflex_held", "Talked less", "استاد کو بولنے کا موقع", 5),
    B("asked_and_waited", "Asked & waited", "سوال کے بعد انتظار", 4),
    B("one_improvement_only", "One improvement", "صرف ایک بہتری", 3),
    B("elicited_if_then", "Teacher's own step", "استاد کا اپنا اگلا قدم", 2),
    B("anchored_in_real_moment", "Real moment", "سبق کے لمحے کا حوالہ", 0),
  ],
  window: 10,
  respectAll: true,
  observations: [
    { id: "cs-3", at: "2026-11-19T04:00:00Z", teacher: "Lubna Arif", step: "report", debrief: { done: 3, total: 8 } },
    { id: "cs-2", at: "2026-11-18T04:00:00Z", teacher: "Ambreen Gul", step: "sent", debrief: { done: 5, total: 8 } },
    { id: "cs-1", at: "2026-11-16T04:00:00Z", teacher: "Rabia Nawaz", step: "talk", debrief: null },
  ],
  weeks: [
    { monday: "2026-11-09", friday: "2026-11-13", complete: 4, target: 12 },
    { monday: "2026-11-02", friday: "2026-11-06", complete: 7, target: 12 },
  ],
};

const renderAt = () => render(
  <MemoryRouter initialEntries={["/portal/coach/progress"]}>
    <Routes>
      <Route path="/portal/coach/progress" element={<CoachProgressPage />} />
      <Route path="/portal/coach" element={<p data-testid="home">Home</p>} />
    </Routes>
  </MemoryRouter>,
);

beforeAll(async () => { if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} }); });
beforeEach(async () => {
  flow.on = true;
  getCoachProgress.mockReset();
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("My progress (v7)", () => {
  it("in the board's order: the dark top card, the Key Focus Area, Respect, the 8, Observations, Weekly reports", async () => {
    getCoachProgress.mockResolvedValue(PROGRESS);
    renderAt();
    const body = await screen.findByTestId("progress-body");
    const order = ["progress-week", "progress-focus", "progress-respect", "progress-behaviours", "progress-observations", "progress-weeks"];
    const ids = Array.from(body.querySelectorAll("[data-testid]")).map((e) => String(e.getAttribute("data-testid")));
    expect(ids.filter((x) => order.includes(x))).toEqual(order);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("My progress");
  });

  it("the top card: this week, n/12 complete observations, twelve segments with n filled; a count, never a %", async () => {
    getCoachProgress.mockResolvedValue(PROGRESS);
    renderAt();
    const week = await screen.findByTestId("progress-week");
    expect(week).toHaveTextContent(/this week/i);
    expect(week).toHaveTextContent("3/12");
    expect(week).toHaveTextContent("complete observations");
    const segs = week.querySelectorAll("[data-segment]");
    expect(segs).toHaveLength(12);
    expect(week.querySelectorAll('[data-segment="on"]')).toHaveLength(3);
    expect(week.textContent).not.toMatch(/%/);
  });

  it("the Key Focus Area: its name, n of the last 10, a bar with the goal mark at 6 of 10", async () => {
    getCoachProgress.mockResolvedValue(PROGRESS);
    renderAt();
    const focus = await screen.findByTestId("progress-focus");
    expect(focus).toHaveTextContent(/key focus area/i);
    expect(focus).toHaveTextContent("Asked & waited");
    expect(focus).toHaveTextContent("4 of 10");
    expect(focus).toHaveTextContent("Goal 6 of 10");
    const bar = within(focus).getByTestId("goal-bar");
    expect(bar.getAttribute("data-fill")).toBe("40");
    expect(bar.getAttribute("data-goal")).toBe("60");
    expect(focus.textContent).not.toMatch(/%/);
  });

  it("Respect held on its own line, not one of the 8; the behaviours are exactly 8, counts with bars, green from 60%", async () => {
    getCoachProgress.mockResolvedValue(PROGRESS);
    renderAt();
    const respect = await screen.findByTestId("progress-respect");
    expect(respect).toHaveTextContent("Respect held");
    expect(respect).toHaveTextContent("a must every time; not one of the 8");
    const list = screen.getByTestId("progress-behaviours");
    expect(list).toHaveTextContent("Your behaviours, last 10 debriefs");
    const rows = within(list).getAllByTestId("progress-behaviour");
    expect(rows).toHaveLength(8);
    expect(rows.map((r) => r.textContent)).toEqual([
      "Specific praise10 of 10", "Moves, not person9 of 10", "Rehearsed aloud6 of 10", "Talked less5 of 10",
      "Asked & waited4 of 10", "One improvement3 of 10", "Teacher's own step2 of 10", "Real moment0 of 10",
    ]);
    expect(rows.map((r) => r.getAttribute("data-tone"))).toEqual(["good", "good", "good", "low", "low", "low", "low", "low"]);
    expect(rows.map((r) => r.querySelector("[data-fill]")?.getAttribute("data-fill"))).toEqual(["100", "90", "60", "50", "40", "30", "20", "0"]);
    expect(list.textContent).not.toMatch(/%|Respect/);
  });

  it("Observations: the 3 most recent, each opening its visit, the debrief's score as a % or where it stands; See all observations", async () => {
    getCoachProgress.mockResolvedValue(PROGRESS);
    renderAt();
    const obs = await screen.findByTestId("progress-observations");
    const links = within(obs).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/portal/coach/observation/cs-3", "/portal/coach/observation/cs-2", "/portal/coach/observation/cs-1", "/portal/coach/reports/all",
    ]);
    expect(links[0]).toHaveTextContent("Lubna Arif");
    expect(links[0]).toHaveTextContent("Thu 19 · 38%");
    expect(links[1]).toHaveTextContent("Wed 18 · 63%");
    expect(links[2]).toHaveTextContent("Mon 16 · Debrief to do");
    expect(links[3]).toHaveTextContent("See all observations");
  });

  it("Weekly reports: each opens its week page, with its count against 12", async () => {
    getCoachProgress.mockResolvedValue(PROGRESS);
    renderAt();
    const weeks = await screen.findByTestId("progress-weeks");
    const links = within(weeks).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/portal/coach/week/2026-11-09", "/portal/coach/week/2026-11-02"]);
    expect(links[0]).toHaveTextContent("9–13 Nov");
    expect(links[0]).toHaveTextContent("4 of 12");
    expect(weeks.textContent).not.toMatch(/%/);
  });

  it("read-only: no buttons that act, no averages, no stars", async () => {
    getCoachProgress.mockResolvedValue(PROGRESS);
    renderAt();
    const body = await screen.findByTestId("progress-body");
    expect(body.querySelectorAll("button")).toHaveLength(0);
    expect(body.textContent).not.toMatch(/avg|average|★/i);
    expect(body.querySelector("[data-star]")).toBeNull();
  });

  it("what is not there is not drawn: no focus, no Respect line, no weekly reports (her week page does not open), no observations", async () => {
    getCoachProgress.mockResolvedValue({ ...PROGRESS, focus: null, respectAll: false, weeks: null, observations: [] });
    renderAt();
    const body = await screen.findByTestId("progress-body");
    expect(screen.queryByTestId("progress-focus")).toBeNull();
    expect(screen.queryByTestId("progress-respect")).toBeNull();
    expect(screen.queryByTestId("progress-weeks")).toBeNull();
    expect(within(screen.getByTestId("progress-observations")).getByText("No observations yet")).toBeInTheDocument();
    expect(within(body).queryByText("See all observations")).toBeNull();
  });

  it("no debriefs yet: the slim row, no bars", async () => {
    getCoachProgress.mockResolvedValue({ ...PROGRESS, focus: null, behaviours: [], window: 0, respectAll: false, weeks: [] });
    renderAt();
    const list = await screen.findByTestId("progress-behaviours");
    expect(list).toHaveTextContent("No debriefs yet");
    expect(within(list).queryAllByTestId("progress-behaviour")).toHaveLength(0);
    expect(screen.getByTestId("progress-weeks")).toHaveTextContent("No weekly reports yet");
  });

  it("a read that fails says so, with Try again; never a 0", async () => {
    getCoachProgress.mockRejectedValue(new Error("boom"));
    renderAt();
    expect(await screen.findByTestId("report-problem-failed")).toHaveTextContent("Could not load");
    expect(screen.queryByTestId("progress-week")).toBeNull();
  });

  it("in Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    getCoachProgress.mockResolvedValue(PROGRESS);
    renderAt();
    const body = await screen.findByTestId("progress-body");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("میری پیش رفت");
    expect(screen.getByTestId("progress-week")).toHaveTextContent("مکمل مشاہدات");
    expect(screen.getByTestId("progress-focus")).toHaveTextContent("سوال کے بعد انتظار");
    expect(screen.getByTestId("progress-focus")).toHaveTextContent("10 میں سے 4");
    expect(screen.getByTestId("progress-focus")).toHaveTextContent("ہدف: 10 میں سے 6");
    expect(screen.getByTestId("progress-respect")).toHaveTextContent("ہر بار لازمی؛ ۸ میں سے ایک نہیں");
    expect(screen.getByTestId("progress-behaviours")).toHaveTextContent("آپ کے رویے، پچھلی 10 ڈی بریف");
    expect(body).toHaveTextContent("تمام مشاہدات دیکھیں");
    expect(screen.getByTestId("progress-weeks")).toHaveTextContent("ہفتہ وار رپورٹس");
    expect(screen.getByTestId("progress-weeks")).toHaveTextContent("12 میں سے 4");
    expect(body.textContent).not.toMatch(/See all|Weekly reports|complete observations|Goal/);
  });
});

describe("switch off: today (no page)", () => {
  it.each([false])("useFlowV6 = %s: back to Home, nothing read", async (value) => {
    flow.on = value;
    renderAt();
    expect(await screen.findByTestId("home")).toBeInTheDocument();
    expect(getCoachProgress).not.toHaveBeenCalled();
  });
});
