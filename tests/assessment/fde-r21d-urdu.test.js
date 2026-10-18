/**
 * Urdu board-pattern papers, three more Q1 rules and three follow-ups:
 *
 * (d) متشابہ is one concept however the stem asks it: «ایک ہی املا», a pair that sounds alike but
 *     is spelt differently («آواز میں ایک جیسے مگر املا میں مختلف»), a word's «دوسرا معنی», and
 *     «X بمعنی … اور Y بمعنی …». On lessons 4–5 the lessons' own متضاد and مترادف are concepts
 *     too, asked once each, in a reply to the prompt that gives Q1 its grammar count; an antonym or
 *     synonym asked again may come back after the re-ask for a place nothing else fills. Elsewhere an
 *     antonym or a synonym item stays vocabulary.
 * (e) On chosen lessons Section A declares each Q1 item's concept. Code holds a tag the lessons do not
 *     teach, a grammar tag asked twice, and a tag the stem contradicts; the tag never prints.
 * (f) The paper records its holds as counts: `_layout.holds: [{ slot, rule, n }]`.
 *
 * Also: a Q3/Q5 phrase named with a word put in between is still named; a Q4 ارکان key that splits a
 * word apart from its own accepted answer is asked again; an Urdu MCQ distractor is no word of worship.
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout, conceptOf } = require('../../bot/shared/services/assessment/fde-layout');
const Renderer = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const U = Patterns.get('fde_g5_2027').subjects.urdu;
const FDE = { kind: 'fde', chapters: null, pages: null };
const ch = (...n) => ({ kind: 'chapters', chapters: n, pages: null });
const clone = (x) => JSON.parse(JSON.stringify(x));
const fixture = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `r21d-urdu-chapters_${n}.json`), 'utf8'));
const q1Of = (exam) => Object.values(exam.unseen).flatMap((t) => Object.values(t || {})).flat().filter((q) => q && q.slot === 'urdu.A.Q1');
const by = (exam, start) => q1Of(exam).find((q) => q.question.startsWith(start));
const lay = (exam, scope, opts = {}) => applyLayout(clone(exam), U, scope, { now: 'x', ...opts });
const mcq = (question, key, concept) => ({
  slot: 'urdu.A.Q1', question, options: [`الف) ${key}`, 'ب) کتاب', 'ج) دریا', 'د) بادل'], answer: `الف) ${key}`, ...(concept ? { concept } : {}),
});
const paperOf = (items) => ({ unseen: { objective: { MCQs: items } } });

describe('(d) متشابہ is one concept in every stem shape', () => {
  const p = fixture(2); // lessons 6–7: Q1 ۱۰ ۱۴ ۱۵ ۱۶ all ask the متشابہ pair
  const four = ['ایک ہی املا کے دو لفظوں', 'ایک لفظ کا مطلب «زمین»', 'جو لفظ «علم والا»', '«سحر» بمعنی جادو'].map((s) => by(p, s));

  test('all four items tag as homograph', () => {
    expect(four.every(Boolean)).toBe(true);
    expect(four.map(conceptOf)).toEqual(['homograph', 'homograph', 'homograph', 'homograph']);
  });

  test('lessons 6–7: one of the four prints', () => {
    const printed = q1Of(lay(p, ch(6, 7)).examJson).map((q) => q.question);
    expect(four.filter((q) => printed.includes(q.question))).toHaveLength(1);
  });

  test('a word meaning or a story fact is no concept', () => {
    expect(conceptOf(by(p, '«مہربانی» کے معنی'))).toBeNull();
    expect(conceptOf(by(p, 'امینہ، سدرہ'))).toBeNull();
  });
});

describe('(d) on lessons 4–5, متضاد and مترادف are asked once each', () => {
  // Q1: متضاد ×6, مترادف ×3, written as a reply to today's prompt (each item declares its concept).
  const p = fixture(1);
  q1Of(p).forEach((q) => {
    q.concept = /کا متضاد/.test(q.question) ? 'متضاد الفاظ' : /کا مترادف/.test(q.question) ? 'مترادف الفاظ'
      : conceptOf(q) ? 'تمنائی اور شکیہ جملے' : 'ذخیرۂ الفاظ / فہم';
  });
  const count = (exam, re) => q1Of(exam).filter((q) => re.test(q.question)).length;

  test('lessons 4–5 print one antonym item and one synonym item', () => {
    const out = lay(p, ch(4, 5)).examJson;
    expect(count(out, /کا متضاد/)).toBe(1);
    expect(count(out, /کا مترادف/)).toBe(1);
  });

  // A repeat used to come back after the re-ask to fill a place; now a concept a printed item asks
  // never does, and the place is left for Section A's grammar-is-used-up top-up (or fails closed).
  test('after the re-ask, an antonym or synonym repeat never comes back on chosen lessons; a متشابہ twin never comes back', () => {
    const r = lay(p, ch(4, 5), { reasked: true });
    expect(count(r.examJson, /کا متضاد/)).toBe(1);
    expect(count(r.examJson, /کا مترادف/)).toBe(1);
    expect((r.putBack || []).map((x) => x.rule)).not.toContain('concept_repeat');
    expect(r.shortfall.filter((f) => f.slot === 'urdu.A.Q1')).toEqual([{ slot: 'urdu.A.Q1', missing: expect.any(Number) }]);
    const h = lay(fixture(2), ch(6, 7), { reasked: true }).examJson;
    const homographs = q1Of(h).filter((q) => conceptOf(q) === 'homograph');
    expect(homographs).toHaveLength(1);
  });

  test('a reply written before the grammar count (no declared concepts) lays out as it did (control)', () => {
    const out = lay(fixture(1), ch(4, 5)).examJson;
    expect(count(out, /کا متضاد/)).toBe(6);
  });

  test('the full syllabus keeps every antonym and synonym item (control)', () => {
    const out = lay(p, FDE).examJson;
    expect(count(out, /کا متضاد/)).toBe(6);
    expect(count(out, /کا مترادف/)).toBe(3);
  });

  test('lessons 6–7 do not teach them: antonyms stay vocabulary, none held (control)', () => {
    const items = [['بہادر', 'بزدل'], ['اجالا', 'اندھیرا'], ['جنگ', 'امن']].map(([w, k]) => mcq(`لفظ «${w}» کا متضاد کون سا ہے؟`, k));
    const r = lay(paperOf(items), ch(6, 7));
    expect(q1Of(r.examJson)).toHaveLength(3);
  });
});

describe('(e) the declared concept is checked, and never prints', () => {
  test('a tag the chosen lessons do not teach is held', () => {
    const r = lay(paperOf([mcq('درج ذیل میں سے کون سا لفظ درست ہے؟', 'دھڑام', 'اسم صوت'), mcq('ندی کس کی فریاد کرتی ہے؟', 'صفائی', 'فہم')]), ch(6, 7));
    expect(q1Of(r.examJson).map((q) => q.answer)).toEqual(['الف) صفائی']);
  });

  test('a grammar tag asked twice: the second is held, though no stem pattern sees it', () => {
    const r = lay(paperOf([
      mcq('«کل» کے دو معنی کون سے ہیں؟', 'آنے والا دن اور تمام', 'متشابہ الفاظ'),
      mcq('«مال» کس جملے میں دولت کے معنی میں آیا ہے؟', 'اس کے پاس بہت مال ہے', 'متشابہ الفاظ'),
    ]), ch(6, 7));
    expect(q1Of(r.examJson)).toHaveLength(1);
  });

  test('a pair entry («تمنائی اور شکیہ جملے») on a تمنائی item and on a شکیہ item: both print', () => {
    const pairTag = 'تمنائی اور شکیہ جملے';
    const r = lay(paperOf([
      mcq('کون سا جملہ تمنائی ہے؟', 'کاش میں پرندہ ہوتا۔', pairTag),
      mcq('جس جملے میں شک پایا جائے، وہ کون سا جملہ کہلاتا ہے؟', 'شکیہ', pairTag),
    ]), ch(4, 5));
    expect(q1Of(r.examJson)).toHaveLength(2);
  });

  test('a stem that asks a grammar concept, tagged as vocabulary, is held', () => {
    const r = lay(paperOf([mcq('ایک ہی املا کے دو لفظوں کے معنی «جنگل» اور «تیار ہونا» ہیں۔ وہ لفظ کون سا ہے؟', 'بن', 'ذخیرۂ الفاظ')]), ch(6, 7));
    expect(q1Of(r.examJson)).toHaveLength(0);
  });

  test('the tag is stripped from every printed item, on every scope', () => {
    for (const scope of [ch(6, 7), FDE]) {
      const out = lay(paperOf([mcq('ندی کس کی فریاد کرتی ہے؟', 'صفائی', 'فہم')]), scope).examJson;
      expect(JSON.stringify(out.unseen)).not.toMatch(/"concept"/);
    }
  });

  test('chapter scopes ask for the tag in the Section A prompt; the full syllabus does not', () => {
    const A = U.sections.find((s) => s.id === 'A');
    const prompt = (scope) => Gen.buildPatternUserPrompt({ grade: 5, subject: 'urdu', pageContent: 'x', pageReference: 'p', section: A, slots: A.slots, lang: 'ur', P: U, scope });
    expect(prompt(ch(6, 7))).toMatch(/"concept"/);
    expect(prompt(ch(4, 5))).toMatch(/exactly 4 of the 20 items are grammar/);
    expect(prompt(FDE)).not.toMatch(/"concept"|of the 20 items are grammar/);
  });

  test('every Urdu MCQ section is told a distractor is never a word of worship', () => {
    const A = U.sections.find((s) => s.id === 'A');
    for (const scope of [ch(6, 7), FDE]) {
      expect(Gen.buildPatternUserPrompt({ grade: 5, subject: 'urdu', pageContent: 'x', pageReference: 'p', section: A, slots: A.slots, lang: 'ur', P: U, scope }))
        .toMatch(/never a word of worship \(اذان، نماز، روزہ\)/);
    }
  });
});

describe('(f) the paper records its holds as counts', () => {
  test('lessons 6–7: `_layout.holds` counts the متشابہ twins, and carries no text', () => {
    const out = lay(fixture(2), ch(6, 7)).examJson;
    expect(out._layout.holds).toEqual(expect.arrayContaining([{ slot: 'urdu.A.Q1', rule: 'twin', n: expect.any(Number) }]));
    out._layout.holds.forEach((h) => expect(Object.keys(h).sort()).toEqual(['n', 'rule', 'slot']));
    expect(() => Renderer.renderPaper({ examJson: out, grade: 5, subject: 'urdu', allowShort: true })).not.toThrow();
  });

  test('a re-layout of a laid paper keeps the first layout\'s counts', () => {
    const first = lay(fixture(2), ch(6, 7)).examJson;
    const again = lay(first, ch(6, 7)).examJson;
    expect(again._layout.holds).toEqual(first._layout.holds);
  });
});

describe('panel follow-ups: a Q3/Q5 phrase with a word put in, and a Q4 syllable key that disagrees with its accept', () => {
  test('Q1 ۶ «"قطرہ قطرہ ہی سمندر بنتا ہے" سے کیا مراد ہے؟» is held against Q5\'s «قطرہ قطرہ سمندر بنتا ہے»', () => {
    const p = fixture(2);
    const q6 = by(p, '«قطرہ قطرہ ہی سمندر');
    expect(q6).toBeDefined();
    const printed = q1Of(lay(p, ch(6, 7)).examJson).map((q) => q.question);
    expect(printed).not.toContain(q6.question);
  });

  test('Q4 ارکان «تواضع: تو + اضع» beside accept «تَ وا ضُع» is held; «مشغول: مش + غول» beside «مَش غُول» alone is not', () => {
    const items = (answer) => {
      const p = fixture(1);
      for (const t of Object.values(p.unseen)) for (const l of Object.values(t)) for (const q of l) if (q.slot === 'urdu.C.Q4' && q.answer.includes('+')) q.answer = answer;
      return p;
    };
    const q4s = (exam) => Object.values(exam.unseen).flatMap((t) => Object.values(t)).flat().filter((q) => q.slot === 'urdu.C.Q4');
    const split = lay(items('مشغول: مش + غول\nتواضع: تو + اضع'), FDE).examJson;
    expect(q4s(split).some((q) => q.answer.includes('+'))).toBe(false);
    const fine = lay(items('مشغول: مش + غول'), FDE).examJson;
    expect(q4s(fine).some((q) => q.answer.includes('+'))).toBe(true);
    // Two words on one line, cut at «؛», and an accept written the same way.
    const one = items('مشغول: مش + غول؛ تواضع: تو + اضع');
    const agree = items('مشغول: مش + غول؛ تواضع: ت + وا + ضع');
    for (const p of [one, agree]) for (const q of q4s(p)) if (q.answer.includes('+')) q.scheme.accept = ['مَش غُول؛ تَ وا ضُع'];
    expect(q4s(lay(one, FDE).examJson).some((q) => q.answer.includes('+'))).toBe(false);
    expect(q4s(lay(agree, FDE).examJson).some((q) => q.answer.includes('+'))).toBe(true);
    // Words cut at «،», no «word:» label, and an accept that writes its own «+» cuts: they agree.
    const commas = items('فَر + یاد، پا + کی + زہ');
    for (const q of q4s(commas)) if (q.answer.includes('+')) q.scheme.accept = ['فَر + یاد، پا + کی + زہ', 'فر یاد، پا کی زہ'];
    expect(q4s(lay(commas, FDE).examJson).some((q) => q.answer.includes('+'))).toBe(true);
    const marked = items('مش + غول، مع + ذور');
    for (const q of q4s(marked)) if (q.answer.includes('+')) q.scheme.accept = ['مش + غُول، مَع + ذُور'];
    expect(q4s(lay(marked, FDE).examJson).some((q) => q.answer.includes('+'))).toBe(true);
    // «راہ گیر: را + ہ + گیر» beside «راہ + گیر»: two answers.
    const twoWays = items('راہ گیر: را + ہ + گیر');
    for (const q of q4s(twoWays)) if (q.answer.includes('+')) q.scheme.accept = ['راہ + گیر'];
    expect(q4s(lay(twoWays, FDE).examJson).some((q) => q.answer.includes('+'))).toBe(false);
  });
});
