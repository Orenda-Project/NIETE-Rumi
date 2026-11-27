import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { analyticsCopy } from "./copy";
import { fixtureCoaching, fixtureObservations, fixtureResponse, REGION_ORDER } from "./fixtures";
import type { ObserverAnalyticsResponse, ObserverCounts, SchoolsAnalyticsResponse } from "../types/portal";

/**
 * bd-97daxo.33 — Moawin's (Gilgit-Baltistan's) view: observations by who observed whom, FICO17 v6 as the main
 * score, Gilgit and Baltistan as areas. Moawin's head office (17 Nov) asked; the operator approved options A, A, A:
 *   1. two observer cards, principals first        2. v6 is the headline, V3 and HOTS in a note
 *   3. area chips in the filter + side-by-side area cards
 * Names: FMOs by name, principals by role only, teachers never. FDE's view does not change (and never asks for it).
 */
const h = vi.hoisted(() => ({
  getSchools: vi.fn(), getCoaching: vi.fn(), getLpEngagement: vi.fn(), getScope: vi.fn(),
  getTrainingLevels: vi.fn(), getObservations: vi.fn(), getObservers: vi.fn(), logout: vi.fn(),
}));
vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ user: { firstName: "Moawin HO", lastName: null, phoneNumber: "analytics:moawin-ho", role: "unregistered", analyticsOnly: true }, loading: false, logout: h.logout }),
}));
vi.mock("../services/api", async (orig) => ({
  ...(await orig<typeof import("../services/api")>()),
  analytics: { getSchools: h.getSchools, getCoaching: h.getCoaching, getLpEngagement: h.getLpEngagement, getScope: h.getScope },
  trainingLevelsAnalytics: { get: h.getTrainingLevels },
  observationsAnalytics: { get: h.getObservations },
  observersAnalytics: { get: h.getObservers },
}));
import SchoolsAnalytics from "./SchoolsAnalytics";

const GB = "Gilgit-Baltistan";
const AREAS = ["Gilgit", "Baltistan"];
const MOAWIN = {
  success: true, organization: "moawin", regions: [GB], areas: AREAS,
  areaDistricts: { Gilgit: ["Gilgit", "Diamer", "Astore", "Ghizer", "Darel"], Baltistan: ["Skardu", "Shigar", "Ghanche", "Kharmang"] },
};

const counts = (o: Partial<ObserverCounts> = {}): ObserverCounts => ({
  observations: 0, byObserver: { principal: 0, fmo: 0, other: 0 },
  pairs: { principalTeacher: 0, principalPrincipal: 0, fmoTeacher: 0, fmoPrincipal: 0, otherTeacher: 0, otherPrincipal: 0 },
  observers: { principal: 0, fmo: 0 }, teachersObserved: 0, principalsObserved: 0, teachers: 0, principals: 0,
  v6: { avg: null, n: 0, sections: { c: { avg: null, n: 0 }, d: { avg: null, n: 0 }, f: { avg: null, n: 0 } } },
  v3: { avg: null, n: 0 }, hots: 0, fde612: 0, unscored: 0, awaitingReview: { principal: 0, fmo: 0, other: 0 }, ...o,
});
const GILGIT = counts({
  observations: 20, byObserver: { principal: 0, fmo: 20, other: 0 }, pairs: { ...counts().pairs, fmoTeacher: 18, fmoPrincipal: 2 },
  observers: { principal: 0, fmo: 3 }, teachersObserved: 13, principalsObserved: 2, teachers: 17, principals: 3,
  v6: { avg: 61.8, n: 2, sections: { c: { avg: 62.5, n: 2 }, d: { avg: 43.8, n: 2 }, f: { avg: 75, n: 2 } } },
  v3: { avg: 67.6, n: 9 }, hots: 9,
});
const BALTISTAN = counts({
  observations: 21, byObserver: { principal: 5, fmo: 16, other: 0 }, pairs: { ...counts().pairs, principalTeacher: 5, fmoTeacher: 9, fmoPrincipal: 7 },
  observers: { principal: 3, fmo: 2 }, teachersObserved: 13, principalsObserved: 5, teachers: 84, principals: 20,
  v3: { avg: 69.2, n: 6 }, hots: 15, awaitingReview: { principal: 1, fmo: 0, other: 0 },
});
const OVERVIEW = counts({
  observations: 41, byObserver: { principal: 5, fmo: 36, other: 0 }, pairs: { ...counts().pairs, principalTeacher: 5, fmoTeacher: 27, fmoPrincipal: 9 },
  observers: { principal: 3, fmo: 5 }, teachersObserved: 26, principalsObserved: 7, teachers: 101, principals: 23,
  v6: GILGIT.v6, v3: { avg: 68.2, n: 15 }, hots: 24, awaitingReview: { principal: 1, fmo: 0, other: 0 },
});
function observers(region: string | null): ObserverAnalyticsResponse {
  const nar = {
    ...counts({ observations: 3, byObserver: { principal: 2, fmo: 1, other: 0 }, pairs: { ...counts().pairs, principalTeacher: 2, fmoTeacher: 1 }, teachersObserved: 2, teachers: 10, principals: 1, hots: 2, v3: { avg: 70, n: 1 } }),
    schoolId: "b1", emis: "632003", name: "Nar Shigar", region: "Baltistan", district: "Shigar",
    visits: [
      { date: "2026-11-05", observer: "principal" as const, observerName: null, observed: "teacher" as const, rubric: "hots" as const, pct: null },
      { date: "2026-11-05", observer: "principal" as const, observerName: null, observed: "teacher" as const, rubric: "hots" as const, pct: null },
      { date: "2026-11-12", observer: "fmo" as const, observerName: "Kamal Testwala", observed: "teacher" as const, rubric: "v3" as const, pct: 70 },
    ],
  };
  const qumra = { ...counts({ teachers: 10, principals: 1 }), schoolId: "b2", emis: "54026", name: "Qumra", region: "Baltistan", district: "Skardu", visits: [] };
  const warza = {
    ...counts({ observations: 2, byObserver: { principal: 0, fmo: 2, other: 0 }, pairs: { ...counts().pairs, fmoTeacher: 2 }, teachersObserved: 2, teachers: 6, principals: 1, v6: GILGIT.v6 }),
    schoolId: "g1", emis: "11676", name: "Warza Basin", region: "Gilgit", district: "Gilgit",
    visits: [
      { date: "2026-11-17", observer: "fmo" as const, observerName: "Rafiq Testwala", observed: "teacher" as const, rubric: "v6" as const, pct: 67.6 },
      { date: "2026-11-17", observer: "fmo" as const, observerName: "Rafiq Testwala", observed: "teacher" as const, rubric: "v6" as const, pct: 55.9 },
    ],
  };
  const all = [warza, nar, qumra];
  const schools = region ? all.filter((s) => s.region === region) : all;
  const ov = region === "Baltistan" ? BALTISTAN : region === "Gilgit" ? GILGIT : OVERVIEW;
  return {
    success: true, range: { from: "2026-11-01", to: "2026-11-17" },
    overview: { ...ov, schools: region === "Baltistan" ? 12 : region === "Gilgit" ? 3 : 15, areasActive: region ? 1 : 2 },
    regions: [{ ...GILGIT, region: "Gilgit", schools: 3 }, { ...BALTISTAN, region: "Baltistan", schools: 12 }],
    schools,
  };
}
const row = (region: string, schools: number, teachers: number, lps: number, dc: number, human: number, modules: number) => ({
  region, schools, teachers, lpsOpened: lps, teachersOpenedLp: Math.min(teachers, 11), trainingModules: modules, teachersTrained: modules ? 8 : 0,
  dcObservations: dc, teachersWithDc: Math.min(dc, 6), humanObservations: human, avgFico: dc ? 63.8 : null, ficoN: dc ? 2 : 0, avgHitl: 64.2, hitlN: 11,
});
function schools(region: string | null): SchoolsAnalyticsResponse {
  const regions = [row("Gilgit", 3, 17, 24, 2, 18, 0), row("Baltistan", 12, 84, 126, 22, 14, 69)];
  const { region: _r, ...ov } = region === "Baltistan" ? regions[1] : region === "Gilgit" ? regions[0] : row("all", 15, 101, 150, 24, 32, 69);
  return {
    success: true, range: { from: "2026-11-01", to: "2026-11-17" }, lpOpensLoggedSince: "2026-10-04",
    basis: { schools: "all", teachers: "roster", coaches: "leader_schools", asOf: { schools: null, teachers: null, coaches: null } },
    overview: { ...ov, avgFico: 63.8, ficoN: 2 },
    regions,
    schools: [
      { schoolId: "g1", emis: "11676", name: "Warza Basin", region: "Gilgit", ...row("x", 1, 6, 5, 2, 5, 0) },
      { schoolId: "b1", emis: "632003", name: "Nar Shigar", region: "Baltistan", ...row("x", 1, 10, 9, 0, 1, 3) },
    ].map(({ schools: _s, ...r }) => ({ ...r, region: r.region === "x" ? "Gilgit" : r.region })),
  } as unknown as SchoolsAnalyticsResponse;
}

function renderPage(rest = "") {
  return render(
    <MemoryRouter initialEntries={[`/portal/analytics/schools${rest}`]}>
      <Routes><Route path="/portal/analytics/schools/:tab?" element={<SchoolsAnalytics />} /></Routes>
    </MemoryRouter>,
  );
}
function setWidth(px: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: px });
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: /max-width:\s*(\d+)px/.test(q) ? px <= Number(RegExp.$1) : false,
    media: q, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T21:00:00+05:00"));
  setWidth(1440);
  h.getScope.mockResolvedValue(MOAWIN);
  h.getSchools.mockImplementation(async (p: { region: string | null }) => schools(p.region === "all" ? null : p.region));
  h.getObservers.mockImplementation(async (p: { region: string | null }) => observers(p.region === "all" ? null : p.region));
  h.getCoaching.mockResolvedValue({ success: true, range: { from: null, to: null }, overview: { coaches: 6, coachVisits: 19, schoolsVisited: 6 }, regions: [], schools: [] });
  h.getObservations.mockResolvedValue({ success: true, range: { from: null, to: null }, dc: { overview: { schools: 15, observations: 24, teachersObserved: 8, sectorsActive: 2, v6_visits: 0, sectionB: null, sectionBN: 0, sectionC: 60, sectionCN: 2, sectionD: 50, sectionDN: 2 }, regions: [], schools: [] }, human: { overview: { schools: 15, observations: 34, teachersObserved: 28, sectorsActive: 2, v6_visits: 3, sectionB: 42.5, sectionBN: 3, sectionC: 60, sectionCN: 11, sectionD: 66.9, sectionDN: 11 }, regions: [], schools: [] } });
});
afterEach(() => vi.useRealTimers());

describe("the words: an area view", () => {
  const c = analyticsCopy("en", MOAWIN);
  it("areas, not regions: the filter, the breakdown and the lede", () => {
    expect(c.filters.region).toBe("Area");
    expect(c.filters.allRegions).toBe("All of Gilgit-Baltistan");
    expect(c.breakdown.back).toBe("Back to all areas");
    expect(c.lede).toMatch(/area by area/);
    expect(c.observerView).toBe(true);
  });
  it("FDE's words keep observerView off and every word as it was", () => {
    expect(analyticsCopy("en").observerView).toBe(false);
    expect(analyticsCopy("en", { organization: "niete", regions: [...REGION_ORDER] })).toEqual(analyticsCopy("en"));
  });
  it("the Information tab explains who observed whom, FICO17 v6 and the areas", () => {
    const text = c.how.groups.flatMap((g) => g.items.map((i) => `${i.term}: ${i.text}`)).join("\n");
    for (const w of [/FICO17 v6/, /principal/i, /FMO/, /HOTS/, /Gilgit/, /Baltistan/, /Skardu/, /Area not set/, /grades 6.8/i]) expect(text).toMatch(w);
    // the view shows no Avg HITL, so its definitions never name it
    expect(text).not.toMatch(/HITL/);
  });
});

describe("Observations (Human) as Moawin", () => {
  it("every finished visit, the two observer cards (principals first), v6 as the headline with its n", async () => {
    renderPage("/observations");
    await screen.findByTestId("observers-human", {}, { timeout: 5000 });
    expect(h.getObservers).toHaveBeenCalledWith({ from: "2026-11-01", to: "2026-11-17", region: "all" });
    expect(within(screen.getByTestId("tile-observations")).getByText("41")).toBeTruthy();
    expect(within(screen.getByTestId("tile-peopleObserved")).getByText("33")).toBeTruthy();
    expect(screen.getByTestId("tile-peopleObserved").textContent).toMatch(/26 of 101 teachers/);
    expect(screen.getByTestId("tile-peopleObserved").textContent).toMatch(/7 of 23 principals/);
    const cards = screen.getAllByTestId(/^observer-card-/).map((el) => el.getAttribute("data-testid"));
    expect(cards).toEqual(["observer-card-principal", "observer-card-fmo"]);
    expect(screen.getByTestId("observer-card-principal").textContent).toMatch(/5/);
    expect(screen.getByTestId("observer-card-principal").textContent).toMatch(/1 waiting for review/);
    expect(screen.getByTestId("observer-card-fmo").textContent).toMatch(/36/);
    expect(screen.getByTestId("v6-headline").textContent).toMatch(/62%/);
    expect(screen.getByTestId("v6-headline").textContent).toMatch(/2 observations scored on v6/);
    expect(screen.getByTestId("v6-note").textContent).toMatch(/15 FICO V3 visits/);
    expect(screen.getByTestId("v6-note").textContent).toMatch(/24 HOTS visits/);
    expect(screen.getByTestId("v6-section-c").textContent).toMatch(/63%/);
    // the area filter: All of Gilgit-Baltistan, Gilgit, Baltistan
    expect(screen.getByTestId("region-chip-all").textContent).toMatch(/All of Gilgit-Baltistan/);
    expect(screen.getByTestId("region-chip-Gilgit")).toBeTruthy();
    expect(screen.getByTestId("region-chip-Baltistan")).toBeTruthy();
  });

  it("an area with no v6 visit says so, never 0%", async () => {
    renderPage("/observations");
    const card = await screen.findByTestId("sector-card-Baltistan", {}, { timeout: 5000 });
    expect(card.textContent).toMatch(/no v6 visit yet/i);
    expect(card.textContent).not.toMatch(/0%/);
  });

  it("an area's schools: who observed whom — FMOs by name, principals by role, no teacher named", async () => {
    const user = userEvent.setup();
    renderPage("/observations");
    await user.click(await screen.findByTestId("sector-card-Baltistan", {}, { timeout: 5000 }));
    await waitFor(() => expect(h.getObservers).toHaveBeenLastCalledWith({ from: "2026-11-01", to: "2026-11-17", region: "Baltistan" }), { timeout: 5000 });
    const nar = await screen.findByTestId("observer-school-b1", {}, { timeout: 5000 });
    expect(nar.textContent).toMatch(/Principal → teacher\s*2/);
    expect(nar.textContent).toMatch(/FMO → teacher\s*1/);
    expect(nar.textContent).toMatch(/Shigar/);
    await user.click(within(nar).getByText(/Who observed whom \(3\)/));
    const visits = within(nar).getAllByTestId("visit-row").map((r) => r.textContent);
    expect(visits[0]).toMatch(/Principal → teacher/);
    expect(visits[2]).toMatch(/Kamal Testwala → teacher/);
    expect(visits[2]).toMatch(/70%/);
    expect(screen.getByTestId("observer-school-b2").textContent).toMatch(/No finished observation in the period/);
  });

  it("no area with a v6 visit: one plain line instead of a chart of empty bars", async () => {
    h.getObservers.mockImplementation(async () => {
      const o = observers(null);
      return { ...o, regions: o.regions.map((r) => ({ ...r, v6: counts().v6 })) };
    });
    renderPage("/observations");
    expect((await screen.findByTestId("chart-v6-none", {}, { timeout: 5000 })).textContent).toBe("No v6 visit yet");
    expect(screen.queryByTestId("chart-v6")).toBeNull();
  });

  it("Digital Coach keeps its own tab (no observers read)", async () => {
    renderPage("/observations?obs=dc");
    await screen.findByTestId("observations-dc", {}, { timeout: 5000 });
    expect(h.getObservers).not.toHaveBeenCalled();
  });
});

describe("Overview as Moawin", () => {
  it("Human observations from the observers read, with principals and FMOs; FICO17 v6 replaces Avg HITL; By area", async () => {
    renderPage();
    const human = await screen.findByTestId("tile-humanObservations", {}, { timeout: 5000 });
    await waitFor(() => expect(within(human).getByText("41")).toBeTruthy(), { timeout: 5000 });
    expect(human.textContent).toMatch(/principals 5/);
    expect(human.textContent).toMatch(/FMOs 36/);
    expect(screen.queryByTestId("tile-avgHitl")).toBeNull();
    const v6 = screen.getByTestId("tile-v6");
    expect(v6.textContent).toMatch(/62%/);
    expect(v6.textContent).toMatch(/2 scored/);
    expect(v6.textContent).toMatch(/V3 68% on 15/);
    const areas = screen.getAllByTestId(/^area-card-/).map((el) => el.getAttribute("data-testid"));
    expect(areas).toEqual(["area-card-Gilgit", "area-card-Baltistan"]);
    const bal = screen.getByTestId("area-card-Baltistan");
    expect(bal.textContent).toMatch(/12 · 84/);
    expect(bal.textContent).toMatch(/126/);
    expect(bal.textContent).toMatch(/principals 5/);
    expect(bal.textContent).toMatch(/no v6 visit yet/i);
  });
});

describe("Total teachers names its head teachers (principals who also teach)", () => {
  it("a chip says how many of the teachers are head teachers, from the answer's headTeachers", async () => {
    h.getSchools.mockImplementation(async (p: { region: string | null }) => {
      const r = schools(p.region === "all" ? null : p.region);
      return { ...r, overview: { ...r.overview, headTeachers: 3 } } as SchoolsAnalyticsResponse;
    });
    renderPage();
    const tile = await screen.findByTestId("tile-teachers", {}, { timeout: 5000 });
    expect(within(tile).getByText("incl. 3 head teachers")).toBeTruthy();
  });
  it("one head teacher is singular", async () => {
    h.getSchools.mockImplementation(async (p: { region: string | null }) => {
      const r = schools(p.region === "all" ? null : p.region);
      return { ...r, overview: { ...r.overview, headTeachers: 1 } } as SchoolsAnalyticsResponse;
    });
    renderPage();
    const tile = await screen.findByTestId("tile-teachers", {}, { timeout: 5000 });
    expect(within(tile).getByText("incl. 1 head teacher")).toBeTruthy();
  });
  it("no headTeachers in the answer: no chip, the tile as before", async () => {
    renderPage();
    const tile = await screen.findByTestId("tile-teachers", {}, { timeout: 5000 });
    expect(tile.textContent).not.toMatch(/head teacher/);
  });
});

describe("FDE's view does not change", () => {
  beforeEach(() => {
    h.getScope.mockResolvedValue({ success: true, organization: "niete", regions: [...REGION_ORDER] });
    h.getSchools.mockImplementation(async (p: { region: string | null }) => fixtureResponse(p));
    h.getCoaching.mockImplementation(async (p: { region: string | null }) => fixtureCoaching(p));
    h.getObservations.mockImplementation(async (p: { region: string | null }) => fixtureObservations(p));
  });
  it("Overview and Observations never ask for observers; Avg HITL stays; no area section", async () => {
    renderPage();
    await screen.findByTestId("tile-avgHitl", {}, { timeout: 5000 });
    expect(screen.queryByTestId("tile-v6")).toBeNull();
    expect(screen.queryByTestId(/^area-card-/)).toBeNull();
    renderPage("/observations");
    await screen.findByTestId("observations-human", {}, { timeout: 5000 });
    expect(h.getObservers).not.toHaveBeenCalled();
  });
});
