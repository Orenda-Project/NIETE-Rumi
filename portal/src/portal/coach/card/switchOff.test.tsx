import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { loadApp, net, renderApp, resetAll, moves } from "./harness.testdata";
import { EMIS, EXT, schoolCard, teacherCard } from "./fixtures.testdata";

vi.mock("axios", async () => (await import("./harness.testdata")).axiosMock());

/**
 * The School card switch OFF (absent, false, "true", or /config unreadable): the coach app is exactly what it is on
 * sandbox today. The landing page is the Training Library, the menu is Training Library · Lesson Plans · My schools · More,
 * a school and a teacher are today's pages (and never ask the card's API), and the card's own addresses go nowhere.
 */
const SCHOOL = { schoolExtId: "niete:SCH-9", emis: EMIS, name: "Model School Nine", teachers: 1, visits: 2, daysSinceVisit: 9, avgHitl: 61 };
const TEACHER = {
  teacherExtId: EXT, name: "Teacher Alpha", phone: null, schoolName: SCHOOL.name, emis: EMIS, schoolExtId: SCHOOL.schoolExtId,
  hitl: 2, dc: 1, avgHitl: 61, daysSinceVisit: 9, daysSinceTraining: 3, trainingModules: 2, examsGenerated: 1, lpOpened: 4,
};

const CONFIGS: [string, unknown][] = [
  ["no schoolCard key", { success: true, features: { coachV2: true } }],
  ["schoolCard false", { success: true, features: { coachV2: true, schoolCard: false } }],
  ["schoolCard the string true", { success: true, features: { coachV2: true, schoolCard: "true" } }],
];

function today(config: unknown) {
  net.answers.set("/config", config);
  net.answers.set("/coach/people", { success: true, schools: [SCHOOL], teachers: [TEACHER] });
  net.answers.set(`/coach/school/${EMIS}`, { success: true, school: SCHOOL, teachers: [TEACHER] });
  net.answers.set(`/coach/teacher/${EXT}`, { success: true, teacher: TEACHER, nextVisit: null, history: [] });
  // The card's answers exist too: with the switch off they must never be asked for.
  net.answers.set(`/coach/school/${EMIS}/card`, schoolCard());
  net.answers.set(`/coach/teacher/${EXT}/card`, teacherCard());
}

vi.setConfig({ testTimeout: 20_000 });
beforeAll(async () => { await loadApp(); }, 120_000);
beforeEach(async () => { await resetAll(); });

describe.each(CONFIGS)("the switch off (%s): today's coach app", (_l, config) => {
  it("/portal/coach goes to the Training Library, as today", async () => {
    today(config);
    await renderApp("/portal/coach");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/portal/coach/training"));
  });

  it.each(["/portal/coach/session/s-1", "/portal/coach/insights", "/portal/coach/scheduling"])("%s goes to the Training Library", async (entry) => {
    today(config);
    await renderApp(entry);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/portal/coach/training"));
  });

  it("a school is today's page (its four numbers), and the card's API is never asked", async () => {
    today(config);
    await renderApp(`/portal/coach/school/${EMIS}`);
    await waitFor(() => expect(screen.getByText("Visits · last 3 months")).toBeInTheDocument());
    expect(screen.getByText("Teacher Alpha")).toBeInTheDocument();
    expect(screen.queryByTestId("activity")).toBeNull();
    expect(net.calls.some((c) => c.includes("/card"))).toBe(false);
    expect(moves).toEqual([`/portal/coach/school/${EMIS}`]);
  });

  it("a teacher is today's page, and the card's API is never asked", async () => {
    today(config);
    await renderApp(`/portal/coach/teacher/${EXT}`);
    await waitFor(() => expect(screen.getByTestId("avg-hitl")).toBeInTheDocument());
    expect(screen.queryByTestId("teacher-tiles")).toBeNull();
    expect(net.calls.some((c) => c.includes("/card"))).toBe(false);
  });

  it("the menu is today's: Training Library · Lesson Plans · My schools · More", async () => {
    today(config);
    await renderApp("/portal/coach/people");
    await waitFor(() => expect(screen.getAllByText("Model School Nine").length).toBeGreaterThan(0));
    const links = Array.from(screen.getByTestId("teacher-nav").querySelectorAll("a")).map((a) => a.textContent);
    expect(links).toEqual(["Training Library", "Lesson Plans", "My schools", "More"]);
    // My schools is a top-level menu page: no Back to a Home that is not there.
    expect(screen.queryByTestId("page-crumb")).toBeNull();
  });

  it.each([`/portal/coach/school/${EMIS}/feature/lp`, `/portal/coach/teacher/${EXT}/items/lp`, `/portal/coach/teacher/${EXT}/items/dc`,
    `/portal/coach/teacher/${EXT}/reports`, `/portal/coach/teacher/${EXT}/coaching`])(
    "%s is not a page (as any unknown address today)", async (entry) => {
      today(config);
      await renderApp(entry);
      await waitFor(() => expect(screen.getByText(/404|not found/i)).toBeInTheDocument());
      // the old addresses do not even move to the Coaching page with the switch off
      expect(screen.getByTestId("where")).toHaveTextContent(entry);
      expect(net.calls.some((c) => c.includes("/feature/") || c.includes("/items/") || c.includes("/reports") || c.includes("/coaching"))).toBe(false);
    });
});

describe("an unreadable /config is off", () => {
  it("lands on the Training Library and shows today's school page", async () => {
    net.answers.set("/config", new Error("network"));
    net.answers.set(`/coach/school/${EMIS}`, { success: true, school: SCHOOL, teachers: [TEACHER] });
    await renderApp(`/portal/coach/school/${EMIS}`);
    // coachV2 is off too, so the page's own gate sends her to the leader app, exactly as today.
    await waitFor(() => expect(screen.getByTestId("where")).not.toHaveTextContent(`/portal/coach/school/${EMIS}`));
    expect(net.calls.some((c) => c.includes("/card"))).toBe(false);
  });
});
