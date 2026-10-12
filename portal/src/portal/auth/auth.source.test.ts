import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { newUiSourceFiles, scanCopy, scanStyle } from "../newui/checks/source";
import { COPY_MODULES } from "../teacher/copyRegistry";
import { untranslated } from "../teacher/i18n";
import { collectCopy, copyProblem } from "../newui/checks/rules";
import { AUTH, COPY_ENTRY } from "./copy";

/**
 * bd-fmf24g.64 — the auth pages hold to the new UI's own checks: no words written into JSX, no raw colours, logical
 * (start/end) spacing, motion only under motion-safe; and their words are a registered, complete, label-only module.
 */
const files = newUiSourceFiles(resolve(__dirname));

describe("auth source keeps the design rules", () => {
  it("there is source to check", () => {
    expect(files.map((f) => f.rel)).toEqual(expect.arrayContaining(["AuthFrame.tsx", "AuthField.tsx", "CodeSlots.tsx", "copy.ts"]));
  });
  it.each(files.map((f) => [f.rel, f.text]))("%s: words come from copy.ts", (rel, text) => {
    expect(scanCopy(rel as string, text as string)).toEqual([]);
  });
  it.each(files.map((f) => [f.rel, f.text]))("%s: colour tokens, logical spacing, motion-safe", (rel, text) => {
    expect(scanStyle(rel as string, text as string)).toEqual([]);
  });
});

describe("auth copy", () => {
  it("is registered, so its Urdu reaches the native-review queue", () => {
    expect(COPY_MODULES).toContain(COPY_ENTRY);
  });
  it("every Urdu value is filled in and differs from the English (except the listed brand and number hint)", () => {
    expect(untranslated(AUTH, COPY_ENTRY.same ?? [])).toEqual([]);
  });
  it("every English and Urdu value is a label: 1-4 words, never a sentence", () => {
    for (const side of [AUTH.en, AUTH.ur]) {
      const bad = collectCopy(side).filter((c) => copyProblem(c.text)).filter((c) => !(COPY_ENTRY.longOk ?? []).some((p) => c.path.startsWith(p))).map((c) => `${c.path}: ${c.text}`);
      expect(bad).toEqual([]);
    }
  });
});
