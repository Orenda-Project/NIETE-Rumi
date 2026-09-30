/**
 * bd-zq0ea — HITL row 185, part 2: a coach's DEBRIEF recording is analysed ONCE.
 *
 * Part 1 (bd-erpvf) stopped a classroom recording being re-analysed. The debrief
 * recording had no such check: "Debrief now" already refuses a debrief that is
 * done FOR THE SAME observation, but the same file sent against ANOTHER pending
 * observation was transcribed and coached again from scratch.
 *
 * Measured on NIETE production, 30 Sep 2026 (identical transcripts as the proxy —
 * debriefs carried no audio hash): 13 (coach, recording) groups across 30
 * observations, 11 of them coached two or more times. Lower bound: the read was
 * capped at 1,000 rows.
 *
 * Requirement: "This debrief recording has already been analyzed." — no second
 * transcription, no second feedback, at any time.
 *
 * Runs the REAL processDebriefRecording; only Supabase, WhatsApp, Redis state,
 * transcription and the LLM are mocked.
 */

const crypto = require('crypto');

const EN = 'This debrief recording has already been analyzed.';
const UR = 'اس ڈی بریف ریکارڈنگ کا تجزیہ پہلے ہی کیا جا چکا ہے۔';
const BYTES = Buffer.from('the same debrief conversation, byte for byte');
const HASH = crypto.createHash('sha256').update(BYTES).digest('hex');

jest.mock('../../bot/shared/services/observe/observe-coach-card', () => ({
  ...jest.requireActual('../../bot/shared/services/observe/observe-coach-card'),
  renderCoachCard: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  downloadMedia: jest.fn(),
}));
jest.mock('../../bot/shared/services/observe/observe-state.service', () => ({
  setState: jest.fn().mockResolvedValue(true),
  getState: jest.fn().mockResolvedValue(null),
  clearState: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
  queueObserveDebrief: jest.fn().mockResolvedValue('msg-id-1'),
  queueJob: jest.fn().mockResolvedValue('msg-id-1'),
}));
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({
  completeJson: jest.fn().mockRejectedValue(new Error('LLM is out of scope for this test')),
}));
jest.mock('../../bot/shared/services/coaching/transcription-processor.service', () => ({
  transcribeWithDiarization: jest.fn(),
}));

process.env.OBSERVE_FRAMEWORK = 'fico';

const mockCoach = { row: { id: 'coach-uuid', preferred_language: 'en' } };
const mockDb = { row: null, prior: null, lookupThrows: false, lookups: [] };
const mockUpdate = jest.fn((patch) => {
  if (mockDb.row) mockDb.row = { ...mockDb.row, ...patch };
  return { eq: jest.fn().mockResolvedValue({ data: null, error: null }) };
});

function mockMakeChain(table) {
  const filters = [];
  const chain = {};
  for (const m of ['select', 'order']) chain[m] = jest.fn(() => chain);
  for (const m of ['eq', 'neq', 'not', 'is']) {
    chain[m] = jest.fn((...a) => { filters.push([m, ...a]); return chain; });
  }
  chain.single = () => Promise.resolve(mockDb.row
    ? { data: mockDb.row, error: null } : { data: null, error: { message: 'not found' } });
  chain.maybeSingle = () => {
    if (table === 'users') return Promise.resolve({ data: mockCoach.row, error: null });
    if (filters.some(([, col]) => /audio_hash/.test(String(col)))) {
      mockDb.lookups.push(filters);
      if (mockDb.lookupThrows) return Promise.reject(new Error('JSON path filter rejected'));
      return Promise.resolve({ data: mockDb.prior, error: null });
    }
    return Promise.resolve({ data: mockDb.row, error: null });
  };
  chain.limit = jest.fn(() => chain);
  chain.then = (resolve) => Promise.resolve({ data: [], error: null }).then(resolve);
  chain.update = mockUpdate;
  return chain;
}
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((table) => mockMakeChain(table)),
}));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const ObserveState = require('../../bot/shared/services/observe/observe-state.service');
const TranscriptionProcessorService = require('../../bot/shared/services/coaching/transcription-processor.service');
const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');
const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');
const {
  processDebriefRecording,
  startDebriefFromAudio,
} = require('../../bot/shared/services/observe/observe-debrief.service');

const SID = 'current-obs';
const FROM = '923339998887';
const GUIDE = { intro: 'x', steps: [], outro: 'x' };
const LONG_TRANSCRIPT = 'Coach: tell me how the lesson went. Teacher: the group work went well. '.repeat(20);

const sessionRow = () => ({
  id: SID,
  user_id: 'teacher-uuid',
  observer_user_id: 'coach-uuid',
  observation_type: 'leader_observation',
  status: 'observer_review_complete',
  debrief_status: 'pending',
  users: { phone_number: '923001112223', preferred_language: 'en' },   // the TEACHER
  analysis_data: {
    framework: 'fico',
    observer_debrief: {
      audio_id: 'wamid.DEBRIEF-2', guide_snapshot: GUIDE,
      recorded_at: '2026-09-30T09:00:00Z', transcript: null, feedback: null,
    },
  },
});
const debrief = () => mockDb.row.analysis_data.observer_debrief;
const run = () => processDebriefRecording(SID, { from: FROM, audioId: 'wamid.DEBRIEF-2' });

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.row = sessionRow();
  mockDb.prior = { id: 'prior-obs', created_at: '2026-09-20T10:00:00Z' };
  mockDb.lookupThrows = false;
  mockDb.lookups = [];
  mockCoach.row = { id: 'coach-uuid', preferred_language: 'en' };
  WhatsAppService.downloadMedia.mockResolvedValue(BYTES);
  TranscriptionProcessorService.transcribeWithDiarization.mockResolvedValue({
    transcript: LONG_TRANSCRIPT, language: 'en', diarization: { confidence: 0.9 },
  });
});

describe('the coach-facing string, in both offered languages', () => {
  test('English is the requirement wording, verbatim', () => {
    expect(observeStrings('en').debrief_duplicate_recording).toBe(EN);
  });
  test('Urdu is a real translation, not the English fallback', () => {
    expect(observeStrings('ur').debrief_duplicate_recording).toBe(UR);
  });
});

describe('a debrief recording this coach already had analysed', () => {
  test('is neither transcribed nor coached again', async () => {
    await expect(run()).resolves.toBeUndefined();
    expect(TranscriptionProcessorService.transcribeWithDiarization).not.toHaveBeenCalled();
    expect(GPT5MiniService.completeJson).not.toHaveBeenCalled();
  });

  test('the coach is told, in the COACH\'s language', async () => {
    mockCoach.row = { id: 'coach-uuid', preferred_language: 'ur' };
    await run();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(FROM, UR);
  });

  test('English coach gets the English wording', async () => {
    await run();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(FROM, EN);
  });

  test('the observation stays pending, is marked as a duplicate, and loses its audio id', async () => {
    await run();
    expect(mockDb.row.debrief_status).toBe('pending');
    expect(debrief().duplicate_of_session_id).toBe('prior-obs');
    // The retry sweep re-queues rows with an audio_id and no transcript — a kept
    // id would re-refuse (and re-message the coach) every 15 minutes.
    expect(debrief().audio_id).toBeNull();
    expect(debrief().transcript).toBeFalsy();
  });

  test('the debrief is re-armed so the coach\'s next recording is taken', async () => {
    await run();
    expect(ObserveState.setState).toHaveBeenCalledWith(
      'coach-uuid', 'awaiting_debrief_audio', expect.objectContaining({ sessionId: SID }));
  });

  test('matches on THIS coach, these bytes, an analysed debrief, another observation', async () => {
    await run();
    expect(mockDb.lookups).toHaveLength(1);
    const f = mockDb.lookups[0];
    const has = (m, col, v) => f.some(([mm, c, a, b]) => mm === m && c === col && (v === undefined || a === v || b === v));
    expect(has('eq', 'observer_user_id', 'coach-uuid')).toBe(true);
    expect(has('eq', 'observation_type', 'leader_observation')).toBe(true);
    expect(f.some(([m, c, v]) => m === 'eq' && /observer_debrief->>audio_hash$/.test(c) && v === HASH)).toBe(true);
    expect(f.some(([m, c, op, v]) => m === 'not' && /observer_debrief->feedback$/.test(c) && op === 'is' && v === null)).toBe(true);
    expect(has('neq', 'id', SID)).toBe(true);
  });
});

describe('a debrief nobody has analysed before', () => {
  test('is transcribed as before, and its hash is stamped with the transcript', async () => {
    mockDb.prior = null;
    await run();
    expect(TranscriptionProcessorService.transcribeWithDiarization).toHaveBeenCalled();
    expect(debrief().transcript).toBe(LONG_TRANSCRIPT);
    expect(debrief().audio_hash).toBe(HASH);
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalledWith(FROM, EN);
  });

  test('a failing lookup fails OPEN — the debrief is still analysed', async () => {
    mockDb.lookupThrows = true;
    await run();
    expect(TranscriptionProcessorService.transcribeWithDiarization).toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalledWith(FROM, EN);
  });
});

describe('a NEW recording on an observation', () => {
  test('clears the previous recording\'s hash along with its transcript', async () => {
    mockDb.row.analysis_data.observer_debrief.audio_hash = HASH;
    await startDebriefFromAudio(
      { id: 'coach-uuid', preferred_language: 'en' }, FROM, 'wamid.NEW',
      { state: 'awaiting_debrief_audio', sessionId: SID, guide_snapshot: GUIDE });
    expect(debrief().audio_id).toBe('wamid.NEW');
    expect(debrief().audio_hash).toBeNull();
  });
});
