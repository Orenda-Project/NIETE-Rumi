import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BottomButton } from "../BottomButton";
import { newUiSourceFiles, scanStyle, type StyleRule } from "./source";

/**
 * bd-5rz1v.19 — CHECK 3: the colour rule (DESIGN.md "The colour rule"), plus the two
 * habits every new-UI file must keep — logical spacing (Urdu is RTL) and motion only when
 * the phone allows it.
 *
 *   button   every primary button is the button green with its darker edge; no button
 *            ever wears a feature colour, the logo leaf or the frame indigo as its fill
 *   feature  a feature colour (`nu-f-*`) is drawn ONLY by FeatureIcon.tsx — the heading
 *            tile, Home's tiles and the breadcrumb all go through it
 *   raw      no hex / rgb / hsl in a component; colours come from tokens.ts
 *   physical no ml-/pr-/left-/text-left…: start/end only, so a screen mirrors in Urdu
 *   motion   animate-* and transform/all transitions only under motion-safe:
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);

describe("green is every primary button", () => {
  it("a primary BottomButton is filled button-green and stands on its darker green edge", () => {
    render(<BottomButton>Open</BottomButton>);
    const btn = screen.getByRole("button", { name: "Open" });
    expect(classes(btn)).toEqual(expect.arrayContaining(["bg-nu-button", "shadow-nu-button", "text-white"]));
  });

  it.each(["primary", "outline", "warn", "danger"] as const)("%s never wears a feature colour, the leaf or the frame indigo", (tone) => {
    render(<BottomButton tone={tone}>Go</BottomButton>);
    const cls = screen.getByRole("button", { name: "Go" }).className;
    expect(cls).not.toMatch(/nu-f-/);
    // Its FILL (the base class, not a pressed tint like active:bg-nu-ink-xlight).
    expect(cls).not.toMatch(/(?:^|\s)bg-nu-(?:leaf|ink|ink-2|select)(?=\s|$)/);
  });
});

describe("the new UI's source keeps the colour rule, logical spacing and reduced motion", () => {
  const files = newUiSourceFiles();

  it.each(files.map((f) => [f.rel, f.text]))("%s", (rel, text) => {
    expect(scanStyle(rel as string, text as string)).toEqual([]);
  });

  it("catches what it is for (planted violations)", () => {
    const planted = [
      "const a = 'text-nu-f-training bg-nu-f-tile';",
      "const b = <div className=\"bg-[#2e7d57] ml-2 text-left\" style={{ color: '#333748' }} />;",
      "const c = 'shadow-[0_2px_4px_rgba(0,0,0,0.2)] pr-4 rounded-l-xl left-0 border-r';",
      "const d = 'animate-spin transition md:transition-transform';",
    ].join("\n");
    const rules = new Set<StyleRule>(scanStyle("Planted.tsx", planted).map((p) => p.rule));
    expect([...rules].sort()).toEqual(["feature-colour", "motion", "physical", "raw-colour"]);
    const tokens = scanStyle("Planted.tsx", planted).map((p) => p.text);
    expect(tokens).toEqual(expect.arrayContaining([
      "text-nu-f-training", "bg-nu-f-tile", "bg-[#2e7d57]", "#333748", "ml-2", "text-left",
      "pr-4", "rounded-l-xl", "left-0", "border-r", "animate-spin", "transition", "md:transition-transform",
    ]));
  });

  it("allows what it should: logical spacing, RTL flips, arbitrary variants, motion-safe, theme() colours", () => {
    const fine = [
      "const a = 'ms-2 pe-4 start-0 end-6 inset-x-0 text-start rounded-s-xl border-e rtl:rotate-180 rtl:-scale-x-100';",
      "const b = '[&>*:last-child]:border-b-0 [&>button:last-child]:hidden md:end-6 -me-1';",
      "const c = 'motion-safe:animate-spin motion-safe:transition-transform transition-colors animate-none';",
      "const d = 'bg-[conic-gradient(theme(colors.nu.progress.DEFAULT)_var(--nu-ring),theme(colors.nu.progress.track)_0)]';",
      "// a comment may say #333748 or ml-2; only code counts",
    ].join("\n");
    expect(scanStyle("Fine.tsx", fine)).toEqual([]);
  });

  it("FeatureIcon.tsx is the one file allowed to draw a feature colour", () => {
    expect(scanStyle("FeatureIcon.tsx", "const a = 'text-nu-f-training';")).toEqual([]);
    expect(scanStyle("MetricTile.tsx", "const a = 'text-nu-f-training';")).toHaveLength(1);
  });
});
