import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * `onReady` — the viewer says once when the plan's pages are there, so the page can draw what belongs after the plan
 * (the survey bar) only for a plan she can read. Not said while loading, nor when the plan failed or is not ready.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../lib/pdfjs", () => ({ loadPdfjs: vi.fn() }));
vi.mock("../lib/lessonPlanOpen", async (orig) => ({
  ...(await orig<typeof import("../lib/lessonPlanOpen")>()),
  fetchLessonPlanPdf: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer),
  openLessonPlanOutside: vi.fn(async () => "opened"),
}));
vi.mock("../lib/lpViewerReport", async (orig) => ({ ...(await orig<typeof import("../lib/lpViewerReport")>()), reportViewerFailure: vi.fn() }));

import { loadPdfjs } from "../lib/pdfjs";
import { fetchLessonPlanPdf } from "../lib/lessonPlanOpen";
import LessonPlanViewer from "./LessonPlanViewer";

const page = {
  getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
  render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
  getTextContent: vi.fn(async () => ({ items: [] })),
  cleanup: vi.fn(),
};
const doc = { numPages: 2, getPage: vi.fn(async () => page), destroy: vi.fn(async () => {}) };
const VIEW = { source: { lane: "k5" as const, lessonId: "g1e8s6", assetKind: "lesson" as const }, title: "Sounds" };

beforeAll(() => {
  (HTMLCanvasElement.prototype as unknown as { getContext: () => object }).getContext = () => ({});
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadPdfjs).mockResolvedValue({ getDocument: () => ({ promise: Promise.resolve(doc) }) } as never);
});

describe("LessonPlanViewer onReady", () => {
  it("is called once the pages are there", async () => {
    const onReady = vi.fn();
    render(<LessonPlanViewer view={VIEW} recording={false} chrome="none" onClose={() => {}} onNotReady={() => {}} onReady={onReady} />);
    await waitFor(() => expect(screen.getAllByTestId("lp-page")).toHaveLength(2));
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("is not called when the plan fails to load", async () => {
    vi.mocked(fetchLessonPlanPdf).mockRejectedValueOnce(new Error("network"));
    const onReady = vi.fn();
    render(<LessonPlanViewer view={VIEW} recording={false} chrome="none" onClose={() => {}} onNotReady={() => {}} onReady={onReady} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(onReady).not.toHaveBeenCalled();
  });
});
