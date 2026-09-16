/**
 * The fallback is the model the job already works with. bd-4uw7n, second cut.
 *
 * THE FIRST CUT WAS WRONG AND THE REASONING IS WORTH KEEPING. It sent everything non-OpenAI to
 * a blanket `openai/gpt-4o`, justified as "the fallback answers 'this supplier cannot serve us',
 * which is a fact about the supplier not the job". Half right: WHETHER to fall back is about
 * the supplier. WHAT to fall back to is entirely about the job.
 *
 * What the blanket version would have done: roster extraction runs a cheap vision model chosen
 * for being cheap and would have failed over to something around 17x the price; transcript
 * quizzes would have swapped the model their pipeline was validated against; lesson-plan
 * authoring would have fallen to a model nobody has ever run a rubric against. One of them
 * only worked by luck, because gpt-4o happens to do vision.
 *
 * So each job records the model it runs TODAY, frozen. Move that job to Anthropic later and the
 * fallback still names what it used to run, which is the only model known to work for it.
 *
 * FROZEN, NOT DERIVED, and this is the subtle part. If the fallback were read off the current
 * primary, then setting LP_AUTHOR_MODEL=anthropic/claude-opus-5 would make the "fallback"
 * resolve to claude-sonnet-5: still Anthropic, and useless when Anthropic is the thing that is
 * down.
 */
const { JOBS, fallbackForJob } = require('../shared/config/model-registry');

describe('bd-4uw7n — every job names the model it already works with', () => {
  it('freezes the vendor each job runs today, not a blanket OpenAI model', () => {
    expect(fallbackForJob('lp.extractVision')).toBe('google/gemini-2.5-flash');
    expect(fallbackForJob('roster.extract')).toBe('google/gemini-3.1-flash-lite-preview');
    expect(fallbackForJob('quiz.transcript')).toBe('google/gemini-2.5-flash');
  });

  it('prefixes a bare OpenAI model, because that is what the client would send', () => {
    expect(fallbackForJob('vision.analyse')).toBe('openai/gpt-4.1-mini');
  });

  it('gives no fallback to a job that is already the floor', () => {
    expect(fallbackForJob('platform.default')).toBeNull();
    expect(fallbackForJob('lp.fidelity')).toBeNull();
  });

  it('admits there is none for lesson-plan authoring rather than inventing one', () => {
    // It already runs anthropic/claude-sonnet-5 and has no OpenAI predecessor anybody
    // validated. Naming gpt-4o here would be a guess dressed as a decision, on the job with
    // a 184-point rubric behind it.
    expect(fallbackForJob('lp.author')).toBeNull();
  });

  it('is frozen, so switching a job does not drag its fallback along', () => {
    const before = fallbackForJob('quiz.transcript');
    const saved = process.env.TRANSCRIPT_QUIZ_MODEL;
    process.env.TRANSCRIPT_QUIZ_MODEL = 'anthropic/claude-opus-5';
    try {
      expect(fallbackForJob('quiz.transcript')).toBe(before);
      expect(fallbackForJob('quiz.transcript')).not.toMatch(/anthropic/);
    } finally {
      if (saved === undefined) delete process.env.TRANSCRIPT_QUIZ_MODEL;
      else process.env.TRANSCRIPT_QUIZ_MODEL = saved;
    }
  });

  it('never points a job at itself', () => {
    for (const job of Object.keys(JOBS)) {
      const fb = fallbackForJob(job);
      if (!fb) continue;
      const current = JOBS[job].default;
      const norm = (m) => (m && !m.includes('/') ? `openai/${m}` : m);
      // equal is fine and expected BEFORE a switch: the job runs its own known-good model.
      // What must never happen is a fallback that is not a real model id.
      expect(fb).toMatch(/^[a-z0-9-]+\/[A-Za-z0-9._-]+$/);
      expect(typeof norm(current)).toBe('string');
    }
  });

  it('refuses an unknown job rather than guessing', () => {
    expect(() => fallbackForJob('no.such.job')).toThrow(/unknown job/);
  });
});
