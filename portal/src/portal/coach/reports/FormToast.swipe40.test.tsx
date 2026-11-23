import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FormToast } from "./FormV7";

/**
 * bd-o15qnr.40.8 (queue #229, the operator 23 Nov: "it's a TOAST that sticks until it times out … swipe-to-dismiss
 * (swipe sideways or down, plus a tap/close)") — the form's toast goes with a swipe sideways or down, or its close.
 */
const TOAST = { text: "5 items still to check", ms: 4000, n: 1 };
const swipe = (el: HTMLElement, dx: number, dy: number) => {
  fireEvent.touchStart(el, { touches: [{ clientX: 100, clientY: 100 }] });
  fireEvent.touchMove(el, { touches: [{ clientX: 100 + dx, clientY: 100 + dy }] });
  fireEvent.touchEnd(el, { changedTouches: [{ clientX: 100 + dx, clientY: 100 + dy }] });
};

describe("FormToast: swipe or close to dismiss", () => {
  it("a close button dismisses it", () => {
    const done = vi.fn();
    render(<FormToast toast={TOAST} onDone={done} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(done).toHaveBeenCalled();
  });

  it("a swipe sideways (either way) dismisses it", () => {
    const done = vi.fn();
    render(<FormToast toast={TOAST} onDone={done} />);
    swipe(screen.getByTestId("ff-toast"), 90, 5);
    expect(done).toHaveBeenCalledTimes(1);
    swipe(screen.getByTestId("ff-toast"), -90, 0);
    expect(done).toHaveBeenCalledTimes(2);
  });

  it("a swipe down dismisses it; a small move does not", () => {
    const done = vi.fn();
    render(<FormToast toast={TOAST} onDone={done} />);
    swipe(screen.getByTestId("ff-toast"), 10, 10);
    expect(done).not.toHaveBeenCalled();
    swipe(screen.getByTestId("ff-toast"), 0, 60);
    expect(done).toHaveBeenCalledTimes(1);
  });
});
