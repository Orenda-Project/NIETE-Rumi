import { it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * bd-t5tow I2 — My papers is now its own tab, so the empty list can no longer say "Make one
 * above." With `onCreate` it offers a Create paper button; without, a neutral "No papers yet."
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

beforeEach(() => {
  vi.mocked(portal.getAssessmentPapers).mockResolvedValue({ success: true, papers: [], total: 0, page: 1, pageSize: 10 });
});

it("with onCreate: 'No papers yet.' and a Create paper button that calls it", async () => {
  const onCreate = vi.fn();
  render(<AssessmentPapersPanel onCreate={onCreate} />);
  expect(await screen.findByText("No papers yet.")).toBeInTheDocument();
  expect(screen.queryByText(/Make one above/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Create paper" }));
  expect(onCreate).toHaveBeenCalledTimes(1);
});

it("without onCreate: a neutral 'No papers yet.' and no button", async () => {
  render(<AssessmentPapersPanel />);
  expect(await screen.findByText("No papers yet.")).toBeInTheDocument();
  expect(screen.queryByText(/Make one above/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Create paper" })).toBeNull();
});
