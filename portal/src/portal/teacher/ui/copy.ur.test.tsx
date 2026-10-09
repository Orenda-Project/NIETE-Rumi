import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { collectCopy, copyProblem } from "../../newui/checks/rules";

/**
 * bd-fmf24g.13 — the teacher kit in Urdu. Its words (TEACHER_UI) are one bilingual module; every kit
 * component's defaults follow the page's language, and a screen's `copy` prop still wins.
 * Urdu is MACHINE-DRAFTED from the bot's existing Urdu (ux-strings.js, the hero report) — see the review
 * file in workbench/teacher-v2-impl/urdu-review/.
 */

import { TEACHER_UI, TEACHER_UI_COPY, TEACHER_UI_UR } from "./copy";
import { COPY_MODULES } from "../copyRegistry";
import { SUBJECT_SHORT } from "./subjects";
import { untranslated } from "../i18n";
import { HistoryList } from "./HistoryList";
import { DateRangeBar } from "./DateRangeBar";
import { ListRow } from "./ListRow";

/** Rightly the same in both languages. */
const SAME = ["noValue", "report.brand", "report.brandMark"];

beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("TEACHER_UI in Urdu", () => {
  it("every word has its Urdu — none empty, none still English", () => {
    expect(untranslated(TEACHER_UI, SAME)).toEqual([]);
  });

  it("every Urdu word is a label: at most 4 words, never a sentence (the report's footer as in English)", () => {
    const bad = collectCopy(TEACHER_UI_UR).filter((c) => copyProblem(c.text)).map((c) => `${c.path}: ${c.text}`);
    // The report's words mirror the hero PNG word for word (as the English footer is allowed to).
    // bd-4404s7.4: the strip's "Sending · 62%" is the ontology's passive "بھیجا جا رہا ہے" (4 words) plus the percent.
    const PNG_WORDS = ["report.madeFor", "report.eyebrow", "report.lastAsked", "notify.sending"];
    expect(bad.filter((x) => !PNG_WORDS.some((p) => x.startsWith(p)))).toEqual([]);
  });

  it("bd-fmf24g.16 — the history row lead: \"G4\" in English, the numeral alone in Urdu", () => {
    expect(TEACHER_UI_COPY.gradeShort(4)).toBe("G4");
    expect(TEACHER_UI_COPY.gradeShort(12)).toBe("G12");
    expect(TEACHER_UI_UR.gradeShort(4)).toBe("4");
  });

  it("bd-fmf24g.16 — the lead's Urdu subject short forms are registered (completeness check + review file)", () => {
    const entry = COPY_MODULES.find((m) => (m.module.en as { subjectShort?: unknown }).subjectShort);
    expect(entry?.screen).toMatch(/^kit/);
    const en = (entry!.module.en as { subjectShort: Record<string, string> }).subjectShort;
    const ur = (entry!.module.ur as { subjectShort: Record<string, string> }).subjectShort;
    expect(Object.keys(en)).toHaveLength(SUBJECT_SHORT.length);
    expect(en.pakistanStudies).toBe("Pak St");
    expect(ur.science).toBe("سائنس");
  });

  it("twelve Urdu months, January first", () => {
    expect(TEACHER_UI_UR.months).toHaveLength(12);
    expect(TEACHER_UI_UR.months[0]).toBe("جنوری");
  });
});

describe("kit components follow the page's language", () => {
  it("English page: English defaults", () => {
    render(<MemoryRouter><HistoryList heading="" groups={[]} /></MemoryRouter>);
    expect(screen.getByText("Nothing yet")).toBeTruthy();
  });

  it("Urdu page: Urdu defaults — the empty list, the date range, the Used chip", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    render(
      <MemoryRouter>
        <HistoryList heading="" groups={[]} />
        <DateRangeBar today="2026-10-08" />
        <ListRow label="A" state="used" to="/a" />
      </MemoryRouter>,
    );
    expect(screen.getByText(TEACHER_UI_UR.nothingYet)).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(TEACHER_UI_UR.presets.this_month) })).toBeTruthy();
    expect(screen.getByText(TEACHER_UI_UR.used)).toBeTruthy();
    expect(screen.queryByText("Nothing yet")).toBeNull();
  });

  it("a screen's own copy prop still wins", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    render(<MemoryRouter><HistoryList heading="" groups={[]} emptyLabel="خالی" /></MemoryRouter>);
    expect(screen.getByText("خالی")).toBeTruthy();
  });
});
