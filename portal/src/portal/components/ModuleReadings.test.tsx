import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ModuleReadings from "./ModuleReadings";

/**
 * I-SAPS recommended reading under each module.
 *
 * Operator, 2026-09-23: the list must be COLLAPSIBLE and start closed — it is
 * optional material and must not push the units and the exam off the screen.
 * Items the partner has no free copy of are still named, in their own nested
 * list, rather than shown as dead links.
 */

const READINGS = {
  available: [
    { title: "Changing Education Paradigms", author: "Sir Ken Robinson", type: "TED Talk / video", description: "A systemic critique.", url: "https://www.ted.com/talks/x" },
    { title: "Professional Capital", author: "Hargreaves and Fullan", type: "Book", description: "", url: "https://example.org/pc.pdf" },
  ],
  unavailable: [
    { title: "Mindset", author: "Carol Dweck", type: "Book", description: "", url: null },
  ],
};

describe("ModuleReadings", () => {
  it("starts collapsed: the heading and count show, the links do not", () => {
    render(<ModuleReadings readings={READINGS} />);
    expect(screen.getByTestId("module-readings-toggle")).toHaveTextContent(/Recommended reading/);
    expect(screen.getByTestId("module-readings-toggle")).toHaveTextContent(/2 available/);
    expect(screen.getByTestId("module-readings-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: /Changing Education Paradigms/ })).not.toBeInTheDocument();
  });

  it("opens on tap and every link opens in a new tab", async () => {
    render(<ModuleReadings readings={READINGS} />);
    await userEvent.click(screen.getByTestId("module-readings-toggle"));
    const link = screen.getByRole("link", { name: /Changing Education Paradigms/ });
    expect(link).toHaveAttribute("href", "https://www.ted.com/talks/x");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel") || "").toMatch(/noopener/);
  });

  it("names the not-yet-online items without linking them", async () => {
    render(<ModuleReadings readings={READINGS} />);
    await userEvent.click(screen.getByTestId("module-readings-toggle"));
    expect(screen.getByText(/Not yet available online \(1\)/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Mindset/ })).not.toBeInTheDocument();
  });

  it("a module with nothing online still opens to the not-yet-online list", async () => {
    render(<ModuleReadings readings={{ available: [], unavailable: READINGS.unavailable }} />);
    expect(screen.getByTestId("module-readings-toggle")).toHaveTextContent(/1 coming soon/);
    await userEvent.click(screen.getByTestId("module-readings-toggle"));
    expect(screen.getByText(/No online resources yet/)).toBeInTheDocument();
  });

  it("renders nothing when the course has no reading list", () => {
    const { container } = render(<ModuleReadings readings={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
