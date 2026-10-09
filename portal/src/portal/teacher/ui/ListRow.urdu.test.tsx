import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { ListRow } from "./index";

/**
 * bd-fmf24g.25 — in Urdu the lead's "پلان #" over the number spilled out of the fixed 52px box (the global Urdu
 * line-height 2 made the two lines about 66px). jsdom cannot lay text out, so this guards the RULES; the
 * measurement is `node scripts/urdu-fit/run.mjs` (its OVERFLOW COUNT). English keeps its exact classes.
 */
beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
});

async function lead(lang: "en" | "ur", prefix: string) {
  await act(async () => { await i18n.changeLanguage(lang); });
  render(<MemoryRouter><ListRow label="x" prefix={prefix} number={12} to="/x" /></MemoryRouter>);
  return screen.getByTestId("listrow-lead");
}

describe("ListRow lead (stacked prefix over number)", () => {
  it("English is unchanged: a fixed 52px box, leading-none, no inline line-height", async () => {
    const el = await lead("en", "LP #");
    expect(el.className).toContain("h-[52px]");
    expect(el.className).toContain("w-[52px]");
    expect(el.className).toContain("leading-none");
    for (const s of Array.from(el.querySelectorAll("span"))) expect(s.getAttribute("style")).toBeNull();
  });

  it("Urdu does not use a fixed 52px height: the box can grow with its Nastaliq lines", async () => {
    const el = await lead("ur", "پلان #");
    expect(el.className).not.toContain("h-[52px]");
    expect(el.className).toMatch(/min-h-\[\d+px\]/);
  });

  it("Urdu sets an explicit line-height on the prefix and the number (the global rule of 2 is too tall for a stack)", async () => {
    const el = await lead("ur", "باب");
    const [prefix, num] = Array.from(el.querySelectorAll("span")) as HTMLElement[];
    expect(parseFloat(prefix.style.lineHeight)).toBeGreaterThan(0);
    expect(parseFloat(prefix.style.lineHeight)).toBeLessThan(2);
    expect(parseFloat(num.style.lineHeight)).toBeGreaterThan(0);
    expect(parseFloat(num.style.lineHeight)).toBeLessThan(2);
  });
});
