/**
 * bd-60120 — the end-of-module exam for I-SAPS.
 *
 * I-SAPS assesses at the end of each MODULE: two scenario MCQs and one CRQ
 * (assessment doc §4). bd-60119 re-keyed those onto 18 per-module quizzes
 * (source_quiz_id = 900 + module) and retired the level-wide pair, so the
 * questions exist but nothing offers them — the level screen has exactly one
 * exam slot and it is bound to the LEVEL.
 *
 * The slot is free for I-SAPS precisely because I-SAPS has no level exam: it
 * currently renders "No level exam — finish all sessions". When the teacher is
 * drilled into a module (the `c:` scope from bd-60119) that slot shows THAT
 * module's exam instead. No Flow re-publish, and the level view for every
 * other vendor is untouched.
 *
 * These are the pure rules: which quiz belongs to a module, whether it is
 * open yet, and what the slot says. The gate is the part that matters — a CTA
 * in this Flow is a tappable link whatever its label, so the server has to be
 * what refuses it (bd-2452 learned this the hard way on the level exam).
 */

const {
  PER_MODULE_SOURCE_BASE,
  moduleSourceQuizId,
  moduleFromSourceQuizId,
  isPerModuleQuiz,
  buildModuleExamSlot,
} = require('../../bot/shared/services/training/isaps-module-exam.rules');

describe('bd-60120 — per-module quiz ids', () => {
  test('a module number maps to its source_quiz_id', () => {
    expect(moduleSourceQuizId(1)).toBe(PER_MODULE_SOURCE_BASE + 1);
    expect(moduleSourceQuizId(9)).toBe(PER_MODULE_SOURCE_BASE + 9);
  });

  test('and back again', () => {
    expect(moduleFromSourceQuizId(901)).toBe(1);
    expect(moduleFromSourceQuizId(909)).toBe(9);
  });

  test('legacy ids are NOT per-module — this is the guard other vendors rely on', () => {
    // Taleemabad exams carry 1-4, Beacon House capstones 8-11.
    for (const legacy of [1, 2, 3, 4, 8, 9, 10, 11]) {
      expect(isPerModuleQuiz(legacy)).toBe(false);
      expect(moduleFromSourceQuizId(legacy)).toBeNull();
    }
    // A NULL source id is a LEVEL exam, never a module one.
    expect(isPerModuleQuiz(null)).toBe(false);
    expect(moduleFromSourceQuizId(null)).toBeNull();
  });

  test('the per-module range is recognised', () => {
    expect(isPerModuleQuiz(901)).toBe(true);
    expect(isPerModuleQuiz(909)).toBe(true);
  });
});

describe('bd-60120 — buildModuleExamSlot', () => {
  const OPEN = { moduleTitle: 'Module 1 - Philosophical Foundations', unitsTotal: 6, unitsDone: 6 };

  // bd-60164 — this used to assert the OPPOSITE: unfinished units locked the
  // exam. The operator removed every sequencing gate ("anything can be given
  // in any order; the only important thing is that the certificate issues
  // only if the requirements are complete"), so the wait moved to the level
  // certificate and the exam opens on demand.
  test('units unfinished → the exam is STILL offered; nothing sequences', () => {
    const slot = buildModuleExamSlot({
      ...OPEN, unitsDone: 4, mcqCount: 8, crqCount: 4, passed: false,
    });
    expect(slot.ok).toBe(true);
    expect(slot.cta).toMatch(/take|start/i);
  });

  test('a module with NO units at all is still not examinable', () => {
    // The one completeness check that survives: no content, no assessment.
    const slot = buildModuleExamSlot({
      ...OPEN, unitsTotal: 0, unitsDone: 0, mcqCount: 0, crqCount: 0, passed: false,
    });
    expect(slot.ok).toBe(false);
  });

  test('every unit done → the exam opens, and says what it contains', () => {
    const slot = buildModuleExamSlot({
      ...OPEN, mcqCount: 8, crqCount: 4, passed: false,
    });
    expect(slot.ok).toBe(true);
    expect(slot.cta).toMatch(/take|start/i);
    expect(slot.body).toMatch(/8/);          // the MCQ count
    expect(slot.body).toMatch(/written|CRQ/i);
  });

  test('already passed → shown as passed and NOT re-offered', () => {
    const slot = buildModuleExamSlot({
      ...OPEN, mcqCount: 8, crqCount: 4, passed: true,
    });
    expect(slot.ok).toBe(false);
    expect(slot.body).toMatch(/passed/i);
    expect(slot.cta).toMatch(/passed/i);
  });

  test('a module with NO questions says so rather than offering an empty exam', () => {
    const slot = buildModuleExamSlot({
      ...OPEN, mcqCount: 0, crqCount: 0, passed: false,
    });
    expect(slot.ok).toBe(false);
    expect(slot.body).toMatch(/no exam/i);
  });

  test('MCQs but no CRQ still opens — the CRQ is not mandatory to exist', () => {
    const slot = buildModuleExamSlot({
      ...OPEN, mcqCount: 5, crqCount: 0, passed: false,
    });
    expect(slot.ok).toBe(true);
  });

  test('a cooldown blocks the retake and says how long', () => {
    const slot = buildModuleExamSlot({
      ...OPEN, mcqCount: 8, crqCount: 4, passed: false, cooldownHoursLeft: 12,
    });
    expect(slot.ok).toBe(false);
    expect(slot.body).toMatch(/12/);
    expect(slot.cta).toMatch(/cooldown/i);
  });

  test('every branch returns all three fields, so the screen never renders blank', () => {
    const cases = [
      { ...OPEN, unitsDone: 0, mcqCount: 8, crqCount: 4, passed: false },
      { ...OPEN, mcqCount: 8, crqCount: 4, passed: false },
      { ...OPEN, mcqCount: 8, crqCount: 4, passed: true },
      { ...OPEN, mcqCount: 0, crqCount: 0, passed: false },
    ];
    for (const c of cases) {
      const s = buildModuleExamSlot(c);
      expect(typeof s.body).toBe('string');
      expect(s.body.length).toBeGreaterThan(0);
      expect(typeof s.caption).toBe('string');
      expect(typeof s.cta).toBe('string');
      expect(s.cta.length).toBeGreaterThan(0);
    }
  });
});
