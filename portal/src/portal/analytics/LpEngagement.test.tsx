import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { fixtureCoaching, fixtureLpEngagement, fixtureResponse, REGION_ORDER } from "./fixtures";

/**
 * bd-97x22y.3 — the LP Engagement tab, the ICT dashboard's 1 to 1 (PLAN v7; her LPEngagement.jsx): her Primary /
 * Mid-High toggle at the top of the tab, ENGAGEMENT OVERVIEW, TEACHER STATUS, SECTORS (ring cards → school breakdown),
 * the subject and grade tables with her Overall row, and the sector-wise grouped bars (View By Subjects / Grades). Her
 * percentages and colours are shown (v7 supersedes v6's "counts only" for this tab). Numbers come from GET
 * /analytics/lp-engagement — the fixture is summed with her formula, so every expectation below reads it rather than
 * repeating a number.
 */
const h = vi.hoisted(() => ({
  getSchools: vi.fn(),
  getCoaching: vi.fn(),
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
}));

import SchoolsAnalytics from "./SchoolsAnalytics";

type Params = { from?: string | null; to?: string | null; region?: string | null; band?: "primary" | "midhigh" };

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

function renderPage(rest = "/lp") {
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
const MONTH = { from: "2026-10-01", to: "2026-10-13" };
const eyebrows = () => screen.getAllByTestId("eyebrow").map((e) => e.textContent);
/** The tab waits on two reads (the page's, then its own): give a loaded CI machine room before calling it absent. */
const WAIT = 8000;
const find = (id: string) => screen.findByTestId(id, {}, { timeout: WAIT });
const cardTitles = () => screen.getAllByTestId("card-title").map((e) => e.textContent);
const testIds = (prefix: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll(`[data-testid^="${prefix}"]`)).map((el) => el.getAttribute("data-testid")!.slice(prefix.length));
const where = () => screen.getByTestId("where").textContent;
const pct = (v: number | null) => (v === null ? "—" : `${v}%`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T09:00:00+05:00"));
  setWidth(1440);
  h.getSchools.mockImplementation(async (p: Params) => fixtureResponse(p));
  h.getCoaching.mockImplementation(async (p: Params) => fixtureCoaching(p));
  h.getLpEngagement.mockImplementation(async (p: Params) => fixtureLpEngagement(p));
});
afterEach(() => vi.useRealTimers());

describe("LP Engagement — her tab, 1 to 1", () => {
  it("her sections, in her order", async () => {
    renderPage();
    await find("chart-lp-subjects");
    expect(eyebrows()).toEqual(["Engagement overview", "Teacher status", "Sectors — click to view school breakdown"]);
    expect(cardTitles()).toEqual(["LP Engagement by Subject", "LP Engagement by Grade — Grades 1–5", "Sector-wise Performance in Subjects & Grades"]);
  });

  it("asks its own endpoint with the page's window and region, Primary by default; the schools read is not repeated for it", async () => {
    renderPage("/lp?region=Sihala");
    await find("tile-lpOverall");
    expect(h.getLpEngagement).toHaveBeenCalledWith({ ...MONTH, region: "Sihala", band: "primary" });
    expect(h.getSchools).toHaveBeenCalledTimes(1);
    expect(h.getCoaching).not.toHaveBeenCalled();
  });

  it("her Primary / Mid-High toggle opens the tab (as on Trainings); Primary is chosen", async () => {
    renderPage();
    const primary = await find("band-primary");
    expect(primary).toHaveTextContent("Primary Teachers");
    expect(primary).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("band-midhigh")).toHaveTextContent("Mid / High Teachers");
    expect(screen.getByTestId("band-midhigh")).toHaveAttribute("aria-pressed", "false");
    // First thing in the tab, above her sections.
    expect(primary.compareDocumentPosition(await find("tile-lpOverall")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("engagement overview: overall LP engagement %, teachers tracked, active sectors — with her lines under them", async () => {
    renderPage();
    const want = fixtureLpEngagement({ ...MONTH, band: "primary" }).overview;
    const overall = await find("tile-lpOverall");
    expect(testIds("tile-").slice(0, 3)).toEqual(["lpOverall", "lpTracked", "lpActiveSectors"]);
    expect(within(overall).getByTestId("kpi-value")).toHaveTextContent(pct(want.lpPct));
    expect(overall).toHaveTextContent("Overall LP Engagement");
    expect(overall).toHaveTextContent("Primary teachers");
    expect(within(screen.getByTestId("tile-lpTracked")).getByTestId("kpi-value")).toHaveTextContent(want.teachers.toLocaleString("en-US"));
    expect(screen.getByTestId("tile-lpTracked")).toHaveTextContent("Across all LP status categories");
    expect(within(screen.getByTestId("tile-lpActiveSectors")).getByTestId("kpi-value")).toHaveTextContent(String(want.activeSectors));
    expect(screen.getByTestId("tile-lpActiveSectors")).toHaveTextContent("Sectors with LP data");
    // On + Moderate + Off is every teacher tracked (hers).
    expect(want.onSchedule + want.moderate + want.offSchedule).toBe(want.teachers);
  });

  it("teacher status: On-Schedule, Moderate, Off-Schedule counts with her thresholds", async () => {
    renderPage();
    const want = fixtureLpEngagement({ ...MONTH, band: "primary" }).overview;
    await find("tile-lp-on");
    for (const [k, n, label, hint] of [
      ["on", want.onSchedule, "On-Schedule Teachers", "LP ratio ≥ 60%"],
      ["moderate", want.moderate, "Moderate Teachers", "LP ratio 40–59%"],
      ["off", want.offSchedule, "Off-Schedule Teachers", "LP ratio < 40%"],
    ] as const) {
      const tile = screen.getByTestId(`tile-lp-${k}`);
      expect(within(tile).getByTestId("kpi-value")).toHaveTextContent(n.toLocaleString("en-US"));
      expect(tile).toHaveTextContent(label);
      expect(tile).toHaveTextContent(hint);
    }
  });

  it("the LP-opens note sits on the overall tile when the window starts before opens were logged", async () => {
    renderPage();
    expect(within(await find("tile-lpOverall")).getByTestId("lp-opens-note")).toHaveTextContent("logged since 4 Oct");
  });

  it("six ring cards in sector order: the sector's %, its On / Moderate / Off with shares, its teachers", async () => {
    renderPage();
    await screen.findAllByTestId("ring-value", {}, { timeout: WAIT });
    expect(testIds("sector-card-")).toEqual(SIX);
    const want = fixtureLpEngagement({ ...MONTH, band: "primary" }).regions;
    for (const r of want) {
      const card = screen.getByTestId(`sector-card-${r.region}`);
      expect(within(card).getByTestId("ring-value")).toHaveTextContent(pct(r.lpPct));
      expect(within(card).getByTestId("sector-teachers")).toHaveTextContent(String(r.teachers));
      expect(within(card).getByTestId("band-line-on")).toHaveTextContent(`On-Schedule${r.onSchedule}${r.onSchedule > 0 ? `(${r.onPct}%)` : ""}`);
      expect(within(card).getByTestId("band-line-off")).toHaveTextContent(`Off-Schedule${r.offSchedule}${r.offSchedule > 0 ? `(${r.offPct}%)` : ""}`);
    }
  });

  it("a sector card opens its schools in place — LP % and her status — and Back returns to all regions", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(await find("sector-card-Urban-I"));
    await waitFor(() => expect(h.getLpEngagement).toHaveBeenLastCalledWith({ ...MONTH, region: "Urban-I", band: "primary" }));
    const table = await find("lp-schools-table");
    const want = fixtureLpEngagement({ ...MONTH, region: "Urban-I", band: "primary" }).schools;
    expect(want.length).toBeGreaterThan(0);
    expect(within(table).getAllByTestId("school-name").map((n) => n.textContent)).toEqual(want.map((s) => s.name));
    for (const s of want) {
      const row = screen.getByTestId(`lp-school-row-${s.schoolId}`);
      expect(within(row).getByTestId("cell-lp")).toHaveTextContent(pct(s.lpPct));
      expect(within(row).getByTestId("cell-status")).toHaveTextContent({ on: "On-Schedule", moderate: "Moderate", off: "Off-Schedule" }[s.status!]);
    }
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["School Name", "LP Engagement", "Status"]);
    expect(screen.getByTestId("sector-card-Urban-I")).toHaveAttribute("aria-pressed", "true");
    expect(where()).toMatch(/^\/portal\/analytics\/schools\/lp\?.*region=Urban-I/);

    await user.click(screen.getByTestId("breakdown-back"));
    await waitFor(() => expect(screen.queryByTestId("breakdown")).toBeNull());
    expect(where()).not.toMatch(/region=/);
  });

  it("LP engagement by subject: her band shares and LP %, then her Overall row", async () => {
    renderPage();
    const table = await find("lp-subjects-table");
    const want = fixtureLpEngagement({ ...MONTH, band: "primary" }).bySubject;
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Subject", "On-Schedule(≥60%)", "Moderate(40-59%)", "Off-Schedule(<40%)", "LP Engage",
    ]);
    for (const r of want.rows) {
      const row = screen.getByTestId(`lp-subjects-table-row-${r.subject}`);
      expect(row).toHaveTextContent(r.name);
      expect(within(row).getByTestId("cell-on")).toHaveTextContent(pct(r.onPct));
      expect(within(row).getByTestId("cell-moderate")).toHaveTextContent(pct(r.moderatePct));
      expect(within(row).getByTestId("cell-off")).toHaveTextContent(pct(r.offPct));
      expect(within(row).getByTestId("cell-lp")).toHaveTextContent(pct(r.lpPct));
    }
    const overall = screen.getByTestId("lp-subjects-table-overall");
    expect(overall).toHaveTextContent("Overall");
    expect(within(overall).getByTestId("cell-lp")).toHaveTextContent(pct(want.overall!.lpPct));
    expect(within(overall).getByTestId("cell-off")).toHaveTextContent(pct(want.overall!.offPct));
  });

  it("LP engagement by grade: Grades 1–5, every grade a row", async () => {
    renderPage();
    const table = await find("lp-grades-table");
    expect(within(table).getAllByRole("rowheader").map((th) => th.textContent)).toEqual(["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Overall"]);
    const want = fixtureLpEngagement({ ...MONTH, band: "primary" }).byGrade;
    for (const r of want.rows) {
      expect(within(screen.getByTestId(`lp-grades-table-row-${r.grade}`)).getByTestId("cell-lp")).toHaveTextContent(pct(r.lpPct));
    }
  });

  it("Mid / High: asks for that band, shows Grades 6–12, keeps it in the address", async () => {
    renderPage();
    const user = userEvent.setup();
    await find("tile-lpOverall");
    await user.click(screen.getByTestId("band-midhigh"));
    await waitFor(() => expect(h.getLpEngagement).toHaveBeenLastCalledWith({ ...MONTH, region: "all", band: "midhigh" }));
    await waitFor(() => expect(screen.getByTestId("tile-lpOverall")).toHaveTextContent("Mid / High teachers"));
    expect(where()).toMatch(/band=midhigh/);
    expect(screen.getByTestId("band-midhigh")).toHaveAttribute("aria-pressed", "true");
    expect(cardTitles()).toContain("LP Engagement by Grade — Grades 6–12");
    expect(within(screen.getByTestId("lp-grades-table")).getAllByRole("rowheader").map((th) => th.textContent)).toEqual([
      "Grade 6", "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12", "Overall",
    ]);
    const want = fixtureLpEngagement({ ...MONTH, band: "midhigh" }).overview;
    expect(screen.getByTestId("tile-lpOverall")).toHaveTextContent(pct(want.lpPct));
  });

  it("a link with ?band=midhigh opens on Mid / High", async () => {
    renderPage("/lp?band=midhigh");
    await find("tile-lpOverall");
    expect(h.getLpEngagement).toHaveBeenCalledWith({ ...MONTH, region: "all", band: "midhigh" });
    expect(screen.getByTestId("band-midhigh")).toHaveAttribute("aria-pressed", "true");
  });

  it("the sector-wise chart: a group per sector, a bar per subject, her legend; View by Grades swaps to grades", async () => {
    renderPage();
    const chart = await find("chart-lp-subjects");
    expect(testIds("group-", chart)).toEqual(SIX);
    const lp = fixtureLpEngagement({ ...MONTH, band: "primary" });
    expect(testIds("legend-", chart)).toEqual(lp.bySubject.rows.map((r) => r.subject));
    const first = lp.bySubject.rows[0];
    const bk = lp.sectorSubjects.find((s) => s.region === "B.K")!.values[first.subject];
    const bar = within(within(chart).getByTestId("group-B.K")).getAllByTestId("bar").find((b) => b.getAttribute("data-series") === first.subject)!;
    expect(bar).toHaveAttribute("title", `B.K · ${first.name}: ${pct(bk)}`);

    await userEvent.setup().selectOptions(screen.getByTestId("lp-view-by"), "grades");
    const byGrade = await find("chart-lp-grades");
    expect(within(byGrade).getByTestId("legend").textContent).toBe("Grade 1Grade 2Grade 3Grade 4Grade 5");
  });

  it("a failed LP read says so with Try again, and the rest of the page stays", async () => {
    h.getLpEngagement.mockRejectedValueOnce({ response: { status: 500 } });
    renderPage();
    expect(await find("lp-error")).toBeInTheDocument();
    expect(screen.queryByTestId("tile-lpOverall")).toBeNull();
    expect(screen.getByTestId("region-chip-all")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByTestId("lp-retry"));
    expect(await find("tile-lpOverall")).toBeInTheDocument();
  });

  it("a sector with no teachers of the band shows — for its %, never a 0 that is not true", async () => {
    h.getLpEngagement.mockImplementation(async (p: Params) => {
      const r = fixtureLpEngagement(p);
      return { ...r, regions: r.regions.map((g) => (g.region === "Tarnol"
        ? { ...g, teachers: 0, lpRatio: null, lpPct: null, onSchedule: 0, moderate: 0, offSchedule: 0, onPct: null, moderatePct: null, offPct: null }
        : g)) };
    });
    renderPage();
    const card = await find("sector-card-Tarnol");
    await waitFor(() => expect(within(card).getByTestId("ring-value")).toHaveTextContent("—"));
    expect(within(card).getByTestId("ring-value").textContent).not.toMatch(/0%/);
  });

  it("no subject table and no chart when nobody has an LP in the window (as hers)", async () => {
    h.getLpEngagement.mockImplementation(async (p: Params) => ({ ...fixtureLpEngagement(p), bySubject: { rows: [], overall: null } }));
    renderPage();
    await find("lp-grades-table");
    expect(screen.queryByTestId("lp-subjects-table")).toBeNull();
    expect(screen.queryByTestId("chart-lp-subjects")).toBeNull();
  });

  it("and on a phone the page never scrolls sideways: the tables and the chart fit", async () => {
    setWidth(390);
    renderPage();
    await find("chart-lp-subjects");
    // Nothing on the tab asks for a fixed width wider than the phone.
    for (const el of Array.from(screen.getByTestId("lp-tab").querySelectorAll<HTMLElement>("[style]"))) {
      expect(el.style.width === "" || !/px$/.test(el.style.width) || parseFloat(el.style.width) <= 358).toBe(true);
    }
  });
});
