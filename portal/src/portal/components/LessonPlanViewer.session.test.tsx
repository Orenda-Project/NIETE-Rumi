import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../lib/pdfjs", () => ({ loadPdfjs: vi.fn() }));
vi.mock("../lib/lessonPlanOpen", async (orig) => ({
  ...(await orig<typeof import("../lib/lessonPlanOpen")>()),
  fetchLessonPlanPdf: vi.fn(async () => new Uint8Array([0xff, 0xd8, 0xff]).buffer),
  openLessonPlanOutside: vi.fn(async () => "opened"),
}));
vi.mock("../lib/lpViewerReport", async (orig) => ({ ...(await orig<typeof import("../lib/lpViewerReport")>()), reportViewerFailure: vi.fn() }));
import { fetchLessonPlanPdf, openLessonPlanOutside } from "../lib/lessonPlanOpen";
import LessonPlanViewer from "./LessonPlanViewer";

/** bd-kijmb8 (queue #318) — a photo plan is drawn as a fitted image with zoom; a Word file says it can't be shown here. */
beforeEach(() => {
  vi.clearAllMocks();
  (URL as any).createObjectURL = vi.fn(() => "blob:plan");
  (URL as any).revokeObjectURL = vi.fn();
});

describe("LessonPlanViewer: a session's plan", () => {
  it("a photo is an image, with zoom, and the recording note while recording", async () => {
    render(<LessonPlanViewer view={{ source: { lane: "session", sessionId: "s", fileKind: "image" }, title: "Plan" }} recording onClose={() => {}} onNotReady={() => {}} />);
    const img = await screen.findByTestId("lesson-plan-image");
    expect(img).toHaveAttribute("src", "blob:plan");
    expect(screen.getByLabelText("Zoom in")).toBeEnabled();
    expect(screen.getByText("Recording continues")).toBeInTheDocument();
  });
  it("a Word file: 'Can't show it here', nothing downloaded", async () => {
    render(<LessonPlanViewer view={{ source: { lane: "session", sessionId: "s", fileKind: "word" }, title: "Plan" }} recording onClose={() => {}} onNotReady={() => {}} />);
    expect(await screen.findByText("Can't show it here")).toBeInTheDocument();
    expect(fetchLessonPlanPdf).not.toHaveBeenCalled();
    // while recording it never hands off to another app by itself
    await waitFor(() => expect(openLessonPlanOutside).not.toHaveBeenCalled());
  });
});
