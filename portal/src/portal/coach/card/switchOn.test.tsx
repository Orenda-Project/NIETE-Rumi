import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { linkPaths, loadApp, moves, net, renderApp, resetAll } from "./harness.testdata";
import { EMIS, EXT, MONTH, NO_SCORES, SESSION, SESSION_REPORT, TODAY, TRAINING_ITEMS, VISIT_REPORT, grid, schoolCard, schoolScores, teacherCard, teacherScores } from "./fixtures.testdata";
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
  net.answers.set(`/coach/teacher/${EXT}/card?period=month`, teacherCard(MONTH));
  net.answers.set(`/coach/teacher/${EXT}/items/training`, TRAINING_ITEMS);
  for (const kind of ["dc", "coach"] as const) {
    net.answers.set(`/coach/teacher/${EXT}/scores/${kind}`, teacherScores(kind));
    net.answers.set(`/coach/teacher/${EXT}/scores/${kind}?period=month`, teacherScores(kind, MONTH));
    net.answers.set(`/coach/teacher/${EXT}/scores/${kind}?period=today`, NO_SCORES(kind));
    net.answers.set(`/coach/school/${EMIS}/scores/${kind}`, schoolScores(kind));
  }
  net.answers.set("/coach/session/v-1", VISIT_REPORT);
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
  it("Digital Coaching and Coach observations come first: the average, a line of daily averages with the period's average dashed, N observations by N of M teachers", async () => {
    on();
    const { container } = await renderApp(`/portal/coach/school/${EMIS}`);
    const dc = await screen.findByTestId("score-tile-dc");
    expect(Array.from(screen.getByTestId("activity").children).map((c) => c.getAttribute("data-testid")))
      .toEqual(["score-tile-dc", "score-tile-coach", "tile-lp", "tile-papers", "tile-training"]);
    expect(dc).toHaveTextContent("Digital Coaching");
    expect(dc).toHaveTextContent("66%");
    expect(dc).toHaveTextContent("average AI score");
    expect(dc).toHaveTextContent("4 observations · by 3 of 12 teachers");
    expect(dc).toHaveAttribute("href", `/portal/coach/school/${EMIS}/feature/dc`);
    const line = within(dc).getByTestId("score-line");
    expect(line).toHaveAttribute("dir", "ltr");
    expect(line.querySelectorAll('[data-point="dot"]')).toHaveLength(3);
    expect(line.querySelector("[data-avg]")).toHaveAttribute("data-avg", "66");
    expect(line).toHaveTextContent(/Mon.*26.*Tue.*27.*Wed.*28.*Thu.*29.*Fri.*30/);
    const coach = screen.getByTestId("score-tile-coach");
    expect(coach).toHaveTextContent("Coach observations");
    expect(coach).toHaveTextContent("68%");
    expect(coach).toHaveTextContent("average Coach score");
    expect(coach).toHaveTextContent("2 observations · by 2 of 12 teachers");
    expect(coach).toHaveAttribute("href", `/portal/coach/school/${EMIS}/feature/coach`);
    // the two series differ by shape too: coach points are squares
    expect(within(coach).getByTestId("score-line").querySelectorAll('[data-point="square"]')).toHaveLength(2);
    // "Papers" reads "Assessments"; the old coach observations list is gone (the tile replaces it)
    expect(screen.getByTestId("tile-papers")).toHaveTextContent("assessments");
    expect(container.textContent).not.toMatch(/\bpapers?\b/i);
    expect(screen.queryByTestId("coach-obs")).toBeNull();
    expectOnlyOpenLinks(container);
  });

  it("This week: the count tiles keep the total, by N of M, about N a day, bars per school day with the days ahead dashed", async () => {
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
    // nothing yet today: a dash, never 0%, and no line
    const dc = screen.getByTestId("score-tile-dc");
    expect(dc).toHaveTextContent("—");
    expect(dc).toHaveTextContent("0 observations");
    expect(within(dc).queryByTestId("score-line")).toBeNull();
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
  it("a column per school day, a School row, zero rows grey at the bottom, days ahead dashed; a row opens her lesson plans", async () => {
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
    expect(rows[0]).toHaveAttribute("href", `/portal/coach/teacher/${EXT}/items/lp`);
    expect(within(g).getByTestId("grid-school")).toHaveTextContent(/School\s*9\s*7\s*8\s*24/);
    expect(screen.getByTestId("grid-summary")).toHaveTextContent("24 lesson plans");
    expect(screen.getByTestId("grid-summary")).toHaveTextContent("by 7 of 12 teachers");
    expect(screen.getByTestId("grid-summary")).toHaveTextContent("about 8 a day");
    expect(screen.getByTestId("grid-ahead")).toHaveTextContent("Thu and Fri are still ahead");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Lesson plans by teacher");
    expectOnlyOpenLinks(container);
  });

  // bd-dgfkgs.1 (operator, 30 Oct): a row opens HER list of that feature (her assessments, her training modules), never
  // her whole overview; Back returns to the list she came from, in the same period.
  it.each([
    ["lp", "Lesson plans by teacher", "All Lesson Plans", { items: [] }],
    ["papers", "Assessments by teacher", "All Assessments", { items: [] }],
    ["training", "Training parts by teacher", "Training", TRAINING_ITEMS],
  ] as const)("%s: a row opens her list of that feature; Back returns to the list", async (feature, heading, herTitle, items) => {
    on();
    net.answers.set(`/coach/school/${EMIS}/feature/${feature}?period=month`, { ...grid(MONTH), feature });
    net.answers.set(`/coach/teacher/${EXT}/items/${feature}?period=month`, items);
    await renderApp(`/portal/coach/school/${EMIS}/feature/${feature}?period=month`);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(heading));
    const row = (await screen.findAllByTestId("grid-row"))[0];
    expect(row).toHaveAttribute("href", `/portal/coach/teacher/${EXT}/items/${feature}?period=month`);
    await act(async () => { fireEvent.click(row); });
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(`/portal/coach/teacher/${EXT}/items/${feature}`));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(herTitle));
    expect(screen.getByTestId("page-crumb")).toHaveTextContent("Teacher Alpha");
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", `/portal/coach/school/${EMIS}/feature/${feature}?period=month`);
  });
});

describe("Digital Coaching and Coach observations by teacher", () => {
  it("Digital Coaching: the school's average, a row per teacher with her count, a tiny line and her average; zero rows grey; a row opens her Digital Coaching page", async () => {
    on();
    const { container } = await renderApp(`/portal/coach/school/${EMIS}/feature/dc`);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Digital Coaching by teacher"));
    expect(screen.getByTestId("page-crumb")).toHaveTextContent("Model School Nine");
    const sum = await screen.findByTestId("scores-summary");
    expect(sum).toHaveTextContent("69%");
    expect(sum).toHaveTextContent("average AI score");
    expect(sum).toHaveTextContent("3 observations · by 2 of 3 teachers");
    expect(screen.getByTestId("scores-heads")).toHaveTextContent(/Teacher.*Scores.*Average/);
    const rows = screen.getAllByTestId("score-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Teacher Alpha");
    expect(rows[0]).toHaveTextContent("2 observations");
    expect(rows[0]).toHaveTextContent("68%");
    expect(rows[0]).toHaveAttribute("href", `/portal/coach/teacher/${EXT}/dc`);
    expect(rows[0].querySelectorAll('[data-point="dot"]')).toHaveLength(2);
    expect(rows[2]).toHaveAttribute("data-none", "1");
    expect(rows[2]).toHaveTextContent("0 observations");
    expect(rows[2]).toHaveTextContent("—");
    expect(container.textContent).toContain("Only you see this");
    expectOnlyOpenLinks(container);
  });

  it("Coach observations: the same page with the Coach score; its rows open her Coach observations page", async () => {
    on();
    await renderApp(`/portal/coach/school/${EMIS}/feature/coach`);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Coach observations by teacher"));
    expect(await screen.findByTestId("scores-summary")).toHaveTextContent("average Coach score");
    const rows = screen.getAllByTestId("score-row");
    expect(rows[0]).toHaveAttribute("href", `/portal/coach/teacher/${EXT}/observations`);
    expect(rows[0].querySelectorAll('[data-point="square"]')).toHaveLength(2);
  });

  // bd-dgfkgs.1: like the three count lists, Back from her page returns to the list she was opened from.
  it.each([["dc", "dc"], ["coach", "observations"]] as const)("%s by teacher: her page's Back returns to the list", async (kind, page) => {
    on();
    await renderApp(`/portal/coach/school/${EMIS}/feature/${kind}`);
    const row = (await screen.findAllByTestId("score-row"))[0];
    await act(async () => { fireEvent.click(row); });
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(`/portal/coach/teacher/${EXT}/${page}`));
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", `/portal/coach/school/${EMIS}/feature/${kind}`);
  });
});

describe("a teacher", () => {
  it("Digital Coaching and Coach observations first (average, a small line, the count), then lesson plans, assessments, training and days used", async () => {
    on();
    const { container } = await renderApp(`/portal/coach/teacher/${EXT}`);
    const tiles = await screen.findByTestId("teacher-tiles");
    expect(Array.from(tiles.children).map((c) => c.getAttribute("data-testid"))).toEqual(["t-dc", "t-coach", "t-lp", "t-papers", "t-training", "t-days"]);
    const dc = screen.getByTestId("t-dc");
    expect(dc).toHaveAttribute("href", `/portal/coach/teacher/${EXT}/dc`);
    expect(dc).toHaveTextContent("61%");
    expect(dc).toHaveTextContent("Digital Coaching");
    expect(dc).toHaveTextContent("AI score · 2 observations");
    expect(within(dc).getByTestId("score-line").querySelectorAll('[data-point="dot"]')).toHaveLength(2);
    const coach = screen.getByTestId("t-coach");
    expect(coach).toHaveAttribute("href", `/portal/coach/teacher/${EXT}/observations`);
    expect(coach).toHaveTextContent("60%");
    expect(coach).toHaveTextContent("Coach observations");
    expect(coach).toHaveTextContent("Coach score · 2 observations");
    expect(within(coach).getByTestId("score-line").querySelectorAll('[data-point="square"]')).toHaveLength(1);
    expect(screen.getByTestId("t-lp")).toHaveAttribute("href", `/portal/coach/teacher/${EXT}/items/lp`);
    expect(screen.getByTestId("t-papers")).toHaveTextContent("Assessments");
    expect(screen.getByTestId("t-papers")).toHaveAttribute("href", `/portal/coach/teacher/${EXT}/items/papers`);
    expect(screen.getByTestId("t-training")).toHaveTextContent("1 course done");
    // days used: one dot per school day, filled = used, dashed = still ahead; under them, how many of those days each
    // instrument was used on, and the tile opens her days (bd-dgfkgs.4)
    const days = screen.getByTestId("t-days");
    expect(days.tagName).toBe("A");
    expect(days).toHaveAttribute("href", `/portal/coach/teacher/${EXT}/days`);
    expect(days).toHaveTextContent("2/3");
    expect(days).toHaveTextContent("days used");
    const kinds = Array.from(days.querySelectorAll("[data-day]")).map((d) => d.getAttribute("data-day"));
    expect(kinds).toEqual(["used", "empty", "used", "future", "future"]);
    expect(Array.from(days.querySelectorAll("[data-count]")).map((c) => `${c.getAttribute("data-count")} ${c.textContent}`))
      .toEqual(["lp 2", "dc 1", "training 1", "papers 1"]);
    for (const id of ["coaching-card", "her-reports", "score-chart"]) expect(screen.queryByTestId(id)).toBeNull();
    expect(container.textContent).not.toMatch(/Her coaching reports|Days with any NIETE use|Papers made/);
    expectOnlyOpenLinks(container);
  });

  it("This month: days used is a Monday-to-Friday calendar of the month", async () => {
    on();
    await renderApp(`/portal/coach/teacher/${EXT}?period=month`);
    const days = await screen.findByTestId("t-days");
    expect(days).toHaveTextContent("2/20");
    const kinds = Array.from(days.querySelectorAll("[data-day]")).map((d) => d.getAttribute("data-day"));
    expect(kinds.filter((k) => k === "used")).toHaveLength(2);
    expect(kinds.filter((k) => k === "empty")).toHaveLength(18);
    expect(kinds.filter((k) => k === "future")).toHaveLength(2);
    expect(kinds.filter((k) => k === "blank")).toHaveLength(3);
  });
});

describe("her days (bd-dgfkgs.4)", () => {
  it("each day she used NIETE, newest first, with what she used that day; Back returns to her page", async () => {
    on();
    const { container } = await renderApp(`/portal/coach/teacher/${EXT}`);
    await act(async () => { fireEvent.click(await screen.findByTestId("t-days")); });
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(`/portal/coach/teacher/${EXT}/days`));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Days used"));
    expect(screen.getByTestId("page-crumb")).toHaveTextContent("Teacher Alpha");
    const rows = await screen.findAllByTestId("used-day");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Today");
    expect(Array.from(rows[0].querySelectorAll("[data-feature]")).map((f) => f.textContent)).toEqual(["Lesson plans", "Training parts"]);
    expect(rows[1]).toHaveTextContent("Mon 26 Oct");
    expect(Array.from(rows[1].querySelectorAll("[data-feature]")).map((f) => f.textContent)).toEqual(["Lesson plans", "Digital Coaching", "Assessments"]);
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", `/portal/coach/teacher/${EXT}`);
    expectOnlyOpenLinks(container);
  });

  it("a period with no use says so", async () => {
    on();
    net.answers.set(`/coach/teacher/${EXT}/card?period=today`, { ...teacherCard(TODAY), tiles: { ...teacherCard(TODAY).tiles, days: { withUse: 0, schoolDays: 1, used: [], uses: [], perFeature: { lp: 0, dc: 0, training: 0, papers: 0 } } } });
    await renderApp(`/portal/coach/teacher/${EXT}/days?period=today`);
    expect(await screen.findByTestId("empty")).toHaveTextContent("Nothing today");
  });
});

describe("her lists", () => {
  it("Training: courses, their parts and the day each was done", async () => {
    on();
    await renderApp(`/portal/coach/teacher/${EXT}/items/training`);
    const course = await screen.findByTestId("course");
    expect(course).toHaveTextContent("Course One");
    expect(course).toHaveTextContent("1 of 2 parts done");
    expect(course).toHaveTextContent("Not done");
  });

  it.each([
    [`/portal/coach/teacher/${EXT}/reports`, "dc", ""],
    [`/portal/coach/teacher/${EXT}/reports?period=month`, "dc", "?period=month"],
    [`/portal/coach/teacher/${EXT}/items/dc`, "dc", ""],
    [`/portal/coach/teacher/${EXT}/items/coach?period=today`, "observations", "?period=today"],
    [`/portal/coach/teacher/${EXT}/coaching`, "dc", ""],
    [`/portal/coach/teacher/${EXT}/coaching?period=month&show=coach`, "observations", "?period=month"],
  ])("the old address %s opens her %s page (nothing 404s)", async (entry, page, search) => {
    on();
    await renderApp(entry);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(`/portal/coach/teacher/${EXT}/${page}`));
    expect(screen.getByTestId("where")).toHaveAttribute("data-search", search);
  });
});

describe("her Digital Coaching page", () => {
  it("the average and its change, the detailed graph with the average dashed; each dot opens its report", async () => {
    on();
    const { container } = await renderApp(`/portal/coach/teacher/${EXT}/dc`);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Digital Coaching$/));
    expect(screen.getByTestId("page-crumb")).toHaveTextContent("Teacher Alpha");
    const sum = await screen.findByTestId("scores-summary");
    expect(sum).toHaveTextContent("63%");
    expect(sum).toHaveTextContent("average AI score");
    expect(sum).toHaveTextContent("2 observations");
    expect(sum.querySelector("[data-delta]")).toHaveAttribute("data-delta", "6");
    const chart = within(sum).getByTestId("detail-chart");
    expect(chart).toHaveTextContent("Avg 63%");
    const dots = chart.querySelectorAll('[data-point="dot"]');
    expect(dots).toHaveLength(2);
    expect(container.textContent).toContain("Tap a dot to open its report");
    await act(async () => { fireEvent.click(dots[0]); });
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(`/portal/coach/session/${SESSION}`));
  });

  it("Average by practice: every section with its average out of the framework's scale, B scored in 1 of 2, each practice with a segmented bar", async () => {
    on();
    await renderApp(`/portal/coach/teacher/${EXT}/dc`);
    await screen.findByTestId("scores-summary");
    expect(screen.getByTestId("practices-head")).toHaveTextContent("Average by practice");
    expect(screen.getByTestId("practices-head")).toHaveTextContent("Across her 2 reports · out of 2");
    const sections = screen.getAllByTestId("practice-section");
    expect(sections.map((x) => x.getAttribute("data-code"))).toEqual(["B", "C", "D", "F"]);
    // bd-dgfkgs.2 (operator, 30 Oct): every domain starts closed; she taps one to see its practices
    for (const s of sections) {
      expect(within(s).getByRole("button")).toHaveAttribute("aria-expanded", "false");
      expect(within(s).queryAllByTestId("practice-row")).toHaveLength(0);
    }
    await act(async () => { fireEvent.click(within(sections[1]).getByRole("button")); });
    expect(within(sections[1]).getByRole("button")).toHaveAttribute("aria-expanded", "true");
    expect(within(sections[2]).queryAllByTestId("practice-row")).toHaveLength(0);
    const c1 = within(sections[1]).getAllByTestId("practice-row")[0];
    expect(c1).toHaveTextContent("C1");
    expect(c1).toHaveTextContent("Quality Questioning (Bloom's Aligned)");
    expect(c1).toHaveTextContent("1.4/2");
    expect(c1.querySelectorAll("[data-seg]")).toHaveLength(2);
    expect(sections[1]).toHaveTextContent("1.2/2");
    expect(sections[1]).not.toHaveTextContent("Scored in");
    await act(async () => { fireEvent.click(within(sections[1]).getByRole("button")); });
    expect(within(sections[1]).queryAllByTestId("practice-row")).toHaveLength(0);
  });

  // bd-dgfkgs.3 (operator, 30 Oct: "moves for both, DC and HITL"): B is the plan steps, never B1-B10
  it("Lesson Plan Fidelity: the share of plan steps followed, and each of the five steps when opened; no B1-B10", async () => {
    on();
    const { container } = await renderApp(`/portal/coach/teacher/${EXT}/dc`);
    await screen.findByTestId("scores-summary");
    const b = screen.getAllByTestId("practice-section")[0];
    expect(b).toHaveTextContent("Lesson Plan Fidelity");
    expect(b).toHaveTextContent("75%");
    expect(b).toHaveTextContent("Scored in 1 of 2 (the others had no lesson plan)");
    expect(within(b).getByRole("button")).toHaveAttribute("aria-expanded", "false");
    expect(within(b).queryAllByTestId("plan-step")).toHaveLength(0);
    await act(async () => { fireEvent.click(within(b).getByRole("button")); });
    const steps = within(b).getAllByTestId("plan-step");
    expect(steps.map((s) => s.textContent)).toEqual([
      expect.stringMatching(/^Opening.*2 of 2 steps/),
      expect.stringMatching(/^Explanation.*1 of 1 steps/),
      expect.stringMatching(/^We Do.*0 of 1 steps/),
      expect.stringMatching(/^You Do.*1 of 1 steps/),
      expect.stringMatching(/^Check.*0 of 1 steps/),
    ]);
    expect(steps.map((s) => s.getAttribute("data-tone"))).toEqual(["done", "done", "partly", "done", "skipped"]);
    expect(container.textContent).not.toMatch(/\bB\d+\b/);
  });

  it("her reports: the grade-subject tile, the title (topic, else the subject's lesson), the day, the AI score; each opens its report", async () => {
    on();
    const { container } = await renderApp(`/portal/coach/teacher/${EXT}/dc`);
    await screen.findByTestId("scores-summary");
    expect(screen.getByTestId("reports-head")).toHaveTextContent("Her reports");
    const rows = screen.getAllByTestId("report-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByTestId("history-lead")).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent("Math lesson");
    expect(rows[0]).toHaveTextContent("Today");
    expect(rows[0]).toHaveTextContent("AI score 67%");
    expect(rows[0]).toHaveAttribute("href", "/portal/coach/session/s-101");
    expect(rows[1]).toHaveTextContent("Types of Fractions");
    expect(rows[1]).toHaveTextContent("Mon 26 Oct");
    expect(container.textContent).toContain("Only you see this");
    expectOnlyOpenLinks(container);
  });

  it("an empty period says so: no graph, no practices", async () => {
    on();
    await renderApp(`/portal/coach/teacher/${EXT}/dc?period=today`);
    expect(await screen.findByTestId("no-observations")).toHaveTextContent("No DC observations today");
    expect(screen.queryByTestId("detail-chart")).toBeNull();
    expect(screen.queryAllByTestId("practice-section")).toHaveLength(0);
  });
});

describe("her Coach observations page", () => {
  it("squares and the Coach score, B Not scored, her observations each open the coach's report; a field-form visit says so", async () => {
    on();
    const { container } = await renderApp(`/portal/coach/teacher/${EXT}/observations`);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Coach observations$/));
    const sum = await screen.findByTestId("scores-summary");
    expect(sum).toHaveTextContent("60%");
    expect(sum).toHaveTextContent("average Coach score");
    expect(sum).toHaveTextContent("2 observations");
    expect(within(sum).getByTestId("detail-chart").querySelectorAll('[data-point="square"]')).toHaveLength(1);
    // the practices are averaged across her scored observations only: the field-form visit is not one of them
    expect(screen.getByTestId("practices-head")).toHaveTextContent("Across her 1 observation · out of 2");
    const b = screen.getAllByTestId("practice-section")[0];
    expect(b).toHaveTextContent("Not scored");
    expect(b).toHaveTextContent("No lesson plan linked, so this section was not scored");
    // nothing to open, so nothing that looks tappable
    expect(within(b).queryByRole("button")).toBeNull();
    expect(screen.getByTestId("reports-head")).toHaveTextContent("Her observations");
    const rows = screen.getAllByTestId("report-row");
    expect(rows[0]).toHaveTextContent("Unitary Method");
    expect(rows[0]).toHaveTextContent("Yesterday · Coach Zulu");
    expect(rows[0]).toHaveTextContent("Coach score 60%");
    expect(rows[0]).toHaveAttribute("href", "/portal/coach/session/v-1");
    expect(rows[1]).toHaveTextContent("Field form");
    expect(rows[1]).toHaveTextContent("Eng lesson");
    expect(container.textContent).not.toMatch(/\bvisits?\b/i);
    expectOnlyOpenLinks(container);
  });

  it("a coach observation opens in the coach's report view: the Coach score, her coach, the step agreed; Back returns to her Coach observations", async () => {
    on();
    await renderApp("/portal/coach/session/v-1");
    await waitFor(() => expect(screen.getByTestId("overall")).toHaveTextContent("60%"));
    expect(screen.getByTestId("overall").parentElement).toHaveTextContent("Coach score");
    expect(screen.getByTestId("report-coach")).toHaveTextContent("Coach Zulu");
    expect(screen.getByTestId("next-step").previousElementSibling).toHaveTextContent("Step agreed");
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", `/portal/coach/teacher/${EXT}/observations`);
  });

  it("the DC report's Back returns to her Digital Coaching page", async () => {
    on();
    await renderApp(`/portal/coach/session/${SESSION}`);
    await waitFor(() => expect(screen.getByTestId("overall")).toHaveTextContent("67%"));
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", `/portal/coach/teacher/${EXT}/dc`);
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
    // B is its plan steps below, never B1-B10 here (bd-dgfkgs.3)
    const practices = screen.getAllByTestId("practice");
    expect(practices.map((p) => p.textContent)).toEqual([expect.stringContaining("C1")]);
    expect(practices[0]).toHaveTextContent("1/2");
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

  it("her Digital Coaching page in Urdu: the average, the graph left to right, the subject's lesson as a title", async () => {
    on();
    await renderApp(`/portal/coach/teacher/${EXT}/dc`, "ur");
    const sum = await screen.findByTestId("scores-summary");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("ڈیجیٹل کوچنگ");
    expect(sum).toHaveTextContent("اوسط اے آئی اسکور");
    expect(within(sum).getByTestId("detail-chart")).toHaveAttribute("dir", "ltr");
    expect(screen.getAllByTestId("report-row")[0]).toHaveTextContent("ریاضی کا سبق");
    expect(screen.getByTestId("practices-head")).toHaveTextContent("ہر طریقے کا اوسط");
  });

  it("the School card's score tiles in Urdu", async () => {
    on();
    await renderApp(`/portal/coach/school/${EMIS}`, "ur");
    const dc = await screen.findByTestId("score-tile-dc");
    expect(dc).toHaveTextContent("ڈیجیٹل کوچنگ");
    expect(dc).toHaveTextContent("اوسط اے آئی اسکور");
    expect(screen.getByTestId("score-tile-coach")).toHaveTextContent("کوچ کے مشاہدات");
    expect(within(dc).getByTestId("score-line")).toHaveAttribute("dir", "ltr");
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
