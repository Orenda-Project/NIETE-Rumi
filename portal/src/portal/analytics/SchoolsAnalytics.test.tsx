import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fixtureResponse } from "./fixtures";

/**
 * bd-s6qbts.3 — the schools analytics page (PLAN v3 §4) against a fixture answer: counts of things that happened,
 * "x of N teachers", averages with their n. No percentage, no colour band, no threshold anywhere.
 */
const h = vi.hoisted(() => ({
  getSchools: vi.fn(),
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
  analytics: { getSchools: h.getSchools },
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

function renderPage(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/portal/analytics/schools${search}`]}>
      <Routes>
        <Route path="/portal/analytics/schools" element={<SchoolsAnalytics />} />
      </Routes>
    </MemoryRouter>,
  );
}

const rowNames = () => screen.getAllByTestId("school-row").map((r) => within(r).getByTestId("school-name").textContent);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T09:00:00+05:00"));
  setWidth(1440);
  h.getSchools.mockImplementation(async (p: Params) => fixtureResponse(p));
});
afterEach(() => vi.useRealTimers());

describe("loading the page", () => {
  it("asks for this month, all regions, by default", async () => {
    renderPage();
    await screen.findByTestId("schools-table");
    expect(h.getSchools).toHaveBeenCalledWith({ from: "2026-10-01", to: "2026-10-13", region: "all" });
  });

  it("a window and region in the address are what it asks for", async () => {
    renderPage("?from=2026-09-01&to=2026-09-30&region=Sihala");
    await screen.findByTestId("schools-table");
    expect(h.getSchools).toHaveBeenCalledWith({ from: "2026-09-01", to: "2026-09-30", region: "Sihala" });
  });

  it("All time asks with no window", async () => {
    renderPage();
    await screen.findByTestId("schools-table");
    await userEvent.setup().click(screen.getByTestId("analytics-all-time"));
    await waitFor(() => expect(h.getSchools).toHaveBeenLastCalledWith({ from: null, to: null, region: "all" }));
  });

  it("the period presets set the window", async () => {
    renderPage();
    await screen.findByTestId("schools-table");
    await userEvent.setup().click(screen.getByTestId("period-year"));
    await waitFor(() => expect(h.getSchools).toHaveBeenLastCalledWith({ from: "2026-01-01", to: "2026-10-13", region: "all" }));
    expect(screen.getByTestId("period-year")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("period-month")).toHaveAttribute("aria-pressed", "false");
  });

  it("has no tabs (the period control is the analytics pages' one, without their tabs)", async () => {
    renderPage();
    await screen.findByTestId("schools-table");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByTestId("analytics-from")).toHaveValue("2026-10-01");
    expect(screen.getByTestId("analytics-to")).toHaveValue("2026-10-13");
  });

  it("an account the server turns away is told so, with no numbers", async () => {
    h.getSchools.mockRejectedValue({ response: { status: 403 } });
    renderPage();
    expect(await screen.findByTestId("analytics-forbidden")).toBeInTheDocument();
    expect(screen.queryByTestId("schools-table")).toBeNull();
  });

  it("a failed read says so, with no numbers", async () => {
    h.getSchools.mockRejectedValue({ response: { status: 500 } });
    renderPage();
    expect(await screen.findByTestId("analytics-error")).toBeInTheDocument();
    expect(screen.queryByTestId("overview")).toBeNull();
  });
});

describe("the frame", () => {
  it("has only this page and Log out", async () => {
    renderPage();
    await screen.findByTestId("schools-table");
    const nav = screen.getAllByRole("navigation");
    const links = nav.flatMap((n) => within(n).queryAllByRole("link")).map((a) => a.getAttribute("href"));
    expect(new Set(links)).toEqual(new Set(["/portal/analytics/schools"]));
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Log out" })[0]);
    expect(h.logout).toHaveBeenCalled();
  });
});

const SIX = ["B.K", "Sihala", "Urban-I", "Nilore", "Urban-II", "Tarnol"];
const testIds = (prefix: string) =>
  Array.from(document.querySelectorAll(`[data-testid^="${prefix}"]`)).map((el) => el.getAttribute("data-testid")!.slice(prefix.length));

/** bd-wfl8oz (operator, 2026-10-13): "LP Generated" and "Coach visits" are off the page — human observations are the visits. */
const REMOVED_WORDS = /LPs? generated|Coach visits/i;
const REMOVED_KEYS = ["lpsGenerated", "coachVisits"];
const COLUMNS = ["School", "Region", "Teachers", "LPs opened", "DC observations", "Human observations", "Avg FICO", "Avg HITL"];

describe("regions", () => {
  it("every region is a chip with its school count", async () => {
    renderPage();
    await screen.findByTestId("schools-table");
    expect(screen.getByTestId("region-chip-all")).toHaveTextContent("All regions16");
    expect(screen.getByTestId("region-chip-all")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("region-chip-Urban-I")).toHaveTextContent("Urban-I5");
  });

  it("only the six ICT regions: six chips and six cards, no Unassigned anywhere on the page (bd-s6qbts.4)", async () => {
    renderPage();
    await screen.findByTestId("region-cards");
    expect(testIds("region-chip-")).toEqual(["all", ...SIX]);
    expect(within(screen.getByTestId("region-cards")).getAllByRole("button")).toHaveLength(6);
    expect(SIX.map((r) => screen.getByTestId(`region-card-${r}`))).toHaveLength(6);
    expect(screen.queryByTestId("region-chip-Unassigned")).toBeNull();
    expect(screen.queryByTestId("region-card-Unassigned")).toBeNull();
    expect(document.body.textContent).not.toMatch(/unassigned/i);
  });

  it("choosing a region asks again for that region, and the region cards go", async () => {
    renderPage();
    await screen.findByTestId("region-card-Sihala");
    await userEvent.setup().click(screen.getByTestId("region-chip-Sihala"));
    await waitFor(() => expect(h.getSchools).toHaveBeenLastCalledWith({ from: "2026-10-01", to: "2026-10-13", region: "Sihala" }));
    await waitFor(() => expect(rowNames()).toHaveLength(3));
    expect(screen.queryByTestId("region-card-Sihala")).toBeNull();
    expect(screen.getByTestId("region-chip-Sihala")).toHaveAttribute("aria-pressed", "true");
  });

  it("an old ?region=Unassigned link is no longer special: asked for as written, and the server refuses it like any unknown region", async () => {
    h.getSchools.mockRejectedValue({ response: { status: 400 } });
    renderPage("?region=Unassigned");
    expect(await screen.findByTestId("analytics-error")).toBeInTheDocument();
    expect(h.getSchools).toHaveBeenCalledWith({ from: "2026-10-01", to: "2026-10-13", region: "Unassigned" });
  });

  it("tapping a region card chooses that region", async () => {
    renderPage();
    await userEvent.setup().click(await screen.findByTestId("region-card-B.K"));
    await waitFor(() => expect(h.getSchools).toHaveBeenLastCalledWith({ from: "2026-10-01", to: "2026-10-13", region: "B.K" }));
  });

  it("a region card carries the region's counts, x of N and pooled averages", async () => {
    renderPage();
    const card = await screen.findByTestId("region-card-Urban-I");
    expect(card).toHaveTextContent("5 schools");
    expect(card).toHaveTextContent("135 teachers");
    expect(within(card).getByTestId("region-lpsOpened")).toHaveTextContent("229");
    expect(within(card).getByTestId("region-lpsOpened")).toHaveTextContent("68 of 135 teachers");
    expect(within(card).getByTestId("region-avgFico")).toHaveTextContent("65.3");
    expect(within(card).getByTestId("region-avgFico")).toHaveTextContent("(64)");
  });

  it("a region card lists LPs opened, the two observation counts and the two averages — nothing generated, no visits", async () => {
    renderPage();
    await screen.findByTestId("region-cards");
    for (const r of SIX) {
      const card = screen.getByTestId(`region-card-${r}`);
      const keys = within(card).getAllByTestId(/^region-/).map((el) => el.getAttribute("data-testid")!.slice("region-".length));
      expect(keys).toEqual(["lpsOpened", "dcObservations", "humanObservations", "avgFico", "avgHitl"]);
      for (const k of REMOVED_KEYS) expect(within(card).queryByTestId(`region-${k}`)).toBeNull();
      expect(card.textContent).not.toMatch(REMOVED_WORDS);
    }
  });
});

describe("overview tiles", () => {
  it("show the summed counts with x of N and averages with n", async () => {
    renderPage();
    const overview = await screen.findByTestId("overview");
    expect(within(overview).getByTestId("tile-schools")).toHaveTextContent("16");
    expect(within(overview).getByTestId("tile-teachers")).toHaveTextContent("442");
    expect(within(overview).getByTestId("tile-lpsOpened")).toHaveTextContent("661");
    expect(within(overview).getByTestId("tile-lpsOpened")).toHaveTextContent("185 of 442 teachers");
    expect(within(overview).getByTestId("tile-dcObservations")).toHaveTextContent("188");
    expect(within(overview).getByTestId("tile-dcObservations")).toHaveTextContent("93 of 442 teachers");
    expect(within(overview).getByTestId("tile-humanObservations")).toHaveTextContent("77");
    expect(within(overview).getByTestId("tile-avgFico")).toHaveTextContent("64.8");
    expect(within(overview).getByTestId("tile-avgFico")).toHaveTextContent("188");
  });

  it("are exactly seven: schools, teachers, LPs opened, the two observation counts and the two averages", async () => {
    renderPage();
    await screen.findByTestId("overview");
    expect(testIds("tile-")).toEqual(["schools", "teachers", "lpsOpened", "dcObservations", "humanObservations", "avgFico", "avgHitl"]);
    for (const k of REMOVED_KEYS) expect(screen.queryByTestId(`tile-${k}`)).toBeNull();
    expect(screen.getByTestId("overview").textContent).not.toMatch(REMOVED_WORDS);
  });

  it("fill their rows with no tile left alone: four across on a desktop, two on a phone, LPs opened two wide", async () => {
    renderPage();
    const overview = await screen.findByTestId("overview");
    const classes = overview.className.split(/\s+/);
    expect(classes).toContain("grid-cols-2");
    expect(classes).toContain("lg:grid-cols-4");
    expect(classes.some((c) => /^(sm|md|xl):grid-cols-/.test(c))).toBe(false);
    // Each grid cell's span, in order, laid out the way CSS grid auto-places them (no dense packing).
    const spans = Array.from(overview.children).map((el) => (el.className.split(/\s+/).includes("col-span-2") ? 2 : 1));
    expect(spans).toEqual([1, 1, 2, 1, 1, 1, 1]);
    for (const cols of [2, 4]) {
      let at = 0;
      for (const span of spans) {
        expect(at + span).toBeLessThanOrEqual(cols); // a tile that does not fit would wrap and leave a hole
        at = (at + span) % cols;
      }
      expect(at).toBe(0); // the last row is full: no orphan
    }
  });

  it("the scope line names the region, schools and window", async () => {
    renderPage();
    expect(await screen.findByTestId("scope-line")).toHaveTextContent("All regions · 16 schools · 1 Oct – 13 Oct 2026");
  });
});

describe("the LP-opens note", () => {
  it("shows when the window starts before LP opens were logged", async () => {
    renderPage();
    await screen.findByTestId("schools-table");
    const notes = screen.getAllByTestId("lp-opens-note");
    expect(notes.length).toBeGreaterThanOrEqual(2); // the tile and the column
    for (const n of notes) expect(n).toHaveTextContent("logged since 4 Oct");
  });

  it("shows for All time too", async () => {
    renderPage("?period=all");
    await screen.findByTestId("schools-table");
    expect(h.getSchools).toHaveBeenCalledWith({ from: null, to: null, region: "all" });
    expect(screen.getAllByTestId("lp-opens-note").length).toBeGreaterThan(0);
  });

  it("does not show when the window starts on or after that day", async () => {
    renderPage("?from=2026-10-04&to=2026-10-12");
    await screen.findByTestId("schools-table");
    expect(screen.queryByTestId("lp-opens-note")).toBeNull();
  });
});

describe("the school table", () => {
  it("has the v3 columns less LPs generated and Coach visits, in order, one row per school", async () => {
    renderPage();
    const table = await screen.findByTestId("schools-table");
    const headers = within(table).getAllByRole("columnheader").map((th) => th.textContent || "");
    expect(headers).toHaveLength(COLUMNS.length);
    COLUMNS.forEach((h, i) => expect(headers[i].startsWith(h)).toBe(true));
    for (const k of REMOVED_KEYS) {
      expect(screen.queryByTestId(`sort-${k}`)).toBeNull();
      expect(within(table).queryAllByTestId(`cell-${k}`)).toHaveLength(0);
    }
    expect(table.textContent).not.toMatch(REMOVED_WORDS);
    expect(rowNames()).toHaveLength(16);
  });

  it("x of N for LPs opened and DC observations", async () => {
    renderPage();
    await screen.findByTestId("schools-table");
    const row = screen.getByTestId("school-row-s-02");
    expect(within(row).getByTestId("cell-lpsOpened")).toHaveTextContent("52");
    expect(within(row).getByTestId("cell-lpsOpened")).toHaveTextContent("14 of 30");
    expect(within(row).getByTestId("cell-dcObservations")).toHaveTextContent("17");
    expect(within(row).getByTestId("cell-dcObservations")).toHaveTextContent("9 of 30");
    expect(within(row).getByTestId("cell-avgFico")).toHaveTextContent("68.4 (17)");
    expect(within(row).getByTestId("cell-avgFico")).not.toHaveAttribute("data-low-n");
  });

  it("no score is a dash; fewer than three scored is muted, n shown", async () => {
    renderPage();
    await screen.findByTestId("schools-table");
    const none = screen.getByTestId("school-row-s-04");
    expect(within(none).getByTestId("cell-avgFico")).toHaveTextContent(/^—$/);
    expect(within(none).getByTestId("cell-avgHitl")).toHaveTextContent(/^—$/);
    const two = within(screen.getByTestId("school-row-s-07")).getByTestId("cell-avgFico");
    expect(two).toHaveTextContent("55.0 (2)");
    expect(two).toHaveAttribute("data-low-n", "true");
    const one = within(screen.getByTestId("school-row-s-15")).getByTestId("cell-avgFico");
    expect(one).toHaveAttribute("data-low-n", "true");
    // A real 0 is a 0, not a dash.
    expect(within(none).getByTestId("cell-lpsOpened")).toHaveTextContent(/^0/);
  });

  it("a school with no EMIS shows its name alone", async () => {
    renderPage();
    await screen.findByTestId("schools-table");
    expect(within(screen.getByTestId("school-row-s-15")).queryByTestId("school-emis")).toBeNull();
    expect(within(screen.getByTestId("school-row-s-01")).getByTestId("school-emis")).toHaveTextContent("84980");
  });

  it("sorts: by name first; a number column biggest first, then flips; no score always last", async () => {
    renderPage();
    await screen.findByTestId("schools-table");
    expect(rowNames()[0]).toBe("IMCB (VI-XII) Bhatta Jabbar Khurd");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("sort-teachers"));
    expect(rowNames()[0]).toBe("IMCB (VI-XII) Tarnol");
    await user.click(screen.getByTestId("sort-teachers"));
    expect(rowNames()[0]).toBe("IMSB (I-VIII) Sangjani");
    await user.click(screen.getByTestId("sort-avgFico"));
    expect(rowNames()[0]).toBe("IMSB (VI-X) Humak");
    expect(rowNames()[15]).toBe("IMCB (VI-XII) Dhok Jabbar");
    await user.click(screen.getByTestId("sort-avgFico"));
    expect(rowNames()[0]).toBe("IMSB (I-VIII) Sangjani");
    expect(rowNames()[15]).toBe("IMCB (VI-XII) Dhok Jabbar");
    expect(screen.getByTestId("sort-avgFico").closest("th")).toHaveAttribute("aria-sort", "ascending");
  });

  it("searches by school name or EMIS code", async () => {
    renderPage();
    await screen.findByTestId("schools-table");
    const user = userEvent.setup();
    await user.type(screen.getByTestId("school-search"), "f-7");
    expect(rowNames()).toEqual(["IMCG (VI-XII) F-7/2", "IMSB (I-X) F-7/3"]);
    expect(screen.getByTestId("search-count")).toHaveTextContent("2 of 16 schools");
    await user.clear(screen.getByTestId("school-search"));
    await user.type(screen.getByTestId("school-search"), "84980");
    expect(rowNames()).toEqual(["IMCB (VI-XII) Bhatta Jabbar Khurd"]);
  });
});

describe("a long list", () => {
  const many = () => {
    const base = fixtureResponse({});
    const schools = Array.from({ length: 60 }, (_, i) => ({ ...base.schools[i % base.schools.length], schoolId: `m-${i}`, name: `School ${String(i).padStart(2, "0")}` }));
    return { ...base, schools, overview: { ...base.overview, schools: 60 } };
  };

  it("shows 25 schools at a time, then 25 more", async () => {
    h.getSchools.mockResolvedValue(many());
    renderPage();
    await screen.findByTestId("schools-table");
    expect(rowNames()).toHaveLength(25);
    expect(screen.getByTestId("showing")).toHaveTextContent("Showing 25 of 60");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("show-more"));
    expect(rowNames()).toHaveLength(50);
    await user.click(screen.getByTestId("show-more"));
    expect(rowNames()).toHaveLength(60);
    expect(screen.queryByTestId("show-more")).toBeNull();
  });

  it("a search looks through every school, not just the ones shown, and starts again at 25", async () => {
    h.getSchools.mockResolvedValue(many());
    renderPage();
    await screen.findByTestId("schools-table");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("show-more"));
    await user.type(screen.getByTestId("school-search"), "School 5");
    expect(rowNames()).toEqual(["School 50", "School 51", "School 52", "School 53", "School 54", "School 55", "School 56", "School 57", "School 58", "School 59"]);
    await user.clear(screen.getByTestId("school-search"));
    expect(rowNames()).toHaveLength(25);
  });

  it("on a phone too", async () => {
    setWidth(390);
    h.getSchools.mockResolvedValue(many());
    renderPage();
    expect(await screen.findAllByTestId("school-card")).toHaveLength(25);
    await userEvent.setup().click(screen.getByTestId("show-more"));
    expect(screen.getAllByTestId("school-card")).toHaveLength(50);
  });
});

describe("no percentages, bands or thresholds", () => {
  it("nothing in the tiles, region cards or table carries a % sign", async () => {
    renderPage();
    await screen.findByTestId("schools-table");
    for (const id of ["overview", "region-cards", "schools-table"]) {
      expect(screen.getByTestId(id).textContent).not.toMatch(/%/);
    }
  });

  it("nor on one region, nor on a phone", async () => {
    setWidth(390);
    renderPage("?region=Urban-I");
    await screen.findAllByTestId("school-card");
    expect(document.body.textContent).not.toMatch(/%/);
  });
});

describe("the How these numbers are worked out panel", () => {
  it("explains every number in plain words", async () => {
    renderPage();
    const panel = await screen.findByTestId("how-counted");
    expect(panel).toHaveTextContent("How these numbers are worked out");
    for (const term of ["Teachers", "LPs opened", "DC observations", "Human observations", "Avg FICO", "Avg HITL"]) {
      expect(panel).toHaveTextContent(term);
    }
  });

  it("no longer explains LPs generated or Coach visits — they are not on the page", async () => {
    renderPage();
    const panel = await screen.findByTestId("how-counted");
    expect(Array.from(panel.querySelectorAll("dt")).map((dt) => dt.textContent)).not.toEqual(
      expect.arrayContaining(["LPs generated"]),
    );
    expect(panel.textContent).not.toMatch(REMOVED_WORDS);
    expect(document.body.textContent).not.toMatch(REMOVED_WORDS);
  });

  it("says plainly that only schools in the six regions are shown, and never mentions Unassigned (bd-s6qbts.4)", async () => {
    renderPage();
    const panel = await screen.findByTestId("how-counted");
    expect(panel).toHaveTextContent("B.K, Sihala, Urban-I, Nilore, Urban-II and Tarnol");
    expect(panel).toHaveTextContent(/not shown and not counted/);
    expect(panel.textContent).not.toMatch(/unassigned/i);
  });
});

describe("on a phone", () => {
  it("one card per school with a sort menu, no table", async () => {
    setWidth(390);
    renderPage();
    const cards = await screen.findAllByTestId("school-card");
    expect(cards).toHaveLength(16);
    expect(screen.queryByTestId("schools-table")).toBeNull();
    expect(within(cards[0]).getByTestId("school-name")).toHaveTextContent("IMCB (VI-XII) Bhatta Jabbar Khurd");
    await userEvent.setup().selectOptions(screen.getByTestId("sort-menu"), "teachers");
    expect(within(screen.getAllByTestId("school-card")[0]).getByTestId("school-name")).toHaveTextContent("IMCB (VI-XII) Tarnol");
  });

  it("a card carries the same numbers", async () => {
    setWidth(390);
    renderPage();
    await screen.findAllByTestId("school-card");
    const card = screen.getByTestId("school-card-s-02");
    expect(within(card).getByTestId("cell-lpsOpened")).toHaveTextContent("14 of 30");
    expect(within(card).getByTestId("cell-avgFico")).toHaveTextContent("68.4 (17)");
    expect(within(card).getByTestId("cell-humanObservations")).toHaveTextContent("6");
  });

  it("a card and the sort menu carry neither LPs generated nor Coach visits", async () => {
    setWidth(390);
    renderPage();
    await screen.findAllByTestId("school-card");
    const card = screen.getByTestId("school-card-s-02");
    expect(Array.from(card.querySelectorAll("[data-testid^='cell-']")).map((el) => el.getAttribute("data-testid"))).toEqual(
      ["cell-teachers", "cell-lpsOpened", "cell-dcObservations", "cell-humanObservations", "cell-avgFico", "cell-avgHitl"],
    );
    const options = Array.from((screen.getByTestId("sort-menu") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual(COLUMNS);
    expect(document.body.textContent).not.toMatch(REMOVED_WORDS);
  });
});
