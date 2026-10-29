import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Button } from "../Button";

describe("Button", () => {
  it("primary: 52 px, green fill, NAVY label (AA 4.8:1, never white on green)", () => {
    render(<Button testId="b">See the move</Button>);
    const b = screen.getByTestId("b");
    expect(b.className).toContain("min-h-[52px]");
    expect(b.className).toContain("bg-cp-green");
    expect(b.className).toContain("text-cp-navy");
    expect(b.className).not.toContain("text-white");
  });
  it("md is the 44 px small button; secondary is a navy outline on white", () => {
    render(<Button testId="b" size="md" variant="secondary">Follow-up</Button>);
    const b = screen.getByTestId("b");
    expect(b.className).toContain("min-h-[44px]");
    expect(b.className).toContain("border-cp-navy");
  });
  it("to → a router link, href → an anchor, otherwise a button that fires onClick", () => {
    const click = vi.fn();
    render(<MemoryRouter><Button testId="l" to="/x">a</Button><Button testId="h" href="#moment">b</Button><Button testId="c" onClick={click}>c</Button></MemoryRouter>);
    expect(screen.getByTestId("l").getAttribute("href")).toBe("/x");
    expect(screen.getByTestId("h").getAttribute("href")).toBe("#moment");
    fireEvent.click(screen.getByTestId("c"));
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("c").getAttribute("type")).toBe("button");
  });
});
