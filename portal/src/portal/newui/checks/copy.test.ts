import { describe, it, expect } from "vitest";
import * as copyModule from "../copy";
import { collectCopy, COPY_ALLOWLIST, copyProblem, MAX_WORDS } from "./rules";
import { newUiSourceFiles, scanCopy } from "./source";

/**
 * bd-5rz1v.19 — CHECK 1: no sentences anywhere in the new UI (DESIGN.md rule 1–2).
 *
 * The design that makes this checkable: every word the new UI shows lives in ONE object,
 * newui/copy.ts (also what the Urdu work translates). So the check is two halves:
 *   1. every string in copy.ts is a label — at most MAX_WORDS words, never ending like a
 *      sentence (. ? ! or the Urdu ۔ ؟);
 *   2. the new UI's source has no words of its own — no JSX text, no string-literal children —
 *      and any string-literal label prop (title, label, aria-label, alt, placeholder, crumb…)
 *      still passes the rule.
 * Data (a lesson's title, her name) is not copy and is not linted.
 */

describe("the rule: a label, never a sentence", () => {
  it.each([
    "Home", "Lesson plans used", "Coaching & observations", "Training modules done", "Last 3 months",
    "Salaam, Hataf", "—", "Preparing…", "اس مہینے", "p.18–20", "Training · NIETE · Level 2",
  ])("passes %j", (s) => {
    expect(copyProblem(s)).toBeNull();
  });

  it.each([
    ["Browse the curriculum library by class", /6 words/],
    ["Choose a grade.", /sentence/],
    ["Ready?", /sentence/],
    ["Try again!", /sentence/],
    ["کیا آپ تیار ہیں؟", /sentence/],
    ["ٹھیک ہے۔", /sentence/],
  ])("fails %j", (s, why) => {
    expect(copyProblem(s)).toMatch(why);
  });

  it("allows at most 4 words; the allowlist is short, and every entry says why", () => {
    expect(MAX_WORDS).toBe(4);
    expect(COPY_ALLOWLIST.length).toBeLessThanOrEqual(5);
    for (const entry of COPY_ALLOWLIST) expect(entry.why.length).toBeGreaterThan(10);
  });
});

describe("copy.ts — every word the new UI shows", () => {
  const entries = collectCopy(copyModule as unknown as Record<string, unknown>);

  it("is collected whole — a function contributes what it returns, so a counted label is linted too", () => {
    expect(entries.length).toBeGreaterThan(10);
    const fixture = collectCopy({ a: "Home", f: (n: number) => `${n} plans`, list: ["Jan"] });
    expect(fixture.map((e) => e.path)).toEqual(["a", "f()", "f(1)", "f(12)", 'f("Ayesha")', "list[0]"]);
    expect(fixture.find((e) => e.path === "f(12)")?.text).toBe("12 plans");
  });

  it.each(entries.map((e) => [e.path, e.text]))("%s = %j is a label", (_path, text) => {
    expect(copyProblem(text as string)).toBeNull();
  });
});

describe("the new UI's source takes its words from copy.ts", () => {
  const files = newUiSourceFiles();

  it("scans the kit (and every screen added under newui/)", () => {
    const names = files.map((f) => f.rel);
    expect(names).toEqual(expect.arrayContaining(["MainHeading.tsx", "InnerBar.tsx", "List.tsx", "BottomButton.tsx", "NewUiNavigation.tsx"]));
    expect(names.some((n) => /\.test\./.test(n))).toBe(false);
    expect(names).not.toContain("tokens.ts");
  });

  it.each(files.map((f) => [f.rel, f.text]))("%s", (rel, text) => {
    expect(scanCopy(rel as string, text as string)).toEqual([]);
  });

  it("catches what it is for (planted violations)", () => {
    const planted = [
      "const X = ({ ok }) => (",
      '  <div title="Tap here to open your lesson plan">',
      "    <span>Open lesson</span>{'Hello'}{ok ? 'Yes' : 'No.'}",
      '    <Row label="Choose a grade." aria-label={`Go`} />',
      "  </div>",
      ");",
      "const items = [{ title: 'This is a very long title' }, { title: 'Fine' }];",
    ].join("\n");
    const found = scanCopy("planted.tsx", planted).map((p) => p.text);
    expect(found).toEqual(expect.arrayContaining([
      "Tap here to open your lesson plan", "Open lesson", "Hello", "Yes", "No.", "Choose a grade.", "This is a very long title",
    ]));
    expect(found).not.toContain("Fine");
    expect(found).not.toContain("Go");
  });

  it("leaves code alone: class names, ids, routes, test ids", () => {
    const fine = [
      "const Y = () => <a href=\"/portal/dashboard\" data-testid=\"newui-row\" className=\"flex min-h-[56px] items-center gap-3 px-3 py-2.5 text-start\" />;",
      "const k = { key: 'this_month', to: '/portal/x', icon: 'book' };",
    ].join("\n");
    expect(scanCopy("fine.tsx", fine)).toEqual([]);
  });
});
