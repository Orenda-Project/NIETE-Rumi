import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StartCard } from "./StartCard";

/** bd-snkn32.39 — the big start card: a link with its title, and the one-line explanation and chip only when given. */
describe("StartCard", () => {
  const hue = { bg: "#eee", fg: "#333" };
  it("links to its page with the title, the explanation and the chip", () => {
    render(<MemoryRouter><StartCard to="/x" glyph={<i />} hue={hue} title="Ready" hint="One line" chip="Grades" /></MemoryRouter>);
    const a = screen.getByRole("link", { name: /Ready/ });
    expect(a.getAttribute("href")).toBe("/x");
    expect(screen.getByText("One line")).toBeTruthy();
    expect(screen.getByText("Grades")).toBeTruthy();
  });
  it("no explanation or chip when none is given", () => {
    render(<MemoryRouter><StartCard to="/y" glyph={<i />} hue={hue} title="Only" /></MemoryRouter>);
    expect(screen.getByRole("link").textContent).toBe("Only");
  });
});
