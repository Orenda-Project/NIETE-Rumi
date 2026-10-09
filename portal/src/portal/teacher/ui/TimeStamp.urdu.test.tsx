import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import i18n from "i18next";
import { TimeStamp } from "./index";

/**
 * bd-fmf24g.24 — TimeStamp sizes its AM/PM word in a style attribute, which the global Urdu floor (index.css, 13px)
 * cannot reach. English keeps its 72% (11px at 15px); Urdu is never below 13px.
 */
beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
});

async function meridiemSize(lang: "en" | "ur"): Promise<string> {
  await act(async () => { await i18n.changeLanguage(lang); });
  const { container } = render(<TimeStamp time="8:30" size={15} />);
  const word = container.querySelectorAll("span[aria-hidden='true']")[0] as HTMLElement;
  expect(screen.getByRole("img")).toBeInTheDocument();
  return word.style.fontSize;
}

describe("TimeStamp AM/PM size", () => {
  it("English is unchanged (72% of the time, 11px at 15px)", async () => {
    expect(await meridiemSize("en")).toBe("11px");
  });
  it("Urdu is never below 13px", async () => {
    expect(await meridiemSize("ur")).toBe("13px");
  });
});
