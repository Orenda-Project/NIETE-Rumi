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
    // Science and Urdu list no unit pages. For Maths these pages are exactly
    // Units 1–2, which name the units instead (fde-r7-render.test.js).
    const scope = { kind: 'pages', chapters: null, pages: '1-12, 14-40' };
    for (const subject of ['science', 'urdu']) {
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

describe('4. a key that converts twice is never "corrected" to its first conversion', () => {
  const { mathsCheck } = require('../../bot/shared/services/assessment/maths-check');
  test('3/4 = 0.75 = 75% keeps its percentage', () => {
    const items = [{ slot: 'maths.B.Q2', question: 'Convert the fraction 3/4 into a decimal and then express it as a percentage.', answer: '3/4 = 0.75 = 75%', blooms: 'Apply' },
      { slot: 'maths.B.Q2', question: 'Write 2/5 as a decimal and then as a percentage.', answer: '2/5 = 0.4 = 40%', blooms: 'Apply' }];
    const laid = applyLayout({ unseen: { subjective: { 'Word Problems': items } } }, P.maths, FDE, { now: NOW });
    const out = mathsCheck(normaliseScheme(laid.examJson).examJson, { subject: 'maths' }).examJson;
    const got = Object.values(out.unseen.subjective).flat();
    expect(got.map((q) => q.answer)).toEqual(['3/4 = 0.75 = 75%', '2/5 = 0.4 = 40%']);
    got.forEach((q) => expect(q.scheme.checked).toBe('ok'));
    expect(out._layout.notes.filter((n) => /corrected by code/.test(n.text_en || ''))).toEqual([]);
  });
  test('a percent-of stem keeps its own check: a wrong key is corrected, never passed as ok', () => {
    const items = [{ slot: 'maths.B.Q2', question: 'What is 20% of 150?', answer: '20%', blooms: 'Apply' },
      { slot: 'maths.B.Q2', question: 'What is 1% of 50?', answer: '50%', blooms: 'Apply' }];
    const laid = applyLayout({ unseen: { subjective: { 'Word Problems': items } } }, P.maths, FDE, { now: NOW });
    const out = mathsCheck(normaliseScheme(laid.examJson).examJson, { subject: 'maths' }).examJson;
    const got = Object.values(out.unseen.subjective).flat();
    expect(got.map((q) => q.scheme.checked)).toEqual(['replaced', 'replaced']);
  });
  test('a wrong percentage after the decimal is still not "corrected" to the decimal', () => {
    const items = [{ slot: 'maths.B.Q2', question: 'Convert the fraction 3/4 into a decimal and then express it as a percentage.', answer: '3/4 = 0.75 = 70%', blooms: 'Apply' }];
    const laid = applyLayout({ unseen: { subjective: { 'Word Problems': items } } }, P.maths, FDE, { now: NOW });
    const out = mathsCheck(normaliseScheme(laid.examJson).examJson, { subject: 'maths' }).examJson;
    const [q] = Object.values(out.unseen.subjective).flat();
    expect(q.answer).not.toBe('3/4 = 0.75 = 0.75%');
  });
});

describe('5. the Science diagram page comes from the item, never the pattern default', () => {
  const diagram = (bookPage) => ({
    unseen: { subjective: { Diagram: [{ slot: 'science.A.Q1b', question: 'Respiratory System', book_page: bookPage, answer: 'nose, windpipe, lungs, air sacs, diaphragm', marks: 5, blooms: 'Remember' }] } },
  });
  const supplyOf = (bookPage) => applyLayout(diagram(bookPage), P.science, FDE, { now: NOW }).examJson._layout.supplies.find((s) => s.kind === 'diagram');

  test('a page written as "Page 7" or "p. 7" is page 7', () => {
    expect(supplyOf('Page 7').book_page).toBe(7);
    expect(supplyOf('p. 7').book_page).toBe(7);
    expect(supplyOf(68).book_page).toBe(68);
  });

  test('a page that does not parse, or none, prints no page and names the book diagram', () => {
    for (const bad of ['the book figure', null, undefined, '', 'Chapter 2']) {
      const s = supplyOf(bad);
      expect(s.book_page).toBe(null);
      expect(s.line_en).not.toMatch(/168|book p\./);
    }
    const laid = applyLayout(diagram('the book figure'), P.science, FDE, { now: NOW }).examJson;
    const scheme = visible(R.renderMarkingScheme({ examJson: normaliseScheme(laid).examJson, grade: 5, subject: 'science', allowShort: true }));
    expect(scheme).not.toMatch(/book p\. 168|\(book p\./);
    expect(scheme).toContain("the book's diagram");
  });
});

describe('6. Science Q2(b): every sub-question is marked out of 2.5', () => {
  const situation = (subs) => ({
    slot: 'science.B.Q2b', main_question: 'Give answers with logical reasons. Answer any TWO of the three questions.',
    question: 'A child plays a game with their eyes closed and names each sound.', marks: 5, blooms: 'Apply', scheme: { points: [] },
    questions: subs,
  });
  const run = (subs) => {
    const raw = { unseen: { subjective: { 'Logical Reasoning': [situation(subs), situation(subs.map((s) => ({ ...s, question: `${s.question} Again.` })))] } } };
    const laid = applyLayout(raw, P.science, FDE, { now: NOW }).examJson;
    return normaliseScheme(laid).examJson;
  };
  const partsOf = (ex) => Object.values(ex.unseen.subjective).flat()[0].questions;
  const sum = (sub) => sub.scheme.points.reduce((t, p) => t + p.marks, 0);

  test('points that sum to less than 2.5 are scaled to 2.5, kinds and text kept', () => {
    const subs = [
      { question: 'Which senses are used?', answer: 'Hearing and touch.', scheme: { points: [{ text: 'Both senses named', marks: 1, kind: 'K' }] } },
      { question: 'Why close the eyes?', answer: 'To listen better.', scheme: { points: [{ text: 'Reason linked to hearing', marks: 0.5, kind: 'A' }] } },
      { question: 'What if the ears were covered?', answer: 'Less would be heard.', scheme: { points: [{ text: 'Less sound', marks: 1, kind: 'K' }, { text: 'Reason', marks: 1, kind: 'A' }] } },
    ];
    const parts = partsOf(run(subs));
    parts.forEach((sub) => expect(sum(sub)).toBe(2.5));
    expect(parts[0].scheme.points).toEqual([{ text: 'Both senses named', marks: 2.5, kind: 'K' }]);
    expect(parts[2].scheme.points.map((p) => p.kind)).toEqual(['K', 'A']);
  });

  test('a sub-question with no points prints its bare 2.5 chip; a 2.5 split is left alone', () => {
    const subs = [
      { question: 'Which senses are used?', answer: 'Hearing and touch.', marks: 1 },
      { question: 'Why close the eyes?', answer: 'To listen better.', marks: 2, scheme: { points: [] } },
      { question: 'What if the ears were covered?', answer: 'Less would be heard.', scheme: { points: [{ text: 'Less sound', marks: 1, kind: 'K' }, { text: 'Reason', marks: 1.5, kind: 'A' }] } },
    ];
    const ex = run(subs);
    const parts = partsOf(ex);
    expect(parts[2].scheme.points).toEqual([{ text: 'Less sound', marks: 1, kind: 'K' }, { text: 'Reason', marks: 1.5, kind: 'A' }]);
    // The item still counts as its slot's 5 wherever marks are summed (editor, budget).
    const Selection = require('../../bot/shared/services/assessment/assessment-selection');
    expect(Selection.marksOf(Object.values(ex.unseen.subjective).flat()[0])).toBe(5);
    const scheme = visible(R.renderMarkingScheme({ examJson: ex, grade: 5, subject: 'science', allowShort: true }));
    expect(scheme).toContain('a) Hearing and touch. 2.5');
    expect(scheme).toContain('b) To listen better. 2.5');
    expect(scheme).not.toMatch(/Hearing and touch\. K?1\b/);
  });
});

describe('7. a slot head that names its item names it in the scheme too', () => {
  test('English Q5 / Q6 scheme heads print the poem and topic, never "{q}"', () => {
    const raw = { unseen: { subjective: {
      'Rhyming Words': [{ slot: 'english.C.Q5', question: 'The Kite', passage: 'A kite so high\nUp in the sky\nIt flies so far\nNear every star', answer: 'high – sky; far – star', blooms: 'Remember' }],
      'Mind Map': [{ slot: 'english.C.Q6', question: 'Healthy Food', answer: 'fruit, vegetables, milk, water, rest', blooms: 'Create' }],
    } } };
    const laid = applyLayout(raw, P.english, FDE, { now: NOW }).examJson;
    const ex = normaliseScheme(laid).examJson;
    const scheme = visible(R.renderMarkingScheme({ examJson: ex, grade: 5, subject: 'english', allowShort: true }));
    const paper = visible(R.renderPaper({ examJson: ex, grade: 5, subject: 'english', allowShort: true }));
    expect(scheme).not.toContain('{q}');
    expect(scheme).toContain('Write down FOUR rhyming words from the poem “The Kite”');
    expect(scheme).toContain('Develop a mind map about “Healthy Food”.');
    expect(paper).toContain('Write down FOUR rhyming words from the poem “The Kite”');
  });
});

describe('8. MCQs: one right option, options only in `options`', () => {
  const ONE_CORRECT = 'Every MCQ has exactly one correct option: check that no other option is also true (another number that fits the rule, a second work by the same author, a value equal to the key).';
  const OPTIONS_ONLY = 'Write the four options only in `options`; never list (a), (b), (c), (d) inside the question.';

  test('one correct option and options-only rules on every MCQ section', () => {
    for (const subject of ['maths', 'science', 'english', 'urdu']) {
      const text = prompt(subject, 'A');
      expect([subject, text.includes(ONE_CORRECT)]).toEqual([subject, true]);
      expect([subject, text.includes(OPTIONS_ONLY)]).toEqual([subject, true]);
    }
  });

  test('an option list written inside an MCQ stem is stripped; the options row stays', () => {
    const items = [
      { slot: 'maths.A.Q1a', question: 'In 4,56,789 the digit 4 is in which place? (a) Lakhs (b) Ten thousands (c) Thousands (d) Millions', options: ['Lakhs', 'Ten thousands', 'Thousands', 'Millions'], answer: 'a', marks: 1, blooms: 'Remember' },
      { slot: 'maths.A.Q1a', question: 'Which is greatest? a) 0.5 b) 0.05 c) 0.55 d) 0.505', options: ['0.5', '0.05', '0.55', '0.505'], answer: 'c', marks: 1, blooms: 'Remember' },
      { slot: 'maths.A.Q1a', question: 'Find the side (a) of a square of area 49 cm².', options: ['6 cm', '7 cm', '8 cm', '9 cm'], answer: 'b', marks: 1, blooms: 'Apply' },
      { slot: 'maths.A.Q1a', question: 'Round 234,567 to the nearest thousand. (a) 234,000 (b) 235,000 (c) 234,500 (d) 230,000', options: ['a) 234,500', 'b) 230,000', 'c) 234,000', 'd) 235,000'], answer: 'd) 235,000', marks: 1, blooms: 'Apply' },
      { slot: 'maths.A.Q1a', question: 'Pick one: (a) a cat (b) a dog (c) a cow (d) a hen, then say why.', options: ['3', '4', '5', '6'], answer: 'a', marks: 1, blooms: 'Remember' },
      { slot: 'maths.A.Q1a', question: 'Read the statements: (a) 2 is prime (b) 4 is prime (c) 5 is prime (d) 9 is prime. How many are true?', options: ['1', '2', '3', '4'], answer: 'b', marks: 1, blooms: 'Understand' },
      { slot: 'maths.A.Q1a', question: 'Parts (a) 1 (b) 2 (c) 3 (d) 4 are marked. Find part (c).', options: ['1', '2', '3', '4'], answer: 'c', marks: 1, blooms: 'Remember' },
    ];
    const laid = applyLayout({ unseen: { objective: { MCQs: items } } }, P.maths, FDE, { now: NOW }).examJson;
    expect(laid.unseen.objective.MCQs.map((q) => q.question)).toEqual([
      'In 4,56,789 the digit 4 is in which place?', 'Which is greatest?', 'Find the side (a) of a square of area 49 cm².',
      'Round 234,567 to the nearest thousand.', 'Pick one: (a) a cat (b) a dog (c) a cow (d) a hen, then say why.',
      'Read the statements: (a) 2 is prime (b) 4 is prime (c) 5 is prime (d) 9 is prime. How many are true?',
      'Parts (a) 1 (b) 2 (c) 3 (d) 4 are marked. Find part (c).']);
  });

  test('a long stem is scanned in linear time', () => {
    const stem = '(a) x (b) y (c) z '.repeat(600);
    const t0 = Date.now();
    applyLayout({ unseen: { objective: { MCQs: [{ slot: 'maths.A.Q1a', question: stem, options: ['x', 'y', 'z', 'w'], answer: 'a', marks: 1, blooms: 'Remember' }] } } }, P.maths, FDE, { now: NOW });
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe('9. Urdu Q4 items carry their directive', () => {
  test('the Q4 directive rule is in the Urdu section C prompt', () => {
    expect(prompt('urdu', 'C')).toContain('Each Q4 item\'s `question` starts with its own directive in Urdu');
  });
});

describe('10. a remainder key is checked', () => {
  const { mathsCheck } = require('../../bot/shared/services/assessment/maths-check');
  const check = (answers) => {
    const items = answers.map((answer, i) => ({ slot: 'maths.B.Q2', question: `Share problem ${i}: how many each, and how many left?`, answer, blooms: 'Apply' }));
    const laid = applyLayout({ unseen: { subjective: { 'Word Problems': items } } }, P.maths, FDE, { now: NOW });
    return Object.values(mathsCheck(normaliseScheme(laid.examJson).examJson, { subject: 'maths' }).examJson.unseen.subjective).flat();
  };
  test('a wrong remainder is corrected; a right one is ok; a wrong quotient is left unchecked', () => {
    const [a, b, c, d, e] = check(['68,970 ÷ 45 = 1,532 remainder 10', '68,970 ÷ 45 = 1,532 remainder 30', '68,970 ÷ 45 = 1,500 remainder 30', '100 ÷ 7 = 14 R 2', '103 ÷ 4 = 25, remainder 4, so 25 each']);
    expect([e.answer, e.scheme.checked]).toEqual(['103 ÷ 4 = 25, remainder 3, so 25 each', 'replaced']);
    expect([a.answer, a.scheme.checked]).toEqual(['68,970 ÷ 45 = 1,532 remainder 30', 'replaced']);
    expect(b.scheme.checked).toBe('ok');
    expect([c.answer, c.scheme.checked]).toEqual(['68,970 ÷ 45 = 1,500 remainder 30', null]);
    expect(d.scheme.checked).toBe('ok');
  });
});

describe('11. "Tell the class" lists only real choices', () => {
  test('a group cut to its attempt count is not "any 7 of 7"', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ slot: 'maths.B.Q2', question: `Problem ${i + 1}: find the total of ${i + 10} and ${i + 20}.`, answer: `${i + 10} + ${i + 20} = ${2 * i + 30}`, blooms: 'Apply' }));
    const laid = applyLayout({ unseen: { subjective: { 'Word Problems': items } } }, P.maths, FDE, { now: NOW }).examJson;
    const scheme = visible(R.renderMarkingScheme({ examJson: normaliseScheme(laid).examJson, grade: 5, subject: 'maths', allowShort: true }));
    expect(scheme).not.toMatch(/any 7 of 7|any 0 of 0/);
  });
});

describe('12. no item is set from a religious text (COS ruling 8)', () => {
  const RELIGIOUS = 'Never set an item that quotes, explains or evaluates a religious text (Qur\'an, hadith, the Farewell Sermon, du\'a, Naat, Hamd); set it from another part of the scope.';
  test('the religious-text rule is in every section of every subject', () => {
    for (const subject of Object.keys(P)) {
      for (const section of P[subject].sections) {
        expect([subject, section.id, prompt(subject, section.id).includes(RELIGIOUS)]).toEqual([subject, section.id, true]);
      }
    }
  });
  test('it reaches the SST sections that set the Farewell Sermon items on a chapter paper', () => {
    // social_studies chapters_1 on sandbox set five items on «خطبہ حجۃ الوداع» (date, place, importance).
    const CHAPTERS = { kind: 'chapters', chapters: [1], pages: null };
    for (const id of ['A', 'B', 'C', 'D']) expect(prompt('social_studies', id, CHAPTERS)).toContain(RELIGIOUS);
  });
});
