import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "i18next";
import { SlimCard, coolDownKey } from "./SlimCard";
import type { HomeCard } from "./api";

/**
 * Shape B, the slim Home card: the class and lesson rungs, its one line and two verbs, and the lesson rung's
 * cool-down (drawn on at most 3 home loads per plan on this device; a newer plan starts again; a blocked store draws).
 */
const QUIZ = "/quiz/teacher/tok123";
const KEY = "user-key-1";
const LESSON: HomeCard = { kind: "lesson", title: "Parts of a Plant", from: "lp", href: QUIZ, id: "lp-1" };
const CLASS: HomeCard = { kind: "class", title: "Parts of a Plant", played: 3, href: QUIZ, id: "c-1" };

async function lang(code: "en" | "ur") {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage(code); });
}

/** One home load: mount, then unmount (the next load mounts again). */
function load(card: HomeCard, userKey: string | null = KEY) {
  const r = render(<SlimCard card={card} userKey={userKey} onGo={vi.fn()} />);
  const drawn = !!screen.queryByTestId("home-slim-card");
  r.unmount();
  return drawn;
}

describe("SlimCard", () => {
  beforeEach(async () => { localStorage.clear(); await lang("en"); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("lesson: 'Quiz: <topic>', Quiz this as a 44 px pill (to the quiz home), Open the plan under the line", async () => {
    const onGo = vi.fn();
    render(<SlimCard card={LESSON} userKey={KEY} onGo={onGo} />);
    const card = screen.getByTestId("home-slim-card");
    expect(card.className).toMatch(/\bcol-span-2\b/);
    expect(card.className).toMatch(/min-h-\[56px\]/);
    expect(card.getAttribute("data-home-card")).toBe("lesson");
    expect(card.querySelector("[data-primary]")?.textContent).toBe("Quiz this");
    // the line is the topic alone: the pill already says "Quiz this", so no lead-in repeats it
    expect(screen.getByTestId("home-slim-line").textContent).toBe("Parts of a Plant");
    // the topic is its own isolate and the one thing cut, at its own end, whatever the line's direction
    const topic = screen.getByTestId("home-slim-topic");
    expect(topic.tagName).toBe("BDI");
    expect(topic.textContent).toBe("Parts of a Plant");
    expect(topic.className).toMatch(/\btruncate\b/);
    const pill = screen.getByRole("button", { name: "Quiz this" });
    expect(pill.className).toMatch(/min-h-\[44px\]/);
    await userEvent.setup().click(pill);
    expect(onGo).toHaveBeenLastCalledWith("lesson", QUIZ);
    await userEvent.setup().click(screen.getByRole("button", { name: "Open the plan" }));
    expect(onGo).toHaveBeenLastCalledWith("lesson", "/portal/teacher/lessons");
  });

  it("lesson from a coaching session: Open the plan opens that session's page", async () => {
    const onGo = vi.fn();
    render(<SlimCard card={{ ...LESSON, from: "coach", id: "s-9" }} userKey={KEY} onGo={onGo} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Open the plan" }));
    expect(onGo).toHaveBeenLastCalledWith("lesson", "/portal/teacher/coaching/report/s-9");
  });

  it("class: '<n> in your class played', Send again and See report, both to the quiz home", async () => {
    const onGo = vi.fn();
    render(<SlimCard card={CLASS} userKey={KEY} onGo={onGo} />);
    expect(screen.getByTestId("home-slim-line").textContent).toBe("3 in your class played");
    await userEvent.setup().click(screen.getByRole("button", { name: "Send again" }));
    expect(onGo).toHaveBeenLastCalledWith("class", QUIZ);
    await userEvent.setup().click(screen.getByRole("button", { name: "See report" }));
    expect(onGo).toHaveBeenLastCalledWith("class", QUIZ);
  });

  it("cool-down: a plan is drawn on 3 home loads, then not; the counter is kept per plan", () => {
    expect([load(LESSON), load(LESSON), load(LESSON), load(LESSON), load(LESSON)]).toEqual([true, true, true, false, false]);
    expect(JSON.parse(localStorage.getItem(coolDownKey(KEY)) || "{}")).toEqual({ "lp-1": 3 });
  });

  it("cool-down: a newer plan starts again at 0", () => {
    for (let i = 0; i < 3; i += 1) load(LESSON);
    expect(load(LESSON)).toBe(false);
    expect(load({ ...LESSON, id: "lp-2", title: "Magnets" })).toBe(true);
    expect(JSON.parse(localStorage.getItem(coolDownKey(KEY)) || "{}")).toEqual({ "lp-2": 1 });
  });

  it("cool-down: a store that throws still draws the card, every load", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect([load(LESSON), load(LESSON), load(LESSON), load(LESSON)]).toEqual([true, true, true, true]);
  });

  it("the class rung has no counter (the bot's 72-hour rule)", () => {
    expect([load(CLASS), load(CLASS), load(CLASS), load(CLASS)]).toEqual([true, true, true, true]);
    expect(localStorage.getItem(coolDownKey(KEY))).toBeNull();
  });

  it("the line is never cut to an ellipsis: it may take two lines", () => {
    render(<SlimCard card={CLASS} userKey={KEY} onGo={vi.fn()} />);
    const line = screen.getByTestId("home-slim-line");
    expect(line.className).not.toMatch(/\btruncate\b/);
    expect(line.className).toMatch(/\bline-clamp-2\b/);
  });

  it("Urdu: the lesson line is the topic alone, whole at its start; the card is set tighter to fit the fold", async () => {
    await lang("ur");
    try {
      render(<SlimCard card={{ ...LESSON, title: "All About Me: Key Words" }} userKey={KEY} onGo={vi.fn()} />);
      const line = screen.getByTestId("home-slim-line");
      // no lead-in: the pill says کوئز بنائیں, so the line gives the topic the width (the lead's ruling, 21 Oct)
      expect(line.textContent).toBe("All About Me: Key Words");
      expect(screen.getByTestId("home-slim-topic").getAttribute("dir")).toBe("auto");
      expect(line.className).toMatch(/rtl:!leading-\[1\.5\]/);
      const card = screen.getByTestId("home-slim-card");
      // the design's R3.7: in Urdu the 8 px come from the gap above the card, never from the buttons
      expect(card.className).toMatch(/rtl:-mt-2\b/);
      // and 4 px from the card's own padding, with the link's Nastaliq line set at 1.25: bottom ≤ 558 at 360×640
      expect(card.className).toMatch(/rtl:py-1\b/);
      expect(screen.getByRole("button", { name: "لیسن پلان کھولیں" }).className).toMatch(/rtl:!leading-\[1\.25\]/);
    } finally { await lang("en"); }
  });

  it("Urdu: dir=rtl on the line and both verbs, the number and the topic isolated, the chevron mirrored", async () => {
    await lang("ur");
    try {
      render(<SlimCard card={CLASS} userKey={KEY} onGo={vi.fn()} />);
      const line = screen.getByTestId("home-slim-line");
      expect(line.getAttribute("dir")).toBe("rtl");
      expect(line.textContent).toBe("کلاس میں سے ⁦3⁩ نے کھیلا");
      for (const b of screen.getAllByRole("button")) expect(b.getAttribute("dir")).toBe("rtl");
      expect(screen.getByTestId("home-slim-card").querySelector("svg.lucide")?.getAttribute("class")).toMatch(/rtl:rotate-180/);
    } finally { await lang("en"); }
  });
});
