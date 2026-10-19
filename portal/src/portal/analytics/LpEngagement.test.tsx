import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { fixtureCoaching, fixtureLpEngagement, fixtureResponse, REGION_ORDER } from "./fixtures";

/**
 * The LP Engagement tab in the ICT dashboard's sections (her LPEngagement.jsx) with ACTIVE / NON-ACTIVE teachers in
 * place of her On-Schedule / Moderate / Off-Schedule (FDE feedback, 2026-10-19), Primary and Mid / High alike: the band
 * toggle, ENGAGEMENT OVERVIEW, TEACHER STATUS (Active, Non-Active, "x of N"), SECTORS (Active % rings → schools and a
 * "No school" line), the subject and grade tables (Active, Non-Active, Active %, the tab's Overall row) and the
 * sector-wise grouped bars (Active %). Numbers come from GET /analytics/lp-engagement — the fixture is summed as the
 * server sums, so every expectation below reads it rather than repeating a number.
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

describe("LP Engagement — Active / Non-Active", () => {
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

  it("engagement overview: overall LP engagement (the Active %), teachers tracked, active sectors", async () => {
    renderPage();
    const want = fixtureLpEngagement({ ...MONTH, band: "primary" }).overview;
    const overall = await find("tile-lpOverall");
    expect(testIds("tile-").slice(0, 3)).toEqual(["lpOverall", "lpTracked", "lpActiveSectors"]);
    expect(within(overall).getByTestId("kpi-value")).toHaveTextContent(pct(want.activePct));
    expect(overall).toHaveTextContent("Overall LP Engagement");
    expect(overall).toHaveTextContent("Primary teachers who used a lesson plan");
    expect(within(screen.getByTestId("tile-lpTracked")).getByTestId("kpi-value")).toHaveTextContent(want.teachers.toLocaleString("en-US"));
    expect(screen.getByTestId("tile-lpTracked")).toHaveTextContent("The daily RDF's teachers");
    expect(within(screen.getByTestId("tile-lpActiveSectors")).getByTestId("kpi-value")).toHaveTextContent(String(want.activeSectors));
    expect(screen.getByTestId("tile-lpActiveSectors")).toHaveTextContent("Sectors with an active teacher");
    // Active + Non-Active is every teacher tracked.
    expect(want.active + want.nonActive).toBe(want.teachers);
  });

  it("teacher status: two cards, Active and Non-Active, each x of N with its share", async () => {
    renderPage();
    const want = fixtureLpEngagement({ ...MONTH, band: "primary" }).overview;
    await find("tile-lp-active");
    expect(testIds("tile-lp-")).toEqual(["active", "nonActive"]);
    const n = want.teachers.toLocaleString("en-US");
    for (const [k, x, label, hint, share] of [
      ["active", want.active, "Active Teachers", "Used a lesson plan in the period", want.activePct!],
      ["nonActive", want.nonActive, "Non-Active Teachers", "No lesson plan in the period", Math.round((100 - want.activePct!) * 10) / 10],
    ] as const) {
      const tile = screen.getByTestId(`tile-lp-${k}`);
      expect(within(tile).getByTestId("kpi-value")).toHaveTextContent(x.toLocaleString("en-US"));
      expect(tile).toHaveTextContent(label);
      expect(tile).toHaveTextContent(hint);
      expect(tile).toHaveTextContent(`of ${n} teachers`);
      expect(tile).toHaveTextContent(`${share}%`);
    }
  });

  it("no On-Schedule, Moderate or Off-Schedule anywhere on the tab, Primary or Mid / High", async () => {
    renderPage();
    await find("chart-lp-subjects");
    expect(screen.getByTestId("lp-tab").textContent).not.toMatch(/Schedule|Moderate|LP ratio/);
    await userEvent.setup().click(screen.getByTestId("band-midhigh"));
    await waitFor(() => expect(screen.getByTestId("tile-lpOverall")).toHaveTextContent("Mid / High teachers"));
    expect(screen.getByTestId("lp-tab").textContent).not.toMatch(/Schedule|Moderate|LP ratio/);
    expect(screen.queryByTestId("lp-opens-note")).toBeNull();
  });

  it("six ring cards in sector order: the sector's Active %, its Active / Non-Active with shares, its teachers", async () => {
    renderPage();
    await screen.findAllByTestId("ring-value", {}, { timeout: WAIT });
    expect(testIds("sector-card-")).toEqual(SIX);
    const want = fixtureLpEngagement({ ...MONTH, band: "primary" }).regions;
    for (const r of want) {
      const card = screen.getByTestId(`sector-card-${r.region}`);
      expect(within(card).getByTestId("ring-value")).toHaveTextContent(pct(r.activePct));
      expect(within(card).getByTestId("sector-teachers")).toHaveTextContent(String(r.teachers));
      const off = r.activePct === null ? null : Math.round((100 - r.activePct) * 10) / 10;
      expect(within(card).getByTestId("group-line-active")).toHaveTextContent(`Active${r.active}${r.active > 0 ? `(${r.activePct}%)` : ""}`);
      expect(within(card).getByTestId("group-line-nonActive")).toHaveTextContent(`Non-Active${r.nonActive}${r.nonActive > 0 ? `(${off}%)` : ""}`);
      expect(r.active + r.nonActive).toBe(r.teachers);
    }
  });

  it("a sector card opens its schools in place — Active, Non-Active, Active % — then its No school line; Back returns", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(await find("sector-card-Urban-I"));
    await waitFor(() => expect(h.getLpEngagement).toHaveBeenLastCalledWith({ ...MONTH, region: "Urban-I", band: "primary" }));
    const table = await find("lp-schools-table");
    const want = fixtureLpEngagement({ ...MONTH, region: "Urban-I", band: "primary" }).schools;
    expect(want.length).toBeGreaterThan(1);
    expect(want[want.length - 1].schoolId).toBeNull();
    expect(within(table).getAllByTestId("school-name").map((n) => n.textContent)).toEqual(want.map((s) => s.name ?? "No school"));
    for (const s of want) {
      const row = screen.getByTestId(`lp-school-row-${s.schoolId ?? "none"}`);
      expect(within(row).getByTestId("cell-active")).toHaveTextContent(String(s.active));
      expect(within(row).getByTestId("cell-nonActive")).toHaveTextContent(String(s.nonActive));
      expect(within(row).getByTestId("cell-lp")).toHaveTextContent(pct(s.activePct));
    }
    expect(screen.getByTestId("lp-school-row-none")).toHaveTextContent("No school on FDE's list");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["School Name", "Active", "Non-Active", "LP Engagement"]);
    expect(screen.getByTestId("sector-card-Urban-I")).toHaveAttribute("aria-pressed", "true");
    expect(where()).toMatch(/^\/portal\/analytics\/schools\/lp\?.*region=Urban-I/);

    await user.click(screen.getByTestId("breakdown-back"));
    await waitFor(() => expect(screen.queryByTestId("breakdown")).toBeNull());
    expect(where()).not.toMatch(/region=/);
  });

  it("LP engagement by subject: Active and Non-Active teachers and the Active % per subject, then the tab's Overall", async () => {
    renderPage();
    const table = await find("lp-subjects-table");
    const lp = fixtureLpEngagement({ ...MONTH, band: "primary" });
    const want = lp.bySubject;
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Subject", "Active", "Non-Active", "LP Engage"]);
    for (const r of want.rows) {
      const row = screen.getByTestId(`lp-subjects-table-row-${r.subject}`);
      expect(row).toHaveTextContent(r.name);
      expect(within(row).getByTestId("cell-active")).toHaveTextContent(String(r.active));
      expect(within(row).getByTestId("cell-nonActive")).toHaveTextContent(r.nonActive.toLocaleString("en-US"));
      expect(within(row).getByTestId("cell-lp")).toHaveTextContent(pct(r.activePct));
      // Every row is out of the whole band.
      expect(r.teachers).toBe(lp.overview.teachers);
    }
    const overall = screen.getByTestId("lp-subjects-table-overall");
    expect(overall).toHaveTextContent("Overall");
    expect(within(overall).getByTestId("cell-lp")).toHaveTextContent(pct(lp.overview.activePct));
    expect(within(overall).getByTestId("cell-active")).toHaveTextContent(lp.overview.active.toLocaleString("en-US"));
  });

  it("LP engagement by grade: Grades 1–5, every grade a row", async () => {
    renderPage();
    const table = await find("lp-grades-table");
    expect(within(table).getAllByRole("rowheader").map((th) => th.textContent)).toEqual(["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Overall"]);
    const want = fixtureLpEngagement({ ...MONTH, band: "primary" }).byGrade;
    for (const r of want.rows) {
      const row = screen.getByTestId(`lp-grades-table-row-${r.grade}`);
      expect(within(row).getByTestId("cell-lp")).toHaveTextContent(pct(r.activePct));
      expect(within(row).getByTestId("cell-active")).toHaveTextContent(String(r.active));
    }
    expect(within(screen.getByTestId("lp-grades-table-overall")).getByTestId("cell-lp")).toHaveTextContent(pct(want.overall!.activePct));
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
    expect(screen.getByTestId("tile-lpOverall")).toHaveTextContent(pct(want.activePct));
    expect(screen.getByTestId("tile-lp-active")).toHaveTextContent(`of ${want.teachers.toLocaleString("en-US")} teachers`);
  });

  it("a link with ?band=midhigh opens on Mid / High", async () => {
    renderPage("/lp?band=midhigh");
    await find("tile-lpOverall");
    expect(h.getLpEngagement).toHaveBeenCalledWith({ ...MONTH, region: "all", band: "midhigh" });
    expect(screen.getByTestId("band-midhigh")).toHaveAttribute("aria-pressed", "true");
  });

  it("the sector-wise chart: a group per sector, a bar per subject at its Active %, her legend; View by Grades swaps", async () => {
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
        ? { ...g, teachers: 0, active: 0, nonActive: 0, activePct: null }
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
