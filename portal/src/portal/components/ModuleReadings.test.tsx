import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ModuleReadings from "./ModuleReadings";

/**
 * I-SAPS reading under each module.
 *
 * Operator, 2026-09-23: the list is COLLAPSIBLE. Items the partner has no free
 * copy of are still named, in their own nested list, rather than dead links.
 *
 * bd-klecr.9 (2026-10-08): the list is now I-SAPS's MANDATORY reading — named
 * "Required reading", OPEN by default, and each reading says WHAT to read (the
 * section) and what the teacher will be able to do after it. Nothing is gated.
 */

const READINGS = {
  available: [
    { title: "Changing Education Paradigms", author: "Sir Ken Robinson", type: "TED Talk / video", section: "Watch the talk", rationale: "A systemic critique.", outcome: "Differentiate between divergent and convergent thinking.", description: "A systemic critique.", url: "https://www.ted.com/talks/x" },
    { title: "The New Meaning of Educational Change", author: "Michael Fullan", type: "Book", section: "Chapter 2 (pp. 37–40); Chapter 3 (pp. 58–61)", rationale: "Capacity building.", outcome: "Evaluate the importance of teachers’ capacity building.", description: "Capacity building.", url: "https://example.org/pc.pdf" },
  ],
  unavailable: [
    { title: "Mindset", author: "Carol Dweck", type: "Book", description: "", url: null },
  ],
};

describe("ModuleReadings", () => {
  it("is Required reading, open by default, with the count", () => {
    render(<ModuleReadings readings={READINGS} />);
    const toggle = screen.getByTestId("module-readings-toggle");
    expect(toggle).toHaveTextContent(/Required reading/);
    expect(toggle).not.toHaveTextContent(/Recommended/);
    expect(toggle).toHaveTextContent(/2 readings/);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /Changing Education Paradigms/ })).toBeInTheDocument();
    expect(screen.queryByText(/Optional/)).not.toBeInTheDocument();
  });

  it("each reading says what to read and what she will be able to do", () => {
    render(<ModuleReadings readings={READINGS} />);
    const fullan = screen.getByRole("link", { name: /The New Meaning of Educational Change/ });
    expect(fullan).toHaveTextContent("Read: Chapter 2 (pp. 37–40); Chapter 3 (pp. 58–61)");
    expect(fullan).toHaveTextContent("You will be able to: Evaluate the importance of teachers’ capacity building.");
  });

  it("still collapses on tap", async () => {
    render(<ModuleReadings readings={READINGS} />);
    await userEvent.click(screen.getByTestId("module-readings-toggle"));
    expect(screen.getByTestId("module-readings-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: /Changing Education Paradigms/ })).not.toBeInTheDocument();
  });

  it("every link opens in a new tab", async () => {
    render(<ModuleReadings readings={READINGS} />);
    const link = screen.getByRole("link", { name: /Changing Education Paradigms/ });
    expect(link).toHaveAttribute("href", "https://www.ted.com/talks/x");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel") || "").toMatch(/noopener/);
  });

  it("names the not-yet-online items without linking them", async () => {
    render(<ModuleReadings readings={READINGS} />);
    expect(screen.getByText(/Not yet available online \(1\)/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Mindset/ })).not.toBeInTheDocument();
  });

  it("a module with nothing online still opens to the not-yet-online list", async () => {
    render(<ModuleReadings readings={{ available: [], unavailable: READINGS.unavailable }} />);
    expect(screen.getByTestId("module-readings-toggle")).toHaveTextContent(/1 coming soon/);
    expect(screen.getByText(/No online resources yet/)).toBeInTheDocument();
  });

  it("renders nothing when the course has no reading list", () => {
    const { container } = render(<ModuleReadings readings={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
