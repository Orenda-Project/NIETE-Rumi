import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Pill } from "../Pill";

describe("Pill", () => {
  it("is a span by default, never a button, and the green tone carries a navy label", () => {
    const { container } = render(<Pill tone="green">28 Sep to 25 Oct</Pill>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toContain("bg-cp-green");
    expect(el.className).toContain("text-cp-navy");
  });
  it("can be the window element (as p with data-window)", () => {
    const { container } = render(<Pill as="p" data-window="w1">w</Pill>);
    expect(container.querySelector('p[data-window="w1"]')).not.toBeNull();
  });
});
