/**
 * Post-generation validators — the four failure classes flagged by Alishba
 * (Notion card 39dd4a97..., 2026-07-15).
 *
 *   1. Missing images     — a question references an image URL that isn't fetchable
 *   2. Same-source scatter — questions sharing an image / passage aren't grouped
 *   3. MCQ missing options — MCQ-family questions ship with fewer than 4 options
 *   4. Match-columns half-empty — right-column items missing, placeholder,
 *      or duplicated across items
 *
 * Each fix converges on the same shape: a `validateQuestion()` gate that
 * runs AFTER the composer has sampled a question, so a bad row gets swapped
 * for an alternative from the same bucket instead of shipping to the teacher.
 */

// Composer requires supabase — stub it out; the validators are pure.
jest.mock('../../bot/shared/config/supabase', () => ({}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: () => {} }));

const {
  validateQuestion,
  sourceHashOf,
} = require('../../bot/shared/services/exam/exam-composer.validators');

// ─── Fix 1 — missing images ────────────────────────────────────────────────

describe('validateQuestion — missing images', () => {
  it('accepts a question with no media', () => {
    const q = { type: 'MCQs', question_statement: 'What is 2+2?', question_media: [], answer_options: mcqOpts(4) };
    expect(validateQuestion(q)).toEqual({ valid: true, reason: '' });
  });

  it('rejects a question whose media entry has an empty url', () => {
    const q = {
      type: 'Short Answer',
      question_statement: 'See figure 2 and describe',
      question_media: [{ url: '' }],
      answer_options: [],
    };
    const res = validateQuestion(q);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/missing.*image|image.*missing|media/i);
  });

  it('rejects a question whose media entry is missing url entirely', () => {
    const q = {
      type: 'Short Answer',
      question_statement: 'Look at the picture',
      question_media: [{ caption: 'fig 2' }],
      answer_options: [],
    };
    expect(validateQuestion(q).valid).toBe(false);
  });

  it('rejects a question whose statement references an image but has no media', () => {
    // "See figure N" / "look at the image" without any question_media is the
    // canonical failure Alishba flagged.
    const q = {
      type: 'Short Answer',
      question_statement: 'Look at the figure below and answer',
      question_media: [],
      answer_options: [],
    };
    expect(validateQuestion(q).valid).toBe(false);
  });

  it('accepts a question with a well-formed media entry', () => {
    const q = {
      type: 'Short Answer',
      question_statement: 'See figure 2',
      question_media: [{ url: 'https://cdn.example.com/img.png' }],
      answer_options: [],
    };
    expect(validateQuestion(q).valid).toBe(true);
  });
});

// ─── Fix 3 — MCQ missing options ───────────────────────────────────────────

describe('validateQuestion — MCQ missing options', () => {
  it('rejects an MCQ with 3 options', () => {
    const q = {
      type: 'MCQs',
      question_statement: 'Which is a prime?',
      question_media: [],
      answer_options: mcqOpts(3),
    };
    const res = validateQuestion(q);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/mcq|option/i);
  });

  it('rejects an MCQ with 0 options', () => {
    const q = { type: 'MCQs', question_statement: 'Q', question_media: [], answer_options: [] };
    expect(validateQuestion(q).valid).toBe(false);
  });

  it('rejects an MCQ whose options include a blank statement', () => {
    const q = {
      type: 'MCQs', question_statement: 'Q', question_media: [],
      answer_options: [
        { statement: 'a', is_correct: true },
        { statement: '' },
        { statement: 'c' },
        { statement: 'd' },
      ],
    };
    expect(validateQuestion(q).valid).toBe(false);
  });

  it('accepts an MCQ with 4 well-formed options', () => {
    const q = { type: 'MCQs', question_statement: 'Q', question_media: [], answer_options: mcqOpts(4) };
    expect(validateQuestion(q).valid).toBe(true);
  });

  it('accepts an MCQ with 5 options (allowed upper range)', () => {
    const q = { type: 'MCQs', question_statement: 'Q', question_media: [], answer_options: mcqOpts(5) };
    expect(validateQuestion(q).valid).toBe(true);
  });

  it('also applies to MSQs and Circle-the-Correct-Answer', () => {
    for (const type of ['MSQs', 'Circle the Correct Answer']) {
      const q = { type, question_statement: 'Q', question_media: [], answer_options: mcqOpts(2) };
      expect(validateQuestion(q).valid).toBe(false);
    }
  });

  it('does NOT gate non-MCQ types on option count', () => {
    // Short Answer legitimately has no options.
    const q = { type: 'Short Answer', question_statement: 'Q', question_media: [], answer_options: [] };
    expect(validateQuestion(q).valid).toBe(true);
  });
});

// ─── Fix 4 — Match-columns half-empty ──────────────────────────────────────

describe('validateQuestion — match-columns', () => {
  it('rejects a match-columns with no right side at all', () => {
    const q = {
      type: 'Match the Column',
      question_statement: 'Match',
      question_media: [],
      answer_options: [
        { left: 'apple', right: '' },
        { left: 'banana', right: '' },
      ],
    };
    expect(validateQuestion(q).valid).toBe(false);
  });

  it('rejects a match-columns with a placeholder right-column item (answer 1)', () => {
    const q = {
      type: 'Match the Column',
      question_statement: 'Match',
      question_media: [],
      answer_options: [
        { left: 'apple', right: 'answer 1' },
        { left: 'banana', right: 'answer 2' },
      ],
    };
    expect(validateQuestion(q).valid).toBe(false);
  });

  it('rejects a match-columns with an X placeholder', () => {
    const q = {
      type: 'Match the Column', question_statement: 'Match', question_media: [],
      answer_options: [
        { left: 'apple', right: 'X' },
        { left: 'banana', right: 'red' },
      ],
    };
    expect(validateQuestion(q).valid).toBe(false);
  });

  it('rejects a match-columns whose right column is duplicated across items', () => {
    const q = {
      type: 'Match the Column', question_statement: 'Match', question_media: [],
      answer_options: [
        { left: 'apple', right: 'red' },
        { left: 'banana', right: 'red' },
        { left: 'grape', right: 'red' },
      ],
    };
    expect(validateQuestion(q).valid).toBe(false);
  });

  it('rejects a match-columns using the opposite-of-Y pattern', () => {
    const q = {
      type: 'Match the Column', question_statement: 'Match', question_media: [],
      answer_options: [
        { left: 'hot', right: 'opposite of cold' },
        { left: 'up',  right: 'opposite of down' },
      ],
    };
    expect(validateQuestion(q).valid).toBe(false);
  });

  it('accepts a well-formed match-columns', () => {
    const q = {
      type: 'Match the Column', question_statement: 'Match', question_media: [],
      answer_options: [
        { left: 'apple', right: 'red fruit' },
        { left: 'banana', right: 'yellow fruit' },
        { left: 'grape', right: 'purple fruit' },
      ],
    };
    expect(validateQuestion(q).valid).toBe(true);
  });
});

// ─── Fix 2 — source hash (grouping key) ────────────────────────────────────

describe('sourceHashOf — groups questions sharing source material', () => {
  it('returns the group_ref when a question is part of an explicit group', () => {
    const q = { group_ref: 'grp-uuid-1', question_media: [], question_statement: 'foo' };
    expect(sourceHashOf(q)).toBe('group:grp-uuid-1');
  });

  it('two questions sharing the same image url share a source hash', () => {
    const q1 = { group_ref: null, question_media: [{ url: 'https://cdn/x.png' }], question_statement: 'a' };
    const q2 = { group_ref: null, question_media: [{ url: 'https://cdn/x.png' }], question_statement: 'b' };
    expect(sourceHashOf(q1)).toBe(sourceHashOf(q2));
  });

  it('two questions with different images do NOT share a source hash', () => {
    const q1 = { group_ref: null, question_media: [{ url: 'https://cdn/x.png' }], question_statement: 'a' };
    const q2 = { group_ref: null, question_media: [{ url: 'https://cdn/y.png' }], question_statement: 'b' };
    expect(sourceHashOf(q1)).not.toBe(sourceHashOf(q2));
  });

  it('two questions sharing the same explicit passage text share a source hash', () => {
    // Composer-time we don't have group_meta for un-grouped bank rows, so the
    // fallback is: hash of question_statement if it looks like a passage
    // (>200 chars). Real fix is via group_ref — this catches the drift case
    // where a passage was inlined into two questions' statements.
    const passage = 'A'.repeat(220);
    const q1 = { group_ref: null, question_media: [], question_statement: passage };
    const q2 = { group_ref: null, question_media: [], question_statement: passage };
    expect(sourceHashOf(q1)).toBe(sourceHashOf(q2));
  });

  it('short-statement + no media + no group_ref returns a unique key (do not group)', () => {
    const q1 = { group_ref: null, question_media: [], question_statement: 'What is 2+2?' };
    const q2 = { group_ref: null, question_media: [], question_statement: 'What is 3+3?' };
    // Distinct short questions → distinct keys (per-question) so they don't accidentally
    // collapse together.
    expect(sourceHashOf(q1)).not.toBe(sourceHashOf(q2));
  });
});

// ─── helpers ───────────────────────────────────────────────────────────────

function mcqOpts(n) {
  const letters = ['a', 'b', 'c', 'd', 'e', 'f'];
  return Array.from({ length: n }, (_, i) => ({
    statement: `option ${letters[i]}`,
    is_correct: i === 0,
  }));
}
