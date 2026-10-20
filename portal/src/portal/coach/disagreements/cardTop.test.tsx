import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import i18n from "i18next";
import type { Card } from "./api";
import { CardHead, Banner, ReasonPills } from "./cardTop";

/**
 * bd-tbprit.8 — the top of one teacher's card as Rifat's prototype draws it: the dark head (name, lesson, date ·
 * Group, the % and marks), the pink banner (she doesn't agree; how many reasons, voice note, when, which time),
 * and her reasons as pills in her own words.
 */
const base = {
  id: "c1", teacher: "Sadia Bibi", school: "IMSG I-8/1", emis: "312", group: "C", nth: 1, language: "en", status: "sent", done: false,
  reasons: ["missed", "unclear"], createdAt: "2026-10-02T14:12:00Z", noteUrl: "https://r2/note.ogg",
  view: {
    language: "en",
    header: { name: "Sadia", meta: "Grade 1 · Urdu · Counting and pronouns", date: "2 Oct", pct: 64, marks: 90, max: 140 },
    wells: [], thing: null, sections: [], journey: null, quizMessage: null, voice: null, report: null,
  },
  evidence: [], indicators: [], moves: null,
} as unknown as Card;
const card = (extra: Partial<Card> = {}) => ({ ...base, ...extra }) as Card;

beforeEach(async () => { if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} }); });
afterEach(async () => { await act(async () => { await i18n.changeLanguage("en"); }); });

describe("CardHead", () => {
  it("her name, the lesson, date · Group, the % and marks out of max", () => {
    render(<CardHead card={card()} />);
    const head = screen.getByTestId("card-head");
    expect(head).toHaveTextContent("Sadia Bibi");
    expect(head).toHaveTextContent("Grade 1 · Urdu · Counting and pronouns");
    expect(head).toHaveTextContent("2 Oct · Group C");
    expect(screen.getByTestId("card-pct")).toHaveTextContent("64%");
    expect(head).toHaveTextContent("90 / 140");
  });

  it("no group, no date: neither is made up; no score: a dash", () => {
    const view = { ...base.view, header: { ...base.view.header, date: null, pct: null, marks: null, max: null } };
    render(<CardHead card={card({ group: null, view })} />);
    const head = screen.getByTestId("card-head");
    expect(head).not.toHaveTextContent("Group");
    expect(screen.getByTestId("card-pct")).toHaveTextContent("—");
    expect(head).not.toHaveTextContent("/");
  });
});

describe("Banner", () => {
  it("she doesn't agree; reasons + voice note · when it was sent (Pakistan time) · first time", () => {
    render(<Banner card={card()} />);
    const b = screen.getByTestId("card-banner");
    expect(b).toHaveTextContent("Sadia Bibi doesn't agree with this report");
    expect(b).toHaveTextContent("2 reasons + voice note · sent 2 Oct, 7:12 pm · first time");
  });

  it("one reason, no note, her 3rd time", () => {
    render(<Banner card={card({ reasons: ["score"], noteUrl: null, nth: 3 })} />);
    expect(screen.getByTestId("card-banner")).toHaveTextContent("1 reason · sent 2 Oct, 7:12 pm · 3rd time");
  });

  it("Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    render(<Banner card={card({ nth: 2 })} />);
    const b = screen.getByTestId("card-banner");
    expect(b).toHaveTextContent("Sadia Bibi اس رپورٹ سے متفق نہیں");
    expect(b).toHaveTextContent("دوسری بار");
  });
});

describe("ReasonPills", () => {
  it("each reason she chose, in her own words, nothing else", () => {
    render(<ReasonPills reasons={["missed", "unclear"]} />);
    const pills = screen.getAllByTestId("reason-pill");
    expect(pills.map((p) => p.textContent)).toEqual(["✋ I did this, but the report missed it", "❓ I didn't understand what to do"]);
  });
});
