import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * bd-ix9uhr — the old UI's Assessment Generator takes several chapters.
 *
 * A coach's field report: teachers making a term paper need several chapters of the book, and the
 * portal let them pick one. WhatsApp already took up to the whole book (assessment-chapter-cap); the
 * portal now sends the same thing — `chapterNumbers` — and the bot turns them into the pages the
 * paper's questions come from.
 */

// Radix Select does not open in jsdom; a native <select> keeps the same value/onValueChange contract.
vi.mock("@/components/ui/select", () => {
  type Kids = { children?: React.ReactNode };
  const SelectTrigger = (_: { id?: string } & Kids) => null;
  const SelectValue = () => null;
  const SelectContent = ({ children }: Kids) => <>{children}</>;
  const SelectItem = ({ value, children }: { value: string } & Kids) => <option value={value}>{children}</option>;
  const Select = ({ value, onValueChange, disabled, children }: { value: string; onValueChange: (v: string) => void; disabled?: boolean } & Kids) => {
    const kids = React.Children.toArray(children) as React.ReactElement<{ id?: string; children?: React.ReactNode }>[];
    const id = kids.find((k) => k.type === SelectTrigger)?.props.id;
    const items = kids.filter((k) => k.type === SelectContent).map((k) => k.props.children);
    return (
      <select id={id} value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>
        <option value="" />
        {items}
      </select>
    );
  };
  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../services/api", () => ({
  portal: {
    getAssessmentOptions: vi.fn(),
    getAssessmentChapters: vi.fn(),
    getAssessmentDownload: vi.fn(),
  },
}));
import { portal } from "../services/api";
import AssessmentGeneratorPanel from "./AssessmentGeneratorPanel";

const GRADES = { success: true, grades: [3, 4], maxQuestions: 25, defaultQuestions: 15 };
const CHAPTERS = [
  { chapter_number: 1, chapter_title: "Living things", page_start: 2, page_end: 10, page_count: 9 },
  { chapter_number: 2, chapter_title: "Plants", page_start: 11, page_end: 20, page_count: 10 },
  { chapter_number: 3, chapter_title: "Animals", page_start: 21, page_end: 30, page_count: 10 },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(portal.getAssessmentOptions).mockImplementation(async (grade?: number, subject?: string) => {
    if (grade == null) return GRADES as never;
    const subjects = [{ subject_key: "science", subject: "Science" }];
    if (!subject) return { ...GRADES, subjects } as never;
    return { ...GRADES, subjects, types: [{ id: "MCQs", category: "objective" }] } as never;
  });
  vi.mocked(portal.getAssessmentChapters).mockResolvedValue({ success: true, chapters: CHAPTERS } as never);
});

async function openBook(onStart = vi.fn().mockResolvedValue({ ok: true })) {
  render(<AssessmentGeneratorPanel onStart={onStart} onGoToPapers={vi.fn()} onMakeAnother={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText("Class")).toBeInTheDocument());
  await waitFor(() => expect(screen.getByLabelText("Class").querySelectorAll("option").length).toBeGreaterThan(1));
  fireEvent.change(screen.getByLabelText("Class"), { target: { value: "4" } });
  await waitFor(() => expect(screen.getByLabelText("Subject").querySelectorAll("option").length).toBeGreaterThan(1));
  fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "science" } });
  await screen.findByRole("checkbox", { name: /Plants/ });
  return onStart;
}

const make = () => screen.getByRole("button", { name: "Generate" });

describe("AssessmentGeneratorPanel — chapters", () => {
  it("lists every chapter as a checkbox, none ticked, and Make stays off until one is", async () => {
    await openBook();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "false", "false"]);
    expect(make()).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Plants/ }));
    expect(make()).toBeEnabled();
  });

  it("one chapter is sent as before, with chapterNumbers alongside", async () => {
    const onStart = await openBook();
    fireEvent.click(screen.getByRole("checkbox", { name: /Plants/ }));
    fireEvent.click(make());
    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(onStart.mock.calls[0][0]).toMatchObject({ grade: 4, subject: "science", chapterNumber: 2, chapterNumbers: [2] });
    expect(onStart.mock.calls[0][1]).toContain("Plants");
  });

  it("several chapters go as one paper, in book order, with no single chapterNumber", async () => {
    const onStart = await openBook();
    fireEvent.click(screen.getByRole("checkbox", { name: /Animals/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Living things/ }));
    expect(screen.getByText(/2 chapters/)).toBeInTheDocument();
    fireEvent.click(make());
    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(onStart.mock.calls[0][0]).toMatchObject({ chapterNumber: null, chapterNumbers: [1, 3] });
    expect(onStart.mock.calls[0][1]).toContain("Chapters 1, 3");
  });

  it("unticking the last chapter turns Make off again", async () => {
    await openBook();
    const plants = screen.getByRole("checkbox", { name: /Plants/ });
    fireEvent.click(plants);
    fireEvent.click(plants);
    expect(make()).toBeDisabled();
  });
});
