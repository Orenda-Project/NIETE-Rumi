import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * bd-zrdvmi.21 — ICT Feedback sheet, GB row 3: "Can't show it here", sometimes. The server sent every file with 200, so
 * the reason was in the phone and the viewer threw it away. Now each failure is reported (lib/lpViewerReport): which
 * step — download, loading the reader, reading the file, drawing page 1 — and why, with the file's size and page 1's
 * shape. "Not ready yet" is an answer, not a failure, and is not reported.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../lib/pdfjs", () => ({ loadPdfjs: vi.fn() }));
vi.mock("../lib/lpViewerReport", async (orig) => ({
  ...(await orig<typeof import("../lib/lpViewerReport")>()),
  reportViewerFailure: vi.fn(),
}));
vi.mock("../lib/lessonPlanOpen", async (orig) => ({
  ...(await orig<typeof import("../lib/lessonPlanOpen")>()),
  fetchLessonPlanPdf: vi.fn(),
  openLessonPlanOutside: vi.fn(async () => "opened"),
}));

import { loadPdfjs } from "../lib/pdfjs";
import { reportViewerFailure } from "../lib/lpViewerReport";
import { fetchLessonPlanPdf, LessonPlanNotReady } from "../lib/lessonPlanOpen";
import LessonPlanViewer from "./LessonPlanViewer";

const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;
const page = (renderOk = true) => ({
  getViewport: ({ scale }: { scale: number }) => ({ width: 390 * scale, height: 4469 * scale }),
  render: vi.fn(() => ({ promise: renderOk ? Promise.resolve() : Promise.reject(Object.assign(new Error("x"), { name: "UnknownErrorException" })), cancel: vi.fn() })),
  cleanup: vi.fn(),
});
const docWith = (p: ReturnType<typeof page>) => ({ numPages: 2, getPage: vi.fn(async () => p), destroy: vi.fn(async () => {}) });
const VIEW = { source: { lane: "g612" as const, renderId: "r1" }, title: "Urdu" };
const viewer = () => <LessonPlanViewer view={VIEW} recording={false} chrome="none" onClose={() => {}} onNotReady={() => {}} />;
const reported = () => vi.mocked(reportViewerFailure).mock.calls.map((c) => c[0]);

beforeAll(() => {
  (HTMLCanvasElement.prototype as unknown as { getContext: () => object }).getContext = () => ({});
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchLessonPlanPdf).mockResolvedValue(BYTES);
  vi.mocked(loadPdfjs).mockResolvedValue({ getDocument: () => ({ promise: Promise.resolve(docWith(page())) }) } as never);
});

describe("LessonPlanViewer reports why it could not show a plan", () => {
  it("a download that timed out: stage download, reason timeout, the lane", async () => {
    vi.mocked(fetchLessonPlanPdf).mockRejectedValue(Object.assign(new Error("timeout of 120000ms exceeded"), { code: "ECONNABORTED" }));
    render(viewer());
    await waitFor(() => expect(screen.getByText("Can't show it here")).toBeTruthy());
    expect(reported()).toEqual([expect.objectContaining({ stage: "download", lane: "g612", reason: "timeout", status: null })]);
  });

  it("a server error on the download carries its status", async () => {
    vi.mocked(fetchLessonPlanPdf).mockRejectedValue({ response: { status: 502 } });
    render(viewer());
    await waitFor(() => expect(reported()).toHaveLength(1));
    expect(reported()[0]).toEqual(expect.objectContaining({ stage: "download", reason: "http", status: 502 }));
  });

  it("the reader would not load: stage reader, with the file's size", async () => {
    vi.mocked(loadPdfjs).mockRejectedValue(new Error("Failed to fetch dynamically imported module"));
    render(viewer());
    await waitFor(() => expect(reported()).toHaveLength(1));
    expect(reported()[0]).toEqual(expect.objectContaining({ stage: "reader", sizeBytes: 4 }));
  });

  it("a file the reader cannot read: stage read, the reader's own error name", async () => {
    vi.mocked(loadPdfjs).mockResolvedValue({
      getDocument: () => ({ promise: Promise.reject(Object.assign(new Error("Invalid PDF"), { name: "InvalidPDFException" })) }),
    } as never);
    render(viewer());
    await waitFor(() => expect(reported()).toHaveLength(1));
    expect(reported()[0]).toEqual(expect.objectContaining({ stage: "read", errName: "InvalidPDFException", sizeBytes: 4 }));
  });

  it("page 1 could not be drawn: stage draw, with the page count and page 1's shape", async () => {
    vi.mocked(loadPdfjs).mockResolvedValue({ getDocument: () => ({ promise: Promise.resolve(docWith(page(false))) }) } as never);
    render(viewer());
    await waitFor(() => expect(screen.getByText("Can't show it here")).toBeTruthy());
    await waitFor(() => expect(reported()).toHaveLength(1));
    expect(reported()[0]).toEqual(expect.objectContaining({
      stage: "draw", lane: "g612", errName: "UnknownErrorException", pages: 2, pageWidth: 390, pageHeight: 4469, sizeBytes: 4,
    }));
  });

  it("not ready yet is an answer, not a failure: nothing is reported", async () => {
    vi.mocked(fetchLessonPlanPdf).mockRejectedValue(new LessonPlanNotReady());
    render(viewer());
    await new Promise((r) => setTimeout(r, 20));
    expect(reported()).toEqual([]);
  });

  it("a plan that shows reports nothing", async () => {
    render(viewer());
    await waitFor(() => expect(screen.getAllByTestId("lp-page")).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(reported()).toEqual([]);
  });
});
