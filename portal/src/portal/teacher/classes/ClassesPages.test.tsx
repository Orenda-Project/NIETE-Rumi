import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-fmf24g.8 — My Classes (Classes only; no timetable), Class detail and Add a class, on the existing
 * routes: GET/POST /classes, GET/POST /classes/:id/students, DELETE /classes/:id/students/:sid,
 * GET /me/grade-subjects?feature=lessons.
 *
 * bd-ql2j3p — Remove class: DELETE /classes/:id (the bot decides whether that retires the class or
 * takes her off it).
 *
 * bd-mx822w — Edit a name: tap a child, the tray opens with the name box focused; Save sends
 * POST /classes/:id/students/:sid/name { name }. Remove student lives in that tray, after asking.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(() => new Promise(() => {})), post: vi.fn() },
  classes: { list: vi.fn(), create: vi.fn(), students: vi.fn(), addStudents: vi.fn(), removeStudent: vi.fn(), renameStudent: vi.fn(), removeClass: vi.fn() },
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
import { CLASSES_ADD, CLASSES_HOME, CLASS_ADD_STUDENTS, CLASS_DETAIL, addStudentsPath, classPath } from "./paths";
import { CLASSES_V2_COPY as C } from "./copy";
import { LESSONS_HOME } from "../lessons/paths";
import { beforeAll as preloadFirst } from "vitest";
import { preloadAll } from "@/lib/lazyPage";

// bd-sex15q.34 — these pages are their own chunks (lib/lazyPage); load them before stepping through them synchronously.
preloadFirst(() => preloadAll({ pages: true }), 120_000);

const api = classesApi as unknown as Record<"list" | "create" | "students" | "addStudents" | "removeStudent" | "renameStudent" | "removeClass", ReturnType<typeof vi.fn>>;
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
  it("registers My Classes, Add a class, Class detail and Add students under /portal/teacher/classes — no timetable", () => {
    expect(classRoutes.map((r) => r.path)).toEqual([CLASSES_HOME, CLASSES_ADD, CLASS_DETAIL, CLASS_ADD_STUDENTS]);
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

  it("Add students opens its own page; there is no paste box on the class page", async () => {
    at(classPath("c1"));
    await screen.findByRole("list", { name: C.students });
    expect(screen.getByRole("link", { name: C.addStudents }).getAttribute("href")).toBe(addStudentsPath("c1"));
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("Add students page: two rows numbered after the roster, Add student adds one, X removes one, Save sends only named rows", async () => {
    api.addStudents.mockResolvedValue({ success: true, added: 2, duplicates: 1, dropped: 0 });
    at(addStudentsPath("c1"));
    // STUDENTS(3) is on the class, so the new rows are roll 4 and 5. The roll is shown, never typed.
    const first = await screen.findByLabelText(C.nameOfRoll(4));
    expect(screen.getByLabelText(C.nameOfRoll(5))).toBeTruthy();
    expect(screen.queryByLabelText(C.nameOfRoll(6))).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    // No column heading: the number is the class page's own roll badge, and each empty box says "Name".
    expect(screen.queryByText("Roll no")).toBeNull();
    expect(screen.getAllByPlaceholderText(C.name)).toHaveLength(2);
    expect(screen.getByText("4")).toBeTruthy();
    const save = () => screen.getByRole("button", { name: /^Save/ }) as HTMLButtonElement;
    expect(save().disabled).toBe(true);

    fireEvent.change(first, { target: { value: "Sara" } });
    expect(save().textContent).toBe(C.saveStudents(1));
    fireEvent.click(screen.getByRole("button", { name: C.addStudent }));
    fireEvent.change(screen.getByLabelText(C.nameOfRoll(6)), { target: { value: "  Child 1 " } });
    // Roll 5 stays empty; removing it renumbers the row below, as the roster will.
    fireEvent.click(screen.getByRole("button", { name: C.removeRoll(5) }));
    expect((screen.getByLabelText(C.nameOfRoll(5)) as HTMLTextAreaElement).value).toBe("  Child 1 ");
    expect(save().textContent).toBe(C.saveStudents(2));

    fireEvent.click(save());
    await waitFor(() => expect(api.addStudents).toHaveBeenCalledWith("c1", ["Sara", "Child 1"]));
    expect(await screen.findByText(C.added(2))).toBeTruthy();
    expect(screen.getByText(C.alreadyThere(1))).toBeTruthy();
    expect(screen.getByRole("link", { name: C.back }).getAttribute("href")).toBe(classPath("c1"));
    // Add more starts again, numbered after what was just saved.
    api.students.mockResolvedValue({ success: true, students: STUDENTS(5) });
    fireEvent.click(screen.getByRole("button", { name: C.addMore }));
    expect(await screen.findByLabelText(C.nameOfRoll(6))).toBeTruthy();
  });

  it("Add students page: a failed save says so and keeps every name she typed", async () => {
    api.addStudents.mockRejectedValue(new Error("502"));
    at(addStudentsPath("c1"));
    fireEvent.change(await screen.findByLabelText(C.nameOfRoll(4)), { target: { value: "Sara" } });
    fireEvent.click(screen.getByRole("button", { name: C.saveStudents(1) }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect((screen.getByLabelText(C.nameOfRoll(4)) as HTMLTextAreaElement).value).toBe("Sara");
  });

  it("each child is one tap target with no bin on the row; tapping opens Edit student with the name box focused, caret at the end", async () => {
    at(classPath("c1"));
    await screen.findByRole("list", { name: C.students });
    expect(screen.queryByRole("button", { name: /^Remove Child/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: C.editNamed("Child 2") }));
    const dialog = await screen.findByRole("dialog", { name: C.editStudent });
    const box = within(dialog).getByRole("textbox", { name: C.nameOfRoll(2) }) as HTMLTextAreaElement;
    expect(box.value).toBe("Child 2");
    await waitFor(() => expect(document.activeElement).toBe(box));
    expect(box.selectionStart).toBe("Child 2".length);
  });

  it("Save stays off until the name changes; Save renames through the route, the list shows the new name and Name saved", async () => {
    api.renameStudent.mockResolvedValue({ success: true, studentName: "Child Two" });
    at(classPath("c1"));
    await screen.findByRole("list", { name: C.students });
    fireEvent.click(screen.getByRole("button", { name: C.editNamed("Child 2") }));
    const dialog = await screen.findByRole("dialog", { name: C.editStudent });
    const box = within(dialog).getByRole("textbox", { name: C.nameOfRoll(2) });
    const save = within(dialog).getByRole("button", { name: C.save }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "  Child 2 " } });
    expect(save.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "  " } });
    expect(save.disabled).toBe(true);
    fireEvent.change(box, { target: { value: " Child Two " } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(api.renameStudent).toHaveBeenCalledWith("c1", "s2", "Child Two"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await screen.findByRole("status")).textContent).toContain(C.nameSaved);
    const list = screen.getByRole("list", { name: C.students });
    expect(within(list).getByText("Child Two")).toBeTruthy();
    expect(within(list).queryByText("Child 2")).toBeNull();
  });

  it("a failed rename says so and keeps what she typed", async () => {
    api.renameStudent.mockRejectedValue(new Error("502"));
    at(classPath("c1"));
    await screen.findByRole("list", { name: C.students });
    fireEvent.click(screen.getByRole("button", { name: C.editNamed("Child 2") }));
    const dialog = await screen.findByRole("dialog", { name: C.editStudent });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Child Two" } });
    fireEvent.click(within(dialog).getByRole("button", { name: C.save }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe(C.saveFailed);
    expect((within(dialog).getByRole("textbox") as HTMLTextAreaElement).value).toBe("Child Two");
  });

  it("Remove student is inside the edit tray and asks first; Keep goes back, Remove deletes through the existing route", async () => {
    api.removeStudent.mockResolvedValue({ success: true });
    at(classPath("c1"));
    await screen.findByRole("list", { name: C.students });
    fireEvent.click(screen.getByRole("button", { name: C.editNamed("Child 2") }));
    let dialog = await screen.findByRole("dialog", { name: C.editStudent });
    fireEvent.click(within(dialog).getByRole("button", { name: C.removeStudent }));
    dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: C.keep }));
    expect(api.removeStudent).not.toHaveBeenCalled();
    expect(within(screen.getByRole("dialog")).getByRole("textbox")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: C.removeStudent }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: C.remove }));
    await waitFor(() => expect(api.removeStudent).toHaveBeenCalledWith("c1", "s2"));
    await waitFor(() => expect(api.students).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Remove class asks first; Keep leaves it, Remove deletes through the route and returns to My Classes", async () => {
    api.removeClass.mockResolvedValue({ success: true, removed: true, how: "left" });
    at(classPath("c1"));
    await screen.findByRole("list", { name: C.students });
    fireEvent.click(screen.getByRole("button", { name: C.removeClass }));
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Grade 4-A")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: C.keep }));
    expect(api.removeClass).not.toHaveBeenCalled();

    api.list.mockResolvedValue({ ...LIST, classes: LIST.classes.filter((c) => c.classId !== "c1") });
    fireEvent.click(screen.getByRole("button", { name: C.removeClass }));
    dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: C.remove }));
    await waitFor(() => expect(api.removeClass).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(screen.getByTestId("classes-count").textContent).toBe("1"));
    expect(screen.queryByText("Grade 4-A · General Science")).toBeNull();
  });

  it("a refused Remove class says so and stays on the class", async () => {
    api.removeClass.mockRejectedValue(new Error("502"));
    at(classPath("c1"));
    await screen.findByRole("list", { name: C.students });
    fireEvent.click(screen.getByRole("button", { name: C.removeClass }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: C.remove }));
    expect(await within(dialog).findByText(C.saveFailed)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Grade 4-A" })).toBeTruthy();
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
