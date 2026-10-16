/**
 * Board-pattern checks, round 9: four things code can settle for certain.
 *
 * 1. Maths place-value MCQs ("Which place is the digit 9 in 2,395,140?") are
 *    checked: the place, or the value, of the digit is computed and the key must
 *    name it. A wrong key is held like any two-key MCQ (not placed, slot short).
 *    A digit that appears twice in the number cannot be read: unchecked.
 * 2. A slot that prints its own (a)/(b) label does not print the model's label
 *    again: «(a) (a) Write an application…» becomes «(a) Write an application…».
 * 3. An English Q1(a) MCQ that carries one of Q4's words gives Q4 away: that MCQ
 *    is held (slot short, re-asked). Q4 is never touched.
 * 4. The before-the-exam box says what code did in plain words: «N marking rows
 *    were written from the answer. Check them before marking.»
 *
 * Red fixtures are recorded local papers, copied verbatim (fictional text, no
 * names). Chain: applyLayout → normaliseScheme → renderPaper / renderMarkingScheme.
 */

const fs = require('fs');
const path = require('path');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { mcqPropertyVerdict } = require('../../bot/shared/services/assessment/maths-check');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const P = Patterns.get('fde_g5_2027').subjects;
const NOW = '2026-10-20T07:12:00.000Z';
const FDE = { kind: 'fde', chapters: null, pages: null };
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

// ── 1. Maths place value ───────────────────────────────────────────────────

// Maths chapters_1 Q1(a) iv (round-4 local), verbatim: 9 in 2,395,140 is in the ten thousands place.
const PLACE_IV = { question: 'Which place is the digit 9 in 2,395,140?', options: ['a) Thousands', 'b) Ten thousands', 'c) Hundred thousands', 'd) Hundreds'], answer: 'a) Thousands' };
// Q1(a) i and iii of the same paper: right keys.
const PLACE_I = { question: 'What is the place value of the digit 4 in 3,418,562?', options: ['a) Ten thousands', 'b) Hundred thousands', 'c) Thousands', 'd) Millions'], answer: 'b) Hundred thousands' };
const VALUE_III = { question: 'What is the value of the digit 8 in 8,204,631?', options: ['a) 800,000', 'b) 80,000', 'c) 8,000,000', 'd) 8,000'], answer: 'c) 8,000,000' };

function mathsMcqsWith(item) {
  const list = Array.from({ length: 20 }, (_, i) => (i === 3 ? item : {
    question: `What is ${i + 3} × 4?`,
    options: [`a) ${(i + 3) * 4 + 1}`, `b) ${(i + 3) * 4}`, `c) ${(i + 3) * 4 - 2}`, `d) ${(i + 3) * 4 + 5}`],
    answer: `b) ${(i + 3) * 4}`,
  })).map((q) => ({ slot: 'maths.A.Q1a', marks: 1, ...q }));
  return { unseen: { objective: { MCQs: list } } };
}
function laidMaths(item) {
  const out = applyLayout(mathsMcqsWith(item), P.maths, FDE, { now: NOW });
  return { gone: !out.examJson.unseen.objective.MCQs.some((q) => q.question === item.question), short: out.shortfall.find((s) => s.slot === 'maths.A.Q1a') };
}

describe('1. maths place-value MCQ oracle', () => {
  it('chapters_1 Q1(a) iv: 9 in 2,395,140 keyed Thousands → held, slot short', () => {
    expect(mcqPropertyVerdict(PLACE_IV)).toEqual({ ok: false, passing: ['b'] });
    expect(laidMaths(PLACE_IV)).toEqual({ gone: true, short: { slot: 'maths.A.Q1a', missing: 1 } });
  });

  it('the same item keyed Ten thousands → kept', () => {
    const right = { ...PLACE_IV, answer: 'b) Ten thousands' };
    expect(mcqPropertyVerdict(right)).toEqual({ ok: true });
    expect(laidMaths(right)).toEqual({ gone: false, short: undefined });
  });

  it('right keys on the same paper stay placed (place value names, value as a number)', () => {
    for (const item of [PLACE_I, VALUE_III]) {
      expect([item.question, mcqPropertyVerdict(item)]).toEqual([item.question, { ok: true }]);
      expect(laidMaths(item).gone).toBe(false);
    }
  });

  it('the other wordings are read', () => {
    const cases = [
      [{ question: 'In which place is the digit 6 in 46,215?', options: ['a) Tens', 'b) Hundreds', 'c) Thousands', 'd) Ten thousands'], answer: 'c) Thousands' }, { ok: true }],
      [{ question: 'In which place is the digit 6 in 46,215?', options: ['a) Tens', 'b) Hundreds', 'c) Thousands', 'd) Ten thousands'], answer: 'd) Ten thousands' }, { ok: false, passing: ['c'] }],
      [{ question: 'What is the place value of 7 in 573,018?', options: ['a) 7,000', 'b) 70,000', 'c) 700', 'd) 700,000'], answer: 'b) 70,000' }, { ok: true }],
      [{ question: 'What is the place value of 7 in 573,018?', options: ['a) 7,000', 'b) 70,000', 'c) 700', 'd) 700,000'], answer: 'a) 7,000' }, { ok: false, passing: ['b'] }],
      [{ question: 'Find the value of the digit 3 in 1,234,567.', options: ['a) 30,000', 'b) 3,000', 'c) 300,000', 'd) 300'], answer: 'a) 30,000' }, { ok: true }],
      [{ question: 'Which place does the digit 5 have in 2,583,016?', options: ['a) Millions', 'b) Hundred thousands', 'c) Ten thousands', 'd) Thousands'], answer: 'b) Hundred thousands' }, { ok: true }],
      [{ question: 'Which place is the digit 9 in 2,395,140?', options: ['a) Thousands place', 'b) Ten thousands place', 'c) Hundred thousands place', 'd) Hundreds place'], answer: 'b) Ten thousands place' }, { ok: true }],
    ];
    for (const [item, want] of cases) expect([item.question, item.answer, mcqPropertyVerdict(item)]).toEqual([item.question, item.answer, want]);
  });

  it('a digit that appears twice → unchecked, never held', () => {
    const twice = { question: 'Which place is the digit 4 in 4,415,230?', options: ['a) Millions', 'b) Hundred thousands', 'c) Ten thousands', 'd) Thousands'], answer: 'a) Millions' };
    expect(mcqPropertyVerdict(twice)).toEqual({ ok: null });
    expect(mcqPropertyVerdict({ ...twice, question: 'What is the value of the digit 4 in 4,415,230?', options: ['a) 4,000,000', 'b) 400,000', 'c) 40,000', 'd) 4,000'] })).toEqual({ ok: null });
    expect(laidMaths(twice).gone).toBe(false);
  });

  it('a "which place" stem with number options, or a stem about a method, is unchecked', () => {
    expect(mcqPropertyVerdict({ question: 'Which place is the digit 9 in 2,395,140?', options: ['a) 9,000', 'b) 90,000', 'c) 900', 'd) 900,000'], answer: 'b) 90,000' })).toEqual({ ok: null });
    expect(mcqPropertyVerdict({ question: 'Which place is next to the thousands place?', options: ['a) Hundreds', 'b) Ten thousands', 'c) Tens', 'd) Ones'], answer: 'b) Ten thousands' })).toEqual({ ok: null });
  });
});

// ── 2. Doubled alternative label ──────────────────────────────────────────

// English full_1 (round-3 sandbox paper, stored as laid out): Q7's two items carry the
// model's own «(a)» / «(b)» and the slot numbers them again.
const EN_FULL_1 = () => fixture('r9-english-full1');
const q7Of = (exam) => exam.unseen.subjective['Application Writing'];
const paperText = (exam) => visible(R.renderPaper({ examJson: exam, grade: 5, subject: 'english', answerLines: true }));
const schemeHtml = (exam) => R.renderMarkingScheme({ examJson: exam, grade: 5, subject: 'english' });

describe('2. a slot that prints its own label does not print the model\'s label again', () => {
  it('full_1 Q7 «(a) (a) Write an application…» → «(a) Write an application…»', () => {
    const exam = EN_FULL_1();
    expect(q7Of(exam)[0].question).toBe('(a) Write an application to your principal for sick leave.');
    const text = paperText(exam);
    expect(text).not.toMatch(/\(a\) \(a\)/);
    expect(text).not.toMatch(/\(b\) \(b\)/);
    expect(text).toContain('(a) Write an application to your principal for sick leave.');
    expect(text).toContain('(b) Write a letter to your friend thanking them for a gift.');
  });

  it('the scheme row does not print the model\'s label under its own number either', () => {
    const html = schemeHtml(EN_FULL_1());
    expect(html).toContain('<div class="q-line">Write an application to your principal for sick leave.</div>');
    expect(html).toContain('<div class="q-line">Write a letter to your friend thanking them for a gift.</div>');
  });

  it('the paper and scheme are exactly what a stem with no label of its own gives', () => {
    const bare = EN_FULL_1();
    q7Of(bare).forEach((q) => { q.question = q.question.replace(/^\([ab]\)\s*/, ''); });
    const R2 = (exam) => R.renderPaper({ examJson: exam, grade: 5, subject: 'english', answerLines: true });
    expect(R2(EN_FULL_1())).toBe(R2(bare));
    expect(schemeHtml(EN_FULL_1())).toBe(schemeHtml(bare));
  });

  it('only a leading label is stripped: «(a)» inside the stem stays', () => {
    const exam = EN_FULL_1();
    q7Of(exam)[0].question = 'Write a note: say whether (a) or (b) is better.';
    expect(paperText(exam)).toContain('(a) Write a note: say whether (a) or (b) is better.');
  });

  it('a slot that prints no (a)/(b) number of its own keeps a leading «(a)»', () => {
    const exam = EN_FULL_1();
    const story = exam.unseen.subjective['Story Writing'][0];
    story.question = '(a) Write a story using the cues below.';
    expect(paperText(exam)).toContain('(a) Write a story using the cues below.');
  });
});

// ── 3. Section A gives Section C away ──────────────────────────────────────

// English chapters_1 (round-4 local), verbatim: MCQs xii–xiv ask the meaning of three of Q4's words.
const Q4 = {
  slot: 'english.C.Q4',
  main_question: 'Write the meaning of each given word and use any five of the words in sentences of your own',
  question: 'Write the meaning of each word. Then use any five words in sentences.',
  words: ['invisible', 'shrugs', 'forgiveness', 'annoyance', 'invent', 'baffled'],
  answer: 'invisible: cannot be seen - The air is invisible.',
  scheme: { points: [{ kind: 'A', marks: 5, text: 'Correct meanings' }, { kind: 'A', marks: 5, text: 'Correct sentences' }] },
};
const XI = { question: "What does the suffix '-less' mean in the word 'careless'?", options: ['a) full of', 'b) before', 'c) without', 'd) wrong'], answer: 'c) without' };
const XII = { question: "What does the word 'invisible' mean?", options: ['a) very loud', 'b) cannot be seen', 'c) very fast', 'd) easy to break'], answer: 'b) cannot be seen' };
const XIII = { question: "What does 'forgiveness' mean?", options: ['a) feeling irritated', 'b) raising shoulders', 'c) creating something new', 'd) letting go of a grudge'], answer: 'd) letting go of a grudge' };
const XIV = { question: "What does the word 'invent' mean?", options: ['a) to create something that never existed before', 'b) to destroy something', 'c) to find a lost thing', 'd) to copy a drawing'], answer: 'a) to create something that never existed before' };

function englishPaper(at, q4 = Q4) {
  const list = Array.from({ length: 20 }, (_, i) => (at[i] || {
    question: `Which word is a noun? (${i + 1})`,
    options: ['a) run', `b) table${i}`, 'c) quickly', 'd) blue'],
    answer: `b) table${i}`,
  })).map((q) => ({ slot: 'english.A.Q1a', marks: 1, ...q }));
  const subjective = q4 ? { 'Word Sentences': [clone(q4)] } : {};
  return { unseen: { objective: { MCQs: list }, subjective } };
}

function laidQ1a(exam) {
  const out = applyLayout(exam, P.english, FDE, { now: NOW });
  return {
    questions: out.examJson.unseen.objective.MCQs.map((q) => q.question),
    q4: out.examJson.unseen.subjective['Word Sentences'],
    short: out.shortfall.find((s) => s.slot === 'english.A.Q1a'),
    out,
  };
}

describe('3. an English Q1(a) MCQ that carries a Q4 word is held', () => {
  it('chapters_1 MCQs xii–xiv (invisible, forgiveness, invent) → held, slot 3 short; xi kept', () => {
    const r = laidQ1a(englishPaper({ 10: XI, 11: XII, 12: XIII, 13: XIV }));
    expect(r.questions).toContain(XI.question);
    for (const q of [XII, XIII, XIV]) expect(r.questions).not.toContain(q.question);
    expect(r.short).toEqual({ slot: 'english.A.Q1a', missing: 3 });
  });

  it('Q4 is never touched', () => {
    const r = laidQ1a(englishPaper({ 11: XII, 12: XIII, 13: XIV }));
    expect(r.q4).toHaveLength(1);
    expect(r.q4[0].words).toEqual(Q4.words);
    expect(r.q4[0].question).toBe(Q4.question);
    expect(r.out.shortfall.find((s) => s.slot === 'english.C.Q4')).toBeUndefined();
  });

  it('a Q4 word in an option gives it away too; case does not matter', () => {
    const inOption = { question: 'Which word means "puzzled"?', options: ['a) Baffled', 'b) happy', 'c) tall', 'd) quick'], answer: 'a) Baffled' };
    expect(laidQ1a(englishPaper({ 5: inOption })).questions).not.toContain(inOption.question);
  });

  it('a whole word only: «invention» or «visible» do not match «invent» / «invisible»', () => {
    const near = { question: "What is the noun formed from 'discover'? (e.g. invention)", options: ['a) visible', 'b) inventor', 'c) discovery', 'd) inventive'], answer: 'c) discovery' };
    const r = laidQ1a(englishPaper({ 5: near }));
    expect(r.questions).toContain(near.question);
    expect(r.short).toBeUndefined();
  });

  it('no Q4 on the paper → Q1(a) as before', () => {
    const r = laidQ1a(englishPaper({ 11: XII, 12: XIII, 13: XIV }, null));
    expect(r.short).toBeUndefined();
    expect(r.questions).toContain(XII.question);
  });

  it('a Maths paper is never read for Q4 words', () => {
    const exam = mathsMcqsWith({ question: 'What is the value of the digit 8 in 8,204,631?', options: ['a) 800,000', 'b) 80,000', 'c) 8,000,000', 'd) 8,000'], answer: 'c) 8,000,000' });
    exam.unseen.subjective = { 'Word Sentences': [clone(Q4)] };
    const out = applyLayout(exam, P.maths, FDE, { now: NOW });
    expect(out.shortfall.find((s) => s.slot === 'maths.A.Q1a')).toBeUndefined();
  });
});

// ── 4. The scheme box line ─────────────────────────────────────────────────

describe('4. the before-the-exam box says what code wrote, in plain words', () => {
  const box = (html) => {
    const at = html.indexOf('<div class="box before">');
    return visible(html.slice(at, html.indexOf('</ol>', at)));
  };
  function sst(shortfall, medium = 'en') {
    const exam = clone(fixture('r7-sst-item-text'));
    exam._layout.medium = medium;
    if (shortfall !== undefined) exam._layout.scheme_shortfall = shortfall;
    return exam;
  }
  const schemeOf = (exam) => R.renderMarkingScheme({ examJson: exam, grade: 5, subject: 'social_studies' });
  const row = (item, part = null) => ({ slot: 'social_studies.A.Q1', item, part, filled_by: 'code' });

  it('two rows (EN)', () => {
    const text = box(schemeOf(sst([row(0), row(1)])));
    expect(text).toContain('2 marking rows were written from the answer. Check them before marking.');
    expect(text).not.toMatch(/filled by code/);
  });

  it('one row (EN)', () => {
    const text = box(schemeOf(sst([row(0)])));
    expect(text).toContain('1 marking row was written from the answer. Check it before marking.');
    expect(text).not.toMatch(/filled by code/);
  });

  it('Urdu, Urdu digits', () => {
    expect(box(schemeOf(sst([row(0)], 'ur')))).toContain('۱ مارکنگ قطار جواب سے لکھی گئی۔ نمبر دینے سے پہلے اسے جانچ لیں۔');
    expect(box(schemeOf(sst([row(0), row(1, 'a')], 'ur')))).toContain('۲ مارکنگ قطاریں جواب سے لکھی گئیں۔ نمبر دینے سے پہلے انہیں جانچ لیں۔');
  });

  it('no shortfall: the box carries no such line', () => {
    expect(box(schemeOf(sst(undefined)))).not.toMatch(/written from the answer|filled by code/);
  });
});
