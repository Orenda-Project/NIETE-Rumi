import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Row } from "../Row";

describe("Row", () => {
  it("a 44 px hairline row; with `to` a link with a chevron that flips in Urdu", () => {
    render(<MemoryRouter><Row testId="r" title="Phonics check" meta="Starts after 30 hours" to="/p" /><Row testId="s" title="Plain" /></MemoryRouter>);
    const r = screen.getByTestId("r");
    expect(r.getAttribute("href")).toBe("/p");
    expect(r.className).toContain("min-h-[44px]");
    expect(r.className).toContain("first:border-t-0");
    expect(r.querySelector("svg")?.getAttribute("class")).toContain("rtl:rotate-180");
    expect(screen.getByTestId("s").querySelector("svg")).toBeNull();
  });
});
