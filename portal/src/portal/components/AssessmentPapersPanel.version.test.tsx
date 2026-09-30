import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * One entry per paper, showing its latest version: "· Version N" when N > 1,
 * nothing for a paper she never edited (versioned editing, AG 1.2).
 */
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../services/api", () => ({
  portal: {
    getAssessmentOptions: vi.fn().mockResolvedValue({ grades: [4], subjects: [] }),
    getAssessmentPapers: vi.fn(),
  },
}));

import { portal } from "../services/api";
import AssessmentPapersPanel from "./AssessmentPapersPanel";

it("labels an edited paper with its version and leaves a first version plain", async () => {
  vi.mocked(portal.getAssessmentPapers).mockResolvedValue({
    success: true, total: 2, page: 1, pageSize: 10,
    papers: [
      { paper_id: "a3", grade: 4, subject_key: "science", subject: "Science", chapter_number: 3,
        question_count: 21, total_marks: 44, ready_at: "2026-09-30T09:20:05Z", has_answer_key: true, version: 3, version_count: 3 },
      { paper_id: "b1", grade: 3, subject_key: "maths", subject: "Maths", chapter_number: null,
        question_count: 20, total_marks: 40, ready_at: "2026-09-29T10:00:00Z", has_answer_key: true, version: 1, version_count: 1 },
    ],
  });
  render(<AssessmentPapersPanel />);
  expect(await screen.findByText(/Grade 4 Science · Chapter 3 · Version 3/)).toBeTruthy();
  const plain = await screen.findByText(/Grade 3 Maths/);
  expect(plain.textContent).not.toMatch(/Version/);
});
