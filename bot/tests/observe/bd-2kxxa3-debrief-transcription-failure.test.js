/**
 * bd-2kxxa.3 — a debrief whose TRANSCRIPTION throws must not vanish.
 *
 * The bug (prod, 1 Sep 2026 — provider balance exhausted for 17 hours):
 * processDebriefRecording was `try { … } finally { unlink }` with no catch
 * around transcribeWithDiarization. The throw reached handleJobFailure, which
 * for observe_debrief deliberately does nothing; SQS retried 3x inside ~45 min
 * (all inside the outage) then dead-lettered. The row stayed
 * debrief_status='pending' with audio_id set and transcript null, the coach
 * only ever heard "feedback in a few minutes", and nothing ever retried.
 * 11 debriefs across 6 coaches were stuck when this was written.
 *
 * Contract under test:
 *   1. the failure is RECORDED on the row (transcription_error, failed_at,
 *      attempts) and debrief_status stays 'pending' (closed vocabulary read by
 *      the /observe list filters)
 *   2. the coach hears ONE honest message, the FIRST time only
 *      (failure_notified_at flag in the same blob)
 *   3. the function RESOLVES — no rethrow; the worker sweep owns retries
 *   4. the temp file carries the REAL container extension (audio_mime), so
 *      an AAC document is not handed to Whisper as a mislabelled .ogg
 */

jest.mock('../../shared/services/observe/observe-coach-card', () => ({
  ...jest.requireActual('../../shared/services/observe/observe-coach-card'),
  renderCoachCard: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
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
jest.mock('../../shared/services/gpt5-mini.service', () => ({
  completeJson: jest.fn(),
}));
jest.mock('../../shared/services/coaching/transcription-processor.service', () => ({
  transcribeWithDiarization: jest.fn(),
}));

// Stateful row mock — the REAL PostgREST contract: an update()'s analysis_data
// is what the next select() reads back, so attempts accumulate across calls.
const mockDb = { row: null };
const mockSingle = jest.fn(() => Promise.resolve(
  mockDb.row ? { data: mockDb.row, error: null } : { data: null, error: { message: 'not found' } }));
const mockUpdateEq = jest.fn().mockResolvedValue({ data: null, error: null });
const mockUpdate = jest.fn((patch) => {
  if (mockDb.row) mockDb.row = { ...mockDb.row, ...patch };
  return { eq: mockUpdateEq };
});
function mockMakeChain() {
  const chain = {};
  for (const m of ['select', 'eq', 'neq', 'order']) chain[m] = jest.fn(() => chain);
  chain.single = mockSingle;
  chain.limit = jest.fn().mockResolvedValue({ data: [], error: null });
  chain.update = mockUpdate;
  return chain;
}
jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn(() => mockMakeChain()),
}));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const TranscriptionProcessorService = require('../../shared/services/coaching/transcription-processor.service');
const GPT5MiniService = require('../../shared/services/gpt5-mini.service');
const { observeStrings } = require('../../shared/services/observe/observe-strings');
const {
  startDebriefFromAudio,
  processDebriefRecording,
} = require('../../shared/services/observe/observe-debrief.service');

const SID = 'sess-stuck-1';
const FROM = '923001234567';
const FO = { id: 'fo-uuid-1', preferred_language: 'en' };
const GUIDE = { intro: 'x', steps: [], outro: 'x' };

const sessionRow = (debriefOver = {}, over = {}) => ({
  id: SID,
  observer_user_id: 'fo-uuid-1',
  observation_type: 'leader_observation',
  status: 'observer_review_complete',
  debrief_status: 'pending',
  users: { phone_number: FROM, preferred_language: 'en' },
  analysis_data: {
    framework: 'fico',
    observer_debrief: {
      audio_id: 'wamid.AUDIO-1', guide_snapshot: GUIDE,
      recorded_at: '2026-09-01T14:33:00Z', transcript: null, feedback: null,
      ...debriefOver,
    },
  },
  ...over,
});

const debrief = () => mockDb.row.analysis_data.observer_debrief;

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.row = sessionRow();
  TranscriptionProcessorService.transcribeWithDiarization.mockRejectedValue(
    new Error('Soniox v3 failed: 402 insufficient balance'));
});

describe('T1 · transcription failure is caught, recorded, told once, never rethrown', () => {
  test('first failure: resolves (no throw), records error/failed_at/attempts=1, status stays pending, ONE honest message', async () => {
    await expect(processDebriefRecording(SID, { from: FROM, audioId: 'wamid.AUDIO-1' })).resolves.toBeUndefined();

    expect(debrief().transcription_error).toMatch(/insufficient balance/);
    expect(debrief().attempts).toBe(1);
    expect(typeof debrief().failed_at).toBe('string');
    expect(Number.isNaN(Date.parse(debrief().failed_at))).toBe(false);
    expect(debrief().failure_notified_at).toBeTruthy();
    // closed vocabulary — the /observe pending list must still find this row
    expect(mockDb.row.debrief_status).toBe('pending');
    // the recording stays retryable: audio id untouched, transcript still absent
    expect(debrief().audio_id).toBe('wamid.AUDIO-1');
    expect(debrief().transcript).toBeFalsy();
    // no LLM pass on a failed transcription
    expect(GPT5MiniService.completeJson).not.toHaveBeenCalled();

    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    const [to, text] = WhatsAppService.sendMessage.mock.calls[0];
    expect(to).toBe(FROM);
    expect(text).toBe(observeStrings('en').debrief_processing_failed);
    // the copy is honest about the state and tells her NOT to re-record
    expect(text).toMatch(/retry|retrying/i);
    expect(text).toMatch(/re-record/i);
    expect(text).toMatch(/\/observe/);
  });

  test('second failure on the SAME recording: attempts=2 and NO second message (notify-once)', async () => {
    await processDebriefRecording(SID, { from: FROM, audioId: 'wamid.AUDIO-1' });
    expect(debrief().attempts).toBe(1);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);

    // the sweep re-queues the same session → second worker run, provider still down
    await processDebriefRecording(SID, { from: FROM, audioId: 'wamid.AUDIO-1' });
    expect(debrief().attempts).toBe(2);
    expect(mockDb.row.debrief_status).toBe('pending');
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);   // still just the one
    expect(TranscriptionProcessorService.transcribeWithDiarization).toHaveBeenCalledTimes(2);
  });

  test('media download failure is the same class — recorded, not rethrown', async () => {
    WhatsAppService.downloadMedia.mockRejectedValueOnce(new Error('Request failed with status code 404'));
    await expect(processDebriefRecording(SID, { from: FROM, audioId: 'wamid.AUDIO-1' })).resolves.toBeUndefined();
    expect(debrief().transcription_error).toMatch(/404/);
    expect(debrief().attempts).toBe(1);
    expect(TranscriptionProcessorService.transcribeWithDiarization).not.toHaveBeenCalled();
  });

  test('the honest message exists in every observe language (en / ur / sw), distinct from the old dead-end copy', () => {
    for (const lang of ['en', 'ur', 'sw']) {
      const S = observeStrings(lang);
      expect(typeof S.debrief_processing_failed).toBe('string');
      expect(S.debrief_processing_failed.length).toBeGreaterThan(20);
      expect(S.debrief_processing_failed).not.toBe(S.debrief_feedback_failed);
    }
    // ur is its OWN translation, not the en fallback
    expect(observeStrings('ur').debrief_processing_failed).not.toBe(observeStrings('en').debrief_processing_failed);
  });
});

describe('T4a · the temp download keeps the recording\'s REAL container extension', () => {
  const pathHandedToTranscription = () =>
    TranscriptionProcessorService.transcribeWithDiarization.mock.calls[0][0];

  test.each([
    ['audio/aac', '.aac'],
    ['audio/mp4', '.m4a'],
    ['audio/x-m4a', '.m4a'],
    ['audio/mpeg', '.mp3'],
    ['audio/ogg; codecs=opus', '.ogg'],
    ['audio/wav', '.wav'],
  ])('audio_mime %s → temp path ends %s', async (mime, ext) => {
    mockDb.row = sessionRow({ audio_mime: mime });
    await processDebriefRecording(SID, { from: FROM, audioId: 'wamid.AUDIO-1' });
    expect(pathHandedToTranscription()).toMatch(new RegExp(`observe_debrief_${SID}_\\d+\\${ext}$`));
  });

  test('no audio_mime on the row (legacy rows) → .ogg, exactly as before', async () => {
    mockDb.row = sessionRow();
    await processDebriefRecording(SID, { from: FROM, audioId: 'wamid.AUDIO-1' });
    expect(pathHandedToTranscription()).toMatch(/\.ogg$/);
  });

  test('startDebriefFromAudio stores audio_mime and resets the failure counters for a FRESH recording', async () => {
    mockDb.row = sessionRow({ attempts: 4, transcription_error: 'old', failure_notified_at: '2026-09-01T15:00:00Z' });
    await startDebriefFromAudio(FO, FROM, 'wamid.AUDIO-2',
      { state: 'awaiting_debrief_audio', sessionId: SID, guide_snapshot: GUIDE },
      { mimeType: 'audio/aac' });
    expect(debrief().audio_id).toBe('wamid.AUDIO-2');
    expect(debrief().audio_mime).toBe('audio/aac');
    // a new recording is a new debrief — its failures start from zero and it
    // may be told once again if it, too, fails
    expect(debrief().attempts).toBe(0);
    expect(debrief().transcription_error).toBeNull();
    expect(debrief().failure_notified_at).toBeNull();
  });

  test('startDebriefFromAudio without a mime (voice-note path) stores null, never undefined-crashes', async () => {
    mockDb.row = sessionRow();
    await startDebriefFromAudio(FO, FROM, 'wamid.AUDIO-3',
      { state: 'awaiting_debrief_audio', sessionId: SID, guide_snapshot: GUIDE });
    expect(debrief().audio_id).toBe('wamid.AUDIO-3');
    expect(debrief().audio_mime).toBeNull();
  });
});
