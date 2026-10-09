import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiTiles } from "./KpiTiles";

/**
 * bd-fmf24g.2.3 — KpiTiles (COMPONENTS.md §10): compiled numbers for a range. Numbers come only from the page's
 * real data; the kit never makes one up. A missing value is "—".
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);

describe("KpiTiles", () => {
  it("two across for 2 or 4 tiles, three for 3; each a labelled group: number then label", () => {
    const { container, rerender } = render(<KpiTiles items={[{ value: 5, label: "Lesson plans" }, { value: 3, label: "Classes covered" }]} />);
    expect(container.querySelector("[data-kpi-grid]")).toHaveStyle({ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" });
    expect(classes(container.querySelector("[data-kpi-grid]")!)).toContain("[display:grid]");
    const tile = screen.getByRole("group", { name: "5 Lesson plans" });
    expect(classes(tile)).toEqual(expect.arrayContaining(["rounded-2xl", "bg-white", "border-[#e5e7eb]", "min-h-[104px]"]));
    expect(screen.getByText("5")).toHaveClass("text-[32px]", "font-bold", "tabular-nums");
    expect(screen.getByText("Lesson plans")).toHaveClass("text-[14px]", "font-semibold", "text-[#4b5563]");
    rerender(<KpiTiles items={[{ value: 1, label: "A" }, { value: 2, label: "B" }, { value: 3, label: "C" }]} />);
    expect(container.querySelector("[data-kpi-grid]")).toHaveStyle({ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" });
    expect(screen.getByText("1")).toHaveClass("text-[26px]");
  });

  it("thousands get separators; a missing value is —", () => {
    render(<KpiTiles items={[{ value: 1234, label: "Students" }, { value: null, label: "Days active" }, { value: "68%", label: "Score" }]} />);
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("68%")).toBeInTheDocument();
  });

  it("the change: ▲ green when up, ▼ amber when down, Same grey at 0; better=down swaps the colours", () => {
    render(<KpiTiles items={[
      { value: 5, label: "Plans", delta: 3 },
      { value: 2, label: "Sent", delta: -2 },
      { value: 4, label: "Days", delta: 0 },
      { value: 3, label: "Absent", delta: -2, better: "down" },
    ]} />);
    const up = screen.getByRole("group", { name: "5 Plans, up 3" }).querySelector("[data-delta]")!;
    expect(up).toHaveTextContent("▲3");
    expect(classes(up)).toEqual(expect.arrayContaining(["bg-[#eaf6ef]", "text-[#2f7a52]"]));
    const down = screen.getByRole("group", { name: "2 Sent, down 2" }).querySelector("[data-delta]")!;
    expect(down).toHaveTextContent("▼2");
    expect(classes(down)).toEqual(expect.arrayContaining(["bg-[#fef3c7]", "text-[#b45309]"]));
    const same = screen.getByRole("group", { name: "4 Days, same as before" }).querySelector("[data-delta]")!;
    expect(same).toHaveTextContent("Same");
    expect(classes(same)).toContain("bg-[#f3f4f6]");
    expect(classes(screen.getByRole("group", { name: /Absent/ }).querySelector("[data-delta]")!)).toContain("text-[#2f7a52]");
  });

  it("a string change (\"+5%\") reads the same way; a fifth tile is never drawn (1–4)", () => {
    render(<KpiTiles items={[{ value: "68%", label: "Score", delta: "+5%" }, { value: 1, label: "B" }, { value: 2, label: "C" }, { value: 3, label: "D" }, { value: 4, label: "E" }]} />);
    expect(screen.getByRole("group", { name: "68% Score, up 5%" })).toHaveTextContent("▲5%");
    expect(screen.queryByRole("group", { name: "4 E" })).toBeNull();
  });

  it("a sparkline from 2+ points (none from 1); the compare line only when a tile has a change", () => {
    const { container, rerender } = render(<KpiTiles compareLabel="vs 1 – 8 Sep 2026" items={[{ value: 5, label: "Plans", delta: 3, trend: [1, 0, 2, 1] }, { value: 3, label: "Days", trend: [4] }]} />);
    const lines = container.querySelectorAll("svg polyline");
    expect(lines).toHaveLength(1);
    expect(lines[0].getAttribute("points")).toBe("0.0,14.0 33.3,26.0 66.7,2.0 100.0,14.0");
    expect(screen.getByText(/vs 1 – 8 Sep 2026/)).toBeInTheDocument();
    rerender(<KpiTiles compareLabel="vs 1 – 8 Sep 2026" items={[{ value: 5, label: "Plans" }]} />);
    expect(screen.queryByText(/vs 1 – 8 Sep 2026/)).toBeNull();
  });

  it("its words come from props (copy)", () => {
    render(<KpiTiles items={[{ value: 4, label: "دن", delta: 0 }]} copy={{ same: "برابر", sameAsBefore: "پہلے جیسا" }} />);
    expect(screen.getByRole("group", { name: "4 دن, پہلے جیسا" })).toHaveTextContent("برابر");
  });
});
