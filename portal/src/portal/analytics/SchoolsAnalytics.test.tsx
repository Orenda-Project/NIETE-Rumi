import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { fixtureCoaching, fixtureResponse, REGION_ORDER } from "./fixtures";

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
  analytics: { getSchools: h.getSchools, getCoaching: h.getCoaching },
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
    await screen.findByTestId("tile-lpsOpened");
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
    expect(screen.queryByTestId("tile-lpsOpened")).toBeNull();
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
    await screen.findByTestId("tile-lpsOpened");
    const search = "?from=2026-09-01&to=2026-09-30&region=Sihala";
    TAB_IDS.forEach((id) => {
      const href = within(sidebar()).getByTestId(`tab-link-${id}`).getAttribute("href");
      expect(href).toBe(`/portal/analytics/schools${id === "overview" ? "" : `/${id}`}${search}`);
    });
    await userEvent.setup().click(within(sidebar()).getByTestId("tab-link-training"));
    expect(await screen.findByTestId("tile-teachersTrained")).toBeInTheDocument();
    expect(where()).toBe(`/portal/analytics/schools/training${search}`);
    expect(screen.getByTestId("region-chip-Sihala")).toHaveAttribute("aria-pressed", "true");
    expect(h.getSchools).toHaveBeenCalledTimes(1);
  });

  it("choosing a region or a period on a tab stays on that tab", async () => {
    renderPage("/training");
    await screen.findByTestId("tile-trainingModules");
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
  it("her sections, in her order", async () => {
    renderPage("/lp");
    await screen.findByTestId("tile-lpsOpened");
    expect(eyebrows()).toEqual(["Engagement overview", "Sectors — click to view school breakdown", "LPs opened by sector"]);
  });

  it("engagement overview: LPs opened, teachers who opened (x of N), regions with activity", async () => {
    renderPage("/lp");
    await screen.findByTestId("tile-lpsOpened");
    expect(testIds("tile-")).toEqual(["lpsOpened", "teachersOpenedLp", "regionsActive"]);
    expect(screen.getByTestId("tile-lpsOpened")).toHaveTextContent("661");
    expect(screen.getByTestId("tile-lpsOpened")).toHaveTextContent("logged since 4 Oct");
    expect(screen.getByTestId("tile-teachersOpenedLp")).toHaveTextContent("185");
    expect(screen.getByTestId("tile-teachersOpenedLp")).toHaveTextContent("of 442 teachers");
    expect(screen.getByTestId("tile-regionsActive")).toHaveTextContent("6");
    expect(screen.getByTestId("tile-regionsActive")).toHaveTextContent("of 6 regions");
  });

  it("regions with activity counts the regions where at least one LP was opened", async () => {
    h.getSchools.mockImplementation(async (p: Params) => {
      const r = fixtureResponse(p);
      return { ...r, regions: r.regions.map((g) => (g.region === "Nilore" || g.region === "Tarnol" ? { ...g, lpsOpened: 0, teachersOpenedLp: 0 } : g)) };
    });
    renderPage("/lp");
    expect(await screen.findByTestId("tile-regionsActive")).toHaveTextContent("4");
  });

  it("six sector cards in sector order, each with LPs opened and x of N teachers on a plain bar", async () => {
    renderPage("/lp");
    const card = await screen.findByTestId("sector-card-Urban-I");
    expect(testIds("sector-card-")).toEqual(SIX);
    expect(card).toHaveTextContent("229");
    expect(card).toHaveTextContent("68 of 135 teachers");
    expect(within(card).getByTestId("share-bar")).toBeInTheDocument();
  });

  it("a bar chart of LPs opened per sector", async () => {
    renderPage("/lp");
    const chart = await screen.findByTestId("chart-lpsOpened");
    expect(testIds("column-", chart)).toEqual(SIX);
    expect(SIX.map((r) => within(within(chart).getByTestId(`column-${r}`)).getByTestId("bar-value").textContent)).toEqual(["59", "109", "229", "63", "95", "106"]);
  });

  it("no school table until a sector is chosen", async () => {
    renderPage("/lp");
    await screen.findByTestId("sector-card-B.K");
    expect(screen.queryByTestId("breakdown")).toBeNull();
    expect(screen.queryByTestId("schools-table")).toBeNull();
  });

  it("a sector card opens that sector's schools in place, and Back returns to all regions", async () => {
    renderPage("/lp");
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("sector-card-Sihala"));
    await waitFor(() => expect(h.getSchools).toHaveBeenLastCalledWith({ from: "2026-10-01", to: "2026-10-13", region: "Sihala" }));
    const breakdown = await screen.findByTestId("breakdown");
    expect(within(breakdown).getByTestId("breakdown-title")).toHaveTextContent("Sihala");
    await waitFor(() => expect(rowNames()).toHaveLength(3));
    const headers = within(screen.getByTestId("schools-table")).getAllByRole("columnheader").map((th) => th.textContent || "");
    expect(headers.map((x) => x.split(/x of N|logged/)[0])).toEqual(["School", "Teachers", "LPs opened"]);
    const row = screen.getByTestId("school-row-s-02");
    expect(within(row).getByTestId("cell-lpsOpened")).toHaveTextContent("52");
    expect(within(row).getByTestId("cell-lpsOpened")).toHaveTextContent("14 of 30");
    expect(screen.getByTestId("sector-card-Sihala")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("region-chip-Sihala")).toHaveAttribute("aria-pressed", "true");
    expect(where()).toMatch(/^\/portal\/analytics\/schools\/lp\?.*region=Sihala/);

    await user.click(screen.getByTestId("breakdown-back"));
    await waitFor(() => expect(h.getSchools).toHaveBeenLastCalledWith({ from: "2026-10-01", to: "2026-10-13", region: "all" }));
    expect(screen.queryByTestId("breakdown")).toBeNull();
    expect(testIds("sector-card-")).toEqual(SIX);
    expect(where()).not.toMatch(/region=/);
  });

  it("tapping the chosen card again also returns to all regions", async () => {
    renderPage("/lp?region=B.K");
    await screen.findByTestId("breakdown");
    await userEvent.setup().click(screen.getByTestId("sector-card-B.K"));
    await waitFor(() => expect(screen.queryByTestId("breakdown")).toBeNull());
  });

  it("a link with a region opens straight onto its breakdown, only that region's schools", async () => {
    renderPage("/lp?region=Urban-I");
    await screen.findByTestId("breakdown");
    expect(rowNames()).toHaveLength(5);
  });

  it("the LP-opens note sits on the tile and the column", async () => {
    renderPage("/lp?region=Urban-I");
    await screen.findByTestId("schools-table");
    const notes = screen.getAllByTestId("lp-opens-note");
    expect(notes.length).toBeGreaterThanOrEqual(2);
    for (const n of notes) expect(n).toHaveTextContent("logged since 4 Oct");
  });
});

describe("Trainings", () => {
  it("her sections, in her order", async () => {
    renderPage("/training");
    await screen.findByTestId("tile-trainingModules");
    expect(eyebrows()).toEqual(["Training overview", "Modules completed by sector", "Sectors — click to view school breakdown"]);
  });

  it("modules completed and teachers trained (x of N)", async () => {
    renderPage("/training");
    await screen.findByTestId("tile-trainingModules");
    expect(testIds("tile-")).toEqual(["trainingModules", "teachersTrained"]);
    expect(screen.getByTestId("tile-trainingModules")).toHaveTextContent("322");
    expect(screen.getByTestId("tile-teachersTrained")).toHaveTextContent("145");
    expect(screen.getByTestId("tile-teachersTrained")).toHaveTextContent("of 442 teachers");
  });

  it("a bar chart of modules completed per sector, and a card per sector", async () => {
    renderPage("/training");
    const chart = await screen.findByTestId("chart-trainingModules");
    expect(SIX.map((r) => within(within(chart).getByTestId(`column-${r}`)).getByTestId("bar-value").textContent)).toEqual(["26", "51", "94", "53", "44", "54"]);
    const card = screen.getByTestId("sector-card-Urban-I");
    expect(card).toHaveTextContent("94");
    expect(card).toHaveTextContent("45 of 135 teachers");
  });

  it("a sector card opens its schools: modules completed, x of N", async () => {
    renderPage("/training");
    await userEvent.setup().click(await screen.findByTestId("sector-card-Urban-I"));
    await waitFor(() => expect(rowNames()).toHaveLength(5));
    const headers = within(screen.getByTestId("schools-table")).getAllByRole("columnheader").map((th) => (th.textContent || "").split("x of N")[0]);
    expect(headers).toEqual(["School", "Teachers", "Modules completed"]);
    const cell = within(screen.getByTestId("school-row-s-08")).getByTestId("cell-trainingModules");
    expect(cell).toHaveTextContent("26");
    expect(cell).toHaveTextContent("12 of 23");
  });
});

describe("Observations", () => {
  it("a Digital Coach / Human toggle, Digital Coach first", async () => {
    renderPage("/observations");
    await screen.findByTestId("tile-dcObservations");
    expect(screen.getByTestId("obs-kind-dc")).toHaveTextContent("Digital Coach");
    expect(screen.getByTestId("obs-kind-dc")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("obs-kind-human")).toHaveTextContent("Human");
    expect(screen.getByTestId("obs-kind-human")).toHaveAttribute("aria-pressed", "false");
  });

  it("her sections, in her order", async () => {
    renderPage("/observations");
    await screen.findByTestId("tile-dcObservations");
    expect(eyebrows()).toEqual(["Summary", "Avg observation score by sector", "Sector breakdown"]);
  });

  it("Digital Coach: observations, teachers observed (x of N), Avg FICO % with n", async () => {
    renderPage("/observations");
    await screen.findByTestId("tile-dcObservations");
    expect(testIds("tile-")).toEqual(["dcObservations", "teachersWithDc", "avgFico"]);
    expect(screen.getByTestId("tile-dcObservations")).toHaveTextContent("188");
    expect(screen.getByTestId("tile-teachersWithDc")).toHaveTextContent("93");
    expect(screen.getByTestId("tile-teachersWithDc")).toHaveTextContent("of 442 teachers");
    expect(screen.getByTestId("tile-avgFico")).toHaveTextContent("64.8%");
    expect(screen.getByTestId("tile-avgFico")).toHaveTextContent("188 scored");
  });

  it("Human: observations and Avg HITL % (no teachers-observed count: the answer has none)", async () => {
    renderPage("/observations");
    await userEvent.setup().click(await screen.findByTestId("obs-kind-human"));
    expect(await screen.findByTestId("tile-avgHitl")).toHaveTextContent("57.1%");
    expect(testIds("tile-")).toEqual(["humanObservations", "avgHitl"]);
    expect(screen.getByTestId("tile-humanObservations")).toHaveTextContent("77");
    expect(screen.getByTestId("tile-avgHitl")).toHaveTextContent("77 scored");
    expect(screen.getByTestId("obs-kind-human")).toHaveAttribute("aria-pressed", "true");
    expect(where()).toMatch(/obs=human/);
    expect(h.getSchools).toHaveBeenCalledTimes(1);
  });

  it("the score chart: one bar per sector, the score as %, how many scored under it", async () => {
    renderPage("/observations");
    const chart = await screen.findByTestId("chart-avgFico");
    expect(testIds("column-", chart)).toEqual(SIX);
    expect(SIX.map((r) => within(within(chart).getByTestId(`column-${r}`)).getByTestId("bar-value").textContent)).toEqual(
      ["58.1%", "67.3%", "65.3%", "76.2%", "63.3%", "61.4%"],
    );
    expect(within(within(chart).getByTestId("column-B.K")).getByTestId("bar-sub")).toHaveTextContent("15 scored");
  });

  it("the Human chart is HITL", async () => {
    renderPage("/observations?obs=human");
    const chart = await screen.findByTestId("chart-avgHitl");
    expect(within(within(chart).getByTestId("column-B.K")).getByTestId("bar-value")).toHaveTextContent("52.7%");
    expect(within(within(chart).getByTestId("column-Nilore")).getByTestId("bar-sub")).toHaveTextContent("10 scored");
  });

  it("a sector with nothing scored has no bar and shows —", async () => {
    h.getSchools.mockImplementation(async (p: Params) => {
      const r = fixtureResponse(p);
      return { ...r, regions: r.regions.map((g) => (g.region === "Nilore" ? { ...g, avgFico: null, ficoN: 0 } : g)) };
    });
    renderPage("/observations");
    const bar = within(await screen.findByTestId("chart-avgFico")).getByTestId("column-Nilore");
    expect(within(bar).getByTestId("bar-value")).toHaveTextContent(/^—$/);
    expect(within(bar).queryByTestId("bar-fill")).toBeNull();
  });

  it("sector cards: observations and the average %, then View details opens the schools", async () => {
    renderPage("/observations");
    const card = await screen.findByTestId("sector-card-B.K");
    expect(card).toHaveTextContent("15");
    expect(card).toHaveTextContent("58.1%");
    expect(card).toHaveTextContent("View details");
    await userEvent.setup().click(card);
    await waitFor(() => expect(rowNames()).toHaveLength(2));
    const headers = within(screen.getByTestId("schools-table")).getAllByRole("columnheader").map((th) => (th.textContent || "").split(/x of N|\(n scored\)/)[0]);
    expect(headers).toEqual(["School", "Teachers", "DC observations", "Avg FICO"]);
    expect(within(screen.getByTestId("school-row-s-01")).getByTestId("cell-avgFico")).toHaveTextContent("59.2% (6)");
  });

  it("Human breakdown columns are human observations and Avg HITL", async () => {
    renderPage("/observations?obs=human&region=Urban-I");
    await waitFor(() => expect(rowNames()).toHaveLength(5));
    const headers = within(screen.getByTestId("schools-table")).getAllByRole("columnheader").map((th) => (th.textContent || "").split(/x of N|\(n scored\)/)[0]);
    expect(headers).toEqual(["School", "Teachers", "Human observations", "Avg HITL"]);
    expect(within(screen.getByTestId("school-row-s-08")).getByTestId("cell-avgHitl")).toHaveTextContent("70.3% (6)");
  });

  it("no score is a dash; fewer than three scored is muted, n shown", async () => {
    renderPage("/observations?region=Sihala");
    await waitFor(() => expect(rowNames()).toHaveLength(3));
    expect(within(screen.getByTestId("school-row-s-04")).getByTestId("cell-avgFico")).toHaveTextContent(/^—$/);
    expect(within(screen.getByTestId("school-row-s-04")).getByTestId("cell-dcObservations")).toHaveTextContent(/^0/);
  });

  it("fewer than three scored is muted", async () => {
    renderPage("/observations?region=Urban-I");
    await waitFor(() => expect(rowNames()).toHaveLength(5));
    const two = within(screen.getByTestId("school-row-s-07")).getByTestId("cell-avgFico");
    expect(two).toHaveTextContent("55.0% (2)");
    expect(two).toHaveAttribute("data-low-n", "true");
    expect(within(screen.getByTestId("school-row-s-08")).getByTestId("cell-avgFico")).not.toHaveAttribute("data-low-n");
  });
});

describe("Coaching", () => {
  it("her sections: Coaching, then the sector overview", async () => {
    renderPage("/coaching");
    await screen.findByTestId("tile-coaches");
    expect(eyebrows()).toEqual(["Coaching", "Sector overview"]);
  });

  it("total coaches, coach visits, schools visited (x of N schools), from the coaching read", async () => {
    renderPage("/coaching");
    await screen.findByTestId("tile-coaches");
    expect(testIds("tile-")).toEqual(["coaches", "coachVisits", "schoolsVisited"]);
    expect(screen.getByTestId("tile-coaches")).toHaveTextContent("9");
    expect(screen.getByTestId("tile-coachVisits")).toHaveTextContent("42");
    expect(screen.getByTestId("tile-schoolsVisited")).toHaveTextContent("13");
    expect(screen.getByTestId("tile-schoolsVisited")).toHaveTextContent("of 16 schools");
    expect(h.getCoaching).toHaveBeenCalledWith({ from: "2026-10-01", to: "2026-10-13", region: "all" });
  });

  it("a card per sector: coaches, visits, schools visited", async () => {
    renderPage("/coaching");
    const card = await screen.findByTestId("sector-card-Urban-I");
    expect(testIds("sector-card-")).toEqual(SIX);
    expect(within(card).getByTestId("card-coaches")).toHaveTextContent("3");
    expect(within(card).getByTestId("card-coachVisits")).toHaveTextContent("10");
    expect(card).toHaveTextContent("4 of 5 schools visited");
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
    await screen.findByTestId("tile-schoolsVisited");
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
    ["/lp", "chart-lpsOpened"],
    ["/lp?region=Urban-I", "schools-table"],
    ["/training", "chart-trainingModules"],
    ["/training?region=Urban-I", "schools-table"],
    ["/observations", "chart-avgFico"],
    ["/observations?region=Urban-I", "schools-table"],
    ["/observations?obs=human", "chart-avgHitl"],
    ["/coaching", "tile-schoolsVisited"],
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
    await screen.findAllByTestId("school-card");
    expect(percentOutsideScores()).toEqual([]);
  });

  it("positive control: the scores do carry a %", async () => {
    renderPage("/observations?region=Urban-I");
    await screen.findByTestId("schools-table");
    const scores = Array.from(document.querySelectorAll("[data-score]"));
    expect(scores.length).toBeGreaterThan(0);
    expect(scores.some((s) => /%/.test(s.textContent || ""))).toBe(true);
  });

  it("the usage tabs carry no % at all", async () => {
    for (const rest of ["/lp", "/training", "/coaching"]) {
      const { unmount } = renderPage(rest);
      await screen.findByTestId(rest === "/coaching" ? "tile-coaches" : "sector-card-B.K");
      expect(document.body.textContent).not.toMatch(/%/);
      unmount();
    }
  });
});

describe("a sector's school table", () => {
  it("sorts by name first; a number column biggest first, then flips", async () => {
    renderPage("/lp?region=Urban-I");
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

  it("no score always last, whichever way", async () => {
    renderPage("/observations?region=Sihala");
    await waitFor(() => expect(rowNames()).toHaveLength(3));
    const user = userEvent.setup();
    await user.click(screen.getByTestId("sort-avgFico"));
    expect(rowNames()).toEqual(["IMCB (VI-XII) Chak Jabbar", "IMCG (VI-XII) Sihala", "IMCB (VI-XII) Dhok Jabbar"]);
    await user.click(screen.getByTestId("sort-avgFico"));
    expect(rowNames()).toEqual(["IMCG (VI-XII) Sihala", "IMCB (VI-XII) Chak Jabbar", "IMCB (VI-XII) Dhok Jabbar"]);
  });

  it("searches by school name or EMIS code", async () => {
    renderPage("/lp?region=Urban-I");
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
    renderPage("/lp?region=Tarnol");
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
    h.getSchools.mockResolvedValue(many());
    renderPage("/lp?region=Urban-I");
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
    h.getSchools.mockResolvedValue(many());
    renderPage("/lp?region=Urban-I");
    await waitFor(() => expect(rowNames()).toHaveLength(25));
    await userEvent.setup().type(screen.getByTestId("school-search"), "School 5");
    expect(rowNames()).toEqual(["School 50", "School 51", "School 52", "School 53", "School 54", "School 55", "School 56", "School 57", "School 58", "School 59"]);
  });

  it("on a phone: one card per school with a sort menu of the tab's columns, no table", async () => {
    setWidth(390);
    renderPage("/lp?region=Urban-I");
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
