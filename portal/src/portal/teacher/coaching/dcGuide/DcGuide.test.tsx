import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import i18n from "i18next";

/**
 * bd-ra8xu.64.3 (queue #282) — the teacher's "?" on her own Digital Coach report (the operator, 25 Nov: "for DC the ?
 * needs to also be there. However the descriptions, do update them to be for the teacher intended to record
 * themselves. Right now they are more for the HITL personnel."):
 *
 *   Which report      her own DC report scored on FICO17 v6: the session detail's `rubric` is the stored rubric's LABEL
 *                     (bot rubric-label.js: "FICO17 v6", "FICO17 v6.1"); a coach visit (`observation`) is not hers
 *   The tray          her heading, the 11 indicators the Digital Coach scores (C1 C2 C4 C6 C8 / D1 D5 / F1 F2 F3 F4) by
 *                     section, a chip per code, one card per indicator in the teacher's words; never the 6 a coach
 *                     sets in the room (C3 C5 C7 D2 D3 D4), by code or by name
 *   A card            her headings ("What it means", "What the Digital Coach listens for", "Try next time"); a level with
 *                     no example shows no "Example"; no manual links, no "No N/A here" line
 *   Credit            "Adapted from Dr Rifat Yasmeen's guide" (she has not reviewed the teacher version yet)
 *   Data              loaded only when the tray opens (dynamic import): the report page's first chunk does not grow
 *   Urdu              the same, from the guide's own Urdu and the copy's
 */

vi.mock("../../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import { DcGuideTray, DcGuideButton } from "./DcGuide";
import { isV6Rubric, showsDcGuide, loadDcGuide } from "./guide";
import { DC_GUIDE_COPY as E, DC_GUIDE_COPY_UR as U } from "./copy";
import GUIDE from "./fico_v6_dc.guide";
import OBSERVER from "../../help/observe/fico_v6.manual";
import { HELP_COPY, HELP_COPY_UR } from "../../help/copy";
import dcGuideSrc from "./DcGuide.tsx?raw";
import guideSrc from "./guide.ts?raw";
import reportPageSrc from "../ReportPage.tsx?raw";

const DC11 = ["C1", "C2", "C4", "C6", "C8", "D1", "D5", "F1", "F2", "F3", "F4"];
const COACH_ONLY = ["C3", "C5", "C7", "D2", "D3", "D4"];
type Named = { code: string; name: { en: string; ur: string } };
const observerItems = (OBSERVER as unknown as { sections: { items: Named[] }[] }).sections.flatMap((s) => s.items);
const coachOnlyNames = COACH_ONLY.map((c) => observerItems.find((it) => it.code === c)!.name);

const setLang = async (l: "en" | "ur") => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage(l); });
};

const openTray = async () => {
  render(<DcGuideTray open onClose={() => {}} />);
  await screen.findAllByTestId("dc-guide-card");
  return screen.getByTestId("dc-guide-tray");
};

/** Opens every card (examples are in the page too, folded), so the whole tray's text can be read. */
const openAll = (tray: HTMLElement) => {
  for (const card of within(tray).getAllByTestId("dc-guide-card")) {
    const head = card.querySelector("button[aria-expanded]") as HTMLButtonElement;
    if (head.getAttribute("aria-expanded") !== "true") fireEvent.click(head);
  }
};

beforeEach(async () => { await setLang("en"); });

describe("which report gets the teacher's '?'", () => {
  it("the stored rubric's label: FICO17 v6 and its minor versions; the id form too", () => {
    expect(isV6Rubric("FICO17 v6")).toBe(true);
    expect(isV6Rubric("FICO17 v6.1")).toBe(true);
    expect(isV6Rubric("fico17_v6")).toBe(true);
  });

  it("not V3, V4, FICO17 v5, FICO 6-12, FDE, or no rubric", () => {
    for (const r of ["FICO V3", "FICO V4", "FICO17 v5", "FICO 6-12", "FICO 6-12 v1.2", "FDE v1", "OECD", "", null, undefined]) {
      expect(isV6Rubric(r), String(r)).toBe(false);
    }
  });

  it("her own DC report only: a coach's visit (observation) is not hers; no detail yet is no '?'", () => {
    expect(showsDcGuide({ rubric: "FICO17 v6", observation: null })).toBe(true);
    expect(showsDcGuide({ rubric: "FICO17 v6", observation: { observerName: "A" } as never })).toBe(false);
    expect(showsDcGuide({ rubric: "FICO V3", observation: null })).toBe(false);
    expect(showsDcGuide(null)).toBe(false);
    expect(showsDcGuide(undefined)).toBe(false);
  });
});

describe("the tray: the 11 the Digital Coach scores, in her words", () => {
  it("her heading, a chip per code and one card per indicator: exactly the 11, by section", async () => {
    const tray = await openTray();
    expect(within(tray).getByRole("heading", { level: 2 }).textContent).toBe(E.heading);
    expect(within(tray).getAllByTestId("dc-guide-code").map((b) => b.textContent)).toEqual(DC11);
    expect(within(tray).getAllByTestId("dc-guide-card").map((c) => c.getAttribute("data-code"))).toEqual(DC11);
    expect(within(tray).getAllByRole("heading", { level: 3 }).map((h) => h.textContent?.slice(0, 1))).toEqual(["C", "D", "F"]);
  });

  it("none of C3 C5 C7 D2 D3 D4, by code or by name, with every card open", async () => {
    const tray = await openTray();
    openAll(tray);
    const text = tray.textContent || "";
    for (const c of COACH_ONLY) expect(text, c).not.toMatch(new RegExp(`\\b${c}\\b`));
    for (const n of coachOnlyNames) expect(text, n.en).not.toContain(n.en);
  });

  it("a card: her headings, the Digital Coach line, levels; never the observer's headings, manual links or 'No N/A here'", async () => {
    const tray = await openTray();
    openAll(tray);
    const c2 = within(tray).getAllByTestId("dc-guide-card").find((c) => c.getAttribute("data-code") === "C2")!;
    for (const w of [E.whoDc, E.measures, E.howScored, E.levels, E.watchOut]) expect(within(c2).getByText(w)).toBeTruthy();
    expect(within(c2).getAllByTestId("dc-guide-level")).toHaveLength(4);
    // C2's N/A is said once, in her words (no child was wrong); the other cards have none and say nothing about it.
    expect(within(c2).getByTestId("dc-guide-na").textContent).toContain("No child was wrong");
    const text = tray.textContent || "";
    for (const w of [HELP_COPY.howScored, HELP_COPY.watchOut, HELP_COPY.whoDc, HELP_COPY.noNa, HELP_COPY.fullManual, HELP_COPY.inManual]) {
      expect(text, w).not.toContain(w);
    }
    expect(tray.querySelectorAll("a")).toHaveLength(0);
  });

  it("a level with no example shows no 'Example'; one with an example keeps it, folded", async () => {
    const tray = await openTray();
    fireEvent.click(within(tray).getAllByTestId("dc-guide-code").find((b) => b.textContent === "C2")!);
    const c2 = within(tray).getAllByTestId("dc-guide-card").find((c) => c.getAttribute("data-code") === "C2")!;
    const [l1, l2] = within(c2).getAllByTestId("dc-guide-level");
    expect(within(l1).queryByText(E.example)).toBeNull();
    expect(within(l1).queryByTestId("dc-guide-example")).toBeNull();
    expect(within(l2).getByText(E.example)).toBeTruthy();
    expect(within(l2).getByTestId("dc-guide-example").hasAttribute("open")).toBe(false);
  });

  it("credit: adapted from Dr Rifat Yasmeen's guide (not 'designed and reviewed': she has not seen this version)", async () => {
    const tray = await openTray();
    expect(within(tray).getByTestId("dc-guide-credit").textContent).toBe(E.credit);
    expect(E.credit).toBe("Adapted from Dr Rifat Yasmeen's guide");
    expect(tray.textContent).not.toMatch(/Designed and reviewed/);
  });

  it("a code chip opens its card", async () => {
    const tray = await openTray();
    const chip = within(tray).getAllByTestId("dc-guide-code").find((b) => b.textContent === "F3")!;
    fireEvent.click(chip);
    const f3 = within(tray).getAllByTestId("dc-guide-card").find((c) => c.getAttribute("data-code") === "F3")!;
    expect(within(f3).getByRole("button", { expanded: true })).toBeTruthy();
    expect(chip.getAttribute("aria-pressed")).toBe("true");
  });

  it("the '?' is the help circle (40px in a 56px target) and opens the tray", async () => {
    render(<DcGuideButton />);
    const q = screen.getByTestId("dc-guide-button");
    expect(q.className).toContain("h-14");
    expect(q.className).toContain("w-14");
    expect(screen.queryByTestId("dc-guide-tray")).toBeNull();
    fireEvent.click(q);
    expect(await screen.findByTestId("dc-guide-tray")).toBeTruthy();
    expect((await screen.findAllByTestId("dc-guide-card")).length).toBe(11);
  });
});

describe("in Urdu", () => {
  it("the heading, credit, card headings and the guide's own Urdu; none of the English", async () => {
    await setLang("ur");
    const tray = await openTray();
    expect(within(tray).getByRole("heading", { level: 2 }).textContent).toBe(U.heading);
    expect(within(tray).getByTestId("dc-guide-credit").textContent).toBe(U.credit);
    fireEvent.click(within(tray).getAllByTestId("dc-guide-code").find((b) => b.textContent === "C2")!);
    const c2 = within(tray).getAllByTestId("dc-guide-card").find((c) => c.getAttribute("data-code") === "C2")!;
    const item = GUIDE.sections.flatMap((s) => s.items).find((it) => it.code === "C2")!;
    expect(within(c2).getByText(item.name.ur)).toBeTruthy();
    expect(within(c2).getByText(item.levels[2].text.ur)).toBeTruthy();
    for (const w of [U.whoDc, U.measures, U.howScored, U.watchOut]) expect(within(c2).getByText(w)).toBeTruthy();
    expect(within(c2).getAllByText(U.example)).toHaveLength(3);
    const text = tray.textContent || "";
    for (const w of [E.heading, E.credit, E.whoDc, E.measures, E.howScored, E.watchOut, item.name.en, item.levels[2].text.en]) {
      expect(text, w).not.toContain(w);
    }
    for (const n of coachOnlyNames) expect(text, n.ur).not.toContain(n.ur);
    expect(text).not.toContain(HELP_COPY_UR.noNa);
  });
});

describe("the data", () => {
  const items = GUIDE.sections.flatMap((s) => s.items);
  const urdu = JSON.stringify(GUIDE.sections, (k, v) => (k === "en" ? undefined : v));

  it("exactly the 11, levels 1-4; a level's example and why are both there or both null", () => {
    expect(items.map((it) => it.code)).toEqual(DC11);
    for (const it of items) {
      expect(it.levels.map((l) => l.n), it.code).toEqual([1, 2, 3, 4]);
      for (const l of it.levels) expect(l.example === null, `${it.code} L${l.n}`).toBe(l.why === null);
    }
    const blob = JSON.stringify(GUIDE);
    for (const c of COACH_ONLY) expect(blob, c).not.toMatch(new RegExp(`\\b${c}\\b`));
  });

  it("Urdu mechanics, as the vocabulary guard holds copy: no Devanagari, Western digits, Urdu letters, gender-neutral آپ, Latin only for FICO v6", () => {
    expect(urdu).not.toMatch(/[ऀ-ॿ]/);
    expect(urdu).not.toMatch(/[٠-٩۰-۹]/);
    expect(urdu).not.toMatch(/[يكهةى]/);
    const gendered = /آپ (?!کا|کی|کے)[^،۔"]*?(سکتے|سکتی|رہے|رہی|تھے|تھی|چکے|چکی|گئے|گئی)(\s|$|۔)/;
    const ur = items.flatMap((it) => [it.name, it.means, it.how, ...it.tips, ...it.levels.flatMap((l) => [l.text, l.example, l.why])])
      .filter(Boolean).map((t) => t!.ur);
    expect(ur.filter((s) => gendered.test(s))).toEqual([]);
    const latin = new Set(ur.flatMap((s) => s.match(/[A-Za-z][A-Za-z0-9/]*/g) ?? []));
    expect([...latin].filter((w) => !["FICO", "v6"].includes(w))).toEqual([]);
  });

  it("loads only when the tray opens: no static import of the data from the page or the tray", async () => {
    for (const src of [dcGuideSrc, guideSrc, reportPageSrc]) {
      expect(src).not.toMatch(/^import [^;]*['"][^'"]*fico_v6_dc\.guide(\.json)?['"]/m);
    }
    expect(guideSrc).toMatch(/import\(['"]\.\/fico_v6_dc\.guide['"]\)/);
    expect((await loadDcGuide()).sections).toHaveLength(3);
  });
});
