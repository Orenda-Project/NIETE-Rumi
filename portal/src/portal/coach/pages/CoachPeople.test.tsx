import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({ coach: { getPeople: vi.fn(), getSchool: vi.fn(), getTeacher: vi.fn() } }));
import { coach } from "../../services/api";
import CoachPeople from "./CoachPeople";
import CoachSchool from "./CoachSchool";
import CoachTeacher from "./CoachTeacher";

/**
 * bd-o15qnr — Schools & teachers: one page, Teachers | Schools tabs, numbers
 * only (no "Due", "Done" labels) → a school → its teachers → a teacher.
 */
const C = coach as any;
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

describe("Teachers tab", () => {
  it("never-visited first, then most days since a visit; five numbers each, no labels", async () => {
    renderAt("/portal/coach/people?tab=teachers");
    const names = (await screen.findAllByTestId("teacher-card")).map((c) => within(c).getByTestId("name").textContent);
    expect(names).toEqual(["Farah Naz", "Sadia Noor", "Ayesha Bibi"]);
    const sadia = screen.getAllByTestId("teacher-card")[1];
    for (const n of ["41d", "1", "49%", "64d"]) expect(sadia).toHaveTextContent(n);
    expect(screen.queryByText(/due|done/i)).toBeNull();
    expect(sadia.closest("a")).toHaveAttribute("href", "/portal/coach/teacher/923001110005");
  });

  it("sort by average score, search by phone, filter by school", async () => {
    renderAt("/portal/coach/people?tab=teachers");
    await screen.findAllByTestId("teacher-card");
    fireEvent.click(screen.getByRole("radio", { name: "Avg. HITL Score" }));
    expect(within(screen.getAllByTestId("teacher-card")[0]).getByTestId("name")).toHaveTextContent("Sadia Noor");
    fireEvent.change(screen.getByPlaceholderText("Name or phone"), { target: { value: "923001110001" } });
    expect(screen.getAllByTestId("teacher-card")).toHaveLength(1);
    fireEvent.change(screen.getByPlaceholderText("Name or phone"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("School"), { target: { value: "niete:620" } });
    expect(screen.getAllByTestId("teacher-card").map((c) => within(c).getByTestId("name").textContent)).toEqual(["Farah Naz"]);
  });
});

describe("Schools tab", () => {
  it("least visited first; visits, days since, teachers, average — and each opens its school", async () => {
    renderAt("/portal/coach/people?tab=schools");
    const cards = await screen.findAllByTestId("school-card");
    expect(cards.map((c) => within(c).getByTestId("name").textContent)).toEqual(["IMSG G-6/2", "IMCB G-9/4", "IMSG I-10/1"]);
    expect(cards[1]).toHaveTextContent("41d");
    expect(cards[1].closest("a")).toHaveAttribute("href", "/portal/coach/school/494");
    fireEvent.click(screen.getByRole("radio", { name: "Most visited" }));
    expect(within(screen.getAllByTestId("school-card")[0]).getByTestId("name")).toHaveTextContent("IMSG I-10/1");
  });

  it("the tabs switch between the two lists", async () => {
    renderAt("/portal/coach/people?tab=teachers");
    await screen.findAllByTestId("teacher-card");
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
    expect(history.getByText("HITL")).toBeInTheDocument();
    expect(history.getByText("DC")).toBeInTheDocument();
    expect(history.getByText("63%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Schedule visit/ })).toHaveAttribute("href", "/portal/coach/new-visit?school=niete%3A110&teacher=923001110001");
    expect(screen.getByText(/11:30 AM/)).toBeInTheDocument();
  });
});
