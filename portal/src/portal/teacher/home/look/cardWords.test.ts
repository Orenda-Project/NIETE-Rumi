import { describe, it, expect } from "vitest";
import { fullCardWords, slimCardActions, lookCardWords } from "./cardWords";
import { HOME_CARD_COPY as EN, HOME_CARD_COPY_UR as UR } from "../copy";
import type { HomeCard } from "../api";

/** The card words lifted out of NextCard and SlimCard: the same labels and hrefs, the look's titles per kind. */
const QUIZ = "/quiz/teacher/tok123";
const COACH: HomeCard = { kind: "coach_report", title: "Fractions", at: "2026-10-18T09:00:00Z", href: "/x", id: "s-1" };

describe("cardWords", () => {
  it("full kinds: NextCard's words and hrefs; the coach's quiz only with a quiz home", () => {
    expect(fullCardWords("coach_report", COACH, QUIZ, EN, "18 Oct")).toEqual({
      title: EN.coach.title, sub: "Fractions · 18 Oct",
      primary: { label: "See report", href: "/portal/teacher/coaching/report/s-1" },
      secondary: { label: "Quiz this", href: QUIZ },
    });
    expect(fullCardWords("coach_report", COACH, null, EN, "").secondary).toBeNull();
    expect(fullCardWords("observation", { kind: "observation", title: "", href: "/x" }, QUIZ, EN, "12 Oct").primary.href).toBe("/portal/teacher/observations");
    expect(fullCardWords("first_plan", { kind: "first_plan", title: "", href: "/x" }, QUIZ, EN, "").secondary?.href).toBe("/portal/teacher/training");
  });

  it("slim kinds: SlimCard's verbs; a lesson from a coaching session opens that session", () => {
    const lesson: HomeCard = { kind: "lesson", title: "T", from: "coach", id: "s-9", href: QUIZ };
    expect(slimCardActions(lesson, UR)).toEqual({
      primary: { label: UR.lesson.primary, href: QUIZ },
      secondary: { label: UR.lesson.secondary, href: "/portal/teacher/coaching/report/s-9" },
    });
    expect(slimCardActions({ ...lesson, from: "lp" }, EN).secondary.href).toBe("/portal/teacher/lessons");
    expect(slimCardActions({ kind: "class", title: "T", played: 2, href: QUIZ }, EN).secondary).toEqual({ label: "See report", href: QUIZ });
  });

  it("the look: lesson title is the lead-in and has no sub; class has its count and topic", () => {
    const l = lookCardWords({ kind: "lesson", title: "T", href: QUIZ }, QUIZ, EN, "en");
    expect(l.title).toBe(EN.look.leadIn);
    expect(l.sub).toBe("");
    const c = lookCardWords({ kind: "class", title: "T", played: 4, href: QUIZ }, QUIZ, EN, "en");
    expect([c.title, c.sub]).toEqual([EN.class.title(4), EN.class.sub("T")]);
  });
});
