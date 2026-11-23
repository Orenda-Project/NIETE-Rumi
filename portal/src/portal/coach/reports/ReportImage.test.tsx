import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ReportImage } from "./ReportImage";
import { REPORTS } from "./copy";
import { OVERLAY_SELECTOR, resolveBackAction } from "@/lib/back-button.cjs";

const flow = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("../flow/useCoachFlowV2", async (orig) => ({ ...(await orig<object>()), useFlowV6: () => flow.on }));

/**
 * bd-o15qnr.39.2 (queue #204) — the operator 22 Nov ~00:55: "The report to send to teacher is fixed size and I can't
 * open it, so I can't view it. Can I view this PDF in the app itself?" The teacher's report is an image; on the v6/v7
 * switch (useFlowV6) it is a tap target ("Open full screen") that opens a full-screen viewer IN the app: scroll, pinch
 * and double-tap zoom, the + / − buttons, a 56px close, and Android Back closes it (the app's back key sends Escape to
 * an open role=dialog; Chrome and WhatsApp's in-app browser pop a history entry). No download, no new tab.
 * Switch off: the plain image, exactly as before.
 */

const SRC = "https://signed.example/report.png";
const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);
const widthOf = () => (screen.getByTestId("report-viewer-image") as HTMLImageElement).style.width;
const touch = (x: number, y: number) => ({ clientX: x, clientY: y, identifier: x + y });

beforeEach(async () => {
  flow.on = true;
  // A viewer closed (or unmounted) by the test before takes its history entry off with history.back(), which jsdom
  // runs a task later: let it land first, so every test starts on the page's own entry.
  await new Promise((r) => { setTimeout(r, 25); });
});
afterEach(() => { document.body.style.overflow = ""; });

describe("ReportImage — the switch on", () => {
  it("the report is a tap target with an Open full screen affordance; nothing opens until it is tapped", () => {
    render(<ReportImage src={SRC} alt="Ayesha’s report" />);
    const open = screen.getByRole("button", { name: /Open full screen/ });
    expect(open).toContainElement(screen.getByRole("img", { name: "Ayesha’s report" }));
    expect(screen.getByRole("img", { name: "Ayesha’s report" })).toHaveAttribute("src", SRC);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a tap opens the full-screen viewer in the app (no link, no new tab): the image in a zoom area", () => {
    render(<ReportImage src={SRC} alt="Ayesha’s report" />);
    fireEvent.click(screen.getByRole("button", { name: /Open full screen/ }));
    const viewer = screen.getByRole("dialog", { name: "Ayesha’s report" });
    expect(viewer).toHaveAttribute("aria-modal", "true");
    expect(classes(viewer)).toEqual(expect.arrayContaining(["fixed", "inset-0"]));
    const zoom = screen.getByTestId("report-zoom");
    expect(zoom).toContainElement(screen.getByTestId("report-viewer-image"));
    expect(screen.getByTestId("report-viewer-image")).toHaveAttribute("src", SRC);
    expect(classes(zoom)).toContain("overflow-auto");
    expect(zoom.style.touchAction).toBe("pan-x pan-y");
    expect(document.querySelector("a[target=_blank]")).toBeNull();
    expect(document.querySelector("a[download]")).toBeNull();
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("the close is a 56px round button; it closes the viewer and focus goes back to the report", async () => {
    render(<ReportImage src={SRC} alt="Ayesha’s report" />);
    const open = screen.getByRole("button", { name: /Open full screen/ });
    fireEvent.click(open);
    const close = screen.getByRole("button", { name: "Close" });
    expect(classes(close)).toEqual(expect.arrayContaining(["h-14", "w-14", "rounded-full"]));
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(open));
    expect(document.body.style.overflow).toBe("");
  });

  it("Android Back in the app: the viewer is an open dialog to the back-key rule, and its Escape closes it", () => {
    render(<ReportImage src={SRC} alt="Ayesha’s report" />);
    fireEvent.click(screen.getByRole("button", { name: /Open full screen/ }));
    expect(document.querySelector(OVERLAY_SELECTOR)).not.toBeNull();
    expect(resolveBackAction({ path: "/portal/coach/observation/cs-1/send", canGoBack: true, overlayOpen: true })).toBe("close-overlay");
    // BackButtonHandler sends Escape to the focused element, bubbling.
    act(() => {
      (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Back in Chrome / WhatsApp's in-app browser (a history pop) closes the viewer and stays on the page", async () => {
    const before = window.location.href;
    render(<ReportImage src={SRC} alt="Ayesha’s report" />);
    fireEvent.click(screen.getByRole("button", { name: /Open full screen/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => { window.history.back(); });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(window.location.href).toBe(before);
  });

  it("zoom: + and − (56px targets) grow and shrink the report; − is off at the fitted size", () => {
    render(<ReportImage src={SRC} alt="Ayesha’s report" />);
    fireEvent.click(screen.getByRole("button", { name: /Open full screen/ }));
    expect(widthOf()).toBe("100%");
    const zoomOut = screen.getByRole("button", { name: "Zoom out" });
    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    expect(classes(zoomIn)).toEqual(expect.arrayContaining(["h-14", "w-14"]));
    expect(zoomOut).toBeDisabled();
    fireEvent.click(zoomIn);
    expect(parseFloat(widthOf())).toBeGreaterThan(100);
    fireEvent.click(zoomOut);
    expect(widthOf()).toBe("100%");
  });

  it("pinch: two fingers moving apart zoom in; moving together zoom back out (never below the fitted size)", () => {
    render(<ReportImage src={SRC} alt="Ayesha’s report" />);
    fireEvent.click(screen.getByRole("button", { name: /Open full screen/ }));
    const zoom = screen.getByTestId("report-zoom");
    fireEvent.touchStart(zoom, { touches: [touch(100, 300), touch(200, 300)] });
    fireEvent.touchMove(zoom, { touches: [touch(50, 300), touch(250, 300)] });
    expect(parseFloat(widthOf())).toBeCloseTo(200, 0);
    fireEvent.touchMove(zoom, { touches: [touch(140, 300), touch(160, 300)] });
    expect(widthOf()).toBe("100%");
    fireEvent.touchEnd(zoom, { touches: [] });
  });

  it("double-tap zooms in, and again back to the fitted size", () => {
    render(<ReportImage src={SRC} alt="Ayesha’s report" />);
    fireEvent.click(screen.getByRole("button", { name: /Open full screen/ }));
    const zoom = screen.getByTestId("report-zoom");
    fireEvent.doubleClick(zoom, { clientX: 120, clientY: 200 });
    expect(parseFloat(widthOf())).toBeGreaterThan(100);
    fireEvent.doubleClick(zoom, { clientX: 120, clientY: 200 });
    expect(widthOf()).toBe("100%");
  });

  it("a double tap on a phone (two quick taps) zooms too", () => {
    render(<ReportImage src={SRC} alt="Ayesha’s report" />);
    fireEvent.click(screen.getByRole("button", { name: /Open full screen/ }));
    const zoom = screen.getByTestId("report-zoom");
    const tap = () => {
      fireEvent.touchStart(zoom, { touches: [touch(120, 200)] });
      fireEvent.touchEnd(zoom, { touches: [], changedTouches: [touch(120, 200)] });
    };
    tap();
    tap();
    expect(parseFloat(widthOf())).toBeGreaterThan(100);
  });

  it("the words are the reports copy, in Urdu too (machine-drafted, NATIVE-CHECK)", () => {
    expect(REPORTS.en.openFullScreen).toBe("Open full screen");
    expect(REPORTS.en.closeViewer).toBe("Close");
    expect(REPORTS.en.zoomIn).toBe("Zoom in");
    expect(REPORTS.en.zoomOut).toBe("Zoom out");
    for (const k of ["openFullScreen", "closeViewer", "zoomIn", "zoomOut"] as const) {
      expect(REPORTS.ur[k]).toMatch(/[؀-ۿ]/);
    }
  });
});

describe("ReportImage — the switch off (or still being read)", () => {
  it.each([false, null])("useFlowV6 %s: the plain image as before, no tap target, nothing opens", (value) => {
    flow.on = value;
    render(<ReportImage src={SRC} alt="Ayesha’s report" />);
    const img = screen.getByRole("img", { name: "Ayesha’s report" });
    expect(img).toHaveAttribute("src", SRC);
    expect(classes(img)).toEqual(expect.arrayContaining(["w-full", "rounded-xl", "border", "border-[#e5e7eb]", "bg-[#f9fafb]"]));
    expect(screen.queryByRole("button")).toBeNull();
    fireEvent.click(img);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
