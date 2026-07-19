/**
 * FEAT-053 bd-28 — debrief recording capture (web side) + processing (worker
 * side). D26: zero new columns — everything merge-writes into
 * analysis_data.observer_debrief; the job type is observe_debrief and must
 * NEVER route through queueTranscription (its processor overwrites the
 * LESSON transcript on the same row).
 */

// bd-44: unit tests exercise the TEXT fallback path (renderCoachCard → null);
// the card render itself is covered in observe-coach-card.test.js.
jest.mock('../../shared/services/observe/observe-coach-card', () => ({
  ...jest.requireActual('../../shared/services/observe/observe-coach-card'),
  renderCoachCard: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  downloadMedia: jest.fn().mockResolvedValue(Buffer.from('fake-ogg-bytes')),
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

// Stateful row mock — models the REAL PostgREST contract: an update()'s
// analysis_data is what the next select() reads back (read-merge-write
// chains depend on this; a static fixture would hide lost-merge bugs).
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
const ObserveState = require('../../shared/services/observe/observe-state.service');
const CoachingJobQueueService = require('../../shared/services/coaching/coaching-job-queue.service');
const GPT5MiniService = require('../../shared/services/gpt5-mini.service');
const TranscriptionProcessorService = require('../../shared/services/coaching/transcription-processor.service');
const {
  startDebriefFromAudio,
  processDebriefRecording,
} = require('../../shared/services/observe/observe-debrief.service');

const SID = 'sess-42';
const FO = { id: 'fo-uuid-1', preferred_language: 'sw' };
const FROM = '255785150099';
const GUIDE = { intro: 'x', steps: [], outro: 'x' };

const LONG_TRANSCRIPT =
  'FO: Asante kwa kunikaribisha darasani leo, lengo langu ni tusaidiane. Nilipenda ulivyotumia vijiti kufundisha. ' +
  'Mwalimu: Asante sana. FO: Wewe mwenyewe unaonaje somo lilikwendaje leo? Mwalimu: Nadhani wanafunzi walielewa vizuri ' +
  'lakini wachache tu walijibu maswali yangu darasani. FO: Vipi kesho ukiuliza Umejuaje baada ya kila jibu la mwanafunzi? ' +
  'Mwalimu: Nitajaribu kesho asubuhi wakati wa somo la hesabu.';

const goodFeedback = () => ({
  praise_line: 'Ulifungua kwa shukrani ya kweli. 💛',
  wins: [
    { behaviour: 'Sifa yenye ushahidi', evidence: 'Nilipenda ulivyotumia vijiti' },
    { behaviour: 'Ahadi ya mwalimu mwenyewe', evidence: 'Nitajaribu kesho asubuhi' },
  ],
  try: { move: 'Shikilia ukimya', evidence: 'Ulijibu swali lako mwenyewe.', instead: 'Hesabu sekunde tatu.' },
  rubric: {
    opened_with_specific_praise: true, anchored_in_real_moment: true,
    asked_and_waited: false, one_improvement_only: true, moves_not_teacher: true,
    elicited_if_then: true, righting_reflex_held: false, disparaged_teacher: false,
  },
});

const sessionRow = (over = {}) => ({
  id: SID,
  observer_user_id: 'fo-uuid-1',
  observation_type: 'leader_observation',
  status: 'observer_review_complete',
  debrief_status: 'pending',
  users: { phone_number: FROM },
  analysis_data: {
    framework: 'mewaka',
    focus_area_sw: { title_sw: 'Maswali ya kufikirisha' },
    observer_debrief: { audio_id: 'audio-99', guide_snapshot: GUIDE, recorded_at: '2026-07-12T10:00:00Z' },
  },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.row = sessionRow();
  TranscriptionProcessorService.transcribeWithDiarization.mockResolvedValue({
    transcript: LONG_TRANSCRIPT,
    language: 'sw',
    diarization: { speakers: ['spk1', 'spk2'], confidence: 0.9, segments: [] },
    cost: 0.01,
  });
  GPT5MiniService.completeJson.mockResolvedValue({ result: goodFeedback(), usage: {} });
});

describe('startDebriefFromAudio (web side)', () => {
  const state = { state: 'awaiting_debrief_audio', sessionId: SID, guide_snapshot: GUIDE };

  test('merge-writes observer_debrief (audio id + guide snapshot), queues observe_debrief, acks, clears state', async () => {
    await startDebriefFromAudio(FO, FROM, 'audio-99', state);
    // merge-write: update called with analysis_data containing observer_debrief
    const updateArg = mockUpdate.mock.calls[0][0];
    expect(updateArg.analysis_data.observer_debrief.audio_id).toBe('audio-99');
    expect(updateArg.analysis_data.observer_debrief.guide_snapshot).toEqual(GUIDE);
    // existing analysis_data keys preserved
    expect(updateArg.analysis_data.focus_area_sw).toBeTruthy();
    // lesson columns untouched
    expect(updateArg.transcript_text).toBeUndefined();
    expect(updateArg.audio_id).toBeUndefined();
    // queued with the dedicated job type
    expect(CoachingJobQueueService.queueObserveDebrief).toHaveBeenCalledWith(
      SID, expect.objectContaining({ from: FROM, audioId: 'audio-99' }));
    // ack + state cleared
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(ObserveState.clearState).toHaveBeenCalledWith('fo-uuid-1');
  });

  test('state without sessionId → graceful error, no queue', async () => {
    await startDebriefFromAudio(FO, FROM, 'audio-99', { state: 'awaiting_debrief_audio' });
    expect(CoachingJobQueueService.queueObserveDebrief).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
  });

  // bd-56 (Fidelis/TZ, 2026-07-16): a re-recording must be a FRESH debrief.
  // The worker persists the transcript before the LLM pass and skips
  // re-transcription on redelivery — correct for retries of the SAME audio,
  // poisonous for a NEW recording: the FO's second attempt reused the first
  // attempt's stored transcript forever (his held the LESSON audio's text,
  // so every retry failed validation with no way out).
  test('bd-56: NEW recording clears stale transcript/feedback so the worker re-transcribes', async () => {
    const row = sessionRow();
    row.analysis_data.observer_debrief.transcript = 'stale lesson transcript from attempt #1';
    row.analysis_data.observer_debrief.transcript_language = 'sw';
    row.analysis_data.observer_debrief.diarization_confidence = 0.4;
    row.analysis_data.observer_debrief.feedback = goodFeedback();
    mockDb.row = row;
    await startDebriefFromAudio(FO, FROM, 'audio-NEW', state);
    const od = mockDb.row.analysis_data.observer_debrief;
    expect(od.audio_id).toBe('audio-NEW');
    expect(od.transcript).toBeFalsy();
    expect(od.transcript_language).toBeFalsy();
    expect(od.diarization_confidence).toBeFalsy();
    expect(od.feedback).toBeFalsy();
    // the rest of analysis_data is untouched (merge, not replace)
    expect(mockDb.row.analysis_data.focus_area_sw).toBeTruthy();
  });
});

describe('processDebriefRecording (worker side)', () => {
  test('happy: transcribe → feedback → praise + card sent, debrief_status done, transcript stored under observer_debrief', async () => {
    await processDebriefRecording(SID, { from: FROM, audioId: 'audio-99' });
    expect(TranscriptionProcessorService.transcribeWithDiarization).toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(2);
    const card = WhatsAppService.sendMessage.mock.calls[1][1];
    expect(card).toContain('Shikilia ukimya');
    // Write order (review fix): transcript merge → feedback merge → CHECKED
    // sends → separate done-flip. Assert the final accumulated DB state.
    expect(mockDb.row.debrief_status).toBe('done');
    expect(mockDb.row.analysis_data.observer_debrief.transcript).toContain('Asante kwa kunikaribisha');
    expect(mockDb.row.analysis_data.observer_debrief.feedback.rubric.asked_and_waited).toBe(false);
    expect(mockDb.row.analysis_data.focus_area_sw).toBeTruthy();   // merge, not replace
    // the lesson-transcript column is NEVER written by the debrief path
    const everyUpdate = mockUpdate.mock.calls.map((c) => c[0]);
    expect(everyUpdate.every((u) => u.transcript_text === undefined)).toBe(true);
    expect(everyUpdate.every((u) => u.audio_id === undefined)).toBe(true);
    // done-flip is a lean, separate write (not bundled with the merge)
    const doneWrite = everyUpdate.find((u) => u.debrief_status === 'done');
    expect(doneWrite.analysis_data).toBeUndefined();
  });

  test('idempotent redelivery: debrief_status already done → no-op, no re-send, no re-transcribe', async () => {
    mockDb.row = sessionRow({ debrief_status: 'done' });
    await processDebriefRecording(SID, { from: FROM, audioId: 'audio-99' });
    expect(TranscriptionProcessorService.transcribeWithDiarization).not.toHaveBeenCalled();
    expect(GPT5MiniService.completeJson).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });

  test('idempotent redelivery: feedback already stored → deliver-only (no re-transcribe, no re-LLM)', async () => {
    const row = sessionRow();
    row.analysis_data.observer_debrief.transcript = LONG_TRANSCRIPT;
    row.analysis_data.observer_debrief.feedback = goodFeedback();
    mockDb.row = row;
    await processDebriefRecording(SID, { from: FROM, audioId: 'audio-99' });
    expect(TranscriptionProcessorService.transcribeWithDiarization).not.toHaveBeenCalled();
    expect(GPT5MiniService.completeJson).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(2);   // re-delivered
    expect(mockDb.row.debrief_status).toBe('done');
  });

  test('send failure throws (SQS retries) and does NOT flip debrief_status to done', async () => {
    WhatsAppService.sendMessage.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(processDebriefRecording(SID, { from: FROM, audioId: 'audio-99' })).rejects.toThrow(/send failed/i);
    expect(mockDb.row.debrief_status).not.toBe('done');
    // feedback WAS persisted before the send, so the retry is deliver-only
    expect(mockDb.row.analysis_data.observer_debrief.feedback).toBeTruthy();
  });

  test('audioId falls back to the row (bd-1525 class) when payload lost it', async () => {
    await processDebriefRecording(SID, { from: FROM });
    expect(WhatsAppService.downloadMedia).toHaveBeenCalledWith('audio-99');
  });

  test('too-short transcript → gentle message, RE-ARMS state, stays pending, no LLM call', async () => {
    TranscriptionProcessorService.transcribeWithDiarization.mockResolvedValue({
      transcript: 'Sawa.', language: 'sw', diarization: { speakers: [], confidence: 0 },
    });
    await processDebriefRecording(SID, { from: FROM, audioId: 'audio-99' });
    expect(GPT5MiniService.completeJson).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    const updates = mockUpdate.mock.calls.map((c) => c[0]);
    expect(updates.every((u) => u.debrief_status !== 'done')).toBe(true);
    // review fix: re-arm awaiting_debrief_audio so "record a longer stretch
    // and send it" actually routes back to the debrief pipeline
    expect(ObserveState.setState).toHaveBeenCalledWith(
      'fo-uuid-1', 'awaiting_debrief_audio', expect.objectContaining({ sessionId: SID }));
  });

  test('LLM failure → graceful message, debrief stays pending', async () => {
    GPT5MiniService.completeJson.mockRejectedValue(new Error('llm down'));
    await processDebriefRecording(SID, { from: FROM, audioId: 'audio-99' });
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    const updates = mockUpdate.mock.calls.map((c) => c[0]);
    expect(updates.every((u) => u.debrief_status !== 'done')).toBe(true);
  });

  test('invalid feedback shape (3 wins) → graceful message, not delivered', async () => {
    const bad = goodFeedback();
    bad.wins.push({ behaviour: 'x', evidence: 'y' });
    GPT5MiniService.completeJson.mockResolvedValue({ result: bad, usage: {} });
    await processDebriefRecording(SID, { from: FROM, audioId: 'audio-99' });
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    const updates = mockUpdate.mock.calls.map((c) => c[0]);
    expect(updates.every((u) => u.debrief_status !== 'done')).toBe(true);
  });
});
