/**
 * bd-60124 — finishing a module must OFFER its exam, not skip to the next one.
 *
 * Reported from sandbox: completing Unit 106 (the last unit of I-SAPS Module 1)
 * delivered Unit 201's video and quiz instead of Module 1's exam.
 *
 * `onModuleCompleted` does two things: it offers a capstone, then it advances.
 * Both of its assumptions are LEVEL-scoped, and neither holds for I-SAPS after
 * bd-60119 moved the summative assessment onto per-module quizzes:
 *
 *   maybeOfferCapstone  → loadCapstoneQuiz(level.id) looks for a LEVEL capstone,
 *                         and levelFullyComplete() demands all 54 units. Module
 *                         1's own capstone is invisible to it.
 *   advanceAfterModule  → releases the next module unconditionally.
 *
 * So nothing offered the exam and the teacher was moved on. The fix is a
 * module-scoped offer that runs BEFORE advancement and, when it fires, holds
 * advancement back — otherwise the exam offer and the next unit's video arrive
 * together and the teacher just taps the video.
 *
 * These are the pure rules. The vendor gate matters most: NIETE, Beacon House
 * and Oxbridge must reach `false` and keep advancing exactly as before.
 */

const {
  shouldOfferModuleExam,
  moduleExamOfferMessage,
} = require('../../bot/shared/services/training/isaps-module-exam.rules');

const FULL = {
  vendorKey: 'ISAPS',
  unitsTotal: 6,
  unitsDone: 6,
  mcqCount: 8,
  crqCount: 4,
  alreadyPassed: false,
};

describe('bd-60124 — shouldOfferModuleExam', () => {
  test('I-SAPS, module finished, questions exist → offer it', () => {
    expect(shouldOfferModuleExam(FULL)).toBe(true);
  });

  test('every other vendor keeps advancing — they have no per-module exam', () => {
    for (const vendorKey of ['TALEEMABAD', 'BEACONHOUSE', 'OXBRIDGE', '', null, undefined]) {
      expect(shouldOfferModuleExam({ ...FULL, vendorKey })).toBe(false);
    }
  });

  // bd-60164 — inverted deliberately. Sequencing is gone: an exam may be sat
  // at any point, and the level certificate is the only thing that checks
  // whether the work is complete.
  test('module not finished → the exam is STILL offered', () => {
    expect(shouldOfferModuleExam({
      vendorKey: 'ISAPS', unitsTotal: 6, unitsDone: 4, mcqCount: 8, crqCount: 4, alreadyPassed: false,
    })).toBe(true);
  });

  test('a module with no units yet is never offered — no content, no exam', () => {
    expect(shouldOfferModuleExam({
      vendorKey: 'ISAPS', unitsTotal: 0, unitsDone: 0, mcqCount: 8, crqCount: 4, alreadyPassed: false,
    })).toBe(false);
  });

  test('already passed → no offer, and no re-sit', () => {
    expect(shouldOfferModuleExam({ ...FULL, alreadyPassed: true })).toBe(false);
  });

  test('no questions → no offer rather than an empty exam', () => {
    expect(shouldOfferModuleExam({ ...FULL, mcqCount: 0, crqCount: 0 })).toBe(false);
  });

  test('CRQ only, no MCQs → still offered; the CRQ is the assessment', () => {
    expect(shouldOfferModuleExam({ ...FULL, mcqCount: 0, crqCount: 4 })).toBe(true);
  });

  test('a module with zero units cannot be "finished" — no offer', () => {
    // Guards 0/0, which would otherwise read as complete and offer an exam for
    // a module that has no content yet.
    expect(shouldOfferModuleExam({ ...FULL, unitsTotal: 0, unitsDone: 0 })).toBe(false);
  });

  test('missing input is false, never a throw', () => {
    expect(shouldOfferModuleExam({})).toBe(false);
    expect(shouldOfferModuleExam(null)).toBe(false);
  });
});

describe('bd-60124 — moduleExamOfferMessage', () => {
  test('names the module and what the exam holds', () => {
    const msg = moduleExamOfferMessage({
      moduleTitle: 'Module 1 - Philosophical Foundations', mcqCount: 8, crqCount: 4,
    });
    expect(msg).toMatch(/Module 1/);
    expect(msg).toMatch(/8/);
    expect(msg).toMatch(/written|CRQ/i);
  });

  test('reads correctly with a single MCQ — no stray plural', () => {
    const msg = moduleExamOfferMessage({ moduleTitle: 'Module 3 - X', mcqCount: 1, crqCount: 0 });
    expect(msg).toMatch(/1 scenario question\b/);
    expect(msg).not.toMatch(/1 scenario questions/);
  });

  test('says the next module waits, so finishing feels deliberate', () => {
    const msg = moduleExamOfferMessage({ moduleTitle: 'Module 1 - X', mcqCount: 8, crqCount: 4 });
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).toMatch(/next module|when you are ready|/i);
  });
});
