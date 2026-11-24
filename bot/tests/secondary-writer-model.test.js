/**
 * bd-t8eevw — G6-8 plain papers get their own registry job, so they can move to another model
 * (Haiku, round-4 eval bd-rzjnjp) without moving G1-5 or G9-12 plain papers.
 */
const { writerModel: pick, SECONDARY_JOB } = require('../shared/services/assessment/secondary-writer-model');
const { resolveModelForJob } = require('../shared/config/model-registry');
// The service resolves both jobs with the settings and hands them in; do the same here.
const writerModel = (grade, family, cfg) => pick(grade,
  resolveModelForJob('assessment.generate', { cfg, family }), resolveModelForJob(SECONDARY_JOB, { cfg, family }));

const VARS = ['ASSESSMENT_GEN_MODEL', 'ASSESSMENT_GEN_MODEL_ENG', 'ASSESSMENT_GEN_MODEL_URDU',
  'ASSESSMENT_GEN_MODEL_SECONDARY'];
const DEFAULT = 'google/gemini-3.1-pro-preview';
const HAIKU = 'anthropic-direct/claude-haiku-5-5';
let saved;
beforeEach(() => { saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  VARS.forEach((k) => delete process.env[k]); });
afterEach(() => VARS.forEach((k) => {
  if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }));

describe('bd-t8eevw — nothing set: every grade resolves exactly as before', () => {
  it.each([6, 7, 8, 9, 12])('grade %i → assessment.generate, its own model', (grade) => {
    expect(writerModel(grade, 'eng', {})).toEqual({ model: DEFAULT, job: 'assessment.generate' });
  });
  it('a family variable still decides, under the plain job', () => {
    process.env.ASSESSMENT_GEN_MODEL_URDU = 'openai/gpt-4o';
    expect(writerModel(7, 'urdu', {})).toEqual({ model: 'openai/gpt-4o', job: 'assessment.generate' });
  });
  it('a settings row on the plain job still moves G6-8', () => {
    const cfg = { perJob: { 'assessment.generate': 'openai/gpt-4o' } };
    expect(writerModel(6, 'eng', cfg)).toEqual({ model: 'openai/gpt-4o', job: 'assessment.generate' });
  });
});

describe('bd-t8eevw — the secondary variable moves G6-8 only', () => {
  beforeEach(() => { process.env.ASSESSMENT_GEN_MODEL_SECONDARY = HAIKU; });
  it.each([6, 7, 8])('grade %i → Haiku on its own job', (grade) => {
    expect(writerModel(grade, 'eng', {})).toEqual({ model: HAIKU, job: SECONDARY_JOB });
    expect(writerModel(String(grade), 'urdu', {})).toEqual({ model: HAIKU, job: SECONDARY_JOB });
  });
  it.each([9, 10, 11, 12])('grade %i stays on the plain job', (grade) => {
    expect(writerModel(grade, 'eng', {})).toEqual({ model: DEFAULT, job: 'assessment.generate' });
  });
  it('the kill switch puts G6-8 back on the plain job', () => {
    expect(writerModel(7, 'eng', { killSwitch: true })).toEqual({ model: DEFAULT, job: 'assessment.generate' });
  });
});

describe('bd-t8eevw — a settings row on the secondary job moves G6-8 with no variable', () => {
  it('row → that model, its own job', () => {
    const cfg = { perJob: { [SECONDARY_JOB]: HAIKU } };
    expect(writerModel(8, 'eng', cfg)).toEqual({ model: HAIKU, job: SECONDARY_JOB });
    expect(writerModel(9, 'eng', cfg)).toEqual({ model: DEFAULT, job: 'assessment.generate' });
  });
});
