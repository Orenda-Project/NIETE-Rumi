import { describe, expect, it } from "vitest";
import { COPY, type CopyKey } from "../copy";

/**
 * COPY.md §6, the lint, run over every string of the coach deck (copy.ts). The same rules as contracts/lint_copy.py
 * (c-library's script; red-2 re-runs it on the built bundle's innerText); a string that fails here never ships.
 */
const ENTRIES = Object.entries(COPY) as [CopyKey, { en: string; ur: string }][];
const RM_KEYS = /^(s8|s9|s10|nav\.rm)\./;

// "her" added: contracts/lint_copy.py omits it (posted TO c-library).
const EN_PRONOUN = /\b(he|she|his|her|hers|him|himself|herself)\b/i;
const AMERICAN = /\b(color|colors|center|centers|behavior|favorite|practicing|practiced|organiz\w+|recogniz\w+|analyz\w+|emphasiz\w+|realiz\w+|prioritiz\w+|summariz\w+|math|program)\b/;
const AI_TELL = /\b(delve|delving|journey|unlock|landscape|tapestry|leverage|seamless|robust|crucial|vibrant|elevate|empower|foster|navigate|testament|realm|game.changer|it is important to note|in today's)\b/i;
const EM_DASH = /—|(?<=\S) – (?=\S)|(?<=\w)–(?=\w)/;
const ARABIC_INDIC = /[٠-٩]/;
const DOT_BY_URDU_DIGIT = /[۰-۹] ?·|· ?[۰-۹]/;
const COACH_WORDS = /\b(weakness|weaknesses|flagged|RED|template|slot|fixture|server|grader)\b/;
const COACH_WORDS_UR = /(کمزوری|ٹیمپلیٹ|سرور|فکسچر)/;
const UR_PERSON = "(استاد|کوچ|آر ایم|بچہ|بچی|ٹیچر|معلم|معلمہ|والد|والدہ|ماں|باپ)";
const UR_SING_VERB = new RegExp(`${UR_PERSON}(?:(?!کہ | اور | جب | جو )[^۔«»]){0,80}?\\S+(تا|تی) (ہے|تھا|تھی)(?=\\s|$|[۔،])`);
const UR_HON_VERB = /(استاد|کوچ|آر ایم|بچہ|بچی|ٹیچر|معلم|معلمہ)(?:(?!کہ | اور | جب | جو )[^۔«»]){0,60}?\S+تے (ہیں|تھے)(?=\s|$|[۔،])/;
const WEEKDAY_DATE = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\.? \d{1,2}\b|\b\d{1,2} (Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\b|(پیر|منگل|بدھ|جمعرات|جمعہ|ہفتہ|اتوار) [۰-۹]{1,2}(?![۰-۹])/;
/**
 * Known, reasoned exceptions (each posted on the board, COPY wins until the lead changes it):
 *   s2.method.current_school  "…گنی جاتی ہے": the verb agrees with ریکارڈنگ (a recording), not with استاد; a false hit.
 *   chip.worked               "کام کر گیا" is three Urdu words against the ≤ 2 rule; COPY v1 is binding, asked of the lead.
 */
const UR_AGREEMENT_FALSE_HITS: readonly string[] = ["s2.method.current_school"];
const CHIP_OVER_TWO_WORDS_ASKED: readonly string[] = ["chip.worked"];
const TOKENS = (s: string) => Array.from(s.matchAll(/\{[a-z0-9_:]+\}/g), (m) => m[0]).sort();
const cp = (s: string) => [...s].length;

describe("COPY §6 lint over the coach deck", () => {
  it("has the deck (every coach section)", () => {
    expect(ENTRIES.length).toBeGreaterThan(200);
    for (const k of ["s1.where", "s2.step.set", "s3.too_few", "l.base", "s5.check.rule.14", "s6.marker", "s7.filling", "trust.coach"] as CopyKey[]) {
      expect(COPY[k]).toBeDefined();
    }
  });

  it("rule 7: every key has both languages and every {token} in English is in Urdu", () => {
    const bad = ENTRIES.filter(([, v]) => !v.en.trim() || !v.ur.trim() || TOKENS(v.en).join() !== TOKENS(v.ur).join());
    expect(bad.map(([k]) => k)).toEqual([]);
  });

  it("rule 1: no pronoun for a person; no Urdu verb agreeing with a person", () => {
    const en = ENTRIES.filter(([, v]) => EN_PRONOUN.test(v.en)).map(([k]) => k);
    const ur = ENTRIES.filter(([k]) => !UR_AGREEMENT_FALSE_HITS.includes(k)).filter(([, v]) => {
      const body = v.ur.replace(/«[^»]*»|"[^"]*"/g, "«»");
      return UR_SING_VERB.test(body) || UR_HON_VERB.test(body) || /انہوں نے/.test(body);
    }).map(([k]) => k);
    expect({ en, ur }).toEqual({ en: [], ur: [] });
  });

  it("rule 2: British spelling, no em or en dash, no AI tell", () => {
    const bad = ENTRIES.filter(([, v]) => AMERICAN.test(v.en) || AI_TELL.test(v.en) || EM_DASH.test(v.en) || EM_DASH.test(v.ur));
    expect(bad.map(([k]) => k)).toEqual([]);
  });

  it("rule 3: no Arabic-Indic digit; no middle dot beside an Urdu digit", () => {
    const bad = ENTRIES.filter(([, v]) => ARABIC_INDIC.test(v.ur) || ARABIC_INDIC.test(v.en) || DOT_BY_URDU_DIGIT.test(v.ur));
    expect(bad.map(([k]) => k)).toEqual([]);
  });

  it("rule 4: no 'weakness', 'flagged', 'RED', 'template', 'slot', 'fixture', 'server', bare 'grader' on a coach screen", () => {
    // {grader} and {grader_label} are tokens (the model id / the label), not the bare word.
    const bad = ENTRIES.filter(([k, v]) => !RM_KEYS.test(k)
      && (COACH_WORDS.test(v.en.replace(/\{[a-z_]+\}/g, "")) || COACH_WORDS_UR.test(v.ur)));
    expect(bad.map(([k]) => k)).toEqual([]);
  });

  it("rule 5: lengths in code points (buttons ≤ 24 EN; chips ≤ 2 Urdu words)", () => {
    const buttons: CopyKey[] = ["s1.listen", "s1.see_move", "s1.note.open", "s1.note.dismiss", "s2.step.full", "s4.see_move", "s5.tick.yes", "s5.tick.no"];
    const longButtons = buttons.filter((k) => cp(COPY[k].en.replace(/\{[a-z_]+\}/g, "0:38")) > 24);
    const chips: CopyKey[] = ["chip.worked", "chip.not_yet", "s4.chapter.warm", "s4.chapter.explain", "s4.chapter.guided", "s4.chapter.practice", "s4.chapter.exit", "l.filter.all", "s6.pill.same"];
    const longChips = chips.filter((k) => !CHIP_OVER_TWO_WORDS_ASKED.includes(k)).filter((k) => COPY[k].ur.trim().split(/\s+/).length > 2);
    expect({ longButtons, longChips }).toEqual({ longButtons: [], longChips: [] });
  });

  it("rule 6: no typed weekday beside a date", () => {
    const bad = ENTRIES.filter(([, v]) => WEEKDAY_DATE.test(v.en) || WEEKDAY_DATE.test(v.ur));
    expect(bad.map(([k]) => k)).toEqual([]);
  });

  it("the lint itself fires (a seeded bad string fails every rule it should)", () => {
    expect(EN_PRONOUN.test("Ask her to read")).toBe(true);
    expect(AMERICAN.test("the color chart")).toBe(true);
    expect(EM_DASH.test("one — two")).toBe(true);
    expect(ARABIC_INDIC.test("٣")).toBe(true);
    expect(DOT_BY_URDU_DIGIT.test("۳ · اسباق")).toBe(true);
    expect(UR_SING_VERB.test("استاد سبق پڑھتا ہے")).toBe(true);
    expect(WEEKDAY_DATE.test("Wed 28 Oct")).toBe(true);
    expect(COACH_WORDS.test("the weakness")).toBe(true);
  });
});
