import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { PdfPage, RETRY_CANVAS_PIXELS, type PdfDocLike } from "./LessonPlanPage";

/**
 * bd-zrdvmi.29 — ICT Feedback sheet, GB row 3: "Can't show it here". In WhatsApp's browser GB plans were handed to another
 * app about 3x as often as ICT ones (19 Nov, live logs: 21% vs 7.5%). A GB plan is one very tall page, drawn on one big
 * canvas. A page that fails to draw now gets one more try on a lighter canvas before the viewer gives up.
 */

const tallPage = () => ({
  getViewport: ({ scale }: { scale: number }) => ({ width: 390 * scale, height: 5054 * scale }),
  render: vi.fn(),
  cleanup: vi.fn(),
});
const docOf = (page: ReturnType<typeof tallPage>): PdfDocLike => ({
  numPages: 2, getPage: vi.fn(async () => page), destroy: vi.fn(async () => {}),
});
const fails = () => ({ promise: Promise.reject(Object.assign(new Error("x"), { name: "TypeError" })), cancel: vi.fn() });
const works = () => ({ promise: Promise.resolve(), cancel: vi.fn() });
const area = (c: { viewport: { width: number; height: number } }) => Math.floor(c.viewport.width) * Math.floor(c.viewport.height);

beforeAll(() => {
  (HTMLCanvasElement.prototype as unknown as { getContext: () => object }).getContext = () => ({});
  Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
});

describe("PdfPage: a page that fails to draw gets a second, lighter try", () => {
  it("draws again on a smaller canvas, and the viewer is not told it failed", async () => {
    const page = tallPage();
    page.render.mockImplementationOnce(fails).mockImplementation(works);
    const onFailed = vi.fn();
    render(<PdfPage doc={docOf(page)} pageNumber={1} width={360} ratio={13} onRatio={vi.fn()} onFailed={onFailed} />);
    await waitFor(() => expect(page.render).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(onFailed).not.toHaveBeenCalled();
    const [first, second] = page.render.mock.calls.map((c) => c[0] as { viewport: { width: number; height: number } });
    expect(area(second)).toBeLessThanOrEqual(RETRY_CANVAS_PIXELS);
    expect(area(second)).toBeLessThan(area(first));
    // Still at least one canvas pixel per screen pixel across the width: readable, not blurry.
    expect(second.viewport.width).toBeGreaterThanOrEqual(360);
  });

  it("fails upward only when the lighter try fails too", async () => {
    const page = tallPage();
    page.render.mockImplementation(fails);
    const onFailed = vi.fn();
    render(<PdfPage doc={docOf(page)} pageNumber={1} width={360} ratio={13} onRatio={vi.fn()} onFailed={onFailed} />);
    await waitFor(() => expect(onFailed).toHaveBeenCalledTimes(1));
    expect(page.render).toHaveBeenCalledTimes(2);
  });
});
