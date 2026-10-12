import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoginSkeleton } from "../components/Skeleton";
import { BottomButton } from "../newui";

/** bd-fmf24g.64 — waiting looks like the page it waits for, never a white screen and never a bare spinner. */
describe("the sign-in outline", () => {
  it("is the new frame: the real mark on the indigo band, grey blocks in the card", () => {
    const { container } = render(<LoginSkeleton />);
    const root = container.querySelector('[data-frame="login"]') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute("aria-busy", "true");
    expect(root.querySelector("img")).not.toBeNull();
    expect(root.querySelector(".bg-nu-ink")).not.toBeNull();
    expect(container.querySelectorAll("[data-skeleton]").length).toBeGreaterThan(4);
  });
});

describe("BottomButton busy (the login's waiting state)", () => {
  it("is disabled, shows a spinner that only moves when motion is allowed, and keeps its words", () => {
    render(<BottomButton busy>Logging in</BottomButton>);
    const btn = screen.getByRole("button", { name: "Logging in" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    const spin = btn.querySelector("[data-spinner]") as HTMLElement;
    expect(spin).not.toBeNull();
    expect(spin.className).toContain("motion-safe:animate-spin");
    expect(spin.className).not.toMatch(/(^|\s)animate-spin/);
  });

  it("a normal button has no spinner and is not busy", () => {
    render(<BottomButton>Log in</BottomButton>);
    const btn = screen.getByRole("button", { name: "Log in" });
    expect(btn.querySelector("[data-spinner]")).toBeNull();
    expect(btn).not.toHaveAttribute("aria-busy");
  });
});
