import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: { children: unknown }) => <>{children as never}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Test", role: "coach" }, loading: false }) }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
const getCoachWeek = vi.fn();
const markWeek = vi.fn(async () => undefined);
const markSeen = vi.fn(async () => undefined);
const getReadyReports = vi.fn();
vi.mock("./api", async (orig) => ({ ...(await orig<typeof import("./api")>()), getCoachWeek: (m: string) => getCoachWeek(m), markWeek: (m: string, w: string) => markWeek(m, w), markSeen: (id: string) => markSeen(id), getReadyReports: () => getReadyReports() }));
const getConfig = vi.fn();
vi.mock("../../services/api", async (orig) => {
  const real = await orig<typeof import("../../services/api")>();
  return { ...real, portal: { ...real.portal, getConfig: () => getConfig() }, language: { get: async () => ({ language: "en", locked: false }), set: async () => ({}) } };
});

import CoachWeekPage from "./CoachWeekPage";
import { ReadyReportCard } from "./ReadyReportCard";
import { coachPathReady } from "../training/appReady";
import type { CoachWeek } from "./api";

/**
 * Coach reports in the app, phase 3 — her week as a page and as a row on her Home card. Pinned: the order (complete vs 12
 * → the one focus, day by day, against last week → steady → keep in mind → next week → Respect → the folded table →
 * "just for you"); counts, never percentages; the day strip; a small week shows counts only; draft steps are marked;
 * opening stamps "opened"; the Home card's week row opens it and its ✕ says "seen".
 */
const both = (en: string, ur: string) => ({ en, ur });
const WEEK: CoachWeek = {
  monday: "2026-11-02", friday: "2026-11-06", target: 12, complete: 10, debriefs: 10, small: false, respectAll: true,
  focus: {
    key: "asked_and_waited", module: 3, name: both("Asked & waited", "سوال کے بعد انتظار"), why: both("Waiting gives time.", "وقت"),
    week: { done: 4, of: 10 }, last: { done: 1, of: 9 },
    days: [
      { date: "2026-11-02", items: [false, false] }, { date: "2026-11-03", items: [true, false] }, { date: "2026-11-04", items: [false, true] },
      { date: "2026-11-05", items: [true, true] }, { date: "2026-11-06", items: [false, false] },
    ],
    last10: { done: 4, of: 10 }, doneAt: 6, reached: false,
    next: "one_improvement_only", nextName: both("One improvement", "صرف ایک بہتری"), nextModule: 4,
    steps: { en: ["After your praise, ask one open question.", "Try: “What was going through your mind?”", "Count to five.", "Keep waiting."], ur: ["ا", "ب", "پ", "ت"], reviewed: false },
  },
  strengths: [{ key: "opened_with_specific_praise", name: both("Specific praise", "مخصوص تعریف"), done: 10, of: 10 }],
  keepInMind: [{ key: "righting_reflex_held", name: both("Talked less", "استاد کو بولنے کا موقع"), why: both("They think more.", "سوچ"), module: 7, done: 2, of: 10 }],
  table: ["opened_with_specific_praise", "anchored_in_real_moment", "asked_and_waited", "one_improvement_only", "moves_not_teacher", "elicited_if_then", "righting_reflex_held", "rehearsed_the_step"]
    .map((key) => ({ key, name: both(key, key), week: { done: 1, of: 10 }, last: { done: 0, of: 9 } })),
};

const renderAt = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/portal/coach/week/:monday" element={<CoachWeekPage />} />
      <Route path="/portal/coach" element={<ReadyReportCard />} />
    </Routes>
  </MemoryRouter>,
);

beforeAll(async () => { if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} }); });
beforeEach(async () => {
  await act(async () => { await i18n.changeLanguage("en"); });
  getCoachWeek.mockReset(); markWeek.mockClear(); markSeen.mockClear(); getReadyReports.mockReset(); getConfig.mockReset();
});

describe("her week", () => {
  it("in her order, counts not percentages, and stamps opened once", async () => {
    getCoachWeek.mockResolvedValue(WEEK);
    renderAt("/portal/coach/week/2026-11-02");
    const body = await screen.findByTestId("week-body");
    const ids = Array.from(body.querySelectorAll("[data-testid]")).map((e) => e.getAttribute("data-testid"));
    const order = ["week-hero", "week-focus", "week-steady", "week-keep", "week-next", "week-table"];
    expect(ids.filter((x) => order.includes(String(x)))).toEqual(order);
    expect(screen.getByTestId("week-score").textContent).toContain("10/12");
    expect(screen.getByTestId("week-focus-count").textContent).toBe("4 of 10 debriefs");
    expect(screen.getByTestId("week-compare").textContent).toContain("↑ Up by 3");
    expect(screen.getByTestId("week-compare").textContent).toContain("Last week: 1 of 9");
    expect(body.textContent).not.toMatch(/%/);
    // The stamp is an effect after the page draws: wait for it (asserting at once was flaky, 1 in 3 on a loaded machine).
    await waitFor(() => expect(markWeek).toHaveBeenCalledWith("2026-11-02", "opened"));
    expect(markWeek).toHaveBeenCalledTimes(1);
  });

  it("the day strip: a tap shows that day's debriefs", async () => {
    getCoachWeek.mockResolvedValue(WEEK);
    renderAt("/portal/coach/week/2026-11-02");
    await screen.findByTestId("week-body");
    const days = within(screen.getByTestId("week-focus")).getAllByRole("radio");
    expect(days).toHaveLength(5);
    fireEvent.click(days[3]);
    expect(days[3].getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("week-day").textContent).toContain("Debrief 1 ✓ · Debrief 2 ✓");
  });

  it("next week: where she is, the four steps (marked as drafts), what comes next, the module", async () => {
    getCoachWeek.mockResolvedValue(WEEK);
    renderAt("/portal/coach/week/2026-11-02");
    const next = await screen.findByTestId("week-next");
    expect(next.textContent).toContain("Your focus stays the same: Asked & waited");
    expect(next.textContent).toContain("4 of your last 10 debriefs included it. It is complete at 6 of 10.");
    expect(within(next).getByTestId("week-steps").querySelectorAll("li")).toHaveLength(4);
    expect(within(next).getByTestId("week-steps-draft")).toBeTruthy();
    expect(next.textContent).toContain("your next focus will be One improvement.");
    expect(within(next).getByTestId("week-open-module").textContent).toBe("Open Module 3: Ask, then wait");
    // bd-rlxkkt.12 — the link to the list counts the modules it lists (it said "All 9" when there were ten)
    const all = within(next).getByTestId("week-all-modules");
    expect(all.textContent).toBe("All 10 Coach Training modules");
    expect(all).toHaveAttribute("href", "/portal/coach/coach-training");
  });

  it("the full table stays folded until she opens it", async () => {
    getCoachWeek.mockResolvedValue(WEEK);
    renderAt("/portal/coach/week/2026-11-02");
    const table = await screen.findByTestId("week-table");
    expect(table.querySelector("table")).toBeNull();
    fireEvent.click(within(table).getByRole("button"));
    expect(table.querySelectorAll("tbody tr")).toHaveLength(8);
  });

  it("a small week: counts only, said so; no strengths, no misses", async () => {
    getCoachWeek.mockResolvedValue({ ...WEEK, complete: 3, debriefs: 3, small: true, strengths: [], keepInMind: [] });
    renderAt("/portal/coach/week/2026-11-02");
    expect(await screen.findByTestId("week-small")).toBeTruthy();
    expect(screen.queryByTestId("week-steady")).toBeNull();
    expect(screen.queryByTestId("week-keep")).toBeNull();
  });

  it("Urdu: the same payload, Urdu words and steps", async () => {
    getCoachWeek.mockResolvedValue(WEEK);
    renderAt("/portal/coach/week/2026-11-02");
    await screen.findByTestId("week-body");
    await act(async () => { await i18n.changeLanguage("ur"); });
    expect(getCoachWeek).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("آپ کا ہفتہ");
    expect(screen.getByTestId("week-focus").textContent).toContain("سوال کے بعد انتظار");
    expect(within(screen.getByTestId("week-steps")).getAllByRole("listitem").map((li) => li.textContent?.slice(1))).toEqual(["ا", "ب", "پ", "ت"]);
  });

  it("is reachable for every coach through the guard (the server's switch decides)", () => {
    expect(coachPathReady("/portal/coach/week/2026-11-02")).toBe(true);
  });
});

describe("the week on her Home card", () => {
  it("from Friday 16:00: a week row first; Open goes to her week; ✕ says seen for each row", async () => {
    getConfig.mockResolvedValue({ success: true, features: { coachReportsApp: true } });
    getReadyReports.mockResolvedValue([
      { kind: "week", id: "2026-11-02", monday: "2026-11-02", friday: "2026-11-06", at: "2026-11-06T11:00:00.000Z", debriefs: 10 },
      { kind: "debrief", id: "33333333-3333-4333-8333-333333333333", at: null, teacher: "Ms. Sadia", subject: null, grade: null },
    ]);
    getCoachWeek.mockResolvedValue(WEEK);
    const { unmount } = renderAt("/portal/coach");
    const card = await screen.findByTestId("coach-report-card");
    const rows = within(card).getAllByTestId("coach-report-card-row");
    expect(rows[0].textContent).toContain("Your week: 2–6 Nov");
    expect(rows[0].textContent).toContain("10 debriefs");
    fireEvent.click(within(rows[0]).getByRole("button", { name: "Open my week" }));
    expect(await screen.findByTestId("week-body")).toBeTruthy();
    unmount();
    renderAt("/portal/coach");
    fireEvent.click(await screen.findByTestId("coach-report-card-close"));
    expect(markWeek).toHaveBeenCalledWith("2026-11-02", "seen");
    expect(markSeen).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333");
  });
});

describe("bd-enec2e.5 — found in the 7 Nov sandbox e2e", () => {
  it("no debriefs last week is not her first week: 'No debriefs last week' unless nothing came before", async () => {
    getCoachWeek.mockResolvedValue({ ...WEEK, firstWeek: false, focus: { ...WEEK.focus!, last: null } });
    const { unmount } = renderAt("/portal/coach/week/2026-11-02");
    expect((await screen.findByTestId("week-compare")).textContent).toBe("No debriefs last week");
    unmount();
    getCoachWeek.mockResolvedValue({ ...WEEK, firstWeek: true, focus: { ...WEEK.focus!, last: null } });
    renderAt("/portal/coach/week/2026-11-02");
    expect((await screen.findByTestId("week-compare")).textContent).toBe("Your first week");
  });

  it("a week across two months names both months, on the page and on the Home card", async () => {
    const sep = { ...WEEK, monday: "2026-09-28", friday: "2026-10-02" };
    getCoachWeek.mockResolvedValue(sep);
    const { unmount } = renderAt("/portal/coach/week/2026-09-28");
    // en-GB writes "Sept" in current ICU (Chrome, Node 22+), "Sep" in older ones: either names both months.
    expect((await screen.findByTestId("week-hero")).textContent).toMatch(/28 Sept? – 2 Oct/);
    expect(screen.getByTestId("week-hero").textContent).not.toContain("28–2 Oct");
    unmount();
    getConfig.mockResolvedValue({ success: true, features: { coachReportsApp: true } });
    getReadyReports.mockResolvedValue([{ kind: "week", id: "2026-09-28", monday: "2026-09-28", friday: "2026-10-02", at: "2026-10-02T11:00:00.000Z", debriefs: 4 }]);
    renderAt("/portal/coach");
    const row = (await screen.findAllByTestId("coach-report-card-row"))[0];
    expect(row.textContent).toMatch(/Your week: 28 Sept? – 2 Oct/);
  });

  it("a week in one month stays short", async () => {
    getCoachWeek.mockResolvedValue(WEEK);
    renderAt("/portal/coach/week/2026-11-02");
    expect((await screen.findByTestId("week-hero")).textContent).toContain("2–6 Nov");
  });
  it("a debrief row says the day when the report was not ready today (it waits up to 3 days)", async () => {
    getConfig.mockResolvedValue({ success: true, features: { coachReportsApp: true } });
    const now = new Date().toISOString();
    getReadyReports.mockResolvedValue([
      { kind: "debrief", id: "33333333-3333-4333-8333-333333333333", at: "2026-11-05T06:00:00.000Z", teacher: "Ms. Sadia", subject: null, grade: null },
      { kind: "debrief", id: "44444444-4444-4444-8444-444444444444", at: now, teacher: "Ms. Amna", subject: null, grade: null },
    ]);
    renderAt("/portal/coach");
    const rows = await screen.findAllByTestId("coach-report-card-row");
    const old = rows.find((r) => r.textContent?.includes("Ms. Sadia"))!;
    const today = rows.find((r) => r.textContent?.includes("Ms. Amna"))!;
    expect(old.textContent).toMatch(/Ms\. Sadia · 5 Nov, 11:00\s?am/i);
    expect(today.textContent).not.toMatch(/Nov|Dec|Jan/);
  });
});

