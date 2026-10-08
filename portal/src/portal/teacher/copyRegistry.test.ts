import { describe, it, expect } from "vitest";
import { collectCopy, copyProblem } from "../newui/checks/rules";
import { COPY_MODULES } from "./copyRegistry";
import { untranslated } from "./i18n";

/**
 * bd-fmf24g.13 — every bilingual teacher v2 copy module: Urdu complete (none empty, none still English —
 * no silent English fallback, language-protocol §6.3) and every Urdu value a label (≤4 words, never a
 * sentence), as the English already is.
 */
describe.each(COPY_MODULES.map((m) => [m.screen, m] as const))("%s", (_screen, m) => {
  it("Urdu is complete", () => {
    expect(untranslated(m.module, m.same ?? [])).toEqual([]);
  });

  it("every Urdu value is a label", () => {
    const bad = collectCopy(m.module.ur)
      .filter((c) => copyProblem(c.text))
      .filter((c) => !(m.longOk ?? []).some((p) => c.path.startsWith(p)))
      .map((c) => `${c.path}: ${c.text}`);
    expect(bad).toEqual([]);
  });
});
