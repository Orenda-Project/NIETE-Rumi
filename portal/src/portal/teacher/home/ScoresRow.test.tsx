import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "i18next";
import { ScoresRow } from "./ScoresRow";
import type { HomeScores } from "./api";

/** The score chips: drawn only where a score exists, never the one the card already opens. */
const BOTH: HomeScores = {
  coach: { marks: 31, max: 40, at: "2026-10-18T09:00:00Z", id: "s-1" },
  observation: { marks: 29, max: 38, at: "2026-10-12T09:00:00Z", id: "o-1" },
};

describe("ScoresRow", () => {
  beforeEach(async () => {
    if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("both scores: two chips, each to its report", async () => {
    const onGo = vi.fn();
    render(<ScoresRow scores={BOTH} onGo={onGo} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Coach 31/40", "Observation 29/38"]);
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("data-home-chip"))).toEqual(["chip_coach", "chip_obs"]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Coach 31/40" }));
    expect(onGo).toHaveBeenLastCalledWith("chip_coach", "/portal/teacher/coaching/report/s-1");
    await userEvent.setup().click(screen.getByRole("button", { name: "Observation 29/38" }));
    expect(onGo).toHaveBeenLastCalledWith("chip_obs", "/portal/teacher/observations");
  });

  it("no score: no chip, and no row at all", () => {
    render(<ScoresRow scores={{ coach: null, observation: null }} onGo={vi.fn()} />);
    expect(screen.queryByTestId("home-scores")).toBeNull();
  });

  it("a row with no number is no chip (never a stand-in zero)", () => {
    render(<ScoresRow scores={{ coach: { marks: null, max: 40, at: "", id: "s-1" }, observation: { marks: 29, max: null, at: "", id: "o-1" } }} onGo={vi.fn()} />);
    expect(screen.queryByTestId("home-scores")).toBeNull();
  });

  it("omits the chip that repeats the card's rung", () => {
    const { unmount } = render(<ScoresRow scores={BOTH} cardKind="coach_report" onGo={vi.fn()} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Observation 29/38"]);
    unmount();
    render(<ScoresRow scores={BOTH} cardKind="observation" onGo={vi.fn()} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Coach 31/40"]);
  });

  it("Urdu: {marks}/{max} in a <bdi dir=ltr>, dir=rtl on the chip", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    try {
      render(<ScoresRow scores={BOTH} onGo={vi.fn()} />);
      const [coach, obs] = screen.getAllByRole("button");
      expect(coach.textContent).toBe("کوچ 31/40");
      expect(obs.textContent).toBe("مشاہدہ 29/38");
      expect(coach.querySelector("bdi")?.textContent).toBe("31/40");
      expect(obs.querySelector("bdi")?.textContent).toBe("29/38");
      for (const chip of [coach, obs]) expect(chip.querySelector("bdi")?.getAttribute("dir")).toBe("ltr");
      expect(coach.getAttribute("dir")).toBe("rtl");
    } finally { await act(async () => { await i18n.changeLanguage("en"); }); }
  });
});
