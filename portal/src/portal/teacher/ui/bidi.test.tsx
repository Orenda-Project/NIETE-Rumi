import { describe, it, expect, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-fmf24g.13 — mixed script on an Urdu page (language-protocol §8 rule 1). A numeric range or a Latin atom
 * inside RTL text is reordered by its surroundings — "1 – 8" shows as "8 – 1", "4-A" as "A-4" — so the kit
 * isolates every such run with LRI (U+2066) … PDI (U+2069) in its ONE text egress (its text slots), never at
 * a call site, and only on an Urdu page (an English page's text is untouched). The bot does the same in its
 * Urdu catalog (⁦{n}⁩).
 */

import { isolateRuns, LRI, PDI } from "./bidi";
import { ListRow } from "./ListRow";
import { HistoryRow } from "./HistoryRow";
import { StatusChip } from "./StatusChip";
import { GradeSubjectButton } from "./GradeSubjectButton";

const iso = (s: string) => `${LRI}${s}${PDI}`;

describe("isolateRuns", () => {
  it.each([
    ["صفحات 1 – 12", `صفحات ${iso("1 – 12")}`],
    ["جماعت 4-A · سائنس", `جماعت ${iso("4-A")} · سائنس`],
    ["p.1-12 · 9 اسباق", `${iso("p.1-12")} · ${iso("9")} اسباق`],
    ["~2 min", iso("~2 min")],
    ["General Science · جماعت 4", `${iso("General Science")} · جماعت ${iso("4")}`],
  ])("%s", (input, out) => {
    expect(isolateRuns(input)).toBe(out);
  });

  it("pure Urdu is untouched; nothing is isolated twice", () => {
    expect(isolateRuns("آپ کی کلاسیں")).toBe("آپ کی کلاسیں");
    expect(isolateRuns(isolateRuns("صفحات 1 – 12"))).toBe(isolateRuns("صفحات 1 – 12"));
  });
});

describe("the kit's text slots isolate on an Urdu page only", () => {
  beforeEach(async () => {
    if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  });

  const slots = () => render(
    <MemoryRouter>
      <ListRow prefix="Chap" number={1} label="Plants 1 – 2" subtitle="p.1-12 · 9 اسباق" to="/a" />
      <HistoryRow subject="Math" grade={4} title="Fractions 1/2" extra="Chap 3" to="/b" />
      <StatusChip text="~2 min" />
      <GradeSubjectButton grade={4} section="A" subject="Math" to="/c" />
    </MemoryRouter>,
  );

  it("Urdu page: ranges and Latin atoms isolated in label, subtitle, title, extra, chip, class name", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    const { container } = slots();
    const text = container.textContent || "";
    for (const run of ["Plants 1 – 2", "p.1-12", "Fractions 1/2", "Chap 3", "~2 min", "4-A"]) {
      expect(text).toContain(iso(run));
    }
  });

  it("English page: no isolates at all", async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
    const { container } = slots();
    expect(container.textContent).not.toMatch(/[⁦⁩]/);
  });
});
