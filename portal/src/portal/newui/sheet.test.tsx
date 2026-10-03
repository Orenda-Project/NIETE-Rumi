import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { OVERLAY_SELECTOR, resolveBackAction } from "@/lib/back-button.cjs";
import { Sheet } from "./Sheet";

/**
 * bd-5rz1v.19 — the kit's bottom sheet (deep-screens.html `.scrim`, `.sheet`). Android's Back
 * key must close it before it leaves the page: BackButtonHandler looks for an open overlay
 * with OVERLAY_SELECTOR (role=dialog + data-state="open", the convention coaching/BottomSheet
 * already follows) and sends it Escape from the focused element.
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Opener</button>
      <Sheet open={open} title="Date range" onClose={() => { onClose(); setOpen(false); }}>
        <button type="button">Inside</button>
      </Sheet>
    </>
  );
}

describe("Sheet", () => {
  it("is an open overlay the Back handler finds, and Back means close it", () => {
    render(<Sheet open title="Date range" onClose={() => {}}><span>body</span></Sheet>);
    const sheet = screen.getByRole("dialog", { name: "Date range" });
    expect(sheet).toHaveAttribute("data-state", "open");
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(document.querySelector(OVERLAY_SELECTOR)).toBe(sheet);
    expect(resolveBackAction({ path: "/portal/dashboard", canGoBack: true, overlayOpen: true })).toBe("close-overlay");
  });

  it("closes on the Escape the Back handler sends from whatever has focus", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    act(() => {
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(OVERLAY_SELECTOR)).toBeNull();
  });

  it("closes from its 56px close button at the end of the title row", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const close = screen.getByRole("button", { name: "Close" });
    expect(classes(close)).toEqual(expect.arrayContaining(["h-14", "w-14", "min-h-[56px]", "min-w-[56px]"]));
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a tap on the dimmed page, not on a tap inside", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Inside" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("newui-sheet-scrim"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("looks like the mockup: light page colour, 22px top corners, grab handle, 20px/800 title", () => {
    render(<Sheet open title="Date range" onClose={() => {}}><span>body</span></Sheet>);
    const sheet = screen.getByRole("dialog");
    expect(classes(sheet)).toEqual(expect.arrayContaining(["bg-nu-surface", "rounded-t-[22px]", "px-3", "pt-2.5", "gap-2.5"]));
    expect(classes(screen.getByTestId("newui-sheet-scrim"))).toContain("bg-nu-surface-scrim");
    expect(classes(screen.getByTestId("newui-sheet-handle"))).toEqual(expect.arrayContaining(["h-1", "w-10", "bg-nu-surface-handle"]));
    expect(classes(screen.getByRole("heading", { name: "Date range" }))).toEqual(expect.arrayContaining(["text-xl", "font-extrabold"]));
  });

  it("rises from the bottom only when motion is allowed", () => {
    render(<Sheet open title="Date range" onClose={() => {}}><span>body</span></Sheet>);
    const sheet = screen.getByRole("dialog");
    expect(classes(sheet)).toEqual(expect.arrayContaining(["motion-safe:animate-in", "motion-safe:slide-in-from-bottom"]));
    expect(sheet.className).not.toMatch(/(^|\s)animate-in/);
  });

  it("takes focus when it opens and gives it back when it closes", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Opener" });
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(document.activeElement).toBe(opener);
  });

  it("keeps Tab inside while open", () => {
    render(<Harness />);
    const close = screen.getByRole("button", { name: "Close" });
    const inside = screen.getByRole("button", { name: "Inside" });
    inside.focus();
    fireEvent.keyDown(inside, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(inside);
  });

  it("renders nothing when closed", () => {
    render(<Sheet open={false} title="Date range" onClose={() => {}}><span>body</span></Sheet>);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("body")).toBeNull();
  });

  it("its close label comes in through props", () => {
    render(<Sheet open title="Date range" closeLabel="بند کریں" onClose={() => {}}><span>body</span></Sheet>);
    expect(screen.getByRole("button", { name: "بند کریں" })).toBeInTheDocument();
  });
});
