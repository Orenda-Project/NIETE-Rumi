import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { screen, waitFor, within, fireEvent } from "@testing-library/react";
import { loadApp, net, renderApp, resetAll } from "./harness.testdata";
import { EMIS, schoolCard } from "./fixtures.testdata";
import { karachiDay } from "../time";
import { currentCoachCardItem, currentCoachMenuItem } from "../../teacher/menu";

vi.mock("axios", async () => (await import("./harness.testdata")).axiosMock());
vi.mock("../flow/track", () => ({ trackFlow: vi.fn() }));
vi.setConfig({ testTimeout: 20_000 });

/**
 * bd-o15qnr.26 (queue #177, Option A) — the visit flow v2 switch (`features.coachFlowV2`, app_settings portal_coach_flow_v2,
 * served only with the full coach app on) as the 12 real coaches would meet it: the School card app with the full coach
 * app. The real guard, flag hooks, Home and menu run; only the network is mocked.
 *
 *   menu   Home · Schedule · Observations · Lesson Plans · More; Schedule opens the one list, Observations her observations
 *   Home   a Today card (her visits today, the next one with Start recording), then the tiles, which open the same pages
 *   off    exactly today's menu and Home
 */
function config(flowV2: unknown) {
  net.answers.set("/config", { success: true, features: { coachV2: true, schoolCard: true, coachip: false, coachFullApp: true, coachFlowV2: flowV2 } });
  net.answers.set("/coach/people", { success: true, schools: [{ emis: EMIS, name: "Model School Nine", teachers: 12, visits: 1, daysSinceVisit: 1, avgHitl: 60 }], teachers: [] });
  net.answers.set(`/coach/school/${EMIS}/card`, schoolCard());
}

const today = karachiDay();
const visit = (id: string, slot: string, status: string, name: string) => ({
  id, teacherName: name, schoolName: "IMCB G-10/4", scheduledFor: today, scheduledSlot: slot, status,
});
function home(todays: ReturnType<typeof visit>[], next: ReturnType<typeof visit> | null = null) {
  net.answers.set("/coach/home", { success: true, home: { today: todays, next, counts: { week: 5, overdue: 2, waiting: 2, inProgress: 0, teachers: 20, schools: 6 } } });
}

beforeAll(async () => { await loadApp(); }, 120_000);
beforeEach(async () => {
  await resetAll();
  (await import("../flow/useCoachFlowV2")).resetCoachFlowV2Memory();
});

describe("the menu, switch on (Concept 1: one Observe entry)", () => {
  it("Home · Observe · Lesson Plans · More; Observe opens the one Observe screen", async () => {
    config(true);
    await renderApp(`/portal/coach/school/${EMIS}`);
    await screen.findByTestId("overview");
    const nav = screen.getByTestId("teacher-nav");
    await waitFor(() => expect(Array.from(nav.querySelectorAll("a")).map((a) => a.textContent)).toEqual(["Home", "Observe", "Lesson Plans", "More"]));
    expect(Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href")))
      .toEqual(["/portal/coach", "/portal/coach/observe", "/portal/teacher/lessons", "/portal/coach/more"]);
  });

  it("in Urdu the item stays مشاہدہ (the operator: 'No need to make it Observations')", async () => {
    config(true);
    await renderApp(`/portal/coach/school/${EMIS}`, "ur");
    const nav = await screen.findByTestId("teacher-nav");
    await waitFor(() => expect(Array.from(nav.querySelectorAll("a")).map((a) => a.textContent)).toContain("مشاہدہ"));
    expect(nav.textContent).not.toContain("مشاہدات");
  });

  it("which item is current: every visit, booking and observation page is Observe's", () => {
    for (const p of ["/portal/coach/observe", "/portal/coach/schedule", "/portal/coach/visit/7", "/portal/coach/visit/7/record", "/portal/coach/new-visit",
      "/portal/coach/team", "/portal/coach/reports", "/portal/coach/reports/all", "/portal/coach/observation/9", "/portal/coach/observation/9/form"]) {
      expect(currentCoachCardItem(p, "", true)).toBe("observe");
      expect(currentCoachMenuItem(p, "", true)).toBe("observe");
    }
    // off: today's rule (a visit page is Schedule's, its record step Observe's)
    expect(currentCoachMenuItem("/portal/coach/visit/7", "")).toBe("schedule");
    expect(currentCoachMenuItem("/portal/coach/visit/7/record", "")).toBe("observe");
  });
});

/*
 * bd-o15qnr.27 (queue #204, v6) — the Home's Focus card: ONE slot under the greeting showing the one most important thing
 * (the operator on #188's round 5: "if the coach has a pending debreif or something, that should be shown here instead.
 * That is more important. If no pending stuff, then we can show this. If none are booked, then we can show the Schedule
 * an Observation"). Order: (1) the oldest observation waiting on her, (2) today's booked visits, (3) nothing booked.
 * A waiting review comes first even when a visit is due within the hour (#188's current pick, his stated order).
 * No "Start an observation" on Home ("That is too much").
 */
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
const waitingReport = (id: string, name: string, step: string, ago: number) => ({
  id, createdAt: daysAgo(ago), teacherName: name, teacherPhone: null, teacherExtId: null, schoolName: "IMSG (I-V) G-7/3", schoolExtId: null,
  status: "x", step, score: null, portal: true,
});
function reports(waiting: ReturnType<typeof waitingReport>[]) {
  net.answers.set("/coach/reports", { success: true, waiting, inProgress: [], all: { total: 12, page: 1, pageSize: 20, items: [] } });
}
function schedule(visits: ReturnType<typeof visit>[], overdue: ReturnType<typeof visit>[] = []) {
  net.answers.set("/coach/schedule", { success: true, from: today, to: today, visits, overdue });
}

describe("the Home, switch on: the Focus card, then one Observe tile", () => {
  it("(1) something waits on her: the oldest, its step and the four segments, its button, and how many more", async () => {
    config(true);
    home([]);
    reports([waitingReport("r1", "Saima Riaz", "draft", 1), waitingReport("r2", "Lubna Arif", "talk", 17), waitingReport("r3", "Huma Ijaz", "report", 3)]);
    schedule([visit("t2", "10:00", "upcoming", "Kiran Shahzadi")]);
    await renderApp("/portal/coach");
    const card = await screen.findByTestId("focus-waiting");
    expect(card).toHaveTextContent("Waiting for you");
    expect(within(card).getByTestId("section-count")).toHaveTextContent("3");
    expect(card).toHaveTextContent("Lubna Arif");
    expect(card).toHaveTextContent("17 days waiting");
    expect(within(card).getByTestId("report-segments")).toBeInTheDocument();
    const go = within(card).getByRole("link", { name: /Continue the Debrief/ });
    expect(go).toHaveAttribute("href", "/portal/coach/observation/r2");
    fireEvent.click(go);
    const { trackFlow } = await import("../flow/track");
    expect(trackFlow).toHaveBeenCalledWith("home.focus");
    expect(within(card).getByRole("link", { name: /2 more waiting/ })).toHaveAttribute("href", "/portal/coach/reports?show=waiting");
    // one thing only: no booked rows while a review waits, and never Start an observation on Home
    expect(screen.queryByTestId("focus-booked")).toBeNull();
    expect(screen.queryByText(/Start an observation/)).toBeNull();
  });

  it("(2) nothing waiting, visits booked today: those still to do, each row one link to its visit, then All booked with the late count", async () => {
    config(true);
    home([]);
    reports([]);
    schedule([visit("t1", "08:30", "done", "Farah Naz"), visit("t2", "10:00", "upcoming", "Kiran Shahzadi"), visit("t3", "12:00", "upcoming", "Asma Batool")],
      [{ ...visit("o1", "10:00", "upcoming", "Rabia Nawaz"), scheduledFor: "2000-01-01" }]);
    await renderApp("/portal/coach");
    const card = await screen.findByTestId("focus-booked");
    expect(card).toHaveTextContent("Booked for today");
    expect(within(card).getByTestId("section-count")).toHaveTextContent("2");
    expect(within(card).queryByText("Farah Naz")).toBeNull();
    expect(within(card).queryByRole("link", { name: /^Record/ })).toBeNull();
    expect(within(card).getAllByTestId(/^booked-row-/).map((r) => within(r).getByRole("link").getAttribute("href")))
      .toEqual(["/portal/coach/visit/t2", "/portal/coach/visit/t3"]);
    const all = within(card).getByRole("link", { name: /All booked/ });
    expect(all).toHaveAttribute("href", "/portal/coach/observe?booked=open");
    expect(all).toHaveTextContent("1 late");
  });

  it("(3) nothing waiting, nothing booked today: one line and Schedule an observation", async () => {
    config(true);
    home([]);
    reports([]);
    schedule([visit("t1", "08:30", "done", "Farah Naz")]);
    await renderApp("/portal/coach");
    const card = await screen.findByTestId("focus-empty");
    expect(card).toHaveTextContent("No visits booked today");
    expect(within(card).getByRole("link", { name: /Schedule an observation/ })).toHaveAttribute("href", "/portal/coach/new-visit");
  });

  it("in Urdu: آپ کے منتظر and ڈی بریف جاری رکھیں", async () => {
    config(true);
    home([]);
    reports([waitingReport("r2", "Lubna Arif", "talk", 17)]);
    schedule([]);
    await renderApp("/portal/coach", "ur");
    const card = await screen.findByTestId("focus-waiting");
    expect(card).toHaveTextContent("آپ کے منتظر");
    expect(within(card).getByRole("link", { name: /ڈی بریف جاری رکھیں/ })).toBeInTheDocument();
  });

  // bd-o15qnr.28.1 (v7): My progress sits right after Observe on the same switch (flow/v7week.test.tsx pins it).
  it("one Observe tile in place of Schedule and Observe: it opens the Observe screen, with what waits on her", async () => {
    config(true);
    home([]);
    reports([]);
    schedule([]);
    await renderApp("/portal/coach");
    const tiles = await screen.findByTestId("feature-tiles");
    await waitFor(() => expect(Array.from(tiles.querySelectorAll("a")).map((a) => a.getAttribute("href")))
      .toEqual(["/portal/coach/observe", "/portal/coach/progress", "/portal/coach/people", "/portal/coach/coach-training", "/portal/coach/training"]));
    expect(tiles.querySelectorAll("a")[0].textContent).toContain("Observe");
    await waitFor(() => expect(tiles.querySelectorAll("a")[0].textContent).toContain("2 waiting"));
  });
});

describe("switch off (or absent): today's menu and Home exactly", () => {
  it.each([false, undefined, "true"])("coachFlowV2 = %s", async (value) => {
    config(value);
    home([visit("t2", "10:00", "upcoming", "Kiran Shahzadi")]);
    await renderApp("/portal/coach");
    const tiles = await screen.findByTestId("feature-tiles");
    await waitFor(() => expect(Array.from(tiles.querySelectorAll("a")).map((a) => a.getAttribute("href")).slice(0, 2))
      .toEqual(["/portal/coach/scheduling", "/portal/coach/observe"]));
    expect(screen.queryByTestId("home-today")).toBeNull();
    expect(screen.queryByTestId("focus-card")).toBeNull();
    const nav = screen.getByTestId("teacher-nav");
    await waitFor(() => expect(Array.from(nav.querySelectorAll("a")).map((a) => a.textContent)).toEqual(["Home", "Schedule", "Observe", "Lesson Plans", "More"]));
  });
});
