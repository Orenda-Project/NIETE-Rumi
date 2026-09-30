/**
 * /observe2 — the recording, from arrival to the check.
 *
 *   capture   the recording joins the coach's open field form (same coach, same teacher), and the
 *             ack says what happens for that record, not "I'll fill the form in 2-5 minutes";
 *   moments   after transcription, one model call finds the moments; they are stored with the
 *             levels they add up to on their own (never shown), and the session moves to statuses
 *             no /observe sweeper acts on; the photo and lesson-plan prompts are skipped;
 *   the check opens when the record is sealed AND the moments are in, whichever comes last.
 *
 * Real: the capture service, the store, the rules, the moments module. Mocked at the boundary:
 * the database (in-memory), WhatsApp, the queue, the model.
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
  sendInteractiveButtons: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/observe-state.service', () => ({
  getState: jest.fn(() => Promise.resolve(global.__OBS2_STATE || null)),
  setState: jest.fn(() => Promise.resolve(true)),
  clearState: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
  queueTranscription: jest.fn(() => Promise.resolve('msg-1')),
  queueAnalysis: jest.fn(() => Promise.resolve('msg-2')),
}));
jest.mock('../../bot/shared/services/observe/observe-schedule.service', () => ({ markDone: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../../bot/shared/services/observe/observe-who.service', () => ({ maybeAskObservedTeacher: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({ displayTimeZone: () => 'Asia/Karachi' }));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const ObserveWho = require('../../bot/shared/services/observe/observe-who.service');
const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const ObserveCapture = require('../../bot/shared/services/observe/observe-capture.service');
const Moments = require('../../bot/shared/services/observe/observe2/moments');
const Processor = require('../../bot/shared/services/coaching/transcription-processor.service');
const { observe2Strings } = require('../../bot/shared/services/observe/observe2/strings');

const COACH = { id: 'coach-1', role: 'coach', preferred_language: 'en' };
const TEACHER = { user_id: 'teacher-1', teacher_ext_id: 'tx1', teacher_name: 'Rabia', school_ext_id: 'sx1' };
const TRANSCRIPT = [
  '[00:40] Teacher (UR): Why do plants need sunlight? Ali?',
  '[00:52] Student (UR): Because they make food from it.',
  '[05:10] Teacher (UR): No, that is wrong. Who else?',
  '[21:30] Student (UR): I think maybe it is the leaves, but I am not sure.',
].join('\n\n');

const sessions = () => mockFake.__tables.coaching_sessions || [];
const formRow = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);

async function newForm(patch = {}) {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(formRow(form.id), { period_minutes: 40 }, patch);
  return form.id;
}

function llmReturning(out) {
  return jest.fn(() => Promise.resolve(out));
}
const MODEL_OUT = {
  moments: [
    { moment: 'ask', type: 'open_q_one', minute: '00:40', quote: 'Why do plants need sunlight? Ali?' },
    { moment: 'ask', type: 'reasoning', minute: '00:52', quote: 'Because they make food from it.' },
    { moment: 'wrong', type: 'wrong_ignored', minute: '05:10', quote: 'No, that is wrong. Who else?' },
    { moment: 'wrong', type: 'hedged', minute: '21:30', quote: 'I think maybe it is the leaves, but I am not sure.' },
    { moment: 'ask', type: 'invented_type', minute: '09:00', quote: 'dropped' },
  ],
  counts: { closed_q: 4, praise_generic: 2 },
};

beforeEach(() => {
  jest.clearAllMocks();
  global.__OBS2_STATE = { state: 'awaiting_audio', boundTeacher: TEACHER };
  mockFake = createFakeSupabase({
    users: [
      { id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en' },
      { id: 'teacher-1', phone_number: '923000000002', name: 'Rabia', preferred_language: 'en' },
    ],
  });
  process.env.OBSERVE2_CHECK_FLOW_ID = 'F-CHECK';
});
afterAll(() => { delete process.env.OBSERVE2_CHECK_FLOW_ID; });

describe('the recording joins the open field form', () => {
  test('same coach, same teacher: linked, and the ack is the /observe2 one', async () => {
    const id = await newForm({ sealed_at: '2026-09-30T05:39:00.000Z' });
    const session = await ObserveCapture.startFromAudio(COACH, '923000000001', 'audio-1', 'chat-1', 2400);
    expect(formRow(id).coaching_session_id).toBe(session.id);
    const [, msg] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(msg.body).toBe(observe2Strings('en').recording_received(true));
    expect(msg.body).not.toMatch(/2.5 min|fill/i);
    expect(ObserveWho.maybeAskObservedTeacher).not.toHaveBeenCalled();
  });

  test('an unsealed form: the ack asks for the seal first', async () => {
    await newForm();
    await ObserveCapture.startFromAudio(COACH, '923000000001', 'audio-1', 'chat-1', 2400);
    const [, msg] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(msg.body).toBe(observe2Strings('en').recording_received(false));
    expect(msg.body).toMatch(/Seal and send/);
  });

  test('a recording of a different teacher is not linked', async () => {
    const id = await newForm();
    global.__OBS2_STATE = { state: 'awaiting_audio', boundTeacher: { ...TEACHER, user_id: 'teacher-9' } };
    await ObserveCapture.startFromAudio(COACH, '923000000001', 'audio-1', 'chat-1', 2400);
    expect(formRow(id).coaching_session_id).toBeUndefined();
  });

  test('no open form: the classic ack, untouched', async () => {
    await ObserveCapture.startFromAudio(COACH, '923000000001', 'audio-1', 'chat-1', 2400);
    const [, msg] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(msg.body).not.toBe(observe2Strings('en').recording_received(true));
  });
});

describe('what the model returns is kept honest', () => {
  test('unknown types are dropped, minutes sorted, at most eight per group, quotes clipped', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ moment: 'ask', type: 'open_q_choral', minute: `${String(30 - i).padStart(2, '0')}:00`, quote: 'x'.repeat(400) }));
    const { moments, counts } = Moments.normalise({ moments: [...MODEL_OUT.moments, ...many], counts: { closed_q: '4', praise_generic: 'lots' } });
    expect(moments.some((m) => m.type === 'invented_type')).toBe(false);
    expect(moments.filter((m) => m.moment === 'ask')).toHaveLength(8);
    for (const m of moments) expect([...m.quote].length).toBeLessThanOrEqual(280);
    const minutes = moments.filter((m) => m.moment === 'wrong').map((m) => m.minute);
    expect(minutes).toEqual([...minutes].sort());
    expect(new Set(moments.map((m) => m.id)).size).toBe(moments.length);
    expect(counts).toEqual({ closed_q: 4, praise_generic: 0 });
  });
});

describe('after transcription', () => {
  async function linkedSession(formPatch = {}, transcript = TRANSCRIPT) {
    const id = await newForm(formPatch);
    mockFake.__tables.coaching_sessions = [{ id: 'sess-1', status: 'transcription_complete', transcript_text: transcript, observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 'teacher-1' }];
    await Store.linkSession(id, 'sess-1');
    return id;
  }

  test('a sealed record: moments stored with their own levels, then the check is sent', async () => {
    const id = await linkedSession({ sealed_at: '2026-09-30T05:39:00.000Z' });
    const llm = llmReturning(MODEL_OUT);
    const out = await Moments.runForSession('sess-1', '923000000001', { llm });
    expect(llm).toHaveBeenCalledTimes(1);
    expect(llm.mock.calls[0][0]).toContain('[05:10] Teacher (UR): No, that is wrong.');
    const f = formRow(id);
    expect(f.rumi_moments.moments).toHaveLength(4);
    expect(f.rumi_moments.counts).toEqual({ closed_q: 4, praise_generic: 2 });
    expect(f.rumi_levels.C2).toMatchObject({ level: 1 });
    expect(f.moments_ready_at).toBeTruthy();
    expect(WhatsAppService.sendFlow).toHaveBeenCalledWith('923000000001', expect.objectContaining({ flowId: 'F-CHECK', flowToken: `coach-1:observe2-check:${id}` }));
    expect(sessions()[0].status).toBe('observe2_checking');
    expect(out).toMatchObject({ handled: true, action: 'check_sent' });
  });

  test('not sealed yet: moments stored, no check, the session waits', async () => {
    await linkedSession();
    await Moments.runForSession('sess-1', '923000000001', { llm: llmReturning(MODEL_OUT) });
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    expect(sessions()[0].status).toBe('observe2_ready');
  });

  test('no linked form: not ours, nothing written', async () => {
    mockFake.__tables.coaching_sessions = [{ id: 'sess-2', status: 'transcription_complete', transcript_text: TRANSCRIPT }];
    const llm = llmReturning(MODEL_OUT);
    expect(await Moments.runForSession('sess-2', '923000000001', { llm })).toEqual({ handled: false });
    expect(llm).not.toHaveBeenCalled();
    expect(sessions()[0].status).toBe('transcription_complete');
  });

  test('a transcript without timings is refused before the model runs, with its own status and words', async () => {
    await linkedSession({}, 'Teacher: why do plants need sunlight');
    const llm = llmReturning(MODEL_OUT);
    await Moments.runForSession('sess-1', '923000000001', { llm });
    expect(llm).not.toHaveBeenCalled();
    expect(sessions()[0].status).toBe('observe2_no_timestamps');
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith('923000000001', observe2Strings('en').moments_untimed);
  });

  test('a model failure is logged at error, has its own status, and the coach is told', async () => {
    await linkedSession();
    const { logToFile } = require('../../bot/shared/utils/logger');
    await Moments.runForSession('sess-1', '923000000001', { llm: jest.fn(() => Promise.reject(new Error('timeout'))) });
    expect(sessions()[0].status).toBe('observe2_failed');
    expect(logToFile).toHaveBeenCalledWith(expect.stringMatching(/moments failed/), expect.any(Object), 'error');
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith('923000000001', observe2Strings('en').moments_failed);
  });

  test('run twice (a retry): the model is not called again', async () => {
    await linkedSession();
    await Moments.runForSession('sess-1', '923000000001', { llm: llmReturning(MODEL_OUT) });
    const llm = llmReturning(MODEL_OUT);
    await Moments.runForSession('sess-1', '923000000001', { llm });
    expect(llm).not.toHaveBeenCalled();
  });

  test('a cancelled session is not reopened', async () => {
    await linkedSession({ sealed_at: '2026-09-30T05:39:00.000Z' });
    sessions()[0].status = 'cancelled';
    await Moments.runForSession('sess-1', '923000000001', { llm: llmReturning(MODEL_OUT) });
    expect(sessions()[0].status).toBe('cancelled');
  });
});

describe('the transcription step hands /observe2 recordings over', () => {
  test('a linked recording skips the photo and lesson-plan prompts and the classic analysis', async () => {
    const calls = { queued: 0, sent: 0 };
    const observe2 = { runForSession: jest.fn(() => Promise.resolve({ handled: true, action: 'check_sent' })) };
    const r = await Processor.observePostTranscription('sess-1', { observation_type: 'leader_observation', observer_user_id: 'coach-1' }, '923000000001', {
      env: { OBSERVE_CAPTURE_GATES_ENABLED: 'true' },
      observe2,
      queueAnalysis: async () => { calls.queued += 1; },
      sendButtons: async () => { calls.sent += 1; },
    });
    expect(observe2.runForSession).toHaveBeenCalledWith('sess-1', '923000000001');
    expect(r).toEqual({ action: 'observe2', result: { handled: true, action: 'check_sent' } });
    expect(calls).toEqual({ queued: 0, sent: 0 });
  });

  test('an unlinked recording goes on as before', async () => {
    const calls = { queued: 0 };
    const r = await Processor.observePostTranscription('sess-1', { observation_type: 'leader_observation' }, '923000000001', {
      env: {},
      observe2: { runForSession: async () => ({ handled: false }) },
      queueAnalysis: async () => { calls.queued += 1; },
    });
    expect(r.action).toBe('queued_analysis');
    expect(calls.queued).toBe(1);
  });
});
