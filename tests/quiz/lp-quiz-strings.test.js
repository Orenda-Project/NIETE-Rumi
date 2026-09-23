'use strict';
/**
 * R8 lane D task 3.6 — the failure copy of a quiz born of a LESSON PLAN.
 *
 * `tqCouldNotMake` says "this lesson's recording" and "the transcript didn't
 * carry enough". Sent to a teacher who never recorded anything — whose quiz was
 * to be written from the lesson plan they were served at 15:00 — it names a state
 * that does not exist, and every field report it produces sends the next
 * engineer at the wrong layer (root CLAUDE.md rule 24d).
 *
 * So the LP path gets its own three reasons, each naming what actually went
 * wrong: the plan could not be opened, it could not be read, the questions did
 * not come out.
 */
const { UX_STRINGS, resolveUx } = require('../../bot/shared/config/ux-strings');
const { LANGUAGE_OFFER } = require('../../bot/shared/config/languages');
const { genderedTeacherForms } = require('../../bot/shared/services/quiz/transcript-quiz-pedagogy');

const LP_KEYS = ['tqFailedLpSource', 'tqFailedLpDigest', 'tqFailedLpAuthor', 'tqFailedLpKeyConflict', 'tqFlowResultsFailedLp'];
const cp = (s) => [...String(s)].length;

describe('LP-born quiz failure copy', () => {
  test.each(LP_KEYS)('%s exists in every offered language', (key) => {
    expect(UX_STRINGS[key]).toBeDefined();
    for (const lang of LANGUAGE_OFFER) {
      expect(typeof UX_STRINGS[key][lang]).toBe('string');
      expect(UX_STRINGS[key][lang].trim().length).toBeGreaterThan(0);
    }
  });

  test.each(LP_KEYS)('%s names the lesson plan, never a recording or a transcript', (key) => {
    for (const lang of LANGUAGE_OFFER) {
      const s = UX_STRINGS[key][lang];
      expect(s.toLowerCase()).toContain('lesson plan');
      expect(s.toLowerCase()).not.toMatch(/recording|transcript/);
      // Urdu has its own words for both, and they are just as wrong here.
      expect(s).not.toMatch(/ریکارڈنگ|آواز کی فائل/);
    }
  });

  test.each(LP_KEYS)('%s is gender-neutral about the teacher, in both languages', (key) => {
    for (const lang of LANGUAGE_OFFER) {
      const s = UX_STRINGS[key][lang];
      expect(s).not.toMatch(/\b(she|her|hers|herself|he|him|his|himself)\b/i);
      expect(genderedTeacherForms(s, lang)).toEqual([]);
    }
  });

  test.each(LP_KEYS)('%s fits a WhatsApp body and takes no parameters', (key) => {
    for (const lang of LANGUAGE_OFFER) {
      expect(cp(UX_STRINGS[key][lang])).toBeLessThanOrEqual(1024);
      // resolveUx throws on a missing param, so this also proves the copy has
      // no {placeholder} the failure path would have to fill.
      expect(() => resolveUx(key, { language: lang })).not.toThrow();
    }
  });

  test('the three say three DIFFERENT things — one shared fallback is what misdirected the last fix cycle', () => {
    for (const lang of LANGUAGE_OFFER) {
      const texts = LP_KEYS.map((k) => UX_STRINGS[k][lang]);
      expect(new Set(texts).size).toBe(LP_KEYS.length);
      // and none of them is the transcript copy wearing a new key
      expect(texts).not.toContain(UX_STRINGS.tqCouldNotMake[lang]);
    }
  });
});

describe('the lp_v8 row status in /quiz', () => {
  test('tqRowFailedLp exists in both languages, does not promise a retry /quiz cannot give, and is gender-neutral', () => {
    for (const lang of LANGUAGE_OFFER) {
      const s = UX_STRINGS.tqRowFailedLp[lang];
      expect(typeof s).toBe('string');
      expect(s.toLowerCase()).not.toMatch(/retry|tap|دوبارہ/);
      expect(genderedTeacherForms(s, lang)).toEqual([]);
      // status half of a 72-code-point row description
      expect(cp(s)).toBeLessThanOrEqual(30);
    }
  });
});

describe('failureCopyKey — the failure copy is picked by the quiz SOURCE', () => {
  const { failureCopyKey } = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');

  test('an lp_v8 quiz gets the reason that actually fired', () => {
    expect(failureCopyKey('source_missing', 'lp_v8')).toBe('tqFailedLpSource');
    expect(failureCopyKey('digest_failed', 'lp_v8')).toBe('tqFailedLpDigest');
    expect(failureCopyKey('validator_failed', 'lp_v8')).toBe('tqFailedLpAuthor');
  });

  test('a transcript quiz is untouched — it still gets tqCouldNotMake for every reason', () => {
    expect(failureCopyKey('session_missing', 'transcript')).toBe('tqCouldNotMake');
    expect(failureCopyKey('digest_failed', 'transcript')).toBe('tqCouldNotMake');
    expect(failureCopyKey('validator_failed', 'transcript')).toBe('tqCouldNotMake');
    expect(failureCopyKey('validator_failed', undefined)).toBe('tqCouldNotMake');
  });

  test('an lp_v8 reason nobody wrote copy for falls back rather than throwing at send time', () => {
    expect(failureCopyKey('something_new', 'lp_v8')).toBe('tqFailedLpAuthor');
  });
});

// ── bd R8 copy: "planned", never "taught"; never "today" the next morning ───

describe('the planned-not-taught copy (the lp_v8 caption and the next-morning coaching ask)', () => {
  /** Every new key with the params its caller fills, at their longest plausible values. */
  const NEW_KEYS = {
    tqHandoffIntroLp: { lesson: 'x'.repeat(300), n: 8 },
    lpAskBodyNextDay: { when: 'on 30 Sep' },
    lpAskBodyFirstTimeNextDay: { when: 'on 30 Sep' },
    lpAskWhenYesterday: undefined,
    lpAskWhenOnDate: { date: '30 Sep' },
  };

  test.each(Object.keys(NEW_KEYS))('%s exists in every offered language and fills without throwing', (key) => {
    for (const lang of LANGUAGE_OFFER) {
      expect(typeof UX_STRINGS[key][lang]).toBe('string');
      expect(UX_STRINGS[key][lang].trim().length).toBeGreaterThan(0);
      expect(() => resolveUx(key, { language: lang, params: NEW_KEYS[key] })).not.toThrow();
    }
  });

  test.each(Object.keys(NEW_KEYS))('%s is gender-neutral about the teacher, in both languages', (key) => {
    for (const lang of LANGUAGE_OFFER) {
      const s = UX_STRINGS[key][lang];
      expect(s).not.toMatch(/\b(she|her|hers|herself|he|him|his|himself)\b/i);
      expect(genderedTeacherForms(s, lang)).toEqual([]);
    }
  });

  test.each(['tqHandoffIntroLp', 'lpAskBodyNextDay', 'lpAskBodyFirstTimeNextDay'])('%s fits a WhatsApp body/caption (1,024 code points) filled at its longest', (key) => {
    for (const lang of LANGUAGE_OFFER) {
      expect(cp(resolveUx(key, { language: lang, params: NEW_KEYS[key] }))).toBeLessThanOrEqual(1024);
    }
  });

  test('the lp_v8 caption never says the lesson was taught — the transcript caption still does', () => {
    expect(UX_STRINGS.tqHandoffIntroLp.en).not.toMatch(/taught/i);
    expect(UX_STRINGS.tqHandoffIntroLp.ur).not.toMatch(/پڑھایا|سکھایا/);
    expect(UX_STRINGS.tqHandoffIntro.en).toMatch(/what you taught/);
  });

  test('the next-day asks never say today, in either language', () => {
    for (const key of ['lpAskBodyNextDay', 'lpAskBodyFirstTimeNextDay']) {
      expect(UX_STRINGS[key].en).not.toMatch(/today/i);
      expect(UX_STRINGS[key].ur).not.toMatch(/آج/);
    }
  });

  test('handoffIntroKey picks the caption by the quiz source', () => {
    const { handoffIntroKey } = require('../../bot/shared/services/quiz/quiz-sources');
    expect(handoffIntroKey('lp_v8')).toBe('tqHandoffIntroLp');
    expect(handoffIntroKey('transcript')).toBe('tqHandoffIntro');
    expect(handoffIntroKey(undefined)).toBe('tqHandoffIntro');
  });
});
