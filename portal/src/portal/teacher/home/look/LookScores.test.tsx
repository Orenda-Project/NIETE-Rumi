import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "i18next";
import { LookScores } from "./LookScores";
import { ScoresRow } from "../ScoresRow";
import type { HomeCardKind, HomeScores } from "../api";

/** The "Your progress" strip: ScoresRow's chips, its taps, in the look's shape (no ring, 44 px, the label only beside one chip). */
const BOTH: HomeScores = {
  coach: { marks: 31, max: 40, at: "2026-10-18T09:00:00Z", id: "s-1" },
  observation: { marks: 29, max: 38, at: "2026-10-12T09:00:00Z", id: "o-1" },
};

const chips = () => within(screen.getByTestId("home-scores")).getAllByRole("button");

describe("LookScores", () => {
  beforeEach(async () => {
    if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("one chip: the label and the chip share the row", () => {
    render(<LookScores scores={BOTH} cardKind="observation" onGo={vi.fn()} />);
    const strip = screen.getByTestId("home-scores");
    expect(strip.tagName).toBe("SECTION");
    expect(strip.getAttribute("aria-label")).toBe("Your progress");
    const label = screen.getByTestId("home-look-progress");
    expect(label.textContent).toBe("Your progress");
    expect(label.className).toContain("text-[12.5px]");
    expect(label.className).toContain("text-[#636878]");
    expect(label.querySelector("svg.lucide-award")).not.toBeNull();
    expect(chips().map((b) => b.textContent)).toEqual(["Coach 31/40"]);
    const chip = screen.getByTestId("home-score-chip_coach");
    expect(chip.getAttribute("data-home-chip")).toBe("chip_coach");
    expect(chip.className).toContain("min-h-[44px]");
    expect(chip.className).toContain("bg-[#e6e9f3]");
    expect(chip.className).toContain("text-[#333748]");
    expect(chip.querySelector("svg.lucide-audio-lines")).not.toBeNull();
    expect(chip.querySelector("svg.lucide-chevron-right")?.getAttribute("class")).toContain("rtl:rotate-180");
  });

  it("two chips: no label, both whole, each 44 px and half the row", () => {
    render(<LookScores scores={BOTH} onGo={vi.fn()} />);
    expect(screen.queryByTestId("home-look-progress")).toBeNull();
    expect(screen.getByTestId("home-scores").getAttribute("aria-label")).toBe("Your progress");
    expect(chips().map((b) => b.textContent)).toEqual(["Coach 31/40", "Observation 29/38"]);
    for (const chip of chips()) {
      expect(chip.className).toContain("min-h-[44px]");
      expect(chip.className).toContain("flex-1");
      expect(chip.className).toContain("basis-[calc(50%-3px)]");
      expect(chip.className).not.toMatch(/truncate|line-clamp/);
      expect(chip.querySelector("svg.lucide-chevron-right")?.getAttribute("class")).toContain("ms-auto");
    }
    expect(screen.getByTestId("home-score-chip_obs").querySelector("svg.lucide-eye")).not.toBeNull();
  });

  it("no score: nothing drawn", () => {
    render(<LookScores scores={{ coach: null, observation: null }} onGo={vi.fn()} />);
    expect(screen.queryByTestId("home-scores")).toBeNull();
  });

  it("the chip set and every tap equal ScoresRow's for the same input", async () => {
    const cases: [HomeScores, HomeCardKind | null][] = [
      [BOTH, null], [BOTH, "coach_report"], [BOTH, "observation"],
      [{ coach: { marks: null, max: 40, at: "", id: "s-1" }, observation: { marks: 29, max: 38, at: "", id: "o-1" } }, null],
    ];
    const user = userEvent.setup();
    for (const [scores, cardKind] of cases) {
      const a = vi.fn();
      const b = vi.fn();
      const old = render(<ScoresRow scores={scores} cardKind={cardKind} onGo={a} />);
      for (const btn of within(old.container).getAllByRole("button")) await user.click(btn);
      old.unmount();
      const look = render(<LookScores scores={scores} cardKind={cardKind} onGo={b} />);
      for (const btn of within(look.container).getAllByRole("button")) await user.click(btn);
      look.unmount();
      expect(b.mock.calls.length).toBeGreaterThan(0);
      expect(b.mock.calls).toEqual(a.mock.calls);
    }
  });

  it("no ring anywhere in the strip (the kit's keyboard-focus ring is the only one)", () => {
    const { container } = render(<LookScores scores={BOTH} onGo={vi.fn()} />);
    for (const el of container.querySelectorAll("*")) {
      const tokens = (el.getAttribute("class") ?? "").split(/\s+/).filter((t) => !t.startsWith("focus-visible:"));
      expect(tokens.filter((t) => t.includes("ring"))).toEqual([]);
    }
  });

  it("className lands on the strip itself", () => {
    render(<LookScores scores={BOTH} onGo={vi.fn()} className="first:-mt-5" />);
    expect(screen.getByTestId("home-scores").className).toContain("first:-mt-5");
  });

  it("Urdu: the label in Urdu at 13 px, {marks}/{max} in a <bdi dir=ltr>, the strip rtl", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    try {
      const { unmount } = render(<LookScores scores={BOTH} cardKind="coach_report" onGo={vi.fn()} />);
      const label = screen.getByTestId("home-look-progress");
      expect(label.textContent).toBe("آپ کی پیش رفت");
      expect(label.className).toContain("text-[13px]");
      expect(screen.getByTestId("home-scores").getAttribute("aria-label")).toBe("آپ کی پیش رفت");
      expect(screen.getByTestId("home-scores").getAttribute("dir")).toBe("rtl");
      unmount();
      render(<LookScores scores={BOTH} onGo={vi.fn()} />);
      const [coach, obs] = chips();
      expect(coach.textContent).toBe("کوچ 31/40");
      expect(obs.textContent).toBe("مشاہدہ 29/38");
      for (const chip of [coach, obs]) expect(chip.querySelector("bdi")?.getAttribute("dir")).toBe("ltr");
      expect(coach.querySelector("bdi")?.textContent).toBe("31/40");
    } finally { await act(async () => { await i18n.changeLanguage("en"); }); }
  });
});
