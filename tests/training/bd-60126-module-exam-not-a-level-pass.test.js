/**
 * bd-60126 — passing a MODULE exam is not passing the LEVEL.
 *
 * Reported from sandbox: finishing Module 1's eight scenario MCQs announced
 * "You passed the Level 1 grand quiz" and issued a level certificate. One
 * module of nine, and a certificate that asserts the whole level.
 *
 * MY BUG, and a one-word one. startModuleExam (bd-60120) inserts its attempt
 * with `quiz_kind: 'grand'` — the same kind the LEVEL exam uses — because the
 * CHECK constraint on training_assessment_attempts only permits 'grand',
 * 'training_module' and 'capstone'. gradeAttempt then branches on quiz_kind
 * alone, so it could not tell the two apart and took the certifying path.
 *
 * The signal that separates them already exists and needs no schema change:
 * a module exam's quiz carries source_quiz_id >= PER_MODULE_SOURCE_BASE
 * (bd-60119), and a level exam's is NULL or a legacy 1-11.
 *
 * What a module pass SHOULD do: record the pass, report the module score, and
 * hand over to the module's CRQ. The level certificate belongs to the
 * composite across all nine modules (bd-60113), which nothing issues yet.
 */

const {
  isPerModuleQuiz,
  isLevelCertifyingAttempt,
  moduleExamPassMessage,
} = require('../../bot/shared/services/training/isaps-module-exam.rules');

describe('bd-60126 — isLevelCertifyingAttempt', () => {
  test('a LEVEL exam certifies — NULL source id', () => {
    expect(isLevelCertifyingAttempt({ source_quiz_id: null })).toBe(true);
  });

  test('a LEVEL exam certifies — legacy ids, which every other vendor uses', () => {
    // Taleemabad 1-4, Beacon House 8-11. Regressing these would stop every
    // existing vendor from ever certifying again.
    for (const legacy of [1, 2, 3, 4, 8, 9, 10, 11]) {
      expect(isLevelCertifyingAttempt({ source_quiz_id: legacy })).toBe(true);
    }
  });

  test('a MODULE exam does NOT certify', () => {
    expect(isLevelCertifyingAttempt({ source_quiz_id: 901 })).toBe(false);
    expect(isLevelCertifyingAttempt({ source_quiz_id: 909 })).toBe(false);
  });

  test('a missing quiz row certifies — the safe default is the old behaviour', () => {
    // If the quiz cannot be loaded we must not silently stop certifying a real
    // level exam; the module case is the narrow, provable one.
    expect(isLevelCertifyingAttempt(null)).toBe(true);
    expect(isLevelCertifyingAttempt({})).toBe(true);
    expect(isLevelCertifyingAttempt(undefined)).toBe(true);
  });

  test('consistent with isPerModuleQuiz — one predicate, not two', () => {
    for (const id of [null, 1, 11, 900, 901, 909]) {
      expect(isLevelCertifyingAttempt({ source_quiz_id: id })).toBe(!isPerModuleQuiz(id));
    }
  });
});

describe('bd-60126 — moduleExamPassMessage', () => {
  test('reports the module score and never claims a level or a certificate', () => {
    const msg = moduleExamPassMessage({
      moduleTitle: 'Module 1 - Philosophical Foundations', score: 8, total: 8, hasCrq: true,
    });
    expect(msg).toMatch(/Module 1/);
    expect(msg).toMatch(/8\/8/);
    expect(msg).not.toMatch(/certificate/i);
    expect(msg).not.toMatch(/grand quiz/i);
    expect(msg).not.toMatch(/level 1/i);
  });

  test('says the written answer is next when the module has a CRQ', () => {
    const msg = moduleExamPassMessage({
      moduleTitle: 'Module 1 - X', score: 8, total: 8, hasCrq: true,
    });
    expect(msg).toMatch(/written/i);
  });

  test('a module with no CRQ does not promise one', () => {
    const msg = moduleExamPassMessage({
      moduleTitle: 'Module 8 - X', score: 10, total: 12, hasCrq: false,
    });
    expect(msg).not.toMatch(/written answer is next|next: /i);
  });

  test('always returns a non-empty string', () => {
    expect(moduleExamPassMessage({}).length).toBeGreaterThan(0);
  });
});
