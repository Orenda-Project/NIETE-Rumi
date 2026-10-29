import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Surface } from "../Surface";

describe("Surface", () => {
  it("the one raised card: radius 20, one shadow; `overlap` rides it over the band", () => {
    render(<><Surface testId="a">a</Surface><Surface testId="b" overlap>b</Surface></>);
    expect(screen.getByTestId("a").className).toContain("rounded-[20px]");
    expect(screen.getByTestId("a").className).toContain("shadow-");
    expect(screen.getByTestId("a").className).not.toContain("cp-overlap");
    expect(screen.getByTestId("b").className).toContain("cp-overlap");
  });
});
