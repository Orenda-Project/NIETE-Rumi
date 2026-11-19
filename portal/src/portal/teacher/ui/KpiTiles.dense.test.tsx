import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BookOpen, CircleCheck } from "lucide-react";
import { tapProblems } from "../../newui/checks/rules";
import { KpiTiles } from "./KpiTiles";

/**
 * KpiTiles, Home's dense tiles (the "Last 30 days" block): `dense` = min-h 88px, the number 28px/700 with the pill on
 * the same line, the label 16px/600 under it (up to 2 lines, never cut); `icon` a neutral 24px icon at the start;
 * `note` a 13px muted third line; `to` / `onPress` make the tile ONE link/button with the card edge, the › (mirrored),
 * FOCUS and a pressed tint, named "14 Plans opened, up 5". Information tiles (no to/onPress) stay as they are.
 */
const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);
const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("KpiTiles dense", () => {
  it("a tappable tile is one link named number, label and change, with › mirrored, 56px+", () => {
    const { container } = inRouter(<KpiTiles dense items={[{ value: 14, label: "Plans opened", delta: 5, icon: BookOpen, to: "/all" }]} />);
    const link = screen.getByRole("link", { name: "14 Plans opened, up 5" });
    expect(link).toHaveAttribute("href", "/all");
    expect(classes(link)).toEqual(expect.arrayContaining(["min-h-[88px]", "rounded-2xl", "border-[#e5e7eb]"]));
    expect(link.querySelector("svg.rtl\\:rotate-180")).not.toBeNull();
    expect(tapProblems(container)).toEqual([]);
  });

  it("the number 28px/700 and the pill share a line; the label 16px/600, never truncated", () => {
    inRouter(<KpiTiles dense items={[{ value: 3, label: "Taught in class", delta: -2, icon: CircleCheck, to: "/j" }]} />);
    const num = screen.getByText("3");
    expect(classes(num)).toEqual(expect.arrayContaining(["text-[28px]", "font-bold", "tabular-nums"]));
    expect(num.parentElement?.querySelector("[data-delta]")).toHaveTextContent("▼2");
    const label = screen.getByText("Taught in class");
    expect(classes(label)).toEqual(expect.arrayContaining(["text-[16px]", "font-semibold"]));
    expect(classes(label)).not.toContain("truncate");
  });

  it("the icon is neutral and decorative; the note is a muted third line", () => {
    inRouter(<KpiTiles dense items={[{ value: 3, label: "Taught in class", note: "You told us", icon: CircleCheck, to: "/j" }]} />);
    const link = screen.getByRole("link");
    const icons = link.querySelectorAll("svg[aria-hidden='true']");
    expect(icons.length).toBe(2);
    expect(classes(icons[0])).toContain("text-[#6b7280]");
    expect(classes(screen.getByText("You told us"))).toEqual(expect.arrayContaining(["text-[13px]", "text-[#6b7280]"]));
  });

  it("onPress makes it a button; a tap calls it once", () => {
    const onPress = vi.fn();
    inRouter(<KpiTiles dense items={[{ value: "4 · 1", label: "Quizzes · Papers", onPress }]} />);
    fireEvent.click(screen.getByRole("button", { name: "4 · 1 Quizzes · Papers" }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("no delta → no pill; a dense tile with no to/onPress is information (a group, no ›)", () => {
    inRouter(<KpiTiles dense items={[{ value: 0, label: "DC observations" }]} />);
    const group = screen.getByRole("group", { name: "0 DC observations" });
    expect(group.querySelector("[data-delta]")).toBeNull();
    expect(group.querySelector("svg")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("without dense, a plain tile is exactly as before (104px, 32px number, 14px label)", () => {
    render(<KpiTiles items={[{ value: 5, label: "Lesson plans" }]} />);
    expect(classes(screen.getByRole("group", { name: "5 Lesson plans" }))).toContain("min-h-[104px]");
    expect(screen.getByText("5")).toHaveClass("text-[32px]");
  });
});
