import { describe, it, expect, vi, beforeEach } from "vitest";

// bd-5rz1v.15 — the server records every lesson plan she opens. For grades 6-12 "open it in
// another app" asks GET /lp612/status/:render_id — the SAME route the page polls while a lesson
// is being written — so this call marks itself as an open (?open=1). A poll must not.

const get = vi.fn();
vi.mock("../services/api", () => ({ default: { get: (...args: unknown[]) => get(...args) } }));
vi.mock("./recordingSession", () => ({ useRecordingSession: () => null }));

import { openLessonPlanOutside } from "./lessonPlanOpen";

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
