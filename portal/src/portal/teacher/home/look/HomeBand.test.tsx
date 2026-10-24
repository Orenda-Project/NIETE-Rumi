import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("../../../services/api", () => ({ language: { get: vi.fn(), set: vi.fn() } }));
vi.mock("i18next", () => {
  const handlers: Array<() => void> = [];
  const i18n = {
    language: "en",
    on: (_e: string, h: () => void) => { handlers.push(h); },
    off: () => {},
    changeLanguage: vi.fn(async (lng: string) => { i18n.language = lng; handlers.forEach((h) => h()); }),
  };
  return { default: i18n };
});
import i18n from "i18next";
import { language } from "../../../services/api";
import { HomeBand } from "./HomeBand";

/**
 * The look's navy band. Shape A ("two"): the mark, the date and school, the language pill on row 1; the greeting on
 * row 2. Shape B ("one"): the mark, the greeting and the pill on one row, the date and school under it from 344 px
 * up and not at all below. The greeting is never cut; the name keeps its "!" inside its isolate.
 */
const FRI = new Date("2026-10-23T07:00:00Z");
const SHORT = { title: "Salaam, Lp Testwala!", name: "Lp Testwala", now: FRI, school: "IMSG Testwala School" };
const LONG = { title: "Salaam, Muhammad Abdul Rehman Testwala!", name: "Muhammad Abdul Rehman Testwala", now: FRI, school: "IMSG Testwala School" };
const UR = { title: "السلام علیکم، Lp Testwala!", name: "Lp Testwala", now: FRI, school: "IMSG Testwala School" };
const setLang = (code: "en" | "ur") => { (i18n as unknown as { language: string }).language = code; };
const row = (el: Element) => el.closest("[data-band-row]") as HTMLElement;

describe("HomeBand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLang("en");
    vi.mocked(language.get).mockResolvedValue({ language: "en", locked: false });
  });

  it("shape A: row 1 is the mark, the date · school and the pill; row 2 is the greeting", () => {
    render(<HomeBand {...SHORT} vw={360} />);
    const band = screen.getByTestId("home-band");
    expect(band.getAttribute("data-shape")).toBe("two");
    expect(band.className).toMatch(/bg-\[#333748\]/);
    const meta = screen.getByTestId("home-look-meta");
    expect(meta).toHaveTextContent("Fri 23 Oct · IMSG Testwala School");
    const greeting = screen.getByTestId("home-look-greeting");
    expect(greeting.tagName).toBe("H1");
    expect(greeting).toHaveTextContent("Salaam, Lp Testwala!");
    expect(row(meta)).toBe(row(screen.getByTestId("home-look-lang")));
    expect(row(meta)).toBe(row(screen.getByAltText("NIETE logo")));
    expect(row(meta).contains(greeting)).toBe(false);
    expect(meta.compareDocumentPosition(greeting) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shape B under 344 px: one row, and no date or school at all", () => {
    render(<HomeBand {...SHORT} vw={320} />);
    expect(screen.getByTestId("home-band").getAttribute("data-shape")).toBe("one");
    expect(screen.queryByTestId("home-look-meta")).toBeNull();
    const greeting = screen.getByTestId("home-look-greeting");
    expect(row(greeting)).toBe(row(screen.getByTestId("home-look-lang")));
  });

  it("shape B at 360 with a long name: the date and school sit under the greeting", () => {
    render(<HomeBand {...LONG} vw={360} />);
    expect(screen.getByTestId("home-band").getAttribute("data-shape")).toBe("one");
    const greeting = screen.getByTestId("home-look-greeting");
    const meta = screen.getByTestId("home-look-meta");
    expect(greeting.compareDocumentPosition(meta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row(greeting).contains(meta)).toBe(false);
  });

  it("Urdu: the \"!\" stays inside the name's isolate; the date is Urdu, the Latin school keeps its order", () => {
    setLang("ur");
    render(<HomeBand {...UR} vw={360} />);
    const name = screen.getByTestId("home-greeting-name");
    expect(name.textContent).toBe("Lp Testwala!");
    expect(screen.getByTestId("home-look-greeting").textContent?.endsWith("!")).toBe(true);
    const meta = screen.getByTestId("home-look-meta");
    expect(meta).toHaveTextContent("جمعہ 23 اکتوبر، IMSG Testwala School");
    const school = within(meta).getByText("IMSG Testwala School");
    expect(school.tagName).toBe("BDI");
    expect(school.getAttribute("dir")).toBe("ltr");
    expect(school.hasAttribute("data-latin")).toBe(true);
  });

  it("no school: the date alone, no separator (English or Urdu)", () => {
    const { unmount } = render(<HomeBand {...SHORT} school={null} vw={360} />);
    expect(screen.getByTestId("home-look-meta").textContent).toBe("Fri 23 Oct");
    unmount();
    setLang("ur");
    render(<HomeBand {...UR} school={null} vw={360} />);
    expect(screen.getByTestId("home-look-meta").textContent).toBe("جمعہ 23 اکتوبر");
    expect(screen.getByTestId("home-look-meta").textContent).not.toMatch(/[·،]/);
  });

  it("the lattice is drawn exactly once", () => {
    const { container } = render(<HomeBand {...SHORT} vw={360} />);
    expect(container.querySelectorAll("svg[data-niete-lattice]")).toHaveLength(1);
  });

  it("the name moves whole in shape A (no wrap inside it) and wraps at word edges in shape B, never anywhere", () => {
    const { unmount } = render(<HomeBand {...SHORT} vw={360} />);
    const a = screen.getByTestId("home-greeting-name").className;
    expect(a).toMatch(/whitespace-nowrap/);
    expect(a).not.toMatch(/overflow-wrap:anywhere/);
    unmount();
    render(<HomeBand {...LONG} vw={360} />);
    const b = screen.getByTestId("home-greeting-name").className;
    expect(b).not.toMatch(/whitespace-nowrap/);
    expect(b).toMatch(/break-words/);
    expect(b).not.toMatch(/overflow-wrap:anywhere/);
  });

  it("the greeting itself wraps at word edges only: break-words, never anywhere, in both shapes", () => {
    for (const props of [SHORT, LONG]) {
      for (const vw of [320, 360]) {
        const { unmount } = render(<HomeBand {...props} vw={vw} />);
        const h1 = screen.getByTestId("home-look-greeting").className;
        expect(h1).toMatch(/break-words/);
        expect(h1).not.toMatch(/overflow-wrap:anywhere/);
        unmount();
      }
    }
  });

  it("nothing is cut: the greeting is never truncated or given a fixed height", () => {
    for (const vw of [320, 360]) {
      const { unmount } = render(<HomeBand {...LONG} vw={vw} />);
      const greeting = screen.getByTestId("home-look-greeting");
      expect(greeting.className).not.toMatch(/truncate|line-clamp|(^|\s)h-\[/);
      expect(screen.getByTestId("home-band").className).not.toMatch(/(^|\s)h-\[/);
      unmount();
    }
  });
});
