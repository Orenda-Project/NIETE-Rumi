import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";

vi.mock("../../services/api", () => ({ language: { get: vi.fn(), set: vi.fn() } }));
import { language } from "../../services/api";
import { Shell } from "../Shell";
import { Band, Eyebrow } from "../Band";
import { AppBar } from "../AppBar";
import { NavBar } from "../NavBar";
import { Rail } from "../Rail";
import { LangToggle } from "../LangToggle";

/** bd-sex15q.42 — the chrome components on their own (the pages' red tests are r6_*.test.tsx). */
beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  vi.mocked(language.get).mockResolvedValue({ language: "en" } as never);
});

const items = [
  { key: "a", to: "/a", label: "A", icon: <svg />, current: true, dataNav: "a" },
  { key: "b", to: "/b", label: "B", icon: <svg />, current: false },
];

describe("coachip-ui chrome", () => {
  it("Shell: the .cp root, 240 px kept clear for the rail on a laptop, the aside as the 320 px column", () => {
    render(<Shell testId="p" header={<div data-testid="h" />} aside={<div data-testid="a" />} trust={<p>t</p>} trustInRail>body</Shell>);
    const p = screen.getByTestId("p");
    expect(p.className).toContain("cp ");
    expect(p.innerHTML).toContain("lg:ps-[240px]");
    expect(p.innerHTML).toContain("lg:grid-cols-[minmax(0,720px)_320px]");
    expect(screen.getByTestId("a").closest("aside")).not.toBeNull();
    expect(screen.getByText("t").parentElement?.className).toContain("lg:hidden");
  });

  it("Band: lattice, lockup, title, the body that becomes the laptop hero card; Eyebrow is small caps", () => {
    render(<Band testId="b" title="This week" date="27 Oct"><Eyebrow>Notice</Eyebrow></Band>);
    const b = screen.getByTestId("b");
    expect(b.querySelector(".cp-lattice")).not.toBeNull();
    expect(b.querySelector(".cp-band__lockup img")?.getAttribute("alt")).toBe("");
    expect(b.querySelector("h1")?.textContent).toBe("This week");
    expect(b.querySelector(".cp-band__body")).not.toBeNull();
    expect(screen.getByText("Notice").className).toContain("cp-eyebrow");
  });

  it("AppBar: the back circle is 44 px and labelled; no back without backTo", () => {
    render(<MemoryRouter><AppBar testId="x" backTo="/up" backLabel="Back to the sector" title="T" sub="window" /><AppBar testId="y" title="U" /></MemoryRouter>);
    const back = screen.getByLabelText("Back to the sector");
    expect(back.getAttribute("href")).toBe("/up");
    expect(back.className).toContain("h-11 w-11");
    expect(screen.getByTestId("y").querySelector("a")).toBeNull();
  });

  it("NavBar and Rail: one item list, the current one marked, data-nav kept", () => {
    render(<MemoryRouter><NavBar testId="n" ariaLabel="Menu" items={items} /><Rail testId="r" ariaLabel="Menu" logoAlt="NIETE logo" items={items} trust="Codes, never names." /></MemoryRouter>);
    for (const id of ["n", "r"]) {
      const links = screen.getByTestId(id).querySelectorAll("a");
      expect(links[0].getAttribute("aria-current")).toBe("page");
      expect(links[1].getAttribute("aria-current")).toBeNull();
      expect(links[0].getAttribute("data-nav")).toBe("a");
    }
    expect(screen.getByTestId("r").querySelector("img")?.getAttribute("alt")).toBe("NIETE logo");
    expect(screen.getByText("Codes, never names.")).toBeTruthy();
  });

  it("LangToggle: EN | اردو, 44 px, LTR, the other language written through language.set", async () => {
    vi.mocked(language.set).mockResolvedValue({ success: true, language: "ur" } as never);
    render(<LangToggle prefix="t" />);
    const ur = screen.getByTestId("t-ur");
    expect(screen.getByTestId("t-en").textContent).toBe("EN");
    expect(ur.textContent).toBe("اردو");
    expect(ur.className).toContain("min-h-[44px]");
    expect(ur.parentElement?.getAttribute("dir")).toBe("ltr");
    await act(async () => { fireEvent.click(screen.getByTestId("t-en")); });
    expect(vi.mocked(language.set)).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(ur); });
    expect(vi.mocked(language.set)).toHaveBeenCalledWith("ur");
  });
});
