/**
 * The layout pass, round 5: what a recorded set of board-pattern papers showed.
 *
 *   1. MCQ keys: the model puts most keys on (b) and almost none on (d). The
 *      layout spreads them by turning each item's options round, so no letter
 *      holds more than 35% of a paper, while every key still names the same
 *      answer text. Deterministic (seeded from the paper's own words), and an
 *      item whose options are in an order of their own is never turned.
 *   4. One chapter in scope reads "Unit 3", not "Units 3".
 *   6. Urdu Q6 (the lesson-7 verses): a reply that put the four lines in
 *      `question` gets them moved to `passage`, which is what the paper prints;
 *      a reply with no four lines is not placed, so the slot reports short.
 *
 * Every test goes through applyLayout and then the real renderer.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const englishMcqs = require('./fixtures/fde/r5w2-mcq-english.json');
const urduMcqs = require('./fixtures/fde/r5w2-mcq-urdu-letters.json');
const verses = require('./fixtures/fde/r5w2-urdu-q6.json');

const P = Patterns.get('fde_g5_2027').subjects;
const NOW = '2026-10-20T07:12:00.000Z';
const FDE = { kind: 'fde', chapters: null, pages: null };

const mcqsOf = (examJson) => examJson.unseen.objective.MCQs;

// The letter the stored key names, the way the renderer reads it.
function keyIndex(q) {
  const a = String(q.answer).trim();
  const latin = /^\(?([a-dA-D])\)?(?:[.):\s]|$)/.exec(a);
  if (latin) return latin[1].toLowerCase().charCodeAt(0) - 97;
  const urdu = /^\(?(الف|ب|ج|د)\)?/.exec(a);
  if (urdu) return ['الف', 'ب', 'ج', 'د'].indexOf(urdu[1]);
  return q.options.map(R.bareOption).indexOf(R.bareOption(a));
}

// The answer-key strip as the scheme prints it: one letter per item.
function stripLetters(scheme, slot) {
  const row = new RegExp(`<div class="strip" data-row="${slot.replace(/\./g, '\\.')}">(.*?)</div>`).exec(scheme);
  if (!row) throw new Error(`no answer strip for ${slot}`);
  const cells = row[1].split('<span class="sc">').slice(1).map((c) => c.replace(/<[^>]+>/g, ''));
  return cells.map((c) => c.replace(/[·،]\s*$/, '').trim().split(/\s+/).pop());
}

function tally(list) {
  const out = {};
  list.forEach((k) => { out[k] = (out[k] || 0) + 1; });
  return out;
}

describe('MCQ keys are spread across the letters (item 1)', () => {
  const run = () => applyLayout(englishMcqs, P.english, FDE, { now: NOW }).examJson;

  it('no letter holds more than 7 of 20 keys in the printed answer strip', () => {
    const examJson = run();
    const scheme = R.renderMarkingScheme({ examJson, grade: 5, subject: 'english', allowShort: true });
    const letters = stripLetters(scheme, 'english.A.Q1a');
    expect(letters).toHaveLength(20);
    const counts = tally(letters);
    expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(7);
    expect(Object.keys(counts).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('every key still names the same answer text, at its new letter', () => {
    const before = new Map(mcqsOf(englishMcqs).map((q) => [q.question, q]));
    const after = mcqsOf(run());
    for (const q of after) {
      const old = before.get(q.question);
      const oldText = R.bareOption(old.options[keyIndex(old)]);
      expect(R.bareOption(q.options[keyIndex(q)])).toBe(oldText);
      // The key keeps its shape: "c) text" with the same text.
      expect(R.bareOption(q.answer)).toBe(R.bareOption(old.answer));
      // Same options, turned round; each keeps the position's own "a) " label.
      expect(q.options.map(R.bareOption).sort()).toEqual(old.options.map(R.bareOption).sort());
      q.options.forEach((o, i) => expect(o.startsWith(`${'abcd'[i]}) `)).toBe(true));
    }
  });

  it('is deterministic: the same paper gives the same letters', () => {
    expect(run()).toEqual(run());
  });

  it('leaves an item with a positional option ("Both are equal") as it was', () => {
    const original = mcqsOf(englishMcqs).find((q) => q.options.some((o) => /Both are equal/.test(o)));
    const laid = mcqsOf(run()).find((q) => q.question === original.question);
    expect(laid.options).toEqual(original.options);
    expect(laid.answer).toBe(original.answer);
  });

  it('leaves numbers printed in order (ascending or descending) in their order', () => {
    const numeric = {
      unseen: {
        objective: {
          MCQs: Array.from({ length: 20 }, (_, i) => ({
            slot: 'maths.A.Q1a',
            question: `Pick ${i + 2} tens`,
            options: i % 2
              ? ['a) 5', `b) ${(i + 2) * 10}`, 'c) 1,000', 'd) Rs. 5,000']
              : ['a) 1 1/2', 'b) 3/4', 'c) 0.5', 'd) 25%'],
            answer: i % 2 ? `b) ${(i + 2) * 10}` : 'b) 3/4',
          })),
        },
      },
    };
    const laid = mcqsOf(applyLayout(numeric, P.maths, FDE, { now: NOW }).examJson);
    laid.forEach((q, i) => {
      expect(q.options).toEqual(numeric.unseen.objective.MCQs[i].options);
      expect(q.answer).toBe(numeric.unseen.objective.MCQs[i].answer);
    });
  });

  it('spreads a maths paper whose number options are not in order (a recorded paper had 13 of 20 on b)', () => {
    const sums = {
      unseen: {
        objective: {
          MCQs: Array.from({ length: 20 }, (_, i) => ({
            slot: 'maths.A.Q1a',
            question: `What is ${i + 3} × 4?`,
            options: [`a) ${(i + 3) * 4 + 1}`, `b) ${(i + 3) * 4}`, `c) ${(i + 3) * 4 - 2}`, `d) ${(i + 3) * 4 + 5}`],
            answer: `b) ${(i + 3) * 4}`,
          })),
        },
      },
    };
    const examJson = applyLayout(sums, P.maths, FDE, { now: NOW }).examJson;
    const scheme = R.renderMarkingScheme({ examJson, grade: 5, subject: 'maths', allowShort: true });
    const letters = stripLetters(scheme, 'maths.A.Q1a');
    expect(Math.max(...Object.values(tally(letters)))).toBeLessThanOrEqual(7);
    mcqsOf(examJson).forEach((q, i) => expect(R.bareOption(q.options[keyIndex(q)])).toBe(String((i + 3) * 4)));
  });

  it('keeps each key shape: "(b)", bare option text, and leaves a text key that starts like a letter', () => {
    const shapes = JSON.parse(JSON.stringify(englishMcqs));
    const list = mcqsOf(shapes);
    list.forEach((q, i) => { q.options = q.options.map(R.bareOption); if (i % 2) q.answer = '(b)'; else q.answer = q.options[1]; });
    list[0].options = ['a dog', 'a cat', 'an owl', 'the hen'];
    list[0].answer = 'a cat';
    const laid = mcqsOf(applyLayout(shapes, P.english, FDE, { now: NOW }).examJson);
    expect(laid[0].options).toEqual(['a dog', 'a cat', 'an owl', 'the hen']);
    expect(laid[0].answer).toBe('a cat');
    const letters = laid.map((q) => 'abcd'[keyIndex(q)]);
    expect(Math.max(...Object.values(tally(letters)))).toBeLessThanOrEqual(7);
    // Item 0 is checked above (the renderer itself reads "a cat" as (a); not this pass's to change).
    laid.slice(1).forEach((q, j) => {
      const i = j + 1;
      if (i % 2) expect(q.answer).toMatch(/^\([a-d]\)$/);
      expect(q.options[keyIndex(q)]).toBe(R.bareOption(list[i].options[1]));
    });
  });

  it('works on a paper lettered in Urdu (الف/ب/ج/د)', () => {
    const examJson = applyLayout(urduMcqs, P.social_studies, FDE, { now: NOW }).examJson;
    const scheme = R.renderMarkingScheme({ examJson, grade: 5, subject: 'social_studies', allowShort: true });
    const letters = stripLetters(scheme, 'social_studies.A.Q1');
    expect(letters).toHaveLength(20);
    expect(Math.max(...Object.values(tally(letters)))).toBeLessThanOrEqual(7);
    const before = new Map(mcqsOf(urduMcqs).map((q) => [q.question, q]));
    for (const q of mcqsOf(examJson)) {
      const old = before.get(q.question);
      expect(R.bareOption(q.options[keyIndex(q)])).toBe(R.bareOption(old.options[keyIndex(old)]));
      expect(q.answer).toMatch(/^(الف|ب|ج|د)\) /);
      q.options.forEach((o, i) => expect(o.startsWith(`${['الف', 'ب', 'ج', 'د'][i]}) `)).toBe(true));
    }
  });
});

describe('one chapter in scope is named in the singular (item 4)', () => {
  const scheme = (subject, chapters, raw = { unseen: {} }) => {
    const { examJson } = applyLayout(raw, P[subject], { kind: 'chapters', chapters }, { now: NOW });
    return { examJson, html: R.renderMarkingScheme({ examJson, grade: 5, subject, allowShort: true }) };
  };

  it('Maths, one unit: "Covers Unit 3"', () => {
    const { examJson, html } = scheme('maths', [3]);
    expect(examJson._layout.scope.covers_en).toMatch(/^Covers Unit 3;/);
    expect(examJson._layout.scope.covers_en).not.toMatch(/Units|these units/);
    expect(html).toContain('Covers Unit 3;');
  });

  it('Science, one chapter: "Covers Chapter 2"', () => {
    expect(scheme('science', [2]).examJson._layout.scope.covers_en).toMatch(/^Covers Chapter 2;/);
  });

  it('Urdu, one lesson: the singular «سبق 4»', () => {
    const ur = scheme('urdu', [4]).examJson._layout.scope.covers_ur;
    expect(ur).toContain('سبق 4');
    expect(ur).not.toContain('اسباق');
  });

  it('two chapters stay plural', () => {
    expect(scheme('maths', [3, 4]).examJson._layout.scope.covers_en).toMatch(/^Covers Units 3–4;/);
  });
});

describe('Urdu Q6 prints the four verses the child explains (item 6)', () => {
  const q6Of = (examJson) => examJson.unseen.subjective['Poem Explanation'][0];
  const paperText = (examJson) => R.renderPaper({ examJson, grade: 5, subject: 'urdu', allowShort: true })
    .replace(/<[^>]+>/g, ' ');
  const squash = (s) => String(s).replace(/\s+/g, '');

  it('moves four lines written in `question` into `passage`, and the paper prints them', () => {
    const { examJson, shortfall } = applyLayout(verses, P.urdu, FDE, { now: NOW });
    const q6 = q6Of(examJson);
    const lines = String(q6.passage || '').split('\n').filter((l) => l.trim());
    expect(lines).toHaveLength(4);
    expect(shortfall.find((s) => s.slot === 'urdu.C.Q6')).toBeUndefined();
    const text = squash(paperText(examJson));
    for (const line of lines) expect(text).toContain(squash(R.toUrduDigits(line)));
  });

  it('a reply with no four lines anywhere is not placed: the slot reports short', () => {
    const broken = JSON.parse(JSON.stringify(verses));
    const q = broken.unseen.subjective['Poem Explanation'][0];
    q.question = 'درج ذیل اشعار کا مفہوم واضح کریں۔';
    const { examJson, unplaced, shortfall } = applyLayout(broken, P.urdu, FDE, { now: NOW });
    expect(unplaced).toBe(1);
    expect(shortfall).toContainEqual({ slot: 'urdu.C.Q6', missing: 1 });
    expect(examJson.unseen.subjective['Poem Explanation']).toEqual([]);
  });

  it('an item that already has its four lines in `passage` is left as written', () => {
    const fine = JSON.parse(JSON.stringify(verses));
    const q = fine.unseen.subjective['Poem Explanation'][0];
    q.passage = q.question;
    q.question = q.main_question;
    const laid = q6Of(applyLayout(fine, P.urdu, FDE, { now: NOW }).examJson);
    expect(laid.passage).toBe(q.passage);
    expect(laid.question).toBe(q.question);
  });
});

describe('round 2', () => {
  const squash = (s) => String(s).replace(/\s+/g, '');
  const q6With = (question) => {
    const raw = JSON.parse(JSON.stringify(verses));
    raw.unseen.subjective['Poem Explanation'][0].question = question;
    return applyLayout(raw, P.urdu, FDE, { now: NOW });
  };
  const LINES = verses.unseen.subjective['Poem Explanation'][0].question.split('\n');
  const INSTRUCTION = 'درج ذیل اشعار کا مفہوم واضح کریں۔';

  it('Q6: an instruction written above the four lines stays the question; only the last four lines are the verses', () => {
    const { examJson } = q6With([INSTRUCTION, ...LINES].join('\n'));
    const q = examJson.unseen.subjective['Poem Explanation'][0];
    expect(q.passage.split('\n')).toEqual(LINES);
    expect(q.question).toBe(INSTRUCTION);
    const text = squash(R.renderPaper({ examJson, grade: 5, subject: 'urdu', allowShort: true }).replace(/<[^>]+>/g, ' '));
    for (const line of LINES) expect(text).toContain(squash(R.toUrduDigits(line)));
  });

  it('Q6: the same on one line, split at «؟»/«۔»', () => {
    const { examJson } = q6With([INSTRUCTION, ...LINES.map((l) => (/[؟۔]$/.test(l) ? l : `${l}۔`))].join(' '));
    const q = examJson.unseen.subjective['Poem Explanation'][0];
    expect(q.passage.split('\n')).toHaveLength(4);
    expect(q.passage).not.toContain('مفہوم');
    expect(q.question).toBe(INSTRUCTION);
  });

  const ordered = (options, answer) => ({
    unseen: { objective: { MCQs: Array.from({ length: 20 }, (_, i) => ({ slot: 'english.A.Q1a', question: `Order item ${i + 1}?`, options, answer })) } },
  });
  it.each([
    ['roman numerals', ['a) I', 'b) II', 'c) III', 'd) IV'], 'b) II'],
    ['ordinal numbers', ['a) 1st', 'b) 2nd', 'c) 3rd', 'd) 4th'], 'b) 2nd'],
    ['ordinal words', ['a) first', 'b) second', 'c) third', 'd) fourth'], 'b) second'],
    ['weekdays', ['a) Monday', 'b) Tuesday', 'c) Wednesday', 'd) Thursday'], 'b) Tuesday'],
    ['months', ['a) March', 'b) April', 'c) May', 'd) June'], 'b) April'],
    ['Urdu ordinals', ['الف) پہلا', 'ب) دوسرا', 'ج) تیسرا', 'د) چوتھا'], 'ب) دوسرا'],
  ])('options in natural order (%s) are not turned', (_, options, answer) => {
    const subject = /^الف/.test(options[0]) ? 'social_studies' : 'english';
    const raw = ordered(options, answer);
    if (subject === 'social_studies') raw.unseen.objective.MCQs.forEach((q) => { q.slot = 'social_studies.A.Q1'; });
    for (const q of mcqsOf(applyLayout(raw, P[subject], FDE, { now: NOW }).examJson)) {
      expect(q.options).toEqual(options);
      expect(q.answer).toBe(answer);
    }
  });

  it('the same words out of order are still turned', () => {
    const raw = ordered(['a) Thursday', 'b) Monday', 'c) Wednesday', 'd) Tuesday'], 'b) Monday');
    const laid = mcqsOf(applyLayout(raw, P.english, FDE, { now: NOW }).examJson);
    expect(laid.some((q) => q.answer !== 'b) Monday')).toBe(true);
  });
});
