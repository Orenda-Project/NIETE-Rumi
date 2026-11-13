import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * GB follows ICT 6-12 (queue #71). A GB teacher's Grades 1-5 shelf now lists every lesson of her books; the bot
 * marks a lesson not written yet with `ready: false`. Such a lesson is got ready the way a 6-12 one is: asked for
 * (POST /lp612/request), polled, then opened — in the Lesson Plans screens and in the coaching library picker.
 * A written lesson (or any lesson with no `ready` field: every ICT one) opens at once, exactly as before.
 */

vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal: {
    getRecentLessonPlans: vi.fn(),
    getLibraryGrades: vi.fn(),
    getLibrarySubjects: vi.fn(),
    getLibraryChapters: vi.fn(),
    getLibraryLessons: vi.fn(),
    requestLibraryLesson: vi.fn(),
    getLibraryLessonStatus: vi.fn(),
  },
}));
import api, { portal } from "../../services/api";
import { createLessonPlansApi } from "./lessonPlansApi";
import LibraryPicker from "../../components/coaching/LibraryPicker";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const P = portal as any;

const WRITTEN = "nbf_snc_grade_3_maths.c01.s001";
const UNWRITTEN = "nbf_snc_grade_3_maths.c01.s002";

beforeEach(() => {
  vi.clearAllMocks();
  http.get.mockImplementation(async (url: string) => {
    if (url === "/curriculum/grades") return { data: { grades: [{ grade: 3, subject_count: 1 }] } };
    if (url === "/lp612/grades") return { data: { grades: [] } };
    if (url === "/curriculum/lps") return { data: { lessons: [
      { lesson_id: WRITTEN, segment_index: 1, lp_type: "content", topic: "Counting", ready: true, on_request: true },
      { lesson_id: UNWRITTEN, segment_index: 2, lp_type: "content", topic: "Place value", ready: false, on_request: true },
      { lesson_id: "grade_3_islamiat_ch1_seg1", segment_index: 1, lp_type: "content", topic: "ICT lesson" },
    ] } };
    throw new Error(`unexpected GET ${url}`);
  });
});

describe("Lesson Plans: a GB lesson is asked for, like a 6-12 one", () => {
  it("an ICT 1-5 lesson opens from the catalogue; a GB one, written or not, is requested", async () => {
    const lp = createLessonPlansApi();
    await lp.grades();
    const [written, unwritten, ict] = await lp.lessons(3, "maths", "1");

    expect(await lp.open(ict)).toEqual({ state: "ready", source: { lane: "k5", lessonId: "grade_3_islamiat_ch1_seg1", assetKind: "lesson" } });
    expect(http.post).not.toHaveBeenCalled();

    http.post.mockResolvedValueOnce({ data: { success: true, state: "ready", renderId: "gb-render-0" } });
    expect(await lp.open(written)).toEqual({ state: "ready", source: { lane: "g612", renderId: "gb-render-0" } });
    http.post.mockResolvedValueOnce({ data: { success: true, state: "authoring", renderId: "gb-render-1" } });
    expect(await lp.open(unwritten)).toEqual({ state: "preparing", renderId: "gb-render-1" });
    expect(http.post).toHaveBeenLastCalledWith("/lp612/request", { segment_id: UNWRITTEN, lang: "en" });
    expect(lp.answerKey(unwritten)).toBeNull();
    expect(written.lane).toBe("g612");
  });
});

describe("Coaching library picker: an unwritten GB lesson is got ready, then picked like a 6-12 one", () => {
  it("says it is not written yet, writes it on tap, and picks it by segment once ready", async () => {
    P.getRecentLessonPlans.mockResolvedValue({ plans: [] });
    P.getLibraryGrades.mockResolvedValue([{ grade: 3, lane: "k5" }]);
    P.getLibrarySubjects.mockResolvedValue([{ key: "maths", label: "Mathematics" }]);
    P.getLibraryChapters.mockResolvedValue([{ key: "1", label: "Chapter 1" }]);
    P.getLibraryLessons.mockResolvedValue([
      { id: WRITTEN, label: "Counting", sub: null, ready: true, used: false, onRequest: true },
      { id: UNWRITTEN, label: "Place value", sub: null, ready: false, used: false, onRequest: true },
    ]);
    P.requestLibraryLesson.mockResolvedValue({ state: "ready", renderId: "gb-render-2" });
    const onPick = vi.fn();
    render(<LibraryPicker onPick={onPick} backSignal={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "3" }));
    fireEvent.click(await screen.findByText("Mathematics"));
    fireEvent.click(await screen.findByText("Chapter 1"));
    await screen.findByText("Place value");
    expect(screen.getByText("Not written yet. Tap to get it ready (about 3 minutes).")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Place value"));
    expect(P.requestLibraryLesson).toHaveBeenCalledWith(UNWRITTEN);
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ pick: { segmentId: UNWRITTEN, lang: "en" } })));
  });
});
