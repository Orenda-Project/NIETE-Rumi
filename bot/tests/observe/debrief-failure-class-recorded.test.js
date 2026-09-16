/**
 * The recorder must write WHICH KIND of failure this was, and say the honest
 * thing about it.
 *
 * `transcription_error` has always been persisted, and nothing has ever read it.
 * So a permanently dead WhatsApp media id was recorded identically to a
 * provider outage and retried identically too: on production, 15 Sep, all 8
 * stuck debriefs had burned the full 6 attempts on "Request failed with status
 * code 400" while their coaches held a promise that the recording would be
 * recovered automatically. It could not be. One shared fallback message across
 * two different states misdirects everyone who reads a field report about it.
 *
 * This suite drives the real processDebriefRecording with the download boundary
 * mocked, and asserts the class on the row plus the copy that reaches the coach.
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
jest.mock('../../shared/services/gpt5-mini.service', () => ({ completeJson: jest.fn() }));
jest.mock('../../shared/services/coaching/transcription-processor.service', () => ({
  transcribeWithDiarization: jest.fn(),
}));

// The coach's language is clamped to the market's offer, and the default
// observe pack is MEWAKA (sw/en) — this deployment is fico (ur/en).
process.env.OBSERVE_FRAMEWORK = 'fico';

// The coach's own users row. Her language comes from HERE now, not from the
// session's `users` join, which rides user_id (the observed teacher).
const mockCoach = { row: { id: 'fo-uuid-1', preferred_language: 'en' } };

const mockDb = { row: null };
const mockSingle = jest.fn(() => Promise.resolve(
  mockDb.row ? { data: mockDb.row, error: null } : { data: null, error: { message: 'not found' } }));
const mockUpdateEq = jest.fn().mockResolvedValue({ data: null, error: null });
const mockUpdate = jest.fn((patch) => {
  if (mockDb.row) mockDb.row = { ...mockDb.row, ...patch };
  return { eq: mockUpdateEq };
});
function mockMakeChain(table) {
  const chain = {};
  for (const m of ['select', 'eq', 'neq', 'order']) chain[m] = jest.fn(() => chain);
  chain.single = mockSingle;
  chain.maybeSingle = () => Promise.resolve(table === 'users'
    ? { data: mockCoach.row, error: null }
    : { data: mockDb.row, error: null });
  chain.limit = jest.fn().mockResolvedValue({ data: [], error: null });
  chain.update = mockUpdate;
  return chain;
}
jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn((table) => mockMakeChain(table)),
}));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const TranscriptionProcessorService = require('../../shared/services/coaching/transcription-processor.service');
const { observeStrings } = require('../../shared/services/observe/observe-strings');
const {
  processDebriefRecording,
  startDebriefFromAudio,
} = require('../../shared/services/observe/observe-debrief.service');

const SID = 'sess-media-gone-1';
const FROM = '923001234567';
const GUIDE = { intro: 'x', steps: [], outro: 'x' };

beforeEach(() => { mockCoach.row = { id: 'fo-uuid-1', preferred_language: 'en' }; });

const sessionRow = (debriefOver = {}, userOver = {}) => ({
  id: SID,
  observer_user_id: 'fo-uuid-1',
  observation_type: 'leader_observation',
  status: 'observer_review_complete',
  debrief_status: 'pending',
  users: { phone_number: FROM, preferred_language: 'en', ...userOver },
  analysis_data: {
    framework: 'fico',
    observer_debrief: {
      audio_id: 'wamid.AUDIO-1', guide_snapshot: GUIDE,
      recorded_at: '2026-09-01T14:33:00Z', transcript: null, feedback: null,
      ...debriefOver,
    },
  },
});

const debrief = () => mockDb.row.analysis_data.observer_debrief;

const httpError = (status, url) => Object.assign(new Error(`Request failed with status code ${status}`), {
  response: { status, config: { url } },
  config: { url },
  isAxiosError: true,
});
const MEDIA_URL = 'https://graph.facebook.com/v23.0/1234567890';

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.row = sessionRow();
  TranscriptionProcessorService.transcribeWithDiarization.mockResolvedValue({
    transcript: 'x', language: 'en',
  });
});

describe('the failure class lands on the row', () => {
  test('a 400 from the Meta media endpoint persists error_class media_gone', async () => {
    WhatsAppService.downloadMedia.mockRejectedValueOnce(httpError(400, MEDIA_URL));
    await expect(processDebriefRecording(SID, { from: FROM, audioId: 'wamid.AUDIO-1' }))
      .resolves.toBeUndefined();

    expect(debrief().error_class).toBe('media_gone');
    expect(debrief().transcription_error).toMatch(/400/);
    expect(debrief().attempts).toBe(1);
    // debrief_status is a closed vocabulary the /observe list reads — untouched.
    expect(mockDb.row.debrief_status).toBe('pending');
  });

  test('a 404 from the media endpoint is media_gone too', async () => {
    WhatsAppService.downloadMedia.mockRejectedValueOnce(httpError(404, MEDIA_URL));
    await processDebriefRecording(SID, { from: FROM, audioId: 'wamid.AUDIO-1' });
    expect(debrief().error_class).toBe('media_gone');
  });

  test('a provider outage persists error_class transient, so the sweep keeps chasing it', async () => {
    TranscriptionProcessorService.transcribeWithDiarization.mockRejectedValueOnce(
      new Error('Soniox v3 failed: 402 insufficient balance'));
    await processDebriefRecording(SID, { from: FROM, audioId: 'wamid.AUDIO-1' });
    expect(debrief().error_class).toBe('transient');
  });

  test('a 503 on the media download is transient — Meta was down, the recording is not gone', async () => {
    WhatsAppService.downloadMedia.mockRejectedValueOnce(httpError(503, MEDIA_URL));
    await processDebriefRecording(SID, { from: FROM, audioId: 'wamid.AUDIO-1' });
    expect(debrief().error_class).toBe('transient');
  });
});

describe('what the coach is told names the actual state', () => {
  test('media_gone gets the re-record copy, NOT the "I will keep retrying" copy', async () => {
    WhatsAppService.downloadMedia.mockRejectedValueOnce(httpError(400, MEDIA_URL));
    await processDebriefRecording(SID, { from: FROM, audioId: 'wamid.AUDIO-1' });

    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    const [to, text] = WhatsAppService.sendMessage.mock.calls[0];
    expect(to).toBe(FROM);
    expect(text).toBe(observeStrings('en').debrief_media_gone);
    expect(text).not.toBe(observeStrings('en').debrief_processing_failed);
    // It must not promise a retry that cannot happen.
    expect(text).not.toMatch(/keep retrying|automatically/i);
    // It must say the recording is no longer available and ask for a new one.
    expect(text).toMatch(/no longer available/i);
    expect(text).toMatch(/record/i);
  });

  test('transient still gets the keep-retrying copy', async () => {
    TranscriptionProcessorService.transcribeWithDiarization.mockRejectedValueOnce(
      new Error('Soniox v3 failed: 402 insufficient balance'));
    await processDebriefRecording(SID, { from: FROM, audioId: 'wamid.AUDIO-1' });
    const [, text] = WhatsAppService.sendMessage.mock.calls[0];
    expect(text).toBe(observeStrings('en').debrief_processing_failed);
  });

  test('notify-once still holds on the media_gone path', async () => {
    WhatsAppService.downloadMedia.mockRejectedValue(httpError(400, MEDIA_URL));
    await processDebriefRecording(SID, { from: FROM, audioId: 'wamid.AUDIO-1' });
    await processDebriefRecording(SID, { from: FROM, audioId: 'wamid.AUDIO-1' });
    expect(debrief().attempts).toBe(2);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
  });

  test('an Urdu coach reads the re-record copy in Urdu, not the English floor', async () => {
    mockDb.row = sessionRow();
    mockCoach.row = { ...mockCoach.row, preferred_language: 'ur' };
    WhatsAppService.downloadMedia.mockRejectedValueOnce(httpError(400, MEDIA_URL));
    await processDebriefRecording(SID, { from: FROM, audioId: 'wamid.AUDIO-1' });
    const [, text] = WhatsAppService.sendMessage.mock.calls[0];
    expect(text).toBe(observeStrings('ur').debrief_media_gone);
    expect(text).not.toBe(observeStrings('en').debrief_media_gone);
  });

  test('re-recording clears the class, so the coach who DOES re-record is chased again', async () => {
    // Without this the new key becomes a permanent tombstone: a coach told to
    // re-record does so, the fresh recording lands on a row still marked
    // media_gone, and the planner refuses it forever. Exactly the trap the
    // attempts counter was already reset to avoid.
    mockDb.row = sessionRow({
      error_class: 'media_gone', attempts: 3,
      transcription_error: 'Request failed with status code 400',
      failure_notified_at: '2026-09-01T15:00:00Z',
    });
    await startDebriefFromAudio(
      { id: 'fo-uuid-1', preferred_language: 'en' }, FROM, 'wamid.AUDIO-2',
      { state: 'awaiting_debrief_audio', sessionId: SID, guide_snapshot: GUIDE },
      { mimeType: 'audio/ogg' });

    expect(debrief().audio_id).toBe('wamid.AUDIO-2');
    expect(debrief().error_class).toBeNull();
    expect(debrief().attempts).toBe(0);
    expect(debrief().transcription_error).toBeNull();
  });

  test('the copy exists in every observe language and is its own string', () => {
    for (const lang of ['en', 'ur', 'sw']) {
      const S = observeStrings(lang);
      expect(typeof S.debrief_media_gone).toBe('string');
      expect(S.debrief_media_gone.length).toBeGreaterThan(20);
      expect(S.debrief_media_gone).not.toBe(S.debrief_processing_failed);
    }
    expect(observeStrings('ur').debrief_media_gone).not.toBe(observeStrings('en').debrief_media_gone);
    expect(observeStrings('sw').debrief_media_gone).not.toBe(observeStrings('en').debrief_media_gone);
  });
});
