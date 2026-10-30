import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import MoreCoachip from "../components/MoreCoachip";

/**
 * bd-sex15q.46 (R6 fix cycle 2, FIX_R6 §7.2 A12, panel 015902) — More is a `.cp` page now, so its who card keeps the
 * deck's Urdu contract: the schools count in Urdu digits, the separator the Urdu comma, and the phone the one isolated
 * LTR run (a `bdi`). The phone is the coach's own (B21 allows it); it is the only Latin-digit run on the card.
 */
const ASCII_DIGIT = /[0-9]/;

describe.each(["en", "ur"] as const)("A12: More's who card (%s)", (lang) => {
  beforeEach(async () => {
    if (!i18n.isInitialized) await i18n.init({ lng: lang, resources: {} });
    await act(async () => { await i18n.changeLanguage(lang); });
  });
  afterEach(() => cleanup());

  it("the count in the page's digits, the phone one isolated LTR run", () => {
    render(<MemoryRouter><MoreCoachip name="Fixture Coach" phone="+920000000003" schools={12} rmOn={false} assess={false} onLogout={() => {}} /></MemoryRouter>);
    const who = screen.getByTestId("more-who");
    const phone = who.querySelectorAll("bdi[dir='ltr']");
    expect(phone).toHaveLength(1);
    expect(phone[0].textContent).toBe("+920000000003");
    const clone = who.cloneNode(true) as HTMLElement;
    clone.querySelector("bdi[dir='ltr']")!.remove();
    const rest = clone.textContent || "";
    if (lang === "ur") {
      expect(rest).not.toMatch(ASCII_DIGIT);
      expect(rest).toContain("۱۲");
      expect(rest).toContain("، ");
      expect(rest).not.toContain(" · ");
    } else {
      expect(rest).toContain("12 schools");
      expect(rest).toContain(" · ");
    }
  });
});
