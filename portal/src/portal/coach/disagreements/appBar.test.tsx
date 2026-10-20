import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const toggle = vi.fn();
let target: "ur" | "en" = "ur";
let status: "idle" | "saving" | "failed" = "idle";
vi.mock("../../teacher/useLanguageSwitch", () => ({ useLanguageSwitch: () => ({ target, status, toggle }) }));
import { AppBar } from "./appBar";

/**
 * bd-tbprit.7 — Rifat's navy app bar over the disagreement screens: ← back (when there is somewhere to go back to) and
 * the EN | اردو pill. The pill saves through the one writer (useLanguageSwitch) and only then switches the page;
 * tapping the language she is on writes nothing.
 */
const bar = (props: Partial<Parameters<typeof AppBar>[0]> = {}) =>
  render(<MemoryRouter><AppBar title="Disagreements" {...props} /></MemoryRouter>);

beforeEach(() => { toggle.mockReset(); target = "ur"; status = "idle"; });

describe("AppBar", () => {
  it("names the screen; EN pressed while she reads English", () => {
    bar();
    expect(screen.getByText("Disagreements")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "EN" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "اردو" })).toHaveAttribute("aria-pressed", "false");
  });

  it("tapping اردو switches through the one writer; tapping EN again writes nothing", () => {
    bar();
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(toggle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "اردو" }));
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("on an Urdu page, اردو is pressed", () => {
    target = "en";
    bar();
    expect(screen.getByRole("button", { name: "اردو" })).toHaveAttribute("aria-pressed", "true");
  });

  it("← back only when there is somewhere to go", () => {
    const { unmount } = bar();
    expect(screen.queryByTestId("appbar-back")).toBeNull();
    unmount();
    bar({ backTo: "/portal/coach/disagreements" });
    expect(screen.getByTestId("appbar-back")).toHaveAttribute("href", "/portal/coach/disagreements");
  });

  it("a refused switch says Not saved", () => {
    status = "failed";
    bar();
    expect(screen.getByText("Not saved")).toBeInTheDocument();
  });

  it("the list's head: a mark and a line under the name", () => {
    bar({ title: "NIETE Teaching Assistant", sub: "Coach · ICT Islamabad", mark: "N" });
    expect(screen.getByTestId("appbar-mark")).toHaveTextContent("N");
    expect(screen.getByText("Coach · ICT Islamabad")).toBeInTheDocument();
  });
});
