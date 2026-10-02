import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// bd-5rz1v.6 — whose recent plans come first. A teacher picking her own plan
// sees HERS, exactly as before; a coach picking for a teacher passes a loader
// for the OBSERVED teacher's, under its own heading, without "you used this".

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
const plan = (assetId: string, topic: string) => ({ assetId, lessonId: "l", topic, grade: 4, subject: "Maths", chapterNumber: 5, dayLabel: "Day 2", pagesLabel: null, downloadedAt: null });

beforeEach(() => {
  vi.clearAllMocks();
  P.getRecentLessonPlans.mockResolvedValue({ plans: [plan("mine", "My own plan")] });
  P.getLibraryGrades.mockResolvedValue([{ grade: 4, lane: "k5" }]);
});

describe("LibraryPicker recent plans", () => {
  it("unchanged for a teacher: her own recent plans under 'Your recent plans'", async () => {
    const onPick = vi.fn();
    render(<LibraryPicker onPick={onPick} backSignal={0} />);
    expect(await screen.findByText("Your recent plans")).toBeInTheDocument();
    fireEvent.click(screen.getByText("My own plan"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ pick: { assetId: "mine" } }));
    expect(P.getRecentLessonPlans).toHaveBeenCalledTimes(1);
  });

  it("a coach's loader replaces the teacher's own list, with its heading", async () => {
    const loadRecent = vi.fn().mockResolvedValue({ plans: [plan("hers", "Her plan")] });
    render(<LibraryPicker onPick={vi.fn()} backSignal={0} loadRecent={loadRecent} recentTitle="Her recent plans" showUsed={false} />);
    expect(await screen.findByText("Her recent plans")).toBeInTheDocument();
    expect(screen.getByText("Her plan")).toBeInTheDocument();
    expect(P.getRecentLessonPlans).not.toHaveBeenCalled();
  });

  it("'You used this plan' shows by default and hides for a coach", async () => {
    P.getLibrarySubjects.mockResolvedValue([{ key: "math", label: "Maths" }]);
    P.getLibraryChapters.mockResolvedValue([{ key: "c5", label: "Chapter 5" }]);
    P.getLibraryLessons.mockResolvedValue([{ id: "g4-l1", label: "Halves", sub: null, ready: true, used: true }]);
    const walk = async () => {
      fireEvent.click(await screen.findByRole("button", { name: "4" }));
      fireEvent.click(await screen.findByText("Maths"));
      fireEvent.click(await screen.findByText("Chapter 5"));
      await screen.findByText("Halves");
    };
    const { unmount } = render(<LibraryPicker onPick={vi.fn()} backSignal={0} />);
    await walk();
    expect(screen.getByText("✓ You used this plan")).toBeInTheDocument();
    unmount();
    render(<LibraryPicker onPick={vi.fn()} backSignal={0} loadRecent={async () => ({ plans: [] })} showUsed={false} />);
    await walk();
    expect(screen.queryByText("✓ You used this plan")).toBeNull();
  });
});
