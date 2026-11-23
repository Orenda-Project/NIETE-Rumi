import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: { children: unknown }) => <>{children as never}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hina", role: "coach" }, loading: false }) }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
const getCoachWeek = vi.fn();
const markWeek = vi.fn(async (_m: string, _w: string) => undefined);
vi.mock("./api", async (orig) => ({ ...(await orig<typeof import("./api")>()), getCoachWeek: (m: string) => getCoachWeek(m), markWeek: (m: string, w: string) => markWeek(m, w) }));
const flow = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("../flow/useCoachFlowV2", async (orig) => ({ ...(await orig<object>()), useFlowV6: () => flow.on, useFlowV2: () => flow.on }));
vi.mock("../../services/api", async (orig) => {
  const real = await orig<typeof import("../../services/api")>();
  return { ...real, language: { get: async () => ({ language: "en", locked: false }), set: async () => ({}) } };
});

import CoachWeekPage from "./CoachWeekPage";
import type { CoachWeek } from "./api";

/**
 * bd-o15qnr.28.1 (queue #204, v7; #188's c8-week-page and c8-week-focus-options option A) — her week in the app's v6/v7
 * look, behind the v6/v7 switch (useFlowV6):
 *
 *   1 the reports' dark top card: WEEKLY REPORT, n/12 complete observations, twelve segments, the days it covers
 *   2 the Key Focus Area FIRST (option B card: tint, purple start edge, target icon): its name, debriefs that included it
 *     of the last 10, a bar with the goal mark at 6 of 10, "Goal 6 of 10"; then its ONE Coach Training module
 *   3 this week, day by day (debriefs each day) → steady strengths → keep in mind (count + bar) → Respect held on its
 *     own line, not one of the 8 → the full week (all 8), folded → just for you
 *
 * No sentences (no "It is complete at…", no "Your focus stays…", no four steps); counts, never a %. Off: today's page.
 */
const both = (en: string, ur: string) => ({ en, ur });
const WEEK: CoachWeek = {
  monday: "2026-11-16", friday: "2026-11-20", target: 12, complete: 5, debriefs: 5, small: false, respectAll: true,
  training: 3,
  focus: {
    key: "asked_and_waited", name: both("Asked & waited", "سوال کے بعد انتظار"), why: both("Waiting gives time.", "وقت"),
    week: { done: 2, of: 5 }, last: { done: 1, of: 4 },
    days: [
      { date: "2026-11-16", items: [true] }, { date: "2026-11-17", items: [false, true] }, { date: "2026-11-18", items: [] },
      { date: "2026-11-19", items: [false, false] }, { date: "2026-11-20", items: [] },
    ],
    last10: { done: 4, of: 10 }, doneAt: 6, reached: false,
    next: "one_improvement_only", nextName: both("One improvement", "صرف ایک بہتری"),
    steps: { en: ["After your praise, ask one open question.", "b", "c", "d"], ur: ["ا", "ب", "پ", "ت"], reviewed: false },
  },
  strengths: [{ key: "opened_with_specific_praise", name: both("Specific praise", "مخصوص تعریف"), done: 5, of: 5 }],
  keepInMind: [
    { key: "elicited_if_then", name: both("Teacher's own step", "استاد کا اپنا اگلا قدم"), why: both("They own it.", "اپنا"), done: 1, of: 5 },
    { key: "righting_reflex_held", name: both("Talked less", "استاد کو بولنے کا موقع"), why: both("They think more.", "سوچ"), done: 2, of: 5 },
  ],
  table: ["opened_with_specific_praise", "anchored_in_real_moment", "asked_and_waited", "one_improvement_only", "moves_not_teacher", "elicited_if_then", "righting_reflex_held", "rehearsed_the_step"]
    .map((key) => ({ key, name: both(key, key), week: { done: 1, of: 5 }, last: { done: 0, of: 4 } })),
};

const renderAt = (path = "/portal/coach/week/2026-11-16") => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes><Route path="/portal/coach/week/:monday" element={<CoachWeekPage />} /></Routes>
  </MemoryRouter>,
);

beforeAll(async () => { if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} }); });
beforeEach(async () => {
  flow.on = true;
  getCoachWeek.mockReset(); markWeek.mockClear();
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("her week, v7", () => {
  it("the Key Focus Area first, then its one training; the board's order after it; stamps opened once", async () => {
    getCoachWeek.mockResolvedValue(WEEK);
    renderAt();
    const body = await screen.findByTestId("week-body-v7");
    const order = ["week-hero", "week-focus", "week-days", "week-steady", "week-keep", "week-respect", "week-table"];
    const ids = Array.from(body.querySelectorAll("[data-testid]")).map((e) => String(e.getAttribute("data-testid")));
    expect(ids.filter((x) => order.includes(x))).toEqual(order);
    expect(markWeek).toHaveBeenCalledWith("2026-11-16", "opened");
    expect(markWeek).toHaveBeenCalledTimes(1);
  });

  it("the top card: WEEKLY REPORT, 5/12 complete observations, twelve segments with 5 filled, the days it covers", async () => {
    getCoachWeek.mockResolvedValue(WEEK);
    renderAt();
    const hero = await screen.findByTestId("week-hero");
    expect(hero).toHaveTextContent(/weekly report/i);
    expect(hero).toHaveTextContent("5/12");
    expect(hero).toHaveTextContent("complete observations");
    expect(hero.querySelectorAll("[data-segment]")).toHaveLength(12);
    expect(hero.querySelectorAll('[data-segment="on"]')).toHaveLength(5);
    expect(hero).toHaveTextContent("16–20 Nov");
  });

  it("the Key Focus Area: one count and a goal mark (option A), no sentences; its ONE module inside it", async () => {
    getCoachWeek.mockResolvedValue(WEEK);
    renderAt();
    const focus = await screen.findByTestId("week-focus");
    expect(focus).toHaveTextContent(/key focus area/i);
    expect(focus).toHaveTextContent("Asked & waited");
    expect(focus).toHaveTextContent("4 of 10");
    expect(focus).toHaveTextContent("Goal 6 of 10");
    const bar = within(focus).getByTestId("goal-bar");
    expect(bar.getAttribute("data-fill")).toBe("40");
    expect(bar.getAttribute("data-goal")).toBe("60");
    const module = within(focus).getByTestId("week-open-module");
    expect(module).toHaveTextContent("Open Module 3: Ask, then wait");
    expect(module).toHaveAttribute("href", "/portal/coach/coach-training/3");
    const body = screen.getByTestId("week-body-v7");
    expect(body.querySelectorAll('a[href^="/portal/coach/coach-training"]')).toHaveLength(1);
  });

  it("no sentences and no percentages anywhere on the page", async () => {
    getCoachWeek.mockResolvedValue(WEEK);
    renderAt();
    const body = await screen.findByTestId("week-body-v7");
    expect(body.textContent).not.toMatch(/%/);
    expect(body.textContent).not.toMatch(/It is complete at|Your focus stays|How to do it next week|your next focus will be|Why it matters|An observation is complete once/);
    expect(screen.queryByTestId("week-steps")).toBeNull();
    expect(body.querySelector("ol")).toBeNull();
  });

  it("day by day: the debriefs each day, as information (nothing to tap)", async () => {
    getCoachWeek.mockResolvedValue(WEEK);
    renderAt();
    const days = await screen.findByTestId("week-days");
    expect(within(days).getAllByTestId("week-day-count").map((d) => d.textContent)).toEqual(["1", "2", "0", "2", "0"]);
    expect(days.querySelectorAll("button, a")).toHaveLength(0);
  });

  it("steady strengths and keep in mind as counts (keep in mind with bars); Respect held on its own line above the 8", async () => {
    getCoachWeek.mockResolvedValue(WEEK);
    renderAt();
    expect(await screen.findByTestId("week-steady")).toHaveTextContent("Specific praise");
    expect(screen.getByTestId("week-steady")).toHaveTextContent("5 of 5");
    const keep = screen.getByTestId("week-keep");
    expect(within(keep).getAllByTestId("week-keep-row").map((r) => r.textContent)).toEqual(["!Teacher's own step1 of 5", "!Talked less2 of 5"]);
    const respect = screen.getByTestId("week-respect");
    expect(respect).toHaveTextContent("Respect held");
    expect(respect).toHaveTextContent("a must every time; not one of the 8");
    const table = screen.getByTestId("week-table");
    expect(table.querySelector("table")).toBeNull();
    fireEvent.click(within(table).getByRole("button"));
    expect(table.querySelectorAll("tbody tr")).toHaveLength(8);
  });

  it("no focus: the one training (the top miss's module) sits under keep in mind", async () => {
    getCoachWeek.mockResolvedValue({ ...WEEK, focus: null, training: 7 });
    renderAt();
    const keep = await screen.findByTestId("week-keep");
    expect(within(keep).getByTestId("week-open-module")).toHaveTextContent("Open Module 7: Talk less");
    expect(screen.queryByTestId("week-focus")).toBeNull();
    expect(screen.queryByTestId("week-days")).toBeNull();
  });

  it("a week with no debriefs says so in one slim row", async () => {
    getCoachWeek.mockResolvedValue({ ...WEEK, complete: 0, debriefs: 0, small: true, focus: null, strengths: [], keepInMind: [], respectAll: false, training: null });
    renderAt();
    expect(await screen.findByTestId("week-empty")).toHaveTextContent("No debriefs this week");
    expect(screen.queryByTestId("week-respect")).toBeNull();
  });

  it("in Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    getCoachWeek.mockResolvedValue(WEEK);
    renderAt();
    const body = await screen.findByTestId("week-body-v7");
    expect(screen.getByTestId("week-hero")).toHaveTextContent("مکمل مشاہدات");
    expect(screen.getByTestId("week-focus")).toHaveTextContent("سوال کے بعد انتظار");
    expect(screen.getByTestId("week-focus")).toHaveTextContent("10 میں سے 4");
    expect(screen.getByTestId("week-focus")).toHaveTextContent("ہدف: 10 میں سے 6");
    expect(screen.getByTestId("week-days")).toHaveTextContent("یہ ہفتہ، دن بہ دن");
    expect(screen.getByTestId("week-respect")).toHaveTextContent("ہر بار لازمی؛ ۸ میں سے ایک نہیں");
    expect(body.textContent).not.toMatch(/Goal|complete observations|day by day/);
  });
});

describe("switch off: today's week page exactly", () => {
  it("useFlowV6 false: the old focus count and sentences, no v7 body", async () => {
    flow.on = false;
    getCoachWeek.mockResolvedValue(WEEK);
    renderAt();
    await screen.findByTestId("week-body");
    expect(screen.queryByTestId("week-body-v7")).toBeNull();
    expect(screen.getByTestId("week-focus-count").textContent).toBe("2 of 5 debriefs");
    expect(screen.getByTestId("week-next")).toHaveTextContent("It is complete at 6 of 10.");
  });
});
