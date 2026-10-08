/**
 * bd-gr4fy.5.8 — the two jobs that choose their model at the call site read stale settings first, too.
 *
 * bd-gr4fy.14 made a call that finds the settings too old read them once, briefly, before its job is planned. Two
 * jobs never reached that wait in time: vision.analyse and assessment.generate pick their model from the settings
 * AT THE CALL SITE (`settingsAtSite`), synchronously, and only then hand the request to the client, where the wait
 * runs. So the first photo (or paper) a process handled after more than two minutes without a labelled call went
 * out on the job's own model even with the per-job row in force, and the read it started landed a moment later.
 * Seen on staging 2026-10-08: photo 1 started on gpt-4.1-mini at 06:31:35.790Z, that worker's settings read landed
 * at 06:31:35.950Z, photo 2 went to the row's Claude model. In production, 3 of 365 photos since the release.
 *
 * Pinned here: both call sites wait for that one bounded read before they choose, with .14's semantics unchanged:
 * a read that hangs is waited out once, a failed read moves nothing, fresh settings cost no read.
 *
 * Executed for real: vision.service, the assessment generator, the settings module and the client. Only the
 * network edges are replaced: the Supabase client the settings are read through, and the model SDK.
 */
const mockState = { rows: [], queryError: null, hang: false, release: null, reads: 0, sent: [] };

// A reply both callers accept: the generator parses it as a one-question paper, vision passes it through.
const mockPaper = JSON.stringify({ unseen: { objective: { MCQs: [{ question: 'q', marks: 1, answer: 'a' }] } } });

jest.mock('openai', () => function OpenAI() {
  return { chat: { completions: { create: async (params) => {
    mockState.sent.push(params.model);
    return { choices: [{ message: { content: mockPaper }, finish_reason: 'stop' }], usage: {} };
  } } } };
});
jest.mock('@anthropic-ai/sdk', () => function Anthropic() { return { messages: { create: async () => ({}) } }; });
jest.mock('../../bot/shared/utils/model-cost', () => ({ recordModelCost: () => {} }));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => ({ select: () => ({ in: () => {
    mockState.reads += 1;
    if (mockState.hang) return new Promise((resolve) => { mockState.release = () => resolve({ data: mockState.rows, error: null }); });
    return Promise.resolve(mockState.queryError
      ? { data: null, error: { message: mockState.queryError } }
      : { data: mockState.rows, error: null });
  } }) }),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: () => {}, getCurrentCorrelationId: () => 'corr-1' }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: () => {} }));
jest.mock('../../bot/shared/services/e2e-cassette', () => ({ mode: () => 'off', wrapChatCompletions: () => {} }), { virtual: true });

const OLD_ENV = { ...process.env };
const CLAUDE = 'anthropic/claude-sonnet-5';
const rowFor = (job) => ({ key: 'llm_per_job', value: { [job]: CLAUDE } });
const killSwitch = { key: 'llm_kill_switch', value: true };

let now;
let settings;

function load() {
  jest.resetModules();
  for (const k of ['LLM_JOB_MODELS', 'VISION_MODEL', 'ASSESSMENT_GEN_MODEL', 'ASSESSMENT_GEN_MODEL_ENG', 'ASSESSMENT_GEN_MODEL_URDU']) delete process.env[k];
  Object.assign(process.env, {
    OPENROUTER_API_KEY: 'or-key', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test',
    LLM_SETTINGS_FRESH_WAIT_MS: '50',
  });
  // eslint-disable-next-line global-require
  settings = require('../../bot/shared/config/model-settings');
}

/** One classroom photo through vision.analyse; returns the model the request went out on. */
async function photo() {
  // eslint-disable-next-line global-require
  const { analyzeImage } = require('../../bot/shared/services/vision.service');
  const result = await analyzeImage(Buffer.from('fake-jpeg'), 'image/jpeg', { language: 'en' });
  expect(result.success).toBe(true);
  return mockState.sent[mockState.sent.length - 1];
}

/** One English paper through assessment.generate; returns the model the request went out on. */
async function paper() {
  // eslint-disable-next-line global-require
  const { generateExam } = require('../../bot/shared/services/assessment/assessment-generation.service');
  await generateExam({
    grade: 3, subject: 'Eng', pageContent: '=== Page 4 ===\nCHAPTER 1\nHello', pageReference: '4',
    contentSource: 'unseen', questionTypes: [{ id: 'MCQs', count: 1, category: 'objective' }],
  });
  return mockState.sent[mockState.sent.length - 1];
}

const notMoved = (sent) => expect(sent).not.toBe(CLAUDE);

beforeEach(() => {
  Object.assign(mockState, { rows: [], queryError: null, hang: false, release: null, reads: 0, sent: [] });
  now = 5_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  load();
});
afterEach(() => {
  Date.now.mockRestore();
  process.env = { ...OLD_ENV };
});

describe.each([
  ['vision.analyse', photo],
  ['assessment.generate', paper],
])('%s chooses its model from settings read first when they are too old (bd-gr4fy.5.8)', (job, call) => {
  test('a fresh process with the row in force: its FIRST call goes out on the row\'s model', async () => {
    mockState.rows = [rowFor(job)];
    expect(await call()).toBe(CLAUDE);
  });

  test('a quiet process (settings older than two refresh periods) with the row still in force: the next call uses it', async () => {
    mockState.rows = [rowFor(job)];
    await settings.refresh();
    expect(await call()).toBe(CLAUDE);
    now += 3 * settings.TTL_MS;
    expect(await call()).toBe(CLAUDE);
    expect(mockState.reads).toBe(2);
  });

  test('the kill switch flipped while the process was quiet wins on that first call', async () => {
    mockState.rows = [rowFor(job)];
    await settings.refresh();
    expect(await call()).toBe(CLAUDE);
    now += 3 * settings.TTL_MS;
    mockState.rows = [killSwitch, rowFor(job)];
    notMoved(await call());
  });

  test('a read that hangs is waited out ONCE: own model after the bound, and the calls behind it do not wait again', async () => {
    Date.now.mockRestore();
    jest.spyOn(Date, 'now').mockImplementation(() => now); // the cache clock stays fixed; the bound runs on real timers
    process.env.LLM_SETTINGS_FRESH_WAIT_MS = '200';
    mockState.rows = [rowFor(job)];
    mockState.hang = true;
    let t0 = process.hrtime.bigint();
    notMoved(await call());
    expect(Number(process.hrtime.bigint() - t0) / 1e6).toBeLessThan(1000);
    t0 = process.hrtime.bigint();
    for (let i = 0; i < 3; i++) notMoved(await call());
    expect(Number(process.hrtime.bigint() - t0) / 1e6).toBeLessThan(150); // three more waits would take 600 ms
    expect(mockState.reads).toBe(1);
  });

  test('database down: own model, one read, no wait per call', async () => {
    mockState.queryError = 'connection refused';
    for (let i = 0; i < 3; i++) notMoved(await call());
    expect(mockState.reads).toBe(1);
  });

  test('fresh settings: no extra read', async () => {
    mockState.rows = [rowFor(job)];
    await settings.refresh();
    for (let i = 0; i < 3; i++) expect(await call()).toBe(CLAUDE);
    expect(mockState.reads).toBe(1);
  });
});
