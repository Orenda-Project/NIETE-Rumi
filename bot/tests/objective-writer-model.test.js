/**
 * bd-rzjnjp.6 — G1-5 objective-only and maths papers get their own registry job, so they can move to
 * Flash (round-8 eval bd-rzjnjp: obj +0.7, mathpic +0.4, both pass) while topic papers (−1.8, fail),
 * mixed non-maths papers and G6-12 stay on assessment.generate.
 */
const { objectiveWriter: pick, OBJECTIVE_JOB } = require('../shared/services/assessment/objective-writer-model');
const { resolveModelForJob } = require('../shared/config/model-registry');
const writer = (paper, family, cfg) => pick(paper,
  resolveModelForJob('assessment.generate', { cfg, family }), resolveModelForJob(OBJECTIVE_JOB, { cfg, family }));

const VARS = ['ASSESSMENT_GEN_MODEL', 'ASSESSMENT_GEN_MODEL_ENG', 'ASSESSMENT_GEN_MODEL_URDU',
  'ASSESSMENT_GEN_MODEL_OBJECTIVE'];
const DEFAULT = 'google/gemini-3.1-pro-preview';
const FLASH = 'google/gemini-3.8-flash';
const PLAIN = { model: DEFAULT, job: 'assessment.generate' };
const OBJ = [{ category: 'objective' }, { category: 'objective' }];
const MIXED = [{ category: 'objective' }, { category: 'subjective' }];
let saved;
beforeEach(() => { saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  VARS.forEach((k) => delete process.env[k]); });
afterEach(() => VARS.forEach((k) => {
  if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }));

describe('bd-rzjnjp.6 — nothing set: every paper resolves exactly as before', () => {
  it.each([
    [{ grade: 3, subjectKey: 'eng', questionTypes: OBJ }],
    [{ grade: 4, subjectKey: 'maths', questionTypes: MIXED }],
  ])('%o → plain job', (paper) => { expect(writer(paper, 'eng', {})).toEqual(PLAIN); });
  it('a settings row on the plain job still decides', () => {
    const cfg = { perJob: { 'assessment.generate': 'openai/gpt-4o' } };
    expect(writer({ grade: 2, subjectKey: 'eng', questionTypes: OBJ }, 'eng', cfg))
      .toEqual({ model: 'openai/gpt-4o', job: 'assessment.generate' });
  });
});

describe('bd-rzjnjp.6 — the objective variable moves passing paper types only', () => {
  beforeEach(() => { process.env.ASSESSMENT_GEN_MODEL_OBJECTIVE = FLASH; });
  const FL = { model: FLASH, job: 'assessment.generate.objective' };
  it('all-objective G1-5 paper → Flash', () => {
    expect(writer({ grade: 3, subjectKey: 'eng', questionTypes: OBJ }, 'eng', {})).toEqual(FL);
    expect(writer({ grade: '5', subjectKey: 'urdu', questionTypes: OBJ, slos: [] }, 'urdu', {})).toEqual(FL);
  });
  it('a G1-5 maths paper with written questions → Flash', () => {
    expect(writer({ grade: 1, subjectKey: 'maths', questionTypes: MIXED }, 'eng', {})).toEqual(FL);
  });
  it('a topic paper (slos given) stays on the plain job', () => {
    expect(writer({ grade: 3, subjectKey: 'maths', questionTypes: OBJ, slos: ['M3.1'] }, 'eng', {})).toEqual(PLAIN);
  });
  it('a mixed non-maths paper stays', () => {
    expect(writer({ grade: 3, subjectKey: 'eng', questionTypes: MIXED }, 'eng', {})).toEqual(PLAIN);
  });
  it('an empty question list is not "all objective"', () => {
    expect(writer({ grade: 3, subjectKey: 'eng', questionTypes: [] }, 'eng', {})).toEqual(PLAIN);
  });
  it.each([6, 8, 9, 12])('grade %i stays', (grade) => {
    expect(writer({ grade, subjectKey: 'maths', questionTypes: OBJ }, 'eng', {})).toEqual(PLAIN);
  });
  it('the kill switch puts it back on the plain job', () => {
    expect(writer({ grade: 3, subjectKey: 'eng', questionTypes: OBJ }, 'eng', { killSwitch: true })).toEqual(PLAIN);
  });
});

describe('bd-rzjnjp.6 — a settings row on the objective job moves it with no variable', () => {
  it('row → that model, its own job', () => {
    const cfg = { perJob: { [OBJECTIVE_JOB]: FLASH } };
    expect(writer({ grade: 2, subjectKey: 'maths', questionTypes: MIXED }, 'eng', cfg))
      .toEqual({ model: FLASH, job: OBJECTIVE_JOB });
  });
});
