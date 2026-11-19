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

describe("the Home, switch on: only the next visit, then one Observe tile", () => {
  it("Next visit: today's next one alone, with Start recording straight to its record step (no other visits listed)", async () => {
    config(true);
    home([visit("t1", "08:30", "done", "Farah Naz"), visit("t2", "10:00", "upcoming", "Kiran Shahzadi"), visit("t3", "12:00", "upcoming", "Asma Batool")],
      visit("t2", "10:00", "upcoming", "Kiran Shahzadi"));
    await renderApp("/portal/coach");
    const card = await screen.findByTestId("home-next");
    expect(card).toHaveTextContent("Next visit");
    const current = within(card).getByTestId("visit-current");
    expect(current).toHaveTextContent("Kiran Shahzadi");
    const start = within(current).getByRole("link", { name: /Start recording/ });
    expect(start).toHaveAttribute("href", "/portal/coach/visit/t2/record");
    fireEvent.click(start);
    const { trackFlow } = await import("../flow/track");
    expect(trackFlow).toHaveBeenCalledWith("home.today_start");
    expect(screen.queryByText("Asma Batool")).toBeNull();
    expect(screen.queryByText("Farah Naz")).toBeNull();
  });

  it("the next visit is another day: no card (Start recording is for today)", async () => {
    config(true);
    home([], { ...visit("t4", "09:00", "upcoming", "Nadia Perveen"), scheduledFor: "2099-01-01" });
    await renderApp("/portal/coach");
    await screen.findByTestId("feature-tiles");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("home-next")).toBeNull();
  });

  it("one Observe tile in place of Schedule and Observe: it opens the Observe screen, with what waits on her", async () => {
    config(true);
    home([]);
    await renderApp("/portal/coach");
    const tiles = await screen.findByTestId("feature-tiles");
    // Staging adapt: staging's tiles keep their pre-#175 order; what matters is Observe first and no Schedule tile.
    await waitFor(() => expect(Array.from(tiles.querySelectorAll("a")).map((a) => a.getAttribute("href"))[0]).toBe("/portal/coach/observe"));
    const hrefs = Array.from(tiles.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/portal/coach/scheduling");
    expect(hrefs).not.toContain("/portal/coach/schedule");
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
    const nav = screen.getByTestId("teacher-nav");
    await waitFor(() => expect(Array.from(nav.querySelectorAll("a")).map((a) => a.textContent)).toEqual(["Home", "Schedule", "Observe", "Lesson Plans", "More"]));
  });
});
