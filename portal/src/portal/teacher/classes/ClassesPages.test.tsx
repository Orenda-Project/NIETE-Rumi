import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-fmf24g.8 — My Classes (Classes only; no timetable), Class detail and Add a class, on the existing
 * routes: GET/POST /classes, GET/POST /classes/:id/students, DELETE /classes/:id/students/:sid,
 * GET /me/grade-subjects?feature=lessons.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(() => new Promise(() => {})), post: vi.fn() },
  classes: { list: vi.fn(), create: vi.fn(), students: vi.fn(), addStudents: vi.fn(), removeStudent: vi.fn() },
}));
vi.mock("../../lib/gradeSubjects", () => ({ loadGradeSubjects: vi.fn() }));

// The registry first, as App.tsx loads it: it pulls in every feature's routes.tsx (this one too).
import { teacherPath } from "../routes";
import { classes as classesApi } from "../../services/api";
import { loadGradeSubjects } from "../../lib/gradeSubjects";
import { MyClassesPage } from "./MyClassesPage";
import { ClassDetailPage } from "./ClassDetailPage";
import { AddClassPage } from "./AddClassPage";
import classRoutes from "./routes";
import { CLASSES_ADD, CLASSES_HOME, CLASS_DETAIL, classPath } from "./paths";
import { CLASSES_V2_COPY as C } from "./copy";
import { LESSONS_HOME } from "../lessons/paths";

const api = classesApi as unknown as Record<"list" | "create" | "students" | "addStudents" | "removeStudent", ReturnType<typeof vi.fn>>;
const combos = loadGradeSubjects as unknown as ReturnType<typeof vi.fn>;

const LIST = {
  success: true,
  canAdd: true,
  currentSession: "2026-27",
  grades: [{ code: "grade_3", label: "Grade 3" }, { code: "grade_4", label: "Grade 4" }],
  subjects: [{ code: "science", label: "General Science" }, { code: "maths", label: "Math" }],
  sections: [{ code: "A", label: "A" }, { code: "B", label: "B" }],
  shifts: [{ code: "morning", label: "Morning" }, { code: "evening", label: "Evening" }],
  classes: [
    { classId: "c1", gradeCode: "grade_4", gradeLabel: "Grade 4", section: "A", shiftCode: "morning", sessionCode: "2026-27",
      isClassTeacher: true, display: "Grade 4 - A", subjects: [{ code: "science", label: "General Science" }] },
    { classId: "c2", gradeCode: "grade_5", gradeLabel: "Grade 5", section: "B", shiftCode: "morning", sessionCode: "2026-27",
      isClassTeacher: false, display: "Grade 5 - B", subjects: [{ code: "maths", label: "Math" }] },
  ],
};

const STUDENTS = (n: number) => Array.from({ length: n }, (_, i) => ({
  studentId: `s${i + 1}`, studentName: `Child ${i + 1}`, fatherName: i === 0 ? "Raza Ahmed" : null, rollNumber: i + 1, enrolledOn: null,
}));

const at = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      {classRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
      <Route path="*" element={<div data-testid="elsewhere" />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue(LIST);
  api.students.mockResolvedValue({ success: true, students: STUDENTS(3) });
  combos.mockResolvedValue([{ grade: 4, gradeCode: "grade_4", subject: "Science", subjectKey: "science", source: "class", featureKey: "general_science", available: true }]);
});

describe("routes", () => {
  it("registers My Classes, Add a class and Class detail under /portal/teacher/classes — no timetable", () => {
    expect(classRoutes.map((r) => r.path)).toEqual([CLASSES_HOME, CLASSES_ADD, CLASS_DETAIL]);
    expect(CLASSES_HOME).toBe("/portal/teacher/classes");
  });
});

describe("My Classes", () => {
  it("her classes as Grade·Subject rows linking to each class, with the count, and Add a class", async () => {
    render(<MemoryRouter><MyClassesPage /></MemoryRouter>);
    const row = await screen.findByText("Grade 4-A · General Science");
    expect(row.closest("a")?.getAttribute("href")).toBe(classPath("c1"));
    expect(screen.getByText("Grade 5-B · Math")).toBeTruthy();
    expect(screen.getByText(C.classTeacher)).toBeTruthy();
    expect(screen.getByTestId("classes-count").textContent).toBe("2");
    expect(screen.getByRole("link", { name: C.addClass }).getAttribute("href")).toBe(CLASSES_ADD);
    expect(screen.queryByText(/timetable/i)).toBeNull();
  });

  it("no classes → the empty state; no school on file → no Add a class", async () => {
    api.list.mockResolvedValue({ ...LIST, classes: [], canAdd: false });
    render(<MemoryRouter><MyClassesPage /></MemoryRouter>);
    expect(await screen.findByText(C.noClassesYet)).toBeTruthy();
    expect(screen.queryByRole("link", { name: C.addClass })).toBeNull();
    expect(screen.getByText(C.cannotAdd)).toBeTruthy();
  });

  it("a failed read offers Try again", async () => {
    api.list.mockRejectedValueOnce(new Error("502"));
    render(<MemoryRouter><MyClassesPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: C.tryAgain }));
    expect(await screen.findByText("Grade 4-A · General Science")).toBeTruthy();
  });
});

describe("Class detail", () => {
  it("title, chips, the Attendance and Lesson plans shortcuts, and the students in roll order", async () => {
    at(classPath("c1"));
    expect(await screen.findByRole("heading", { name: "Grade 4-A" })).toBeTruthy();
    expect(screen.getByText("Morning")).toBeTruthy();
    expect(screen.getByText("2026-27")).toBeTruthy();
    expect(screen.getByRole("link", { name: C.attendance }).getAttribute("href")).toBe(teacherPath("attendance"));
    await waitFor(() => expect(screen.getByRole("link", { name: C.lessonPlans }).getAttribute("href"))
      .toBe(`${LESSONS_HOME}/chapters?grade=4&subject=general_science&key=science`));
    const list = await screen.findByRole("list", { name: C.students });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("Child 1"), expect.stringContaining("Child 2"), expect.stringContaining("Child 3"),
    ]);
    expect(screen.getByText("Raza Ahmed")).toBeTruthy();
    expect(screen.getByTestId("students-count").textContent).toBe("3");
    expect(api.students).toHaveBeenCalledWith("c1");
  });

  it("shows 7 children first, then Show all N", async () => {
    api.students.mockResolvedValue({ success: true, students: STUDENTS(10) });
    at(classPath("c1"));
    const list = await screen.findByRole("list", { name: C.students });
    expect(within(list).getAllByRole("listitem")).toHaveLength(7);
    fireEvent.click(screen.getByRole("button", { name: C.showAll(10) }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(10);
  });

  it("Add students: the pasted names go to the existing route, the roster reloads, the result is said", async () => {
    api.addStudents.mockResolvedValue({ success: true, added: 2, duplicates: 1, dropped: 0 });
    at(classPath("c1"));
    await screen.findByRole("list", { name: C.students });
    fireEvent.click(screen.getByRole("button", { name: C.addStudents }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(C.studentNames), { target: { value: "Sara\nOmar\nChild 1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: C.add }));
    await waitFor(() => expect(api.addStudents).toHaveBeenCalledWith("c1", "Sara\nOmar\nChild 1"));
    await waitFor(() => expect(api.students).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(C.added(2))).toBeTruthy();
    expect(screen.getByText(C.alreadyThere(1))).toBeTruthy();
  });

  it("Remove asks first; Keep leaves the child, Remove deletes through the existing route", async () => {
    api.removeStudent.mockResolvedValue({ success: true });
    at(classPath("c1"));
    await screen.findByRole("list", { name: C.students });
    fireEvent.click(screen.getByRole("button", { name: C.removeNamed("Child 2") }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: C.keep }));
    expect(api.removeStudent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: C.removeNamed("Child 2") }));
    dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: C.remove }));
    await waitFor(() => expect(api.removeStudent).toHaveBeenCalledWith("c1", "s2"));
    await waitFor(() => expect(api.students).toHaveBeenCalledTimes(2));
  });

  it("a class that is not hers → back to My Classes", async () => {
    at(classPath("nope"));
    await waitFor(() => expect(screen.getByRole("link", { name: C.back }).getAttribute("href")).toBe(CLASSES_HOME));
    expect(await screen.findByText(C.loadFailed)).toBeTruthy();
  });
});

describe("Add a class", () => {
  it("class, section, shift, subjects and class teacher from GET /classes; Save posts them and returns to My Classes", async () => {
    api.create.mockResolvedValue({ success: true, class: { classId: "c9", gradeCode: "grade_4", section: "B", sessionCode: "2026-27" } });
    at(CLASSES_ADD);
    const save = await screen.findByRole("button", { name: C.saveClass });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Grade 4" }));
    fireEvent.click(screen.getByRole("radio", { name: "B" }));
    fireEvent.click(screen.getByRole("radio", { name: "Evening" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Math" }));
    fireEvent.click(screen.getByRole("checkbox", { name: C.iAmClassTeacher }));
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(api.create).toHaveBeenCalledWith({
      gradeCode: "grade_4", section: "B", shiftCode: "evening", subjectCodes: ["maths"], isClassTeacher: true,
    }));
    expect(await screen.findByRole("heading", { name: C.title })).toBeTruthy();
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it("a refused save says so and stays", async () => {
    api.create.mockRejectedValue(new Error("400"));
    at(CLASSES_ADD);
    fireEvent.click(await screen.findByRole("radio", { name: "Grade 3" }));
    fireEvent.click(screen.getByRole("button", { name: C.saveClass }));
    expect(await screen.findByText(C.saveFailed)).toBeTruthy();
  });
});
