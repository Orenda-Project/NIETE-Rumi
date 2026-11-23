import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { BookOpen } from "lucide-react";
import { HistoryRow } from "./HistoryRow";

/**
 * HistoryRow lead="glyph" (My journey's steps): the coach's round 48px neutral avatar holding a lucide icon instead of
 * initials — never the grade·subject column. Decorative: the row's title names the step.
 */
beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});
const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);
const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);

describe("HistoryRow lead=glyph", () => {
  it("draws the icon in the round neutral avatar, no initials, no grade column", () => {
    inRouter(<HistoryRow lead="glyph" glyph={BookOpen} title="Opened a lesson plan" extra="G3 · Today" to="/x" />);
    const av = screen.getByTestId("history-avatar");
    expect(classes(av)).toEqual(expect.arrayContaining(["h-12", "w-12", "rounded-full", "bg-[#e8e9f0]"]));
    expect(av.getAttribute("aria-hidden")).toBe("true");
    expect(av.querySelector("svg")).not.toBeNull();
    expect(av.textContent).toBe("");
    expect(screen.queryByTestId("history-lead")).toBeNull();
    expect(screen.getByRole("link")).toHaveTextContent("Opened a lesson plan");
  });
  it("information only with action none: no link", () => {
    inRouter(<HistoryRow lead="glyph" glyph={BookOpen} title="Sent a quiz" action="none" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Sent a quiz")).toBeInTheDocument();
  });
});
