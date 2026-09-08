'use strict';
/**
 * bd-mg9c7.9 — the decidable half of the Islamiyat rule, ported from the
 * curriculum lesson-plan lint: every Prophet mention carries ﷺ, sacred names
 * never appear in Latin script, companions carry their honorific, and no
 * question puts unsourced words in the Prophet's mouth.
 *
 * Also the truncation helper: a 24-code-point list title must never end on
 * "نبی کریم" with the ﷺ cut off — the cut moves before the mention instead.
 */
const rm = require('../../bot/shared/services/quiz/religious-marks');

describe('religious marks — Prophet mentions', () => {
  test('a mention with the ligature passes', () => {
    expect(rm.checkReligiousMarks('نبی کریم ﷺ نے فرمایا')).toEqual([]);
  });

  test('a mention with the spelled-out honorific passes, including the وآلہ variant', () => {
    expect(rm.checkReligiousMarks('حضرت محمد صلی اللہ علیہ وسلم مکہ میں پیدا ہوئے')).toEqual([]);
    expect(rm.checkReligiousMarks('حضرت محمد صلی اللہ علیہ وآلہ وسلم مکہ میں پیدا ہوئے')).toEqual([]);
  });

  test('a bare mention is flagged', () => {
    const errs = rm.checkReligiousMarks('نبی کریم نے فرمایا کہ صفائی نصف ایمان ہے');
    expect(errs.some((e) => /prophet mention without/.test(e))).toBe(true);
  });

  test('longest token first: "نبی کریم ﷺ" is not reported as a bare "نبی"', () => {
    expect(rm.checkReligiousMarks('نبی کریم ﷺ')).toEqual([]);
  });

  test('a Latin-script sacred name is flagged', () => {
    const errs = rm.checkReligiousMarks('Hazrat Muhammad (PBUH) was born in Makkah');
    expect(errs.some((e) => /latin-script sacred name/.test(e))).toBe(true);
  });

  test('a companion without an honorific is flagged; with one it passes', () => {
    expect(rm.checkReligiousMarks('حضرت ابوبکر رضی اللہ عنہ پہلے خلیفہ تھے')).toEqual([]);
    const errs = rm.checkReligiousMarks('حضرت ابوبکر پہلے خلیفہ تھے');
    expect(errs.some((e) => /companion without honorific/.test(e))).toBe(true);
  });

  test('prophetic speech with a quote and no source is flagged; with a source it passes', () => {
    const bad = 'نبی کریم ﷺ نے فرمایا: "علم حاصل کرنا ہر مسلمان پر فرض ہے"';
    expect(rm.checkReligiousMarks(bad).some((e) => /unsourced prophetic speech/.test(e))).toBe(true);
    const ok = `${bad} (بخاری)`;
    expect(rm.checkReligiousMarks(ok).some((e) => /unsourced prophetic speech/.test(e))).toBe(false);
  });
});

describe('truncateCodePoints — glue the honorific to its name', () => {
  test('measures in code points, not UTF-16 units', () => {
    expect(rm.cpLen('👍 جی ہاں')).toBe(8);
    expect(rm.truncateCodePoints('abcdefghij', 4)).toBe('abcd');
  });

  test('never strands a Prophet mention without its ﷺ at the cut', () => {
    const s = 'سب سے پہلے نبی کریم ﷺ نے کیا کیا؟';
    // A naïve cut at 19 would end exactly on "نبی کریم" and drop the ﷺ.
    const idx = s.indexOf('ﷺ');
    const out = rm.truncateCodePoints(s, idx);
    expect(out.endsWith('نبی کریم')).toBe(false);
    expect(out.length).toBeLessThan(idx);
    // Whatever survived still passes the gate.
    expect(rm.checkReligiousMarks(out)).toEqual([]);
  });

  test('never splits the spelled-out honorific mid-phrase', () => {
    const s = 'حضرت محمد صلی اللہ علیہ وسلم مکہ میں پیدا ہوئے';
    const out = rm.truncateCodePoints(s, 20);   // inside "صلی اللہ علیہ وسلم"
    expect(out).not.toMatch(/صلی\s*اللہ$/);
    expect(rm.checkReligiousMarks(out)).toEqual([]);
  });

  test('returns the string untouched when it fits', () => {
    expect(rm.truncateCodePoints('نبی کریم ﷺ', 24)).toBe('نبی کریم ﷺ');
  });
});
