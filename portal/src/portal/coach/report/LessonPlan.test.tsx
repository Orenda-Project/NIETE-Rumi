import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { RubricGuide } from "../reports/RubricGuide";
import { ReportBodyView } from "./CoachReportPage";
import { WeekBodyV7 } from "./WeekV7";
import { COACH_REPORT, COACH_REPORT_EN, type CoachReportCopy } from "./copy";
import type { CoachReport, CoachWeek } from "./api";
import type { TalkGuide } from "../../services/api";

/**
 * The lesson plan check (the ICT HITL owner's spec "Lesson Plan Check: changes for Rumi", 23 Nov 2026), on the three
 * coach surfaces, each time LAST:
 *   - the debrief notes: "Lesson plan check" after "Your conversation": plan done, done as planned, most missed, every
 *     move by step (✓ done / ✗ missed with what happened, done/total per step), five lines with cues, the reminder;
 *     no plan linked: one question;
 *   - the debrief report: "Lesson plan discussion — n of 5 covered", covered parts with the coach's words, missed parts
 *     with what happened, "Next time, add" for the first missed part only, the lesson's moves folded; never scored;
 *   - the week: full discussions against last week, the part missed most often, no plan linked (not a miss).
 */
beforeAll(async () => { if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} }); });
beforeEach(async () => { await act(async () => { await i18n.changeLanguage("en"); }); });

const C = COACH_REPORT_EN as unknown as CoachReportCopy;
const both = (en: string, ur: string) => ({ en, ur });

const STEPS = [
  { key: "opening", name: "Opening", done: 2, total: 2, moves: [
    { id: "m1", mark: "done" as const, label: "Told children what they will learn" },
    { id: "m2", mark: "done" as const, label: "Recalled the last lesson" },
  ] },
  { key: "we_do", name: "We Do", done: 1, total: 3, moves: [
    { id: "m5", mark: "done" as const, label: "Answered together and one by one" },
    { id: "m6", mark: "missed" as const, label: "Partner practice (18:40)", what: "Children answered the teacher." },
    { id: "m7", mark: "not_assessed" as const, label: "Class game" },
  ] },
  { key: "check", name: "Check", done: 0, total: 1, moves: [
    { id: "m10", mark: "missed" as const, partial: true, label: "Ask how do you know", what: "Questions stayed common or proper." },
  ] },
];
const LINES = [
  "Let's look at the We Do step of today's plan.",
  "In Explain, you showed first and then did it together.",
  "At about 18:40 the plan has partner practice.",
  "What made partner practice hard to do today?",
  "Next time, how will you run the partner practice?",
];
const GUIDE: TalkGuide = {
  intro: "Before you sit down",
  went_well: ["Clear aim: told the children"],
  work_on_first: { title: "Asking why", next_step: "Add a why" },
  moment: null,
  conversation: ["one", "two", "three", "four", "five", "six"],
  lp_check: {
    v: 1, state: "ok", done: 7, total: 12,
    as_planned: { step: "Explain", text: "showed first, did it together, then children tried alone." },
    most_missed: { step: "We Do", move: "Partner practice", time: "18:40", text: "children answered the teacher instead of each other." },
    steps: STEPS,
    lines: LINES,
  },
};

describe("the debrief notes: the lesson plan check is the last section", () => {
  it("comes after the six conversation lines, with plan done, done as planned and most missed (with its time)", () => {
    render(<RubricGuide guide={GUIDE} />);
    const lp = screen.getByTestId("lp-check");
    const lines = screen.getAllByTestId("guide-line");
    expect(lines[lines.length - 1].compareDocumentPosition(lp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(lp).getByText(C.lpCheck)).toBeTruthy();
    expect(lp.textContent).toContain("7 of 12 moves.");
    expect(lp.textContent).toContain("Explain — showed first");
    expect(lp.textContent).toContain("We Do, Partner practice (about 18:40)");
  });

  it("lists every move by step, done/total per step, ✓ done / ✗ missed with what happened, partly and not assessed marked", () => {
    render(<RubricGuide guide={GUIDE} />);
    const steps = screen.getAllByTestId("lp-step");
    expect(steps.map((s) => s.getAttribute("data-step"))).toEqual(["opening", "we_do", "check"]);
    expect(steps[1].textContent).toContain("1/3");
    const moves = within(steps[1]).getAllByTestId("lp-move");
    expect(moves.map((m) => m.getAttribute("data-mark"))).toEqual(["done", "missed", "not_assessed"]);
    expect(moves[1].textContent).toContain("Children answered the teacher.");
    expect(moves[2].textContent).toContain(C.lpMoveNotAssessed);
    expect(within(steps[2]).getByTestId("lp-move").textContent).toContain(C.lpPartly);
  });

  it("five lines, with the wait cue after line 4 and the name-it cue after line 5, then the reminder", () => {
    render(<RubricGuide guide={GUIDE} />);
    const said = screen.getAllByTestId("lp-line");
    expect(said).toHaveLength(5);
    expect(said[3].textContent).toContain(C.lpCueWait);
    expect(said[4].textContent).toContain(C.lpCueNameIt);
    expect(said[0].textContent).toContain(C.lpLine1);
    expect(screen.getByTestId("lp-check").textContent).toContain(C.lpReminder);
  });

  it("no plan linked: only the question", () => {
    render(<RubricGuide guide={{ ...GUIDE, lp_check: { v: 1, state: "no_plan" } }} />);
    const lp = screen.getByTestId("lp-check");
    expect(lp.textContent).toContain(C.lpNoPlanQuestion);
    expect(screen.queryAllByTestId("lp-line")).toHaveLength(0);
  });

  it("the plan was for a different lesson: not assessed, no checklist", () => {
    render(<RubricGuide guide={{ ...GUIDE, lp_check: { v: 1, state: "not_assessed", reason: "mismatch" } }} />);
    expect(screen.getByTestId("lp-check").textContent).toContain(C.lpNaMismatch);
    expect(screen.queryAllByTestId("lp-step")).toHaveLength(0);
  });

  it("notes without the check (switch off): no section, exactly as before", () => {
    const { lp_check: _drop, ...plain } = GUIDE;
    render(<RubricGuide guide={plain} />);
    expect(screen.queryByTestId("lp-check")).toBeNull();
  });

  it("Urdu: the section's words in Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    render(<RubricGuide guide={GUIDE} />);
    expect(screen.getByTestId("lp-check").textContent).toContain(COACH_REPORT.ur.lpCheck);
    expect(screen.getByTestId("lp-check").textContent).toContain(COACH_REPORT.ur.lpReminder);
  });
});

const PART_NAMES = {
  name_step: both("Name the step", "قدم کا نام لیا"),
  as_planned: both("What went as planned", "جو پلان کے مطابق ہوا"),
  gap: both("The gap, with evidence", "خلا، ثبوت کے ساتھ"),
  ask: both("Ask what got in the way", "رکاوٹ کے بارے میں سوال"),
  next_step: both("A next step tied to the plan", "پلان سے جڑا اگلا قدم"),
};
const part = (key: keyof typeof PART_NAMES, covered: boolean) => ({
  key, name: PART_NAMES[key], covered, quote: covered ? `“${key} words”` : null, what: covered ? null : `what happened at ${key}`,
});
const REPORT: CoachReport = {
  id: "r1",
  header: { teacher: "Ms. Sadia", grade: "3", subject: "English", topic: "Nouns", at: new Date().toISOString() },
  harmful: false, concern: null,
  marks: [{ key: "asked_and_waited", done: false, name: both("Asked & waited", "سوال کے بعد انتظار") }],
  done: 0, total: 1, respectHeld: true,
  did: [], missed: [{ key: "asked_and_waited", name: both("Asked & waited", "سوال کے بعد انتظار"), line: "No question.", why: both("Why", "کیوں") }],
  focus: { key: "asked_and_waited", move: "Ask, then wait", why: "It opens the rest.", tryLine: null },
  lessonPlan: {
    state: "ok", covered: 3, total: 5,
    parts: [part("name_step", true), part("as_planned", true), part("gap", true), part("ask", false), part("next_step", false)],
    nextTime: { key: "ask", line: "What made partner practice hard to do today?" },
    moves: STEPS, moveCount: 6,
  },
};

const renderReport = (r: CoachReport, v7 = true) => render(<MemoryRouter><ReportBodyView report={r} C={C} lang="en" v7={v7} /></MemoryRouter>);

describe("the debrief report: the lesson plan discussion is the last block", () => {
  it("v7: after every other block, before the closing line; n of 5 covered; not part of the score", () => {
    renderReport(REPORT);
    const body = screen.getByTestId("report-body");
    const sections = Array.from(body.querySelectorAll("section"));
    expect(sections[sections.length - 1].getAttribute("data-testid")).toBe("report-lesson-plan");
    const lp = screen.getByTestId("report-lesson-plan");
    expect(lp.textContent).toContain(C.lpDiscussion);
    expect(lp.textContent).toContain("3 of 5 covered");
    expect(lp.textContent).toContain(C.lpNotScored);
  });

  it("covered parts show the coach's words; missed parts what happened; 'Next time, add' once, for the first missed part", () => {
    renderReport(REPORT);
    const parts = screen.getAllByTestId("lp-part");
    expect(parts.map((p) => p.getAttribute("data-covered"))).toEqual(["yes", "yes", "yes", "no", "no"]);
    expect(parts[0].textContent).toContain("name_step words");
    expect(parts[3].textContent).toContain("what happened at ask");
    const next = screen.getAllByTestId("lp-next-time");
    expect(next).toHaveLength(1);
    expect(next[0].textContent).toContain("What made partner practice hard to do today?");
    expect(next[0].textContent).toContain(C.lpThenWait);
  });

  it("the lesson's moves are folded, and open on tap", () => {
    renderReport(REPORT);
    expect(screen.queryAllByTestId("lp-step")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: C.lpSeeMoves(6) }));
    expect(screen.getAllByTestId("lp-step")).toHaveLength(3);
  });

  it("the stars and the score are the same with and without the block", () => {
    const { unmount } = renderReport(REPORT);
    const withIt = screen.getByTestId("report-marks").textContent;
    unmount();
    renderReport({ ...REPORT, lessonPlan: null });
    expect(screen.getByTestId("report-marks").textContent).toBe(withIt);
    expect(screen.queryByTestId("report-lesson-plan")).toBeNull();
  });

  it("no plan linked: 'No lesson plan linked today.'", () => {
    renderReport({ ...REPORT, lessonPlan: { state: "no_plan" } });
    expect(screen.getByTestId("report-lesson-plan").textContent).toContain(C.lpNoPlanCard);
  });

  it("the older layout (switch off) draws it last too, when a report has it", () => {
    renderReport(REPORT, false);
    const sections = Array.from(screen.getByTestId("report-body").querySelectorAll("section"));
    expect(sections[sections.length - 1].getAttribute("data-testid")).toBe("report-lesson-plan");
  });
});

const WEEK: CoachWeek = {
  monday: "2026-11-23", friday: "2026-11-27", target: 12, complete: 10, debriefs: 10, small: false, firstWeek: false,
  respectAll: true, training: null, focus: null, strengths: [], keepInMind: [], table: [],
  lessonPlan: {
    week: { full: 4, of: 10 }, last: { full: 1, of: 9 },
    mostMissed: { key: "ask", n: 6, of: 10, name: PART_NAMES.ask }, noPlan: 1,
  },
};

describe("the week: lesson plan discussions is the last block", () => {
  it("full discussions this week against last, the part missed most, no plan linked apart", () => {
    render(<MemoryRouter><WeekBodyV7 w={WEEK} C={C} lang="en" /></MemoryRouter>);
    const lp = screen.getByTestId("week-lesson-plan");
    const sections = Array.from(document.querySelectorAll("section"));
    expect(sections[sections.length - 1]).toBe(lp);
    expect(lp.textContent).toContain(C.lpWeekTitle);
    expect(lp.textContent).toContain("4 of 10 debriefs");
    expect(lp.textContent).toContain("Last week: 1 of 9.");
    expect(lp.textContent).toContain("Ask what got in the way");
    expect(lp.textContent).toContain("missed in 6 of 10 debriefs.");
    expect(lp.textContent).toContain("No plan linked: 1 debrief (not counted as a miss).");
  });

  it("no check this week: no block", () => {
    render(<MemoryRouter><WeekBodyV7 w={{ ...WEEK, lessonPlan: null }} C={C} lang="en" /></MemoryRouter>);
    expect(screen.queryByTestId("week-lesson-plan")).toBeNull();
  });
});
