/**
 * She says how many MARKS the paper is worth, not just how many questions.
 *
 * Marks already existed everywhere as an OUTPUT — summed onto the paper, printed
 * in a "Total Marks" row, stored on the row when the build finished. What there
 * was no way to do was ASK for a number: mark requirements vary by exam type and
 * by school, so a teacher told "this is a 40-mark paper" had no way to say so.
 *
 * Two halves, and they fail differently:
 *
 *   * The INPUT is a Flow TextInput, which has no min or max of its own —
 *     `input-type: number` picks the keypad and nothing else. So every bound is
 *     ours, on a value she can type anything into. Refused on the screen rather
 *     than clamped, exactly as parseQuestionCount does: quietly turning 500 into
 *     100 hands her a paper she never asked for and never mentions it.
 *
 *   * The BUDGET is enforced in code, not by asking the prompt more firmly. The
 *     prompt does state it, but the model assigns the per-question marks and
 *     sometimes ignores what it was told — the same reason trimSeen exists.
 *
 * Leaving the field blank has to change nothing at all. That is the property
 * most likely to break silently, so it is asserted on both halves.
 */

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: mockCreate } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const { parseTotalMarks, MAX_TOTAL_MARKS } =
  require('../../bot/shared/services/assessment/question-types');

const CONTENT = '=== Page 4 ===\nCHAPTER 1\nHello World!';

function reply(obj, usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }) {
  return { choices: [{ message: { content: JSON.stringify(obj) } }], usage };
}

const BASE = {
  grade: 1,
  subject: 'Eng',
  pageContent: CONTENT,
  pageReference: '4-14',
  contentSource: 'unseen',
  questionCount: 5,
};

const T = (id, count, category = 'objective') => ({ id, count, category });

// ── The number she types ────────────────────────────────────────────────────

describe('parseTotalMarks', () => {
  test('a sensible number comes back as itself', () => {
    expect(parseTotalMarks('40').marks).toBe(40);
    expect(parseTotalMarks(25).marks).toBe(25);
  });

  test('BLANK is allowed and means "no budget" — this field is optional', () => {
    // The whole point: a teacher who does not care about a total should see
    // exactly the behaviour she saw before this field existed.
    for (const v of ['', '   ', null, undefined]) {
      const r = parseTotalMarks(v);
      expect(r.ok).toBe(true);
      expect(r.marks).toBeNull();
    }
  });

  test('over the cap is REFUSED, not silently clamped', () => {
    const r = parseTotalMarks(String(MAX_TOTAL_MARKS + 1));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(String(MAX_TOTAL_MARKS));
  });

  test('zero and negatives are refused', () => {
    for (const v of ['0', '-1', '-40']) {
      expect(parseTotalMarks(v).ok).toBe(false);
    }
  });

  test('a fraction is refused rather than rounded into something she did not type', () => {
    expect(parseTotalMarks('7.5').ok).toBe(false);
  });

  test('text is refused with a message that names the range', () => {
    const r = parseTotalMarks('abc');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/\b1\b/);
  });

  test('surrounding whitespace is tolerated — a keypad can add it', () => {
    expect(parseTotalMarks(' 40 ').marks).toBe(40);
  });

  test('the message never blames her', () => {
    const r = parseTotalMarks('99999');
    expect(r.message).not.toMatch(/invalid|error|wrong|illegal/i);
  });
});

// ── What the model is told ──────────────────────────────────────────────────

describe('the budget reaches the prompt', () => {
  test('a budget she set is stated to the model, in marks', () => {
    const prompt = Gen.buildUserPrompt({ ...BASE, totalMarks: 40 });
    expect(prompt).toMatch(/40/);
    expect(prompt).toMatch(/marks/i);
  });

  test('no budget leaves the prompt exactly as it was', () => {
    // Byte-identical, not merely "close": a stray always-on line about marks
    // would change every paper ever generated without a budget.
    const withoutField = Gen.buildUserPrompt({ ...BASE });
    const withNull = Gen.buildUserPrompt({ ...BASE, totalMarks: null });
    expect(withNull).toBe(withoutField);
  });
});

// ── Making it true when the model ignores it ────────────────────────────────

describe('enforceMarksBudget', () => {
  const q = (n, marks) => ({ question: `q${n}`, marks });

  test('a paper already within budget is untouched', () => {
    const tree = { unseen: { objective: { MCQs: [q(1, 2), q(2, 3)] } } };
    const removed = Gen.enforceMarksBudget(tree, 40);
    expect(removed).toBe(0);
    expect(tree.unseen.objective.MCQs).toHaveLength(2);
  });

  test('a paper exactly ON budget is untouched — the limit is inclusive', () => {
    const tree = { unseen: { objective: { MCQs: [q(1, 5), q(2, 5)] } } };
    expect(Gen.enforceMarksBudget(tree, 10)).toBe(0);
    expect(tree.unseen.objective.MCQs).toHaveLength(2);
  });

  test('no budget means no enforcement at all', () => {
    const tree = { unseen: { objective: { MCQs: [q(1, 50), q(2, 50)] } } };
    expect(Gen.enforceMarksBudget(tree, null)).toBe(0);
    expect(tree.unseen.objective.MCQs).toHaveLength(2);
  });

  test('an OVER-budget paper is brought within budget, keeping tree order', () => {
    // 4 + 4 + 4 = 12 against a budget of 8: the last question goes, the two
    // the model wrote first stay, exactly as trimSeen keeps its first N.
    const tree = { unseen: { objective: { MCQs: [q(1, 4), q(2, 4), q(3, 4)] } } };
    const removed = Gen.enforceMarksBudget(tree, 8);
    expect(removed).toBe(1);
    expect(tree.unseen.objective.MCQs.map((x) => x.question)).toEqual(['q1', 'q2']);
  });

  test('marks are never rewritten — only whole questions are dropped', () => {
    // Rescaling a 5-mark essay to 2 marks misrepresents the work it asks for,
    // and silently edits a mark scheme she will grade against.
    const tree = { unseen: { subjective: { 'Short Questions': [q(1, 5), q(2, 5)] } } };
    Gen.enforceMarksBudget(tree, 6);
    for (const kept of tree.unseen.subjective['Short Questions']) {
      expect(kept.marks).toBe(5);
    }
  });

  test('it drops across the seen branch too, seen first in tree order', () => {
    const tree = {
      seen: { objective: { MCQs: [q(1, 6)] } },
      unseen: { objective: { MCQs: [q(2, 6), q(3, 6)] } },
    };
    const removed = Gen.enforceMarksBudget(tree, 6);
    expect(removed).toBe(2);
    expect(tree.seen.objective.MCQs).toHaveLength(1);
    expect(tree.unseen.objective.MCQs).toHaveLength(0);
  });

  test('a composite question counts by its sub-parts, like the renderer totals it', () => {
    // totalMarks() sums the sub-questions when they carry their own marks, so
    // enforcement has to measure a question the same way the paper prints it.
    const composite = { question: 'Answer both', questions: [q(1, 4), q(2, 4)] };
    const tree = { unseen: { subjective: { 'Long Question': [composite, q(3, 2)] } } };
    const removed = Gen.enforceMarksBudget(tree, 8);
    expect(removed).toBe(1);
    expect(tree.unseen.subjective['Long Question']).toHaveLength(1);
  });

  test('a single question worth more than the whole budget still leaves a paper', () => {
    // Dropping literally everything would hand her an empty PDF. A paper that
    // cannot fit is better over budget than blank.
    const tree = { unseen: { objective: { MCQs: [q(1, 20)] } } };
    Gen.enforceMarksBudget(tree, 5);
    expect(Gen.countQuestions(tree)).toBe(1);
  });
});

// ── End to end through generateExam ─────────────────────────────────────────

describe('generateExam honours the budget', () => {
  const q = (n, marks) => ({ question: `q${n}`, marks });

  beforeEach(() => mockCreate.mockReset());

  test('an over-budget paper comes back within budget, and says what it dropped', async () => {
    mockCreate.mockResolvedValue(reply({
      unseen: { objective: { MCQs: [q(1, 5), q(2, 5), q(3, 5), q(4, 5)] } },
    }));
    const out = await Gen.generateExam({
      ...BASE, questionCount: 4, questionTypes: [T('MCQs', 4)], totalMarks: 10,
    });
    expect(out.marksRemoved).toBe(2);
    expect(out.questionCount).toBe(2);
  });

  test('a paper within budget is returned whole', async () => {
    mockCreate.mockResolvedValue(reply({
      unseen: { objective: { MCQs: [q(1, 2), q(2, 2)] } },
    }));
    const out = await Gen.generateExam({
      ...BASE, questionCount: 2, questionTypes: [T('MCQs', 2)], totalMarks: 40,
    });
    expect(out.marksRemoved).toBe(0);
    expect(out.questionCount).toBe(2);
  });

  test('NO budget leaves an over-large paper completely alone', async () => {
    // The regression that matters most: today a paper worth 100 marks is fine.
    mockCreate.mockResolvedValue(reply({
      unseen: { objective: { MCQs: [q(1, 50), q(2, 50)] } },
    }));
    const out = await Gen.generateExam({
      ...BASE, questionCount: 2, questionTypes: [T('MCQs', 2)],
    });
    expect(out.marksRemoved).toBe(0);
    expect(out.questionCount).toBe(2);
  });
});
