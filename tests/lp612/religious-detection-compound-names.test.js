/**
 * AN "-UD-DIN" NAME IS NOT RELIGIOUS CONTENT — bd-9mc3nz (queue #57, fault 3).
 *
 * Production, 2026-11-11 09:47Z, render 0c9fe2dd, grade_7_history.c05.p081-082 (The Mughal
 * Empire). A teacher asked for Urdu; the overlay translated "Zahiruddin Muhammad Babur" as
 * "ظہیر الدین محمد بابر", and the gate refused the Urdu page with ONE fail: check 6, "this
 * document carries religious content but does not set needs_human_review". She got English.
 *
 * The stored English lesson (lp612/v9.7/en/…p081-082.lp.json) has no religious content at all —
 * "Muhammad" in Babur's name is its only hit. DETECTION ran the raw PROPHET_RE, so any `محمد`
 * switched the whole document to "religious". The fix clears only (a) the reviewer's own list
 * (bd-zipoe) and (b) `محمد` straight after an "-ud-din" title, a style the Prophet is never named
 * by. check 1's looser compound-name rule is NOT reused: it reads "حضرت محمد مکہ میں…" as a
 * surname — the guard below pins that the sentence is still held.
 */
const { religious, cleanDoc } = require('./helpers/religious-marks');

/** A document with no hold set, one teacher-facing paragraph replaced by `text`. */
function lessonSaying(text) {
  const d = cleanDoc();
  delete d.needs_human_review;
  d.sections[1].blocks.find((b) => b.type === 'paragraph').text = text;
  return d;
}

const HOLD = /does not set needs_human_review/;
const holds = (d) => religious(d).some((f) => HOLD.test(f));

describe('another person named Muhammad does not make a lesson religious', () => {
  test('the production sentence: ظہیر الدین محمد بابر (Mughal emperor Babur)', () => {
    expect(religious(lessonSaying('ظہیر الدین محمد بابر نے مغلیہ سلطنت کی بنیاد رکھی (1526ء)۔'))).toEqual([]);
  });

  test.each([
    ['جلال الدین محمد اکبر', 'جلال الدین محمد اکبر نے دین الٰہی کا اعلان کیا'],
    ['شہاب الدین محمد غوری (written joined)', 'شہابالدین محمد غوری نے 1192ء میں جنگ جیتی'],
  ])('the same "-ud-din" title: %s', (_label, text) => {
    expect(religious(lessonSaying(text))).toEqual([]);
  });

  test('محمد بن قاسم — on the reviewer list (bd-zipoe), so cleared', () => {
    expect(religious(lessonSaying('محمد بن قاسم نے 712ء میں سندھ فتح کیا۔'))).toEqual([]);
  });

  test('the untouched fixture stays not religious', () => {
    expect(religious(lessonSaying('مغلیہ سلطنت کی بنیاد 1526ء میں رکھی گئی۔'))).toEqual([]);
  });
});

describe('GUARDS — every real mention still marks the document religious (check 6 holds it)', () => {
  test.each([
    ['the Prophet with ﷺ', 'حضرت محمد ﷺ مکہ میں پیدا ہوئے۔'],
    ['the Prophet with no honorific (check 1 also fires)', 'حضرت محمد مکہ میں پیدا ہوئے۔'],
    ['bare محمد at the end of a sentence', 'یہ سبق محمد کے بارے میں ہے'],
    ['محمد followed by an epithet', 'محمد مصطفیٰ کی سیرت'],
    ['نبی کریم', 'نبی کریم ﷺ نے فرمایا'],
    ['حضور', 'حضور ﷺ کی ہجرت'],
    ['سیرت with no name at all', 'سیرت کا سبق'],
    ['Babur AND the Prophet in one lesson', 'ظہیر الدین محمد بابر اور حضرت محمد ﷺ'],
    // check 1's compound-name rule reads مکہ as a surname; detection must not inherit that.
    ['the Prophet, bare, followed by a place name', 'حضرت محمد مکہ میں پیدا ہوئے'],
    // not narrowed by this change: a compound name the reviewer has not decided is still held.
    ['محمد ثاقب (not on the reviewer list)', 'محمد ثاقب نے سندھ فتح کیا'],
    ['دین محمد — "the religion of Muhammad", no ال', 'دین محمد کی تعلیم'],
    // The acceptance-evaluator's probes (2026-11-11): each slipped through the first version.
    ['یوم الدین (Day of Judgement) before محمد is not a laqab', 'مالک یوم الدین محمد کے بارے میں'],
    ['the ؐ mark after an -ud-din محمد', 'ظہیر الدین محمدؐ نے فرمایا'],
    ['(ص) after an -ud-din محمد', 'ظہیر الدین محمد (ص) نے'],
    ["one of the Prophet's own epithets after an -ud-din محمد", 'ظہیر الدین محمد مصطفیٰ'],
  ])('%s', (_label, text) => {
    expect(holds(lessonSaying(text))).toBe(true);
  });
});
