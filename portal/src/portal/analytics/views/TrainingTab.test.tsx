import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { fixtureCoaching, fixtureResponse, REGION_ORDER } from "../fixtures";
import { fixtureTrainingLevels } from "../trainingLevelsFixture";

/**
 * bd-97x22y.4 — the Trainings tab, the ICT dashboard's page 1 to 1 (PLAN v7 "Trainings"; hers: frontend/src/pages/
 * Trainings.jsx, components/shared/TrainingLevelCard.jsx + TrainingComparisonChart.jsx). Her sections in her order:
 * the Primary / Mid-High toggle, her filter bar (Training Level), TRAINING LEVEL PROGRESS (a card per level: Passed /
 * In Progress / Not Started, % passed, "What is this level?"), TRAINING COMPLETION — SECTOR COMPARISON (grouped bars,
 * % of teachers who passed each level, per sector), SECTORS (N of M teachers have passed all levels, passed per
 * level → the sector's schools), About Training Levels. Her percentages and colours (operator: "fully 1 to 1").
 *
 * Its numbers are its own read (GET /analytics/training-levels: all time, a snapshot — "as of" its time).
 */
const h = vi.hoisted(() => ({
  getSchools: vi.fn(),
  getCoaching: vi.fn(),
  getTrainingLevels: vi.fn(),
}));

vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({
    user: { firstName: "FDE Islamabad", lastName: null, phoneNumber: "923000000000", role: "unregistered", analyticsOnly: true },
    loading: false,
    logout: vi.fn(),
  }),
}));
vi.mock("../../services/api", async (orig) => ({
  ...(await orig<typeof import("../../services/api")>()),
  analytics: { getSchools: h.getSchools, getCoaching: h.getCoaching },
  trainingLevelsAnalytics: { get: h.getTrainingLevels },
}));

import SchoolsAnalytics from "../SchoolsAnalytics";

type TLParams = { region: string | null; band: "primary" | "midhigh" };

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

function renderTab(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/portal/analytics/schools/training${search}`]}>
      <Routes>
        <Route path="/portal/analytics/schools/:tab?" element={<SchoolsAnalytics />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const SIX = [...REGION_ORDER];
const eyebrows = () => screen.getAllByTestId("eyebrow").map((e) => e.textContent);
const levelCards = () => screen.getAllByTestId(/^level-card-/).map((el) => el.getAttribute("data-testid"));
const ready = () => screen.findByTestId("level-card-0");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T16:00:00+05:00"));
  setWidth(1440);
  h.getSchools.mockImplementation(async (p: { region?: string | null }) => fixtureResponse(p));
  h.getCoaching.mockImplementation(async (p: { region?: string | null }) => fixtureCoaching(p));
  h.getTrainingLevels.mockImplementation(async (p: TLParams) => fixtureTrainingLevels(p));
});
afterEach(() => vi.useRealTimers());

describe("her sections, in her order", () => {
  it("the toggle, the filter bar, then Training level progress, the sector comparison, Sectors, About Training Levels", async () => {
    renderTab();
    await ready();
    expect(eyebrows()).toEqual(["Training level progress", "Training completion — sector comparison", "Sectors"]);
    const order = ["training-bands", "training-filters", "section-training-progress", "section-training-chart", "section-training-sectors", "training-about"]
      .map((id) => screen.getByTestId(id));
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("asks for Primary, all regions, by default; and says the numbers are all time, as of the snapshot", async () => {
    renderTab();
    await ready();
    expect(h.getTrainingLevels).toHaveBeenCalledWith({ region: null, band: "primary" });
    // 10:51 UTC = 3:51 PM in Pakistan
    expect(screen.getByTestId("training-as-of")).toHaveTextContent("All time · as of 14 Oct 2026, 3:51 PM");
  });

  it("the region in the address is the region it asks for", async () => {
    renderTab("?region=Sihala");
    await ready();
    expect(h.getTrainingLevels).toHaveBeenCalledWith({ region: "Sihala", band: "primary" });
  });

  it("the v6 module counts are gone from this tab", async () => {
    renderTab();
    await ready();
    expect(screen.queryByTestId("tile-trainingModules")).toBeNull();
    expect(screen.queryByTestId("chart-trainingModules")).toBeNull();
  });
});

describe("Primary / Mid-High toggle", () => {
  it("Primary first and on; Mid / High asks for the middle and high teachers", async () => {
    renderTab();
    await ready();
    const primary = screen.getByTestId("band-primary");
    const midhigh = screen.getByTestId("band-midhigh");
    expect(primary).toHaveTextContent("Primary Teachers");
    expect(midhigh).toHaveTextContent("Mid / High Teachers");
    expect(primary).toHaveAttribute("aria-pressed", "true");
    expect(midhigh).toHaveAttribute("aria-pressed", "false");
    await userEvent.setup().click(midhigh);
    await waitFor(() => expect(h.getTrainingLevels).toHaveBeenLastCalledWith({ region: null, band: "midhigh" }));
    expect(await screen.findByTestId("partner-oxbridge")).toBeInTheDocument();
    expect(screen.getByTestId("band-midhigh")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Mid / High — the programmes, under NIETE's short names", () => {
  async function midHigh() {
    renderTab();
    await ready();
    await userEvent.setup().click(screen.getByTestId("band-midhigh"));
    await screen.findByTestId("partner-oxbridge");
  }
  const mh = () => fixtureTrainingLevels({ band: "midhigh" });

  it("its sections: Training Programmes (no level progress section), the sector comparison, Sectors", async () => {
    await midHigh();
    expect(eyebrows()).toEqual(["Training Programmes", "Training completion — sector comparison", "Sectors"]);
    expect(screen.queryByTestId("section-training-progress")).toBeNull();
  });

  it("four programme buttons under NIETE's short names, closed, each with its summary line", async () => {
    await midHigh();
    const p = mh().overview.partners!;
    expect(["oxbridge", "niete", "beaconhouse", "isaps"].map((id) => screen.getByTestId(`partner-${id}`).textContent)).toEqual([
      `Game-Based Teaching (GBTLA)${p.oxbridge.passed} passed · ${p.oxbridge.inProgress} in progress`,
      "NIETE TrainingsSkilled Practitioner & Teacher Leader",
      `AI-Powered Subject Pedagogy${p.beaconhouse.passed} passed · ${p.beaconhouse.inProgress} in progress`,
      `Teacher Development Programme${p.isaps.passed} passed · ${p.isaps.inProgress} in progress`,
    ]);
    for (const id of ["oxbridge", "niete", "beaconhouse", "isaps"]) expect(screen.getByTestId(`partner-${id}`)).toHaveAttribute("aria-expanded", "false");
  });

  it("Teacher Development Programme (I-SAPS): its card, the modules chart, the table ending with Completed all; the full NIETE name under What is this?", async () => {
    await midHigh();
    await userEvent.setup().click(screen.getByTestId("partner-isaps"));
    const panel = screen.getByTestId("partner-panel-isaps");
    const is = mh().overview.partners!.isaps;
    const card = within(panel).getByTestId("partner-card-isaps");
    expect(within(card).getByTestId("level-name")).toHaveTextContent("Teacher Development Programme");
    expect(within(card).getByTestId("count-passed")).toHaveTextContent(String(is.passed));
    expect(within(card).getByTestId("count-inProgress")).toHaveTextContent(String(is.inProgress));
    expect(within(panel).getByTestId("chart-isaps")).toBeInTheDocument();
    const rows = within(panel).getAllByTestId("row-isaps");
    expect(rows).toHaveLength(10);
    expect(rows[0]).toHaveTextContent(`MODULE#1${is.modules[0].middle}${is.modules[0].high}${is.modules[0].total}`);
    expect(rows[9]).toHaveTextContent(`Completed all${is.completedAll.middle}${is.completedAll.high}${is.completedAll.total}`);
    expect(within(panel).getByRole("columnheader", { name: "Module" })).toBeInTheDocument();
    await userEvent.setup().click(within(card).getByTestId("level-what"));
    expect(within(card).getByTestId("level-definition")).toHaveTextContent("not part of “passed all levels”");
    expect(within(card).getByTestId("definition-title")).toHaveTextContent("NIETE: Teacher Development Programme, 9-12 · delivered by I-SAPS");
    expect(within(card).getByTestId("count-notStarted")).toHaveTextContent(String(is.notStarted));
  });

  it("Game-Based Teaching (GBTLA, Oxbridge): its card, the sessions chart, the table ending with Completed all; the full NIETE name", async () => {
    await midHigh();
    await userEvent.setup().click(screen.getByTestId("partner-oxbridge"));
    const panel = screen.getByTestId("partner-panel-oxbridge");
    const ox = mh().overview.partners!.oxbridge;
    const card = within(panel).getByTestId("partner-card-oxbridge");
    expect(within(card).getByTestId("level-name")).toHaveTextContent("Game-Based Teaching (GBTLA)");
    expect(within(card).getByTestId("count-passed")).toHaveTextContent(String(ox.passed));
    expect(within(card).getByTestId("level-pct")).toHaveTextContent(`${Math.round((ox.passed / ox.teachers) * 100)}%`);
    expect(within(panel).getByTestId("chart-oxbridge")).toBeInTheDocument();
    const rows = within(panel).getAllByTestId("row-oxbridge");
    expect(rows).toHaveLength(8);
    expect(rows[0]).toHaveTextContent(`SESSION#1${ox.sessions[0].middle}${ox.sessions[0].high}${ox.sessions[0].total}`);
    expect(rows[7]).toHaveTextContent(`Completed all${ox.completedAll.middle}${ox.completedAll.high}${ox.completedAll.total}`);
    await userEvent.setup().click(within(card).getByTestId("level-what"));
    expect(within(card).getByTestId("level-definition")).toHaveTextContent("Session 7");
    expect(within(card).getByTestId("definition-title")).toHaveTextContent("Smart Schools Project: Game-Based Teaching, Learning and Assessment (GBTLA), 6-10 · delivered by Oxbridge");
  });

  it("NIETE: the (NIETE) Skilled Practitioner and Teacher Leader cards and her per-sector table", async () => {
    await midHigh();
    await userEvent.setup().click(screen.getByTestId("partner-niete"));
    const panel = screen.getByTestId("partner-panel-niete");
    expect(within(panel).getByTestId("level-card-2")).toBeInTheDocument();
    expect(within(within(panel).getByTestId("level-card-2")).getByTestId("level-name")).toHaveTextContent("(NIETE) Skilled Practitioner");
    expect(within(within(panel).getByTestId("level-card-3")).getByTestId("level-name")).toHaveTextContent("(NIETE) Teacher Leader");
    const rows = within(panel).getAllByTestId("row-niete");
    expect(rows.map((r) => r.firstChild!.textContent)).toEqual(SIX);
  });

  it("AI-Powered Subject Pedagogy (Beaconhouse): its card with its courses, the subjects chart, the table and unique teachers", async () => {
    await midHigh();
    await userEvent.setup().click(screen.getByTestId("partner-beaconhouse"));
    const panel = screen.getByTestId("partner-panel-beaconhouse");
    const bh = mh().overview.partners!.beaconhouse;
    expect(within(panel).getAllByTestId("row-beaconhouse").map((r) => r.firstChild!.textContent)).toEqual(["English", "Mathematics", "General Science", "Computer Science"]);
    expect(within(panel).getByTestId("unique-beaconhouse")).toHaveTextContent(`Unique teachers (any level)a teacher may appear in multiple levels above${bh.passed}`);
    const card = within(panel).getByTestId("partner-card-beaconhouse");
    await userEvent.setup().click(within(card).getByTestId("level-what"));
    expect(within(card).getAllByTestId("level-course").map((x) => x.querySelector("span span")!.textContent)).toEqual(["English", "Mathematics", "General Science", "Computer Science"]);
    expect(within(card).getByTestId("level-name")).toHaveTextContent("AI-Powered Subject Pedagogy");
    expect(within(card).getByTestId("definition-title")).toHaveTextContent("NIETE: AI-Powered Subject Pedagogy, 6-10 · delivered by Beaconhouse");
  });

  it("the Training Level filter opens the panel that holds the choice", async () => {
    await midHigh();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByTestId("filter-training-level"), "3");
    const panel = screen.getByTestId("partner-panel-niete");
    expect(within(panel).queryByTestId("level-card-2")).toBeNull();
    expect(within(panel).getByTestId("level-card-3")).toBeInTheDocument();
    await user.selectOptions(screen.getByTestId("filter-training-level"), "beaconhouse");
    expect(screen.getByTestId("partner-panel-beaconhouse")).toBeInTheDocument();
    await user.selectOptions(screen.getByTestId("filter-training-level"), "isaps");
    expect(screen.getByTestId("partner-panel-isaps")).toBeInTheDocument();
    expect(within(screen.getByTestId("filter-training-level")).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All", "Game-Based Teaching (GBTLA)", "NIETE — Skilled Practitioner", "NIETE — Teacher Leader", "AI-Powered Subject Pedagogy", "Teacher Development Programme",
    ]);
  });

  it("the chart and sector rows: (NIETE) Skilled Practitioner, (NIETE) Teacher Leader, then the three programmes; each % of its own teachers", async () => {
    await midHigh();
    const chart = screen.getByTestId("chart-trainingLevels");
    expect(within(chart).getAllByTestId("legend-item").map((i) => i.textContent)).toEqual([
      "(NIETE) Skilled Practitioner", "(NIETE) Teacher Leader", "Game-Based Teaching (GBTLA)", "AI-Powered Subject Pedagogy", "Teacher Development Programme",
    ]);
    const r = mh().regions.find((x) => x.region === "Urban-I")!;
    expect(within(chart).getByTestId("bar-Urban-I-oxbridge").getAttribute("title")).toContain(`(${r.partners!.oxbridge.passed} of ${r.teachers} teachers)`);
    // the Teacher Development Programme counts the teachers assigned it, not every middle/high teacher
    expect(r.partners!.isaps.teachers).not.toBe(r.teachers);
    expect(within(chart).getByTestId("bar-Urban-I-isaps").getAttribute("title")).toContain(`(${r.partners!.isaps.passed} of ${r.partners!.isaps.teachers} teachers)`);
    const card = screen.getByTestId("sector-card-Urban-I");
    expect(within(card).getAllByTestId(/^sector-level-/).map((x) => x.textContent)).toEqual([
      `(NIETE) Skilled Practitioner${r.levels[0].passed} passed`,
      `(NIETE) Teacher Leader${r.levels[1].passed} passed`,
      `Game-Based Teaching (GBTLA)${r.partners!.oxbridge.passed} passed`,
      `AI-Powered Subject Pedagogy${r.partners!.beaconhouse.passed} passed`,
      `Teacher Development Programme${r.partners!.isaps.passed} passed`,
    ]);
    expect(card).toHaveTextContent(`of ${r.teachers} teachers have passed all levels`);
    expect(within(card).getByTestId("passed-all")).toHaveTextContent(String(r.passedAll));
  });
});

describe("Training level progress", () => {
  it("a card per level: Passed / In Progress / Not Started and the % passed", async () => {
    renderTab();
    await ready();
    expect(levelCards()).toEqual(["level-card-0", "level-card-1", "level-card-2", "level-card-3"]);
    const want = fixtureTrainingLevels({ band: "primary" }).overview.levels[0];
    const card = screen.getByTestId("level-card-0");
    expect(within(card).getByTestId("level-label")).toHaveTextContent("Beginning Teacher");
    expect(within(card).getByTestId("level-name")).toHaveTextContent("Aspiring Teacher");
    expect(within(card).getByTestId("count-passed")).toHaveTextContent(want.passed.toLocaleString("en-US"));
    expect(within(card).getByTestId("count-inProgress")).toHaveTextContent(String(want.inProgress));
    expect(within(card).getByTestId("count-notStarted")).toHaveTextContent(String(want.notStarted));
    expect(card).toHaveTextContent("Passed");
    expect(card).toHaveTextContent("In Progress");
    expect(card).toHaveTextContent("Not Started");
    expect(within(card).getByTestId("level-pct")).toHaveTextContent(`${Math.round((want.passed / want.teachers) * 100)}%`);
  });

  it("her level colours: blue, green, amber, violet", async () => {
    renderTab();
    await ready();
    const colours = ["level-card-0", "level-card-1", "level-card-2", "level-card-3"].map((id) => screen.getByTestId(id).getAttribute("data-color"));
    expect(colours).toEqual(["#3B82F6", "#47ba7c", "#F59E0B", "#8B5CF6"]);
  });

  it("What is this level? opens her definition and what is covered", async () => {
    renderTab();
    await ready();
    const card = screen.getByTestId("level-card-3");
    const toggle = within(card).getByTestId("level-what");
    expect(toggle).toHaveTextContent("What is this level?");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.setup().click(toggle);
    expect(toggle).toHaveTextContent("Hide definition");
    const def = within(card).getByTestId("level-definition");
    expect(def).toHaveTextContent("Develops school-wide leadership and peer mentoring capabilities.");
    expect(def).toHaveTextContent("What is covered");
    expect(def).toHaveTextContent("PP");
  });

  it("the Training Level filter shows that level's card only (as hers)", async () => {
    renderTab();
    await ready();
    await userEvent.setup().selectOptions(screen.getByTestId("filter-training-level"), "2");
    expect(levelCards()).toEqual(["level-card-2"]);
    // her filter narrows the cards, not the sector comparison
    expect(screen.getAllByTestId(/^bar-B\.K-/)).toHaveLength(4);
  });
});

describe("Training completion — sector comparison", () => {
  it("grouped bars: a group per sector in sector order, then No sector; a bar per level, % of teachers passed over each", async () => {
    renderTab();
    const chart = await screen.findByTestId("chart-trainingLevels");
    expect(within(chart).getAllByTestId(/^group-/).map((g) => g.getAttribute("data-testid"))).toEqual([...SIX, "__no-sector"].map((r) => `group-${r}`));
    const ans = fixtureTrainingLevels({ band: "primary" });
    for (const r of ans.regions) {
      for (const l of r.levels) {
        const bar = within(chart).getByTestId(`bar-${r.region}-${l.levelOrder}`);
        // hers: % of the SECTOR's teachers (TrainingComparisonChart.jsx: passed ÷ sector.total_teachers)
        const pct = r.teachers ? `${Math.round((l.passed / r.teachers) * 100)}%` : "";
        expect(within(bar).getByTestId("bar-label").textContent).toBe(pct);
        expect(bar.getAttribute("title")).toContain(`(${l.passed} of ${r.teachers} teachers)`);
      }
    }
  });

  it("her legend and axis: the four levels (NIETE-named from Skilled Practitioner), % of Teachers", async () => {
    renderTab();
    const chart = await screen.findByTestId("chart-trainingLevels");
    expect(within(chart).getAllByTestId("legend-item").map((i) => i.textContent)).toEqual([
      "Aspiring Teacher", "Emerging Practitioner", "(NIETE) Skilled Practitioner", "(NIETE) Teacher Leader",
    ]);
    expect(chart).toHaveTextContent("% of Teachers");
    expect(within(chart).getAllByTestId("y-tick").map((t) => t.textContent)).toEqual(["100%", "75%", "50%", "25%", "0%"]);
  });
});

describe("Sectors", () => {
  it("a card per sector: N of M teachers have passed all levels, and passed per level", async () => {
    renderTab();
    await ready();
    const r = fixtureTrainingLevels({ band: "primary" }).regions.find((x) => x.region === "Urban-I")!;
    const card = screen.getByTestId("sector-card-Urban-I");
    expect(within(card).getByTestId("passed-all")).toHaveTextContent(String(r.passedAll));
    expect(card).toHaveTextContent(`of ${r.teachers} teachers have passed all levels`);
    const rows = within(card).getAllByTestId(/^sector-level-/);
    expect(rows.map((x) => x.textContent)).toEqual([
      `Aspiring Teacher${r.levels[0].passed} passed`,
      `Emerging Practitioner${r.levels[1].passed} passed`,
      `Skilled Practitioner${r.levels[2].passed} passed`,
      `Teacher Leader${r.levels[3].passed} passed`,
    ]);
    expect(card).toHaveTextContent("View Details");
  });

  it("View Details opens the sector's schools: name, EMIS, passed all levels, teachers", async () => {
    renderTab();
    await ready();
    await userEvent.setup().click(screen.getByTestId("sector-card-Urban-I"));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toMatch(/region=Urban-I/));
    await waitFor(() => expect(h.getTrainingLevels).toHaveBeenLastCalledWith({ region: "Urban-I", band: "primary" }));
    const list = await screen.findByTestId("training-schools");
    const want = fixtureTrainingLevels({ band: "primary", region: "Urban-I" }).schools;
    const rows = within(list).getAllByTestId("training-school");
    expect(rows.map((row) => within(row).getByTestId("school-name").textContent)).toEqual(want.map((s) => s.name));
    const first = rows[0];
    expect(first).toHaveTextContent(`EMIS ${want[0].emis}`);
    expect(within(first).getByTestId("school-passed")).toHaveTextContent(String(want[0].passedAll));
    expect(within(first).getByTestId("school-teachers")).toHaveTextContent(String(want[0].teachers));
    expect(screen.getByTestId("sector-card-Urban-I")).toHaveTextContent("Hide schools");
  });
});

describe("About Training Levels", () => {
  it("closed at first; opens her four levels and how the numbers are counted", async () => {
    renderTab();
    await ready();
    const toggle = screen.getByTestId("training-about-toggle");
    expect(toggle).toHaveTextContent("About Training Levels");
    expect(screen.queryByTestId("training-about-panel")).toBeNull();
    await userEvent.setup().click(toggle);
    const panel = screen.getByTestId("training-about-panel");
    expect(panel).toHaveTextContent("Aspiring Teacher (Level 0):");
    expect(panel).toHaveTextContent("Teacher Leader (Level 3):");
    expect(panel).toHaveTextContent(/Passed all levels/);
  });
});

describe("v8 — the RDF's population, sectors and FDE's schools", () => {
  it("the filter bar says who is counted: the programme's teachers, as the RDF counts them", async () => {
    renderTab();
    await ready();
    const n = fixtureTrainingLevels({ band: "primary" }).overview.teachers;
    expect(screen.getByTestId("training-population")).toHaveTextContent(
      `${n.toLocaleString("en-US")} teachers on NIETE's primary programme (any role, any school), as the RDF counts them`,
    );
    await userEvent.setup().click(screen.getByTestId("band-midhigh"));
    await screen.findByTestId("partner-oxbridge");
    expect(screen.getByTestId("training-population")).toHaveTextContent("on NIETE's middle and high programme");
  });

  it("a No sector card after the six (not a choice), with its passed-all line, rows and why; and a No sector group in the chart", async () => {
    renderTab();
    await ready();
    const ns = fixtureTrainingLevels({ band: "primary" }).noSector;
    const card = screen.getByTestId("sector-card-no-sector");
    expect(card.tagName).not.toBe("BUTTON");
    expect(card).toHaveTextContent("No sector");
    expect(card).toHaveTextContent(`of ${ns.teachers} teachers have passed all levels`);
    expect(within(card).getByTestId("passed-all")).toHaveTextContent(String(ns.passedAll));
    expect(within(card).getAllByTestId(/^no-sector-level-/)).toHaveLength(4);
    expect(within(card).getByTestId("no-sector-note")).toHaveTextContent("the RDF gives them no sector");
    const chart = screen.getByTestId("chart-trainingLevels");
    expect(within(chart).getByTestId("bar-__no-sector-0").getAttribute("title")).toContain(`(${ns.levels[0].passed} of ${ns.teachers} teachers)`);
  });

  it("a sector's teachers at no school on FDE's list are one No school row, after its schools", async () => {
    renderTab("?region=B.K");
    await ready();
    const rows = within(screen.getByTestId("training-schools")).getAllByTestId("training-school");
    const last = rows[rows.length - 1];
    expect(within(last).getByTestId("school-name")).toHaveTextContent("No school");
    expect(last).toHaveTextContent("Not at a school on FDE's list");
  });

  it("About and the Information words say Passed is the certificate and who is counted", async () => {
    renderTab();
    await ready();
    await userEvent.setup().click(screen.getByTestId("training-about-toggle"));
    const panel = screen.getByTestId("training-about-panel");
    expect(panel).toHaveTextContent("everyone on NIETE's primary training programme, whatever their role and school, as the RDF counts them");
    expect(panel).toHaveTextContent("Passed: holds the level's certificate.");
    expect(panel).not.toHaveTextContent("or passed its exam");
  });
});

describe("states", () => {
  it("a failed read says so, with a retry that reads again", async () => {
    h.getTrainingLevels.mockRejectedValueOnce({ response: { status: 500 } });
    renderTab();
    expect(await screen.findByTestId("training-error")).toBeInTheDocument();
    expect(screen.queryByTestId("level-card-0")).toBeNull();
    await userEvent.setup().click(screen.getByTestId("training-retry"));
    expect(await screen.findByTestId("level-card-0")).toBeInTheDocument();
    expect(h.getTrainingLevels).toHaveBeenCalledTimes(2);
  });

  it("is read only on this tab, and the coaching read is not made here", async () => {
    renderTab();
    await ready();
    expect(h.getCoaching).not.toHaveBeenCalled();
  });

  it("every % on the tab is a % passed (her presentation), never a score or a count", async () => {
    renderTab("?region=Urban-I");
    await ready();
    await screen.findByTestId("training-schools");
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const bad: string[] = [];
    let seen = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!(n.textContent || "").includes("%")) continue;
      seen += 1;
      const host = (n.parentElement as HTMLElement).closest("[data-pct], [data-axis]");
      if (!host) bad.push(n.textContent!);
    }
    expect(seen).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  it("on a phone: the same sections, one level card per row", async () => {
    setWidth(390);
    renderTab();
    await ready();
    expect(eyebrows()).toEqual(["Training level progress", "Training completion — sector comparison", "Sectors"]);
    expect(screen.getByTestId("level-cards").className).toMatch(/(^|\s)grid-cols-1(\s|$)/);
  });
});
