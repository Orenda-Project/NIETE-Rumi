/**
 * bd-7vcy1p — every message of a debrief goes to the COACH, never the teacher.
 *
 * The leak (NIETE production, 3 Sep and 13 Oct 2026): the debrief retry sweep
 * queues `observe_debrief` with no `from` (sqs-worker.js, runDebriefRetrySweep),
 * and processDebriefRecording fell back to `session.users.phone_number`. That
 * join rides `user_id`, which on a BOUND observation is the observed teacher.
 * So the coach's private praise line, coach card and "send the report?" buttons
 * (4 teachers) and the "processing failed" notice (8 teachers) went to the
 * teacher. Rifat's HITL guardrail 03: the coach's feedback card is never sent
 * to the teacher. Same lookup, second defect: `foName` in the coach-feedback
 * prompt was the TEACHER's name, on every bound debrief.
 *
 * Contract under test:
 *   R1  sweep retry (no `from`) on a bound session: every send — sendMessage,
 *       sendImageFromBuffer, sendInteractiveButtons — is addressed to the coach
 *       (observer_user_id), on every path: success, transcription-failure
 *       notice, deliver-only, too short, duplicate, feedback failed.
 *   R2  the prompt's officer name is the coach's, not the teacher's.
 *   R3  coach unresolvable and no `from`: nothing is sent (no transcription
 *       either), an error is logged, the row stays pending. Silence, not the
 *       teacher — the rule bd-go4tl set for the stale-session sweep.
 *   R4  the live paths are unchanged: a bare session, and a payload `from`
 *       (set only by intakes that verified the coach) when the lookup fails.
 */

jest.mock('../../shared/services/observe/observe-coach-card', () => ({
  ...jest.requireActual('../../shared/services/observe/observe-coach-card'),
  renderCoachCard: jest.fn(),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  downloadMedia: jest.fn().mockResolvedValue(Buffer.from('fake-audio-bytes')),
}));
jest.mock('../../shared/services/observe/observe-state.service', () => ({
  setState: jest.fn().mockResolvedValue(true),
  getState: jest.fn().mockResolvedValue(null),
  clearState: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/coaching/coaching-job-queue.service', () => ({
  queueObserveDebrief: jest.fn().mockResolvedValue('msg-id-1'),
  queueJob: jest.fn().mockResolvedValue('msg-id-1'),
}));
jest.mock('../../shared/services/gpt5-mini.service', () => ({ completeJson: jest.fn() }));
jest.mock('../../shared/services/coaching/transcription-processor.service', () => ({
  transcribeWithDiarization: jest.fn(),
}));
jest.mock('../../shared/services/coaching/audio-hash-cache', () => ({
  computeAudioHash: jest.fn(() => 'hash-1'),
  findPriorAnalysedDebrief: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../shared/services/observe/observe-completion', () => ({
  maybeCompleteObservation: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../shared/utils/logger', () => ({
  logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), LOGS_DIR: '/tmp',
}));

process.env.OBSERVE_FRAMEWORK = 'fico';

const SID = 'sess-bound-1';
const TEACHER = { id: 'teacher-uuid', name: 'Teacher Tahira', phone_number: '923330000774', preferred_language: 'ur' };
const COACH = { id: 'coach-uuid', name: 'Coach Kamran', phone_number: '923330000128', preferred_language: 'en' };

// users rows by id; a test removes the coach to make her unresolvable.
const mockUsers = { rows: {} };
const mockDb = { row: null };

function mockMakeChain(table) {
  const filters = {};
  const chain = {};
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn((col, val) => { filters[col] = val; return chain; });
  for (const m of ['neq', 'order', 'in', 'is']) chain[m] = jest.fn(() => chain);
  const answer = () => {
    if (table === 'users') {
      const u = mockUsers.rows[filters.id];
      return { data: u || null, error: null };
    }
    return mockDb.row ? { data: mockDb.row, error: null } : { data: null, error: { message: 'not found' } };
  };
  chain.single = jest.fn(() => Promise.resolve(answer()));
  chain.maybeSingle = jest.fn(() => Promise.resolve(answer()));
  chain.limit = jest.fn().mockResolvedValue({ data: [], error: null });
  chain.update = jest.fn((patch) => {
    if (table === 'coaching_sessions' && mockDb.row) mockDb.row = { ...mockDb.row, ...patch };
    return { eq: jest.fn().mockResolvedValue({ data: null, error: null }) };
  });
  return chain;
}
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn((table) => mockMakeChain(table)) }));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const TranscriptionProcessorService = require('../../shared/services/coaching/transcription-processor.service');
const GPT5MiniService = require('../../shared/services/gpt5-mini.service');
const { renderCoachCard } = require('../../shared/services/observe/observe-coach-card');
const { findPriorAnalysedDebrief } = require('../../shared/services/coaching/audio-hash-cache');
const { logToFile } = require('../../shared/utils/logger');
const { RUBRIC_KEYS, REHEARSAL_KEY } = require('../../shared/services/observe/observe-coach-feedback');
const { processDebriefRecording } = require('../../shared/services/observe/observe-debrief.service');

const GUIDE = { intro: 'x', steps: [], outro: 'x' };
const LONG_TRANSCRIPT = 'Coach: How did the lesson go for you today? Teacher: I think the pair work went well. '.repeat(4);
// What the retry sweep queues: no `from`.
const SWEEP = { audioId: 'wamid.AUDIO-1', trigger: 'debrief_retry_sweep', attempt: 2, phase: 'retry-2' };

const goodFeedback = () => {
  const rubric = {};
  for (const k of RUBRIC_KEYS) rubric[k] = true;
  rubric[REHEARSAL_KEY] = true;
  rubric.disparaged_teacher = false;
  return {
    praise_line: 'You opened warmly and let the teacher think.',
    wins: [
      { behaviour: 'Opened with specific praise', evidence: 'you said "the pair work was excellent"' },
      { behaviour: 'Held the silence', evidence: 'you waited after asking how it went' },
    ],
    try: { move: 'Let the teacher name the next step', evidence: 'you offered the plan yourself', instead: 'ask and wait' },
    reflection_question: 'What will you do differently in your next debrief?',
    value: null,
    rubric,
    concern: null,
  };
};

// A BOUND observation: user_id is the teacher, and the users join rides it.
const boundRow = (debriefOver = {}, over = {}) => ({
  id: SID,
  user_id: TEACHER.id,
  observer_user_id: COACH.id,
  observation_type: 'leader_observation',
  status: 'observer_review_complete',
  debrief_status: 'pending',
  users: { name: TEACHER.name, phone_number: TEACHER.phone_number, preferred_language: 'ur' },
  analysis_data: {
    framework: 'fico',
    observer_debrief: {
      audio_id: 'wamid.AUDIO-1', guide_snapshot: GUIDE,
      recorded_at: '2026-09-03T10:00:00Z', transcript: null, feedback: null,
      ...debriefOver,
    },
  },
  ...over,
});

/** Every recipient of every WhatsApp send in this run. */
const recipients = () => [
  ...WhatsAppService.sendMessage.mock.calls,
  ...WhatsAppService.sendImageFromBuffer.mock.calls,
  ...WhatsAppService.sendInteractiveButtons.mock.calls,
].map((c) => c[0]);
const sendCount = () => recipients().length;

beforeEach(() => {
  jest.clearAllMocks();
  mockUsers.rows = { [TEACHER.id]: { ...TEACHER }, [COACH.id]: { ...COACH } };
  mockDb.row = boundRow();
  renderCoachCard.mockResolvedValue(Buffer.from('png-bytes'));
  findPriorAnalysedDebrief.mockResolvedValue(null);
  TranscriptionProcessorService.transcribeWithDiarization.mockResolvedValue({
    transcript: LONG_TRANSCRIPT, language: 'en', diarization: { confidence: 0.9 },
  });
  GPT5MiniService.completeJson.mockResolvedValue({ result: goodFeedback() });
});

describe('R1 · a sweep retry on a bound session messages the coach only', () => {
  test('success: praise, card image and send-report buttons all go to the coach', async () => {
    await processDebriefRecording(SID, SWEEP);

    expect(WhatsAppService.sendImageFromBuffer).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    expect(sendCount()).toBeGreaterThanOrEqual(2);
    expect(recipients()).not.toContain(TEACHER.phone_number);
    expect(new Set(recipients())).toEqual(new Set([COACH.phone_number]));
    expect(mockDb.row.debrief_status).toBe('done');
  });

  test('success with the text card (no image): still the coach', async () => {
    renderCoachCard.mockResolvedValue(null);
    await processDebriefRecording(SID, SWEEP);

    expect(WhatsAppService.sendMessage).toHaveBeenCalled();
    expect(new Set(recipients())).toEqual(new Set([COACH.phone_number]));
  });

  test('transcription failure: the "processing failed" notice goes to the coach', async () => {
    TranscriptionProcessorService.transcribeWithDiarization.mockRejectedValue(new Error('Soniox v3 failed: 503'));
    await processDebriefRecording(SID, SWEEP);

    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(recipients()).toEqual([COACH.phone_number]);
    expect(mockDb.row.debrief_status).toBe('pending');
  });

  test('deliver-only (feedback already stored): the coach', async () => {
    mockDb.row = boundRow({ transcript: LONG_TRANSCRIPT, feedback: goodFeedback() });
    await processDebriefRecording(SID, SWEEP);

    expect(WhatsAppService.sendImageFromBuffer).toHaveBeenCalledTimes(1);
    expect(new Set(recipients())).toEqual(new Set([COACH.phone_number]));
  });

  test('transcript too short: the "record a longer stretch" notice goes to the coach', async () => {
    TranscriptionProcessorService.transcribeWithDiarization.mockResolvedValue({ transcript: 'too short', language: 'en' });
    await processDebriefRecording(SID, SWEEP);

    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(recipients()).toEqual([COACH.phone_number]);
  });

  test('duplicate recording: the refusal goes to the coach', async () => {
    findPriorAnalysedDebrief.mockResolvedValue({ id: 'sess-prior' });
    await processDebriefRecording(SID, SWEEP);

    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(recipients()).toEqual([COACH.phone_number]);
  });

  test('feedback LLM failure: the "could not analyse" notice goes to the coach', async () => {
    GPT5MiniService.completeJson.mockRejectedValue(new Error('LLM down'));
    await processDebriefRecording(SID, SWEEP);

    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(recipients()).toEqual([COACH.phone_number]);
  });
});

describe('R2 · the prompt names the coach as the officer', () => {
  test('foName is the coach, never the bound teacher', async () => {
    await processDebriefRecording(SID, SWEEP);

    const prompt = GPT5MiniService.completeJson.mock.calls[0][0];
    expect(prompt).toContain(`An education officer (${COACH.name})`);
    expect(prompt).not.toContain(TEACHER.name);
  });

  test('on the live path too (payload carries the coach\'s `from`)', async () => {
    await processDebriefRecording(SID, { from: COACH.phone_number, audioId: 'wamid.AUDIO-1' });

    const prompt = GPT5MiniService.completeJson.mock.calls[0][0];
    expect(prompt).toContain(`An education officer (${COACH.name})`);
    expect(prompt).not.toContain(TEACHER.name);
  });
});

describe('R3 · coach unresolvable and no `from`: silence, never the teacher', () => {
  test('nothing is sent, nothing is transcribed, an error is logged, the row stays pending', async () => {
    delete mockUsers.rows[COACH.id];
    await processDebriefRecording(SID, SWEEP);

    expect(sendCount()).toBe(0);
    expect(TranscriptionProcessorService.transcribeWithDiarization).not.toHaveBeenCalled();
    expect(GPT5MiniService.completeJson).not.toHaveBeenCalled();
    expect(mockDb.row.debrief_status).toBe('pending');
    expect(mockDb.row.analysis_data.observer_debrief.audio_id).toBe('wamid.AUDIO-1');
    const errors = logToFile.mock.calls.filter((c) => c[2] === 'error');
    expect(errors.some((c) => /recipient|coach/i.test(String(c[0])))).toBe(true);
  });

  test('the coach row has no phone: same silence', async () => {
    mockUsers.rows[COACH.id] = { ...COACH, phone_number: null };
    await processDebriefRecording(SID, SWEEP);

    expect(sendCount()).toBe(0);
    expect(mockDb.row.debrief_status).toBe('pending');
  });

  test('deliver-only with no resolvable coach: nothing sent, not marked done', async () => {
    delete mockUsers.rows[COACH.id];
    mockDb.row = boundRow({ transcript: LONG_TRANSCRIPT, feedback: goodFeedback() });
    await processDebriefRecording(SID, SWEEP);

    expect(sendCount()).toBe(0);
    expect(mockDb.row.debrief_status).toBe('pending');
  });
});

describe('R4 · the live paths keep working', () => {
  test('a bare session (coach is also user_id): the coach', async () => {
    mockDb.row = boundRow({}, {
      user_id: COACH.id,
      users: { name: COACH.name, phone_number: COACH.phone_number, preferred_language: 'en' },
    });
    await processDebriefRecording(SID, SWEEP);

    expect(new Set(recipients())).toEqual(new Set([COACH.phone_number]));
  });

  test('coach lookup fails but the intake passed her `from`: her `from`, never the teacher', async () => {
    delete mockUsers.rows[COACH.id];
    await processDebriefRecording(SID, { from: COACH.phone_number, audioId: 'wamid.AUDIO-1' });

    expect(sendCount()).toBeGreaterThan(0);
    expect(recipients()).not.toContain(TEACHER.phone_number);
    expect(new Set(recipients())).toEqual(new Set([COACH.phone_number]));
  });
});
