import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Skeleton } from "../Skeleton";

describe("Skeleton", () => {
  it("is busy, has no words or digits, and adds the band only when asked", () => {
    render(<><Skeleton testId="a" /><Skeleton testId="b" band /></>);
    const a = screen.getByTestId("a");
    expect(a.getAttribute("aria-busy")).toBe("true");
    expect(a.textContent).toBe("");
    expect(a.querySelector(".cp-band")).toBeNull();
    expect(screen.getByTestId("b").querySelector(".cp-band")).not.toBeNull();
  });
});
