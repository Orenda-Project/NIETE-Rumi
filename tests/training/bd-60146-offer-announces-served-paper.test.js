/**
 * bd-60146 — the exam offer must promise the paper the teacher will actually sit.
 *
 * Operator screenshot, Module 9:
 *
 *     🎓 Module 9 - Teacher Leadership — every session is done.
 *     The module exam is 13 scenario questions. The next module waits…
 *
 * Module 9's BANK holds 13 items. The PAPER is 3 — two scenario MCQs and one
 * written answer, per ISAPS §5.1. bd-60141 fixed the selection; it did not
 * touch the sentence that announces it, so the teacher is promised thirteen
 * questions and served three.
 *
 * `content-delivery.service.js` counts mcqCount/crqCount straight off the bank
 * and hands those to moduleExamOfferMessage. The rule itself is innocent — it
 * renders what it is given — which is exactly why this file asserts the SHAPE
 * OF THE NUMBERS THE CALLER COMPUTES, not just the formatting.
 *
 * Same family as bd-60138 ("17/9") and bd-60143 ("12/3"): a count taken from
 * the wrong population and shown to a teacher as fact.
 */

const {
  moduleExamOfferMessage,
} = require('../../bot/shared/services/training/isaps-module-exam.rules');
const {
  MODULE_EXAM_MCQ_COUNT,
  selectPaperWithOneCrq,
} = require('../../bot/shared/services/training/isaps-crq-paper.rules');

const MCQ = (id) => ({ id, options: ['a', 'b', 'c', 'd'], correct_option: '2' });
const CRQ = (id) => ({ id, options: [], correct_option: '' });

/** Every real I-SAPS bank shape, from sandbox. */
const BANKS = {
  1: [8, 4], 2: [5, 4], 3: [5, 4], 4: [5, 4], 5: [7, 4],
  6: [1, 5], 7: [10, 4], 8: [12, 4], 9: [9, 4],
};

/**
 * What the OFFER should say, derived the same way the paper is built.
 * Exported shape mirrors what the caller must now compute.
 */
function offeredCounts(bankMcqs, bankCrqs) {
  return {
    mcqCount: Math.min(MODULE_EXAM_MCQ_COUNT, bankMcqs),
    crqCount: bankCrqs > 0 ? 1 : 0,
  };
}

describe('bd-60146 — the offer promises the served paper', () => {
  test('THE BUG: Module 9 must not be announced as 13 questions', () => {
    const [m, c] = BANKS[9];
    const msg = moduleExamOfferMessage({ moduleTitle: 'Module 9', ...offeredCounts(m, c) });
    expect(msg).not.toMatch(/13 scenario/);
    expect(msg).not.toMatch(/9 scenario/);      // the bank's MCQ count
    expect(msg).toMatch(/2 scenario questions/);
    expect(msg).toMatch(/1 written answer/);
  });

  test('every real bank announces its served paper, never its bank', () => {
    // Eight of the nine banks hold >= 2 MCQs and so announce two. Module 6
    // holds exactly ONE, and announcing "1 scenario question" there is the
    // honest answer — the sampler cannot serve a second. Asserting a blanket
    // "2" would have demanded the message lie about that module.
    for (const [mod, [m, c]] of Object.entries(BANKS)) {
      const { mcqCount, crqCount } = offeredCounts(m, c);
      const msg = moduleExamOfferMessage({ moduleTitle: `Module ${mod}`, mcqCount, crqCount });
      expect(mcqCount).toBeLessThanOrEqual(MODULE_EXAM_MCQ_COUNT);
      expect(msg).toMatch(new RegExp(`${mcqCount} scenario question`));
      expect(msg).toMatch(/1 written answer/);
      // Never the bank tally.
      if (m > MODULE_EXAM_MCQ_COUNT) expect(msg).not.toMatch(new RegExp(`\\b${m} scenario`));
    }
  });

  test('the announced count MATCHES what the sampler serves — every bank', () => {
    // The assertion that actually binds the two halves together. A message that
    // merely says "2" is not enough; it must agree with the paper.
    for (const [mod, [m, c]] of Object.entries(BANKS)) {
      const bank = [
        ...Array.from({ length: m }, (_, i) => MCQ(i + 1)),
        ...Array.from({ length: c }, (_, i) => CRQ(100 + i)),
      ];
      const paper = selectPaperWithOneCrq(bank, `attempt-${mod}`);
      const { mcqCount, crqCount } = offeredCounts(m, c);
      expect(mcqCount + crqCount).toBe(paper.length);
    }
  });

  test('a thin bank is announced honestly, not padded', () => {
    // A bank with ONE MCQ serves one. Promising two would be a lie the
    // sampler cannot honour.
    const msg = moduleExamOfferMessage({ moduleTitle: 'M', ...offeredCounts(1, 4) });
    expect(msg).toMatch(/1 scenario question\b/);
    expect(msg).not.toMatch(/2 scenario/);
    expect(msg).not.toMatch(/1 scenario questions/);   // singular, not plural
  });

  test('a bank with no CRQ promises no written answer', () => {
    const msg = moduleExamOfferMessage({ moduleTitle: 'M', ...offeredCounts(8, 0) });
    expect(msg).toMatch(/2 scenario questions/);
    expect(msg).not.toMatch(/written answer/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// And the CALLER must compute those numbers. The rule renders whatever it is
// handed, which is how "13" shipped in the first place.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

describe('bd-60146 — the caller sizes the offer to the paper', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../bot/shared/services/training/content-delivery.service.js'),
    'utf8',
  );

  test('it caps the announced MCQ count by the exam quota', () => {
    const i = src.indexOf('moduleExamOfferMessage({');
    expect(i).toBeGreaterThan(-1);
    const around = src.slice(Math.max(0, i - 1400), i + 300);
    // The raw bank tallies must not reach the message unbounded.
    expect(around).toMatch(/MODULE_EXAM_MCQ_COUNT/);
  });

  test('the raw bank counts still drive shouldOfferModuleExam', () => {
    // The OFFER DECISION legitimately asks "does this module have any items at
    // all?", which is a question about the bank. Only the SENTENCE changes.
    expect(src).toMatch(/shouldOfferModuleExam\(\{[\s\S]{0,300}mcqCount/);
  });
});
