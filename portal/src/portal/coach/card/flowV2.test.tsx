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
function home(todays: ReturnType<typeof visit>[]) {
  net.answers.set("/coach/home", { success: true, home: { today: todays, next: null, counts: { week: 5, overdue: 2, waiting: 1, inProgress: 0, teachers: 20, schools: 6 } } });
}

beforeAll(async () => { await loadApp(); }, 120_000);
beforeEach(async () => {
  await resetAll();
  (await import("../flow/useCoachFlowV2")).resetCoachFlowV2Memory();
});

describe("the menu, switch on", () => {
  it("Home · Schedule · Observations · Lesson Plans · More: Schedule is the list, Observations her observations", async () => {
    config(true);
    await renderApp(`/portal/coach/school/${EMIS}`);
    await screen.findByTestId("overview");
    const nav = screen.getByTestId("teacher-nav");
    await waitFor(() => expect(Array.from(nav.querySelectorAll("a")).map((a) => a.textContent)).toEqual(["Home", "Schedule", "Observations", "Lesson Plans", "More"]));
    expect(Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href")))
      .toEqual(["/portal/coach", "/portal/coach/schedule", "/portal/coach/reports", "/portal/teacher/lessons", "/portal/coach/more"]);
  });

  it("in Urdu the item is مشاہدات (the ontology's Observations)", async () => {
    config(true);
    await renderApp(`/portal/coach/school/${EMIS}`, "ur");
    const nav = await screen.findByTestId("teacher-nav");
    await waitFor(() => expect(nav.textContent).toContain("مشاہدات"));
  });

  it("which item is current: a visit and its steps are Schedule's; reports and an observation are Observations'", () => {
    for (const p of ["/portal/coach/schedule", "/portal/coach/visit/7", "/portal/coach/visit/7/record", "/portal/coach/new-visit", "/portal/coach/team"]) {
      expect(currentCoachCardItem(p, "", true)).toBe("schedule");
      expect(currentCoachMenuItem(p, "", true)).toBe("schedule");
    }
    expect(currentCoachCardItem("/portal/coach/visit/7", "?from=observe", true)).toBe("schedule");
    for (const p of ["/portal/coach/reports", "/portal/coach/reports/all", "/portal/coach/observation/9", "/portal/coach/observation/9/form"]) {
      expect(currentCoachCardItem(p, "", true)).toBe("observe");
    }
    // off: today's rule (a visit's record step is Observe's)
    expect(currentCoachMenuItem("/portal/coach/visit/7/record", "")).toBe("observe");
  });
});

describe("the Home, switch on: Today card, then the tiles", () => {
  it("today's visits with their count; the next one carries Start recording, straight to its record step", async () => {
    config(true);
    home([visit("t1", "08:30", "done", "Farah Naz"), visit("t2", "10:00", "upcoming", "Kiran Shahzadi"), visit("t3", "12:00", "upcoming", "Asma Batool")]);
    await renderApp("/portal/coach");
    const card = await screen.findByTestId("home-today");
    expect(within(card).getByTestId("section-count")).toHaveTextContent("3");
    const current = within(card).getByTestId("visit-current");
    expect(current).toHaveTextContent("Kiran Shahzadi");
    const start = within(current).getByRole("link", { name: /Start recording/ });
    expect(start).toHaveAttribute("href", "/portal/coach/visit/t2/record");
    fireEvent.click(start);
    const { trackFlow } = await import("../flow/track");
    expect(trackFlow).toHaveBeenCalledWith("home.today_start");
    // the others are rows (done muted), each opening its visit
    expect(within(card).getByText("Asma Batool").closest("a")).toHaveAttribute("href", "/portal/coach/visit/t3");
    expect(within(card).getByText("Farah Naz").closest("a")).toHaveAttribute("href", "/portal/coach/visit/t1");
  });

  it("only one visit today: the card holds it alone, never an empty 'Nothing yet' under it (seen live on sandbox)", async () => {
    config(true);
    home([visit("t2", "10:00", "upcoming", "Kiran Shahzadi")]);
    await renderApp("/portal/coach");
    const card = await screen.findByTestId("home-today");
    expect(within(card).getByTestId("visit-current")).toHaveTextContent("Kiran Shahzadi");
    expect(card.querySelector("[data-empty]")).toBeNull();
  });

  it("the Schedule tile opens the list; the second tile is Observations and opens her observations", async () => {
    config(true);
    home([]);
    await renderApp("/portal/coach");
    const tiles = await screen.findByTestId("feature-tiles");
    await waitFor(() => expect(Array.from(tiles.querySelectorAll("a")).map((a) => a.getAttribute("href")).slice(0, 2))
      .toEqual(["/portal/coach/schedule", "/portal/coach/reports"]));
    expect(tiles.querySelectorAll("a")[1].textContent).toContain("Observations");
    // no visits today: no Today card at all (never an empty one)
    expect(screen.queryByTestId("home-today")).toBeNull();
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
