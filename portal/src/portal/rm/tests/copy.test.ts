import { describe, expect, it } from "vitest";
import { RM_COPY, type RmCopyKey } from "../rm.copy";

/**
 * COPY.md §6, the lint, over every string of the RM deck (rm.copy.ts) — m-ui's TS port of contracts/lint_copy.py, with
 * "her" (lint_copy.py omits it). "weakness" is allowed here: COPY §0 rule 7 reserves it for the RM pages.
 */
const ENTRIES = Object.entries(RM_COPY) as [RmCopyKey, { en: string; ur: string }][];
const EN_PRONOUN = /\b(he|she|his|her|hers|him|himself|herself)\b/i;
const AMERICAN = /\b(color|colors|center|centers|behavior|favorite|practicing|practiced|organiz\w+|recogniz\w+|analyz\w+|emphasiz\w+|realiz\w+|prioritiz\w+|summariz\w+|math|program)\b/;
const AI_TELL = /\b(delve|delving|journey|unlock|landscape|tapestry|leverage|seamless|robust|crucial|vibrant|elevate|empower|foster|navigate|testament|realm|game.changer|it is important to note|in today's)\b/i;
const EM_DASH = /—|(?<=\S) – (?=\S)|(?<=\w)–(?=\w)/;
const ARABIC_INDIC = /[٠-٩]/;
const DOT_BY_URDU_DIGIT = /[۰-۹] ?·|· ?[۰-۹]/;
const UR_PERSON = "(استاد|کوچ|آر ایم|بچہ|بچی|ٹیچر|معلم|معلمہ|والد|والدہ|ماں|باپ)";
const UR_SING_VERB = new RegExp(`${UR_PERSON}(?:(?!کہ | اور | جب | جو )[^۔«»]){0,80}?\\S+(تا|تی) (ہے|تھا|تھی)(?=\\s|$|[۔،])`);
const UR_HON_VERB = /(استاد|کوچ|آر ایم|بچہ|بچی|ٹیچر|معلم|معلمہ)(?:(?!کہ | اور | جب | جو )[^۔«»]){0,60}?\S+تے (ہیں|تھے)(?=\s|$|[۔،])/;
// a future or perfective verb agreeing with a person ("کوچ … پڑھیں گے", "کوچ … آیا"): the polite imperative alone passes
const UR_GENDERED_FUTURE = new RegExp(`${UR_PERSON}(?:(?!کہ | اور | جب | جو )[^۔«»]){0,40}?\\S+ (گا|گی|گے)(?=\\s|$|[۔،])`);
const WEEKDAY_DATE = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\.? \d{1,2}\b|\b\d{1,2} (Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\b|(پیر|منگل|بدھ|جمعرات|جمعہ|ہفتہ|اتوار) [۰-۹]{1,2}(?![۰-۹])/;
const TOKENS = (s: string) => Array.from(s.matchAll(/\{[a-z0-9_:]+\}/g), (m) => m[0]).sort();
const cp = (s: string) => [...s].length;

describe("COPY §6 lint over the RM deck", () => {
  it("has S8, S9, S10, RM-T and the picker", () => {
    for (const k of ["s8.opening", "s8.trust", "s9.steps.row", "s10.moments.row", "rmt.RM-T2.l1", "picker.send", "e.503_clip.rm"] as RmCopyKey[]) {
      expect(RM_COPY[k]).toBeDefined();
    }
  });
  it("rule 7: both languages, same tokens", () => {
    expect(ENTRIES.filter(([, v]) => !v.en.trim() || !v.ur.trim() || TOKENS(v.en).join() !== TOKENS(v.ur).join()).map(([k]) => k)).toEqual([]);
  });
  it("rule 1: no pronoun for a person; no Urdu verb agreeing with a person", () => {
    const en = ENTRIES.filter(([, v]) => EN_PRONOUN.test(v.en)).map(([k]) => k);
    const ur = ENTRIES.filter(([, v]) => {
      const body = v.ur.replace(/«[^»]*»|"[^"]*"/g, "«»");
      return UR_SING_VERB.test(body) || UR_HON_VERB.test(body) || UR_GENDERED_FUTURE.test(body) || /انہوں نے/.test(body);
    }).map(([k]) => k);
    expect({ en, ur }).toEqual({ en: [], ur: [] });
  });
  it("rule 2: British spelling, no em or en dash, no AI tell", () => {
    expect(ENTRIES.filter(([, v]) => AMERICAN.test(v.en) || AI_TELL.test(v.en) || EM_DASH.test(v.en) || EM_DASH.test(v.ur)).map(([k]) => k)).toEqual([]);
  });
  it("rule 3: no Arabic-Indic digit; no middle dot beside an Urdu digit", () => {
    expect(ENTRIES.filter(([, v]) => ARABIC_INDIC.test(v.ur) || ARABIC_INDIC.test(v.en) || DOT_BY_URDU_DIGIT.test(v.ur)).map(([k]) => k)).toEqual([]);
  });
  it("rule 5: buttons ≤ 24 code points in English", () => {
    const buttons: RmCopyKey[] = ["s8.follow_up", "s10.sector_moves.set", "picker.send", "picker.cancel"];
    expect(buttons.filter((k) => cp(RM_COPY[k].en) > 24)).toEqual([]);
  });
  it("rule 6: no typed weekday beside a date", () => {
    expect(ENTRIES.filter(([, v]) => WEEKDAY_DATE.test(v.en) || WEEKDAY_DATE.test(v.ur)).map(([k]) => k)).toEqual([]);
  });
  it("the lint fires on seeded bad strings", () => {
    expect(EN_PRONOUN.test("Ask her to read")).toBe(true);
    expect(UR_GENDERED_FUTURE.test("کوچ یہ پڑھیں گے")).toBe(true);
    expect(UR_SING_VERB.test("کوچ سبق پڑھتا ہے")).toBe(true);
    expect(DOT_BY_URDU_DIGIT.test("۳ · اسباق")).toBe(true);
  });
});
