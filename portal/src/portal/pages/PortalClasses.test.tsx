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
vi.mock("../services/api", () => ({
  classes: {
    list: (...args: any[]) => list(...args),
    create: (...args: any[]) => create(...args),
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

  it("submits the chosen grade, section, subjects and role", async () => {
    create.mockResolvedValue({ success: true, created: true });
    await renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /add a class/i }));
    await userEvent.selectOptions(screen.getByLabelText("Class"), "grade_4");
    await userEvent.type(screen.getByLabelText("Section"), "b");
    await userEvent.click(screen.getByRole("button", { name: "Mathematics" }));
    await userEvent.click(screen.getByLabelText(/I am the class teacher/i));
    await userEvent.click(screen.getByRole("button", { name: /save class/i }));

    await waitFor(() => expect(create).toHaveBeenCalledWith({
      gradeCode: "grade_4",
      section: "b",
      subjectCodes: ["maths"],
      isClassTeacher: true,
    }));
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
