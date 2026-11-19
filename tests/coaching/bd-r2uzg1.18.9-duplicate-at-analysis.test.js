/**
 * bd-r2uzg1.18.9 — HITL row 186: a coach's classroom recording is analysed ONCE, also when the analysis starts late.
 *
 * bd-erpvf (row 185) refuses a coach's re-sent recording in the transcription worker, right after the audio is
 * hashed. That is the only place the check runs. But the analysis itself starts LATER — after the photo and
 * lesson-plan steps, or when a failed analysis job is retried — and by then the picture can have changed:
 *
 *   1. The first observation's analysis fails (status 'failed'). The coach sends the recording again; the check
 *      rightly lets it through (a failed prior was never analysed). Then the FIRST job is retried (SQS redelivery,
 *      ~15 min later, or a tap on one of its old buttons) and it completes too. NIETE production: 22 Oct, 2 Nov and
 *      4 Nov 2026 — two finished analyses of the same bytes by the same coach each time.
 *   2. The same recording arrives twice within a second. Both pass the check, because the hash is only stored
 *      once transcription has finished. NIETE production, 8 Oct 2026.
 *
 * Fix: the same check (findPriorLeaderObservation + refuseDuplicateObservation, audio-hash-cache.js) runs again in
 * processAnalysis before the analysis starts, against observations of the same bytes by the same coach whose
 * analysis has STARTED and that are not cancelled/abandoned/failed:
 *   - that observation is OLDER  → this is a repeat: refuse it with the existing "already analysed" message;
 *   - that observation is NEWER  → this is the old failed one coming back after the coach re-sent: close it
 *                                  quietly (the coach is following the newer one).
 *
 * Every id, number and name below is made up.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';

const EN = 'This classroom recording has already been analyzed. Please submit a new recording.';
const UR = 'اس کلاس روم ریکارڈنگ کا تجزیہ پہلے ہی کیا جا چکا ہے۔ براہ کرم نئی ریکارڈنگ بھیجیں۔';
const HASH = 'd'.repeat(64);

// ── infrastructure doubles for the call-site suite ──────────────────────────────────────────────────
const mockSent = [];
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn((to, text) => { mockSent.push({ to, text }); return Promise.resolve({}); }),
  sendSticker: jest.fn(() => Promise.resolve({})),
  sendButtonMessage: jest.fn(() => Promise.resolve({})),
  sendInteractiveButtons: jest.fn(() => Promise.resolve({})),
  downloadMedia: jest.fn(() => Promise.resolve(Buffer.from(''))),
}));

// FULL logger stub — a partial one hides a missing require at the call site.
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(),
  logError: jest.fn(),
  logWarn: jest.fn(),
  generateCorrelationId: () => 'test',
  runWithCorrelation: (_id, fn) => fn(),
}));

jest.mock('../../bot/shared/services/audio.service', () => ({}));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadClassroomAudio: jest.fn(() => Promise.resolve({})) }));

const mockUpdateStatus = jest.fn(() => Promise.resolve({}));
jest.mock('../../bot/shared/services/coaching/coaching-session.service', () => ({
  updateStatus: (...a) => mockUpdateStatus(...a),
  updateConversationState: jest.fn(() => Promise.resolve({})),
}));

// The analysis proper starts with the prior-feedback read: reaching it means the analysis ran.
const mockPriorFeedback = jest.fn(() => Promise.reject(new Error('stop here: the analysis started')));
jest.mock('../../bot/shared/services/coaching/report-generator.service', () => ({
  fetchAndCompressPriorFeedback: (...a) => mockPriorFeedback(...a),
}));

const mockUpdateIfNotTerminal = jest.fn(async () => ({ applied: true }));
jest.mock('../../bot/shared/services/coaching/session-terminal', () => ({
  updateIfNotTerminal: (...a) => mockUpdateIfNotTerminal(...a),
  TERMINAL_STATUSES: ['cancelled', 'abandoned'],
  TERMINAL_IN_FILTER: '(cancelled,abandoned)',
  isTerminalStatus: () => false,
  refuseTapIfTerminal: jest.fn(),
}));

jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(async (id) => (id === 'coach-0001' ? 'ur' : 'en')),
  setUserLanguage: jest.fn(async () => ({})),
}));

/** The observation being analysed (made up). */
let mockSession = null;
/** What the "another observation of the same bytes" lookup finds (null = none). */
let mockPrior = null;
/** The filters the lookup applied, so the suite can see it asked for an analysed one. */
const mockLookups = [];
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (table) => {
    if (table === 'app_settings') {
      const s = { select: () => s, eq: () => Promise.resolve({ data: [], error: null }) };
      return s;
    }
    const b = { _cols: '', calls: [] };
    b.select = (cols) => { b._cols = String(cols || ''); return b; };
    ['order', 'limit', 'in', 'is', 'update', 'gte'].forEach((m) => { b[m] = () => b; });
    b.eq = (c, v) => { b.calls.push(['eq', c, v]); return b; };
    b.neq = (c, v) => { b.calls.push(['neq', c, v]); return b; };
    b.not = (c, op, v) => { b.calls.push(['not', c, op, v]); return b; };
    b.single = async () => ({
      data: { ...mockSession, users: { name: 'Teacher', phone_number: '920000000001' } }, error: null,
    });
    b.maybeSingle = async () => {
      if (b.calls.some(([, c]) => c === 'audio_hash')) { mockLookups.push(b.calls); return { data: mockPrior, error: null }; }
      return { data: mockSession, error: null };
    };
    b.then = (ok, ko) => Promise.resolve({ data: null, error: null }).then(ok, ko);
    return b;
  },
}));

const Cache = require('../../bot/shared/services/coaching/audio-hash-cache');

function leaderObservation(over = {}) {
  return {
    id: 'obs-current',
    user_id: 'teacher-0001',
    observer_user_id: 'coach-0001',
    observation_type: 'leader_observation',
    framework: 'fico',
    status: 'awaiting_classroom_photo',
    audio_hash: HASH,
    created_at: '2026-11-02T09:24:44Z',
    ...over,
  };
}

beforeEach(() => {
  mockSent.length = 0;
  mockLookups.length = 0;
  mockUpdateStatus.mockClear();
  mockPriorFeedback.mockClear();
  mockUpdateIfNotTerminal.mockClear();
  mockUpdateIfNotTerminal.mockImplementation(async () => ({ applied: true }));
  mockSession = leaderObservation();
  mockPrior = null;
});

// ── the lookup: one more filter, opt-in ─────────────────────────────────────────────────────────────
describe('findPriorLeaderObservation({ analysisStarted: true })', () => {
  function double(result) {
    const calls = [];
    const q = {
      from: () => q,
      select: () => q,
      eq: (c, v) => { calls.push(['eq', c, v]); return q; },
      neq: (c, v) => { calls.push(['neq', c, v]); return q; },
      not: (c, op, v) => { calls.push(['not', c, op, v]); return q; },
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: result, error: null }),
    };
    return { q, calls };
  }

  test('asks only for an observation whose analysis started', async () => {
    const { q, calls } = double({ id: 'obs-other', status: 'completed', created_at: '2026-11-02T09:53:17Z' });
    await Cache.findPriorLeaderObservation(q, {
      observerUserId: 'coach-0001', audioHash: HASH, excludeSessionId: 'obs-current', analysisStarted: true,
    });
    expect(calls).toContainEqual(['not', 'analysis_started_at', 'is', null]);
    // and still the bd-erpvf filters: same coach, same bytes, not this one, never a failed one
    expect(calls).toContainEqual(['eq', 'observer_user_id', 'coach-0001']);
    expect(calls).toContainEqual(['eq', 'audio_hash', HASH]);
    expect(calls).toContainEqual(['neq', 'id', 'obs-current']);
    expect(calls).toContainEqual(['not', 'status', 'in', '(cancelled,abandoned,failed)']);
  });

  test('the transcription-time lookup is unchanged (no analysis filter)', async () => {
    const { q, calls } = double(null);
    await Cache.findPriorLeaderObservation(q, { observerUserId: 'coach-0001', audioHash: HASH, excludeSessionId: 'x' });
    expect(calls.find((c) => c[1] === 'analysis_started_at')).toBeUndefined();
  });
});

// ── the helper, with injected deps ──────────────────────────────────────────────────────────────────
describe('refuseIfAlreadyAnalysed', () => {
  function deps(prior, over = {}) {
    const sent = [];
    const writes = [];
    const lookups = [];
    return {
      sent, writes, lookups,
      d: {
        from: '920000000009',
        findPrior: async (opts) => { lookups.push(opts); return prior; },
        skipsCheck: async () => false,
        updateIfNotTerminal: async (id, patch) => { writes.push([id, patch]); return { applied: true }; },
        sendMessage: async (to, body) => { sent.push([to, body]); },
        getLanguage: async () => 'en',
        getStrings: require('../../bot/shared/services/observe/observe-strings').observeStrings,
        log: () => {},
        ...over,
      },
    };
  }

  test('an OLDER analysed observation of the same bytes: refused with the existing message', async () => {
    const prior = { id: 'obs-older', status: 'completed', created_at: '2026-11-02T09:24:44Z' };
    const t = deps(prior);
    const refused = await Cache.refuseIfAlreadyAnalysed(leaderObservation({ id: 'obs-resent', created_at: '2026-11-02T09:53:17Z' }), t.d);
    expect(refused).toBe(true);
    expect(t.lookups[0]).toMatchObject({ observerUserId: 'coach-0001', audioHash: HASH, excludeSessionId: 'obs-resent', analysisStarted: true });
    expect(t.writes).toEqual([['obs-resent', expect.objectContaining({ status: 'cancelled', duplicate_of_session_id: 'obs-older' })]]);
    expect(t.sent).toEqual([['920000000009', EN]]);
  });

  test('the coach hears it in her own language', async () => {
    const t = deps({ id: 'obs-older', status: 'completed', created_at: '2026-11-01T08:00:00Z' }, { getLanguage: async () => 'ur' });
    await Cache.refuseIfAlreadyAnalysed(leaderObservation(), t.d);
    expect(t.sent).toEqual([['920000000009', UR]]);
  });

  test('a NEWER analysed observation (the old failed one retried after the coach re-sent): closed quietly', async () => {
    const prior = { id: 'obs-resent', status: 'awaiting_observer_review', created_at: '2026-11-04T07:29:04Z' };
    const t = deps(prior);
    const refused = await Cache.refuseIfAlreadyAnalysed(
      leaderObservation({ id: 'obs-failed-first', status: 'failed', created_at: '2026-11-04T06:39:04Z' }), t.d);
    expect(refused).toBe(true);
    expect(t.writes).toEqual([['obs-failed-first', expect.objectContaining({ status: 'cancelled', duplicate_of_session_id: 'obs-resent' })]]);
    expect(t.sent).toEqual([]);
  });

  test('nothing else analysed: the analysis goes ahead', async () => {
    const t = deps(null);
    expect(await Cache.refuseIfAlreadyAnalysed(leaderObservation(), t.d)).toBe(false);
    expect(t.writes).toEqual([]);
    expect(t.sent).toEqual([]);
  });

  test("a teacher's own recording (DC) is not this check's business", async () => {
    const t = deps({ id: 'obs-older', status: 'completed', created_at: '2026-11-01T08:00:00Z' });
    expect(await Cache.refuseIfAlreadyAnalysed(leaderObservation({ observation_type: null }), t.d)).toBe(false);
    expect(t.lookups).toEqual([]);
  });

  test('no hash on the row (not stamped): fails open, no lookup', async () => {
    const t = deps({ id: 'obs-older', status: 'completed', created_at: '2026-11-01T08:00:00Z' });
    expect(await Cache.refuseIfAlreadyAnalysed(leaderObservation({ audio_hash: null }), t.d)).toBe(false);
    expect(t.lookups).toEqual([]);
  });

  test('an observation whose own analysis already finished is never closed by a re-run (no lookup)', async () => {
    const t = deps({ id: 'obs-older', status: 'completed', created_at: '2026-11-01T08:00:00Z' });
    const row = leaderObservation({ status: 'completed', analysis_completed_at: '2026-11-02T09:56:29Z' });
    expect(await Cache.refuseIfAlreadyAnalysed(row, t.d)).toBe(false);
    expect(t.lookups).toEqual([]);
    expect(t.writes).toEqual([]);
  });

  test('a test account on skip_recording_duplicate_check is analysed again (bd-r98hph)', async () => {
    const t = deps({ id: 'obs-older', status: 'completed', created_at: '2026-11-01T08:00:00Z' }, { skipsCheck: async () => true });
    expect(await Cache.refuseIfAlreadyAnalysed(leaderObservation(), t.d)).toBe(false);
    expect(t.lookups).toEqual([]);
  });
});

// ── the REAL processAnalysis, infrastructure mocked ─────────────────────────────────────────────────
describe('processAnalysis runs the check before the analysis starts', () => {
  const AnalysisProcessorService = require('../../bot/shared/services/coaching/analysis-processor.service');

  test('a repeat of an analysed recording is refused: no analysis, the coach gets the existing message', async () => {
    mockSession = leaderObservation({ id: 'obs-resent', created_at: '2026-11-02T09:53:17Z' });
    mockPrior = { id: 'obs-first', status: 'completed', created_at: '2026-11-02T09:24:44Z' };

    const out = await AnalysisProcessorService.processAnalysis('obs-resent', { from: '920000000009' }).catch((e) => e);

    expect(mockLookups.length).toBe(1);
    expect(mockLookups[0]).toContainEqual(['not', 'analysis_started_at', 'is', null]);
    expect(mockUpdateStatus).not.toHaveBeenCalledWith('obs-resent', 'analyzing', expect.anything());
    expect(mockPriorFeedback).not.toHaveBeenCalled();
    expect(mockUpdateIfNotTerminal).toHaveBeenCalledWith('obs-resent',
      expect.objectContaining({ status: 'cancelled', duplicate_of_session_id: 'obs-first' }));
    expect(mockSent.map((s) => s.text)).toEqual([UR]);   // the coach (coach-0001) reads Urdu
    expect(out).toEqual({ skipped: 'duplicate' });
  });

  test('the old failed observation retried after a re-send stops quietly', async () => {
    mockSession = leaderObservation({ id: 'obs-failed-first', status: 'failed', created_at: '2026-11-04T06:39:04Z' });
    mockPrior = { id: 'obs-resent', status: 'awaiting_observer_review', created_at: '2026-11-04T07:29:04Z' };

    const out = await AnalysisProcessorService.processAnalysis('obs-failed-first', { from: '920000000009' }).catch((e) => e);

    expect(mockPriorFeedback).not.toHaveBeenCalled();
    expect(mockUpdateIfNotTerminal).toHaveBeenCalledWith('obs-failed-first',
      expect.objectContaining({ status: 'cancelled', duplicate_of_session_id: 'obs-resent' }));
    expect(mockSent).toEqual([]);
    expect(out).toEqual({ skipped: 'duplicate' });
  });

  test('control: nothing else analysed — the analysis starts as before', async () => {
    mockSession = leaderObservation();
    mockPrior = null;

    await AnalysisProcessorService.processAnalysis('obs-current', { from: '920000000009' }).catch(() => {});

    expect(mockUpdateStatus).toHaveBeenCalledWith('obs-current', 'analyzing', expect.anything());
    expect(mockPriorFeedback).toHaveBeenCalled();
    expect(mockUpdateIfNotTerminal).not.toHaveBeenCalled();
  });

  test('control: a lookup that throws fails open — the analysis starts', async () => {
    mockSession = leaderObservation();
    mockPrior = null;
    const spy = jest.spyOn(Cache, 'findPriorLeaderObservation').mockRejectedValueOnce(new Error('column does not exist'));

    await AnalysisProcessorService.processAnalysis('obs-current', { from: '920000000009' }).catch(() => {});

    expect(mockPriorFeedback).toHaveBeenCalled();
    spy.mockRestore();
  });

  test("control: a teacher's own recording (DC) is never looked up here", async () => {
    mockSession = leaderObservation({ observation_type: null, observer_user_id: null });
    await AnalysisProcessorService.processAnalysis('obs-current', { from: '920000000009' }).catch(() => {});
    expect(mockLookups).toEqual([]);
    expect(mockPriorFeedback).toHaveBeenCalled();
  });
});
