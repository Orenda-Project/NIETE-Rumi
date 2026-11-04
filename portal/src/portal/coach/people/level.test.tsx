import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadApp, moves, net, renderApp, resetAll } from "../card/harness.testdata";
import { withLevel, levelOf } from "./level";

vi.mock("axios", async () => (await import("../card/harness.testdata")).axiosMock());
vi.setConfig({ testTimeout: 20_000 });

/**
 * bd-ewbzns.1 — My schools by teaching level. Schools have no level: a school is under Primary when one of its teachers
 * teaches Primary. The Teachers tab keeps only that level's teachers. The pick is in the address, kept across the two
 * tabs and carried into a school.
 */
const school = (emis: string, name: string) => ({ schoolExtId: `niete:${emis}`, emis, name, teachers: 2, visits: 0, daysSinceVisit: null, avgHitl: null });
const SCHOOL_NAMES: Record<string, string> = { "101": "Primary School", "202": "High School", "303": "Mixed School" };
const teacher = (ext: string, name: string, emis: string, levels: string[]) => ({
  teacherExtId: ext, name, phone: ext, schoolName: SCHOOL_NAMES[emis], emis, schoolExtId: `niete:${emis}`, hitl: 0, dc: 0, avgHitl: null,
  daysSinceVisit: null, daysSinceTraining: null, levels,
});
const PEOPLE_DATA = {
  success: true,
  schools: [school("101", "Primary School"), school("202", "High School"), school("303", "Mixed School")],
  teachers: [
    teacher("900000000101", "Asma Primary", "101", ["PRIMARY"]),
    teacher("900000000102", "Bina Primary", "101", ["PRIMARY"]),
    teacher("900000000201", "Chand High", "202", ["HIGH"]),
    teacher("900000000202", "Dua Unset", "202", []),
    teacher("900000000301", "Esha Middle High", "303", ["MIDDLE", "HIGH"]),
    teacher("900000000302", "Fiza Primary", "303", ["PRIMARY"]),
  ],
};

function on() {
  net.answers.set("/config", { success: true, features: { coachV2: true, schoolCard: true } });
  net.answers.set("/coach/people", PEOPLE_DATA);
}
const schoolNames = () => screen.getAllByTestId("school-card").map((c) => c.querySelector("a")?.textContent || "");

beforeAll(async () => { await loadApp(); }, 120_000);
beforeEach(async () => { await resetAll(); });

describe("the level in the address", () => {
  it("withLevel adds or replaces ?level= and keeps the rest; levelOf reads any case", () => {
    expect(withLevel("/portal/coach/school/9", null)).toBe("/portal/coach/school/9");
    expect(withLevel("/portal/coach/school/9", "PRIMARY")).toBe("/portal/coach/school/9?level=primary");
    expect(withLevel("/portal/coach/school/9?period=month", "HIGH")).toBe("/portal/coach/school/9?period=month&level=high");
    expect(levelOf("Middle")).toBe("MIDDLE");
    expect(levelOf("early_years")).toBeNull();
  });
});

describe("My schools by teaching level", () => {
  it("Schools: the chips name the levels her teachers teach; Primary keeps the schools with a Primary teacher", async () => {
    on();
    await renderApp("/portal/coach/people");
    const chips = await screen.findByTestId("level-chips");
    expect(within(chips).getAllByRole("radio").map((r) => r.textContent)).toEqual(["All", "Primary", "Middle", "High"]);
    expect(schoolNames()).toHaveLength(3);
    await act(async () => { fireEvent.click(within(chips).getByRole("radio", { name: "Primary" })); });
    await waitFor(() => expect(schoolNames()).toHaveLength(2));
    expect(schoolNames().join(" ")).not.toMatch(/High School/);
    expect(moves[moves.length - 1]).toBe("/portal/coach/people?level=primary");
  });

  it("a school opened from the Primary list opens for Primary", async () => {
    on();
    const { container } = await renderApp("/portal/coach/people?level=primary");
    await screen.findByTestId("level-chips");
    const link = container.querySelector('a[href^="/portal/coach/school/101"]');
    expect(link?.getAttribute("href")).toBe("/portal/coach/school/101?level=primary");
  });

  it("Teachers: High keeps her High teachers (one teaching two levels too), never the one with none recorded", async () => {
    on();
    await renderApp("/portal/coach/people?tab=teachers&level=high");
    await screen.findByTestId("level-chips");
    const text = document.body.textContent || "";
    expect(text).toMatch(/High School/);
    expect(text).toMatch(/Mixed School/);
    expect(text).not.toMatch(/Primary School/);
    expect(text).not.toMatch(/Dua Unset/);
  });

  it("the tabs keep the level", async () => {
    on();
    const { container } = await renderApp("/portal/coach/people?level=middle");
    await screen.findByTestId("level-chips");
    const tabs = [...container.querySelectorAll('[data-testid="tab"]')].map((a) => a.getAttribute("href"));
    expect(tabs).toEqual(["/portal/coach/people?level=middle", "/portal/coach/people?tab=teachers&level=middle"]);
  });
});
