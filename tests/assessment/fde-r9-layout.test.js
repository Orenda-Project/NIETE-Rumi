/**
 * What the ninth review round asked of the board-pattern layout and renderer,
 * through the real chain (applyLayout → renderPaper / renderMarkingScheme):
 *
 *   1. An item the slot letters itself ((a), (b)) prints its letter once:
 *      «(a) Write an application…», never «(a) (a) Write an application…».
 *   2. One section never gives another away. English: a Q1(a) MCQ carrying one of
 *      Q4's words is held. Social Studies: a Q5 or Q7 item asking the fact a Q1
 *      MCQ already tests is held. A held item takes no place, so the next item
 *      in reply order (the re-asked section's, appended after the first reply)
 *      fills it; with none left the slot is short. The other slot is never touched.
 *
 * Pure: HTML strings, no browser. The stored papers are sandbox / local
 * generations with no person in them; the extra items are fictional.
 */

const fs = require('fs');
const path = require('path');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const NOW = '2026-10-20T07:12:00.000Z';
const P = Patterns.get('fde_g5_2027').subjects;
const clone = (o) => JSON.parse(JSON.stringify(o));

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
}

function visible(html) {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[‎‏⁦-⁩]/g, '')
    .replace(/\s+/g, ' ');
}

const SCOPE = { kind: 'chapters', chapters: [1, 2], pages: null };
const lay = (exam, subject) => applyLayout(clone(exam), P[subject], SCOPE, { now: NOW });

// The placed items of one slot, in print order.
function slotItems(exam, slot) {
  const out = [];
  for (const types of Object.values(exam.unseen || {})) {
    for (const list of Object.values(types || {})) {
      if (Array.isArray(list)) out.push(...list.filter((q) => q && q.slot === slot));
    }
  }
  return out;
}

// Appends items to the model's tree the way the engine's top-up does: after the first reply's.
function withExtra(exam, slot, extra) {
  const out = clone(exam);
  const type = Object.entries(out.unseen).flatMap(([cat, types]) => Object.keys(types).map((t) => [cat, t]))
    .find(([cat, t]) => out.unseen[cat][t].some((q) => q.slot === slot));
  out.unseen[type[0]][type[1]].push(...extra.map((q) => ({ ...q, slot })));
  return out;
}

describe('r9 · an item the slot letters prints its letter once', () => {
  // The stored sandbox paper as it was laid out, straight into the renderer.
  const laid = fixture('r9-english-alt-label');

  test('the paper prints «(a) Write an application…» once', () => {
    const text = visible(R.renderPaper({ examJson: laid, grade: 5, subject: 'english', answerLines: true }));
    expect(text).not.toMatch(/\(a\)\s*\(a\)/);
    expect(text).not.toMatch(/\(b\)\s*\(b\)/);
    expect(text).toContain('Write an application to your principal for sick leave.');
    expect(text).toContain('Write a letter to your friend thanking them for a gift.');
  });

  test('the marking scheme prints the letter once (in its number cell, not again in the row)', () => {
    const text = visible(R.renderMarkingScheme({ examJson: laid, grade: 5, subject: 'english' }));
    expect(text).toContain('Write an application to your principal for sick leave.');
    expect(text).not.toContain('(a) Write an application');
    expect(text).not.toContain('(b) Write a letter');
  });

  test('the stored item keeps its own text (only the print drops the letter)', () => {
    const q7 = slotItems(laid, 'english.C.Q7');
    expect(q7.map((q) => q.question)).toEqual([
      '(a) Write an application to your principal for sick leave.',
      '(b) Write a letter to your friend thanking them for a gift.',
    ]);
  });

  test('a slot that does not letter its items keeps a leading (a)', () => {
    const exam = clone(laid);
    const q9 = slotItems(exam, 'english.C.Q9')[0];
    q9.question = '(a) a lost kite — a kind neighbour — Moral';
    const text = visible(R.renderPaper({ examJson: exam, grade: 5, subject: 'english', answerLines: true }));
    expect(text).toContain('(a) a lost kite');
  });
});

describe('r9 · English: a Q1(a) MCQ carrying a Q4 word is held', () => {
  const exam = fixture('r9-english-giveaway');
  const words = slotItems(exam, 'english.C.Q4')[0].words;

  test('q1a mcqs naming invisible, forgiveness, invent are held; the slot goes short by three', () => {
    const out = lay(exam, 'english');
    const q1a = slotItems(out.examJson, 'english.A.Q1a');
    const texts = q1a.map((q) => [q.question, ...(q.options || [])].join(' '));
    for (const w of ['invisible', 'forgiveness', 'invent']) {
      expect(texts.some((t) => new RegExp(`\\b${w}\\b`, 'i').test(t))).toBe(false);
    }
    expect(out.shortfall).toEqual(expect.arrayContaining([{ slot: 'english.A.Q1a', missing: 3 }]));
  });

  test('Q4 is never touched', () => {
    const out = lay(exam, 'english');
    const q4 = slotItems(out.examJson, 'english.C.Q4');
    expect(q4).toHaveLength(1);
    expect(q4[0].words).toEqual(words);
  });

  test('a held mcq takes no place: the re-asked items fill it, none of them a Q4 word', () => {
    const extra = [
      { question: "Choose the correct article: ___ apple.", options: ['a) a', 'b) an', 'c) the', 'd) no article'], answer: 'b) an' },
      { question: "What does the word 'invisible' mean here?", options: ['a) hidden', 'b) loud', 'c) bright', 'd) wet'], answer: 'a) hidden' },
      { question: 'Which word is a noun?', options: ['a) run', 'b) happy', 'c) table', 'd) quickly'], answer: 'c) table' },
      { question: 'Pick the plural of box.', options: ['a) boxs', 'b) boxes', 'c) boxies', 'd) box'], answer: 'b) boxes' },
    ];
    const out = lay(withExtra(exam, 'english.A.Q1a', extra), 'english');
    const q1a = slotItems(out.examJson, 'english.A.Q1a');
    expect(out.shortfall.find((f) => f.slot === 'english.A.Q1a')).toBeUndefined();
    expect(q1a).toHaveLength(P.english.sections[0].slots.find((s) => s.slot === 'english.A.Q1a').generate);
    expect(q1a.map((q) => q.question)).toEqual(expect.arrayContaining([
      'Choose the correct article: ___ apple.', 'Which word is a noun?', 'Pick the plural of box.',
    ]));
    expect(q1a.some((q) => /invisible/i.test(q.question))).toBe(false);
  });
});

describe('r9 · Social Studies: a Q5/Q7 item asking a Q1 fact is held', () => {
  test('chapters paper: Q7 «first province to join Pakistan» (Q1 keys سندھ) and «Senate members» (Q1 keys 104) are held', () => {
    const exam = fixture('r9-sst-chapters2');
    const out = lay(exam, 'social_studies');
    const q7 = slotItems(out.examJson, 'social_studies.D.Q7').map((q) => q.question);
    expect(q7.some((t) => t.includes('پاکستان میں شامل ہونے والا پہلا صوبہ'))).toBe(false);
    expect(q7.some((t) => t.includes('ایوان بالا (سینیٹ) میں ممبران کی تعداد'))).toBe(false);
    expect(out.shortfall).toEqual(expect.arrayContaining([{ slot: 'social_studies.D.Q7', missing: 2 }]));
  });

  test('full paper: Q7 «second-largest salt mine» (Q1 keys کھیوڑہ) is held; Q7 naming a Q1-stem person for another fact is kept', () => {
    const exam = fixture('r9-sst-full2');
    const out = lay(exam, 'social_studies');
    const q7 = slotItems(out.examJson, 'social_studies.D.Q7').map((q) => q.question);
    expect(q7.some((t) => t.includes('دنیا کی دوسری بڑی نمک کی کان'))).toBe(false);
    expect(q7).toContain('پاکستان کی پہلی خاتون صوبائی گورنر کون تھیں؟');
  });

  test('Q1 is never touched', () => {
    const exam = fixture('r9-sst-chapters2');
    const before = slotItems(exam, 'social_studies.A.Q1').map((q) => q.question);
    const out = lay(exam, 'social_studies');
    expect(slotItems(out.examJson, 'social_studies.A.Q1').map((q) => q.question).sort()).toEqual(before.sort());
  });

  test('a held Q7 item takes no place: the re-asked item fills it', () => {
    const exam = fixture('r9-sst-chapters2');
    const extra = [
      { question: 'پاکستان کا قومی پھول کون سا ہے؟', answer: 'چنبیلی۔', scheme: { points: [{ kind: 'K', text: 'چنبیلی', marks: 2 }] } },
      { question: 'قائد اعظم کس شہر میں پیدا ہوئے؟', answer: 'کراچی میں۔', scheme: { points: [{ kind: 'K', text: 'کراچی', marks: 2 }] } },
    ];
    const out = lay(withExtra(exam, 'social_studies.D.Q7', extra), 'social_studies');
    const q7 = slotItems(out.examJson, 'social_studies.D.Q7').map((q) => q.question);
    expect(out.shortfall.find((f) => f.slot === 'social_studies.D.Q7')).toBeUndefined();
    expect(q7).toEqual(expect.arrayContaining(['پاکستان کا قومی پھول کون سا ہے؟', 'قائد اعظم کس شہر میں پیدا ہوئے؟']));
  });

  test('Urdu-Indic digits and option letters match: a key written ۱۰۴ still holds the 104 item', () => {
    const exam = fixture('r9-sst-chapters2');
    for (const q of slotItems(exam, 'social_studies.A.Q1')) {
      if (q.answer === 'ب) 104') { q.answer = 'ب) ۱۰۴'; q.options = q.options.map((o) => o.replace('104', '۱۰۴')); }
    }
    const q7 = slotItems(lay(exam, 'social_studies').examJson, 'social_studies.D.Q7').map((q) => q.question);
    expect(q7.some((t) => t.includes('ایوان بالا (سینیٹ) میں ممبران کی تعداد'))).toBe(false);
  });
});

describe('r9 · subjects without a cross-section table lay out as before', () => {
  test('a science paper laid out twice is identical, and nothing is held', () => {
    const exam = fixture('r7-science-full1.exam');
    const a = applyLayout(clone(exam), P.science, { kind: 'fde', chapters: null, pages: null }, { now: NOW });
    const b = applyLayout(clone(exam), P.science, { kind: 'fde', chapters: null, pages: null }, { now: NOW });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
