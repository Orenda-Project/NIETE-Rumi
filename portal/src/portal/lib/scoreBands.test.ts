import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import {
  BAND_THRESHOLDS,
  scoreBandFor,
  scoreBandLabel,
  bandAxisLabel,
  bandTooltip,
} from "./scoreBands";

/**
 * Observation scores show as a BAND, never a number (operator, 2026-09-29).
 *
 * The portal and the bot are separate builds, so the band rule exists twice.
 * The bot's copy is canonical — it also labels the WhatsApp report — and this
 * test loads it and fails the moment the two disagree, so a teacher can never
 * be "Good" on her report and "Average" in her principal's portal.
 */

const require = createRequire(import.meta.url);
const bot = require("../../../../bot/shared/config/score-bands.js");

describe("the portal band rule IS the bot band rule", () => {
  it("same thresholds, same keys, same order", () => {
    expect(BAND_THRESHOLDS.map((b) => [b.key, b.min])).toEqual(
      bot.BAND_THRESHOLDS.map((b: { key: string; min: number }) => [b.key, b.min]),
    );
  });

  it("same answer at every boundary and either side of it", () => {
    for (const pct of [0, 19.99, 20, 39.99, 40, 59.99, 60, 79.6, 80, 100, 104, -3]) {
      expect(scoreBandFor(pct)).toBe(bot.scoreBandFor(pct));
    }
  });

  it("same English words as the bot's catalog", () => {
    for (const pct of [5, 25, 45, 65, 85]) {
      expect(scoreBandLabel(pct)).toBe(bot.scoreBandLabel(pct, "en"));
    }
  });
});

describe("scoreBandLabel", () => {
  it("names the band and carries no number", () => {
    expect(scoreBandLabel(64.2)).toBe("Good");
    expect(scoreBandLabel(79.6)).toBe("Good"); // raw, not rounded
    expect(scoreBandLabel(null)).toBeNull();
    expect(scoreBandLabel(undefined)).toBeNull();
  });
});

describe("chart helpers — the y axis reads in bands", () => {
  it("each gridline is labelled with the band that starts there", () => {
    expect(bandAxisLabel(0)).toBe("Needs support");
    expect(bandAxisLabel(20)).toBe("Below average");
    expect(bandAxisLabel(40)).toBe("Average");
    expect(bandAxisLabel(60)).toBe("Good");
    expect(bandAxisLabel(80)).toBe("Excellent");
  });

  it("the top gridline is left blank rather than repeating Excellent", () => {
    expect(bandAxisLabel(100)).toBe("");
  });

  it("the tooltip names the point's band, never its percentage", () => {
    expect(bandTooltip(64.2)).toBe("Good");
    expect(bandTooltip(64.2)).not.toMatch(/\d|%/);
  });
});
