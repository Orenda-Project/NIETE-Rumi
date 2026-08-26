/**
 * bd-b5elb — the coach-feedback validator dead-ended real debriefs. When the
 * LLM's output failed validateCoachFeedback (e.g. flagged the debrief harmful
 * but still filled wins, or missed praise_line), the job logged
 * "coach-feedback LLM failed/invalid", told the coach "couldn't analyze it",
 * and stopped — with NO retry of the LLM call. Live: 10 sessions since 20-Aug
 * hold a debrief transcript and no feedback (Fakhr 24-Aug, Meerab R124 among
 * them); three distinct validator errors fired in ONE morning.
 *
 * Contract: one GUIDED repair — the validator's error is fed back and the
 * model corrects the shape; the harm gate stays programmatic (a repair that
 * still fails validation throws — never a bypass, never manufactured praise).
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const RUBRIC = {
  opened_with_specific_praise: true, anchored_in_real_moment: true,
  asked_and_waited: true, one_improvement_only: true, moves_not_teacher: true,
  elicited_if_then: true, righting_reflex_held: true, disparaged_teacher: false,
};

function validFeedback() {
  return {
    praise_line: 'Well led.',
    wins: [
      { behaviour: 'b1', evidence: 'e1' },
      { behaviour: 'b2', evidence: 'e2' },
    ],
    try: { move: 'm', evidence: 'e' },
    rubric: { ...RUBRIC },
  };
}

describe('bd-b5elb · one guided repair on validator rejection', () => {
  const calls = [];
  beforeEach(() => {
    jest.resetModules(); calls.length = 0;
  });
  afterEach(() => jest.resetModules());

  function loadWithLLM(results) {
    let i = 0;
    jest.doMock('../../shared/services/gpt5-mini.service', () => ({
      completeJson: jest.fn(async (prompt, opts) => {
        calls.push({ prompt, label: opts && opts.label });
        const r = results[Math.min(i, results.length - 1)]; i += 1;
        return { result: typeof r === 'function' ? r() : r };
      }),
    }));
    return require('../../shared/services/observe/observe-debrief.service');
  }

  it('an invalid first answer is repaired: the retry prompt carries the validator error', async () => {
    const bad = { ...validFeedback(), praise_line: '' };   // "feedback needs a praise_line"
    const D = loadWithLLM([bad, validFeedback()]);
    const out = await D.coachFeedbackWithRepair('PROMPT', 's1');
    expect(out.praise_line).toBe('Well led.');
    expect(calls.length).toBe(2);
    expect(calls[1].prompt).toMatch(/praise_line/);        // the error text fed back
    expect(calls[1].label).toBe('observeCoachFeedbackRepair');
  });

  it('a valid first answer never triggers a second call', async () => {
    const D = loadWithLLM([validFeedback()]);
    await D.coachFeedbackWithRepair('PROMPT', 's1');
    expect(calls.length).toBe(1);
  });

  it('the harm gate survives the repair: a still-invalid repair THROWS (no bypass)', async () => {
    // harmful rubric (disparaged_teacher true) with wins still filled — twice.
    const harmfulBad = () => ({
      ...validFeedback(),
      rubric: { ...RUBRIC, disparaged_teacher: true },
    });
    const D = loadWithLLM([harmfulBad, harmfulBad]);
    await expect(D.coachFeedbackWithRepair('PROMPT', 's1')).rejects.toThrow();
    expect(calls.length).toBe(2);
  });

  it('the job path uses the repair helper (wiring)', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../shared/services/observe/observe-debrief.service.js'), 'utf8');
    expect(src).toMatch(/coachFeedbackWithRepair\(/);
  });
});
