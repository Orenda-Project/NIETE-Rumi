import { it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * A page past her last paper comes back empty with the real total (the list shrank, or a filter
 * changed under page 2). That is not "No papers yet.": the panel goes to her last page instead.
 */
// One toast for every render: a new one each time would remake load() and refetch forever.
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("../services/api", () => ({
  portal: {
    getAssessmentOptions: vi.fn().mockResolvedValue({ grades: [4], subjects: [] }),
    getAssessmentPapers: vi.fn(),
  },
}));

import { portal } from "../services/api";
import AssessmentPapersPanel from "./AssessmentPapersPanel";

const paper = (n: number) => ({
  paper_id: `p-${n}`, grade: 4, subject_key: "science", subject: "Science", chapter_number: n,
  question_count: 10, total_marks: 20, ready_at: "2026-10-08T05:00:00Z", has_answer_key: false,
  version: 1, version_count: 1,
});

let total = 12;
beforeEach(() => {
  total = 12;
  vi.mocked(portal.getAssessmentPapers).mockImplementation(async ({ page = 1 } = {}) => {
    const from = (page - 1) * 10;
    const papers = Array.from({ length: 10 }, (_, i) => from + i + 1).filter((n) => n <= total).map(paper);
    return { success: true, papers, total, page, pageSize: 10 };
  });
});

it("an empty page past the end goes to her last page, never 'No papers yet.'", async () => {
  render(<AssessmentPapersPanel />);
  expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument();

  total = 4; // the list shrank before she tapped Next
  fireEvent.click(screen.getByRole("button", { name: /Next/ }));

  await waitFor(() => expect(vi.mocked(portal.getAssessmentPapers).mock.calls.map(([q]) => q?.page)).toEqual([1, 2, 1]));
  expect(screen.queryByText("No papers yet.")).toBeNull();
  await waitFor(() => expect(screen.getAllByText(/Chapter 4\b/).length).toBeGreaterThan(0));
});
