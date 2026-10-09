import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { FeatureArt, FeatureGlyph, FEATURE_HUE, TEACHER_FEATURES, type TeacherFeature } from "./index";

/**
 * bd-fmf24g.2.1 — the teacher app's feature icons, ported from the v28 canvas (Main.dc.html's sprite:
 * `r-*` = the D2-refined 48px spot illustrations, `g-*` = the 24px menu glyphs; identical to the D2-refined
 * row of IconOptions2.dc.html). Digital Coaching is a PHONE (operator, D2 round).
 */

const FEATURES: TeacherFeature[] = ["lessons", "coaching", "observations", "training", "assessment", "attendance", "classes"];

describe("FeatureArt (the 48px illustrations)", () => {
  it("has all seven features, in Home's order", () => {
    expect(TEACHER_FEATURES).toEqual(FEATURES);
  });

  it.each(FEATURES)("%s: a 48-unit svg, decorative by default", (f) => {
    const { container } = render(<FeatureArt feature={f} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("viewBox", "0 0 48 48");
    expect(svg).toHaveAttribute("width", "48");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("data-feature-art", f);
    // drawn in the app's ink outline
    expect(svg.querySelector("g")).toHaveAttribute("stroke", "#33374a");
    expect(svg.querySelectorAll("path, rect, circle").length).toBeGreaterThan(2);
  });

  it("size scales it; a label makes it an image with a name", () => {
    const { container, getByRole } = render(<FeatureArt feature="training" size={80} label="Training" />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "80");
    expect(getByRole("img", { name: "Training" })).toBeInTheDocument();
  });

  it("Digital Coaching is a phone: the 22×40 body with a 5-unit corner, orange on its light tint", () => {
    const { container } = render(<FeatureArt feature="coaching" />);
    const body = container.querySelector('rect[x="13"][y="4"]')!;
    expect(body).toHaveAttribute("width", "22");
    expect(body).toHaveAttribute("height", "40");
    expect(body).toHaveAttribute("rx", "5");
    expect(body).toHaveAttribute("fill", "#ffedd5");
    expect(container.querySelector('rect[x="16"][y="9"]')).toHaveAttribute("fill", "#c2410c");
  });

  it("each feature's hue is the canvas's (fg on its light bg)", () => {
    expect(FEATURE_HUE).toEqual({
      lessons: { fg: "#2f7a52", bg: "#eaf6ef" },
      coaching: { fg: "#c2410c", bg: "#ffedd5" },
      observations: { fg: "#c8331f", bg: "#fee4e2" },
      training: { fg: "#6e52e0", bg: "#eeeafd" },
      assessment: { fg: "#1d6fd8", bg: "#e3eefc" },
      attendance: { fg: "#33374a", bg: "#e8e9f0" },
      classes: { fg: "#0f766e", bg: "#ccfbf1" },
      schedule: { fg: "#be185d", bg: "#fce7f3" },
      schools: { fg: "#0f766e", bg: "#ccfbf1" },
      reports: { fg: "#4d7c0f", bg: "#ecfccb" },
    });
  });
});

describe("FeatureGlyph (the 24px menu glyphs)", () => {
  it.each([...FEATURES, "home", "more"] as const)("%s: a 24-unit currentColor glyph, decorative by default", (name) => {
    const { container } = render(<FeatureGlyph name={name} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveAttribute("width", "24");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("data-glyph", name);
    expect(svg.innerHTML).toMatch(/currentColor/);
    expect(svg.innerHTML).not.toMatch(/#33374a|#2f7a52|#c2410c/);
  });

  it("knocked-out details take the surface colour from --cut (white by default)", () => {
    const { container } = render(<FeatureGlyph name="coaching" />);
    const cut = Array.from(container.querySelectorAll("path")).filter((p) => (p.getAttribute("style") || "").includes("--cut"));
    expect(cut.length).toBeGreaterThan(0);
    expect(cut[0].getAttribute("style")).toMatch(/var\(--cut, ?#fff\)/);
  });

  it("Digital Coaching's glyph is the phone too (11.5×20 body)", () => {
    const { container } = render(<FeatureGlyph name="coaching" />);
    const body = container.querySelector('rect[x="5"][y="2"]')!;
    expect(body).toHaveAttribute("width", "11.5");
    expect(body).toHaveAttribute("height", "20");
  });

  it("a label makes it an image with a name; size scales it", () => {
    const { container, getByRole } = render(<FeatureGlyph name="home" size={28} label="Home" />);
    expect(getByRole("img", { name: "Home" })).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("height", "28");
  });
});
