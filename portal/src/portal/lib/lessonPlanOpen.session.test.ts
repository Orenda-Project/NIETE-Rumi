import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../services/api", () => ({ default: { get: vi.fn() } }));
vi.mock("./recordingSession", () => ({ useRecordingSession: () => null }));
import api from "../services/api";
import { fetchLessonPlanPdf, fileKindOfSource, openLessonPlanOutside, planFileKindOf, sourceKey } from "./lessonPlanOpen";
import { lessonPlanOpenOn } from "./lessonPlanSwitch";

/** bd-kijmb8 (queue #318) — the session and local lanes of the lesson plan viewer, and the fail-closed switch. */
const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
beforeEach(() => vi.clearAllMocks());

describe("session lane", () => {
  it("reads the plan through the session's own route", async () => {
    get.mockResolvedValue({ data: new ArrayBuffer(4) });
    await fetchLessonPlanPdf({ lane: "session", sessionId: "cs 1", fileKind: "pdf" });
    expect(get.mock.calls[0][0]).toBe("/coaching-session/cs%201/lesson-plan/file");
  });
  it("404 is 'not ready', not a fault", async () => {
    get.mockRejectedValue({ response: { status: 404 } });
    await expect(fetchLessonPlanPdf({ lane: "session", sessionId: "x", fileKind: "pdf" })).rejects.toMatchObject({ name: "LessonPlanNotReady" });
  });
  it("'Open in another app' asks for the signed link", async () => {
    get.mockResolvedValue({ data: { available: true, url: "https://signed/x" } });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    expect(await openLessonPlanOutside({ lane: "session", sessionId: "x", fileKind: "pdf" })).toBe("opened");
    expect(get.mock.calls[0][1]).toEqual({ params: { link: 1 } });
    expect(open).toHaveBeenCalledWith("https://signed/x", "_blank", "noopener");
  });
  it("keys and kinds", () => {
    expect(sourceKey({ lane: "session", sessionId: "a", fileKind: "image" })).toBe("session:a");
    expect(fileKindOfSource({ lane: "session", sessionId: "a", fileKind: "image" })).toBe("image");
    expect(fileKindOfSource({ lane: "k5", lessonId: "l", assetKind: "lesson" })).toBe("pdf");
  });
});

describe("local lane", () => {
  it("reads the picked file's own bytes, no request", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "plan.pdf", { type: "application/pdf" });
    const bytes = await fetchLessonPlanPdf({ lane: "local", file, fileKind: "pdf" });
    expect(bytes.byteLength).toBe(3);
    expect(get).not.toHaveBeenCalled();
  });
  it("tells a photo, a Word file and a PDF apart", () => {
    expect(planFileKindOf({ name: "a.JPG", type: "" })).toBe("image");
    expect(planFileKindOf({ name: "a", type: "image/png" })).toBe("image");
    expect(planFileKindOf({ name: "a.docx", type: "" })).toBe("word");
    expect(planFileKindOf({ name: "a.pdf", type: "application/pdf" })).toBe("pdf");
  });
});

describe("portal_lesson_plan_open is fail-closed", () => {
  it("only a literal true turns it on", () => {
    expect(lessonPlanOpenOn({ features: { lessonPlanOpen: true } })).toBe(true);
    for (const v of [undefined, null, false, "true", 1, {}]) expect(lessonPlanOpenOn({ features: { lessonPlanOpen: v } })).toBe(false);
    expect(lessonPlanOpenOn(null)).toBe(false);
    expect(lessonPlanOpenOn({})).toBe(false);
  });
});
