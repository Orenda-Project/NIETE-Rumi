import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadApp, net, renderApp, resetAll } from "./harness.testdata";
import { EMIS, EXT, MONTH, TODAY, TRAINING_BY_TEACHER, grid, schoolCard, schoolScores } from "./fixtures.testdata";
import type { SchoolCardData } from "./types";

vi.mock("axios", async () => (await import("./harness.testdata")).axiosMock());
vi.setConfig({ testTimeout: 20_000 });

/**
 * bd-17v39c.4.13 (queue #19) — Rifat's School view, as the operator approved it (mockups v3, 5 Nov): an overview (who used
 * NIETE this period and the same days before, then five boxes two to a row), one teacher table (icon heads, Contribution
 * last, the quiet teachers always shown with 0s and 0%), a coach-observations table, Manage. The five Activity tiles are
 * gone; each box opens its details page, which now opens with that box's numbers and the tile's chart.
 */
const CARD = `/portal/coach/school/${EMIS}`;

function on() {
  net.answers.set("/config", { success: true, features: { coachV2: true, schoolCard: true } });
  net.answers.set("/coach/people", { success: true, schools: [], teachers: [] });
  net.answers.set(`/coach/school/${EMIS}/card`, schoolCard());
  net.answers.set(`/coach/school/${EMIS}/card?period=today`, schoolCard(TODAY));
  net.answers.set(`/coach/school/${EMIS}/card?period=month`, schoolCard(MONTH));
  net.answers.set(`/coach/school/${EMIS}/feature/lp`, grid());
  net.answers.set(`/coach/school/${EMIS}/feature/papers`, { ...grid(), feature: "papers", total: 5, makers: 4, prev: { total: 2, perTeacherDay: 0.1 } });
  net.answers.set(`/coach/school/${EMIS}/feature/training?period=month`, TRAINING_BY_TEACHER);
  for (const kind of ["dc", "coach"] as const) net.answers.set(`/coach/school/${EMIS}/scores/${kind}`, schoolScores(kind));
}

const boxIds = () => Array.from(screen.getByTestId("overview-boxes").children).map((c) => c.getAttribute("data-testid"));

beforeAll(async () => { await loadApp(); }, 120_000);
beforeEach(async () => { await resetAll(); });

describe("the overview", () => {
  it("who used NIETE this week and the same days last week, then five boxes two to a row; no Activity tiles", async () => {
    on();
    const { container } = await renderApp(CARD);
    const ov = await screen.findByTestId("overview");
    expect(within(ov).getByTestId("used-count")).toHaveTextContent("7 of 12");
    expect(ov).toHaveTextContent("teachers used NIETE this week");
    expect(ov).toHaveTextContent("Last week: 6 of 12");
    expect(ov).toHaveTextContent("This week, across 12 teachers · tap a box for details");
    expect(boxIds()).toEqual(["box-lp", "box-training", "box-papers", "box-dc", "box-coach"]);
    expect(screen.getByTestId("overview-boxes").className).toMatch(/grid-cols-2/);
    expect(screen.getByTestId("box-coach").className).toMatch(/col-span-2/);
    // the Activity tiles left the card
    for (const id of ["activity", "tile-lp", "tile-papers", "tile-training", "score-tile-dc", "score-tile-coach", "bars-lp"]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(container.textContent).not.toMatch(/a day(?! per)|training parts?|under way/);
  });

  it("each box: its name, its number, its line; it opens its details page", async () => {
    on();
    await renderApp(CARD);
    const lp = await screen.findByTestId("box-lp");
    expect(lp).toHaveTextContent("Lesson plans");
    expect(within(lp).getByTestId("box-number")).toHaveTextContent("27");
    expect(lp).toHaveTextContent("0.8 a school day per teacher");
    expect(lp).toHaveTextContent("last week 0.6, same days");
    expect(lp).toHaveAttribute("href", `${CARD}/feature/lp`);
    const trn = screen.getByTestId("box-training");
    expect(trn).toHaveTextContent("Training");
    expect(within(trn).getByTestId("box-number")).toHaveTextContent("1");
    expect(trn).toHaveTextContent(/1\s*module completed/);
    expect(trn).toHaveTextContent("by 1 of 12 teachers");
    expect(trn).toHaveAttribute("href", `${CARD}/feature/training`);
    const papers = screen.getByTestId("box-papers");
    expect(within(papers).getByTestId("box-number")).toHaveTextContent("5");
    expect(papers).toHaveTextContent("assessments");
    expect(papers).toHaveTextContent("by 4 of 12 teachers");
    expect(papers).toHaveAttribute("href", `${CARD}/feature/papers`);
    const dc = screen.getByTestId("box-dc");
    expect(dc).toHaveTextContent("Digital Coaching");
    expect(within(dc).getByTestId("box-number")).toHaveTextContent("66%");
    expect(dc).toHaveTextContent("average");
    expect(dc).toHaveTextContent("4 observations · last week 61%");
    expect(dc).toHaveAttribute("href", `${CARD}/feature/dc`);
    const coach = screen.getByTestId("box-coach");
    expect(coach).toHaveTextContent("Coach observations");
    expect(within(coach).getByTestId("box-number")).toHaveTextContent("68%");
    expect(coach).toHaveTextContent("Coach average");
    // no period before to compare with: no "last week"
    expect(coach).toHaveTextContent("2 observations");
    expect(coach).not.toHaveTextContent("last week");
    expect(coach).toHaveAttribute("href", `${CARD}/feature/coach`);
  });

  it("This month and Today say their own period, and the boxes keep it", async () => {
    on();
    await renderApp(`${CARD}?period=month`);
    const ov = await screen.findByTestId("overview");
    expect(ov).toHaveTextContent("teachers used NIETE this month");
    expect(ov).toHaveTextContent("Last month: 6 of 12");
    expect(screen.getByTestId("box-lp")).toHaveTextContent("last month 0.6, same days");
    expect(screen.getByTestId("box-lp")).toHaveAttribute("href", `${CARD}/feature/lp?period=month`);
    await act(async () => { fireEvent.click(screen.getByRole("radio", { name: "Today" })); });
    await waitFor(() => expect(screen.getByTestId("overview")).toHaveTextContent("teachers used NIETE today"));
    expect(screen.getByTestId("overview")).toHaveTextContent("Yesterday: 6 of 12");
    expect(screen.getByTestId("box-lp")).toHaveTextContent("0.8 per teacher today");
    expect(screen.getByTestId("box-lp")).toHaveTextContent("yesterday 0.6");
    // nothing scored yet today: a dash, never 0%
    expect(within(screen.getByTestId("box-dc")).getByTestId("box-number")).toHaveTextContent("—");
  });

  it("a quiet morning: 0 of 12 still shows, with yesterday under it and one line", async () => {
    on();
    const c = schoolCard(TODAY);
    net.answers.set(`/coach/school/${EMIS}/card?period=today`, { ...c, overview: { ...c.overview!, active: { now: 0, prev: 9 } } });
    await renderApp(`${CARD}?period=today`);
    const ov = await screen.findByTestId("overview");
    expect(within(ov).getByTestId("used-count")).toHaveTextContent("0 of 12");
    expect(ov).toHaveTextContent("Yesterday: 9 of 12");
    expect(ov).toHaveTextContent("No NIETE use recorded today yet.");
  });

  it("a number that did not load is a dash, never 0", async () => {
    on();
    const c = schoolCard();
    net.answers.set(`/coach/school/${EMIS}/card`, { ...c, overview: undefined });
    await renderApp(CARD);
    const lp = await screen.findByTestId("box-lp");
    expect(within(lp).getByTestId("box-number")).toHaveTextContent("—");
    expect(within(screen.getByTestId("overview")).getByTestId("used-count")).toHaveTextContent("—");
  });
});

describe("the teacher table", () => {
  it("icon heads, one row per teacher, her four counts in feature order and Contribution last; ★ on the top two", async () => {
    on();
    await renderApp(CARD);
    const table = await screen.findByTestId("teacher-table");
    const heads = within(table).getByTestId("table-heads");
    expect(heads).toHaveTextContent("Teacher");
    expect(heads).toHaveTextContent("Contribution");
    expect(Array.from(heads.querySelectorAll("[data-head]")).map((h) => h.getAttribute("data-head"))).toEqual(["lp", "dc", "training", "papers"]);
    // each icon head says its feature to a screen reader; training is modules completed
    expect(heads).toHaveTextContent(/Lesson plans.*DC observations.*Modules completed.*Assessments/);
    const rows = within(table).getAllByTestId("table-row");
    expect(rows).toHaveLength(7);
    expect(rows[0]).toHaveTextContent("Teacher Alpha");
    expect(rows[0]).toHaveAttribute("href", `/portal/coach/teacher/${EXT}`);
    expect(Array.from(rows[0].querySelectorAll("[data-count]")).map((c) => `${c.getAttribute("data-count")}=${c.textContent}`))
      .toEqual(["lp=6", "dc=3", "training=2", "papers=2"]);
    expect(within(rows[0]).getByTestId("contribution").textContent).toMatch(/^\d+%$/);
    expect(rows.filter((r) => r.querySelector("[data-star]"))).toHaveLength(2);
  });

  it("the quiet teachers are always there, under 'Nothing this week', grey, with 0s and 0%", async () => {
    on();
    await renderApp(CARD);
    const table = await screen.findByTestId("teacher-table");
    const quiet = within(table).getByTestId("quiet-head");
    expect(quiet).toHaveTextContent("Nothing this week");
    expect(quiet).toHaveTextContent("5");
    const rows = within(table).getAllByTestId("table-row-none");
    expect(rows).toHaveLength(5);
    expect(Array.from(rows[0].querySelectorAll("[data-count]")).map((c) => c.textContent)).toEqual(["0", "0", "0", "0"]);
    expect(within(rows[0]).getByTestId("contribution")).toHaveTextContent("0%");
    expect(rows[0].getAttribute("href")).toMatch(/^\/portal\/coach\/teacher\//);
    expect(table.innerHTML).not.toMatch(/#c8331f|#b42318/i);
  });

  it("more than 8 who did something: the top 8, then Show all", async () => {
    on();
    const c = schoolCard();
    const teachers = c.teachers.map((t, i) => (i < 10 ? { ...t, counts: { lp: 12 - i, dc: 0, training: 0, papers: 0 }, total: 12 - i, contributionPct: 9 } : t));
    net.answers.set(`/coach/school/${EMIS}/card`, { ...c, teachers } as SchoolCardData);
    await renderApp(CARD);
    const table = await screen.findByTestId("teacher-table");
    expect(within(table).getAllByTestId("table-row")).toHaveLength(8);
    const more = within(table).getByRole("button", { name: "Show all 10 teachers" });
    await act(async () => { fireEvent.click(more); });
    expect(within(table).getAllByTestId("table-row")).toHaveLength(10);
  });

  it("search (more than 10 teachers) narrows the table", async () => {
    on();
    await renderApp(CARD);
    const box = await screen.findByPlaceholderText("Teacher name");
    await act(async () => { fireEvent.change(box, { target: { value: "bravo" } }); });
    expect(within(screen.getByTestId("teacher-table")).getAllByTestId("table-row")).toHaveLength(1);
    expect(within(screen.getByTestId("teacher-table")).queryByTestId("quiet-head")).toBeNull();
    await act(async () => { fireEvent.change(box, { target: { value: "nobody" } }); });
    expect(screen.getByTestId("no-match")).toBeInTheDocument();
  });

  it("the table reads with the page: right to left in Urdu, the teacher first", async () => {
    on();
    await renderApp(CARD, "ur");
    const table = await screen.findByTestId("teacher-table");
    expect(table.getAttribute("dir")).not.toBe("ltr");
    expect(within(table).getByTestId("table-heads")).toHaveTextContent("ٹیچر");
    expect(within(table).getByTestId("table-heads")).toHaveTextContent("حصہ");
    expect(within(table).getByTestId("table-heads")).toHaveTextContent("ماڈیول مکمل");
    expect(within(table).getByTestId("quiet-head")).toHaveTextContent("اس ہفتے کچھ نہیں");
  });
});

describe("the coach observations table", () => {
  it("count, average and last week's on top; a row per teacher: observations, a trend, the change in colour, the latest", async () => {
    on();
    await renderApp(CARD);
    const obs = await screen.findByTestId("coach-obs-table");
    expect(screen.getByTestId("coach-obs-sub")).toHaveTextContent("2 observations · average 68%");
    const heads = within(obs).getByTestId("obs-heads");
    expect(heads).toHaveTextContent(/Teacher.*Obs.*Trend.*Change.*Latest/);
    const rows = within(obs).getAllByTestId("obs-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Teacher Bravo");
    expect(within(rows[0]).getByTestId("obs-count")).toHaveTextContent("2");
    expect(rows[0].querySelectorAll('[data-point="square"]')).toHaveLength(2);
    const up = within(rows[0]).getByTestId("obs-change");
    expect(up).toHaveTextContent("+7%");
    expect(up.getAttribute("data-tone")).toBe("up");
    expect(within(rows[0]).getByTestId("obs-latest")).toHaveTextContent("71%");
    expect(rows[0]).toHaveAttribute("href", "/portal/coach/teacher/900000000002/observations");
    expect(within(rows[1]).getByTestId("obs-change")).toHaveTextContent("first");
    expect(within(rows[1]).getByTestId("obs-change").getAttribute("data-tone")).toBe("first");
  });

  it("a drop is red and signed; last week's average shows when there is one", async () => {
    on();
    const c = schoolCard();
    net.answers.set(`/coach/school/${EMIS}/card`, {
      ...c,
      scores: { ...c.scores!, coach: { ...c.scores!.coach, prevAvg: 58 } },
      coachObservations: { count: 2, teachers: [{ ...c.coachObservations.teachers[0], latest: 60, change: -4 }] },
    });
    await renderApp(CARD);
    const change = await screen.findByTestId("obs-change");
    expect(change).toHaveTextContent("−4%");
    expect(change.getAttribute("data-tone")).toBe("down");
    expect(screen.getByTestId("coach-obs-sub")).toHaveTextContent("2 observations · average 68% (last week 58%)");
  });

  it("none this week: one line instead of an empty table", async () => {
    on();
    const c = schoolCard();
    net.answers.set(`/coach/school/${EMIS}/card`, { ...c, coachObservations: { count: 0, teachers: [] } });
    await renderApp(CARD);
    expect(await screen.findByTestId("no-coach-obs")).toHaveTextContent("No coach observations this week");
    expect(screen.queryByTestId("coach-obs-table")).toBeNull();
  });

  it("Manage stays, right under the tables", async () => {
    on();
    await renderApp(CARD);
    const manage = await screen.findByTestId("manage");
    const order = Array.from(document.querySelectorAll('[data-testid="overview"], [data-testid="teacher-table"], [data-testid="coach-obs-table"], [data-testid="manage"]'))
      .map((e) => e.getAttribute("data-testid"));
    expect(order).toEqual(["overview", "teacher-table", "coach-obs-table", "manage"]);
    expect(manage).toBeInTheDocument();
  });
});

describe("a box's details page opens with the box's numbers and the tile's chart", () => {
  it("Lesson plans: the total, per teacher per school day, last week the same days, by N of M, the day bars, then By teacher", async () => {
    on();
    await renderApp(`${CARD}/feature/lp`);
    const top = await screen.findByTestId("details-top");
    expect(within(top).getByTestId("details-number")).toHaveTextContent("24");
    expect(top).toHaveTextContent("lesson plans");
    expect(top).toHaveTextContent("0.7 a school day per teacher");
    expect(top).toHaveTextContent("Last week 0.5, same days");
    expect(top).toHaveTextContent("by 7 of 12 teachers");
    const bars = within(top).getByTestId("bars-lp");
    expect(bars).toHaveAttribute("dir", "ltr");
    expect(Array.from(bars.querySelectorAll("[data-bar]")).map((b) => b.getAttribute("data-bar"))).toEqual(["count", "count", "count", "future", "future"]);
    expect(screen.getByTestId("by-teacher-head")).toHaveTextContent("By teacher");
    expect(screen.getByTestId("by-teacher-head")).toHaveTextContent("Most first · tap a teacher for her lesson plans");
    expect(screen.getByTestId("teacher-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("grid-summary")).toBeNull();
    // Back returns to the card on the same period
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", CARD);
  });

  it("Assessments: the same top, no rate", async () => {
    on();
    await renderApp(`${CARD}/feature/papers`);
    const top = await screen.findByTestId("details-top");
    expect(within(top).getByTestId("details-number")).toHaveTextContent("5");
    expect(top).toHaveTextContent("assessments");
    expect(top).toHaveTextContent("by 4 of 12 teachers");
    expect(top).not.toHaveTextContent("per teacher");
    expect(within(top).getByTestId("bars-papers")).toBeInTheDocument();
  });

  it("nothing yet this week: says so, with last week's number under it; the grid still lists everyone", async () => {
    on();
    const g = grid();
    net.answers.set(`/coach/school/${EMIS}/feature/lp`, { ...g, total: 0, makers: 0, perTeacherDay: 0, school: [0, 0, 0, null, null], rows: g.rows.map((r) => ({ ...r, cells: [0, 0, 0, null, null], total: 0 })) });
    await renderApp(`${CARD}/feature/lp`);
    const top = await screen.findByTestId("details-top");
    expect(top).toHaveTextContent("No lesson plans this week yet");
    expect(top).toHaveTextContent("Last week 0.5, same days");
    expect(within(screen.getByTestId("teacher-grid")).getAllByTestId("grid-row")).toHaveLength(12);
  });

  it("Digital Coaching by teacher: the average against last week, with the school's line on top", async () => {
    on();
    await renderApp(`${CARD}/feature/dc`);
    const sum = await screen.findByTestId("scores-summary");
    expect(sum).toHaveTextContent("69%");
    expect(within(sum).getByTestId("score-line")).toHaveAttribute("dir", "ltr");
    expect(within(sum).getByTestId("score-line")).toHaveTextContent(/Mon.*26.*Tue.*27.*Wed.*28/);
    // the change on last week's same days: 69 against 64
    expect(sum.querySelector("[data-delta]")).toHaveAttribute("data-delta", "5");
  });

  it("Training by teacher: modules completed this period on top, then each teacher's N of M modules and this period's", async () => {
    on();
    const { container } = await renderApp(`${CARD}/feature/training?period=month`);
    const top = await screen.findByTestId("details-top");
    expect(within(top).getByTestId("details-number")).toHaveTextContent("9");
    expect(top).toHaveTextContent("modules completed");
    expect(top).toHaveTextContent("by 2 of 3 teachers");
    expect(top).toHaveTextContent("Last month 4, same days");
    // the period is the card's, and can be switched here
    expect(screen.getByRole("radio", { name: "This month" })).toHaveAttribute("aria-checked", "true");
    const rows = await screen.findAllByTestId("training-row");
    expect(rows[0]).toHaveTextContent("Teacher Alpha");
    expect(rows[0]).toHaveTextContent("137 of 178 modules completed");
    expect(rows[0]).toHaveTextContent("6 this month");
    expect(within(rows[0]).getAllByTestId("teacher-training").map((c) => c.textContent)).toEqual(["NIETE130/171", "GBTLADone"]);
    // 199 of 200 is not Done
    expect(within(rows[1]).getAllByTestId("teacher-training").map((c) => c.textContent)).toEqual(["NIETE199/200"]);
    expect(rows[2]).toHaveAttribute("data-none", "1");
    expect(rows[2]).toHaveTextContent("No training yet");
    expect(container.textContent).not.toMatch(/\bparts?\b|\d+%/i);
  });
});

describe("Urdu", () => {
  it("the overview in Urdu: counts first, modules completed, the boxes still open their pages", async () => {
    on();
    await renderApp(CARD, "ur");
    const ov = await screen.findByTestId("overview");
    expect(within(ov).getByTestId("used-count")).toHaveTextContent("12 میں سے 7");
    expect(ov).toHaveTextContent("پچھلا ہفتہ: 12 میں سے 6");
    expect(screen.getByTestId("box-training")).toHaveTextContent("ماڈیول مکمل");
    expect(screen.getByTestId("box-lp")).toHaveTextContent("لیسن پلان");
    expect(screen.getByTestId("box-lp")).toHaveTextContent("انہی دنوں");
    expect(screen.getByTestId("box-coach")).toHaveTextContent("کوچ کی اوسط");
    expect(screen.getByTestId("box-lp")).toHaveAttribute("href", `${CARD}/feature/lp`);
    expect(screen.getByTestId("coach-obs-table")).toHaveTextContent("پہلا");
  });
});
