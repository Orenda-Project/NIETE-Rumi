import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Section } from "../Section";

describe("Section", () => {
  it("a small-caps label, a hint and a hairline above (not on the first section)", () => {
    render(<><Section testId="a" first label="Open steps" hint="What you set">x</Section><Section testId="b" label="Needs me" tone="green">y</Section></>);
    expect(screen.getByTestId("a").className).not.toContain("border-t");
    expect(screen.getByTestId("b").className).toContain("border-cp-hairline");
    expect(screen.getByText("Open steps").className).toContain("cp-label");
    expect(screen.getByText("Needs me").className).toContain("text-cp-green-ink");
    expect(screen.getByText("What you set")).toBeTruthy();
  });
});
