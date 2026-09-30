/**
 * bd-erpvf — HITL row 185: a coach's /observe recording is analysed ONCE.
 *
 * bd-7beiz stopped identical DC audio being re-scored, and deliberately left
 * leader observations out. So a coach who re-sent the same classroom recording
 * through /observe got a brand-new FICO analysis every time — and, because the
 * rubric pass samples at temperature 1, a different score for the same lesson.
 *
 * Measured on NIETE production, 29 Sep 2026: of the 405 leader observations
 * that carry an audio_hash, 23 (coach, bytes) groups covering 52 sessions were
 * each analysed from scratch.
 *
 * Requirement (HITL row 185): refuse the resubmission and tell the coach
 * "This classroom recording has already been analyzed. Please submit a new
 * recording." — no prior report is resent; the coach is asked for a new one.
 *
 * Two layers, as bd-7beiz does it: the helpers with injected deps, then the
 * REAL processTranscription with only the infrastructure mocked, so the call
 * site itself is executed.
 */

const EN = 'This classroom recording has already been analyzed. Please submit a new recording.';
const UR = 'اس کلاس روم ریکارڈنگ کا تجزیہ پہلے ہی کیا جا چکا ہے۔ براہ کرم نئی ریکارڈنگ بھیجیں۔';

// ── infrastructure mocks for the call-site suite ─────────────────────────────
const mockSendMessage = jest.fn(async () => true);
const mockSendImageFromUrl = jest.fn(async () => true);
const mockSendDocumentFromUrl = jest.fn(async () => true);
const mockDownloadMedia = jest.fn(async () => Buffer.from('identical observation audio'));
const mockUploadClassroomAudio = jest.fn(async () => 'https://r2.example/new.ogg');
const mockUpdateIfNotTerminal = jest.fn(async () => ({ applied: true }));
const mockGetUserLanguage = jest.fn(async (id) => (id === 'coach-uuid' ? 'ur' : 'en'));

const mockSessionRow = {
  id: 'current-obs',
  user_id: 'teacher-uuid',            // bound teacher owns the row (bd-2432)
  observer_user_id: 'coach-uuid',
  observation_type: 'leader_observation',
  audio_duration_seconds: 1800,
  users: { phone_number: '923001112223', name: 'Teacher', preferred_language: 'en' },
};

let mockPriorRow = { id: 'prior-obs', status: 'completed', created_at: '2026-09-20T08:00:00Z' };
let mockLookupThrows = false;
jest.mock('../../bot/shared/config/supabase', () => ({
  from() {
    const q = {
      select() { return q; },
      update() { return q; },
      eq() { return q; },
      is() { return q; },
      gte() { return q; },
      neq() { return q; },
      not() { return q; },
      order() { return q; },
      limit() { return q; },
      single: async () => ({ data: mockSessionRow, error: null }),
      maybeSingle: async () => {
        if (mockLookupThrows) throw new Error('column audio_hash does not exist');
        return { data: mockPriorRow, error: null };
      },
      then(resolve) { return Promise.resolve({ data: null, error: null }).then(resolve); },
    };
    return q;
  },
}));

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
  sendImageFromUrl: (...a) => mockSendImageFromUrl(...a),
  sendDocumentFromUrl: (...a) => mockSendDocumentFromUrl(...a),
  sendImage: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => true),
  downloadMedia: (...a) => mockDownloadMedia(...a),
}));

jest.mock('../../bot/shared/storage/r2', () => ({
  uploadClassroomAudio: (...a) => mockUploadClassroomAudio(...a),
}));

jest.mock('../../bot/shared/services/coaching/session-terminal', () => ({
  updateIfNotTerminal: (...a) => mockUpdateIfNotTerminal(...a),
  TERMINAL_STATUSES: ['cancelled', 'abandoned'],
  TERMINAL_IN_FILTER: '(cancelled,abandoned)',
  isTerminalStatus: () => false,
  refuseTapIfTerminal: jest.fn(),
}));

jest.mock('../../bot/shared/services/coaching/coaching-session.service', () => ({
  updateStatus: jest.fn(async () => ({})),
  updateConversationState: jest.fn(async () => ({})),
}));

jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: (...a) => mockGetUserLanguage(...a),
  setUserLanguage: jest.fn(async () => ({})),
}));

// FULL logger stub — a partial one hides a missing require at the call site.
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
  generateCorrelationId: () => 'test',
  runWithCorrelation: (_id, fn) => fn(),
}));

const HASH = 'c'.repeat(64);

describe('the coach-facing string, in both offered languages', () => {
  const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');

  test('English is the requirement wording, verbatim', () => {
    expect(observeStrings('en').capture_duplicate_recording).toBe(EN);
  });

  test('Urdu is a real translation, not the English fallback', () => {
    expect(observeStrings('ur').capture_duplicate_recording).toBe(UR);
  });
});

describe('findPriorLeaderObservation', () => {
  const { findPriorLeaderObservation } = require('../../bot/shared/services/coaching/audio-hash-cache');

  function supabaseDouble(result) {
    const calls = { eq: [], neq: [], not: [] };
    const q = {
      from: () => q,
      select: () => q,
      eq: (c, v) => { calls.eq.push([c, v]); return q; },
      neq: (c, v) => { calls.neq.push([c, v]); return q; },
      not: (c, op, v) => { calls.not.push([c, op, v]); return q; },
      order: () => q,
      limit: () => q,
      maybeSingle: async () => result,
    };
    q.calls = calls;
    return q;
  }

  test('matches the SAME coach, the same bytes, leader observations only', async () => {
    const sb = supabaseDouble({ data: { id: 'prior-obs' }, error: null });
    const r = await findPriorLeaderObservation(sb, {
      observerUserId: 'coach-uuid', audioHash: HASH, excludeSessionId: 'current-obs',
    });
    expect(r).toEqual({ id: 'prior-obs' });
    expect(sb.calls.eq).toEqual(expect.arrayContaining([
      ['observer_user_id', 'coach-uuid'],
      ['audio_hash', HASH],
      ['observation_type', 'leader_observation'],
    ]));
    expect(sb.calls.neq).toEqual([['id', 'current-obs']]);
  });

  test('a cancelled or failed prior does not count as analysed', async () => {
    const sb = supabaseDouble({ data: null, error: null });
    await findPriorLeaderObservation(sb, {
      observerUserId: 'coach-uuid', audioHash: HASH, excludeSessionId: 'current-obs',
    });
    const statusFilter = sb.calls.not.find(([c]) => c === 'status');
    expect(statusFilter).toBeDefined();
    expect(statusFilter[1]).toBe('in');
    for (const s of ['cancelled', 'abandoned', 'failed']) expect(statusFilter[2]).toContain(s);
  });

  test('no coach or no hash → no lookup, no match', async () => {
    const sb = supabaseDouble({ data: { id: 'x' }, error: null });
    expect(await findPriorLeaderObservation(sb, { observerUserId: null, audioHash: HASH })).toBeNull();
    expect(await findPriorLeaderObservation(sb, { observerUserId: 'c', audioHash: null })).toBeNull();
    expect(sb.calls.eq).toEqual([]);
  });

  test('never returns the in-flight session as its own duplicate', async () => {
    const sb = supabaseDouble({ data: { id: 'current-obs' }, error: null });
    expect(await findPriorLeaderObservation(sb, {
      observerUserId: 'coach-uuid', audioHash: HASH, excludeSessionId: 'current-obs',
    })).toBeNull();
  });
});

describe('the REAL processTranscription on a leader observation', () => {
  const TranscriptionProcessor =
    require('../../bot/shared/services/coaching/transcription-processor.service');

  const run = () => TranscriptionProcessor.processTranscription('current-obs', {
    from: '923339998887', audioId: 'wa-media-id',
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockPriorRow = { id: 'prior-obs', status: 'completed', created_at: '2026-09-20T08:00:00Z' };
    mockLookupThrows = false;
    mockUpdateIfNotTerminal.mockResolvedValue({ applied: true });
    mockDownloadMedia.mockResolvedValue(Buffer.from('identical observation audio'));
  });

  test('an already-analysed recording is neither uploaded nor transcribed', async () => {
    const transcribe = jest.spyOn(TranscriptionProcessor, 'transcribeWithDiarization');
    await run();
    expect(mockUploadClassroomAudio).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    transcribe.mockRestore();
  });

  test('the new session is closed as a duplicate of the prior one', async () => {
    await run();
    expect(mockUpdateIfNotTerminal).toHaveBeenCalledTimes(1);
    const [id, patch] = mockUpdateIfNotTerminal.mock.calls[0];
    expect(id).toBe('current-obs');
    expect(patch.status).toBe('cancelled');
    expect(patch.duplicate_of_session_id).toBe('prior-obs');
    expect(patch.audio_hash).toHaveLength(64);
  });

  test("the COACH is told, in the coach's language — not the teacher's", async () => {
    await run();
    expect(mockSendMessage).toHaveBeenCalledWith('923339998887', UR);
    expect(mockSendImageFromUrl).not.toHaveBeenCalled();   // no prior report is resent
    expect(mockSendDocumentFromUrl).not.toHaveBeenCalled();
  });

  test('an observation the coach already cancelled is not messaged about', async () => {
    mockUpdateIfNotTerminal.mockResolvedValue({ applied: false });
    await run();
    expect(mockUploadClassroomAudio).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalledWith('923339998887', UR);
  });

  test('a first-time recording is analysed as before', async () => {
    mockPriorRow = null;
    const transcribe = jest.spyOn(TranscriptionProcessor, 'transcribeWithDiarization')
      .mockRejectedValue(new Error('transcription is out of scope for this test'));
    await run().catch(() => {});
    expect(mockUploadClassroomAudio).toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalledWith('923339998887', UR);
    transcribe.mockRestore();
  });

  test('a failing lookup fails OPEN — the observation is still analysed', async () => {
    mockLookupThrows = true;
    const transcribe = jest.spyOn(TranscriptionProcessor, 'transcribeWithDiarization')
      .mockRejectedValue(new Error('transcription is out of scope for this test'));
    await run().catch(() => {});
    expect(mockUploadClassroomAudio).toHaveBeenCalled();
    transcribe.mockRestore();
  });
});
