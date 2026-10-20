import { describe, it, expect } from "vitest";
import { COPY_MODULES } from "../copyRegistry";
import { HOME_CARD, HOME_CARD_COPY as EN, HOME_CARD_COPY_UR as UR } from "./copy";

/**
 * The Home card's words: found by the registry's glob (so copyRegistry.test.ts holds them to Urdu-complete), and each
 * within its cap at 360 wide, counted in CODE POINTS (language-protocol §3), with realistic data in the placeholders.
 */
const len = (s: string) => [...s.replace(/[⁦-⁩]/g, "")].length;
const TOPIC = "Parts of a Plant"; // a typical topic; a long one is ellipsised by the card, never cut by the copy
const DAY = "18 Oct";

describe("Home card copy", () => {
  it("registers itself through copyRegistry's glob", () => {
    expect(COPY_MODULES.find((m) => m.screen === "Home card")?.module).toBe(HOME_CARD);
  });

  it.each([["en", EN], ["ur", UR]] as const)("%s: every line within its cap (eyebrow 24, title 60, sub 48, button 20, chip 24)", (_l, W) => {
    const caps: Array<[string, number]> = [
      [W.eyebrow, 24],
      [W.class.title(30), 60], [W.class.sub(TOPIC), 48], [W.class.primary, 20], [W.class.secondary, 20],
      [W.coach.title, 60], [W.coach.sub(TOPIC, DAY), 48], [W.coach.primary, 20], [W.coach.secondary, 20],
      [W.lesson.title(TOPIC), 60], [W.lesson.sub(4, "Science"), 48], [W.lesson.primary, 20], [W.lesson.secondary, 20],
      [W.obs.title(DAY), 60], [W.obs.sub, 48], [W.obs.primary, 20], [W.obs.secondary, 20],
      [W.first.title, 60], [W.first.sub, 48], [W.first.primary, 20], [W.first.secondary, 20],
      [W.scores.coach(100, 100), 24], [W.scores.obs(38, 38), 24], [W.lp.quizThis, 24],
    ];
    expect(caps.filter(([s, cap]) => len(s) > cap)).toEqual([]);
  });

  it("no score in a headline", () => {
    for (const W of [EN, UR]) {
      expect(W.coach.title).not.toMatch(/\d|\{/);
      expect(W.obs.title("DAY")).not.toMatch(/\d/);
    }
  });

  it("the sub line joins with '·' in English and '،' in Urdu; Urdu isolates every placeholder", () => {
    expect(EN.coach.sub("A", "B")).toBe("A · B");
    expect(UR.coach.sub("A", "B")).toBe("⁨A⁩، ⁨B⁩");
    expect(UR.lesson.sub(4, "Science")).toBe("لیسن پلان، جماعت ⁦4⁩، ⁨Science⁩");
    expect(UR.scores.coach(31, 40)).toBe("کوچ ⁦31/40⁩");
  });
});
