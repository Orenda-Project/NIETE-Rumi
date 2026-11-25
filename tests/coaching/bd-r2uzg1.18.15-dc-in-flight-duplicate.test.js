/**
 * bd-r2uzg1.18.15 — a teacher's own (DC) recording sent again while the first copy is still in flight is analysed
 * ONCE: one report, one score.
 *
 * bd-7beiz's check (audio-hash-cache.findRecentDuplicateSession) only matches a prior copy with status 'completed'.
 * NIETE production, 1 Oct – 18 Nov 2026: 259 pairs of analysed copies of one teacher's same bytes; in 258 the second
 * copy's check ran while the first was still in flight (at the photo / lesson-plan step, analysing, or waiting for
 * her reflection), so it was analysed again. Since 26 Oct most come from the recording page that opens in WhatsApp.
 *
 * Fix:
 *   - transcription time (WhatsApp and the page): an EARLIER copy of the same bytes still in flight, created within
 *     the last 4 hours (p99 of created → analysed is 204-217 min) and not failed/cancelled/abandoned → this copy is
 *     closed as its duplicate and she is told once that the earlier copy is being checked; the page shows the same
 *     line (stopReason 'duplicate_in_flight'), nothing goes to WhatsApp for a page recording;
 *   - analysis time (the bd-r2uzg1.18.9 hook): the later-created copy yields to an earlier one in flight (two copies
 *     sent at once); an old copy whose analysis comes back after a newer copy started closes quietly; an earlier
 *     completed copy is reused as bd-7beiz does.
 *   - an older stuck copy, a failed one, a cancelled one never hold her back.
 *
 * Every id, number and name below is made up.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';

const HASH = 'e'.repeat(64);
const NOW = Date.parse('2026-11-18T10:00:00Z');
const minutesAgo = (m) => new Date(NOW - m * 60 * 1000).toISOString();
const TEACHER = 'teacher-0001';
const PHONE = '920000000001';
const PORTAL_URL = `https://r2.example/digital-coach-audio/classroom_audio/${TEACHER}/2026-11/portal_abc-123.ogg`;

// ── an in-memory coaching_sessions table: the real filters decide what the lookups find ───────────────
/** The rows the fake table holds. */
let mockRows = [];
/** Every row update the code made through supabase directly (the hash write). */
const mockDirectUpdates = [];
function mockMatches(row, filters) {
  return filters.every(([op, col, val]) => {
    const v = row[col] === undefined ? null : row[col];
    switch (op) {
      case 'eq': return v === val;
      case 'neq': return v !== val;
      case 'is': return val === null ? v === null : v === val;
      case 'gte': return v !== null && Date.parse(v) >= Date.parse(val);
      case 'not_in': return !String(val).replace(/[()]/g, '').split(',').includes(v);
      case 'not_is': return val === null ? v !== null : v !== val;
      default: throw new Error(`fake table: no ${op}`);
    }
  });
}
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (table) => {
    const b = { filters: [], patch: null, sortBy: null };
    b.select = () => b;
    b.update = (p) => { b.patch = p; return b; };
    b.eq = (c, v) => { b.filters.push(['eq', c, v]); return b; };
    b.neq = (c, v) => { b.filters.push(['neq', c, v]); return b; };
    b.is = (c, v) => { b.filters.push(['is', c, v]); return b; };
    b.gte = (c, v) => { b.filters.push(['gte', c, v]); return b; };
    b.in = (c, vs) => { b.filters.push(['in', c, vs]); return b; };
    b.not = (c, op, v) => { b.filters.push([op === 'in' ? 'not_in' : 'not_is', c, v]); return b; };
    b.order = (c, o = {}) => { b.sortBy = [c, o.ascending !== false]; return b; };
    b.limit = () => b;
    const rows = () => {
      if (table !== 'coaching_sessions') return [];
      const out = mockRows.filter((r) => mockMatches(r, b.filters));
      if (b.sortBy) {
        const [c, asc] = b.sortBy;
        out.sort((x, y) => (Date.parse(x[c]) - Date.parse(y[c])) * (asc ? 1 : -1));
      }
      return out;
    };
    b.single = async () => {
      const r = rows()[0];
      return r ? { data: { ...r, users: { name: 'Teacher', phone_number: PHONE, preferred_language: 'ur' } }, error: null }
        : { data: null, error: { message: 'not found' } };
    };
    b.maybeSingle = async () => ({ data: rows()[0] || null, error: null });
    b.then = (ok, ko) => {
      if (b.patch) {
        mockDirectUpdates.push({ filters: b.filters, patch: b.patch });
        return Promise.resolve({ data: null, error: null }).then(ok, ko);
      }
      return Promise.resolve({ data: rows(), error: null }).then(ok, ko);
    };
    return b;
  },
}));

// ── infrastructure doubles ──────────────────────────────────────────────────────────────────────────
const mockSent = [];
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn((to, text) => { mockSent.push({ to, text }); return Promise.resolve(true); }),
  sendSticker: jest.fn(async () => true),
  sendImageFromUrl: jest.fn((to, url) => { mockSent.push({ to, image: url }); return Promise.resolve(true); }),
  sendDocumentFromUrl: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => true),
  downloadMedia: jest.fn(async () => Buffer.from('the same classroom audio bytes')),
}));
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(),
  generateCorrelationId: () => 'test', runWithCorrelation: (_id, fn) => fn(),
}));
jest.mock('../../bot/shared/services/audio.service', () => ({}));
const mockUpload = jest.fn(async () => 'https://r2.example/new.ogg');
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadClassroomAudio: (...a) => mockUpload(...a),
  downloadFromR2: jest.fn(async () => Buffer.from('the same classroom audio bytes')),
  extractKeyFromUrl: (u) => u,
}));
jest.mock('../../bot/shared/services/coaching/portal-short-recording', () => ({
  isPortalDc: () => false,
  refuseShortPortalRecording: async () => ({ refused: false }),
}));
const mockUpdateStatus = jest.fn(async () => ({}));
jest.mock('../../bot/shared/services/coaching/coaching-session.service', () => ({
  updateStatus: (...a) => mockUpdateStatus(...a),
  updateConversationState: jest.fn(async () => ({})),
  markAsFailed: jest.fn(async () => ({})),
}));
// Reaching the analysis proper (the prior-feedback read) means the analysis ran.
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
let mockLang = 'en';
jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(async () => mockLang),
  setUserLanguage: jest.fn(async () => ({})),
}));

const Cache = require('../../bot/shared/services/coaching/audio-hash-cache');
const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');

const HASH_OF_AUDIO = Cache.computeAudioHash(Buffer.from('the same classroom audio bytes'));

/** A DC copy (made up). */
function copy(over = {}) {
  return {
    id: 'copy-x',
    user_id: TEACHER,
    observation_type: null,
    status: 'awaiting_photo',
    audio_hash: HASH_OF_AUDIO,
    audio_url: null,
    audio_id: 'wa-media-1',
    audio_duration_seconds: 2400,
    created_at: minutesAgo(20),
    analysis_started_at: null,
    analysis_completed_at: null,
    duplicate_of_session_id: null,
    ...over,
  };
}

let realNow;
beforeAll(() => { realNow = Date.now; Date.now = () => NOW; });
afterAll(() => { Date.now = realNow; });
beforeEach(() => {
  mockRows = [];
  mockSent.length = 0;
  mockDirectUpdates.length = 0;
  mockLang = 'en';
  mockUpload.mockClear();
  mockUpdateStatus.mockClear();
  mockPriorFeedback.mockClear();
  mockUpdateIfNotTerminal.mockClear();
  mockUpdateIfNotTerminal.mockImplementation(async () => ({ applied: true }));
});

const closesWrites = () => mockUpdateIfNotTerminal.mock.calls.filter(([, p]) => p && p.status === 'cancelled');

// ── the words ───────────────────────────────────────────────────────────────────────────────────────
describe('the message (en + ur, from the catalog)', () => {
  test('duplicateRecordingInFlight exists in both languages, Urdu in Urdu script, short, never "app"', () => {
    const en = getCoachingMessage('duplicateRecordingInFlight', 'en');
    const ur = getCoachingMessage('duplicateRecordingInFlight', 'ur');
    expect(en).toMatch(/earlier/i);
    expect(ur).not.toBe(en);
    expect(ur).toMatch(/[؀-ۿ]/);
    for (const s of [en, ur]) expect([...s].length).toBeLessThan(220);
    expect(en).not.toMatch(/\bapp\b/i);
    expect(ur).not.toMatch(/ایپ/);
  });
});

// ── the lookup: in flight, recent, not failed — the real filters on the fake table ─────────────────
describe('findInFlightCopies', () => {
  const supabase = require('../../bot/shared/config/supabase');
  const find = () => Cache.findInFlightCopies(supabase, { userId: TEACHER, audioHash: HASH_OF_AUDIO, excludeSessionId: 'copy-now' });

  test('an earlier copy still at the photo step, 20 minutes old, is found', async () => {
    mockRows = [copy({ id: 'copy-first' }), copy({ id: 'copy-now', created_at: minutesAgo(1) })];
    expect((await find()).map((r) => r.id)).toEqual(['copy-first']);
  });

  test('never: a failed, cancelled or abandoned copy, a completed one, another teacher, a coach observation', async () => {
    mockRows = [
      copy({ id: 'c-failed', status: 'failed' }), copy({ id: 'c-cancelled', status: 'cancelled' }),
      copy({ id: 'c-abandoned', status: 'abandoned' }), copy({ id: 'c-completed', status: 'completed' }),
      copy({ id: 'c-other', user_id: 'teacher-0002' }), copy({ id: 'c-obs', observation_type: 'leader_observation' }),
      copy({ id: 'c-other-bytes', audio_hash: HASH }),
    ];
    expect(await find()).toEqual([]);
  });

  test('an older stuck copy (over 4 hours) does not hold her back; one just inside does', async () => {
    mockRows = [copy({ id: 'c-stuck', status: 'generating_report', created_at: minutesAgo(5 * 60) }),
      copy({ id: 'c-inside', status: 'conducting_conversation', created_at: minutesAgo(3 * 60 + 50) })];
    expect((await find()).map((r) => r.id)).toEqual(['c-inside']);
    expect(Cache.IN_FLIGHT_WINDOW_MS).toBe(4 * 60 * 60 * 1000);
  });
});

// ── WhatsApp: the real processTranscription ─────────────────────────────────────────────────────────
describe('transcription: her WhatsApp re-send while the first copy is in flight', () => {
  const TP = require('../../bot/shared/services/coaching/transcription-processor.service');
  const run = (id) => TP.processTranscription(id, { from: PHONE, audioId: 'wa-media-2' }).catch((e) => e);

  test('closed as a duplicate of the earlier copy, not transcribed, she is told once in her language', async () => {
    mockLang = 'ur';
    mockRows = [copy({ id: 'copy-first' }), copy({ id: 'copy-again', status: 'confirmed', audio_hash: null, created_at: minutesAgo(1) })];

    await run('copy-again');

    expect(mockUpload).not.toHaveBeenCalled();
    expect(closesWrites()).toEqual([['copy-again', expect.objectContaining({
      status: 'cancelled', duplicate_of_session_id: 'copy-first', failed_step: 'duplicate_in_flight', audio_hash: HASH_OF_AUDIO,
    })]]);
    const said = mockSent.filter((m) => m.text === getCoachingMessage('duplicateRecordingInFlight', 'ur'));
    expect(said).toEqual([{ to: PHONE, text: getCoachingMessage('duplicateRecordingInFlight', 'ur') }]);
  });

  test('the first copy is never written: it goes on to deliver its report', async () => {
    mockRows = [copy({ id: 'copy-first' }), copy({ id: 'copy-again', status: 'confirmed', audio_hash: null, created_at: minutesAgo(1) })];
    await run('copy-again');
    expect(mockUpdateIfNotTerminal.mock.calls.map(([id]) => id)).not.toContain('copy-first');
    expect(mockDirectUpdates.filter((u) => u.filters.some(([, c, v]) => c === 'id' && v === 'copy-first'))).toEqual([]);
  });

  test('a failed first copy does not block: her re-send is transcribed', async () => {
    mockRows = [copy({ id: 'copy-first', status: 'failed' }), copy({ id: 'copy-again', status: 'confirmed', audio_hash: null, created_at: minutesAgo(1) })];
    await run('copy-again');
    expect(mockUpload).toHaveBeenCalled();
    expect(closesWrites()).toEqual([]);
  });

  test('a first copy stuck for over 4 hours does not block: her re-send is transcribed', async () => {
    mockRows = [copy({ id: 'copy-first', status: 'generating_report', created_at: minutesAgo(6 * 60) }),
      copy({ id: 'copy-again', status: 'confirmed', audio_hash: null, created_at: minutesAgo(1) })];
    await run('copy-again');
    expect(mockUpload).toHaveBeenCalled();
    expect(closesWrites()).toEqual([]);
  });
});

// ── the page that opens inside WhatsApp: the same transcription, nothing to WhatsApp ─────────────────
describe('transcription: a re-send from the recording page', () => {
  const TP = require('../../bot/shared/services/coaching/transcription-processor.service');

  test('closed the same way; the page shows why (stopReason), nothing goes to her WhatsApp', async () => {
    mockRows = [copy({ id: 'copy-first', status: 'conducting_conversation', audio_url: PORTAL_URL.replace('abc-123', 'abc-122') }),
      copy({ id: 'copy-again', status: 'confirmed', audio_hash: null, audio_url: PORTAL_URL, created_at: minutesAgo(1) })];

    await TP.processTranscription('copy-again', { from: PHONE }).catch((e) => e);

    expect(closesWrites()).toEqual([['copy-again', expect.objectContaining({
      status: 'cancelled', duplicate_of_session_id: 'copy-first', failed_step: 'duplicate_in_flight',
    })]]);
    expect(mockSent.filter((m) => m.text === getCoachingMessage('duplicateRecordingInFlight', 'en'))).toEqual([]);
  });
});

// ── analysis: the bd-r2uzg1.18.9 hook, now for her own recordings too ───────────────────────────────
describe('analysis: the later-created copy yields', () => {
  const AP = require('../../bot/shared/services/coaching/analysis-processor.service');
  const run = (id) => AP.processAnalysis(id, { from: PHONE }).catch((e) => e);

  test('two copies sent at once (both passed transcription): the later one yields, the earlier one is analysed', async () => {
    mockRows = [copy({ id: 'copy-a', created_at: minutesAgo(10) }), copy({ id: 'copy-b', created_at: '2026-11-18T09:50:00.600Z' })];
    mockRows[0].created_at = '2026-11-18T09:50:00.300Z';

    const out = await run('copy-b');
    expect(out).toEqual({ skipped: 'duplicate' });
    expect(mockPriorFeedback).not.toHaveBeenCalled();
    expect(closesWrites()).toEqual([['copy-b', expect.objectContaining({ status: 'cancelled', duplicate_of_session_id: 'copy-a' })]]);
    expect(mockSent.map((m) => m.text)).toEqual([getCoachingMessage('duplicateRecordingInFlight', 'en')]);

    // copy-b is now closed; copy-a's analysis goes ahead.
    mockRows[1].status = 'cancelled';
    mockUpdateIfNotTerminal.mockClear();
    await run('copy-a');
    expect(mockPriorFeedback).toHaveBeenCalled();
    expect(closesWrites()).toEqual([]);
  });

  test('the earlier copy reaching analysis first goes ahead (the later one, not yet analysing, will yield)', async () => {
    mockRows = [copy({ id: 'copy-a', created_at: minutesAgo(30) }), copy({ id: 'copy-b', created_at: minutesAgo(5) })];
    await run('copy-a');
    expect(mockPriorFeedback).toHaveBeenCalled();
    expect(closesWrites()).toEqual([]);
  });

  test('the same created_at: the larger id yields', async () => {
    const at = minutesAgo(5);
    mockRows = [copy({ id: 'copy-a', created_at: at }), copy({ id: 'copy-b', created_at: at })];
    expect(await run('copy-b')).toEqual({ skipped: 'duplicate' });
    mockUpdateIfNotTerminal.mockClear();
    mockPriorFeedback.mockClear();
    await run('copy-a');
    expect(mockPriorFeedback).toHaveBeenCalled();
  });

  test('an old copy coming back after a newer copy started its analysis: closed quietly', async () => {
    mockRows = [copy({ id: 'copy-old', status: 'failed', created_at: minutesAgo(90) }),
      copy({ id: 'copy-new', status: 'analyzing', created_at: minutesAgo(40), analysis_started_at: minutesAgo(2) })];
    expect(await run('copy-old')).toEqual({ skipped: 'duplicate' });
    expect(closesWrites()).toEqual([['copy-old', expect.objectContaining({ duplicate_of_session_id: 'copy-new' })]]);
    expect(mockSent).toEqual([]);
  });

  test('an earlier copy that completed meanwhile: its report is reused, as bd-7beiz does', async () => {
    mockRows = [copy({ id: 'copy-a', status: 'completed', created_at: minutesAgo(70), analysis_data: { scores: {} },
      report_pdf_url: 'https://r2.example/reports/a_report.png' }), copy({ id: 'copy-b', created_at: minutesAgo(50) })];
    expect(await run('copy-b')).toEqual({ skipped: 'duplicate' });
    expect(mockUpdateIfNotTerminal).toHaveBeenCalledWith('copy-b', expect.objectContaining({ status: 'completed', duplicate_of_session_id: 'copy-a' }));
    expect(mockSent.map((m) => m.text || m.image)).toEqual([getCoachingMessage('duplicateRecording', 'en'), 'https://r2.example/reports/a_report.png']);
    expect(mockPriorFeedback).not.toHaveBeenCalled();
  });

  test('control: no other copy — the analysis starts as before', async () => {
    mockRows = [copy({ id: 'copy-only' })];
    await run('copy-only');
    expect(mockUpdateStatus).toHaveBeenCalledWith('copy-only', 'analyzing', expect.anything());
    expect(mockPriorFeedback).toHaveBeenCalled();
  });

  test('control: a lookup that throws fails open — the analysis starts', async () => {
    mockRows = [copy({ id: 'copy-a', created_at: minutesAgo(30) }), copy({ id: 'copy-b', created_at: minutesAgo(5) })];
    const spy = jest.spyOn(Cache, 'findInFlightCopies').mockRejectedValueOnce(new Error('column does not exist'));
    await run('copy-b');
    expect(mockPriorFeedback).toHaveBeenCalled();
    spy.mockRestore();
  });
});
