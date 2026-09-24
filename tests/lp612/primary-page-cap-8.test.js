/**
 * bd-blxml — THE PRIMARY TEACH CAP IS 8, IN BOTH LANGUAGES, AND WARN IS THE LAST SHEET.
 *
 * SUPERSEDES bd-jr91a (16 / 24). Operator, 2026-09-24, asked to choose between
 *   (a) raise the cap for the 40 over-8 lessons only,
 *   (b) re-segment those 40 into more, shorter lessons,
 *   (c) hold 8 as a target for the compliant 88% and accept the 40,
 * she answered **"a"**. A per-lesson exemption is therefore the ONLY way over 8, and it is
 * covered next door in primary-page-cap-exemptions.test.js. This file covers the cap itself.
 *
 * WHY THE CAP HAD TO COME DOWN. Her standing rules are *"I want lower, we cant go beyond 8, its
 * too much to read and remember!"* and *"22-24 pages no teacher will read ... ever"*. A hard cap
 * of 24 is the literal opposite of the second sentence: it is not a cap she would recognise as
 * one. Ruling (a) is "raise the cap for THOSE", which presupposes a cap the rest are held to.
 *
 * THE CAP IS NOT LANGUAGE-QUALIFIED. She said "8", not "8 unless it is Urdu". Urdu's measured
 * ~1.5x Nastaliq premium is real, and it is absorbed by the exemption list — 23 of the 88 Urdu
 * lessons are over 8 against 2 of 112 English — NOT by a higher global Urdu cap. A 12-page Urdu
 * cap would be a licence nobody granted, handed to every Urdu lesson ever authored, including the
 * ones that fit in 5 today.
 *
 * MEASURED BASELINE, 335 built PDFs, pre-rebuild, `pages_by_part.teach` read off
 * `renders/<chapter>/<stem>.render.json` at the default (phone) format:
 *
 *   3p:1  4p:15  5p:55  6p:92  7p:98  8p:34 | 9p:19 10p:7 11p:7 12p:1 13p:1 14p:1 15p:2 18p:1 21p:1
 *
 * 295/335 (88.1%) already meet <=8. 40 exceed it.
 */

const R = require('../../bot/vendor/lp-v9/render_lp.js');
const { PAGE_FORMATS } = require('../../bot/vendor/lp-v9/lib/template.js');

const primary = { provenance: { grade: 4 } };
const secondary = { provenance: { grade: 9 } };

const box = (f) => PAGE_FORMATS[f].h - PAGE_FORMATS[f].padT - PAGE_FORMATS[f].padB;
const RATIO = box('phone') / box('a4');

// The measured corpus, as a histogram of teach pages -> lesson count. Every claim about what a
// number MEANS is asserted against this rather than against an adjective.
const CORPUS = { 3: 1, 4: 15, 5: 55, 6: 92, 7: 98, 8: 34, 9: 19, 10: 7, 11: 7, 12: 1, 13: 1, 14: 1, 15: 2, 18: 1, 21: 1 };
const TOTAL = Object.values(CORPUS).reduce((a, b) => a + b, 0);
const firesOn = (threshold) =>
  Object.entries(CORPUS).reduce((n, [pages, count]) => (Number(pages) > threshold ? n + count : n), 0);

describe('the corpus histogram this suite reasons from is the one that was measured', () => {
  test('it is the full 335-PDF census', () => {
    expect(TOTAL).toBe(335);
  });

  test('295 of 335 (88.1%) already meet 8 pages, 40 do not', () => {
    expect(TOTAL - firesOn(8)).toBe(295);
    expect(firesOn(8)).toBe(40);
  });
});

describe('the primary teach cap is 8, and it is the same 8 in both languages', () => {
  test('English teach is 8', () => {
    expect(R.pageCapsFor('en', primary).max.teach).toBe(8);
  });

  test('Urdu teach is 8 too — the ruling was not language-qualified', () => {
    expect(R.pageCapsFor('ur', primary).max.teach).toBe(8);
  });

  test('the two constants are the SAME number, not two numbers that happen to agree today', () => {
    // If someone lowers EN to 6 and leaves UR at 8, Urdu silently regains a 2-sheet licence.
    expect(R.MAX_PAGES_PRIMARY_UR.teach).toBe(R.MAX_PAGES_PRIMARY.teach);
    expect(R.MAX_PAGES_PRIMARY.teach).toBe(8);
  });

  test('the phone sheet carries the cap unscaled — it is the sheet it was measured on', () => {
    expect(R.pageCapsFor('en', primary, 'phone').max).toEqual({ teach: 8, support: 3 });
    expect(R.pageCapsFor('ur', primary, 'phone').max).toEqual({ teach: 8, support: 4 });
    // No format argument must mean the same thing as `phone`: that is the reading the corpus was
    // rendered at and the reading the author's budget card uses.
    expect(R.pageCapsFor('en', primary).max).toEqual({ teach: 8, support: 3 });
    expect(R.pageCapsFor('ur', primary).max).toEqual({ teach: 8, support: 4 });
  });

  test('support did NOT move — 0 of the 335 renders built a single support page', () => {
    // Nothing was measured there, so nothing there is touched. Raising or lowering an untested
    // cap only gives content somewhere to hide.
    expect(R.MAX_PAGES_PRIMARY.support).toBe(3);
    expect(R.MAX_PAGES_PRIMARY_UR.support).toBe(4);
  });
});

describe('WARN says something again: it is the last sheet before the cap', () => {
  /**
   * At teach 4 against a cap of 16, WARN fired on 319 of 335 lessons — 95.2% of the corpus. A
   * signal that fires on 95% of everything is not a signal, it is a letterhead. That 4 was an
   * authored phone-first TARGET (operator, 2026-09-18: *"ideally 4-5 pages on phone-first"*) set
   * when MAX was 9 and she wanted the aim lower than the ceiling. The 2026-09-24 ruling puts the
   * ceiling AT the number she will tolerate, so the useful thing left to say is "this is your
   * last sheet" — which is what WARN means everywhere else in render_lp.js.
   */
  test('the old target fired on 95.2% of the corpus', () => {
    expect(firesOn(4)).toBe(319);
    expect(firesOn(4) / TOTAL).toBeGreaterThan(0.95);
  });

  test('WARN is now 7 in both languages — one sheet under the cap', () => {
    expect(R.pageCapsFor('en', primary, 'phone').warn.teach).toBe(7);
    expect(R.pageCapsFor('ur', primary, 'phone').warn.teach).toBe(7);
  });

  test('WARN is derived from the cap, so the two cannot drift apart again', () => {
    for (const lang of ['en', 'ur']) {
      const { max, warn } = R.pageCapsFor(lang, primary, 'phone');
      expect(warn.teach).toBe(max.teach - 1);
    }
  });

  test('at 7 it fires on 74 of 335 (22.1%) — a fifth of the corpus, not all of it', () => {
    expect(firesOn(7)).toBe(74);
    expect(firesOn(7) / TOTAL).toBeLessThan(0.25);
    expect(firesOn(7)).toBeLessThan(firesOn(4) / 4);
  });

  test('the target never overtakes the cap it sits under, on any sheet', () => {
    for (const lang of ['en', 'ur']) {
      for (const format of ['phone', 'a4', 'billboard']) {
        const { max, warn } = R.pageCapsFor(lang, primary, format);
        expect(warn.teach).toBeLessThanOrEqual(max.teach);
        expect(warn.support).toBeLessThanOrEqual(max.support);
      }
    }
  });
});

describe('over 8 still FAILS, because nothing is ever trimmed to fit', () => {
  const gateRejects = (lang, n) => n > R.pageCapsFor(lang, primary).max.teach;

  test('8 teach pages is ACCEPTED, 9 is REJECTED, in both languages', () => {
    for (const lang of ['en', 'ur']) {
      expect(gateRejects(lang, 8)).toBe(false);
      expect(gateRejects(lang, 9)).toBe(true);
    }
  });

  test('every one of the 40 over-8 lessons is rejected by the bare cap', () => {
    // They pass only via a named exemption — see primary-page-cap-exemptions.test.js.
    for (const [pages, count] of Object.entries(CORPUS)) {
      if (Number(pages) > 8 && count > 0) expect(gateRejects('en', Number(pages))).toBe(true);
    }
  });

  test('the rejection is a PAGE COUNT defect quoting the cap, and offers no trim', () => {
    const cap = R.pageCapsFor('en', primary).max.teach;
    expect(R.overCapProblem('teach', 9, cap, null)).toBe(
      'PAGE COUNT: teach needs 9 pages; the cap is 8. Cut it, or move content to the other part.',
    );
  });
});

describe('G6-12 is untouched by a G1-5 ruling', () => {
  test('secondary caps are unmoved on every sheet', () => {
    for (const format of ['phone', 'a4', undefined]) {
      expect(R.pageCapsFor('en', secondary, format).max).toEqual({ teach: 4, support: 3 });
      expect(R.pageCapsFor('ur', secondary, format).max).toEqual({ teach: 5, support: 4 });
    }
    expect(R.MAX_PAGES).toEqual({ teach: 4, support: 3 });
    expect(R.MAX_PAGES_UR).toEqual({ teach: 5, support: 4 });
  });

  test('secondary WARN is still exactly one sheet under its cap', () => {
    for (const lang of ['en', 'ur']) {
      const { max, warn } = R.pageCapsFor(lang, secondary);
      expect(warn).toEqual({ teach: max.teach - 1, support: max.support - 1 });
    }
  });
});

describe('the format conversion still holds at the new cap', () => {
  test('A4 carries the SAME budget, converted by what an A4 sheet holds', () => {
    expect(R.pageCapsFor('en', primary, 'a4').max).toEqual({
      teach: Math.round(8 * RATIO), support: Math.round(3 * RATIO),
    });
    expect(R.pageCapsFor('ur', primary, 'a4').max).toEqual({
      teach: Math.round(8 * RATIO), support: Math.round(4 * RATIO),
    });
  });

  test('the A4 warn converts on the same geometry the cap does, and stays clamped', () => {
    const scale = (n) => Math.max(1, Math.round(n * RATIO));
    const { max, warn } = R.pageCapsFor('en', primary, 'a4');
    expect(warn.teach).toBe(Math.min(scale(7), max.teach));
    expect(warn.support).toBe(Math.min(scale(1), max.support));
  });

  test('an unknown format still falls back to the measured sheet rather than inventing a cap', () => {
    expect(R.pageCapsFor('en', primary, 'billboard').max).toEqual({ teach: 8, support: 3 });
    expect(R.pageCapsFor('ur', primary, 'billboard').max).toEqual({ teach: 8, support: 4 });
  });
});
