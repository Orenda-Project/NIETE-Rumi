import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PdfPage, PAGE_STYLE, type PdfDocLike } from "./LessonPlanPage";

/** bd-v0toag.60 — the page canvas split out of LessonPlanViewer: draws, reports its ratio, fails upward, carries the outline. */

const makePage = () => ({
  getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
  render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
  getTextContent: vi.fn(async () => ({ items: [] })),
  cleanup: vi.fn(),
});
const docOf = (page: ReturnType<typeof makePage>): PdfDocLike => ({
  numPages: 2, getPage: vi.fn(async () => page), destroy: vi.fn(async () => {}),
});

beforeAll(() => {
  (HTMLCanvasElement.prototype as unknown as { getContext: () => object }).getContext = () => ({});
});

describe("PdfPage", () => {
  it("draws its page and reports the page's height/width ratio", async () => {
    const page = makePage();
    const onRatio = vi.fn();
    render(<PdfPage doc={docOf(page)} pageNumber={1} width={300} ratio={1.4} onRatio={onRatio} onFailed={vi.fn()} />);
    await waitFor(() => expect(page.render).toHaveBeenCalled());
    expect(onRatio).toHaveBeenCalledWith(1, 800 / 600);
    const frame = screen.getByTestId("lp-page");
    expect(frame.getAttribute("data-page")).toBe("1");
    expect(frame.className).toContain(PAGE_STYLE);
    expect(frame.style.height).toBe("420px");
    const canvas = screen.getByRole("img", { name: "Page 1" });
    expect(canvas.getAttribute("dir")).toBe("ltr");
  });

  it("tells its parent when the page cannot be drawn", async () => {
    const page = makePage();
    page.render.mockImplementation(() => ({ promise: Promise.reject(new Error("broken")), cancel: vi.fn() }));
    const onFailed = vi.fn();
    render(<PdfPage doc={docOf(page)} pageNumber={2} width={300} ratio={1.4} onRatio={vi.fn()} onFailed={onFailed} />);
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(2));
  });

  it("draws the step outline only on the marked page", () => {
    const mark = { page: 1, top: 0.4, height: 0.02 };
    const props = { doc: docOf(makePage()), width: 300, ratio: 1.4, onRatio: vi.fn(), onFailed: vi.fn(), mark };
    const { unmount } = render(<PdfPage {...props} pageNumber={1} />);
    expect(document.querySelector('[data-page="1"] [aria-hidden="true"].absolute')).not.toBeNull();
    unmount();
    render(<PdfPage {...props} pageNumber={2} />);
    expect(document.querySelector('[data-page="2"] [aria-hidden="true"].absolute')).toBeNull();
  });
});
