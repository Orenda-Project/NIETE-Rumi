import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * bd-5rz1v.14 — ONE client for lesson plans, grades 1–12.
 *
 * Two services sit behind it: grades 1–5 are the pre-written catalogue (/curriculum/*), grades
 * 6–12 the segments written on request (/lp612/*). They answer in different dialects — a subject
 * is a subject_key ('math') in one and a display name ('Physics') in the other; a chapter is a
 * number in one and a chapter_key in the other; a lesson is "there" in one and "maybe written" in
 * the other. This adapter turns both into one model, so the screens never ask which grade band
 * they are in. These tests drive it through BOTH lanes, the way the screens do.
 */

vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from "../../services/api";
import { createLessonPlansApi } from "./lessonPlansApi";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

const httpError = (status: number) => Object.assign(new Error(String(status)), { response: { status } });

type Answer = (params?: Record<string, unknown>) => unknown;
let routes: Record<string, Answer>;

beforeEach(() => {
  vi.clearAllMocks();
  routes = {
    "/curriculum/grades": () => ({ grades: [{ grade: 1, subject_count: 3 }, { grade: 4, subject_count: 4 }] }),
    "/lp612/grades": () => ({ grades: [{ grade: 9 }, { grade: 6 }] }),
    "/curriculum/subjects": () => ({ subjects: [
      { subject_key: "general_science", subject: "General Science", rtl: false, lesson_count: 72 },
      { subject_key: "math", subject: "Math", rtl: false, lesson_count: 96 },
    ] }),
    "/lp612/subjects": () => ({ subjects: [{ subject: "Physics", lesson_count: 40 }] }),
    "/curriculum/chapters": () => ({ chapters: [
      { chapter_number: 2, chapter_title: "Plants", pages_label: "p.14-27", lesson_count: 9 },
    ] }),
    "/lp612/chapters": () => ({ chapters: [
      { chapter_key: "c02", chapter_number: 2, chapter_title: "Motion", book_stem: "phy9", lesson_count: 3 },
    ] }),
    "/curriculum/lps": () => ({ lessons: [
      { lesson_id: "g4_sci_ch2_seg1", segment_index: 1, lp_type: "content", day_label: "Day 1", section: "Plants", topic: "Parts of a plant", pages_label: "p.14-15", downloaded: true },
      { lesson_id: "g4_sci_ch2_seg4a", segment_index: 4, lp_type: "content", day_label: "Day 4 · part 1", section: "Plants", topic: "Flowers and seeds", pages_label: "p.21", downloaded: false },
      { lesson_id: "g4_sci_ch2_seg995", segment_index: 995, lp_type: "assessment", day_label: "Worksheet", section: "Assessment", topic: "Chapter 2 Assessment Worksheet", pages_label: "p.26", downloaded: false },
      { lesson_id: "g4_sci_ch2_seg990", segment_index: 990, lp_type: "revision", day_label: "Revision", section: "Chapter Review", topic: "Plants review", pages_label: "p.26-27", downloaded: false },
      { lesson_id: "g4_sci_ch2_seg7", segment_index: 7, lp_type: "content", day_label: null, section: "Plants", topic: null, pages_label: null, downloaded: false },
    ] }),
    "/lp612/lessons": () => ({ lessons: [
      { segment_id: "g9_phy.c02.p010", title: "Speed and velocity", menu_title: "Speed", pages_label: "p.10-12", ready: true },
      { segment_id: "g9_phy.c02.p013", title: "Newton's laws", menu_title: "Newton", pages_label: "p.13", ready: false, sent: true },
    ] }),
    "/lesson-plans/recent": () => ({ plans: [{
      planKey: "k5:L2", kind: "k5", lessonId: "L2", found: true, title: "Roots and stems", grade: 4, subject: "General Science",
      chapterNumber: 2, chapterTitle: "Plants", dayLabel: "Day 2", pagesLabel: "p.16-17",
      lastUsedAt: "2026-10-02T05:00:00Z", lastOpenedAt: null, lastReceivedAt: "2026-10-02T05:00:00Z", open: { lane: "k5", lessonId: "L2" },
    }] }),
  };
  http.get.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
    const answer = routes[url];
    if (!answer) throw new Error(`unexpected GET ${url}`);
    const data = answer(config?.params);
    if (data instanceof Error) throw data;
    return { data };
  });
});

const gets = (url: string) => http.get.mock.calls.filter(([u]) => u === url);

describe("grades — both lanes, one list", () => {
  it("merges grades 1–5 and 6–12 into one list ordered 1..12", async () => {
    const lp = createLessonPlansApi();
    expect(await lp.grades()).toEqual([1, 4, 6, 9]);
  });

  it("one service down still lists the other's grades", async () => {
    routes["/lp612/grades"] = () => httpError(502);
    expect(await createLessonPlansApi().grades()).toEqual([1, 4]);
    routes["/lp612/grades"] = () => ({ grades: [{ grade: 9 }] });
    routes["/curriculum/grades"] = () => httpError(502);
    expect(await createLessonPlansApi().grades()).toEqual([9]);
  });

  it("both down is a failure, not an empty catalogue", async () => {
    routes["/lp612/grades"] = () => httpError(502);
    routes["/curriculum/grades"] = () => httpError(502);
    await expect(createLessonPlansApi().grades()).rejects.toThrow();
  });
});

describe("subjects, chapters, lessons — the lane is read off the grade list", () => {
  it("grade 4 asks the 1–5 catalogue, in its dialect (subject_key, chapter_number)", async () => {
    const lp = createLessonPlansApi();
    expect(await lp.subjects(4)).toEqual([
      { key: "general_science", name: "General Science", lessons: 72 },
      { key: "math", name: "Math", lessons: 96 },
    ]);
    expect(gets("/curriculum/subjects")[0][1]).toEqual({ params: { grade: 4 } });
    expect(gets("/lp612/subjects")).toHaveLength(0);

    expect(await lp.chapters(4, "general_science")).toEqual([
      { key: "2", number: 2, title: "Plants", pages: "p.14-27", lessons: 9 },
    ]);
    expect(gets("/curriculum/chapters")[0][1]).toEqual({ params: { grade: 4, subject: "general_science" } });

    const lessons = await lp.lessons(4, "general_science", "2");
    expect(gets("/curriculum/lps")[0][1]).toEqual({ params: { grade: 4, subject: "general_science", chapter_number: "2" } });
    expect(lessons.map((l) => ({ id: l.id, kind: l.kind, number: l.number, part: l.part, title: l.title, pages: l.pages, sent: l.sent, answerKey: l.answerKey }))).toEqual([
      { id: "g4_sci_ch2_seg1", kind: "day", number: 1, part: null, title: "Parts of a plant", pages: "p.14-15", sent: true, answerKey: true },
      { id: "g4_sci_ch2_seg4a", kind: "day", number: 4, part: 1, title: "Flowers and seeds", pages: "p.21", sent: false, answerKey: true },
      { id: "g4_sci_ch2_seg995", kind: "worksheet", number: null, part: null, title: "Chapter 2 Assessment Worksheet", pages: "p.26", sent: false, answerKey: true },
      { id: "g4_sci_ch2_seg990", kind: "revision", number: null, part: null, title: "Plants review", pages: "p.26-27", sent: false, answerKey: true },
      // No topic, no day: still a row, named by its section.
      { id: "g4_sci_ch2_seg7", kind: "day", number: null, part: null, title: "Plants", pages: null, sent: false, answerKey: true },
    ]);
  });

  it("grade 9 asks the 6–12 service, in its dialect (display name, chapter_key)", async () => {
    const lp = createLessonPlansApi();
    expect(await lp.subjects(9)).toEqual([{ key: "Physics", name: "Physics", lessons: 40 }]);
    expect(gets("/lp612/subjects")[0][1]).toEqual({ params: { grade: 9 } });
    expect(gets("/curriculum/subjects")).toHaveLength(0);

    expect(await lp.chapters(9, "Physics")).toEqual([{ key: "c02", number: 2, title: "Motion", pages: null, lessons: 3 }]);
    expect(gets("/lp612/chapters")[0][1]).toEqual({ params: { grade: 9, subject: "Physics" } });

    const lessons = await lp.lessons(9, "Physics", "c02");
    expect(gets("/lp612/lessons")[0][1]).toEqual({ params: { grade: 9, subject: "Physics", chapter_key: "c02", lang: "en" } });
    expect(lessons.map((l) => ({ id: l.id, kind: l.kind, number: l.number, title: l.title, pages: l.pages, sent: l.sent, answerKey: l.answerKey }))).toEqual([
      { id: "g9_phy.c02.p010", kind: "lesson", number: 1, title: "Speed and velocity", pages: "p.10-12", sent: false, answerKey: false },
      { id: "g9_phy.c02.p013", kind: "lesson", number: 2, title: "Newton's laws", pages: "p.13", sent: true, answerKey: false },
    ]);
  });

  it("asks for the grade list once, however many steps follow", async () => {
    const lp = createLessonPlansApi();
    await lp.subjects(9);
    await lp.chapters(9, "Physics");
    await lp.lessons(9, "Physics", "c02");
    await lp.subjects(4);
    expect(gets("/lp612/grades")).toHaveLength(1);
    expect(gets("/curriculum/grades")).toHaveLength(1);
  });

  it("steps asked at once (a page opened straight from a link) share one grade read", async () => {
    const lp = createLessonPlansApi();
    await Promise.all([lp.subjects(9), lp.chapters(9, "Physics"), lp.lessons(9, "Physics", "c02")]);
    expect(gets("/lp612/grades")).toHaveLength(1);
  });

  it("subjects and chapters are kept for the session; lessons (her Sent ticks) are asked every time", async () => {
    const lp = createLessonPlansApi();
    await lp.subjects(4); await lp.subjects(4);
    await lp.chapters(4, "math"); await lp.chapters(4, "math");
    await lp.lessons(4, "math", "2"); await lp.lessons(4, "math", "2");
    expect(gets("/curriculum/subjects")).toHaveLength(1);
    expect(gets("/curriculum/chapters")).toHaveLength(1);
    expect(gets("/curriculum/lps")).toHaveLength(2);
  });

  it("a failed read is not remembered: asking again asks the service again", async () => {
    const lp = createLessonPlansApi();
    routes["/curriculum/subjects"] = () => httpError(502);
    await expect(lp.subjects(4)).rejects.toThrow();
    routes["/curriculum/subjects"] = () => ({ subjects: [{ subject_key: "math", subject: "Math", lesson_count: 9 }] });
    expect(await lp.subjects(4)).toEqual([{ key: "math", name: "Math", lessons: 9 }]);
  });

  it("a grade neither service offers has nothing in it, and asks neither", async () => {
    const lp = createLessonPlansApi();
    expect(await lp.subjects(3)).toEqual([]);
    expect(gets("/curriculum/subjects")).toHaveLength(0);
    expect(gets("/lp612/subjects")).toHaveLength(0);
  });
});

describe("open — one call, whichever grade", () => {
  it("a grades 1–5 plan is always written: it opens straight away, with nothing asked", async () => {
    const lp = createLessonPlansApi();
    const [day1] = await lp.lessons(4, "general_science", "2");
    expect(await lp.open(day1)).toEqual({ state: "ready", source: { lane: "k5", lessonId: "g4_sci_ch2_seg1", assetKind: "lesson" } });
    expect(http.post).not.toHaveBeenCalled();
    expect(lp.answerKey(day1)).toEqual({ lane: "k5", lessonId: "g4_sci_ch2_seg1", assetKind: "answer_key" });
  });

  it("a written grades 6–12 plan opens; one not written yet is started and comes back preparing", async () => {
    const lp = createLessonPlansApi();
    const [speed, newton] = await lp.lessons(9, "Physics", "c02");
    http.post.mockResolvedValueOnce({ data: { success: true, state: "ready", renderId: "R1" } });
    expect(await lp.open(speed)).toEqual({ state: "ready", source: { lane: "g612", renderId: "R1" } });
    expect(http.post).toHaveBeenLastCalledWith("/lp612/request", { segment_id: "g9_phy.c02.p010", lang: "en" });

    http.post.mockResolvedValueOnce({ data: { success: true, state: "authoring", renderId: "R2" } });
    expect(await lp.open(newton)).toEqual({ state: "preparing", renderId: "R2" });
    expect(lp.answerKey(newton)).toBeNull();
  });

  it("held back or not in the catalogue is an answer (unavailable); anything else is a fault", async () => {
    const lp = createLessonPlansApi();
    const [speed] = await lp.lessons(9, "Physics", "c02");
    http.post.mockRejectedValueOnce(httpError(403));
    expect(await lp.open(speed)).toEqual({ state: "unavailable" });
    http.post.mockRejectedValueOnce(httpError(404));
    expect(await lp.open(speed)).toEqual({ state: "unavailable" });
    http.post.mockRejectedValueOnce(httpError(502));
    await expect(lp.open(speed)).rejects.toThrow();
  });
});

describe("status — the poll while a plan is written", () => {
  it("ready, still preparing, or failed; never marked as an open", async () => {
    const lp = createLessonPlansApi();
    routes["/lp612/status/R2"] = () => ({ success: true, state: "authoring" });
    expect(await lp.status("R2")).toEqual({ state: "preparing" });
    routes["/lp612/status/R2"] = () => ({ success: true, state: "ready", url: "https://r2.example/x.pdf" });
    expect(await lp.status("R2")).toEqual({ state: "ready", source: { lane: "g612", renderId: "R2" } });
    routes["/lp612/status/R2"] = () => ({ success: true, state: "failed" });
    expect(await lp.status("R2")).toEqual({ state: "failed" });
    // The poll is not an open (bd-5rz1v.15): only "open in another app" sends ?open=1.
    for (const [, config] of gets("/lp612/status/R2")) expect(config?.params?.open).toBeUndefined();
  });

  it("no such request (404) has failed; a dropped poll is a fault the caller retries", async () => {
    const lp = createLessonPlansApi();
    routes["/lp612/status/R9"] = () => httpError(404);
    expect(await lp.status("R9")).toEqual({ state: "failed" });
    routes["/lp612/status/R9"] = () => httpError(502);
    await expect(lp.status("R9")).rejects.toThrow();
  });
});

describe("recent — her last lesson plan, for the heading", () => {
  it("asks for one, and says its day and chapter", async () => {
    const lp = createLessonPlansApi();
    expect(await lp.recent()).toEqual({ title: "Roots and stems", day: 2, part: null, chapter: "Plants" });
    expect(gets("/lesson-plans/recent")[0][1]).toEqual({ params: { limit: 1 } });
  });

  it("a 6–12 plan has no day; none at all is null", async () => {
    routes["/lesson-plans/recent"] = () => ({ plans: [{ planKey: "g612:S", kind: "g612", segmentId: "S", found: true, title: "Speed and velocity", chapterTitle: "Motion", dayLabel: null }] });
    expect(await createLessonPlansApi().recent()).toEqual({ title: "Speed and velocity", day: null, part: null, chapter: "Motion" });
    routes["/lesson-plans/recent"] = () => ({ plans: [] });
    expect(await createLessonPlansApi().recent()).toBeNull();
  });
});
