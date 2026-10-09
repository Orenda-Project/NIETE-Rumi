import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HomeGreeting } from "./HomeGreeting";

/**
 * bd-fmf24g.22 — HomeGreeting, the top of Home (canvas v28 `HomeGreeting`, variant brand = option C, chosen 9 Oct):
 * a brand-navy band with the NIETE mark and name, a faint lattice, her whole name with "!", today's date and her
 * school as PLAIN text (the two white pills it replaces looked tappable). Words come in by props.
 */
const base = { title: "Salaam, Ayesha Bibi!", date: "Thursday 8 October", school: "IMSG I-10/1", brand: "NIETE", logoAlt: "NIETE logo" };
const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);

describe("HomeGreeting", () => {
  it("is the page's one h1: her whole name with an exclamation mark", () => {
    render(<HomeGreeting {...base} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Salaam, Ayesha Bibi!");
  });

  it("wears the brand: the mark with its alt, the name NIETE, on the brand navy-slate", () => {
    const { container } = render(<HomeGreeting {...base} />);
    expect(screen.getByAltText("NIETE logo")).toBeTruthy();
    expect(screen.getByText("NIETE")).toBeTruthy();
    expect(classes(container.firstElementChild as Element)).toContain("bg-[#333748]");
  });

  it("shows the date and the school as plain text, never as a pill or a control", () => {
    const { container } = render(<HomeGreeting {...base} />);
    expect(screen.getByTestId("home-date")).toHaveTextContent("Thursday 8 October");
    expect(screen.getByTestId("home-school")).toHaveTextContent("IMSG I-10/1");
    expect(container.querySelector("a, button, [role=button]")).toBeNull();
    for (const el of [screen.getByTestId("home-date"), screen.getByTestId("home-school")]) {
      expect(el.className).not.toMatch(/rounded-full|border|bg-white/);
      expect(el.className).toMatch(/text-\[17px\]/); // 16px or more
    }
  });

  it("no school: only the date row", () => {
    render(<HomeGreeting {...base} school={null} />);
    expect(screen.queryByTestId("home-school")).toBeNull();
    expect(screen.getByTestId("home-date")).toBeTruthy();
  });

  it("the lattice is decoration: hidden from a screen reader, behind the words", () => {
    const { container } = render(<HomeGreeting {...base} />);
    const lattice = container.querySelector("svg[data-niete-lattice]");
    expect(lattice).not.toBeNull();
    expect(lattice?.getAttribute("aria-hidden")).toBe("true");
  });

  it("a long name and a long school wrap instead of clipping", () => {
    render(<HomeGreeting {...base} title="Salaam, Syeda Ayesha Bibi Khan Niazi!" school="Islamabad Model School for Girls I-10/1" />);
    expect(screen.getByRole("heading", { level: 1 }).className).toMatch(/\[overflow-wrap:anywhere\]/);
    expect(screen.getByTestId("home-school").className).toMatch(/\[overflow-wrap:anywhere\]|break-words/);
  });

  it("mirrors for Urdu: start/end spacing only, no left/right classes", () => {
    const { container } = render(<HomeGreeting {...base} />);
    const all = [container, ...Array.from(container.querySelectorAll("*"))].flatMap((e) => classes(e as Element));
    expect(all.filter((c) => /^(-?(m|p)[lr]-|left-|right-|text-(left|right)$)/.test(c))).toEqual([]);
  });
});
