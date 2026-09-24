/**
 * A catalog paragraph keeps its language's direction whatever value opens it.
 *
 * A phone lays out each PARAGRAPH (each line after a newline) from its first
 * strong character. A leading U+200F in a string only governs the string's
 * first paragraph. So an Urdu paragraph that OPENS with a placeholder is laid
 * out left to right whenever the value is Latin — "{teacher} نے آپ کو …" with a
 * teacher registered as "Miss Ayesha" is read from the wrong end ("بھیجا ہے۔ …
 * Miss Ayesha"). The message a teacher forwards to the class group is one of
 * them, and it is the first thing every child reads. English has the mirror
 * case: an Urdu-script name opening an English line turns it right to left.
 *
 * resolveUx() fixes it in one place: when an opening value would turn a
 * paragraph the wrong way, the value is isolated (U+2068 … U+2069) and the
 * paragraph is opened with the language's own mark (U+200F / U+200E), so both
 * clients that honour isolates and clients that do not lay it out correctly.
 * Nothing else changes — same-script values, digits, lines that hold only a
 * value (a link, a list of names), and values the template already isolates are
 * left exactly as they were.
 */

const { UX_STRINGS, resolveUx } = require('../../bot/shared/config/ux-strings');

const RLM = '‏';
const LRM = '‎';
const FSI = '⁨';
const PDI = '⁩';
const RTL_LETTER = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const PLACEHOLDER = /\{(\w+)\}/g;

function strongOf(ch) {
  if (ch === RLM || ch === '؜') return 'rtl';
  if (ch === LRM) return 'ltr';
  if (!/\p{L}/u.test(ch)) return null;
  return RTL_LETTER.test(ch) ? 'rtl' : 'ltr';
}
/** First strong character, NOT skipping isolates — what a client that ignores isolates sees. */
function firstStrong(text) {
  for (const ch of text) {
    const d = strongOf(ch);
    if (d) return d;
  }
  return null;
}
const DIR = { ur: 'rtl', en: 'ltr' };
const OTHER_SCRIPT_VALUE = { ur: 'Miss Ayesha', en: 'مس عائشہ' };

/** Every placeholder-led paragraph the author wrote in the language, as [key, lang, index]. */
function placeholderLedParagraphs() {
  const out = [];
  for (const [key, variants] of Object.entries(UX_STRINGS)) {
    for (const lang of ['ur', 'en']) {
      const tpl = variants[lang];
      if (typeof tpl !== 'string') continue;
      tpl.split('\n').forEach((para, i) => {
        const at = para.search(/\{\w+\}/);
        if (at < 0 || firstStrong(para.slice(0, at)) !== null) return;
        const own = para.replace(PLACEHOLDER, '');
        if (![...own].some((ch) => strongOf(ch) === DIR[lang])) return;
        out.push([key, lang, i]);
      });
    }
  }
  return out;
}

function paramsFor(tpl, value) {
  const params = {};
  for (const m of tpl.matchAll(PLACEHOLDER)) params[m[1]] = value;
  return params;
}

describe('the forwarded class message keeps its direction', () => {
  const params = {
    topic: 'واحد اور جمع', date: '23 ستمبر', link: 'https://wa.me/15550001111?text=QUIZ-ABC234',
  };

  test('an Urdu message from a teacher with a Latin name: the line is opened right to left and the name isolated', () => {
    const out = resolveUx('tqStudentMessage', { language: 'ur', params: { ...params, teacher: 'Miss Ayesha' } });
    const line = out.split('\n').find((p) => p.includes('Miss Ayesha'));
    expect(line.startsWith(`${RLM}${FSI}Miss Ayesha${PDI} نے آپ کو *واحد اور جمع* پر quiz بھیجا ہے`)).toBe(true);
    expect(firstStrong(line)).toBe('rtl');
  });

  test('the link keeps its own line exactly — nothing is added around a URL', () => {
    const out = resolveUx('tqStudentMessage', { language: 'ur', params: { ...params, teacher: 'Miss Ayesha' } });
    expect(out.split('\n')).toContain(params.link);
  });

  test('an Urdu teacher name changes nothing — the string is the plain substitution', () => {
    const out = resolveUx('tqStudentMessage', { language: 'ur', params: { ...params, teacher: 'آپ کے استاد' } });
    const plain = UX_STRINGS.tqStudentMessage.ur.replace(PLACEHOLDER, (_, n) => ({ ...params, teacher: 'آپ کے استاد' })[n]);
    expect(out).toBe(plain);
  });

  test('the mirror case: an English message from a teacher with an Urdu-script name stays left to right', () => {
    const out = resolveUx('tqStudentMessage', {
      language: 'en',
      params: { ...params, topic: 'A Balanced Diet', date: '23 Sep', teacher: 'مس عائشہ' },
    });
    const line = out.split('\n').find((p) => p.includes('مس عائشہ'));
    expect(line.startsWith(`${LRM}${FSI}مس عائشہ${PDI} has sent you a quiz on *A Balanced Diet*`)).toBe(true);
  });
});

describe('every paragraph that opens with a placeholder, across the whole catalog', () => {
  const cases = placeholderLedParagraphs();

  test('there are such paragraphs to check (the sweep is not vacuous)', () => {
    expect(cases.length).toBeGreaterThan(30);
    expect(cases.some(([k, l]) => k === 'tqStudentMessage' && l === 'ur')).toBe(true);
  });

  test.each(cases)('%s (%s) paragraph %i keeps its direction when the value is in the other script', (key, lang, i) => {
    const tpl = UX_STRINGS[key][lang];
    const out = resolveUx(key, { language: lang, params: paramsFor(tpl, OTHER_SCRIPT_VALUE[lang]) });
    expect(firstStrong(out.split('\n')[i])).toBe(DIR[lang]);
  });
});

describe('what must NOT change', () => {
  test('a letter list inside an Urdu line keeps its right-to-left order (render QA verified it)', () => {
    expect(resolveUx('vqCardTapBelow', { language: 'ur', params: { letters: 'A، B یا C' } }))
      .toBe('نیچے A، B یا C دبائیں');
  });

  test('a template that already opens with a mark is left alone', () => {
    const out = resolveUx('vqMultiExtra', { language: 'ur', params: { extra: 'B، C' } });
    expect(out).toBe(`${RLM}B، C اس میں شامل نہیں۔`);
  });

  test('a value the template already isolates is not isolated twice — only the mark is added', () => {
    const out = resolveUx('coachingPhotoGateAdvancing', { language: 'ur', params: { name: 'Ayesha' } });
    expect(out.startsWith(`${RLM}⁦Ayesha${PDI}،`)).toBe(true);
    expect((out.match(/[⁦-⁨]/g) || []).length).toBe(1);
  });

  test('a missing parameter still throws', () => {
    expect(() => resolveUx('tqStudentMessage', { language: 'ur', params: { teacher: 'X' } })).toThrow(/missing param/);
  });
});

describe('an Urdu line the AUTHOR opens with a Latin word carries the mark', () => {
  // The resolver does not touch the author's own words; this pins them. The one
  // exception opens with a slash command: marked right to left, "/language"
  // would render as "language/" (the same trap the /quiz isolates exist for),
  // and that footer is a bilingual line meant to read left to right.
  const EXEMPT = new Set(['languagePickerFooter']);

  test('every such paragraph starts with U+200F', () => {
    const bad = [];
    for (const [key, variants] of Object.entries(UX_STRINGS)) {
      if (EXEMPT.has(key) || typeof variants.ur !== 'string') continue;
      variants.ur.split('\n').forEach((para, i) => {
        const at = para.search(/\{\w+\}/);
        const lead = at < 0 ? para : para.slice(0, at);
        const own = para.replace(PLACEHOLDER, '');
        if (firstStrong(lead) === 'ltr' && [...own].some((ch) => strongOf(ch) === 'rtl')) bad.push(`${key} p${i}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
