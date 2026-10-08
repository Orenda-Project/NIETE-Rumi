import { describe, it, expect, vi } from "vitest";
import { resolve } from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { newUiSourceFiles, scanCopy, scanStyle } from "../../newui/checks/source";
import { collectCopy, copyProblem, tapProblems } from "../../newui/checks/rules";

/**
 * bd-fmf24g.8 — the My Classes pages keep the kit's rules (teacher/ui/checks.test.tsx), with the same
 * checkers: start/end only, motion only under motion-safe:, no lying theme classes; every word from
 * copy.ts (≤4 words, never a sentence); every target 56px.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(() => new Promise(() => {})), post: vi.fn() },
  classes: {
    list: vi.fn(async () => ({
      success: true, canAdd: true, currentSession: "2026-27",
      grades: [{ code: "grade_4", label: "Grade 4" }], subjects: [{ code: "science", label: "General Science" }],
      sections: [{ code: "A", label: "A" }], shifts: [{ code: "morning", label: "Morning" }],
      classes: [{ classId: "c1", gradeCode: "grade_4", gradeLabel: "Grade 4", section: "A", shiftCode: "morning", sessionCode: "2026-27",
        isClassTeacher: true, display: "Grade 4 - A", subjects: [{ code: "science", label: "General Science" }] }],
    })),
    students: vi.fn(async () => ({ success: true, students: Array.from({ length: 9 }, (_, i) => ({
      studentId: `s${i}`, studentName: `Child ${i}`, fatherName: null, rollNumber: i + 1, enrolledOn: null })) })),
    create: vi.fn(), addStudents: vi.fn(), removeStudent: vi.fn(),
  },
}));
vi.mock("../../lib/gradeSubjects", () => ({ loadGradeSubjects: vi.fn(async () => []) }));

import "../routes";
import classRoutes from "./routes";
import { CLASSES_V2_COPY } from "./copy";
import { CLASSES_ADD, CLASSES_HOME, classPath } from "./paths";

const files = () => newUiSourceFiles(resolve(__dirname)).filter((f) => !/\.test\.tsx?$/.test(f.rel));

const at = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>{classRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}</Routes>
  </MemoryRouter>,
);

describe("classes: style", () => {
  it("reads the pages' source", () => {
    expect(files().map((f) => f.rel)).toEqual(expect.arrayContaining(["MyClassesPage.tsx", "ClassDetailPage.tsx", "AddClassPage.tsx"]));
  });

  it("no left/right utilities, no motion outside motion-safe:, no lying theme classes", () => {
    const problems = files().flatMap((f) => scanStyle(f.rel, f.text)).filter((p) => p.rule !== "raw-colour" && p.rule !== "feature-colour");
    expect(problems).toEqual([]);
  });
});

describe("classes: copy", () => {
  it("every word is a label: at most 4 words, never a sentence", () => {
    const bad = collectCopy(CLASSES_V2_COPY).filter((c) => copyProblem(c.text)).map((c) => `${c.path}: ${c.text}`);
    expect(bad).toEqual([]);
  });

  it("no words written into a page (they come from copy.ts)", () => {
    const problems = files().filter((f) => f.rel !== "copy.ts").flatMap((f) => scanCopy(f.rel, f.text));
    expect(problems).toEqual([]);
  });
});

describe("classes: every target is 56px or more", () => {
  it("My Classes", async () => {
    const { container } = at(CLASSES_HOME);
    await screen.findByText("Grade 4-A · General Science");
    expect(tapProblems(container)).toEqual([]);
  });

  it("Class detail, with its trays", async () => {
    const { container } = at(classPath("c1"));
    await screen.findByText("Child 0");
    expect(tapProblems(container)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: CLASSES_V2_COPY.addStudents }));
    expect(tapProblems(document.body)).toEqual([]);
  });

  it("Add a class", async () => {
    const { container } = at(CLASSES_ADD);
    await screen.findByRole("button", { name: CLASSES_V2_COPY.saveClass });
    expect(tapProblems(container)).toEqual([]);
  });
});
