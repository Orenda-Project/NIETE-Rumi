import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dots } from "../Dots";

describe("Dots", () => {
  it("three 14 px dots by state, decorative", () => {
    render(<Dots states={["done", "partial", "none"]} />);
    const d = screen.getByTestId("cp-dots");
    expect(d.getAttribute("aria-hidden")).toBe("true");
    expect(Array.from(d.querySelectorAll("i")).map((i) => i.getAttribute("data-state"))).toEqual(["done", "partial", "none"]);
    expect(d.querySelector('[data-state="done"]')?.className).toContain("bg-cp-green");
    expect(d.querySelector('[data-state="none"]')?.className).toContain("border-cp-track");
  });
});
