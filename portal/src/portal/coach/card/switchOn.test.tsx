import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { linkPaths, loadApp, moves, net, renderApp, resetAll } from "./harness.testdata";
import { COACH_ITEMS, DC_ITEMS, EMIS, EXT, MONTH, NO_REPORTS, REPORTS, SESSION, SESSION_REPORT, TODAY, TRAINING_ITEMS, grid, schoolCard, teacherCard } from "./fixtures.testdata";
import { coachPathReady, coachReadyFor } from "../training/appReady";

vi.mock("axios", async () => (await import("./harness.testdata")).axiosMock());
vi.setConfig({ testTimeout: 20_000 });

/**
 * The School card switch ON (features.schoolCard === true): the slim Coach Home is the landing page with the menu
 * Home · Lesson Plans · More, and every School card screen works against the API contract's shapes. Only the network
 * is mocked; the real guard, gates, flag hooks, pages and menu run. No page links anywhere the coach app keeps shut.
 */
const READY = coachReadyFor(false, true);
const SHUT = ["/portal/coach/scheduling", "/portal/coach/schedule", "/portal/coach/new-visit", "/portal/coach/observe", "/portal/coach/visit",
  "/portal/coach/observation", "/portal/coach/reports", "/portal/coach/analytics", "/portal/coach/insights"];

function on(extra: Record<string, unknown> = {}) {
  net.answers.set("/config", { success: true, features: { coachV2: true, schoolCard: true, coachip: true, ...extra } });
  net.answers.set("/training/library", { vendors: [{ vendor_key: "V", vendor_name: "Vendor", levels: [{ id: 1, name: "L1", order_index: 1, has_level_exam: false, exam_kind: null, courses: [{ id: 1, title: "C1", order_index: 1, has_readings: false, has_module_exam: false, modules: [] }, { id: 2, title: "C2", order_index: 2, has_readings: false, has_module_exam: false, modules: [] }] }] }] });
  net.answers.set("/coach/people", { success: true, schools: [{ emis: EMIS, name: "Model School Nine", teachers: 12, visits: 1, daysSinceVisit: 1, avgHitl: 60 }], teachers: Array.from({ length: 12 }, (_, i) => ({ teacherExtId: `t${i}`, name: `T${i}` })) });
  net.answers.set(`/coach/school/${EMIS}/card`, schoolCard());
  net.answers.set(`/coach/school/${EMIS}/card?period=today`, schoolCard(TODAY));
  net.answers.set(`/coach/school/${EMIS}/card?period=month`, { ...schoolCard(MONTH), tiles: schoolCard(MONTH).tiles.map((t) => ({ ...t, series: [1, 2, 3, 4, 5] })) });
  net.answers.set(`/coach/school/${EMIS}/feature/lp`, grid());
  net.answers.set(`/coach/teacher/${EXT}/card`, teacherCard());
  net.answers.set(`/coach/teacher/${EXT}/items/dc`, DC_ITEMS);
  net.answers.set(`/coach/teacher/${EXT}/items/coach`, COACH_ITEMS);
  net.answers.set(`/coach/teacher/${EXT}/items/training`, TRAINING_ITEMS);
  net.answers.set(`/coach/teacher/${EXT}/reports`, REPORTS);
  net.answers.set(`/coach/teacher/${EXT}/reports?period=today`, NO_REPORTS);
  net.answers.set(`/coach/session/${SESSION}`, SESSION_REPORT);
}

const expectOnlyOpenLinks = (root: HTMLElement) => {
  const paths = linkPaths(root);
  const shut = paths.filter((p) => !coachPathReady(p, READY) || SHUT.some((s) => p === s || p.startsWith(`${s}/`)));
  expect(shut, `links the coach app would turn away: ${shut.join(", ")}`).toEqual([]);
};

beforeAll(async () => { await loadApp(); }, 120_000);
beforeEach(async () => { await resetAll(); });

describe("the gate and the menu", () => {
  it("a coach who opens a page that is not ready lands on the slim Home (it wins over COACHIP)", async () => {
    on();
    await renderApp("/portal/coach/insights");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/portal\/coach$/));
    await waitFor(() => expect(screen.getByTestId("coach-home-slim")).toBeInTheDocument());
  });

  it.each(SHUT)("%s stays shut", async (entry) => {
    on();
    await renderApp(entry);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/portal\/coach$/));
  });

  it("Home has the navy band and exactly two tiles: Training Library and My schools, with their counts", async () => {
    on();
    const { container } = await renderApp("/portal/coach");
    const tiles = await screen.findByTestId("feature-tiles");
    const links = within(tiles).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/portal/coach/training", "/portal/coach/people"]);
    await waitFor(() => expect(tiles).toHaveTextContent("2 courses"));
    await waitFor(() => expect(tiles).toHaveTextContent("1 school · 12 teachers"));
    expect(container.textContent).toContain("Salaam, Test Coach!");
    expectOnlyOpenLinks(container);
  });

  it("the menu is Home · Lesson Plans · More, with Home current on the School card pages", async () => {
    on();
    await renderApp(`/portal/coach/school/${EMIS}`);
    await screen.findByTestId("activity");
    const nav = screen.getByTestId("teacher-nav");
    const links = Array.from(nav.querySelectorAll("a"));
    expect(links.map((a) => a.textContent)).toEqual(["Home", "Lesson Plans", "More"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/portal/coach", "/portal/teacher/lessons", "/portal/coach/more"]);
    expect(links[0]).toHaveAttribute("aria-current", "page");
  });

  it("My schools is reached from Home: its crumb says Home", async () => {
    on();
    await renderApp("/portal/coach/people");
    await waitFor(() => expect(screen.getByTestId("page-crumb")).toHaveTextContent("Home"));
  });
});

describe("the School card", () => {
  it("This week: four tiles with the total, by N of M, about N a day, bars per school day with the days ahead dashed", async () => {
    on();
    const { container } = await renderApp(`/portal/coach/school/${EMIS}`);
    const lp = await screen.findByTestId("tile-lp");
    expect(lp).toHaveTextContent("27");
    expect(lp).toHaveTextContent("lesson plans");
    expect(lp).toHaveTextContent("by 8 of 12 teachers");
    expect(lp).toHaveTextContent("about 9 a day");
    expect(lp).toHaveAttribute("href", `/portal/coach/school/${EMIS}/feature/lp`);
    const bars = within(lp).getByTestId("bars-lp");
    expect(bars).toHaveAttribute("dir", "ltr");
    expect(Array.from(bars.querySelectorAll("[data-bar]")).map((b) => b.getAttribute("data-bar"))).toEqual(["count", "count", "count", "future", "future"]);
    expect(bars).toHaveTextContent(/Mon.*26.*Tue.*27.*Wed.*28.*Thu.*29.*Fri.*30/);
    // "less than 1 a day": 1 training part over 3 days
    expect(screen.getByTestId("tile-training")).toHaveTextContent("less than 1 a day");
    expect(screen.getByTestId("tile-training")).toHaveTextContent(/^1\s*training part(?!s)/);
    // a number that did not load is a dash, never 0, and has no rate
    const papers = screen.getByTestId("tile-papers");
    expect(within(papers).getByTestId("tile-total")).toHaveTextContent("—");
    expect(papers).not.toHaveTextContent("a day");
    // header chips
    expect(screen.getByTestId("card-emis")).toHaveTextContent(`EMIS ${EMIS}`);
    expect(screen.getByTestId("card-last-visit")).toHaveTextContent("Last visit · 1 day ago");
    expectOnlyOpenLinks(container);
  });

  it("Today: the total and by N of M only (no rate, no bars)", async () => {
    on();
    await renderApp(`/portal/coach/school/${EMIS}?period=today`);
    const lp = await screen.findByTestId("tile-lp");
    expect(lp).toHaveTextContent("8");
    expect(lp).toHaveTextContent("by 5 of 12 teachers");
    expect(lp).not.toHaveTextContent("a day");
    expect(within(lp).queryByTestId("bars-lp")).toBeNull();
    expect(lp).toHaveAttribute("href", `/portal/coach/school/${EMIS}/feature/lp?period=today`);
    expect(screen.getByRole("radio", { name: "Today" })).toHaveAttribute("aria-checked", "true");
  });

  it("the chips switch the period in place and the card asks for that period", async () => {
    on();
    await renderApp(`/portal/coach/school/${EMIS}`);
    await screen.findByTestId("tile-lp");
    await act(async () => { fireEvent.click(screen.getByRole("radio", { name: "This month" })); });
    await waitFor(() => expect(screen.getByTestId("bars-lp")).toHaveTextContent(/Wk 1.*28 Sep.*Wk 5.*26 Oct/));
    expect(net.calls).toContain(`/coach/school/${EMIS}/card?period=month`);
    expect(moves[moves.length - 1]).toBe(`/portal/coach/school/${EMIS}?period=month`);
  });

  it("teachers: four counts, last visit, Contribution %, ★ on the top two, no rank numbers", async () => {
    on();
    await renderApp(`/portal/coach/school/${EMIS}`);
    const list = await screen.findByTestId("card-teachers");
    const rows = within(list).getAllByTestId("card-teacher");
    expect(rows).toHaveLength(7);
    expect(within(list).getAllByTestId("top-contributor")).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Teacher Alpha");
    expect(rows[0]).toHaveTextContent("Top contributor");
    expect(rows[0]).toHaveAttribute("href", `/portal/coach/teacher/${EXT}`);
    expect(within(rows[0]).getByTestId("contribution").textContent).toMatch(/^\d+%$/);
    expect(rows[0].querySelectorAll("[data-count]")).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("Last visit · 1 day ago");
  });

  it("the ones with nothing this week sit in a neutral fold, closed, with no % and no red", async () => {
    on();
    await renderApp(`/portal/coach/school/${EMIS}`);
    const fold = await screen.findByTestId("nothing-fold");
    expect(fold).toHaveTextContent("Nothing this week");
    expect(within(fold).getByTestId("nothing-count")).toHaveTextContent("5");
    expect(within(fold).queryAllByTestId("card-teacher-none")).toHaveLength(0);
    await act(async () => { fireEvent.click(within(fold).getByRole("button")); });
    const rows = within(fold).getAllByTestId("card-teacher-none");
    expect(rows).toHaveLength(5);
    expect(fold.textContent).not.toMatch(/%/);
    expect(fold.innerHTML).not.toMatch(/#c8331f|#b42318|red/i);
    expect(rows[0].getAttribute("href")).toMatch(/^\/portal\/coach\/teacher\//);
  });

  it("search shows when there are more than 10 teachers and narrows both lists", async () => {
    on();
    await renderApp(`/portal/coach/school/${EMIS}`);
    const box = await screen.findByPlaceholderText("Teacher name");
    await act(async () => { fireEvent.change(box, { target: { value: "bravo" } }); });
    expect(within(screen.getByTestId("card-teachers")).getAllByTestId("card-teacher")).toHaveLength(1);
    expect(screen.queryByTestId("nothing-fold")).toBeNull();
    await act(async () => { fireEvent.change(box, { target: { value: "nobody" } }); });
    expect(screen.getByTestId("no-match")).toBeInTheDocument();
  });

  it("no search for 10 teachers or fewer", async () => {
    on();
    const small = schoolCard();
    net.answers.set(`/coach/school/${EMIS}/card`, { ...small, teachers: small.teachers.slice(0, 10) });
    await renderApp(`/portal/coach/school/${EMIS}`);
    await screen.findByTestId("card-teachers");
    expect(screen.queryByPlaceholderText("Teacher name")).toBeNull();
  });

  it("coach observations: count, trend, latest Coach score and change, information only", async () => {
    on();
    await renderApp(`/portal/coach/school/${EMIS}`);
    const obs = await screen.findByTestId("coach-obs");
    const rows = within(obs).getAllByTestId("coach-obs-row");
    expect(rows[0]).toHaveTextContent("Teacher Bravo");
    expect(rows[0]).toHaveTextContent("2 observations");
    expect(rows[0]).toHaveTextContent("71%");
    expect(rows[0].querySelector("[data-delta]")).toHaveAttribute("data-delta", "7");
    expect(obs.querySelectorAll("a")).toHaveLength(0);
    expect(screen.getByText("3 this week")).toBeInTheDocument();
  });

  it("keeps Manage; no Share button, no Schedule dock", async () => {
    on();
    const { container } = await renderApp(`/portal/coach/school/${EMIS}`);
    const manage = await screen.findByTestId("manage");
    expect(manage).toHaveTextContent("Add a teacher");
    expect(container.textContent).not.toMatch(/Share|Schedule/);
  });

  it("while the card loads: the frame and grey blocks; a failed read says so with Try again", async () => {
    on();
    net.answers.set(`/coach/school/${EMIS}/card`, new Error("down"));
    await renderApp(`/portal/coach/school/${EMIS}`);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Could not load/));
    expect(screen.getByRole("radiogroup", { name: "Period" })).toBeInTheDocument();
  });
});

describe("a feature by teacher", () => {
  it("a column per school day, a School row, zero rows grey at the bottom, days ahead dashed; a row opens her page", async () => {
    on();
    const { container } = await renderApp(`/portal/coach/school/${EMIS}/feature/lp`);
    const g = await screen.findByTestId("teacher-grid");
    expect(g).toHaveAttribute("dir", "ltr");
    const rows = within(g).getAllByTestId("grid-row");
    expect(rows).toHaveLength(12);
    const names = rows.map((r) => r.querySelector("span")?.textContent);
    expect(names.slice(0, 2)).toEqual(["Teacher Alpha", "Teacher Bravo"]);
    // the five with nothing come last, grey
    expect(rows.slice(7).every((r) => r.getAttribute("data-none") === "1")).toBe(true);
    expect(rows.slice(0, 7).some((r) => r.getAttribute("data-none") === "1")).toBe(false);
    expect(rows[0].querySelectorAll('[data-cell="future"]')).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("href", `/portal/coach/teacher/${EXT}`);
    expect(within(g).getByTestId("grid-school")).toHaveTextContent(/School\s*9\s*7\s*8\s*24/);
    expect(screen.getByTestId("grid-summary")).toHaveTextContent("24 lesson plans");
    expect(screen.getByTestId("grid-summary")).toHaveTextContent("by 7 of 12 teachers");
    expect(screen.getByTestId("grid-summary")).toHaveTextContent("about 8 a day");
    expect(screen.getByTestId("grid-ahead")).toHaveTextContent("Thu and Fri are still ahead");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Lesson plans by teacher");
    expectOnlyOpenLinks(container);
  });
});

describe("a teacher", () => {
  it("her tiles open her lists; AI score, Coach score and days are flat; the chart and Her coaching reports", async () => {
    on();
    const { container } = await renderApp(`/portal/coach/teacher/${EXT}`);
    const tiles = await screen.findByTestId("teacher-tiles");
    expect(screen.getByTestId("t-lp")).toHaveAttribute("href", `/portal/coach/teacher/${EXT}/items/lp`);
    expect(screen.getByTestId("t-papers")).toHaveAttribute("href", `/portal/coach/teacher/${EXT}/items/papers`);
    expect(screen.getByTestId("t-dc")).toHaveAttribute("href", `/portal/coach/teacher/${EXT}/items/dc`);
    expect(screen.getByTestId("t-coach")).toHaveAttribute("href", `/portal/coach/teacher/${EXT}/items/coach`);
    expect(screen.getByTestId("t-training")).toHaveAttribute("href", `/portal/coach/teacher/${EXT}/items/training`);
    for (const id of ["t-ai", "t-coach-score", "t-days"]) expect(screen.getByTestId(id).tagName).not.toBe("A");
    expect(screen.getByTestId("t-ai")).toHaveTextContent("61%");
    expect(screen.getByTestId("t-ai").querySelector("[data-delta]")).toHaveAttribute("data-delta", "4");
    // no coach score this period: a dash, never 0
    expect(screen.getByTestId("t-coach-score")).toHaveTextContent("—");
    expect(screen.getByTestId("t-days")).toHaveTextContent("of 3 school days");
    expect(screen.getByTestId("t-training")).toHaveTextContent("1 course done");
    expect(within(tiles).getByTestId("mini-lp")).toHaveAttribute("dir", "ltr");
    expect(screen.getByTestId("score-chart").querySelectorAll('[data-point="dc"]')).toHaveLength(2);
    expect(screen.getByTestId("score-chart").querySelectorAll('[data-point="coach"]')).toHaveLength(1);
    expect(screen.getByTestId("her-reports")).toHaveAttribute("href", `/portal/coach/teacher/${EXT}/reports`);
    expect(container.textContent).toContain("Only you see this");
    expect(container.textContent).not.toMatch(/Schedule/);
    expectOnlyOpenLinks(container);
  });

  it("a dot on the chart opens its DC report", async () => {
    on();
    await renderApp(`/portal/coach/teacher/${EXT}`);
    const chart = await screen.findByTestId("score-chart");
    await act(async () => { fireEvent.click(chart.querySelector('[data-point="dc"]') as Element); });
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(`/portal/coach/session/${SESSION}`));
  });
});

describe("her lists", () => {
  it("DC observations: each row opens the coach's DC report", async () => {
    on();
    const { container } = await renderApp(`/portal/coach/teacher/${EXT}/items/dc`);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("All DC Observations"));
    const list = await screen.findByTestId("her-items");
    const links = Array.from(list.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/portal/coach/session/s-101", `/portal/coach/session/${SESSION}`]);
    expect(list).toHaveTextContent("AI score 67%");
    expectOnlyOpenLinks(container);
  });

  it("Coach observations are information only; a field-form visit is counted, never scored with them", async () => {
    on();
    await renderApp(`/portal/coach/teacher/${EXT}/items/coach`);
    const list = await screen.findByTestId("her-items");
    expect(list.querySelectorAll("a")).toHaveLength(0);
    expect(list).toHaveTextContent("Coach score 60%");
    expect(list).toHaveTextContent("Field form");
    expect(list).not.toHaveTextContent("40%");
  });

  it("Training: courses, their parts and the day each was done", async () => {
    on();
    await renderApp(`/portal/coach/teacher/${EXT}/items/training`);
    const course = await screen.findByTestId("course");
    expect(course).toHaveTextContent("Course One");
    expect(course).toHaveTextContent("1 of 2 parts done");
    expect(course).toHaveTextContent("Not done");
  });
});

describe("her coaching reports", () => {
  it("the four blocks: what the Digital Coach told her, what went well, scores by report, coach visits", async () => {
    on();
    const { container } = await renderApp(`/portal/coach/teacher/${EXT}/reports`);
    const next = await screen.findByTestId("block-next-steps");
    expect(next).toHaveTextContent("What the Digital Coach told her");
    expect(next).toHaveTextContent("“Give students two minutes to talk in pairs.”");
    expect(Array.from(next.querySelectorAll("a")).map((a) => a.getAttribute("href"))).toEqual(["/portal/coach/session/s-101", `/portal/coach/session/${SESSION}`]);
    expect(screen.getByTestId("block-strengths")).toHaveTextContent("You showed halves by folding paper.");
    const scores = screen.getByTestId("block-scores");
    expect(within(scores).getAllByTestId("score-row")).toHaveLength(2);
    const coachRow = within(scores).getByTestId("score-row-coach");
    expect(coachRow).toHaveTextContent("Coach");
    expect(coachRow.tagName).not.toBe("A");
    expect(within(scores).getAllByTestId("score-row")[1]).toHaveTextContent("Not scored");
    expect(screen.getByTestId("section-key")).toHaveTextContent("B · Lesson Plan Fidelity");
    const visits = screen.getByTestId("block-visits");
    expect(visits).toHaveTextContent("Step agreed");
    expect(visits.querySelectorAll("a")).toHaveLength(0);
    expectOnlyOpenLinks(container);
  });

  it("an empty period says so", async () => {
    on();
    await renderApp(`/portal/coach/teacher/${EXT}/reports?period=today`);
    expect(await screen.findByTestId("no-reports")).toHaveTextContent("No reports today");
  });
});

describe("the coach's view of a DC report", () => {
  it("overall, what went well, next step, sections, every practice on its own scale, plan steps, reflection; no transcript, no Focus here", async () => {
    on();
    const { container } = await renderApp(`/portal/coach/session/${SESSION}`);
    await waitFor(() => expect(screen.getByTestId("overall")).toHaveTextContent("67%"));
    expect(screen.getByTestId("coach-view")).toBeInTheDocument();
    expect(screen.getByTestId("went-well")).toHaveTextContent("You explained halves and quarters correctly.");
    expect(screen.getByTestId("next-step")).toHaveTextContent("Give students two minutes to discuss in pairs.");
    const practices = screen.getAllByTestId("practice");
    expect(practices.map((p) => p.textContent)).toEqual([expect.stringContaining("B1"), expect.stringContaining("C1")]);
    expect(practices[0]).toHaveTextContent("2/2");
    expect(practices[1]).toHaveTextContent("1/2");
    expect(screen.getByTestId("not-scored")).toHaveTextContent("Not scored: F6");
    // the fidelity check's own verdicts: executed = Done, not_done = Skipped, not_adjudicable = Not scored (never a miss)
    const steps = screen.getAllByTestId("lp-step");
    expect(steps.map((s) => s.textContent)).toEqual([expect.stringContaining("Done"), expect.stringContaining("Skipped"), expect.stringContaining("Not scored")]);
    expect(steps[0]).toHaveTextContent("Warm-up");
    expect(steps[0]).toHaveTextContent("Ask the class to count to 20");
    expect(container.textContent).toContain("1 of 2 steps");
    expect(screen.getByTestId("reflection")).toHaveTextContent("The explanation went well.");
    expect(container.textContent).not.toMatch(/transcript|Focus here/i);
    expectOnlyOpenLinks(container);
  });

  it("no plan linked says so", async () => {
    on();
    net.answers.set(`/coach/session/${SESSION}`, { ...SESSION_REPORT, lpSteps: null });
    await renderApp(`/portal/coach/session/${SESSION}`);
    expect(await screen.findByTestId("no-plan")).toHaveTextContent("No lesson plan linked");
  });
});

describe("Urdu", () => {
  it("the School card reads right to left, its bars and grid stay left to right", async () => {
    on();
    await renderApp(`/portal/coach/school/${EMIS}`, "ur");
    const lp = await screen.findByTestId("tile-lp");
    expect(lp).toHaveTextContent("لیسن پلان");
    expect(lp).toHaveTextContent("12 میں سے 8 ٹیچرز نے");
    expect(lp).toHaveTextContent("روزانہ تقریباً 9");
    expect(within(lp).getByTestId("bars-lp")).toHaveAttribute("dir", "ltr");
    expect(within(lp).getByTestId("bars-lp")).toHaveTextContent("پیر");
    expect(screen.getByRole("radio", { name: "یہ ہفتہ" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("nothing-fold")).toHaveTextContent("اس ہفتے کچھ نہیں");
  });

  it("the grid keeps its columns left to right with Urdu labels", async () => {
    on();
    await renderApp(`/portal/coach/school/${EMIS}/feature/lp`, "ur");
    const g = await screen.findByTestId("teacher-grid");
    expect(g).toHaveAttribute("dir", "ltr");
    expect(within(g).getByTestId("grid-school")).toHaveTextContent("اسکول");
    expect(screen.getByTestId("grid-ahead")).toHaveTextContent("جمعرات اور جمعہ ابھی باقی ہیں");
  });
});
