import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// bd-o15qnr.33 — the library picker opened for a class already named (Check and send's class question, behind the v6/v7
// switch): only that class's grades, and its subject; a step with one answer is skipped, and Back never lands on a
// skipped step (it would only skip forward again). Without `only` the picker is exactly as before (LibraryPicker.recent).

vi.mock("../../services/api", () => ({
  portal: {
    getRecentLessonPlans: vi.fn(),
    getLibraryGrades: vi.fn(),
    getLibrarySubjects: vi.fn(),
    getLibraryChapters: vi.fn(),
    getLibraryLessons: vi.fn(),
  },
}));

import { portal } from "../../services/api";
import LibraryPicker from "./LibraryPicker";

const P = portal as any;
const GRADES = [1, 2, 3, 4, 5].map((grade) => ({ grade, lane: "k5" })).concat([6, 7, 8, 9, 10, 11, 12].map((grade) => ({ grade, lane: "g612" })));
const G612_SUBJECTS = [{ key: "English", label: "English" }, { key: "Mathematics", label: "Mathematics" }, { key: "General Science", label: "General Science" }];

beforeEach(() => {
  vi.clearAllMocks();
  P.getRecentLessonPlans.mockResolvedValue({ plans: [] });
  P.getLibraryGrades.mockResolvedValue(GRADES);
  P.getLibrarySubjects.mockResolvedValue(G612_SUBJECTS);
  P.getLibraryChapters.mockResolvedValue([{ key: "ch1", label: "Chapter 1: Sets" }, { key: "ch2", label: "Chapter 2: Ratios" }]);
  P.getLibraryLessons.mockResolvedValue([{ id: "seg-1", label: "Sets and subsets", sub: "pp. 2-4", ready: true, used: false }]);
});

describe("LibraryPicker for a class already named", () => {
  it("grade 7 and Maths: straight to that class's chapters; no grade buttons, no subject list", async () => {
    const onStep = vi.fn();
    render(<LibraryPicker onPick={vi.fn()} backSignal={0} only={{ grades: [7], subject: "maths" }} hideRecent onStepChange={onStep} />);
    expect(await screen.findByText("Which chapter?")).toBeInTheDocument();
    expect(await screen.findByText("Chapter 1: Sets")).toBeInTheDocument();
    expect(P.getLibrarySubjects).toHaveBeenCalledWith(7, "g612");
    expect(P.getLibraryChapters).toHaveBeenCalledWith(7, "g612", "Mathematics");
    expect(screen.queryByRole("button", { name: "7" })).toBeNull();
    expect(screen.queryByText("English")).toBeNull();
    // the class she named reads as plain words, not as a step to tap back to
    expect(screen.getByText(/Grade 7/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Grade 7/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Mathematics/ })).toBeNull();
    // nothing to step back to inside the picker: the page's Back leaves it
    await waitFor(() => expect(onStep).toHaveBeenLastCalledWith(0));
    expect(P.getRecentLessonPlans).not.toHaveBeenCalled();
  });

  it("a lesson picked from there is the plan, as from the full picker", async () => {
    const onPick = vi.fn();
    render(<LibraryPicker onPick={onPick} backSignal={0} only={{ grades: [7], subject: "maths" }} hideRecent />);
    fireEvent.click(await screen.findByText("Chapter 1: Sets"));
    fireEvent.click(await screen.findByText("Sets and subsets"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ pick: { segmentId: "seg-1", lang: "en" }, title: "Sets and subsets" }));
  });

  it("one step deeper (a chapter's lessons), Back goes to the chapters, then reports nothing left to step back to", async () => {
    const onStep = vi.fn();
    const { rerender } = render(<LibraryPicker onPick={vi.fn()} backSignal={0} only={{ grades: [7], subject: "maths" }} hideRecent onStepChange={onStep} />);
    fireEvent.click(await screen.findByText("Chapter 1: Sets"));
    expect(await screen.findByText("Which lesson?")).toBeInTheDocument();
    await waitFor(() => expect(onStep).toHaveBeenLastCalledWith(1));
    rerender(<LibraryPicker onPick={vi.fn()} backSignal={1} only={{ grades: [7], subject: "maths" }} hideRecent onStepChange={onStep} />);
    expect(await screen.findByText("Which chapter?")).toBeInTheDocument();
    await waitFor(() => expect(onStep).toHaveBeenLastCalledWith(0));
  });

  it("grade 10 (no subject asked): that grade's subjects, no grade buttons", async () => {
    render(<LibraryPicker onPick={vi.fn()} backSignal={0} only={{ grades: [10], subject: null }} hideRecent />);
    expect(await screen.findByText("Which subject?")).toBeInTheDocument();
    expect(await screen.findByText("English")).toBeInTheDocument();
    expect(P.getLibrarySubjects).toHaveBeenCalledWith(10, "g612");
    expect(screen.queryByRole("button", { name: "4" })).toBeNull();
  });

  it("Grade 1-5: only grades 1 to 5 to choose from", async () => {
    render(<LibraryPicker onPick={vi.fn()} backSignal={0} only={{ grades: [1, 2, 3, 4, 5], subject: null }} hideRecent />);
    expect(await screen.findByRole("button", { name: "3" })).toBeInTheDocument();
    for (const g of ["1", "2", "4", "5"]) expect(screen.getByRole("button", { name: g })).toBeInTheDocument();
    for (const g of ["6", "7", "10"]) expect(screen.queryByRole("button", { name: g })).toBeNull();
  });

  it("a subject the library does not name: every subject of that grade, so she is never stuck", async () => {
    render(<LibraryPicker onPick={vi.fn()} backSignal={0} only={{ grades: [7], subject: "islamiat" }} hideRecent />);
    expect(await screen.findByText("Which subject?")).toBeInTheDocument();
    for (const s of ["English", "Mathematics", "General Science"]) expect(await screen.findByText(s)).toBeInTheDocument();
  });

  it("a grade the library does not have: every grade", async () => {
    P.getLibraryGrades.mockResolvedValue([{ grade: 4, lane: "k5" }, { grade: 6, lane: "g612" }]);
    render(<LibraryPicker onPick={vi.fn()} backSignal={0} only={{ grades: [9], subject: null }} hideRecent />);
    expect(await screen.findByRole("button", { name: "4" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "6" })).toBeInTheDocument();
  });
});
