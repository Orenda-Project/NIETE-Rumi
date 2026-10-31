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

describe("the Home look's words (portal_teacher_home_look)", () => {
  it("no look string ends a verb in a gendered second-person form («گے» / «گی»)", () => {
    for (const v of Object.values(UR.look)) expect(v).not.toMatch(/(گے|گی)(\s|؟|$)/);
  });
});

/**
 * bd-bmc9a0.6 — the classroom quiz is «کوئز» (operator, 29 Oct, on the DC report's button: "Urdu of Jaanch does not work
 * here. Quiz is a proper noun almost."). The bot already says کوئز everywhere (کوئز بنائیں, میرا کوئز ہوم, آپ کے پچھلے سبق کا
 * کوئز); «فوری جانچ» stays Training's Quick check at the end of a part, a different thing.
 */
describe("the classroom quiz is «کوئز», as the bot says it", () => {
  const quizLines = (): Array<[string, string]> => [
    ["class.sub", UR.class.sub(TOPIC)], ["coach.secondary", UR.coach.secondary], ["lesson.title", UR.lesson.title(TOPIC)],
    ["lesson.primary", UR.lesson.primary], ["lp.quizThis", UR.lp.quizThis], ["quizTile", UR.quizTile], ["look.leadIn", UR.look.leadIn],
  ];

  it("every quiz line says کوئز, never فوری جانچ", () => {
    expect(quizLines().filter(([, s]) => !s.includes("کوئز") || s.includes("فوری جانچ"))).toEqual([]);
  });

  it("the words the quiz home repeats are the bot's own (teacher-home.strings.js)", () => {
    expect(UR.lp.quizThis).toBe("کوئز بنائیں"); // the bot's tqhMake
    expect(UR.look.leadIn).toBe("آپ کے پچھلے سبق کا کوئز:"); // th.lastlesson
    expect(UR.lesson.title(TOPIC)).toContain("آپ کے پچھلے سبق کا کوئز:");
    expect(UR.class.sub(TOPIC).startsWith("کوئز:")).toBe(true); // th.kind.quiz
  });
});
