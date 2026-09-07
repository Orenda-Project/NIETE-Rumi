/**
 * Two defects the 3 Sep model comparison hid behind a wrong conclusion.
 *
 * 1. THE PROMPTS NEVER NAMED THE ENVELOPE.
 *
 * `countQuestions()` walks `seen` / `unseen` and nothing else, but the strings
 * "seen" and "unseen" appeared ZERO times in 96KB of ict-prompts.json. Gemini
 * Pro and Flash infer the wrapper from the format examples; Gemma 4 31B does
 * not — it topped its JSON with `exam_paper`, `Exam Paper`, or the textbook's
 * own section names ("Reading Comprehension", "Vocabulary") while writing
 * 23–51 perfectly good questions. Every one was discarded as NO_QUESTIONS.
 *
 * Measured on G3 English ch3, 10,819 chars of source: 0 of 4 runs parseable
 * without an envelope instruction, 4 of 4 with one. The eval's "9 attempts for
 * 3 papers" and its conclusion that Gemma is unreliable were both an artefact
 * of our prompt, not a property of the model.
 *
 * 2. NOTHING TRIMS THE PAPER TO THE REQUESTED TOTAL.
 *
 * `trimSeen()` caps the SEEN half at its target and stops there. With the
 * envelope fixed, Gemma returns 22–32 questions for a request of 15 — so a
 * teacher asking for 15 would print 30. Same family as bd-60048 (asked 1, got
 * 3): the count is a request the model may exceed, and only code can hold it.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const PROMPTS = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'bot/shared/services/assessment/ict-prompts.json'), 'utf8'));
const SERVICE = fs.readFileSync(
  path.join(ROOT, 'bot/shared/services/assessment/assessment-generation.service.js'), 'utf8');

describe('the prompt names the envelope the parser requires', () => {
  const shared = Object.entries(PROMPTS)
    .filter(([k]) => k.startsWith('eg.task.'))
    .map(([, v]) => v)
    .join('\n');

  test('a shared task prompt exists (else this suite guards nothing)', () => {
    expect(shared.length).toBeGreaterThan(100);
  });

  test('it states both required top-level keys by name', () => {
    expect(shared).toMatch(/"seen"/);
    expect(shared).toMatch(/"unseen"/);
  });

  test('it forbids inventing another top-level key', () => {
    // The exact failure: `exam_paper`, or grouping by textbook section name.
    expect(shared).toMatch(/top-level/i);
  });

  test('it shows a skeleton the model can copy', () => {
    expect(shared).toMatch(/\{\s*"seen"\s*:/);
  });
});

describe('the requested total is enforced in code, not hoped for', () => {
  test('a trim-to-total function exists', () => {
    expect(SERVICE).toMatch(/function trimToTotal/);
  });

  test('it is called with the plan total', () => {
    expect(SERVICE).toMatch(/trimToTotal\([^)]*plan\.total/);
  });

  test('trimming happens before the paper is counted as delivered', () => {
    const trimAt = SERVICE.indexOf('trimToTotal(');
    const countAt = SERVICE.indexOf('const produced = countQuestions');
    expect(trimAt).toBeGreaterThan(-1);
    expect(trimAt).toBeLessThan(countAt);
  });
});

describe('trimToTotal behaviour', () => {
  const { _internal } = require('../../bot/shared/services/assessment/assessment-generation.service');

  const paper = (seen, unseen) => ({
    seen: { objective: { MCQs: Array.from({ length: seen }, (_, i) => ({ question: `s${i}`, marks: 1 })) } },
    unseen: { subjective: { 'Short Questions': Array.from({ length: unseen }, (_, i) => ({ question: `u${i}`, marks: 2 })) } },
  });

  test('an over-long paper is cut to the total asked for', () => {
    const p = paper(10, 22);
    const removed = _internal.trimToTotal(p, 15);
    expect(_internal.countQuestions(p)).toBe(15);
    expect(removed).toBe(17);
  });

  test('a paper at or under the total is untouched', () => {
    const p = paper(4, 6);
    expect(_internal.trimToTotal(p, 15)).toBe(0);
    expect(_internal.countQuestions(p)).toBe(10);
  });

  test('it never empties the paper — one question survives any positive total', () => {
    const p = paper(0, 5);
    _internal.trimToTotal(p, 1);
    expect(_internal.countQuestions(p)).toBe(1);
  });

  test('Urdu questions are cut by count, not mangled', () => {
    const p = {
      unseen: { objective: { MCQs: [
        { question: 'سب سے تیز رفتار سواری کون سی ہے؟', marks: 1 },
        { question: 'محترمہ فاطمہ جناح کے بارے میں بتائیں', marks: 2 },
        { question: 'ملاپ کریں', marks: 1 },
      ] } },
    };
    _internal.trimToTotal(p, 2);
    const kept = p.unseen.objective.MCQs;
    expect(kept).toHaveLength(2);
    expect(kept[0].question).toBe('سب سے تیز رفتار سواری کون سی ہے؟');
  });
});
