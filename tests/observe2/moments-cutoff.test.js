/**
 * /observe2 — a moments reply cut off at the output limit is not "Rumi heard nothing" (bd-eal7zn.3).
 *
 * Three prod checks (12, 13 and 15 Oct) opened with four empty screens: the model spent all 16,000
 * output tokens, the reply came back with no moment in it, and it was stored as a success and sent as
 * "found 0 moments". A cut-off reply is now asked for once more; cut off twice, it is a failure with
 * its own log line and the existing failure path, never an empty check.
 *
 * Real: the moments module, the store, the rules, completeJson. Mocked at the boundary: the database
 * (in-memory), WhatsApp, the LLM client.
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
const mockCreate = jest.fn();
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
}));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { logToFile } = require('../../bot/shared/utils/logger');
const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Moments = require('../../bot/shared/services/observe/observe2/moments');
const { observe2Strings } = require('../../bot/shared/services/observe/observe2/strings');

const TRANSCRIPT = [
  '[00:40] Teacher (UR): Why do plants need sunlight? What do you think?',
  '[00:52] Student (UR): Because they make their food from it.',
  '[05:10] Teacher (UR): No, that is wrong. Who else?',
].join('\n\n');
const MODEL_OUT = {
  moments: [
    { moment: 'ask', type: 'open_q_one', minute: '00:40', quote: 'Why do plants need sunlight? What do you think?' },
    { moment: 'ask', type: 'reasoning', minute: '00:52', quote: 'Because they make their food from it.' },
  ],
  counts: { closed_q: 1, praise_generic: 0 },
};
const reply = (out, used) => ({ result: out, usage: { completion_tokens: used } });
const CUT = reply({ moments: [] }, 16000);
// The label check (bd-eal7zn.8) has its own seam here, so these tests count the moments call only.
const keepAll = () => Promise.resolve(reply({ verdicts: [] }, 100));

const formRow = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const session = () => mockFake.__tables.coaching_sessions[0];

async function linked() {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(formRow(form.id), { period_minutes: 40, sealed_at: '2026-10-15T05:43:00.000Z' });
  mockFake.__tables.coaching_sessions = [{ id: 'sess-1', status: 'transcription_complete', transcript_text: TRANSCRIPT, observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 'teacher-1' }];
  await Store.linkSession(form.id, 'sess-1');
  return form.id;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockReset();
  mockFake = createFakeSupabase({
    users: [{ id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en' }],
  });
  process.env.OBSERVE2_CHECK_FLOW_ID = 'F-CHECK';
});
afterAll(() => { delete process.env.OBSERVE2_CHECK_FLOW_ID; });

describe('a reply that used the whole output limit', () => {
  test('is asked for once more, and the second reply is what the coach checks', async () => {
    const id = await linked();
    const llm = jest.fn().mockResolvedValueOnce(CUT).mockResolvedValueOnce(reply(MODEL_OUT, 9000));
    const out = await Moments.runForSession('sess-1', '923000000001', { llm, labelLlm: keepAll });
    expect(llm).toHaveBeenCalledTimes(2);
    expect(llm.mock.calls[0][1]).toEqual(expect.objectContaining({ maxTokens: 16000 }));
    expect(formRow(id).rumi_moments.moments).toHaveLength(2);
    expect(out).toMatchObject({ action: 'check_sent' });
    expect(logToFile).toHaveBeenCalledWith(expect.stringMatching(/moments reply cut off at the output limit/), expect.objectContaining({ formId: id, attempt: 1 }), 'warn');
  });

  test('cut off twice: the failure path with its own log line, never a check with no moment', async () => {
    const id = await linked();
    const llm = jest.fn().mockResolvedValue(CUT);
    const out = await Moments.runForSession('sess-1', '923000000001', { llm, labelLlm: keepAll });
    expect(llm).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ action: 'failed' });
    expect(session().status).toBe('observe2_failed');
    expect(formRow(id).moments_ready_at).toBeUndefined();
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith('923000000001', observe2Strings('en').moments_failed);
    expect(logToFile).toHaveBeenCalledWith(expect.stringMatching(/moments reply cut off at the output limit/), expect.objectContaining({ attempt: 2 }), 'error');
  });

  test('a reply under the limit is read once', async () => {
    await linked();
    const llm = jest.fn().mockResolvedValue(reply(MODEL_OUT, 15999));
    await Moments.runForSession('sess-1', '923000000001', { llm, labelLlm: keepAll });
    expect(llm).toHaveBeenCalledTimes(1);
  });
});

describe('the default reader (completeJson, the LLM client mocked)', () => {
  const choice = (content, finish) => ({ choices: [{ finish_reason: finish, message: { content } }], usage: { completion_tokens: finish === 'length' ? 16000 : 8000 } });

  test('a cut-off reply from the model is asked again through the real completeJson', async () => {
    const id = await linked();
    mockCreate
      .mockResolvedValueOnce(choice('{"moments":[', 'length'))
      .mockResolvedValueOnce(choice(JSON.stringify(MODEL_OUT), 'stop'))
      .mockResolvedValueOnce(choice(JSON.stringify({ verdicts: [{ n: 1, verdict: 'keep' }, { n: 2, verdict: 'keep' }] }), 'stop'));
    const out = await Moments.runForSession('sess-1', '923000000001');
    // the moments call twice (cut off, then asked again), then the label check once
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ max_completion_tokens: 16000, job: 'observe2.moments' }); // its own job (bd-08qvls.1)
    expect(formRow(id).rumi_moments.moments).toHaveLength(2);
    expect(out).toMatchObject({ action: 'check_sent' });
  });
});
