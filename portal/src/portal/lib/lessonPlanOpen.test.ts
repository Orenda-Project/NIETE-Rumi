import { describe, it, expect, vi, beforeEach } from "vitest";

// bd-5rz1v.15 — the server records every lesson plan she opens. For grades 6-12 "open it in
// another app" asks GET /lp612/status/:render_id — the SAME route the page polls while a lesson
// is being written — so this call marks itself as an open (?open=1). A poll must not.

const get = vi.fn();
vi.mock("../services/api", () => ({ default: { get: (...args: unknown[]) => get(...args) } }));
vi.mock("./recordingSession", () => ({ useRecordingSession: () => null }));

import { fetchLessonPlanPdf, lessonPlanFileUrl, LessonPlanNotReady, openLessonPlanOutside, sourceKey } from "./lessonPlanOpen";

beforeEach(() => {
  get.mockReset();
  vi.stubGlobal("open", vi.fn());
});

describe("openLessonPlanOutside", () => {
  it("grades 6-12: asks for the link marked as an open", async () => {
    get.mockResolvedValue({ data: { state: "ready", url: "https://r2/x.pdf" } });
    expect(await openLessonPlanOutside({ lane: "g612", renderId: "R1" })).toBe("opened");
    expect(get).toHaveBeenCalledWith("/lp612/status/R1", { params: { open: 1 } });
  });

  it("grades 1-5: /pdf mints a link only to open it, so it needs no mark", async () => {
    get.mockResolvedValue({ data: { available: true, url: "https://r2/y.pdf" } });
    expect(await openLessonPlanOutside({ lane: "k5", lessonId: "grade_4_english_ch1_seg2", assetKind: "lesson" })).toBe("opened");
    expect(get).toHaveBeenCalledWith("/curriculum/lp/grade_4_english_ch1_seg2/pdf", { params: { kind: "lesson" } });
  });
});

// bd-7tgiyc — an assessment paper opens in the same viewer: its bytes through the portal's own /file route, its link
// for "open in another app" from /download (the same lookup), never a lesson plan route.
describe("a paper in the lesson plan viewer", () => {
  const paper = { lane: "paper", paperId: "p-9", artifact: "paper" } as const;
  const key = { lane: "paper", paperId: "p-9", artifact: "answer_key" } as const;

  it("reads the PDF from the paper's own file route, for the paper or its answer key", async () => {
    get.mockResolvedValue({ data: new ArrayBuffer(4) });
    await fetchLessonPlanPdf(paper);
    expect(get).toHaveBeenCalledWith("/assessment/paper/p-9/file", expect.objectContaining({ params: { artifact: "paper" }, responseType: "arraybuffer" }));
    await fetchLessonPlanPdf(key);
    expect(get).toHaveBeenLastCalledWith("/assessment/paper/p-9/file", expect.objectContaining({ params: { artifact: "answer_key" } }));
  });

  it("nothing there yet (not hers, not made, no key) is not ready, not a fault", async () => {
    get.mockRejectedValue({ response: { status: 404 } });
    await expect(fetchLessonPlanPdf(key)).rejects.toBeInstanceOf(LessonPlanNotReady);
  });

  it("the link for another app comes from /download", async () => {
    get.mockResolvedValue({ data: { success: true, available: true, url: "https://r2/paper.pdf" } });
    expect(await lessonPlanFileUrl(paper)).toBe("https://r2/paper.pdf");
    expect(get).toHaveBeenCalledWith("/assessment/paper/p-9/download", { params: { artifact: "paper" } });
    get.mockResolvedValue({ data: { success: true, available: false } });
    expect(await lessonPlanFileUrl(key)).toBeNull();
    expect(await openLessonPlanOutside(key)).toBe("not_ready");
  });

  it("the paper and its answer key are two different documents to the viewer", () => {
    expect(sourceKey(paper)).not.toBe(sourceKey(key));
    expect(sourceKey(paper)).not.toBe(sourceKey({ lane: "g612", renderId: "p-9" }));
  });
});
