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

  // Unswitched fix (the build contract, §4): in an Urdu greeting the name is a Latin run inside RTL text, and a bare "!"
  // after it took the paragraph's direction and was drawn BEFORE the name ("!Testwala"). The name and its "!" are one
  // isolate now, so the "!" stays right after the name; and the isolate keeps a Latin line height of its own instead
  // of the Nastaliq one (the Urdu band was ~30 px too tall).
  it("Urdu: the name and its '!' are one isolate, the '!' right after the name, with a Latin line height", () => {
    render(<HomeGreeting {...base} title="السلام علیکم، Amina Testwala!" name="Amina Testwala" />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("السلام علیکم، Amina Testwala!");
    expect(h1.textContent?.endsWith("Amina Testwala!")).toBe(true);
    const iso = screen.getByTestId("home-greeting-name");
    expect(iso.tagName).toBe("BDI");
    expect(iso.textContent).toBe("Amina Testwala!");
    expect(iso.className).toMatch(/!leading-\[1\.15\]/);
    expect(iso.hasAttribute("data-latin")).toBe(true);
  });

  // Operator, 31 Oct 2026 ("the urdu Assalamoalikum font is so big"; mockup v10: "i like smaller font"): Nastaliq at the
  // English 32 px draws far taller letters, so the Urdu greeting is 24 px. A Latin name keeps the 22 px it had (0.7em of 32).
  it("Urdu: the greeting is a size down (24 px), and a Latin name stays 22 px, so the greeting stays on one line at 360 px", () => {
    render(<HomeGreeting {...base} title="السلام علیکم، Amina Testwala!" name="Amina Testwala" />);
    const h1 = screen.getByRole("heading", { level: 1 }).className.split(" ");
    expect(h1).toContain("text-[32px]");
    expect(h1).toContain("rtl:text-[24px]");
    const name = screen.getByTestId("home-greeting-name").className.split(" ");
    expect(name).toContain("rtl:text-[22px]");
    expect(name).not.toContain("rtl:text-[0.7em]");
  });

  it("an Urdu-script name is isolated too, without the Latin font", () => {
    render(<HomeGreeting {...base} title="السلام علیکم، عائشہ بی بی!" name="عائشہ بی بی" />);
    const iso = screen.getByTestId("home-greeting-name");
    expect(iso.textContent).toBe("عائشہ بی بی!");
    expect(iso.hasAttribute("data-latin")).toBe(false);
  });

  it("no name, or a title without it: the title as it is, no isolate", () => {
    render(<HomeGreeting {...base} title="Salaam!" name="" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Salaam!");
    expect(screen.queryByTestId("home-greeting-name")).toBeNull();
  });
});
