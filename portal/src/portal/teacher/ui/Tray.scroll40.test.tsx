import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tray } from "./Tray";
import { SelectField } from "./SelectField";

/**
 * bd-o15qnr.40.9 (queue #229, the operator 23 Nov ~20:25, a screen recording in WhatsApp's in-app browser: the
 * "Indicator to work on" sheet's list would not scroll by touch, stuck at A1-B4; the finger moved the page behind it) —
 * the sheet's list is its own touch scroller (overflow-y auto, overscroll contained, pan-y, iOS momentum), the sheet is
 * sized to the VISIBLE screen (dvh where the browser has it), the page under it is locked on <html> too and its backdrop
 * takes no pans; only the grab handle drags the sheet (down far enough: it closes).
 */
const open = (onClose = vi.fn()) => {
  render(
    <Tray open title="Indicator to work on" onClose={onClose}>
      {Array.from({ length: 23 }, (_, i) => <p key={i}>row {i}</p>)}
    </Tray>,
  );
  return onClose;
};
const drag = (el: HTMLElement, dy: number) => {
  fireEvent.touchStart(el, { touches: [{ clientX: 50, clientY: 100 }] });
  fireEvent.touchMove(el, { touches: [{ clientX: 50, clientY: 100 + dy }] });
  fireEvent.touchEnd(el, { changedTouches: [{ clientX: 50, clientY: 100 + dy }] });
};

describe("Tray: the list scrolls by touch on a phone", () => {
  it("the content is its own scroller: overflow-y auto, overscroll contained, pan-y, touch momentum", () => {
    open();
    const list = screen.getByTestId("tray-body");
    expect(list.className).toMatch(/overflow-y-auto/);
    expect(list.className).toMatch(/overscroll-contain/);
    expect(list.className).toMatch(/touch-pan-y/);
    expect(list.className).toMatch(/-webkit-overflow-scrolling:touch/);
    expect(list).toHaveTextContent("row 22");
  });

  // The cause on the phone: SelectField's rows sit in an overflow-hidden box, which a flex column may shrink — it clipped
  // the list at B4 and left nothing to scroll. The body's children never shrink, so the body is what scrolls.
  it("the body's children never shrink (a clipped box would leave nothing to scroll)", () => {
    open();
    expect(screen.getByTestId("tray-body").className).toMatch(/\[&>\*\]:shrink-0/);
  });

  it("the sheet is held to the visible screen (dvh where the browser has it); the panel itself does not scroll", () => {
    open();
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toMatch(/supports-\[height:100dvh\]:max-h-\[88dvh\]/);
    expect(dialog.className).toMatch(/overflow-hidden/);
  });

  it("the page under it is locked on <html> as well as <body>; the backdrop takes no pans", () => {
    open();
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(screen.getByTestId("tray-scrim").className).toMatch(/touch-none/);
  });

  it("only the grab handle drags the sheet: far enough down closes it; the list's own swipes never do", () => {
    const onClose = open();
    drag(screen.getByTestId("tray-body"), 200);
    expect(onClose).not.toHaveBeenCalled();
    drag(screen.getByTestId("tray-grab"), 30);
    expect(onClose).not.toHaveBeenCalled();
    drag(screen.getByTestId("tray-grab"), 120);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("SelectField rows: a lead the option gives (no empty square)", () => {
  it("an option's prefix and number fill the row's tile", () => {
    render(<SelectField label="Indicator to work on" title="Indicator to work on" value={null} onChange={() => {}}
      options={[{ value: "A1", label: "A1 · Lesson objective (SLO)", sub: "Whether students are told what they will learn.", prefix: "A", number: "1" }]} />);
    fireEvent.click(screen.getByRole("button", { name: /Indicator to work on/ }));
    const lead = screen.getByTestId("listrow-lead");
    expect(lead).toHaveTextContent("A");
    expect(lead).toHaveTextContent("1");
  });
});
