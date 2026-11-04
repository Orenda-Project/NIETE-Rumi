import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "i18next";
import { LookCard, LOOK_KINDS } from "./LookCard";
import { NextCard } from "../NextCard";
import { SlimCard } from "../SlimCard";
import { coolDownKey } from "../coolDown";
import { HOME_CARD_COPY as EN, HOME_CARD_COPY_UR as UR } from "../copy";
import type { HomeCard, HomeCardKind } from "../api";
import { HOME_LOOK } from "../../../newui/tokens";

/**
 * The look's one card for all five rungs, in English and in Urdu: the tint and medal by kind, the eyebrow's colour,
 * the compact size (operator, 31 Oct 2026, mockup v8: 12 px padding, a 40 px medal, a 16 px title, a 14 px topic, the
 * primary and its text-link secondary side by side on one row), taps that go exactly where NextCard and SlimCard send
 * them, the lesson's lead-in with its topic on its own line, and the lesson's cool-down (3 home loads, then not drawn).
 */
const QUIZ = "/quiz/teacher/tok123";
const KEY = "user-key-1";
const COACH: HomeCard = { kind: "coach_report", title: "Fractions: halves and quarters", score: 72, max: 100, at: "2026-10-18T09:00:00Z", href: "/x", id: "s-1" };
const OBS: HomeCard = { kind: "observation", title: "", score: 29, max: 38, at: "2026-10-12T09:00:00Z", href: "/x", id: "o-1" };
const FIRST: HomeCard = { kind: "first_plan", title: "", href: "/x" };
const LESSON: HomeCard = { kind: "lesson", title: "Parts of a Plant", from: "lp", href: QUIZ, id: "lp-1" };
const CLASS: HomeCard = { kind: "class", title: "Parts of a Plant", played: 3, href: QUIZ, id: "c-1" };
const CARDS: Record<HomeCardKind, HomeCard> = { coach_report: COACH, observation: OBS, first_plan: FIRST, lesson: LESSON, class: CLASS };
const GREEN: HomeCardKind[] = ["lesson", "first_plan"];
const GLYPH: Record<HomeCardKind, string> = {
  lesson: "lucide-list-checks", first_plan: "lucide-book-open", coach_report: "lucide-audio-lines", observation: "lucide-eye", class: "lucide-users",
};
const LONG_EN = "Hidden Heroes — Self-Check Quiz on the Helpers Around Us";
const URDU_TOPIC = "ہمارے مددگار";

async function lang(code: "en" | "ur") {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage(code); });
}

function draw(card: HomeCard, quizHome: string | null = QUIZ, userKey: string | null = null) {
  const onGo = vi.fn();
  render(<LookCard card={card} quizHome={quizHome} userKey={userKey} onGo={onGo} />);
  return { onGo, card: screen.getByTestId("home-look-card") };
}

/** One home load: mount, then unmount. */
function load(card: HomeCard, userKey: string | null = KEY) {
  const r = render(<LookCard card={card} quizHome={QUIZ} userKey={userKey} onGo={vi.fn()} />);
  const drawn = !!screen.queryByTestId("home-look-card");
  r.unmount();
  return drawn;
}

/** Tap the primary, then the secondary (when there is one); the onGo calls in that order. */
async function taps(root: HTMLElement, onGo: ReturnType<typeof vi.fn>) {
  const primary = root.querySelector("[data-primary]") as HTMLElement;
  const rest = within(root).getAllByRole("button").filter((b) => b !== primary);
  const user = userEvent.setup();
  await user.click(primary);
  for (const b of rest) await user.click(b);
  return onGo.mock.calls.map((c) => [...c]);
}

for (const code of ["en", "ur"] as const) {
  const C = code === "ur" ? UR : EN;
  describe(`LookCard (${code})`, () => {
    beforeEach(async () => { localStorage.clear(); await lang(code); });
    afterEach(async () => { vi.restoreAllMocks(); await lang("en"); });

    for (const kind of LOOK_KINDS) {
      it(`${kind}: tint, 12 px padding, a 40 px medal, eyebrow, the primary and its 44 px secondary on one row, a 16 px title`, () => {
        const { card } = draw(CARDS[kind]);
        expect(card.getAttribute("data-home-card")).toBe(kind);
        expect(card.getAttribute("data-kind")).toBe(kind);
        expect(card.tagName).toBe("SECTION");
        const green = GREEN.includes(kind);
        expect(card.className).toContain(green ? "bg-[#e7f5ed]" : "bg-[#e6e9f3]");
        // the literal classes are the HOME_LOOK tokens
        expect(card.className).toContain(`bg-[${green ? HOME_LOOK.tileGreen : HOME_LOOK.tileSlate}]`);
        expect(card.className).toMatch(/rounded-\[20px\]/);
        expect(card.className.split(" ")).toContain("p-3");
        expect(card.className).not.toMatch(/(^|\s)(p-4|pb-2)(\s|$)/);
        expect(card.querySelector(`svg.${GLYPH[kind]}`)).toBeTruthy();
        const medal = card.querySelector(`svg.${GLYPH[kind]}`)!.parentElement!;
        expect(medal.className.split(" ")).toEqual(expect.arrayContaining(["h-10", "w-10", "rounded-full", "bg-white"]));
        const eyebrow = within(card).getByText(C.eyebrow);
        expect(eyebrow.className).toContain(green ? "text-[#1e5c3f]" : "text-[#333748]");
        expect(eyebrow.className).not.toContain("text-[#2e7d57]");
        const primaries = card.querySelectorAll("[data-primary]");
        expect(primaries).toHaveLength(1);
        expect(primaries[0].className).toContain("bg-[#2e7d57]");
        // the primary takes the row's room; the secondary sits beside it
        expect(primaries[0].className.split(" ")).toContain("flex-1");
        expect(primaries[0].className).not.toMatch(/\bw-full\b/);
        expect(primaries[0].className).toMatch(/min-h-\[48px\]/);
        expect(primaries[0].className).toMatch(/\bwhitespace-normal\b/);
        // Nastaliq tops at 160% stay inside the green
        expect(primaries[0].className).toMatch(/(^|\s)rtl:py-1\.5(\s|$)/);
        const secondaries = within(card).getAllByRole("button").filter((b) => !b.hasAttribute("data-primary"));
        expect(secondaries).toHaveLength(1);
        expect(secondaries[0].className).toMatch(/min-h-\[44px\]/);
        expect(secondaries[0].className).not.toMatch(/\bw-full\b/);
        expect(secondaries[0].className.split(" ")).toContain("shrink-0");
        const row = primaries[0].parentElement!;
        expect(secondaries[0].parentElement).toBe(row);
        expect(row.className.split(" ")).toEqual(expect.arrayContaining(["flex", "items-center", "mt-2.5"]));
        expect(secondaries[0].querySelector("svg.lucide-chevron-right")?.getAttribute("class")).toMatch(/rtl:rotate-180/);
        const title = screen.getByTestId("home-look-title");
        expect(title.tagName).toBe("H2");
        if (code === "ur") {
          expect(title.className).not.toMatch(/line-clamp/);
          expect(title.className).toMatch(/overflow-visible/);
          expect(title.className.split(" ")).toContain("text-[16px]");
          // a Nastaliq ascender rises above the h2's line box: the gap above grows with the font
          expect(title.className).toMatch(/(^|\s)mt-\[0\.4em\](\s|$)/);
          expect(title.className).not.toMatch(/(^|\s)mt-0\.5(\s|$)/);
          expect(card.getAttribute("dir")).toBe("rtl");
        } else {
          expect(title.className).toMatch(/\bline-clamp-2\b/);
          expect(title.className).toBe("mt-0.5 font-semibold text-[#333748] line-clamp-2 text-[16px] leading-snug");
        }
        if (kind === "lesson") {
          expect(screen.queryByTestId("home-look-sub")).toBeNull();
          expect(card.getAttribute("aria-label")).toBe(C.lesson.title(LESSON.title));
        } else {
          const sub = screen.getByTestId("home-look-sub");
          expect(sub.className).toContain(`text-[${HOME_LOOK.muted}]`);
          expect(sub.className).toMatch(/\btruncate\b/);
          expect(card.getAttribute("aria-label")).toBe(C.eyebrow);
        }
      });

      it(`${kind}: the taps go where NextCard / SlimCard send them`, async () => {
        const variants: HomeCard[] = kind === "lesson" ? [LESSON, { ...LESSON, from: "coach", id: "s-9" }] : [CARDS[kind]];
        for (const c of variants) {
          const onLook = vi.fn();
          const a = render(<LookCard card={c} quizHome={QUIZ} userKey={null} onGo={onLook} />);
          const look = await taps(a.getByTestId("home-look-card"), onLook);
          a.unmount();
          const onOld = vi.fn();
          const slim = kind === "lesson" || kind === "class";
          const b = render(slim
            ? <SlimCard card={c} userKey={null} onGo={onOld} />
            : <NextCard card={c} quizHome={QUIZ} onGo={onOld} />);
          const old = await taps(b.getByTestId(slim ? "home-slim-card" : "home-next-card"), onOld);
          b.unmount();
          expect(look).toEqual(old);
          expect(look.length).toBe(2);
        }
      });
    }

    it("coach report with no quiz home: no secondary (the primary fills its row), the same as NextCard", async () => {
      const { card, onGo } = draw(COACH, null);
      expect(within(card).getAllByRole("button")).toHaveLength(1);
      expect(within(card).getByRole("button").className.split(" ")).toContain("flex-1");
      const look = await taps(card, onGo);
      cleanup();
      const onOld = vi.fn();
      render(<NextCard card={COACH} quizHome={null} onGo={onOld} />);
      expect(await taps(screen.getByTestId("home-next-card"), onOld)).toEqual(look);
    });

    it("the words per kind come from the registry", () => {
      draw(COACH);
      expect(screen.getByTestId("home-look-title").textContent).toBe(C.coach.title);
      expect(screen.getByRole("button", { name: C.coach.primary })).toBeTruthy();
      cleanup();
      draw(CLASS);
      expect(screen.getByTestId("home-look-title").textContent).toBe(C.class.title(3));
      expect(screen.getByTestId("home-look-sub").textContent).toBe(C.class.sub("Parts of a Plant"));
      cleanup();
      draw(FIRST);
      expect(screen.getByTestId("home-look-sub").textContent).toBe(C.first.sub);
    });

    it("lesson: the title is the lead-in, then the topic block", () => {
      const { card } = draw(LESSON);
      const title = screen.getByTestId("home-look-title");
      const topic = screen.getByTestId("home-look-topic");
      expect(title.textContent).toBe(C.look.leadIn);
      expect(topic.textContent).toBe("Parts of a Plant");
      expect(topic.className).toMatch(/\btruncate\b/);
      expect(topic.className.split(" ")).toContain("text-[14px]");
      // the lead-in comes first, the topic on its own line after it
      expect(title.compareDocumentPosition(topic) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(card.textContent?.indexOf(C.look.leadIn)).toBeLessThan(card.textContent?.indexOf("Parts of a Plant") ?? -1);
      expect(within(card).getByRole("button", { name: C.lesson.primary }).hasAttribute("data-primary")).toBe(true);
    });

    it("the className is merged onto the section", () => {
      render(<LookCard card={FIRST} quizHome={QUIZ} onGo={vi.fn()} className="first:-mt-5" />);
      expect(screen.getByTestId("home-look-card").className).toMatch(/first:-mt-5/);
    });
  });
}

describe("LookCard: the lesson topic's direction", () => {
  afterEach(() => lang("en"));

  it("an English topic on an Urdu page: dir=ltr + data-latin on the truncating element, its start kept", async () => {
    await lang("ur");
    draw({ ...LESSON, title: LONG_EN });
    const topic = screen.getByTestId("home-look-topic");
    expect(topic.getAttribute("dir")).toBe("ltr");
    expect(topic.hasAttribute("data-latin")).toBe(true);
    expect(topic.className).toMatch(/\btruncate\b/);
    expect(topic.textContent?.startsWith("Hidden")).toBe(true);
  });

  it("an Urdu topic on an English page: dir=auto, the Urdu face and its line height", async () => {
    await lang("en");
    draw({ ...LESSON, title: URDU_TOPIC });
    const topic = screen.getByTestId("home-look-topic");
    expect(topic.getAttribute("dir")).toBe("auto");
    expect(topic.hasAttribute("data-latin")).toBe(false);
    expect(topic.className).toMatch(/\bfont-urdu\b/);
    expect(topic.className).toMatch(/leading-\[2\]/);
  });

  it("an English topic on an English page: no data-latin (the page is already Latin)", async () => {
    await lang("en");
    draw(LESSON);
    expect(screen.getByTestId("home-look-topic").hasAttribute("data-latin")).toBe(false);
  });
});

describe("LookCard: the lesson's cool-down (SlimCard's cases)", () => {
  beforeEach(async () => { localStorage.clear(); await lang("en"); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("a plan is drawn on 3 home loads, then not; the counter is kept per plan", () => {
    expect([load(LESSON), load(LESSON), load(LESSON), load(LESSON), load(LESSON)]).toEqual([true, true, true, false, false]);
    expect(JSON.parse(localStorage.getItem(coolDownKey(KEY)) || "{}")).toEqual({ "lp-1": 3 });
  });

  it("a newer plan starts again at 0", () => {
    for (let i = 0; i < 3; i += 1) load(LESSON);
    expect(load(LESSON)).toBe(false);
    expect(load({ ...LESSON, id: "lp-2", title: "Magnets" })).toBe(true);
    expect(JSON.parse(localStorage.getItem(coolDownKey(KEY)) || "{}")).toEqual({ "lp-2": 1 });
  });

  it("a store that throws still draws the card, every load", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect([load(LESSON), load(LESSON), load(LESSON), load(LESSON)]).toEqual([true, true, true, true]);
  });

  it("the other kinds have no counter", () => {
    for (const c of [CLASS, COACH, OBS, FIRST]) expect([load(c), load(c), load(c), load(c)]).toEqual([true, true, true, true]);
    expect(localStorage.getItem(coolDownKey(KEY))).toBeNull();
  });

  it("shares SlimCard's counter: a plan SlimCard drew 3 times is not drawn by the look", () => {
    for (let i = 0; i < 3; i += 1) { const r = render(<SlimCard card={LESSON} userKey={KEY} onGo={vi.fn()} />); r.unmount(); }
    expect(load(LESSON)).toBe(false);
  });
});
