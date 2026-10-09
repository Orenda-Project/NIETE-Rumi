import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { NieteLattice } from "./NieteLattice";

/**
 * bd-fmf24g.22 — NieteLattice: the brand book's diamond lattice (Patterns, p9) redrawn as line art: thin 45° lines,
 * never filled, one line colour, hidden from assistive tech.
 */
describe("NieteLattice", () => {
  it("is line art only, in one colour, and decorative", () => {
    const { container } = render(<NieteLattice />);
    const svg = container.querySelector("svg[data-niete-lattice]") as SVGElement;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    const path = container.querySelector("pattern path") as SVGPathElement;
    expect(path.getAttribute("fill")).toBe("none");
    expect(path.getAttribute("stroke")).toBe("#47ba7d");
  });

  it("takes the line colour and strength it is given", () => {
    const { container } = render(<NieteLattice line="#333748" strength={0.3} />);
    const path = container.querySelector("pattern path") as SVGPathElement;
    expect(path.getAttribute("stroke")).toBe("#333748");
    expect(path.getAttribute("opacity")).toBe("0.3");
  });

  it("two lattices on one page never share a pattern id", () => {
    const { container } = render(<><NieteLattice /><NieteLattice /></>);
    const ids = Array.from(container.querySelectorAll("pattern")).map((p) => p.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(id).not.toMatch(/[:\s]/); // usable in url(#id)
  });

  it("fades out toward the text side, mirrored in Urdu (logical, not left/right)", () => {
    const { container } = render(<NieteLattice />);
    const cls = (container.firstElementChild as Element).getAttribute("class") || "";
    expect(cls).toMatch(/to_right/);
    expect(cls).toMatch(/rtl:\[mask-image:linear-gradient\(to_left/);
  });
});
