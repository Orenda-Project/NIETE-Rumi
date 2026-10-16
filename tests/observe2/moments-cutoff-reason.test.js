/**
 * /observe2 — a reply is cut off when its finish reason says so, not when it is long (bd-08qvls.1).
 *
 * moments.js and label-check.js read any reply of 16,000 output tokens or more as cut off. A moved job is
 * given more room than the call asked for (llm-client adaptForTarget: a moved Claude job gets up to twice,
 * at most 4,096 more), so in the model eval (16 Oct 2026) complete Claude Sonnet 5 replies of ~17,000 tokens
 * were read as cut off, asked for again, and two visits failed. The reply's own finish reason ('length';
 * Anthropic's 'max_tokens', which the direct lane maps to 'length') is now the signal. A bare reply with no
 * finish reason (a seam) is judged against the limit the model actually had.
 *
 * Real: the moments module, the quote and label checks, the store, completeJson. Mocked at the boundary:
 * the database (in-memory), WhatsApp, the LLM client.
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
const mockCreate = jest.fn();
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/llm-client', () => ({
  ...jest.requireActual('../../bot/shared/services/llm-client'),
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
}));

const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Moments = require('../../bot/shared/services/observe/observe2/moments');

const TRANSCRIPT = [
  '[00:40] Teacher (UR): Why do plants need sunlight? What do you think?',
  '[00:52] Student (UR): Because they make their food from it.',
].join('\n\n');
const MODEL_OUT = {
  moments: [
    { moment: 'ask', type: 'open_q_one', minute: '00:40', quote: 'Why do plants need sunlight? What do you think?', why: 'x y z' },
    { moment: 'ask', type: 'reasoning', minute: '00:52', quote: 'Because they make their food from it.', why: 'x y z' },
  ],
  counts: { closed_q: 0, praise_generic: 0 },
};
const KEEP = { verdicts: [{ n: 1, verdict: 'keep' }, { n: 2, verdict: 'keep' }] };
const choice = (obj, finish, used) => ({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(obj) } }], usage: { completion_tokens: used } });
const formRow = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);

async function linked() {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(formRow(form.id), { period_minutes: 40, sealed_at: '2026-10-16T05:43:00.000Z' });
  mockFake.__tables.coaching_sessions = [{ id: 'sess-1', status: 'transcription_complete', transcript_text: TRANSCRIPT, observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 'teacher-1' }];
  await Store.linkSession(form.id, 'sess-1');
  return form.id;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockReset();
  mockFake = createFakeSupabase({ users: [{ id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en' }] });
  process.env.OBSERVE2_CHECK_FLOW_ID = 'F-CHECK';
});
afterAll(() => { delete process.env.OBSERVE2_CHECK_FLOW_ID; });

describe('the finish reason decides, through the real completeJson', () => {
  test('a complete moments reply of 17,000 tokens is read once and stored', async () => {
    const id = await linked();
    mockCreate
      .mockResolvedValueOnce(choice(MODEL_OUT, 'stop', 17000))
      .mockResolvedValueOnce(choice(KEEP, 'stop', 800));
    const out = await Moments.runForSession('sess-1', '923000000001');
    expect(mockCreate).toHaveBeenCalledTimes(2); // the moments once, the label check once
    expect(formRow(id).rumi_moments.moments).toHaveLength(2);
    expect(out).toMatchObject({ action: 'check_sent' });
  });

  test('a reply cut off at 9,000 tokens (finish_reason length) is asked for once more', async () => {
    const id = await linked();
    mockCreate
      .mockResolvedValueOnce(choice({ moments: [] }, 'length', 9000))
      .mockResolvedValueOnce(choice(MODEL_OUT, 'stop', 9000))
      .mockResolvedValueOnce(choice(KEEP, 'stop', 800));
    await Moments.runForSession('sess-1', '923000000001');
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(formRow(id).rumi_moments.moments).toHaveLength(2);
  });

  test('a complete label-check reply of 17,000 tokens is applied, not failed as cut off', async () => {
    const id = await linked();
    mockCreate
      .mockResolvedValueOnce(choice(MODEL_OUT, 'stop', 9000))
      .mockResolvedValueOnce(choice({ verdicts: [{ n: 1, verdict: 'keep' }, { n: 2, verdict: 'drop' }] }, 'stop', 17000));
    await Moments.runForSession('sess-1', '923000000001');
    expect(formRow(id).rumi_moments.verified.labels).toMatchObject({ status: 'ok', kept: 1, dropped: 1 });
    expect(formRow(id).rumi_moments.moments).toHaveLength(1);
  });

  test('a label-check reply cut off (finish_reason length) is a failure, and the moments are kept', async () => {
    const id = await linked();
    mockCreate
      .mockResolvedValueOnce(choice(MODEL_OUT, 'stop', 9000))
      .mockResolvedValueOnce(choice({ verdicts: [] }, 'length', 3000));
    await Moments.runForSession('sess-1', '923000000001');
    expect(formRow(id).rumi_moments.verified.labels).toMatchObject({ status: 'failed', reason: expect.stringContaining('cut_off') });
    expect(formRow(id).rumi_moments.moments).toHaveLength(2);
  });
});

describe('a reply with no finish reason is judged against the limit the model actually had', () => {
  const bare = (used, override) => ({ result: MODEL_OUT, usage: { completion_tokens: used, ...(override ? { job_override: { from: 'gpt-5-mini-2025-08-07', to: override, source: 'settings' } } : {}) } });
  const keepAll = () => Promise.resolve({ result: KEEP, usage: { completion_tokens: 100 } });

  test('17,000 tokens on a job moved to Claude (allowed 20,096) is complete', async () => {
    const id = await linked();
    const llm = jest.fn(() => Promise.resolve(bare(17000, 'anthropic/claude-sonnet-5.5')));
    await Moments.runForSession('sess-1', '923000000001', { llm, labelLlm: keepAll });
    expect(llm).toHaveBeenCalledTimes(1);
    expect(formRow(id).rumi_moments.moments).toHaveLength(2);
  });

  test('16,000 tokens on the job\'s own model is cut off, as before', async () => {
    await linked();
    const llm = jest.fn(() => Promise.resolve(bare(16000, null)));
    await Moments.runForSession('sess-1', '923000000001', { llm, labelLlm: keepAll });
    expect(llm).toHaveBeenCalledTimes(2);
  });
});
