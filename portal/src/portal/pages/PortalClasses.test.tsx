import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * The classes page.
 *
 * The two assertions that matter most are both about NOT showing things:
 *
 *   1. When the account cannot have a class created — no school on file, which is
 *      roughly one teacher in eight — the add form must not be offered. A form
 *      that always fails is worse than a sentence explaining why.
 *   2. The page must not carry its own grade or subject vocabulary. Options come
 *      from the API already localised, because the labels live in ONE catalog in
 *      the bot process. This is checked by feeding the API Urdu labels and
 *      asserting they render verbatim — if the page ever hardcoded English, that
 *      test goes red.
 */

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ user: { firstName: "Ayesha" }, logout: vi.fn() }),
}));
vi.mock("../components/PortalLayout", () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));

const list = vi.fn();
const create = vi.fn();
const students = vi.fn();
const addStudents = vi.fn();
const removeStudent = vi.fn();
vi.mock("../services/api", () => ({
  classes: {
    list: (...args: any[]) => list(...args),
    create: (...args: any[]) => create(...args),
    students: (...args: any[]) => students(...args),
    addStudents: (...args: any[]) => addStudents(...args),
    removeStudent: (...args: any[]) => removeStudent(...args),
  },
}));

import PortalClasses from "./PortalClasses";

const OPTIONS = {
  grades: [
    { code: "early_years", label: "Early Years (KG)" },
    { code: "grade_4", label: "Grade 4" },
  ],
  subjects: [
    { code: "maths", label: "Mathematics" },
    { code: "urdu", label: "Urdu" },
  ],
  sections: [
    { code: "A", label: "A" },
    { code: "B", label: "B" },
  ],
  shifts: [
    { code: "morning", label: "Morning" },
    { code: "evening", label: "Evening" },
  ],
};

function response(over: any = {}) {
  return {
    success: true,
    classes: [],
    canAdd: true,
    currentSession: "2026-2027",
    ...OPTIONS,
    ...over,
  };
}

async function renderPage(over: any = {}) {
  list.mockResolvedValue(response(over));
  render(
    <MemoryRouter>
      <PortalClasses />
    </MemoryRouter>,
  );
  // The page renders <LoadingState/> until the fetch resolves.
  await waitFor(() => expect(list).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PortalClasses", () => {
  it("lists the teacher's classes with session and subjects", async () => {
    await renderPage({
      classes: [{
        classId: "c1",
        gradeCode: "grade_4",
        gradeLabel: "Grade 4",
        section: "A",
        sessionCode: "2026-2027",
        isClassTeacher: true,
        display: "Grade 4 - A",
        subjects: [{ code: "maths", label: "Mathematics" }],
      }],
    });

    expect(await screen.findByText("Grade 4 - A")).toBeInTheDocument();
    expect(screen.getByText(/2026-2027 · Mathematics/)).toBeInTheDocument();
    expect(screen.getByText("Class teacher")).toBeInTheDocument();
  });

  it("shows an empty state, not an error, when there are no classes", async () => {
    await renderPage();
    expect(await screen.findByText("No classes yet")).toBeInTheDocument();
  });

  it("does NOT offer the add form when the account has no school on file", async () => {
    await renderPage({ canAdd: false });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /add a class/i })).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Ask your coach to link your school/i)).toBeInTheDocument();
  });

  it("renders the labels the API supplied rather than its own vocabulary", async () => {
    // Urdu labels, exactly as the bot's catalog would resolve them for an
    // Urdu-preferring teacher. The page must not translate or relabel.
    await renderPage({
      grades: [{ code: "grade_4", label: "جماعت چہارم" }],
      subjects: [{ code: "maths", label: "ریاضی" }],
    });

    await userEvent.click(await screen.findByRole("button", { name: /add a class/i }));

    expect(screen.getByRole("option", { name: "جماعت چہارم" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ریاضی" })).toBeInTheDocument();
  });

  it("submits the chosen grade, section, shift, subjects and role", async () => {
    create.mockResolvedValue({ success: true, created: true });
    await renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /add a class/i }));
    await userEvent.selectOptions(screen.getByLabelText("Class"), "grade_4");
    // A dropdown now, not a text box: sections are a closed set, so free text here
    // would be refused by the database.
    await userEvent.selectOptions(screen.getByLabelText("Section"), "B");
    await userEvent.selectOptions(screen.getByLabelText("Shift"), "evening");
    await userEvent.click(screen.getByRole("button", { name: "Mathematics" }));
    await userEvent.click(screen.getByLabelText(/I am the class teacher/i));
    await userEvent.click(screen.getByRole("button", { name: /save class/i }));

    await waitFor(() => expect(create).toHaveBeenCalledWith({
      gradeCode: "grade_4",
      section: "B",
      shiftCode: "evening",
      subjectCodes: ["maths"],
      isClassTeacher: true,
    }));
  });

  it("offers only the seeded sections, plus 'no section'", async () => {
    await renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /add a class/i }));
    const opts = Array.from(screen.getByLabelText("Section").querySelectorAll("option"))
      .map((o) => (o as HTMLOptionElement).value);
    expect(opts).toEqual(["", "A", "B"]);
  });

  it("names the support route when a section is missing", async () => {
    await renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /add a class/i }));
    expect(screen.getByText(/Ask NIETE support to add it/i)).toBeInTheDocument();
  });

  it("defaults the shift to morning", async () => {
    create.mockResolvedValue({ success: true, created: true });
    await renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /add a class/i }));
    await userEvent.selectOptions(screen.getByLabelText("Class"), "grade_4");
    await userEvent.click(screen.getByRole("button", { name: /save class/i }));

    await waitFor(() => expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ shiftCode: "morning" }),
    ));
  });

  it("confirms the save AND names a declined subject", async () => {
    // The class was saved; only the subject claim was declined. Leading with a
    // failure would send her back to create the class a second time.
    create.mockResolvedValue({ success: true, created: true, subjectsTaken: ["maths"] });
    await renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /add a class/i }));
    await userEvent.selectOptions(screen.getByLabelText("Class"), "grade_4");
    await userEvent.click(screen.getByRole("button", { name: /save class/i }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Class saved",
      description: expect.stringMatching(/already teaches Mathematics/),
    })));
  });

  it("confirms the save AND names a declined class-teacher role", async () => {
    create.mockResolvedValue({ success: true, created: true, classTeacherTaken: true });
    await renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /add a class/i }));
    await userEvent.selectOptions(screen.getByLabelText("Class"), "grade_4");
    await userEvent.click(screen.getByRole("button", { name: /save class/i }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      description: expect.stringMatching(/already the class teacher/i),
    })));
  });

  it("refuses to submit without a grade", async () => {
    await renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /add a class/i }));
    await userEvent.click(screen.getByRole("button", { name: /save class/i }));

    expect(create).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Choose a class first" }));
  });

  it("says the class was already there rather than implying a duplicate", async () => {
    create.mockResolvedValue({ success: true, created: false });
    await renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /add a class/i }));
    await userEvent.selectOptions(screen.getByLabelText("Class"), "grade_4");
    await userEvent.click(screen.getByRole("button", { name: /save class/i }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "That class was already there" }),
    ));
  });

  it("surfaces the API's own sentence on a 409, because it names the fix", async () => {
    create.mockRejectedValue({
      response: { status: 409, data: { error: "That class already has a class teacher. The class was saved without that role." } },
    });
    await renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /add a class/i }));
    await userEvent.selectOptions(screen.getByLabelText("Class"), "grade_4");
    await userEvent.click(screen.getByRole("button", { name: /save class/i }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      description: "That class already has a class teacher. The class was saved without that role.",
    })));
  });
});

describe("the class roster", () => {
  const ONE_CLASS = [{
    classId: "c1", gradeCode: "grade_4", gradeLabel: "Grade 4", section: "A",
    shiftCode: "morning", sessionCode: "2026-2027", isClassTeacher: true,
    display: "Grade 4 - A", subjects: [{ code: "maths", label: "Mathematics" }],
  }];

  async function openRoster(rows: any[] = []) {
    students.mockResolvedValue({ success: true, students: rows });
    await renderPage({ classes: ONE_CLASS });
    await userEvent.click(await screen.findByRole("button", { name: /students/i }));
    await waitFor(() => expect(students).toHaveBeenCalledWith("c1"));
  }

  it("lists the children with roll number and father's name", async () => {
    await openRoster([
      { studentId: "s1", studentName: "Ayesha Bibi", fatherName: "Muhammad Aslam", rollNumber: 1, enrolledOn: null },
    ]);
    expect(await screen.findByText(/Ayesha Bibi/)).toBeInTheDocument();
    expect(screen.getByText(/Muhammad Aslam/)).toBeInTheDocument();
  });

  it("invites a paste when the roster is empty, rather than showing an error", async () => {
    await openRoster([]);
    expect(await screen.findByText(/Paste the register below/i)).toBeInTheDocument();
  });

  it("sends the pasted block as one request", async () => {
    // One paste, not one child per round-trip — the lesson the attendance flow
    // recorded in its own source.
    addStudents.mockResolvedValue({ success: true, added: 2, duplicates: 0, dropped: 0 });
    await openRoster([]);
    await userEvent.type(screen.getByLabelText("Add students"), "Ayesha Bibi{enter}Bilal Ahmed");
    await userEvent.click(screen.getByRole("button", { name: /add to class/i }));

    await waitFor(() => expect(addStudents).toHaveBeenCalledWith("c1", "Ayesha Bibi\nBilal Ahmed"));
  });

  it("reports duplicates and a hit cap without calling them failures", async () => {
    addStudents.mockResolvedValue({ success: true, added: 300, duplicates: 2, dropped: 20 });
    await openRoster([]);
    await userEvent.type(screen.getByLabelText("Add students"), "Ayesha Bibi");
    await userEvent.click(screen.getByRole("button", { name: /add to class/i }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "300 students added",
      description: expect.stringMatching(/already on the roster.*were not added/),
    })));
  });

  it("refuses an empty paste", async () => {
    await openRoster([]);
    await userEvent.click(screen.getByRole("button", { name: /add to class/i }));
    expect(addStudents).not.toHaveBeenCalled();
  });

  it("warns that removing a child affects every teacher, and obeys a cancel", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await openRoster([
      { studentId: "s1", studentName: "Ayesha Bibi", fatherName: null, rollNumber: 1, enrolledOn: null },
    ]);
    await userEvent.click(await screen.findByRole("button", { name: /Remove Ayesha Bibi/i }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/Every teacher on the class/i));
    expect(removeStudent).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("removes the child when confirmed", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    removeStudent.mockResolvedValue({ success: true, removed: true });
    await openRoster([
      { studentId: "s1", studentName: "Ayesha Bibi", fatherName: null, rollNumber: 1, enrolledOn: null },
    ]);
    await userEvent.click(await screen.findByRole("button", { name: /Remove Ayesha Bibi/i }));

    await waitFor(() => expect(removeStudent).toHaveBeenCalledWith("c1", "s1"));
    await waitFor(() => expect(screen.queryByText(/Ayesha Bibi/)).not.toBeInTheDocument());
    confirmSpy.mockRestore();
  });
});
