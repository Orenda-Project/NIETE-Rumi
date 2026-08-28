/**
 * bd-go4tl.2 / .3 — the coach's own recovery lever must work, and must not lie.
 *
 * _resumeRetry() and runRetry() both refused on
 *   (count >= MAX_RETRIES || !s.transcript_text)
 * A session that died DURING transcription has no transcript by definition, so
 * the only affordance a coach has refused exactly the sessions that needed it —
 * on retry attempt ZERO. Javeria's row had observe_retry_count undefined and
 * transcript_text null; she was told it "keeps stopping" after zero attempts.
 *
 * Second defect, same function: runRetry() always queued ANALYSIS regardless of
 * the phase the session died in. The correct status->queue map already exists
 * next door as RETRY_QUEUE_BY_STATUS.
 *
 * Third (bd-go4tl.3): the refusal promises "the team has been told" in all three
 * languages. Nothing is told — the only side effect was logToFile at info level.
 */

const mockState = { session: null, updates: [] };

function mockBuilder(table) {
  const ctx = { table, filters: {}, op: null, payload: null };
  const b = {
    select: () => b,
    update: (payload) => { ctx.op = 'update'; ctx.payload = payload; return b; },
    eq: (k, v) => { ctx.filters[k] = v; return b; },
    in: () => b,
    order: () => b,
    limit: () => b,
    range: () => Promise.resolve({ data: [], error: null }),
    maybeSingle: async () => {
      if (ctx.table === 'users') return { data: { preferred_language: 'ur', region: 'ICT' }, error: null };
      return { data: mockState.session, error: null };
    },
    single: async () => ({ data: null, error: null }),
    then: (resolve) => {
      let out = { data: [], error: null };
      if (ctx.op === 'update') {
        mockState.updates.push({ table: ctx.table, payload: ctx.payload, filters: ctx.filters });
        const casOk = !mockState.casMisses
          && (ctx.filters.status === undefined || ctx.filters.status === mockState.session.status);
        if (casOk) Object.assign(mockState.session, ctx.payload);   // the row really moves
        out = { data: casOk ? [{ ...mockState.session }] : [], error: null };
      }
      return Promise.resolve(out).then(resolve);
    },
  };
  return b;
}
jest.mock('../../shared/config/supabase', () => ({ from: (t) => mockBuilder(t) }));

const sent = [];
const buttons = [];
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async (to, msg) => { sent.push({ to, msg }); return true; }),
  sendInteractiveButtons: jest.fn(async (to, p) => { buttons.push({ to, p }); return true; }),
  sendInteractiveMessage: jest.fn(async () => true),
  sendFlow: jest.fn(async () => true),
}));

const queued = [];
jest.mock('../../shared/services/coaching/coaching-job-queue.service', () => ({
  queueTranscription: jest.fn(async (sid, meta) => { queued.push({ q: 'transcription', sid, meta }); return 'm'; }),
  queueAnalysis: jest.fn(async (sid, meta) => { queued.push({ q: 'analysis', sid, meta }); return 'm'; }),
  queueReport: jest.fn(async (sid, meta) => { queued.push({ q: 'report', sid, meta }); return 'm'; }),
}));

const logged = [];
jest.mock('../../shared/utils/logger', () => ({
  logToFile: jest.fn((m, d) => logged.push({ level: 'info', m, d })),
  logError: jest.fn((m, d) => logged.push({ level: 'error', m, d })),
  logWarn: jest.fn((m, d) => logged.push({ level: 'warn', m, d })),
}));

process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';

const Resume = require('../../shared/services/observe/observe-resume.service');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

const COACH = { id: 'coach-1', preferred_language: 'ur' };
const HOURS = 3600 * 1000;
const stale = new Date(Date.now() - 3 * HOURS).toISOString();

function session(over = {}) {
  return {
    id: 'obs-1', status: 'transcribing', created_at: stale, updated_at: stale,
    user_id: 'teacher-1', observer_user_id: 'coach-1',
    analysis_data: null, transcript_text: null, audio_id: 'wa-media-123',
    conversation_state: null, ...over,
  };
}

beforeEach(() => {
  mockState.session = session(); mockState.updates = []; mockState.casMisses = false;
  sent.length = 0; buttons.length = 0; queued.length = 0; logged.length = 0;
});

describe('bd-go4tl.2 — a session that died before a transcript is still recoverable', () => {
  test('tapping a transcribing session offers a retry instead of giving up', async () => {
    await Resume.resume('obs-1', '92-COACH', COACH);
    const S = observeStrings('ur');
    expect(sent.map((m) => m.msg)).not.toContain(S.resume_retry_exhausted);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].p.buttons.map((x) => x.id)).toContain('observe_retry_obs-1');
  });

  test('running the retry re-enters at TRANSCRIPTION, not analysis', async () => {
    await Resume.runRetry('obs-1', '92-COACH', COACH);
    expect(queued).toHaveLength(1);
    expect(queued[0].q).toBe('transcription');
    expect(queued[0].meta.audioId).toBe('wa-media-123');
  });

  test('a session that died after transcription still re-enters at ANALYSIS', async () => {
    mockState.session = session({ status: 'analysis_started', transcript_text: 'x'.repeat(400) });
    await Resume.runRetry('obs-1', '92-COACH', COACH);
    expect(queued[0].q).toBe('analysis');
  });

  test('a session with neither transcript nor audio is genuinely refused', async () => {
    mockState.session = session({ transcript_text: null, audio_id: null });
    await Resume.runRetry('obs-1', '92-COACH', COACH);
    expect(queued).toHaveLength(0);
    expect(sent).toHaveLength(1);
  });

  test('the retry bound still holds — a third attempt is refused', async () => {
    mockState.session = session({ analysis_data: { observe_retry_count: 2 } });
    await Resume.runRetry('obs-1', '92-COACH', COACH);
    expect(queued).toHaveLength(0);
    expect(sent).toHaveLength(1);
  });

  test('a concurrent tap that loses the CAS neither queues nor claims a restart', async () => {
    mockState.casMisses = true;               // another tap moved the row first
    await Resume.runRetry('obs-1', '92-COACH', COACH);
    expect(queued).toHaveLength(0);
    expect(sent.map((m) => m.msg)).toEqual([observeStrings('ur').resume_wait_ack]);
  });

  test('the retry counter advances, so the bound is reachable', async () => {
    await Resume.runRetry('obs-1', '92-COACH', COACH);
    expect(mockState.session.analysis_data.observe_retry_count).toBe(1);
  });
});

describe('bd-go4tl.3 — the refusal tells the truth and leaves a trace', () => {
  test('no language claims the team has been notified', () => {
    for (const lang of ['en', 'ur', 'sw']) {
      const s = observeStrings(lang).resume_retry_exhausted;
      expect(s).not.toMatch(/team has been (told|notified)/i);
      expect(s).not.toMatch(/ٹیم کو اطلاع/);
      expect(s).not.toMatch(/timu imejulishwa/i);
    }
  });

  test('a genuine refusal logs at ERROR level, not info', async () => {
    mockState.session = session({ transcript_text: null, audio_id: null });
    await Resume.runRetry('obs-1', '92-COACH', COACH);
    expect(logged.some((l) => l.level === 'error')).toBe(true);
  });

  test('a genuine refusal writes error_message so the next reader knows why', async () => {
    mockState.session = session({ transcript_text: null, audio_id: null });
    await Resume.runRetry('obs-1', '92-COACH', COACH);
    const stamped = mockState.updates.find((u) => u.payload && u.payload.error_message);
    expect(stamped).toBeTruthy();
    expect(String(stamped.payload.error_message)).toMatch(/bd-go4tl/);
  });

  test('the Urdu refusal stays gender-agnostic toward the coach', () => {
    const s = observeStrings('ur').resume_retry_exhausted;
    expect(s).not.toMatch(/آپ[^۔\n]{0,60}?(سکتی ہیں|چاہتی ہیں|کرتی ہیں|دیتی ہیں|رہی ہیں|چاہیں گی|کریں گی|دیں گی)/);
  });
});
