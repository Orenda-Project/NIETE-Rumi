import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * v10 coaching test (bd-v0toag.8, PR3) — the viewer outlines the heading of the step her thing to try belongs
 * to (`highlight.step`), and a new `highlight.jump` (her tap on the strip) takes her to it. Without a
 * highlight the viewer is exactly today's: nothing is read from the plan's text, nothing is drawn over it.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../lib/pdfjs", () => ({ loadPdfjs: vi.fn() }));
vi.mock("../lib/planSteps", () => ({ locateStep: vi.fn() }));
vi.mock("../lib/lessonPlanOpen", async (orig) => ({
  ...(await orig<typeof import("../lib/lessonPlanOpen")>()),
  fetchLessonPlanPdf: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer),
  openLessonPlanOutside: vi.fn(async () => "opened"),
}));

import { loadPdfjs } from "../lib/pdfjs";
import { locateStep } from "../lib/planSteps";
import LessonPlanViewer from "./LessonPlanViewer";

const page = {
  getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
  render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
  getTextContent: vi.fn(async () => ({ items: [] })),
  cleanup: vi.fn(),
};
const doc = { numPages: 3, getPage: vi.fn(async () => page), destroy: vi.fn(async () => {}) };
const VIEW = { source: { lane: "k5" as const, lessonId: "g1e8s6", assetKind: "lesson" as const }, title: "Sounds" };
const MARK = { page: 2, top: 0.4, height: 0.02 };
let scrollTo: ReturnType<typeof vi.fn>;

beforeAll(() => {
  (HTMLCanvasElement.prototype as unknown as { getContext: () => object }).getContext = () => ({});
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadPdfjs).mockResolvedValue({ getDocument: () => ({ promise: Promise.resolve(doc) }) } as never);
  vi.mocked(locateStep).mockResolvedValue(MARK);
  scrollTo = vi.fn();
  window.scrollTo = scrollTo as never;
});

const viewer = (highlight?: { step: number; jump: number }) => (
  <LessonPlanViewer view={VIEW} recording={false} chrome="none" onClose={() => {}} onNotReady={() => {}} highlight={highlight} />
);
const outline = (n: number) => document.querySelector(`[data-page="${n}"] [aria-hidden="true"].absolute`);

describe("LessonPlanViewer, the step highlight", () => {
  it("each page is marked with its number", async () => {
    render(viewer());
    await waitFor(() => expect(screen.getAllByTestId("lp-page")).toHaveLength(3));
    expect(screen.getAllByTestId("lp-page").map((p) => p.getAttribute("data-page"))).toEqual(["1", "2", "3"]);
  });

  it("no highlight: the plan's text is not read and nothing is drawn over it", async () => {
    render(viewer());
    await waitFor(() => expect(screen.getAllByTestId("lp-page")).toHaveLength(3));
    await new Promise((r) => setTimeout(r, 5));
    expect(locateStep).not.toHaveBeenCalled();
    expect(document.querySelector('[data-page] [aria-hidden="true"].absolute')).toBeNull();
  });

  it("the step's heading is outlined on its page, and the page stays where it is", async () => {
    render(viewer({ step: 3, jump: 0 }));
    await waitFor(() => expect(outline(2)).not.toBeNull());
    expect(locateStep).toHaveBeenCalledWith(doc, 3);
    expect(outline(1)).toBeNull();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("her tap takes her to it", async () => {
    const { rerender } = render(viewer({ step: 3, jump: 0 }));
    await waitFor(() => expect(outline(2)).not.toBeNull());
    rerender(viewer({ step: 3, jump: 1 }));
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("not found: nothing drawn, no move", async () => {
    vi.mocked(locateStep).mockResolvedValue(null);
    const { rerender } = render(viewer({ step: 3, jump: 0 }));
    await waitFor(() => expect(locateStep).toHaveBeenCalled());
    rerender(viewer({ step: 3, jump: 1 }));
    expect(document.querySelector('[data-page] [aria-hidden="true"].absolute')).toBeNull();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
