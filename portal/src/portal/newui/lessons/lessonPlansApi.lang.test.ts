import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * bd-fmf24g.3 — a grades 6–12 plan she had in Urdu is asked for in Urdu when she opens it again (the
 * teacher v2 Recent and All lesson plans reopen plans by key and language). Browsing still asks in
 * English, as the Curriculum page always has.
 */

vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from "../../services/api";
import { createLessonPlansApi, type LpLesson } from "./lessonPlansApi";

const http = api as unknown as { post: ReturnType<typeof vi.fn> };
const G612: LpLesson = { id: "phy9.c02.p010", kind: "lesson", number: 1, part: null, title: "Speed", pages: null, sent: false, answerKey: false, lane: "g612" };

beforeEach(() => {
  vi.clearAllMocks();
  http.post.mockResolvedValue({ data: { state: "ready", renderId: "R1" } });
});

describe("open — the language a 6–12 plan is asked for in", () => {
  it("browsing: English, as before", async () => {
    await createLessonPlansApi().open(G612);
    expect(http.post).toHaveBeenCalledWith("/lp612/request", { segment_id: "phy9.c02.p010", lang: "en" });
  });

  it("reopening a plan she had in Urdu: Urdu", async () => {
    await createLessonPlansApi().open(G612, "ur");
    expect(http.post).toHaveBeenCalledWith("/lp612/request", { segment_id: "phy9.c02.p010", lang: "ur" });
  });

  it("a language outside the offer falls back to English", async () => {
    await createLessonPlansApi().open(G612, "sw");
    expect(http.post).toHaveBeenCalledWith("/lp612/request", { segment_id: "phy9.c02.p010", lang: "en" });
  });
});
