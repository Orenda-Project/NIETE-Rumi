import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { FeatureTiles } from "./FeatureTiles";
import { teacherPath } from "../../routes";
import { TEACHER_COPY, TEACHER_COPY_UR } from "../../copy";
import type { AnyFeature } from "../../icons";
import type { HomeTileKey } from "../api";

/**
 * The look's features (operator, 30 Oct 2026, mockup v6 option B): the kit's FeatureTile three per row, compact (104px,
 * the feature's 44px art moving together, 14px words), the Quizzes tile after Lesson plans, the server's order when whole.
 */
const KEYS: HomeTileKey[] = ["lessons", "coaching", "observations", "training", "assessment", "attendance", "classes", "analytics"];
const ART: Record<HomeTileKey, AnyFeature> = {
  lessons: "lessons", coaching: "coaching", observations: "observations", training: "training",
  assessment: "assessment", attendance: "attendance", classes: "classes", analytics: "reports",
};
const tiles = KEYS.map((key) => ({ key, art: ART[key] }));

const draw = (order?: HomeTileKey[] | null, quiz?: { quizHome: string; onGo: () => void } | null) =>
  render(<MemoryRouter><FeatureTiles tiles={tiles} order={order} quiz={quiz} /></MemoryRouter>);
const links = () => Array.from(screen.getByTestId("feature-tiles").querySelectorAll<HTMLAnchorElement>("a"));
const keysDrawn = () => links().map((a) => KEYS.find((k) => teacherPath(k) === a.getAttribute("href")));

beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("FeatureTiles", () => {
  it("8 kit tiles in the tiles' order, each to its feature, 104px, its own 44px art, 14px words", () => {
    draw();
    expect(keysDrawn()).toEqual(KEYS);
    links().forEach((a, i) => {
      expect(a.className.split(" ")).toContain("min-h-[104px]");
      const art = a.querySelector(`svg[data-feature-art="${ART[KEYS[i]]}"]`);
      expect(art, KEYS[i]).not.toBeNull();
      expect(art!.getAttribute("width")).toBe("44");
      expect(a.lastElementChild!.className.split(" ")).toContain("text-[14px]");
      expect(a.querySelector("svg.lucide")).toBeNull();
    });
    expect(links().map((a) => a.textContent)).toEqual(KEYS.map((k) => TEACHER_COPY.home.tiles[k]));
  });

  it("the art moves on the page's one shared timer (all eight arrive together)", () => {
    vi.useFakeTimers();
    try {
      draw();
      const arts = Array.from(screen.getByTestId("feature-tiles").querySelectorAll("svg[data-feature-art]"));
      expect(arts.map((s) => s.getAttribute("data-motion"))).toEqual(Array(8).fill("arrive"));
      expect(vi.getTimerCount()).toBe(1);
    } finally { vi.useRealTimers(); }
  });

  it("a whole server order is honoured", () => {
    const order: HomeTileKey[] = ["coaching", "lessons", "training", "observations", "assessment", "attendance", "classes", "analytics"];
    draw(order);
    expect(keysDrawn()).toEqual(order);
  });

  it("a partial, junk or repeating order is ignored: the tiles' order", () => {
    draw(["coaching", "lessons"]);
    expect(keysDrawn()).toEqual(KEYS);
  });

  it("an order with a repeat is not a permutation: the tiles' order", () => {
    draw(["coaching", "coaching", "training", "observations", "assessment", "attendance", "classes", "analytics"]);
    expect(keysDrawn()).toEqual(KEYS);
  });

  it("the Quizzes tile comes right after Lesson plans, compact, with the quiz picture; none spans two columns", () => {
    draw(null, { quizHome: "/quiz/teacher/tok", onGo: vi.fn() });
    const cells = Array.from(screen.getByTestId("feature-tiles").children);
    expect(cells).toHaveLength(9);
    expect(cells[1].getAttribute("data-testid")).toBe("tile-quiz");
    expect(cells[1].className.split(" ")).toContain("min-h-[104px]");
    expect(cells[1].querySelector('svg[data-feature-art="quiz"]')?.getAttribute("width")).toBe("44");
    cells.forEach((c) => expect(c.className.split(" ")).not.toContain("col-span-2"));
  });

  it("the grid: three columns by [display:grid] (never .grid, which RTL flips), labelled", () => {
    draw();
    const nav = screen.getByTestId("feature-tiles");
    expect(nav.tagName).toBe("NAV");
    expect(nav.getAttribute("aria-label")).toBe(TEACHER_COPY.home.features);
    expect(nav.className).toContain("[display:grid]");
    expect(nav.className).toContain("grid-cols-3");
    expect(` ${nav.className} `).not.toContain(" grid ");
  });

  it("Urdu words", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    draw();
    expect(links().map((a) => a.textContent)).toEqual(KEYS.map((k) => TEACHER_COPY_UR.home.tiles[k]));
  });
});
