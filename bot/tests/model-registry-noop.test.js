/**
 * THE SAFETY TEST for the model registry. bd-isn68.
 *
 * Choosing a model here was already a settings change rather than a deploy, but it had been
 * invented twelve times with four different fallback idioms. The registry unifies them. What
 * it must not do is change which model any job runs, because that would be a silent
 * behaviour change across a deployment that is already multi-vendor in production.
 *
 * So: for every job, with no new settings written, `resolveModelForJob` must equal the
 * expression that resolves it today, read out of the shipping code and reproduced here
 * independently rather than imported from the registry.
 */
const { JOBS, resolveModelForJob, todaysModel } = require('../shared/config/model-registry');

// Reproduced from the shipping code on develop, 9 Sep 2026. Deliberately NOT read from the
// registry: a test that imports the thing it is checking proves only that it is consistent
// with itself.
const TODAY = {
  'lp.author':        () => (process.env.LP_AUTHOR_MODEL || '').trim() || 'anthropic/claude-sonnet-5',
  'lp.fidelity':      () => process.env.LP_FIDELITY_MODEL || 'openai/gpt-5.6-luna',
  'lp.extractVision': () => process.env.LP_EXTRACTION_VISION_MODEL || 'google/gemini-2.5-flash',
  'vision.analyse':   () => process.env.VISION_MODEL || 'gpt-4.1-mini',
  'roster.extract':   () => process.env.ROSTER_VISION_MODEL || 'google/gemini-3.1-flash-lite-preview',
  'quiz.transcript':  () => (process.env.TRANSCRIPT_QUIZ_MODEL || '').trim() || 'google/gemini-2.5-flash',
  'hcp.feedback':     () => process.env.HCP_FEEDBACK_MODEL || (process.env.LLM_MODEL || 'openai/gpt-4o'),
  'platform.default': () => process.env.LLM_MODEL || 'openai/gpt-4o',
};

const VARS = ['LP_AUTHOR_MODEL', 'LP_AUTHOR_MODEL_MATHS_PHYSICS', 'LP_FIDELITY_MODEL',
              'LP_EXTRACTION_VISION_MODEL', 'VISION_MODEL', 'ROSTER_VISION_MODEL',
              'TRANSCRIPT_QUIZ_MODEL', 'HCP_FEEDBACK_MODEL', 'LLM_MODEL'];
let saved;
beforeEach(() => { saved = {}; VARS.forEach((v) => { saved[v] = process.env[v]; delete process.env[v]; }); });
afterEach(() => VARS.forEach((v) => { if (saved[v] === undefined) delete process.env[v]; else process.env[v] = saved[v]; }));

describe('the registry changes nothing', () => {
  it('covers every job, so one cannot be added without an expectation', () => {
    expect(Object.keys(TODAY).sort()).toEqual(Object.keys(JOBS).sort());
  });

  for (const job of Object.keys(TODAY)) {
    it(`${job} resolves to today's model with nothing set`, () => {
      expect(resolveModelForJob(job).model).toBe(TODAY[job]());
      expect(resolveModelForJob(job).source).toBe('today');
    });

    it(`${job} still honours its own env var`, () => {
      process.env[JOBS[job].env] = 'anthropic/claude-opus-5';
      expect(resolveModelForJob(job).model).toBe('anthropic/claude-opus-5');
      expect(resolveModelForJob(job).model).toBe(TODAY[job]());
    });
  }

  it('a maths lesson plan still checks its own pilot variable first', () => {
    process.env.LP_AUTHOR_MODEL = 'anthropic/claude-sonnet-5';
    process.env.LP_AUTHOR_MODEL_MATHS_PHYSICS = 'openai/gpt-4o';
    expect(resolveModelForJob('lp.author', { family: 'maths' }).model).toBe('openai/gpt-4o');
    expect(resolveModelForJob('lp.author', { family: 'prose' }).model).toBe('anthropic/claude-sonnet-5');
  });

  it('unsetting the pilot variable puts every family back, with no deploy', () => {
    process.env.LP_AUTHOR_MODEL = 'anthropic/claude-sonnet-5';
    delete process.env.LP_AUTHOR_MODEL_MATHS_PHYSICS;
    expect(resolveModelForJob('lp.author', { family: 'maths' }).model)
      .toBe('anthropic/claude-sonnet-5');
  });

  it('an empty config is the same as no config', () => {
    for (const job of Object.keys(JOBS)) {
      expect(resolveModelForJob(job, { cfg: {}, language: 'ur', region: 'ict', userId: 'u1' }).model)
        .toBe(todaysModel(job));
    }
  });
});

describe('the four levels this deployment did not have', () => {
  it('the kill switch returns every job to today, whatever else is set', () => {
    const cfg = { killSwitch: true, rollout: { pct: 100, model: 'anthropic/claude-opus-5' },
                  perLanguage: { ur: 'anthropic/claude-opus-5' },
                  perRegion: { ict: 'anthropic/claude-opus-5' } };
    for (const job of Object.keys(JOBS)) {
      const r = resolveModelForJob(job, { cfg, language: 'ur', region: 'ict', userId: 'u1' });
      expect(r.model).toBe(todaysModel(job));
      expect(r.source).toBe('kill-switch');
    }
  });

  it('a rollout is stable for a teacher and splits the population as asked', () => {
    const cfg = { rollout: { pct: 30, model: 'anthropic/claude-opus-5' } };
    const first = resolveModelForJob('lp.author', { cfg, userId: 'teacher-9' }).model;
    for (let i = 0; i < 20; i++) {
      expect(resolveModelForJob('lp.author', { cfg, userId: 'teacher-9' }).model).toBe(first);
    }
    const ids = Array.from({ length: 2000 }, (_, i) => `t${i}`);
    const on = ids.filter((id) =>
      resolveModelForJob('lp.author', { cfg, userId: id }).source === 'rollout').length;
    expect(on / ids.length).toBeGreaterThan(0.25);
    expect(on / ids.length).toBeLessThan(0.35);
  });

  it('a rollout with no teacher to key on does not fire', () => {
    const cfg = { rollout: { pct: 100, model: 'anthropic/claude-opus-5' } };
    expect(resolveModelForJob('lp.author', { cfg }).source).toBe('today');
  });

  it('per-language beats per-region', () => {
    const cfg = { perLanguage: { ur: 'anthropic/claude-opus-5' },
                  perRegion: { ict: 'google/gemini-2.5-flash' } };
    expect(resolveModelForJob('lp.author', { cfg, language: 'ur', region: 'ict' }).source)
      .toBe('per-language');
  });

  it('a language rule can be scoped to one job, and a regional tag matches its base', () => {
    const cfg = { perLanguage: { 'lp.author:ur': 'anthropic/claude-opus-5', ur: 'gpt-4o' } };
    expect(resolveModelForJob('lp.author', { cfg, language: 'ur-PK' }).model)
      .toBe('anthropic/claude-opus-5');
    expect(resolveModelForJob('quiz.transcript', { cfg, language: 'ur' }).model).toBe('gpt-4o');
  });

  it('a setting that is not a model id is ignored rather than sent to a provider', () => {
    const cfg = { perRegion: { ict: 'DROP TABLE users' } };
    const r = resolveModelForJob('lp.author', { cfg, region: 'ict' });
    expect(r.model).toBe(todaysModel('lp.author'));
    expect(r.source).toBe('today');
  });

  it('every answer says where it came from, so a surprise is traceable', () => {
    expect(resolveModelForJob('lp.author').source).toBe('today');
    expect(resolveModelForJob('lp.author', { cfg: { killSwitch: true } }).source).toBe('kill-switch');
    expect(resolveModelForJob('lp.author', { model: 'gpt-4o' }).source).toBe('explicit');
  });
});
