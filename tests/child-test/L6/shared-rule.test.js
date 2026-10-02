/**
 * Child test check — the prefill rule and the edits diff, exported from the check-flow entry point so the
 * app channel (L7) uses the same ones as the WhatsApp Flow (CONTRACT §14 item 6/7: one rule, one diff).
 * Real: the planner, the bars, the diff. No I/O.
 */


const CheckFlow = require('../../../bot/shared/services/child-test/check-flow');
const F = require('./fixtures/ai-marks');

// Form logic is tested against fixed bars (bars.DEFAULT_BARS); the real calibration is tested in real-thresholds.test.js.
const Bars = require('../../../bot/shared/services/child-test/check-flow/bars');
Bars.__pinBarsForTest(Bars.DEFAULT_BARS);   // at load: some screens are built while the suite is collected
afterAll(() => Bars.__pinBarsForTest(null));


describe('the check-flow entry point exports the one prefill rule and the one diff', () => {
  test('isPrefilled: at or above the field bar is pre-filled, below it arrives empty', () => {
    expect(CheckFlow.isPrefilled('story.words_correct', 0.95)).toBe(true);
    expect(CheckFlow.isPrefilled('story.words_correct', 0.1)).toBe(false);
    expect(CheckFlow.isPrefilled('first_sounds', 0.4)).toBe(false);
  });

  test('planBlock: the same plan the Flow renders from (urdu, confident story count filled)', () => {
    const items = CheckFlow.formItems('3', 'A');
    const plan = CheckFlow.planBlock('urdu', { aiMarks: F.urduConfident(), items });
    expect(plan.story.filled).toBe(true);
    expect(plan.flags.shown.length).toBeLessThanOrEqual(20);
  });

  test('diffMarks: a changed count is one edit with path, ai and coach', () => {
    const ai = F.urduConfident();
    const coach = JSON.parse(JSON.stringify(ai));
    coach.story.words_correct = ai.story.words_correct - 2;
    const edits = CheckFlow.diffMarks('urdu', ai, coach);
    expect(edits).toContainEqual({ path: 'story.words_correct', ai: ai.story.words_correct, coach: ai.story.words_correct - 2 });
  });
});
