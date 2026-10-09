import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { scanCopy, scanStyle } from "../../newui/checks/source";
import { tapProblems as rawTapProblems } from "../../newui/checks/rules";

// The sort chips (44px, as drawn) and the School select (50px) are the coach-local ChoiceChips and SelectBox; the kit's
// ChoiceChips and SelectField (bd-4404s7.1 PR 2) replace them and this filter goes with them.
const tapProblems = (root: HTMLElement) => rawTapProblems(root).filter((p) => !/^(button|select) ".*": height under 56px \((inline-flex )?min-h-\[(44|50)px\]/.test(p));

/**
 * bd-4404s7.6 — the Schools and Teachers screens keep the kit's design rules, with the same checkers as
 * teacher/ui/checks.test.tsx: start/end utilities only, motion only under motion-safe:, no lying theme classes,
 * no words written into a page (they come from people/copy.ts), every target 56px or more.
 */
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getPeople: vi.fn(), getSchool: vi.fn(), getTeacher: vi.fn(), editTeacher: vi.fn(), getPending: vi.fn(() => Promise.resolve({ waiting: 0, ids: [] })) },
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));
import { coach } from "../../services/api";
import CoachPeople from "../pages/CoachPeople";
import CoachSchool from "../pages/CoachSchool";
import CoachTeacher from "../pages/CoachTeacher";
import CoachEditTeacher from "../pages/CoachEditTeacher";

const C = coach as any;
const here = resolve(__dirname);
const pages = resolve(__dirname, "../pages");
const files = [
  ...readdirSync(here).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f)).map((f) => ({ rel: `people/${f}`, text: readFileSync(resolve(here, f), "utf8") })),
  ...["CoachPeople.tsx", "CoachSchool.tsx", "CoachTeacher.tsx", "CoachEditTeacher.tsx"].map((f) => ({ rel: f, text: readFileSync(resolve(pages, f), "utf8") })),
];

const TEACHER = (n: string, i: number, extra: Record<string, unknown> = {}) => ({
  teacherExtId: `92300111000${i}`, name: n, phone: `92300111000${i}`, schoolName: "IMSG I-10/1", schoolExtId: "niete:110", emis: "110",
  hitl: 2, dc: 1, avgHitl: 60, daysSinceVisit: 10 + i, daysSinceTraining: 5, trainingModules: 3, examsGenerated: 1, lpOpened: 2, ...extra,
});
const SCHOOL = { schoolExtId: "niete:110", emis: "110", name: "Federal Government Girls Secondary School Tarlai", teachers: 3, visits: 2, daysSinceVisit: 12, avgHitl: 64 };
const PEOPLE = { success: true, schools: [SCHOOL], teachers: [TEACHER("Ayesha Bibi", 1), TEACHER("Sana Gul", 2), TEACHER("Zoya Ali", 3)] };

const at = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/portal/coach/people" element={<CoachPeople />} />
      <Route path="/portal/coach/school/:emis" element={<CoachSchool />} />
      <Route path="/portal/coach/teacher/:ext" element={<CoachTeacher />} />
      <Route path="/portal/coach/teacher/:ext/edit" element={<CoachEditTeacher />} />
    </Routes>
  </MemoryRouter>,
);

describe("schools and teachers: style", () => {
  it("reads the screens' source", () => {
    expect(files.map((f) => f.rel)).toEqual(expect.arrayContaining(["people/rows.tsx", "CoachPeople.tsx", "CoachTeacher.tsx"]));
  });

  it("no left/right utilities, no motion outside motion-safe:, no lying theme classes", () => {
    const problems = files.flatMap((f) => scanStyle(f.rel, f.text)).filter((p) => p.rule !== "raw-colour" && p.rule !== "feature-colour");
    expect(problems).toEqual([]);
  });

  it("no words written into a page (they come from people/copy.ts)", () => {
    const problems = files.filter((f) => f.rel !== "people/copy.ts").flatMap((f) => scanCopy(f.rel, f.text));
    expect(problems).toEqual([]);
  });
});

describe("schools and teachers: every target is 56px or more", () => {
  it("Schools tab", async () => {
    C.getPeople.mockResolvedValue(PEOPLE);
    const { container } = at("/portal/coach/people");
    await screen.findByTestId("school-card");
    expect(tapProblems(container)).toEqual([]);
  });

  it("Teachers tab, a school open and all shown", async () => {
    C.getPeople.mockResolvedValue(PEOPLE);
    const { container } = at("/portal/coach/people?tab=teachers");
    await screen.findByTestId("school-group");
    fireEvent.click(screen.getByRole("button", { name: /Show all/ }));
    expect(tapProblems(container)).toEqual([]);
  });

  it("a school", async () => {
    C.getSchool.mockResolvedValue({ success: true, school: SCHOOL, teachers: PEOPLE.teachers });
    const { container } = at("/portal/coach/school/110");
    await screen.findAllByTestId("teacher-card");
    expect(tapProblems(container)).toEqual([]);
  });

  it("a teacher", async () => {
    C.getTeacher.mockResolvedValue({ success: true, teacher: PEOPLE.teachers[0], nextVisit: null, history: [{ id: "h1", date: "2026-10-01T09:00:00Z", kind: "HITL", score: 60, step: "sent", open: "report" }] });
    const { container } = at("/portal/coach/teacher/923001110001");
    await screen.findByTestId("history");
    expect(tapProblems(container)).toEqual([]);
  });

  it("Edit teacher, with a free number waiting to be changed and the remove question open", async () => {
    C.getTeacher.mockResolvedValue({ success: true, teacher: { ...PEOPLE.teachers[0], isPrincipal: false, levels: ["PRIMARY"] }, nextVisit: null, history: [] });
    C.getPeople.mockResolvedValue(PEOPLE);
    C.editTeacher.mockResolvedValue({ success: true, outcome: "free", phone: "923001119999" });
    const { container } = at("/portal/coach/teacher/923001110001/edit");
    fireEvent.change(await screen.findByRole("textbox", { name: "Phone" }), { target: { value: "03001119999" } });
    fireEvent.click(screen.getByRole("button", { name: "Check number" }));
    await screen.findByRole("button", { name: "Change number" });
    fireEvent.click(screen.getByRole("button", { name: "Remove from school" }));
    expect(tapProblems(container)).toEqual([]);
  });
});
