import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-fmf24g.13 — My Classes in Urdu: the list, Class detail and Add a class take every word from CLASSES
 * (bilingual); class, subject and child names from the API stay as they are. MACHINE-DRAFTED Urdu from the
 * bot's existing Urdu (میری کلاسیں، طلبہ شامل کریں، کلاس ٹیچر).
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(() => new Promise(() => {})), post: vi.fn() },
  classes: { list: vi.fn(), create: vi.fn(), students: vi.fn(), addStudents: vi.fn(), removeStudent: vi.fn() },
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));
vi.mock("../../lib/gradeSubjects", () => ({ loadGradeSubjects: vi.fn() }));

import "../routes";
import { classes as classesApi } from "../../services/api";
import { loadGradeSubjects } from "../../lib/gradeSubjects";
import classRoutes from "./routes";
import { CLASSES_ADD, CLASSES_HOME, classPath } from "./paths";
import { CLASSES_V2_COPY_UR as U } from "./copy";

const api = classesApi as unknown as Record<"list" | "students", ReturnType<typeof vi.fn>>;
const plain = (t: string | null) => (t || "").replace(/[⁦⁩]/g, "");

const LIST = {
  success: true, canAdd: true, currentSession: "2026-27",
  grades: [{ code: "grade_4", label: "Grade 4" }], subjects: [{ code: "science", label: "General Science" }],
  sections: [{ code: "A", label: "A" }], shifts: [{ code: "morning", label: "Morning" }],
  classes: [{ classId: "c1", gradeCode: "grade_4", gradeLabel: "Grade 4", section: "A", shiftCode: "morning", sessionCode: "2026-27",
    isClassTeacher: true, display: "Grade 4 - A", subjects: [{ code: "science", label: "General Science" }] }],
};

const at = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>{classRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}</Routes>
  </MemoryRouter>,
);

beforeEach(async () => {
  vi.clearAllMocks();
  api.list.mockResolvedValue(LIST);
  api.students.mockResolvedValue({ success: true, students: [{ studentId: "s1", studentName: "Child 1", fatherName: null, rollNumber: 1, enrolledOn: null }] });
  (loadGradeSubjects as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("ur"); });
});

describe("My Classes in Urdu", () => {
  it("the list: title, Add a class, Class teacher", async () => {
    at(CLASSES_HOME);
    expect(await screen.findByRole("heading", { level: 1, name: U.title })).toBeTruthy();
    expect(await screen.findByText(U.addClass)).toBeTruthy();
    expect(plain(document.body.textContent)).toContain(U.classTeacher);
    expect(screen.queryByText("Add a class")).toBeNull();
  });

  it("Class detail: Students and Add students in Urdu; the child's name as it is", async () => {
    at(classPath("c1"));
    expect(await screen.findByText("Child 1")).toBeTruthy();
    expect(plain(document.body.textContent)).toContain(U.students);
    expect(screen.getByRole("button", { name: U.addStudents })).toBeTruthy();
    expect(screen.queryByText("Students")).toBeNull();
  });

  it("Add a class: the fields and Save class in Urdu", async () => {
    at(CLASSES_ADD);
    expect(await screen.findByRole("button", { name: U.saveClass })).toBeTruthy();
    expect(plain(document.body.textContent)).toContain(U.section);
    expect(screen.queryByText("Save class")).toBeNull();
  });
});
