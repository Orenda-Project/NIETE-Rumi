/**
 * bd-jntcx — assessment generation joins the registry.
 *
 * Found from the FIRST production spend data, which only exists because the telemetry reached
 * main: NIETE production runs ~3,300 model calls a day for ~$33, and this job is the SECOND
 * biggest line at $11.34/day on `google/gemini-3.1-pro-preview`. It was not in the registry at
 * all, so it could not be switched without a deploy, could not be rolled out gradually, and had
 * no frozen fallback — the three things the registry exists to provide.
 *
 * It was picked the same way `vision.analyse` used to be, and with the same flaw:
 *
 *   const MODELS = { eng: process.env.ASSESSMENT_GEN_MODEL_ENG || 'google/gemini-3.1-pro-preview',
 *                    urdu: process.env.ASSESSMENT_GEN_MODEL_URDU || '...' };
 *
 * Evaluated ONCE at import, so the model is fixed for the life of the process.
 *
 * THE CONTRACT, and the reason the first block exists: with nothing written to app_settings,
 * every combination of those two variables must resolve to exactly what it resolves to today.
 * Those four cases pass before and after on purpose — a guard that only works after the change
 * guards nothing.
 */
const { resolveModelForJob, todaysModel, fallbackForJob, JOBS } = require('../shared/config/model-registry');

const ENG = 'ASSESSMENT_GEN_MODEL_ENG';
const URDU = 'ASSESSMENT_GEN_MODEL_URDU';
const DEFAULT = 'google/gemini-3.1-pro-preview';
let saved;

beforeEach(() => { saved = { [ENG]: process.env[ENG], [URDU]: process.env[URDU] };
  delete process.env[ENG]; delete process.env[URDU]; });
afterEach(() => { for (const k of [ENG, URDU]) {
  if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

/** What the service computes today, lifted verbatim from assessment-generation.service.js. */
const todayEng = () => process.env[ENG] || DEFAULT;
const todayUrdu = () => process.env[URDU] || DEFAULT;

describe('bd-jntcx — with nothing written, assessment generation is today exactly', () => {
  const via = (family) => todaysModel('assessment.generate', family ? { family } : {});

  it('neither variable set → both languages get the default', () => {
    expect(via('eng')).toBe(todayEng());
    expect(via('urdu')).toBe(todayUrdu());
    expect(via('eng')).toBe(DEFAULT);
  });

  it('ENG set alone → English follows it, and Urdu does NOT inherit it', () => {
    process.env[ENG] = 'openai/gpt-4o';
    expect(via('eng')).toBe(todayEng());
    // The exactness this row is shaped for. Naming ENG as the job's `env` would make it the
    // fallback for every family, so setting English alone would quietly move Urdu too.
    expect(via('urdu')).toBe(todayUrdu());
    expect(via('urdu')).toBe(DEFAULT);
  });

  it('URDU set alone → Urdu follows it, and English does NOT inherit it', () => {
    process.env[URDU] = 'google/gemini-2.5-flash';
    expect(via('urdu')).toBe(todayUrdu());
    expect(via('eng')).toBe(todayEng());
    expect(via('eng')).toBe(DEFAULT);
  });

  it('both set → each language follows its own', () => {
    process.env[ENG] = 'openai/gpt-4o';
    process.env[URDU] = 'google/gemini-2.5-flash';
    expect(via('eng')).toBe(todayEng());
    expect(via('urdu')).toBe(todayUrdu());
  });

  it('a caller that names no family lands on the literal, never on one language\'s variable', () => {
    process.env[ENG] = 'openai/gpt-4o';
    process.env[URDU] = 'google/gemini-2.5-flash';
    expect(via()).toBe(DEFAULT);
  });
});

describe('bd-jntcx — and it is a registry job like any other', () => {
  it('is in the table, with its call site recorded', () => {
    expect(JOBS['assessment.generate']).toBeDefined();
    expect(JOBS['assessment.generate'].site).toMatch(/assessment-generation\.service/);
  });

  it('its frozen fallback is the model it already runs, so the ladder is inert today', () => {
    expect(fallbackForJob('assessment.generate')).toBe(DEFAULT);
    expect(resolveModelForJob('assessment.generate').model).toBe(DEFAULT);
  });

  it('a settings row moves it without a deploy', () => {
    const cfg = { perJob: { 'assessment.generate': 'anthropic/claude-sonnet-5' } };
    expect(resolveModelForJob('assessment.generate', { cfg }).model).toBe('anthropic/claude-sonnet-5');
    expect(resolveModelForJob('assessment.generate', { cfg }).source).toBe('per-job');
  });

  it('the kill switch puts it back, whatever else is written', () => {
    const cfg = { perJob: { 'assessment.generate': 'anthropic/claude-sonnet-5' }, killSwitch: true };
    expect(resolveModelForJob('assessment.generate', { cfg }).model).toBe(DEFAULT);
  });
});
