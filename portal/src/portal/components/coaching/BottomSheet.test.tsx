import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
// @ts-expect-error - CommonJS module shared with the Jest test suite
import { OVERLAY_SELECTOR } from "@/lib/back-button.cjs";
import BottomSheet from "./BottomSheet";

// bd-5rz1v.8 — the app's Back key closes an open sheet first. BackButtonHandler
// finds overlays by OVERLAY_SELECTOR (role=dialog + data-state="open", the Radix
// convention) and sends them Escape. A sheet without data-state was invisible to
// it: Back left the page with the sheet still up.

describe("BottomSheet and the Back key", () => {
  it("is an open overlay the back handler can find", () => {
    render(<BottomSheet label="Send a lesson" onClose={() => {}}><span>body</span></BottomSheet>);
    const sheet = screen.getByRole("dialog", { name: "Send a lesson" });
    expect(sheet).toHaveAttribute("data-state", "open");
    expect(document.querySelector(OVERLAY_SELECTOR)).toBe(sheet);
  });

  it("closes on the Escape the back handler sends", () => {
    const onClose = vi.fn();
    render(<BottomSheet label="Send a lesson" onClose={onClose}><span>body</span></BottomSheet>);
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(onClose).toHaveBeenCalled();
  });
});
