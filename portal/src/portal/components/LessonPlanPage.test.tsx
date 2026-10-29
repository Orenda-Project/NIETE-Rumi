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
    const mark = { page: 1, top: 0.4, height: 0.02, bands: [] };
    const props = { doc: docOf(makePage()), width: 300, ratio: 1.4, onRatio: vi.fn(), onFailed: vi.fn(), mark };
    const { unmount } = render(<PdfPage {...props} pageNumber={1} />);
    expect(document.querySelector('[data-page="1"] [aria-hidden="true"].absolute')).not.toBeNull();
    unmount();
    render(<PdfPage {...props} pageNumber={2} />);
    expect(document.querySelector('[data-page="2"] [aria-hidden="true"].absolute')).toBeNull();
  });

  // bd-v0toag.78: the whole step is washed on each page it runs over, with a star on the pages after the heading's.
  it("washes the step on every page it runs over, starring the pages after the heading's", () => {
    const mark = { page: 1, top: 0.4, height: 0.02, bands: [{ page: 1, top: 0.4, bottom: 0.955 }, { page: 2, top: 0.025, bottom: 0.3 }] };
    const props = { doc: docOf(makePage()), width: 300, ratio: 1.4, onRatio: vi.fn(), onFailed: vi.fn(), mark };
    const { unmount } = render(<PdfPage {...props} pageNumber={1} />);
    expect(document.querySelectorAll('[data-page="1"] [data-testid="step-band"]')).toHaveLength(1);
    expect(document.querySelector('[data-page="1"] [data-testid="band-star"]')).toBeNull();
    unmount();
    render(<PdfPage {...props} pageNumber={2} />);
    expect(document.querySelectorAll('[data-page="2"] [data-testid="step-band"]')).toHaveLength(1);
    expect(document.querySelector('[data-page="2"] [data-testid="band-star"]')).not.toBeNull();
  });
  // bd-v0toag.129: the canvas is a picture, so a PDF link ("Full details ›" on the v10 card) did nothing.
  // Each web link gets a tappable box over it, opening outside like the viewer's other links.
  it("puts a tappable link over each web link on the page", async () => {
    const page = Object.assign(makePage(), {
      getAnnotations: vi.fn(async () => [
        { subtype: "Link", url: "https://portal.niete.edu.pk/v9h-x/g3_ch5/g3_ch5_English_seg2.v9.html#we-do", rect: [60, 700, 180, 720] },
        { subtype: "Link", url: "javascript:alert(1)", rect: [0, 0, 10, 10] },
        { subtype: "Link", dest: "page2", rect: [0, 0, 10, 10] },
        { subtype: "Text", rect: [0, 0, 10, 10] },
      ]),
    });
    render(<PdfPage doc={docOf(page)} pageNumber={1} width={300} ratio={800 / 600} onRatio={vi.fn()} onFailed={vi.fn()} />);
    const links = await screen.findAllByTestId("lp-link");
    expect(links).toHaveLength(1);
    const a = links[0] as HTMLAnchorElement;
    expect(a.getAttribute("href")).toBe("https://portal.niete.edu.pk/v9h-x/g3_ch5/g3_ch5_English_seg2.v9.html#we-do");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
    // PDF space is bottom-up: x 60-180 of 600, y 700-720 of 800 → left 10%, top 10%, 20% wide, 2.5% high.
    expect(a.style.left).toBe("10%");
    expect(a.style.top).toBe("10%");
    expect(a.style.width).toBe("20%");
    expect(a.style.height).toBe("2.5%");
  });

  it("draws no links when the page has none or pdf.js cannot read them", async () => {
    const page = Object.assign(makePage(), { getAnnotations: vi.fn(async () => { throw new Error("no"); }) });
    render(<PdfPage doc={docOf(page)} pageNumber={1} width={300} ratio={1.4} onRatio={vi.fn()} onFailed={vi.fn()} />);
    await waitFor(() => expect(page.render).toHaveBeenCalled());
    await waitFor(() => expect(page.getAnnotations).toHaveBeenCalled());
    expect(screen.queryAllByTestId("lp-link")).toHaveLength(0);
  });
});
