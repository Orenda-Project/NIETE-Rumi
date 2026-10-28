import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { FractionBar } from "../FractionBar";

describe("FractionBar", () => {
  it("fills n/d of the track in green, decoratively", () => {
    const { container } = render(<FractionBar n={11} d={22} />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.getAttribute("aria-hidden")).toBe("true");
    expect(bar.dataset.bar).toBe("11/22");
    const fill = bar.querySelector("[data-fill]") as HTMLElement;
    expect(fill.style.width).toBe("50%");
    expect(fill.className).toContain("bg-cp-green");
  });
  it("grey tone for the smaller cause; a zero is the track only; never over 100%", () => {
    expect((render(<FractionBar n={1} d={4} tone="grey" />).container.querySelector("[data-fill]") as HTMLElement).className).toContain("bg-cp-ink-3");
    expect(render(<FractionBar n={0} d={9} />).container.querySelector("[data-fill]")).toBeNull();
    expect((render(<FractionBar n={9} d={4} />).container.querySelector("[data-fill]") as HTMLElement).style.width).toBe("100%");
  });
});
