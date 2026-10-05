/**
 * /observe2 — a coach's recording reaches the form that is waiting for it (Riffat, sandbox, 4 Oct 2026).
 *
 * Her second visit: the form was sealed, the first recording she sent was refused as a duplicate, and
 * her next recording (an 11-minute .ogg) was answered by general chat with a 47-second voice note.
 * Two causes, both covered here:
 *   - the audio router only knew an observation was waiting from the Redis observe state, which every
 *     capture clears (and which lives 2 h); a short recording with nothing armed is "the coach talking";
 *   - a recording refused as a duplicate had already been linked to the form, so the form stopped
 *     waiting: no later recording could ever attach to it.
 * And from the same trace: the teacher picked at Start could not be bound, and /observe2 skipped the
 * "who did you observe?" question /observe asks after an unbound capture.
 *
 * The router, the capture and the link run for real; Supabase is the in-memory fake, and WhatsApp,
 * the Redis observe state, the job queue and the who-question are the boundaries.
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (t) => mockDb.from(t) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendInteractiveButtons: jest.fn(() => Promise.resolve(true)),
  getMediaInfo: jest.fn(() => Promise.resolve({})),
}));
jest.mock('../../bot/shared/services/observe/observe-state.service', () => ({
  getState: jest.fn(() => Promise.resolve(null)),
  setState: jest.fn(() => Promise.resolve(true)),
  clearState: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
  queueTranscription: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/observe-who.service', () => ({
  maybeAskObservedTeacher: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/observe-binding.service', () => ({
  parkAndAsk: jest.fn(() => Promise.resolve({ action: 'asked' })),
}));
jest.mock('../../bot/shared/services/observe/observe-schedule.service', () => ({
  markDone: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({
  startDebriefFromAudio: jest.fn(() => Promise.resolve(true)),
}));

process.env.OBSERVE_MEWAKA_FLOW_ID = process.env.OBSERVE_MEWAKA_FLOW_ID || 'F-FICO';

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const ObserveState = require('../../bot/shared/services/observe/observe-state.service');
const ObserveWho = require('../../bot/shared/services/observe/observe-who.service');
const ObserveBinding = require('../../bot/shared/services/observe/observe-binding.service');
const ObserveDebrief = require('../../bot/shared/services/observe/observe-debrief.service');
const { routeLeaderAudio } = require('../../bot/shared/services/observe/observe-audio-router');
const { observe2Strings } = require('../../bot/shared/services/observe/observe2/strings');

const COACH = { id: 'coach-1', role: 'coach', preferred_language: 'ur' };
const FROM = '923238001437';
const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

const form = (over = {}) => ({
  id: 'form-2', observer_user_id: COACH.id, teacher_user_id: null, coaching_session_id: null,
  visit_context: { school_ext_id: 'test:9001', teacher_ext_id: 'name:test-nadia-perveen' },
  sealed_at: minutesAgo(5), created_at: minutesAgo(12), answers: {}, photos: [], ...over,
});

const send = (over = {}) => routeLeaderAudio({
  user: COACH, from: FROM, audioId: 'audio-697s', sessionId: 'chat-1', durationSeconds: 697, ...over,
});

const sessions = () => mockDb.__tables.coaching_sessions || [];
const forms = () => mockDb.__tables.observation_field_forms;

beforeEach(() => {
  jest.clearAllMocks();
  ObserveState.getState.mockResolvedValue(null);
  mockDb = createFakeSupabase({ observation_field_forms: [form()], coaching_sessions: [] });
});

describe('a recording while an /observe2 form waits for it', () => {
  test('an 11-minute recording with nothing armed goes to the waiting form, not to chat', async () => {
    const handled = await send();
    expect(handled).toBe(true);
    expect(sessions()).toHaveLength(1);
    expect(sessions()[0]).toMatchObject({ observer_user_id: COACH.id, observation_type: 'leader_observation', audio_id: 'audio-697s' });
    expect(forms()[0].coaching_session_id).toBe(sessions()[0].id);
    const ack = WhatsAppService.sendInteractiveButtons.mock.calls[0][1].body;
    expect(ack).toBe(observe2Strings('ur').recording_received(true));
  });

  test('a lesson-length recording goes to the waiting form instead of the "whose recording?" list', async () => {
    const handled = await send({ durationSeconds: 2449 });
    expect(handled).toBe(true);
    expect(ObserveBinding.parkAndAsk).not.toHaveBeenCalled();
    expect(forms()[0].coaching_session_id).toBe(sessions()[0].id);
  });

  test('an armed debrief still wins: the debrief the coach chose is the more specific intent', async () => {
    ObserveState.getState.mockResolvedValue({ state: 'awaiting_debrief_audio', sessionId: 'earlier' });
    await send();
    expect(ObserveDebrief.startDebriefFromAudio).toHaveBeenCalled();
    expect(sessions()).toHaveLength(0);
  });

  // Review, 4 Oct: below a lesson's length, a voice note is the coach talking to Rumi, form or no form.
  test('a short voice note to Rumi while a form waits stays chat, and the form keeps waiting', async () => {
    expect(await send({ durationSeconds: 30 })).toBe(false);
    expect(sessions()).toHaveLength(0);
    expect(forms()[0].coaching_session_id).toBe(null);
  });

  test('a three-minute recording reaches the waiting form', async () => {
    expect(await send({ durationSeconds: 203 })).toBe(true);
    expect(forms()[0].coaching_session_id).toBe(sessions()[0].id);
  });

  test('the waiting-form lookup reads only the columns it needs (it runs on every unarmed leader audio)', async () => {
    await send();
    const lookup = mockDb.__calls.find((c) => c.table === 'observation_field_forms' && c.action === 'select');
    expect(lookup.columns).not.toBe('*');
    expect(lookup.columns).not.toMatch(/rumi_moments|answers|evidence_review/);
  });

  test('with no form waiting, a short recording is still the coach talking to Rumi', async () => {
    mockDb = createFakeSupabase({ observation_field_forms: [form({ coaching_session_id: 'already' })], coaching_sessions: [] });
    expect(await send()).toBe(false);
    expect(sessions()).toHaveLength(0);
  });

  test('a form from an older visit (outside the link window) does not catch the recording', async () => {
    mockDb = createFakeSupabase({ observation_field_forms: [form({ created_at: minutesAgo(7 * 60) })], coaching_sessions: [] });
    expect(await send()).toBe(false);
  });

  test('when the form lookup fails, today\'s routing applies (a lesson-length recording is parked and asked about)', async () => {
    mockDb.__failNext({ message: 'connection reset' });
    expect(await send({ durationSeconds: 2449 })).toBe(true);
    expect(ObserveBinding.parkAndAsk).toHaveBeenCalled();
  });
});

describe('who the recording belongs to', () => {
  test('the form\'s teacher owns the observation when the observe state has expired', async () => {
    mockDb = createFakeSupabase({ observation_field_forms: [form({ teacher_user_id: 'teacher-9' })], coaching_sessions: [] });
    await send();
    expect(sessions()[0].user_id).toBe('teacher-9');
    expect(ObserveWho.maybeAskObservedTeacher).not.toHaveBeenCalled();
  });

  test('with no teacher bound, the coach is asked who was observed, as /observe asks', async () => {
    await send();
    expect(sessions()[0].user_id).toBe(COACH.id);
    expect(ObserveWho.maybeAskObservedTeacher).toHaveBeenCalledWith(COACH, FROM, sessions()[0].id);
  });
});

describe('a classic /observe recording is not pulled into an /observe2 form', () => {
  test('a recording started from /observe\'s Start stays a classic observation', async () => {
    ObserveState.getState.mockResolvedValue({
      state: 'awaiting_audio', origin: 'observe',
      boundTeacher: { user_id: 'teacher-7', teacher_ext_id: '923001112223', school_ext_id: 'niete:1', teacher_name: 'Sana' },
    });
    await send({ durationSeconds: 2449 });
    expect(sessions()).toHaveLength(1);
    expect(forms()[0].coaching_session_id).toBe(null);
    const ack = WhatsAppService.sendInteractiveButtons.mock.calls[0][1].body;
    expect(ack).not.toBe(observe2Strings('ur').recording_received(true));
  });

  test('the /observe2 Start\'s own marker links its form, even with a bound teacher', async () => {
    mockDb = createFakeSupabase({
      observation_field_forms: [form({ teacher_user_id: 'teacher-7', visit_context: { school_ext_id: 'niete:1', teacher_ext_id: '923001112223' } })],
      coaching_sessions: [],
    });
    ObserveState.getState.mockResolvedValue({
      state: 'awaiting_audio', observe2FormId: 'form-2',
      boundTeacher: { user_id: 'teacher-7', teacher_ext_id: '923001112223', school_ext_id: 'niete:1', teacher_name: 'Sana' },
    });
    await send({ durationSeconds: 2449 });
    expect(forms()[0].coaching_session_id).toBe(sessions()[0].id);
    expect(sessions()[0].user_id).toBe('teacher-7');
  });

  test('a state armed before this change (no origin) links the newest waiting form, as before', async () => {
    ObserveState.getState.mockResolvedValue({ state: 'awaiting_audio', boundTeacher: null });
    await send({ durationSeconds: 2449 });
    expect(forms()[0].coaching_session_id).toBe(sessions()[0].id);
  });

  test('an /observe2 Start whose form id never reached the state still links the waiting form', async () => {
    ObserveState.getState.mockResolvedValue({ state: 'awaiting_audio', origin: 'observe2', boundTeacher: null });
    await send({ durationSeconds: 2449 });
    expect(forms()[0].coaching_session_id).toBe(sessions()[0].id);
  });

  test('a marked form for another teacher is still not linked: never a recording filed on the wrong teacher', async () => {
    ObserveState.getState.mockResolvedValue({
      state: 'awaiting_audio', observe2FormId: 'form-2',
      boundTeacher: { user_id: 'teacher-7', teacher_ext_id: '923001112223', school_ext_id: 'niete:1', teacher_name: 'Sana' },
    });
    await send({ durationSeconds: 2449 });
    expect(forms()[0].coaching_session_id).toBe(null);
  });
});

describe('a recording refused as a duplicate gives the form back', () => {
  const { releaseRefusedRecording } = require('../../bot/shared/services/observe/observe2/capture-link');

  test('the form linked to the refused session waits for a recording again', async () => {
    mockDb = createFakeSupabase({ observation_field_forms: [form({ coaching_session_id: 'refused-1' })] });
    const out = await releaseRefusedRecording('refused-1');
    expect(out).toEqual({ released: true, formId: 'form-2' });
    expect(forms()[0].coaching_session_id).toBe(null);
    // …so the next recording attaches to it.
    mockDb.__tables.coaching_sessions = [];
    expect(await send()).toBe(true);
    expect(forms()[0].coaching_session_id).toBe(mockDb.__tables.coaching_sessions[0].id);
  });

  test('a form past the link window is given back silently: it can no longer take a recording, so nothing says it waits', async () => {
    mockDb = createFakeSupabase({ observation_field_forms: [form({ coaching_session_id: 'refused-1', created_at: minutesAgo(7 * 60) })] });
    expect(await releaseRefusedRecording('refused-1')).toEqual({ released: false, formId: 'form-2' });
    expect(forms()[0].coaching_session_id).toBe(null);
  });

  test('a refused classic recording (no form) releases nothing', async () => {
    expect(await releaseRefusedRecording('no-such-session')).toEqual({ released: false, formId: null });
  });

  test('the refusal tells the coach the form is still waiting, in the coach\'s language', async () => {
    const { refuseDuplicateObservation } = require('../../bot/shared/services/coaching/audio-hash-cache');
    const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');
    const sent = [];
    await refuseDuplicateObservation(
      { coachingSessionId: 'refused-1', from: FROM, observerUserId: COACH.id, audioHash: 'h', prior: { id: 'p', status: 'observer_review_complete' } },
      {
        updateIfNotTerminal: async () => ({ applied: true }),
        sendMessage: async (to, body) => { sent.push(body); return true; },
        getLanguage: async () => 'ur',
        getStrings: observeStrings,
        afterApplied: async (lang) => observe2Strings(lang).duplicate_form_waiting,
      },
    );
    expect(sent).toEqual([`${observeStrings('ur').capture_duplicate_recording}\n\n${observe2Strings('ur').duplicate_form_waiting}`]);
  });
});
