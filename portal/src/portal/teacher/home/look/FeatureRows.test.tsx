import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { FeatureRows } from "./FeatureRows";
import { teacherPath } from "../../routes";
import { TEACHER_COPY, TEACHER_COPY_UR } from "../../copy";
import type { HomeTileKey } from "../api";

/** The look's feature rows: 8 rows two per line, a tinted icon well per kind, the server's order when it is whole. */
const TILES: HomeTileKey[] = ["lessons", "coaching", "observations", "training", "assessment", "attendance", "classes", "analytics"];
const GREEN: HomeTileKey[] = ["lessons", "training", "assessment"];
const tiles = TILES.map((key) => ({ key }));

const draw = (order?: HomeTileKey[] | null) =>
  render(<MemoryRouter><FeatureRows tiles={tiles} order={order} /></MemoryRouter>);
const rows = () => Array.from(screen.getByTestId("feature-tiles").querySelectorAll<HTMLAnchorElement>("a[data-row]"));

beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("FeatureRows", () => {
  it("8 rows in the tiles' order, each to its feature, each at least 52px tall", () => {
    draw();
    expect(rows().map((a) => a.dataset.row)).toEqual(TILES);
    rows().forEach((a, i) => {
      expect(a.getAttribute("href")).toBe(teacherPath(TILES[i]));
      expect(a.className.split(" ")).toContain("min-h-[52px]");
    });
    expect(rows().map((a) => a.textContent)).toEqual(TILES.map((k) => TEACHER_COPY.home.tiles[k]));
  });

  it("the green kinds wear the green well and glyph, the rest the slate", () => {
    draw();
    for (const a of rows()) {
      const well = a.querySelector("[data-well]")!;
      const green = GREEN.includes(a.dataset.row as HomeTileKey);
      expect(well.className).toContain(green ? "bg-[#e7f5ed]" : "bg-[#e6e9f3]");
      expect(well.className).toContain(green ? "text-[#2e7d57]" : "text-[#333748]");
      expect(well.className).not.toContain(green ? "bg-[#e6e9f3]" : "bg-[#e7f5ed]");
      expect(well.querySelector("svg")).not.toBeNull();
    }
  });

  it("a whole server order is honoured", () => {
    const order: HomeTileKey[] = ["coaching", "lessons", "training", "observations", "assessment", "attendance", "classes", "analytics"];
    draw(order);
    expect(rows().map((a) => a.dataset.row)).toEqual(order);
  });

  it("a partial or junk order is ignored: the tiles' order", () => {
    draw(["coaching", "lessons"]);
    expect(rows().map((a) => a.dataset.row)).toEqual(TILES);
  });

  it("an order with a repeat is not a permutation: the tiles' order", () => {
    draw(["coaching", "coaching", "training", "observations", "assessment", "attendance", "classes", "analytics"]);
    expect(rows().map((a) => a.dataset.row)).toEqual(TILES);
  });

  it("the grid: two columns by [display:grid] (never .grid, which RTL flips), labelled", () => {
    draw();
    const nav = screen.getByTestId("feature-tiles");
    expect(nav.tagName).toBe("NAV");
    expect(nav.getAttribute("aria-label")).toBe(TEACHER_COPY.home.features);
    expect(nav.className).toContain("[display:grid]");
    expect(nav.className).toContain("grid-cols-2");
    expect(` ${nav.className} `).not.toContain(" grid ");
  });

  it("the label: 14px semibold ink, may wrap; under 344px a smaller well and a 13px label", () => {
    draw();
    const a = rows()[0];
    const label = a.querySelector("[data-label]")!;
    for (const c of ["text-[14px]", "font-semibold", "text-[#333748]", "min-w-0", "[overflow-wrap:anywhere]", "hyphens-auto", "max-[343px]:text-[13px]"]) {
      expect(label.className.split(" ")).toContain(c);
    }
    for (const c of ["max-[343px]:gap-2", "max-[343px]:px-1.5"]) expect(a.className.split(" ")).toContain(c);
    const well = a.querySelector("[data-well]")!;
    for (const c of ["h-9", "w-9", "max-[343px]:h-8", "max-[343px]:w-8"]) expect(well.className.split(" ")).toContain(c);
  });

  it("Urdu words", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    draw();
    expect(rows().map((a) => a.textContent)).toEqual(TILES.map((k) => TEACHER_COPY_UR.home.tiles[k]));
  });
});
