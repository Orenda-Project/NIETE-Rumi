/**
 * Board-pattern papers, round 6 (second pass): what the first sandbox papers showed.
 *
 *   1. A source, chapter, lesson or thinking-level tag the model appends to an item
 *      ("(Based on the chapter/concept: …)", "(Remember)", «(سبق: …)») never prints:
 *      the prompt forbids it and the layout strips it from every stem.
 *   2. A paper set from pages says "these pages" / «انہی صفحات», not units or chapters.
 *   3. Science Q2(b): a situation whose answer is written on the parent as
 *      "a) … b) … c) …" prints each part's own answer (no empty answer rows).
 */

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const P = Patterns.get('fde_g5_2027').subjects;
const NOW = '2026-10-20T07:12:00.000Z';
const FDE = { kind: 'fde', chapters: null, pages: null };
const visible = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

function prompt(subject, sectionId, scope = FDE) {
  const S = P[subject];
  const section = S.sections.find((s) => s.id === sectionId);
  return Gen.buildPatternUserPrompt({
    grade: 5, subject, pageContent: 'Book text.', pageReference: '1-20',
    section, slots: section.slots, lang: S.medium, P: S, scope,
  });
}

const NO_TAGS = 'Never add a source, chapter, lesson or thinking-level tag to an item, such as \'(Based on the chapter/concept: …)\', \'(Remember)\' or \'(Understand)\'; the stem ends with the question itself.';

const mcq = (i, tail) => ({
  slot: 'maths.A.Q1a', question: `What is ${i + 2} × 3?${tail}`, options: [`${(i + 2) * 3}`, `${(i + 2) * 3 + 1}`, `${(i + 2) * 3 + 2}`, `${(i + 2) * 3 + 3}`], answer: 'a', marks: 1, blooms: 'Remember',
});

describe('1. no appended tags', () => {
  test('no appended tags rule', () => {
    expect(prompt('maths', 'A')).toContain(NO_TAGS);
    expect(prompt('urdu', 'A')).toContain(NO_TAGS);
  });

  test('the layout strips a trailing source, chapter, lesson or level tag from a stem', () => {
    const tails = [' (Based on the chapter/concept: Number Safari, place value)', ' (Remember)', ' (Understand)',
      ' (Based on the passage above)', ' (Based on the chapter: Discovering Our Superpowers!)', ' (Apply) (Based on the concept: tables)'];
    const items = tails.map((t, i) => mcq(i, t));
    const laid = applyLayout({ unseen: { objective: { MCQs: items } } }, P.maths, FDE, { now: NOW }).examJson;
    const stems = laid.unseen.objective.MCQs.map((q) => q.question);
    expect(stems).toEqual(tails.map((_, i) => `What is ${i + 2} × 3?`));
    const paper = visible(R.renderPaper({ examJson: laid, grade: 5, subject: 'maths', allowShort: true }));
    expect(paper).not.toMatch(/Based on the|\((Remember|Understand|Apply)\)/);
  });

  test('an Urdu lesson tag is stripped; a parenthesis that belongs to the question stays', () => {
    const items = [
      { slot: 'maths.A.Q1a', question: 'Find the length (in cm) of the side.', options: ['4', '5', '6', '7'], answer: 'a', marks: 1, blooms: 'Remember' },
      { slot: 'maths.A.Q1a', question: 'Which is the smallest (a fraction)?', options: ['1/2', '1/3', '1/4', '1/5'], answer: 'd', marks: 1, blooms: 'Remember' },
    ];
    const laid = applyLayout({ unseen: { objective: { MCQs: items } } }, P.maths, FDE, { now: NOW }).examJson;
    expect(laid.unseen.objective.MCQs.map((q) => q.question)).toEqual(items.map((q) => q.question));

    const ur = { slot: 'urdu.A.Q1', question: 'درست جواب منتخب کریں (سبق: ایک فرضی کہانی)', options: ['الف', 'ب', 'ج', 'د'], answer: 'a', marks: 1, blooms: 'Remember' };
    const raw = { unseen: { objective: { MCQs: [ur] } } };
    const out = applyLayout(raw, P.urdu, FDE, { now: NOW }).examJson;
    const stems = Object.values(out.unseen.objective).flat().map((q) => q.question);
    expect(stems).toContain('درست جواب منتخب کریں');
  });

  test('sub-questions and a situation lead lose their tags too', () => {
    const q = {
      slot: 'science.B.Q2b', main_question: 'Answer any two. (Based on the chapter: Our Senses)',
      question: 'A child closes their eyes and listens. (Apply)',
      questions: [{ question: 'a) Which sense is used? (Remember)' }, { question: 'b) Why? (Understand)' }, { question: 'c) What if the ears are covered?' }],
      marks: 5, answer: 'a) Hearing. b) Sound reaches the ears. c) Less sound is heard.', blooms: 'Apply',
    };
    const laid = applyLayout({ unseen: { subjective: { 'Logical Reasoning': [q] } } }, P.science, FDE, { now: NOW }).examJson;
    const got = Object.values(laid.unseen.subjective).flat()[0];
    expect([got.main_question, got.question, ...got.questions.map((s) => s.question)])
      .toEqual(['Answer any two.', 'A child closes their eyes and listens.', 'a) Which sense is used?', 'b) Why?', 'c) What if the ears are covered?']);
  });
});

describe('2. the covers line of a pages paper', () => {
  test('a pages paper says these pages, not units or chapters', () => {
    const scope = { kind: 'pages', chapters: null, pages: '1-12, 14-40' };
    for (const subject of ['maths', 'science', 'urdu']) {
      const s = applyLayout({ unseen: {} }, P[subject], scope, { now: NOW }).examJson._layout.scope;
      expect(s.covers_en).toBe('Covers pp 1-12, 14-40; every section set from these pages.');
      expect(s.covers_ur).not.toMatch(/ابواب|اسباق/);
      expect(s.covers_ur).toContain('انہی صفحات');
    }
  });

  test('a chapters paper keeps its unit word', () => {
    const s = applyLayout({ unseen: {} }, P.maths, { kind: 'chapters', chapters: [1, 2], pages: null }, { now: NOW }).examJson._layout.scope;
    expect(s.covers_en).toBe('Covers Units 1–2; every section set from these units.');
  });
});

describe('3. Science Q2(b) answers written on the parent', () => {
  test('each part prints its own answer from the parent "a) … b) … c)" (no empty answer rows)', () => {
    const q = {
      slot: 'science.B.Q2b', main_question: 'Give answers with logical reasons. Answer any TWO of the three questions.',
      question: 'A child sits with their eyes closed, listens to a bell, then touches a rough brick.',
      questions: [{ question: 'a) Which sense organs are used?', marks: 2, lines: 3 }, { question: 'b) How is rough told from smooth?', marks: 2, lines: 3 }, { question: 'c) What if the ears were covered?', marks: 1, lines: 3 }],
      marks: 5, lines: 0, blooms: 'Apply',
      answer: 'a) Ears and skin. b) The skin sends signals to the brain. c) Less sound would be heard.',
    };
    const laid = applyLayout({ unseen: { subjective: { 'Logical Reasoning': [q, { ...q, question: `${q.question} Then a smooth glass.` }] } } }, P.science, FDE, { now: NOW }).examJson;
    const scheme = R.renderMarkingScheme({ examJson: normaliseScheme(laid).examJson, grade: 5, subject: 'science', allowShort: true });
    const rows = [...scheme.matchAll(/<tr data-row="science\.B\.Q2b">([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows.filter((r) => /<td class="ans"><b><\/b><\/td>/.test(r))).toEqual([]);
    expect(visible(scheme)).toContain('The skin sends signals to the brain.');
  });
});
