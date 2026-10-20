import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "i18next";
import { NextCard } from "./NextCard";
import { HOME_CARD_COPY as EN, HOME_CARD_COPY_UR as UR } from "./copy";
import type { HomeCard } from "./api";

/**
 * Shape A, the full Home card, per rung, in English and in Urdu: its words from copy.ts, the data (topic, date) as it
 * comes, no score in the headline, 48 px buttons, dir="rtl" on every line in Urdu, and where each tap goes.
 */
const QUIZ = "/quiz/teacher/tok123";
const COACH: HomeCard = { kind: "coach_report", title: "Fractions: halves and quarters", score: 72, max: 100, at: "2026-10-18T09:00:00Z", href: "/x", id: "s-1" };
const OBS: HomeCard = { kind: "observation", title: "", score: 29, max: 38, at: "2026-10-12T09:00:00Z", href: "/x", id: "o-1" };
const FIRST: HomeCard = { kind: "first_plan", title: "", href: "/x" };

async function lang(code: "en" | "ur") {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage(code); });
}

function draw(card: HomeCard, quizHome: string | null = QUIZ) {
  const onGo = vi.fn();
  render(<NextCard card={card} quizHome={quizHome} onGo={onGo} />);
  return { onGo, card: screen.getByTestId("home-next-card") };
}

const buttons = (el: HTMLElement) => within(el).getAllByRole("button");

describe("NextCard (English)", () => {
  beforeEach(() => lang("en"));

  it("coach report: the eyebrow, a headline with no score, the topic · the day, See report / Quiz this", async () => {
    const { card, onGo } = draw(COACH);
    expect(card).toHaveTextContent(EN.eyebrow);
    expect(screen.getByTestId("home-next-title").textContent).toBe("Your coach report is ready");
    expect(screen.getByTestId("home-next-title").textContent).not.toMatch(/\d/);
    expect(screen.getByTestId("home-next-sub").textContent).toBe("Fractions: halves and quarters · 18 Oct");
    expect(buttons(card).map((b) => b.textContent)).toEqual(["See report", "Quiz this"]);
    for (const b of buttons(card)) expect(b.className).toMatch(/min-h-\[48px\]/);
    await userEvent.setup().click(screen.getByRole("button", { name: "See report" }));
    expect(onGo).toHaveBeenLastCalledWith("coach_report", "/portal/teacher/coaching/report/s-1");
    await userEvent.setup().click(screen.getByRole("button", { name: "Quiz this" }));
    expect(onGo).toHaveBeenLastCalledWith("coach_report", QUIZ);
  });

  it("coach report with no quiz home: only See report", () => {
    const { card } = draw(COACH, null);
    expect(buttons(card).map((b) => b.textContent)).toEqual(["See report"]);
  });

  it("observation: 'Your observation from <day>' (no score), See feedback → Observations, Lesson Plans", async () => {
    const { card, onGo } = draw(OBS);
    expect(screen.getByTestId("home-next-title").textContent).toBe("Your observation from 12 Oct");
    expect(card.textContent).not.toMatch(/29|38/);
    expect(buttons(card).map((b) => b.textContent)).toEqual(["See feedback", "Lesson Plans"]);
    await userEvent.setup().click(screen.getByRole("button", { name: "See feedback" }));
    expect(onGo).toHaveBeenLastCalledWith("observation", "/portal/teacher/observations");
  });

  it("first plan: Make your first lesson plan, Make a lesson plan → Lesson Plans, Training", async () => {
    const { card, onGo } = draw(FIRST);
    expect(screen.getByTestId("home-next-title").textContent).toBe(EN.first.title);
    expect(screen.getByTestId("home-next-sub").textContent).toBe(EN.first.sub);
    await userEvent.setup().click(within(card).getByRole("button", { name: "Make a lesson plan" }));
    expect(onGo).toHaveBeenLastCalledWith("first_plan", "/portal/teacher/lessons");
    await userEvent.setup().click(within(card).getByRole("button", { name: "Training" }));
    expect(onGo).toHaveBeenLastCalledWith("first_plan", "/portal/teacher/training");
  });

  it("climbs into the band when it is first, like the tiles; English lines carry no dir", () => {
    const { card } = draw(COACH);
    expect(card.className).toMatch(/\bfirst:-mt-10\b/);
    expect(card.className).toMatch(/rounded-\[20px\]/);
    expect(card.getAttribute("data-home-card")).toBe("coach_report");
    expect(card.querySelectorAll("[data-primary]")).toHaveLength(1);
    expect(card.querySelector("[data-primary]")?.textContent).toBe("See report");
    expect(card.querySelectorAll("[dir]")).toHaveLength(0);
  });

  it("a quiz rung is not this card's", () => {
    render(<NextCard card={{ kind: "class", title: "T", played: 2, href: QUIZ }} quizHome={QUIZ} onGo={vi.fn()} />);
    expect(screen.queryByTestId("home-next-card")).toBeNull();
  });
});

describe("NextCard (Urdu)", () => {
  beforeEach(() => lang("ur"));
  afterEach(() => lang("en"));

  it("coach report: the Urdu words, the topic and day isolated and joined with '،', dir=rtl on every line", () => {
    const { card } = draw(COACH);
    expect(card).toHaveTextContent(UR.eyebrow);
    expect(screen.getByTestId("home-next-title").textContent).toBe("آپ کی کوچنگ رپورٹ تیار ہے");
    const sub = screen.getByTestId("home-next-sub").textContent || "";
    expect(sub).toBe("⁨Fractions: halves and quarters⁩، ⁨18 اکتوبر⁩");
    expect(sub).not.toMatch(/·/);
    expect(buttons(card).map((b) => b.textContent)).toEqual(["رپورٹ دیکھیں", "فوری جانچ بنائیں"]);
    for (const el of [screen.getByTestId("home-next-title"), screen.getByTestId("home-next-sub"), ...buttons(card)]) {
      expect(el.getAttribute("dir")).toBe("rtl");
    }
  });

  it("observation: '<day> کا مشاہدہ', the day isolated, Latin digits", () => {
    draw(OBS);
    expect(screen.getByTestId("home-next-title").textContent).toBe("⁨12 اکتوبر⁩ کا مشاہدہ");
    expect(screen.getByRole("button", { name: "رائے دیکھیں" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "لیسن پلان" })).toBeTruthy();
  });

  it("first plan: the Urdu words, no English left", () => {
    const { card } = draw(FIRST);
    expect(screen.getByTestId("home-next-title").textContent).toBe("اپنا پہلا لیسن پلان بنائیں");
    expect(card.textContent).not.toMatch(/[A-Za-z]/);
  });
});
