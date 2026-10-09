import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within, fireEvent } from "@testing-library/react";
import i18n from "i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getPeople: vi.fn(), getSchool: vi.fn(), getTeacher: vi.fn(), getPending: vi.fn(() => Promise.resolve({ waiting: 0, ids: [] })) },
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));
import { coach } from "../../services/api";
import CoachPeople from "./CoachPeople";
import CoachSchool from "./CoachSchool";
import CoachTeacher from "./CoachTeacher";
import { PEOPLE_UR as U } from "../people/copy";

/**
 * bd-o15qnr — Schools & teachers: one page, Teachers | Schools tabs, numbers
 * only (no "Due", "Done" labels) → a school → its teachers → a teacher.
 */
const C = coach as any;
/** A row's title: the kit's HistoryRow title (the first one in the element). */
const titleOf = (el: Element) => el.querySelector("[data-history-row] .font-semibold.leading-\\[1\\.3\\]")?.textContent;
const T = (name: string, extra: Record<string, unknown>) => ({
  teacherExtId: extra.teacherExtId || "923001110000", name, phone: extra.teacherExtId || "923001110000", schoolName: "IMSG I-10/1",
  schoolExtId: "niete:110", emis: "110", hitl: 0, dc: 0, avgHitl: null, daysSinceVisit: null, daysSinceTraining: null, ...extra,
});
const PEOPLE = {
  success: true,
  teachers: [
    T("Ayesha Bibi", { teacherExtId: "923001110001", hitl: 3, dc: 7, avgHitl: 61, daysSinceVisit: 22, daysSinceTraining: 12 }),
    T("Sadia Noor", { teacherExtId: "923001110005", schoolName: "IMCB G-9/4", schoolExtId: "niete:494", emis: "494", hitl: 1, avgHitl: 49, daysSinceVisit: 41, daysSinceTraining: 64 }),
    T("Farah Naz", { teacherExtId: "923001110003", schoolName: "IMSG G-6/2", schoolExtId: "niete:620", emis: "620", dc: 2 }),
    T("Sana Gul", { teacherExtId: "923001110008", hitl: 1, avgHitl: 70, daysSinceVisit: 30, daysSinceTraining: 3 }),
    T("Zoya Ali", { teacherExtId: "923001110009", hitl: 1, avgHitl: 80, daysSinceVisit: 4, daysSinceTraining: 3 }),
  ],
  schools: [
    { schoolExtId: "niete:110", emis: "110", name: "IMSG I-10/1", teachers: 6, visits: 9, daysSinceVisit: 0, avgHitl: 66 },
    { schoolExtId: "niete:494", emis: "494", name: "IMCB G-9/4", teachers: 8, visits: 1, daysSinceVisit: 41, avgHitl: 58 },
    { schoolExtId: "niete:620", emis: "620", name: "IMSG G-6/2", teachers: 6, visits: 0, daysSinceVisit: null, avgHitl: null },
  ],
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/coach/people" element={<CoachPeople />} />
        <Route path="/portal/coach/school/:emis" element={<CoachSchool />} />
        <Route path="/portal/coach/teacher/:ext" element={<CoachTeacher />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  C.getPeople.mockResolvedValue(PEOPLE);
});

describe("Teachers tab: grouped by school", () => {
  it("one card per school, most overdue school first; the first opens in place, the rest are closed", async () => {
    renderAt("/portal/coach/people?tab=teachers");
    const groups = await screen.findAllByTestId("school-group");
    expect(groups.map((g) => titleOf(g))).toEqual(["IMSG G-6/2", "IMCB G-9/4", "IMSG I-10/1"]);
    const toggles = groups.map((g) => within(g).getByTestId("school-toggle"));
    expect(toggles.map((t) => t.getAttribute("aria-expanded"))).toEqual(["true", "false", "false"]);
    expect(within(groups[0]).getByText("1 teacher")).toBeInTheDocument();
    expect(within(groups[2]).getByText("3 teachers")).toBeInTheDocument();
    expect(within(groups[1]).queryByTestId("teacher-row")).toBeNull();
  });

  it("a school opens in place: two teachers, then Show all N reveals the rest; no search, no school filter", async () => {
    renderAt("/portal/coach/people?tab=teachers");
    const groups = await screen.findAllByTestId("school-group");
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByPlaceholderText("Name or phone")).toBeNull();
    expect(screen.queryByLabelText("School")).toBeNull();
    const imsg = groups[2];
    fireEvent.click(within(imsg).getByTestId("school-toggle"));
    expect(within(imsg).getByTestId("school-toggle")).toHaveAttribute("aria-expanded", "true");
    const rows = within(imsg).getAllByTestId("teacher-row");
    expect(rows.map((r) => titleOf(r))).toEqual(["Sana Gul", "Ayesha Bibi"]);
    expect(rows[1].querySelector("a")).toHaveAttribute("href", "/portal/coach/teacher/923001110001");
    expect(rows[1]).toHaveTextContent("Last visit 22d");
    fireEvent.click(within(imsg).getByRole("button", { name: "Show all 3" }));
    expect(within(imsg).getAllByTestId("teacher-row")).toHaveLength(3);
    expect(within(imsg).queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("Avg. HITL Score sorts the teachers inside a school and the schools by their first teacher", async () => {
    renderAt("/portal/coach/people?tab=teachers");
    await screen.findAllByTestId("school-group");
    fireEvent.click(screen.getByRole("radio", { name: "Avg. HITL Score" }));
    const groups = screen.getAllByTestId("school-group");
    expect(groups.map((g) => titleOf(g))).toEqual(["IMCB G-9/4", "IMSG I-10/1", "IMSG G-6/2"]);
  });
});

describe("Schools tab", () => {
  it("least visited first; visits, days since, teachers, average — and each opens its school", async () => {
    renderAt("/portal/coach/people?tab=schools");
    const cards = await screen.findAllByTestId("school-card");
    expect(cards.map((c) => titleOf(c))).toEqual(["IMSG G-6/2", "IMCB G-9/4", "IMSG I-10/1"]);
    expect(cards[1]).toHaveTextContent("41d");
    expect(cards[1].querySelector("a")).toHaveAttribute("href", "/portal/coach/school/494");
    fireEvent.click(screen.getByRole("radio", { name: "Most visited" }));
    expect(screen.getAllByTestId("school-card")[0].querySelector("[data-history-row] .font-semibold.leading-\\[1\\.3\\]")).toHaveTextContent("IMSG I-10/1");
  });

  it("no search box; sort chips; a legend for the visit-status chips", async () => {
    renderAt("/portal/coach/people?tab=schools");
    await screen.findAllByTestId("school-card");
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByPlaceholderText("School name")).toBeNull();
    for (const t of ["Least visited", "Most visited", "Days since visit"]) expect(screen.getByRole("radio", { name: t })).toBeInTheDocument();
    const legend = screen.getByTestId("visit-legend");
    for (const t of ["Over 30 days, or none", "8 to 30 days", "Within a week"]) expect(within(legend).getByText(t)).toBeInTheDocument();
  });

  it("each row's visit status is a chip in a status tone: amber none or over 30 days, grey 8-30, green within a week", async () => {
    C.getPeople.mockResolvedValue({ ...PEOPLE, schools: [
      ...PEOPLE.schools,
      { schoolExtId: "niete:700", emis: "700", name: "IMCG F-7/2", teachers: 7, visits: 4, daysSinceVisit: 3, avgHitl: 70 },
      { schoolExtId: "niete:701", emis: "701", name: "IMSG E-7/1", teachers: 7, visits: 4, daysSinceVisit: 21, avgHitl: 70 },
    ] });
    renderAt("/portal/coach/people?tab=schools");
    const cards = await screen.findAllByTestId("school-card");
    const chipOf = (name: string) => {
      const card = cards.find((c) => titleOf(c) === name) as HTMLElement;
      return card.querySelector("[data-chip]") as HTMLElement;
    };
    expect(chipOf("IMSG G-6/2")).toHaveTextContent("No visits yet");
    expect(chipOf("IMSG G-6/2").className).toMatch(/#fef3c7/);
    expect(chipOf("IMCB G-9/4")).toHaveTextContent("41 days ago");
    expect(chipOf("IMCB G-9/4").className).toMatch(/#fef3c7/);
    expect(chipOf("IMSG E-7/1")).toHaveTextContent("21 days ago");
    expect(chipOf("IMSG E-7/1").className).toMatch(/#f3f4f6/);
    expect(chipOf("IMCG F-7/2")).toHaveTextContent("3 days ago");
    expect(chipOf("IMCG F-7/2").className).toMatch(/#eaf6ef/);
    expect(chipOf("IMSG I-10/1")).toHaveTextContent("Today");
    expect(chipOf("IMSG I-10/1").className).toMatch(/#eaf6ef/);
  });

  it("a long school name wraps in full; it is never cut with an ellipsis", async () => {
    C.getPeople.mockResolvedValue({ ...PEOPLE, schools: [
      { schoolExtId: "niete:1", emis: "1", name: "Federal Government Girls Secondary School Tarlai", teachers: 31, visits: 0, daysSinceVisit: null, avgHitl: null },
    ] });
    renderAt("/portal/coach/people?tab=schools");
    const card = await screen.findByTestId("school-card");
    expect(within(card).getByText("Federal Government Girls Secondary School Tarlai")).toBeInTheDocument();
    // the kit's wrapTitle: the whole name, never clamped to two lines
    expect(within(card).getByText("Federal Government Girls Secondary School Tarlai").className).not.toMatch(/line-clamp|truncate|ellipsis/);
  });

  it("the tabs switch between the two lists", async () => {
    renderAt("/portal/coach/people?tab=teachers");
    await screen.findAllByTestId("school-group");
    fireEvent.click(screen.getByRole("link", { name: /Schools/ }));
    expect(await screen.findAllByTestId("school-card")).toHaveLength(3);
  });
});

describe("School and Teacher", () => {
  it("a school: its numbers and its teachers; Schedule visit here", async () => {
    C.getSchool.mockResolvedValue({ success: true, school: PEOPLE.schools[0], teachers: [PEOPLE.teachers[0]] });
    renderAt("/portal/coach/school/110");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("IMSG I-10/1");
    expect(screen.getByText("Ayesha Bibi").closest("a")).toHaveAttribute("href", "/portal/coach/teacher/923001110001");
    expect(screen.getByRole("link", { name: /Schedule visit here/ })).toHaveAttribute("href", "/portal/coach/new-visit?school=niete%3A110");
    // the kit's KpiTiles: visits, since visit, average, teachers
    for (const g of ["9 Visits · last 3 months", "0d Since visit", "66% Avg. HITL Score", "6 Teachers"]) expect(screen.getByRole("group", { name: g })).toBeInTheDocument();
  });

  it("a teacher: average, counts, history with HITL and DC; Schedule visit goes to step 3", async () => {
    C.getTeacher.mockResolvedValue({
      success: true,
      teacher: PEOPLE.teachers[0],
      history: [
        { id: "h1", date: "2026-09-28T09:00:00Z", kind: "DC", score: 63 },
        { id: "h2", date: "2026-09-14T09:00:00Z", kind: "HITL", score: 61 },
      ],
      nextVisit: { id: "v2", scheduledFor: "2026-10-06", scheduledSlot: "11:30" },
    });
    renderAt("/portal/coach/teacher/923001110001");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Ayesha Bibi");
    expect(screen.getByTestId("avg-hitl")).toHaveTextContent("61%");
    const history = within(screen.getByTestId("history"));
    const kinds = history.getAllByTestId("history-avatar").map((a) => a.textContent);
    expect(kinds).toEqual(expect.arrayContaining(["HITL", "DC"]));
    expect(history.getByText("63%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Schedule visit/ })).toHaveAttribute("href", "/portal/coach/new-visit?school=niete%3A110&teacher=923001110001");
    expect(screen.getByTestId("next-visit")).toHaveTextContent("Next visit");
    expect(within(screen.getByTestId("next-visit")).getByLabelText("11:30 AM")).toBeInTheDocument();
    // the counts: Courses done (never Modules), DC observations, Papers made, Lesson Plans opened
    for (const t of ["HITL visits", "DC observations", "Papers made", "Lesson Plans opened", "Courses done", "Last training"]) expect(screen.getByText(t)).toBeInTheDocument();
    expect(screen.queryByText(/Modules done/)).toBeNull();
  });
});

describe("Urdu (right to left)", () => {
  const setLang = async (lng: string) => { if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} }); await act(async () => { await i18n.changeLanguage(lng); }); };
  beforeEach(async () => { await setLang("ur"); });
  afterEach(async () => { await setLang("en"); });

  it("Schools: title, tabs, sort, legend and chips are the Urdu words", async () => {
    renderAt("/portal/coach/people?tab=schools");
    await screen.findAllByTestId("school-card");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(U.title);
    expect(screen.getByRole("radio", { name: U.sortLeast })).toBeInTheDocument();
    expect(within(screen.getByTestId("visit-legend")).getByText(U.legendRecent)).toBeInTheDocument();
    expect(screen.getAllByTestId("school-card")[0]).toHaveTextContent(U.noVisitsYet);
    expect(screen.queryByText("Least visited")).toBeNull();
  });

  it("Teachers: groups, the teacher count and Show all in Urdu", async () => {
    renderAt("/portal/coach/people?tab=teachers");
    const groups = await screen.findAllByTestId("school-group");
    // the kit isolates numerals inside Urdu text (bidi egress)
    expect((groups[2].textContent || "").replace(/[\u2066\u2069]/g, "")).toContain(U.teachersN(3));
    fireEvent.click(within(groups[2]).getByTestId("school-toggle"));
    expect(within(groups[2]).getByRole("button", { name: U.showAllN(3) })).toBeInTheDocument();
  });

  it("a teacher: Courses done and the other counts in Urdu", async () => {
    C.getTeacher.mockResolvedValue({ success: true, teacher: PEOPLE.teachers[0], history: [], nextVisit: null });
    renderAt("/portal/coach/teacher/923001110001");
    await screen.findByRole("heading", { level: 1 });
    for (const t of [U.coursesDone, U.hitlVisits, U.dcObservations, U.papersMade, U.lpOpened]) expect(screen.getByText(t)).toBeInTheDocument();
  });
});
