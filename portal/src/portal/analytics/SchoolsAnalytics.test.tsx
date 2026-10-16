import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { fixtureCoaching, fixtureLpEngagement, fixtureObservations, fixtureResponse, REGION_ORDER } from "./fixtures";
import { fixtureTrainingLevels } from "./trainingLevelsFixture";
import { sortSchools } from "./table";
import { SchoolsList } from "./SchoolsList";
import { analyticsCopy } from "./copy";

/**
 * bd-97x22y.2 — the schools analytics page in the ICT dashboard's structure (PLAN v6): six tabs (a sidebar on a
 * desktop, a scrolling tab row on a phone), each deep-linkable at /portal/analytics/schools/<tab>, the region and
 * the period kept in the address across tabs, sector cards that open a school breakdown in place.
 *
 * The numbers are v5's (bd-s6qbts.3), from the same answer: counts with "x of N teachers", n < 3 muted, no score
 * "—", "logged since 4 Oct". Scores (FICO / HITL) are the ONLY values shown with a % (operator, 2026-10-14:
 * "scores as %, usage as counts"). Coaching comes from its own endpoint (PLAN v6 §3).
 */
const h = vi.hoisted(() => ({
  getSchools: vi.fn(),
  getCoaching: vi.fn(),
  // bd-97x22y.4 — the Trainings tab's own read (views/TrainingTab.test.tsx covers the tab)
  getTrainingLevels: vi.fn(),
  getObservations: vi.fn(),
  getLpEngagement: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    user: { firstName: "FDE Islamabad", lastName: null, phoneNumber: "923000000000", role: "unregistered", analyticsOnly: true },
    loading: false,
    logout: h.logout,
  }),
}));
vi.mock("../services/api", async (orig) => ({
  ...(await orig<typeof import("../services/api")>()),
  analytics: { getSchools: h.getSchools, getCoaching: h.getCoaching, getLpEngagement: h.getLpEngagement },
  trainingLevelsAnalytics: { get: h.getTrainingLevels },
  observationsAnalytics: { get: h.getObservations },
}));

import SchoolsAnalytics from "./SchoolsAnalytics";

type Params = { from?: string | null; to?: string | null; region?: string | null };

function setWidth(px: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: px });
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: /max-width:\s*(\d+)px/.test(q) ? px <= Number(RegExp.$1) : false,
    media: q, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{`${pathname}${search}`}</p>;
}

/** `rest` is what follows /portal/analytics/schools: "", "/lp", "/lp?region=B.K", "?period=all", … */
function renderPage(rest = "") {
  return render(
    <MemoryRouter initialEntries={[`/portal/analytics/schools${rest}`]}>
      <Routes>
        <Route path="/portal/analytics/schools/:tab?" element={<SchoolsAnalytics />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const SIX = [...REGION_ORDER];
const TAB_LABELS = ["Overview", "LP Engagement", "Trainings", "Observations", "Coaching", "Information"];
const TAB_IDS = ["overview", "lp", "training", "observations", "coaching", "info"];
const rowNames = () => screen.getAllByTestId("school-row").map((r) => within(r).getByTestId("school-name").textContent);
const eyebrows = () => screen.getAllByTestId("eyebrow").map((e) => e.textContent);
const testIds = (prefix: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll(`[data-testid^="${prefix}"]`)).map((el) => el.getAttribute("data-testid")!.slice(prefix.length));
const where = () => screen.getByTestId("where").textContent;
const sidebar = () => screen.getByTestId("analytics-sidebar");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T09:00:00+05:00"));
  setWidth(1440);
  h.getSchools.mockImplementation(async (p: Params) => fixtureResponse(p));
  h.getCoaching.mockImplementation(async (p: Params) => fixtureCoaching(p));
  h.getLpEngagement.mockImplementation(async (p: { from?: string | null; to?: string | null; region?: string | null; band?: "primary" | "midhigh" }) => fixtureLpEngagement(p));
  h.getTrainingLevels.mockImplementation(async (p: { region: string | null; band: "primary" | "midhigh" }) => fixtureTrainingLevels(p));
  h.getObservations.mockImplementation(async (p: Params) => fixtureObservations(p));
});
afterEach(() => vi.useRealTimers());

describe("loading the page", () => {
  it("asks for this month, all regions, by default", async () => {
    renderPage();
    await screen.findByTestId("tile-schools");
    expect(h.getSchools).toHaveBeenCalledWith({ from: "2026-10-01", to: "2026-10-13", region: "all" });
  });

  it("a window and region in the address are what it asks for", async () => {
    renderPage("/lp?from=2026-09-01&to=2026-09-30&region=Sihala");
    await screen.findByTestId("tile-lpOverall");
    expect(h.getSchools).toHaveBeenCalledWith({ from: "2026-09-01", to: "2026-09-30", region: "Sihala" });
  });

  it("All time asks with no window", async () => {
    renderPage();
    await screen.findByTestId("tile-schools");
    await userEvent.setup().click(screen.getByTestId("analytics-all-time"));
    await waitFor(() => expect(h.getSchools).toHaveBeenLastCalledWith({ from: null, to: null, region: "all" }));
  });

  it("the period presets set the window", async () => {
    renderPage();
    await screen.findByTestId("tile-schools");
    await userEvent.setup().click(screen.getByTestId("period-year"));
    await waitFor(() => expect(h.getSchools).toHaveBeenLastCalledWith({ from: "2026-01-01", to: "2026-10-13", region: "all" }));
    expect(screen.getByTestId("period-year")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("period-month")).toHaveAttribute("aria-pressed", "false");
  });

  it("an account the server turns away is told so, with no numbers", async () => {
    h.getSchools.mockRejectedValue({ response: { status: 403 } });
    renderPage();
    expect(await screen.findByTestId("analytics-forbidden")).toBeInTheDocument();
    expect(screen.queryByTestId("tile-schools")).toBeNull();
  });

  it("a failed read says so, with no numbers", async () => {
    h.getSchools.mockRejectedValue({ response: { status: 500 } });
    renderPage("/lp");
    expect(await screen.findByTestId("analytics-error")).toBeInTheDocument();
    expect(screen.queryByTestId("tile-lpOverall")).toBeNull();
  });
});

describe("the frame: six tabs, her order", () => {
  it("a desktop sidebar lists the six tabs in the ICT dashboard's order", async () => {
    renderPage();
    await screen.findByTestId("tile-schools");
    expect(within(sidebar()).getAllByRole("link").map((a) => a.textContent)).toEqual(TAB_LABELS);
    expect(sidebar().className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(sidebar().className).toMatch(/(^|\s)lg:flex(\s|$)/);
  });

  it("a phone gets the same six in a tab row that scrolls sideways on its own (the page never does)", async () => {
    renderPage();
    await screen.findByTestId("tile-schools");
    const row = screen.getByTestId("analytics-tabrow");
    expect(row.className).toMatch(/(^|\s)lg:hidden(\s|$)/);
    expect(within(row).getAllByRole("link").map((a) => a.textContent)).toEqual(TAB_LABELS);
    const scroller = within(row).getAllByRole("link")[0].parentElement!;
    expect(scroller.className).toMatch(/overflow-x-auto/);
  });

  it.each([
    ["", "Overview", "overview"],
    ["/overview", "Overview", "overview"],
    ["/lp", "LP Engagement", "lp"],
    ["/training", "Trainings", "training"],
    ["/observations", "Observations", "observations"],
    ["/coaching", "Coaching", "coaching"],
    ["/info", "Information", "info"],
  ])("/portal/analytics/schools%s opens %s", async (rest, title, id) => {
    renderPage(rest);
    expect(await screen.findByTestId("tab-title")).toHaveTextContent(title);
    expect(within(sidebar()).getByTestId(`tab-link-${id}`)).toHaveAttribute("aria-current", "page");
    expect(within(screen.getByTestId("analytics-tabrow")).getByTestId(`tabrow-link-${id}`)).toHaveAttribute("aria-current", "page");
    for (const other of TAB_IDS.filter((t) => t !== id)) {
      expect(within(sidebar()).getByTestId(`tab-link-${other}`)).not.toHaveAttribute("aria-current");
    }
  });

  it("an unknown tab opens the Overview, keeping the region and the period", async () => {
    renderPage("/bogus?region=B.K&from=2026-09-01&to=2026-09-30");
    expect(await screen.findByTestId("tab-title")).toHaveTextContent("Overview");
    expect(where()).toBe("/portal/analytics/schools?region=B.K&from=2026-09-01&to=2026-09-30");
  });

  it("the region and the period go with her to every tab, and the numbers are not read again", async () => {
    renderPage("/lp?from=2026-09-01&to=2026-09-30&region=Sihala");
    await screen.findByTestId("tile-lpOverall");
    const search = "?from=2026-09-01&to=2026-09-30&region=Sihala";
    TAB_IDS.forEach((id) => {
      const href = within(sidebar()).getByTestId(`tab-link-${id}`).getAttribute("href");
      expect(href).toBe(`/portal/analytics/schools${id === "overview" ? "" : `/${id}`}${search}`);
    });
    await userEvent.setup().click(within(sidebar()).getByTestId("tab-link-training"));
    expect(await screen.findByTestId("level-card-0")).toBeInTheDocument();
    expect(where()).toBe(`/portal/analytics/schools/training${search}`);
    expect(screen.getByTestId("region-chip-Sihala")).toHaveAttribute("aria-pressed", "true");
    expect(h.getSchools).toHaveBeenCalledTimes(1);
  });

  it("choosing a region or a period on a tab stays on that tab", async () => {
    renderPage("/training");
    await screen.findByTestId("level-card-0");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("region-chip-B.K"));
    await waitFor(() => expect(where()).toMatch(/^\/portal\/analytics\/schools\/training\?/));
    expect(where()).toMatch(/region=B\.K/);
    await user.click(screen.getByTestId("period-year"));
    await waitFor(() => expect(where()).toMatch(/from=2026-01-01/));
    expect(where()).toMatch(/^\/portal\/analytics\/schools\/training\?/);
  });

  it("the frame's menus hold the six tabs and nothing else; Log out logs out", async () => {
    renderPage();
    await screen.findByTestId("tile-schools");
    const links = screen.getAllByRole("navigation").flatMap((n) => within(n).queryAllByRole("link")).map((a) => a.getAttribute("href"));
    expect(new Set(links)).toEqual(new Set(TAB_IDS.map((id) => `/portal/analytics/schools${id === "overview" ? "" : `/${id}`}`)));
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Log out" })[0]);
    expect(h.logout).toHaveBeenCalled();
  });
});

describe("the region filter", () => {
  it("every region is a chip with its school count", async () => {
    renderPage();
    await screen.findByTestId("tile-schools");
    expect(screen.getByTestId("region-chip-all")).toHaveTextContent("All regions16");
    expect(screen.getByTestId("region-chip-all")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("region-chip-Urban-I")).toHaveTextContent("Urban-I5");
  });

  it("only the six ICT regions, no Unassigned anywhere (bd-s6qbts.4)", async () => {
    renderPage("/lp");
    await screen.findByTestId("sector-card-B.K");
    expect(testIds("region-chip-")).toEqual(["all", ...SIX]);
    expect(testIds("sector-card-")).toEqual(SIX);
    expect(document.body.textContent).not.toMatch(/unassigned/i);
  });

  it("an old ?region=Unassigned link is asked for as written, and the server's refusal is shown", async () => {
    h.getSchools.mockRejectedValue({ response: { status: 400 } });
    renderPage("?region=Unassigned");
    expect(await screen.findByTestId("analytics-error")).toBeInTheDocument();
    expect(h.getSchools).toHaveBeenCalledWith({ from: "2026-10-01", to: "2026-10-13", region: "Unassigned" });
  });

  it("the scope line names the region, schools and window", async () => {
    renderPage();
    expect(await screen.findByTestId("scope-line")).toHaveTextContent("All regions · 16 schools · 1 Oct – 13 Oct 2026");
  });

  it("the Information tab has no filter bar: it has no numbers", async () => {
    renderPage("/info");
    await screen.findByTestId("how-counted");
    expect(screen.queryByTestId("region-chip-all")).toBeNull();
    expect(screen.queryByTestId("period-month")).toBeNull();
  });
});

describe("Overview", () => {
  it("her sections, in her order: Schools, Teachers, Performance snapshot, Scores, Coaching (no Top performers until v7)", async () => {
    renderPage();
    await screen.findByTestId("tile-coaches");
    expect(eyebrows()).toEqual(["Schools", "Teachers", "Performance snapshot", "Scores", "Coaching"]);
    expect(document.body.textContent).not.toMatch(/top performer/i);
  });

  it("the tiles, in order", async () => {
    renderPage();
    await screen.findByTestId("tile-coaches");
    expect(testIds("tile-")).toEqual([
      "schools", "teachers", "lpsOpened", "dcObservations", "humanObservations", "trainingModules", "avgFico", "avgHitl", "coaches", "coachVisits",
    ]);
  });

  it("counts with x of N teachers, the same numbers as v5", async () => {
    renderPage();
    await screen.findByTestId("tile-schools");
    expect(screen.getByTestId("tile-schools")).toHaveTextContent("16");
    expect(screen.getByTestId("tile-schools")).toHaveTextContent("Total schools");
    expect(screen.getByTestId("tile-teachers")).toHaveTextContent("442");
    expect(screen.getByTestId("tile-lpsOpened")).toHaveTextContent("661");
    expect(screen.getByTestId("tile-lpsOpened")).toHaveTextContent("185 of 442 teachers");
    expect(screen.getByTestId("tile-dcObservations")).toHaveTextContent("188");
    expect(screen.getByTestId("tile-dcObservations")).toHaveTextContent("93 of 442 teachers");
    expect(screen.getByTestId("tile-humanObservations")).toHaveTextContent("77");
    expect(screen.getByTestId("tile-trainingModules")).toHaveTextContent("322");
    expect(screen.getByTestId("tile-trainingModules")).toHaveTextContent("145 of 442 teachers");
  });

  it("scores as a percentage with how many were scored", async () => {
    renderPage();
    await screen.findByTestId("tile-avgFico");
    expect(screen.getByTestId("tile-avgFico")).toHaveTextContent("64.8%");
    expect(screen.getByTestId("tile-avgFico")).toHaveTextContent("188 scored");
    expect(screen.getByTestId("tile-avgHitl")).toHaveTextContent("57.1%");
    expect(screen.getByTestId("tile-avgHitl")).toHaveTextContent("77 scored");
  });

  it("coaches and coach visits come from the coaching read, for the same window and region", async () => {
    renderPage("?region=Urban-I");
    expect(await screen.findByTestId("tile-coaches")).toHaveTextContent("3");
    await waitFor(() => expect(screen.getByTestId("tile-coachVisits")).toHaveTextContent("10"));
    expect(h.getCoaching).toHaveBeenCalledWith({ from: "2026-10-01", to: "2026-10-13", region: "Urban-I" });
  });

  it("the coaching tiles wait for their own read without holding up the rest", async () => {
    h.getCoaching.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(await screen.findByTestId("tile-lpsOpened")).toHaveTextContent("661");
    expect(screen.getByTestId("section-coaching")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("tile-coaches")).toBeNull();
  });

  it("a coaching read that fails shows — in its tiles, never a 0", async () => {
    h.getCoaching.mockRejectedValue({ response: { status: 500 } });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("tile-coaches")).toHaveTextContent("—"));
    expect(screen.getByTestId("tile-coachVisits")).toHaveTextContent("—");
    expect(screen.getByTestId("tile-coaches").textContent).not.toMatch(/\b0\b/);
    expect(screen.getByTestId("tile-lpsOpened")).toHaveTextContent("661");
  });

  it("the LP-opens note shows when the window starts before LP opens were logged, and not after", async () => {
    renderPage();
    expect(within(await screen.findByTestId("tile-lpsOpened")).getByTestId("lp-opens-note")).toHaveTextContent("logged since 4 Oct");
  });

  it("no LP-opens note for a window starting on or after that day", async () => {
    renderPage("?from=2026-10-04&to=2026-10-12");
    await screen.findByTestId("tile-lpsOpened");
    expect(screen.queryByTestId("lp-opens-note")).toBeNull();
  });
});

describe("LP Engagement", () => {
  // bd-97x22y.3 (PLAN v7) — her tab 1 to 1, from its own read; the tab's own tests: LpEngagement.test.tsx.
  it("her sections, in her order, from the lp-engagement read", async () => {
    renderPage("/lp");
    await screen.findByTestId("tile-lpOverall");
    expect(eyebrows()).toEqual(["Engagement overview", "Teacher status", "Sectors — click to view school breakdown"]);
    expect(h.getLpEngagement).toHaveBeenCalledWith({ from: "2026-10-01", to: "2026-10-13", region: "all", band: "primary" });
  });
});

describe("Trainings", () => {
  // bd-97x22y.4 (PLAN v7) — her page 1 to 1, from its own read; the tab's own tests: views/TrainingTab.test.tsx.
  it("her sections, in her order, from the training-levels read", async () => {
    renderPage("/training");
    await screen.findByTestId("level-card-0");
    expect(eyebrows()).toEqual(["Training level progress", "Training completion — sector comparison", "Sectors"]);
    expect(h.getTrainingLevels).toHaveBeenCalledWith({ region: null, band: "primary" });
  });
});

/**
 * bd-97x22y.5 — Observations, her tab 1 to 1 (PLAN v7): Human / Digital Coach, her four sections, her whole-number %,
 * from its own read (GET /api/portal/analytics/observations) holding both kinds.
 */
describe("Observations (v7: her tab, 1 to 1)", () => {
  const OCT = { from: "2026-10-01", to: "2026-10-13" };
  const fx = (region: string | null = null) => fixtureObservations({ ...OCT, region });
  const whole = (v: number | null) => (v === null ? "—" : `${Math.round(v)}%`);

  it("her two buttons, Human first and on by default; Digital Coach is ?obs=dc", async () => {
    renderPage("/observations");
    await screen.findByTestId("observations-human");
    const buttons = within(screen.getByRole("group", { name: "Observations by" })).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("data-testid"))).toEqual(["obs-kind-human", "obs-kind-dc"]);
    expect(screen.getByTestId("obs-kind-human")).toHaveTextContent("Human observations");
    expect(screen.getByTestId("obs-kind-human")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("obs-kind-dc")).toHaveTextContent("Digital Coach observations");
    await userEvent.setup().click(screen.getByTestId("obs-kind-dc"));
    expect(await screen.findByTestId("observations-dc")).toBeInTheDocument();
    expect(screen.getByTestId("obs-kind-dc")).toHaveAttribute("aria-pressed", "true");
    expect(where()).toMatch(/obs=dc/);
  });

  it("her sections, in her order, for each kind", async () => {
    renderPage("/observations");
    await screen.findByTestId("observations-human");
    expect(eyebrows()).toEqual(["Observation summary", "FICO score breakdown", "Avg observation scores by sector", "Sector breakdown"]);
    await userEvent.setup().click(screen.getByTestId("obs-kind-dc"));
    await screen.findByTestId("observations-dc");
    expect(eyebrows()).toEqual(["Digital Coach impact", "FICO score breakdown", "Digital Coach — avg scores by sector", "Sector breakdown"]);
  });

  it("summary: total observations, teachers observed (x of N), sectors active — no TEACH, FLN or cycle anywhere", async () => {
    renderPage("/observations");
    await screen.findByTestId("observations-human");
    expect(testIds("tile-")).toEqual(["observations", "teachersObserved", "sectorsActive"]);
    const ov = fx().human.overview;
    expect(screen.getByTestId("tile-observations")).toHaveTextContent(String(ov.observations));
    expect(screen.getByTestId("tile-observations")).toHaveTextContent("Total observations");
    expect(screen.getByTestId("tile-teachersObserved")).toHaveTextContent(String(ov.teachersObserved));
    expect(screen.getByTestId("tile-teachersObserved")).toHaveTextContent("of 442 teachers");
    expect(screen.getByTestId("tile-sectorsActive")).toHaveTextContent("6");
    expect(screen.getByTestId("tile-sectorsActive")).toHaveTextContent("of 6 regions");
    expect(document.body.textContent).not.toMatch(/TEACH|FLN|Cycle/);

    await userEvent.setup().click(screen.getByTestId("obs-kind-dc"));
    await screen.findByTestId("observations-dc");
    expect(screen.getByTestId("tile-observations")).toHaveTextContent("188");
    expect(screen.getByTestId("tile-observations")).toHaveTextContent("Total DC observations");
    expect(screen.getByTestId("tile-teachersObserved")).toHaveTextContent("93");
    expect(screen.getByTestId("tile-sectorsActive")).toHaveTextContent("Sectors covered");
  });

  it("FICO score breakdown: her three cards, whole-number %, a bar each, how many scored; under 60 is amber", async () => {
    renderPage("/observations");
    const panel = await screen.findByTestId("fico-breakdown");
    const o = fx().human.overview;
    expect(testIds("score-", panel).filter((id) => ["b", "c", "d"].includes(id))).toEqual(["b", "c", "d"]);
    expect(within(panel).getByTestId("score-b")).toHaveTextContent("LP Fidelity score");
    expect(within(within(panel).getByTestId("score-b")).getByTestId("score-value")).toHaveTextContent(whole(o.sectionB));
    expect(within(within(panel).getByTestId("score-c")).getByTestId("score-value")).toHaveTextContent(whole(o.sectionC));
    expect(within(within(panel).getByTestId("score-d")).getByTestId("score-value")).toHaveTextContent(whole(o.sectionD));
    expect(within(panel).getByTestId("score-b")).toHaveTextContent(`Section B — Human observations · ${o.sectionBN} scored`);
    // The bar is the score's width.
    expect(within(within(panel).getByTestId("score-c")).getByTestId("score-bar")).toHaveStyle({ width: `${o.sectionC}%` });
    // Engagement is under 60 in the fixture: her amber; LP Fidelity is not.
    expect(o.sectionD!).toBeLessThan(60);
    expect(within(within(panel).getByTestId("score-d")).getByTestId("score-value")).toHaveAttribute("data-low", "true");
    expect(within(within(panel).getByTestId("score-b")).getByTestId("score-value")).not.toHaveAttribute("data-low");
  });

  it("a section with nothing scored reads — with an empty bar, never 0%", async () => {
    h.getObservations.mockImplementation(async (p: Params) => {
      const r = fixtureObservations(p);
      return { ...r, human: { ...r.human, overview: { ...r.human.overview, sectionB: null, sectionBN: 0 } } };
    });
    renderPage("/observations");
    const card = await screen.findByTestId("score-b");
    expect(within(card).getByTestId("score-value")).toHaveTextContent(/^—$/);
    expect(within(card).getByTestId("score-bar")).toHaveStyle({ width: "0%" });
    expect(card).not.toHaveTextContent("scored");
  });

  it("avg scores by sector: six sectors in order, three bars each with her legend, whole-number % in each bar's label", async () => {
    renderPage("/observations");
    const chart = await screen.findByTestId("chart-sections");
    expect(within(chart).getByTestId("chart-legend")).toHaveTextContent("Section B — LP FidelitySection C — Teaching PracticesSection D — Engagement");
    expect(testIds("group-", chart)).toEqual(SIX);
    const bk = fx().human.regions.find((r) => r.region === "B.K")!;
    for (const [k, v] of [["b", bk.sectionB], ["c", bk.sectionC], ["d", bk.sectionD]] as const) {
      expect(within(within(chart).getByTestId(`bar-B.K-${k}`)).getByTestId("bar-value")).toHaveTextContent(whole(v));
    }
  });

  it("a sector with no score for a section has no bar for it and shows —", async () => {
    h.getObservations.mockImplementation(async (p: Params) => {
      const r = fixtureObservations(p);
      return { ...r, human: { ...r.human, regions: r.human.regions.map((g) => (g.region === "Nilore" ? { ...g, sectionB: null, sectionBN: 0 } : g)) } };
    });
    renderPage("/observations");
    const bar = within(await screen.findByTestId("chart-sections")).getByTestId("bar-Nilore-b");
    expect(within(bar).getByTestId("bar-value")).toHaveTextContent(/^—$/);
    expect(within(bar).queryByTestId("bar-fill")).toBeNull();
  });

  it("on a phone the chart is a block per sector with a bar per section (eighteen columns do not fit 390px)", async () => {
    setWidth(390);
    renderPage("/observations");
    const chart = await screen.findByTestId("chart-sections");
    expect(testIds("group-", chart)).toEqual(SIX);
    expect(within(chart).queryAllByTestId("bar-fill")).toHaveLength(0);
    expect(within(chart).getAllByTestId("bar-value")).toHaveLength(18);
  });

  it("sector cards: observations and her three section %; View details opens that sector's schools, most observed first", async () => {
    renderPage("/observations");
    const card = await screen.findByTestId("sector-card-Urban-I");
    expect(testIds("sector-card-")).toEqual(SIX);
    const ui = fx().human.regions.find((r) => r.region === "Urban-I")!;
    expect(within(card).getByTestId("card-observations")).toHaveTextContent(String(ui.observations));
    expect(within(card).getByTestId("section-b")).toHaveTextContent(whole(ui.sectionB));
    expect(within(card).getByTestId("section-d")).toHaveTextContent(whole(ui.sectionD));
    expect(card).toHaveTextContent("View details");
    expect(screen.queryByTestId("obs-schools")).toBeNull();
    await userEvent.setup().click(card);
    const list = await screen.findByTestId("obs-schools");
    expect(where()).toMatch(/region=Urban-I/);
    const names = within(list).getAllByTestId("obs-school-name").map((n) => n.textContent);
    const want = fx("Urban-I").human.schools.slice().sort((a, b) => b.observations - a.observations || a.name.localeCompare(b.name)).map((s) => s.name);
    expect(names).toEqual(want);
    const s08 = within(list).getByTestId("obs-school-s-08");
    expect(s08).toHaveTextContent("6 obs");
    expect(s08).toHaveTextContent("EMIS 68366");
    expect(within(s08).getByTestId("section-b")).toHaveTextContent("82%");
    expect(within(s08).getByTestId("section-c")).toHaveTextContent("86%");
  });

  it("a school with no observations of the kind shows 0 obs and — for every section", async () => {
    renderPage("/observations?obs=dc&region=Sihala");
    const row = await screen.findByTestId("obs-school-s-04");
    expect(row).toHaveTextContent("0 obs");
    for (const k of ["b", "c", "d"]) expect(within(row).getByTestId(`section-${k}`)).toHaveTextContent(/^—$/);
  });

  it("both kinds come in one read: switching reads nothing; a new region reads again, for the page's window", async () => {
    renderPage("/observations");
    await screen.findByTestId("observations-human");
    expect(h.getObservations).toHaveBeenCalledTimes(1);
    expect(h.getObservations).toHaveBeenCalledWith({ from: "2026-10-01", to: "2026-10-13", region: "all" });
    const user = userEvent.setup();
    await user.click(screen.getByTestId("obs-kind-dc"));
    await screen.findByTestId("observations-dc");
    expect(h.getObservations).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId("sector-card-Tarnol"));
    await waitFor(() => expect(h.getObservations).toHaveBeenLastCalledWith({ from: "2026-10-01", to: "2026-10-13", region: "Tarnol" }));
  });

  it("a failed observations read says so, shows no numbers, and can be tried again", async () => {
    h.getObservations.mockRejectedValueOnce({ response: { status: 500 } });
    renderPage("/observations");
    expect(await screen.findByTestId("observations-error")).toBeInTheDocument();
    expect(screen.queryByTestId("tile-observations")).toBeNull();
    await userEvent.setup().click(screen.getByTestId("observations-retry"));
    expect(await screen.findByTestId("tile-observations")).toBeInTheDocument();
    expect(h.getObservations).toHaveBeenCalledTimes(2);
  });

  it.each(["", "/lp", "/training", "/coaching", "/info"])("is not read on %s (its cost never slows the other tabs)", async (rest) => {
    renderPage(rest);
    await screen.findByTestId("tab-title");
    await waitFor(() => expect(h.getSchools).toHaveBeenCalled());
    expect(h.getObservations).not.toHaveBeenCalled();
  });
});

/** bd-97x22y.5 — Coaching, her tab 1 to 1 (PLAN v7): her two numbers, her sector cards, her coaches by sector. */
describe("Coaching (v7: her tab, 1 to 1)", () => {
  it("her sections: the two numbers, the sector overview, coaches by sector", async () => {
    renderPage("/coaching");
    await screen.findByTestId("tile-coaches");
    expect(eyebrows()).toEqual(["Coaching", "Sector overview", "Coaches by sector"]);
  });

  it("total coaches and total visits (for the page's window), from the coaching read", async () => {
    renderPage("/coaching");
    await screen.findByTestId("tile-coaches");
    expect(testIds("tile-")).toEqual(["coaches", "coachVisits"]);
    expect(screen.getByTestId("tile-coaches")).toHaveTextContent("9");
    expect(screen.getByTestId("tile-coaches")).toHaveTextContent("Total coaches");
    expect(screen.getByTestId("tile-coachVisits")).toHaveTextContent("42");
    expect(screen.getByTestId("tile-coachVisits")).toHaveTextContent("Total visits");
    expect(screen.getByTestId("tile-coachVisits")).toHaveTextContent("1 Oct – 13 Oct 2026");
    expect(h.getCoaching).toHaveBeenCalledWith({ from: "2026-10-01", to: "2026-10-13", region: "all" });
  });

  it("her sector card: schools, coaches and total visits, then View school visits", async () => {
    renderPage("/coaching");
    const card = await screen.findByTestId("sector-card-Urban-I");
    expect(testIds("sector-card-")).toEqual(SIX);
    expect(within(card).getByTestId("card-schools")).toHaveTextContent("5");
    expect(within(card).getByTestId("card-coaches")).toHaveTextContent("3");
    expect(within(card).getByTestId("card-coachVisits")).toHaveTextContent("10");
    expect(card).toHaveTextContent("Total visits");
    expect(card).toHaveTextContent("View school visits");
  });

  it("a sector card opens its schools' visits", async () => {
    renderPage("/coaching");
    await userEvent.setup().click(await screen.findByTestId("sector-card-Urban-I"));
    await waitFor(() => expect(h.getCoaching).toHaveBeenLastCalledWith({ from: "2026-10-01", to: "2026-10-13", region: "Urban-I" }));
    await waitFor(() => expect(rowNames()).toHaveLength(5));
    const headers = within(screen.getByTestId("schools-table")).getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers).toEqual(["School", "Coach visits"]);
    expect(within(screen.getByTestId("school-row-s-08")).getByTestId("cell-coachVisits")).toHaveTextContent("4");
  });

  it("coaches by sector: a list per sector in order, names A to Z with an initial badge, the count beside, N total", async () => {
    renderPage("/coaching");
    await screen.findByTestId("coach-list-B.K");
    expect(testIds("coach-list-")).toEqual(SIX);
    expect(screen.getByTestId("coaches-total")).toHaveTextContent("9 total");
    const list = screen.getByTestId("coach-list-Urban-I");
    const names = within(list).getAllByTestId("coach-name").map((n) => n.textContent);
    expect(names).toEqual(["KKamran Ali", "MMariam Iqbal", "SSadia Rauf"]);
    expect(within(list).getByTestId("coach-count")).toHaveTextContent("3 coaches");
    // A coach covering two sectors is in both lists.
    expect(screen.getByTestId("coach-list-B.K")).toHaveTextContent("Bilal Ahmed");
    expect(screen.getByTestId("coach-list-Sihala")).toHaveTextContent("Bilal Ahmed");
    // Information, not a control: nothing in the lists can be tapped.
    expect(within(list).queryAllByRole("button")).toHaveLength(0);
  });

  it("with a region chosen, only that region's coaches are listed", async () => {
    renderPage("/coaching?region=Tarnol");
    await screen.findByTestId("coach-list-Tarnol");
    expect(testIds("coach-list-")).toEqual(["Tarnol"]);
    expect(screen.getByTestId("coach-list-Tarnol")).toHaveTextContent("Farah Naz");
  });

  it("coaches are staff: the page still names no teacher, and its promise says so", async () => {
    renderPage("/coaching");
    await screen.findByTestId("coach-list-B.K");
    expect(document.body.textContent).not.toMatch(/teacherName|user_?id/i);
  });

  it("a failed coaching read says so and can be tried again", async () => {
    h.getCoaching.mockRejectedValueOnce({ response: { status: 500 } });
    renderPage("/coaching");
    const user = userEvent.setup();
    expect(await screen.findByTestId("coaching-error")).toBeInTheDocument();
    expect(screen.queryByTestId("tile-coaches")).toBeNull();
    await user.click(screen.getByTestId("coaching-retry"));
    expect(await screen.findByTestId("tile-coaches")).toHaveTextContent("9");
    expect(h.getCoaching).toHaveBeenCalledTimes(2);
  });

  it.each(["/lp", "/training", "/observations", "/info"])("is not read on %s (its cost never slows the other tabs)", async (rest) => {
    renderPage(rest);
    await screen.findByTestId("tab-title");
    await waitFor(() => expect(h.getSchools).toHaveBeenCalled());
    expect(h.getCoaching).not.toHaveBeenCalled();
  });

  it("Overview then Coaching, same filters: read once", async () => {
    renderPage();
    await screen.findByTestId("tile-coaches");
    await userEvent.setup().click(within(sidebar()).getByTestId("tab-link-coaching"));
    await screen.findByTestId("coach-list-B.K");
    expect(h.getCoaching).toHaveBeenCalledTimes(1);
  });
});

describe("Information", () => {
  it("how every number is worked out, grouped by tab, in her card style", async () => {
    renderPage("/info");
    const panel = await screen.findByTestId("how-counted");
    expect(eyebrows()).toEqual(["Schools and teachers", "LP Engagement", "Trainings", "Observations", "Coaching", "Regions, periods and totals"]);
    for (const term of [
      "Schools", "Teachers", "LPs opened", "Teachers who opened", "Regions with activity", "Modules completed", "Teachers trained",
      "DC observations", "Teachers observed", "Human observations", "Avg FICO", "Avg HITL", "Total coaches", "Coach visits", "Schools visited",
    ]) {
      expect(Array.from(panel.querySelectorAll("[data-testid='term']")).map((t) => t.textContent)).toContain(term);
    }
  });

  it("says plainly that only schools in the six regions are counted, and never mentions Unassigned", async () => {
    renderPage("/info");
    const panel = await screen.findByTestId("how-counted");
    expect(panel).toHaveTextContent("B.K, Sihala, Urban-I, Nilore, Urban-II and Tarnol");
    expect(panel).toHaveTextContent(/not shown and not counted/);
    expect(panel.textContent).not.toMatch(/unassigned/i);
  });

  it("explains that the scores are shown out of 100, as a percentage", async () => {
    renderPage("/info");
    const panel = await screen.findByTestId("how-counted");
    const term = Array.from(panel.querySelectorAll("[data-testid='term']")).find((t) => t.textContent === "Avg FICO")!;
    expect(term.closest("[data-testid='definition']")).toHaveTextContent(/percentage/);
  });

  it("is there even when the numbers did not load", async () => {
    h.getSchools.mockRejectedValue({ response: { status: 500 } });
    renderPage("/info");
    expect(await screen.findByTestId("how-counted")).toBeInTheDocument();
  });
});

describe("% only on scores (operator, 2026-10-14: scores as %, usage as counts)", () => {
  /** Every text node with a % sign must sit inside a FICO or HITL score value. */
  function percentOutsideScores() {
    const bad: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!(n.textContent || "").includes("%")) continue;
      const host = (n.parentElement as HTMLElement).closest("[data-score]");
      if (!host || !["fico", "hitl"].includes(host.getAttribute("data-score")!)) bad.push(n.textContent!);
    }
    return bad;
  }

  it.each([
    ["", "tile-avgFico"],
    ["/observations", "chart-sections"],
    ["/observations?region=Urban-I", "obs-schools"],
    ["/observations?obs=dc", "chart-sections"],
    ["/observations?obs=dc&region=Urban-I", "obs-schools"],
    ["/coaching", "coach-list-B.K"],
    ["/coaching?region=Urban-I", "schools-table"],
    ["/info", "how-counted"],
  ])("on %s every % is a score", async (rest, ready) => {
    renderPage(rest);
    await screen.findByTestId(ready);
    await waitFor(() => expect(screen.queryAllByTestId(/^tile-/).length + (rest === "/info" ? 1 : 0)).toBeGreaterThan(0));
    expect(percentOutsideScores()).toEqual([]);
  });

  it("and on a phone", async () => {
    setWidth(390);
    renderPage("/observations?region=Urban-I");
    await screen.findByTestId("obs-schools");
    expect(percentOutsideScores()).toEqual([]);
  });

  it("positive control: the scores do carry a %", async () => {
    renderPage("/observations?region=Urban-I");
    await screen.findByTestId("obs-schools");
    const scores = Array.from(document.querySelectorAll("[data-score]"));
    expect(scores.length).toBeGreaterThan(0);
    expect(scores.some((s) => /%/.test(s.textContent || ""))).toBe(true);
  });

  it("the usage tabs carry no % at all", async () => {
    // (Trainings and LP Engagement show her % since v7 — their own tests: views/TrainingTab.test.tsx,
    // LpEngagement.test.tsx)
    for (const rest of ["/coaching"]) {
      const { unmount } = renderPage(rest);
      await screen.findByTestId(rest === "/coaching" ? "tile-coaches" : "sector-card-B.K");
      expect(document.body.textContent).not.toMatch(/%/);
      unmount();
    }
  });
});

// bd-97x22y.3 — since v7 the LP tab has her own breakdown table and Observations her school rows, so only Coaching
// (one column) still draws the shared school table. Its sort, search, paging and phone cards are checked on the
// table itself, with the columns the v6 LP tab gave it.
function renderList(region: string, schools = fixtureResponse({ region }).schools, phone = false) {
  return render(
    <MemoryRouter>
      <SchoolsList c={analyticsCopy("en")} schools={schools} phone={phone} lpOpensNote={null} columns={["teachers", "lpsOpened"]} />
    </MemoryRouter>,
  );
}

describe("a sector's school table", () => {
  it("sorts by name first; a number column biggest first, then flips", async () => {
    renderList("Urban-I");
    await waitFor(() => expect(rowNames()).toHaveLength(5));
    expect(rowNames()).toEqual(["IMCB (VI-XII) F-5/3", "IMCG (VI-XII) F-7/2", "IMCG (VI-XII) G-6/1", "IMSB (I-X) F-7/3", "IMSG (I-V) F-6/4"]);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("sort-teachers"));
    expect(rowNames()[0]).toBe("IMSB (I-X) F-7/3");
    await user.click(screen.getByTestId("sort-teachers"));
    expect(rowNames()[0]).toBe("IMCG (VI-XII) F-7/2");
    await user.click(screen.getByTestId("sort-lpsOpened"));
    expect(rowNames()[0]).toBe("IMCG (VI-XII) G-6/1");
    expect(screen.getByTestId("sort-lpsOpened").closest("th")).toHaveAttribute("aria-sort", "descending");
  });

  it("no score always last, whichever way", () => {
    // bd-97x22y.5: no tab shows a score column in this table any more (Observations now has her school rows), so the
    // rule is checked on the table's own sort, with the same Sihala schools as before.
    const sihala = fixtureResponse({ region: "Sihala" }).schools;
    const names = (rows: typeof sihala) => rows.map((r) => r.name);
    expect(names(sortSchools(sihala, { key: "avgFico", dir: "desc" }))).toEqual(["IMCB (VI-XII) Chak Jabbar", "IMCG (VI-XII) Sihala", "IMCB (VI-XII) Dhok Jabbar"]);
    expect(names(sortSchools(sihala, { key: "avgFico", dir: "asc" }))).toEqual(["IMCG (VI-XII) Sihala", "IMCB (VI-XII) Chak Jabbar", "IMCB (VI-XII) Dhok Jabbar"]);
  });

  it("searches by school name or EMIS code", async () => {
    renderList("Urban-I");
    await waitFor(() => expect(rowNames()).toHaveLength(5));
    const user = userEvent.setup();
    await user.type(screen.getByTestId("school-search"), "f-7");
    expect(rowNames()).toEqual(["IMCG (VI-XII) F-7/2", "IMSB (I-X) F-7/3"]);
    expect(screen.getByTestId("search-count")).toHaveTextContent("2 of 5 schools");
    await user.clear(screen.getByTestId("school-search"));
    await user.type(screen.getByTestId("school-search"), "75573");
    expect(rowNames()).toEqual(["IMCB (VI-XII) F-5/3"]);
  });

  it("a school with no EMIS shows its name alone", async () => {
    renderList("Tarnol");
    await waitFor(() => expect(rowNames()).toHaveLength(2));
    expect(within(screen.getByTestId("school-row-s-15")).queryByTestId("school-emis")).toBeNull();
    expect(within(screen.getByTestId("school-row-s-14")).getByTestId("school-emis")).toHaveTextContent("55120");
  });

  const many = () => {
    const base = fixtureResponse({ region: "Urban-I" });
    const schools = Array.from({ length: 60 }, (_, i) => ({ ...base.schools[i % base.schools.length], schoolId: `m-${i}`, name: `School ${String(i).padStart(2, "0")}` }));
    return { ...base, schools, overview: { ...base.overview, schools: 60 } };
  };

  it("shows 25 schools at a time, then 25 more", async () => {
    renderList("Urban-I", many().schools);
    await waitFor(() => expect(rowNames()).toHaveLength(25));
    expect(screen.getByTestId("showing")).toHaveTextContent("Showing 25 of 60");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("show-more"));
    expect(rowNames()).toHaveLength(50);
    await user.click(screen.getByTestId("show-more"));
    expect(rowNames()).toHaveLength(60);
    expect(screen.queryByTestId("show-more")).toBeNull();
  });

  it("a search looks through every school, not just the ones shown", async () => {
    renderList("Urban-I", many().schools);
    await waitFor(() => expect(rowNames()).toHaveLength(25));
    await userEvent.setup().type(screen.getByTestId("school-search"), "School 5");
    expect(rowNames()).toEqual(["School 50", "School 51", "School 52", "School 53", "School 54", "School 55", "School 56", "School 57", "School 58", "School 59"]);
  });

  it("on a phone: one card per school with a sort menu of the tab's columns, no table", async () => {
    renderList("Urban-I", undefined, true);
    const cards = await screen.findAllByTestId("school-card");
    expect(cards).toHaveLength(5);
    expect(screen.queryByTestId("schools-table")).toBeNull();
    const options = Array.from((screen.getByTestId("sort-menu") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual(["School", "Teachers", "LPs opened"]);
    await userEvent.setup().selectOptions(screen.getByTestId("sort-menu"), "teachers");
    expect(within(screen.getAllByTestId("school-card")[0]).getByTestId("school-name")).toHaveTextContent("IMSB (I-X) F-7/3");
    expect(within(screen.getByTestId("school-card-s-11")).getByTestId("cell-lpsOpened")).toHaveTextContent("15 of 26 teachers");
  });
});
