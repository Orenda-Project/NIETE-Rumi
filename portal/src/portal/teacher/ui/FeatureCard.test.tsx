import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeatureCard, MeterRow } from "./FeatureCard";
import { TrendChart } from "./TrendChart";

describe("FeatureCard / MeterRow (bd-fmf24g.27)", () => {
  it("the header wears the feature: tint, art on white, title in its colour, count chip", () => {
    const { container } = render(<FeatureCard feature="attendance" title="Attendance" count={2}><p>body</p></FeatureCard>);
    const card = container.querySelector("[data-feature-card='attendance']")!;
    expect(card.querySelector("svg[data-feature-art='attendance']")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Attendance" })).toHaveStyle({ color: "#33374a" });
    expect(card.firstElementChild).toHaveStyle({ background: "#e8e9f0" });
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
    expect(container.querySelector("a,button")).toBeNull();
  });
  it("a meter bar takes the feature's colour, clamped to 0–100", () => {
    const { container } = render(<><MeterRow feature="observations" label="Engagement" value="64%" pct={64} /><MeterRow feature="observations" label="X" pct={140} /></>);
    const bars = container.querySelectorAll("i");
    expect(bars[0]).toHaveStyle({ width: "64%", background: "#c8331f" });
    expect(bars[1]).toHaveStyle({ width: "100%" });
  });
  it("TrendChart draws in the colour it is given", () => {
    const { container } = render(<TrendChart points={[{ date: "2026-09-01", row: 1 }, { date: "2026-09-02", row: 0 }]} rows={[{ key: "a", label: "A" }, { key: "b", label: "B" }]} label="t" dateLabel={(d) => d} colour="#c8331f" />);
    expect(container.querySelector("polyline")).toHaveAttribute("stroke", "#c8331f");
    expect(container.querySelector("circle")).toHaveAttribute("stroke", "#c8331f");
  });
});
