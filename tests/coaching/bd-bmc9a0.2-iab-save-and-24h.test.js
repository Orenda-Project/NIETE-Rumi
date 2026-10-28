'use strict';
/**
 * bd-bmc9a0.2 — ICT IAB Experience View rows 31 + 32.
 *
 *   Row 31  "Save recording": the teacher saves her class recording in the app (IAB) and comes back later for the
 *           reflection and feedback. Saving starts the same server-side DC observation Submit does, so the recording
 *           can never be lost; the row carries conversation_state.saved_for_later_at.
 *   Row 32  An IAB lesson she never reflects on reaches her chat 24 hours later, with ICT's line
 *           "You did not reflect on this lesson, but here is your feedback report." Behind the app_settings switch
 *           dc_iab_unreflected_report_24h (fail closed): off, every session keeps today's 12-hour auto-complete.
 *
 * Only the network edges are mocked: the Supabase client is the in-memory fake that applies filters, and WhatsApp
 * and the queue record what would have left. The sweep, its thresholds, the switch read and the caption choice run
 * for real.
 */

const { createFakeSupabase } = require('../fixtures/fake-supabase');

const mockDb = { current: null };
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (t) => mockDb.current.from(t),
}));

const mockSends = [];
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendInteractiveButtons: jest.fn(async (to, options) => { mockSends.push({ kind: 'buttons', to, options }); return true; }),
  sendMessage: jest.fn(async (to, text) => { mockSends.push({ kind: 'text', to, text }); return true; }),
}));

const mockQueued = [];
jest.mock('../../bot/shared/services/queue', () => ({
  queueCoachingJob: jest.fn(async (sessionId, jobType, payload) => { mockQueued.push({ sessionId, jobType, payload }); return 'msg-1'; }),
}));

const HOUR = 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const TEACHER = { name: 'Test Teacher', phone_number: '000000000001' };
const SWITCH = 'dc_iab_unreflected_report_24h';

const PORTAL_AUDIO = 'https://r2.example/digital-coach-audio/classroom_audio/user-a/2026-10/portal_abc123.m4a';
const WHATSAPP_AUDIO = 'https://r2.example/digital-coach-audio/classroom_audio/user-b/2026-10/683335f3_1790852380454.ogg';

function waiting(id, idleMs, extra = {}) {
  return {
    id,
    user_id: `user-${id}`,
    status: 'conducting_conversation',
    audio_url: WHATSAPP_AUDIO,
    observation_type: null,
    conversation_state: { last_interaction: ago(idleMs), questions_answered: 0 },
    transcript_text: null,
    analysis_data: {},
    lesson_plan_text: null,
    reminder_sent_at: null,
    created_at: ago(idleMs + HOUR),
    users: TEACHER,
    ...extra,
  };
}
const iab = (id, idleMs, extra = {}) => waiting(id, idleMs, { audio_url: PORTAL_AUDIO, ...extra });

function seed(sessions, switchValue) {
  const app_settings = switchValue === undefined ? [] : [{ key: SWITCH, value: switchValue }];
  mockDb.current = createFakeSupabase({ coaching_sessions: sessions, app_settings });
}
const row = (id) => mockDb.current._tables.coaching_sessions.find((r) => r.id === id);
const reportJobs = () => mockQueued.filter((q) => q.jobType === 'report_generation');

let Stale;
beforeEach(() => {
  mockSends.length = 0;
  mockQueued.length = 0;
  jest.clearAllMocks();
  // A fresh module graph per test: the switch is cached for 30 s inside a process.
  jest.isolateModules(() => { Stale = require('../../bot/workers/stale-session.worker'); });
});

describe('row 32 — switch ON: an IAB lesson she never reflected on waits 24 hours, then goes to her chat', () => {
  test('13 hours idle: NOT auto-completed (WhatsApp would be), still waiting for her', async () => {
    seed([iab('p13', 13 * HOUR, { reminder_sent_at: ago(11 * HOUR) })], true);
    await Stale.processStaleCoachingSessions();
    expect(reportJobs()).toHaveLength(0);
    expect(row('p13').status).toBe('conducting_conversation');
  });

  test('25 hours idle: auto-completed, the report queued once, the row marked as the IAB 24-hour send', async () => {
    seed([iab('p25', 25 * HOUR, { reminder_sent_at: ago(23 * HOUR) })], true);
    await Stale.processStaleCoachingSessions();
    expect(reportJobs()).toHaveLength(1);
    expect(reportJobs()[0].payload).toMatchObject({ autoCompleted: true });
    expect(row('p25').status).toBe('generating_report');
    expect(row('p25').conversation_state).toMatchObject({ auto_completed: true, auto_completed_via: 'iab_24h' });
  });

  test('a WhatsApp-recorded lesson keeps its 12 hours, with no IAB mark', async () => {
    seed([waiting('w13', 13 * HOUR, { reminder_sent_at: ago(11 * HOUR) })], true);
    await Stale.processStaleCoachingSessions();
    expect(reportJobs()).toHaveLength(1);
    expect(row('w13').conversation_state.auto_completed_via).toBeUndefined();
  });

  test("a coach's portal observation is not a teacher's IAB lesson: 12 hours, as today", async () => {
    seed([iab('obs', 13 * HOUR, { observation_type: 'leader_observation', reminder_sent_at: ago(11 * HOUR) })], true);
    await Stale.processStaleCoachingSessions();
    expect(reportJobs()).toHaveLength(1);
    expect(row('obs').conversation_state.auto_completed_via).toBeUndefined();
  });

  test('the 2-hour reminder is unchanged for an IAB lesson', async () => {
    seed([iab('p3', 3 * HOUR)], true);
    await Stale.processStaleCoachingSessions();
    expect(mockSends.filter((s) => s.kind === 'buttons')).toHaveLength(1);
    expect(reportJobs()).toHaveLength(0);
  });

  test('an IAB lesson 13 hours idle and never reminded is reminded (it is not yet due for its report)', async () => {
    seed([iab('p13r', 13 * HOUR)], true);
    await Stale.processStaleCoachingSessions();
    expect(mockSends.filter((s) => s.kind === 'buttons')).toHaveLength(1);
    expect(reportJobs()).toHaveLength(0);
  });

  test('the string "true" turns it on as well (app_settings values arrive both ways)', async () => {
    seed([iab('p13s', 13 * HOUR, { reminder_sent_at: ago(11 * HOUR) })], 'true');
    await Stale.processStaleCoachingSessions();
    expect(reportJobs()).toHaveLength(0);
  });
});

describe('row 32 — switch OFF, absent or unreadable: exactly today (12 hours for everyone)', () => {
  test.each([
    ['no row', undefined],
    ['false', false],
    ['a stray value', 'yes'],
  ])('%s → an IAB lesson 13 hours idle is auto-completed at 12 hours, unmarked', async (_n, value) => {
    seed([iab('p13off', 13 * HOUR, { reminder_sent_at: ago(11 * HOUR) })], value);
    await Stale.processStaleCoachingSessions();
    expect(reportJobs()).toHaveLength(1);
    expect(row('p13off').conversation_state.auto_completed_via).toBeUndefined();
  });

  test('a failed switch read is OFF', async () => {
    seed([iab('p13err', 13 * HOUR, { reminder_sent_at: ago(11 * HOUR) })], true);
    const realFrom = mockDb.current.from;
    mockDb.current.from = (t) => {
      if (t === 'app_settings') throw new Error('db down');
      return realFrom(t);
    };
    await Stale.processStaleCoachingSessions();
    expect(reportJobs()).toHaveLength(1);
  });
});

describe('row 32 — the line on her report', () => {
  const EN = 'You did not reflect on this lesson, but here is your feedback report.';
  // ICT's mockup text, word for word; the Latin «Reflection» is isolated (LRI … PDI) inside the Urdu line.
  const UR_PLAIN = 'آپ نے اس سبق پر Reflection نہیں کیا، لیکن یہ رہی آپ کی فیڈ بیک رپورٹ۔';
  const strip = (s) => s.replace(/[⁦-⁩]/g, '');

  let Report;
  beforeAll(() => { Report = require('../../bot/shared/services/coaching/report-generator.service'); });

  const lesson = (state = {}) => ({
    audio_url: PORTAL_AUDIO,
    observation_type: null,
    users: TEACHER,
    _questionsAtCompletion: 0,
    conversation_state: { questions_answered: 0, ...state },
  });

  test('English: the auto-complete line is ICT\'s sentence', () => {
    const lines = Report._heroCaptionLines(lesson({ auto_completed_via: 'iab_24h' }), { isAutoCompleted: true, isRetry: true, language: 'en' });
    expect(lines).toEqual([{ key: 'autoComplete', text: EN }]);
  });

  test('Urdu: ICT\'s mockup sentence, with Reflection isolated', () => {
    const [line] = Report._heroCaptionLines(lesson({ auto_completed_via: 'iab_24h' }), { isAutoCompleted: true, isRetry: true, language: 'ur' });
    expect(line.key).toBe('autoComplete');
    expect(strip(line.text)).toBe(UR_PLAIN);
    expect(line.text).toContain('⁦Reflection⁩');
  });

  test('any other auto-complete keeps today\'s line', () => {
    const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');
    const [line] = Report._heroCaptionLines(lesson(), { isAutoCompleted: true, isRetry: true, language: 'en' });
    expect(line.text).toBe(getCoachingMessage('reportCaption_autoCompletedAudioOnly', 'en'));
  });

  test('both lines fit the 1,024 code-point caption with room to spare', () => {
    const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');
    for (const lang of ['en', 'ur']) {
      expect([...getCoachingMessage('reportCaption_notReflected', lang)].length).toBeLessThan(120);
    }
  });
});

// ── row 31: saving marks the row ────────────────────────────────────────────

const SERVICE = '../../bot/shared/services/coaching/portal-coaching.service';
const USER = '1ff9fc2e-9b4a-48d4-94f3-312ad52df81b';
const KEY = `classroom_audio/${USER}/2026-10/portal_abc123.webm`;

function serviceDeps() {
  const inserts = [];
  const from = (table) => {
    const q = {};
    q.select = () => q; q.eq = () => q; q.order = () => q; q.limit = () => q;
    q.insert = (r) => { inserts.push({ table, row: r }); q._inserted = r; return q; };
    q.update = () => q;
    q.single = async () => (q._inserted
      ? { data: { id: 'cs-new', ...q._inserted }, error: null }
      : { data: table === 'users' ? { id: USER, phone_number: '000000000002' } : null, error: null });
    q.maybeSingle = async () => ({ data: null, error: null });
    q.then = (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej);
    return q;
  };
  return {
    inserts,
    supabase: { from },
    library: { resolveAsset: jest.fn(), readyRender: jest.fn(), link: jest.fn(), recent: jest.fn() },
    log: jest.fn(),
    r2: { getPresignedUploadUrl: jest.fn(), headObject: jest.fn().mockResolvedValue({ exists: true, sizeBytes: 1000 }), buildR2PublicUrl: (k) => `https://r2.example/${k}` },
    queue: { queueTranscription: jest.fn().mockResolvedValue('m') },
    reflective: {}, getUserLanguage: jest.fn().mockResolvedValue('en'),
    now: () => new Date('2026-10-28T08:00:00Z'), newId: () => 'abc123',
  };
}
const inserted = (d) => d.inserts.find((w) => w.table === 'coaching_sessions').row;

describe('row 31 — Save recording starts the DC observation and marks it saved', () => {
  let Svc;
  beforeEach(() => { jest.resetModules(); Svc = require(SERVICE); });

  test('saveForLater:true → the session starts as Submit\'s does, with saved_for_later_at', async () => {
    const d = serviceDeps();
    const out = await Svc.startPortalSession({ userId: USER, key: KEY, saveForLater: true }, d);
    expect(out).toEqual({ status: 'ok', coachingSessionId: 'cs-new' });
    expect(d.queue.queueTranscription).toHaveBeenCalledTimes(1);
    expect(inserted(d).status).toBe('confirmed');
    expect(inserted(d).conversation_state).toMatchObject({ current_state: 'TRANSCRIBING', saved_for_later_at: '2026-10-28T08:00:00.000Z' });
  });

  test.each([['absent', undefined], ['false', false], ['a truthy non-boolean', 'yes']])('saveForLater %s → no mark (Submit, byte for byte)', async (_n, v) => {
    const d = serviceDeps();
    await Svc.startPortalSession({ userId: USER, key: KEY, ...(v === undefined ? {} : { saveForLater: v }) }, d);
    expect('saved_for_later_at' in inserted(d).conversation_state).toBe(false);
  });
});

describe('row 31 — the flag travels portal → bot', () => {
  test('the bot\'s /coaching/start passes saveForLater to the service', async () => {
    jest.resetModules();
    process.env.INTERNAL_API_KEY = 'secret';
    const svc = { presignUpload: jest.fn(), startPortalSession: jest.fn().mockResolvedValue({ status: 'ok', coachingSessionId: 'cs-1' }), submitReflection: jest.fn(), recentLessonPlans: jest.fn() };
    jest.doMock(SERVICE, () => svc);
    const router = require('../../bot/shared/routes/internal-api.routes');
    const layer = router.stack.find((l) => l.route && l.route.path === '/coaching/start' && l.route.methods.post);
    const handlers = layer.route.stack.map((s) => s.handle);
    const req = { body: { userId: 'u1', key: 'k', saveForLater: true }, headers: { 'x-api-key': 'secret' }, path: '/coaching/start', ip: '127.0.0.1' };
    await new Promise((resolve) => {
      const res = { status() { return this; }, json() { resolve(); return this; } };
      const run = (i) => handlers[i](req, res, () => run(i + 1));
      run(0);
    });
    expect(svc.startPortalSession).toHaveBeenCalledWith(expect.objectContaining({ saveForLater: true }));
    jest.dontMock(SERVICE);
  });

  test('the portal\'s bot client forwards saveForLater in the start body', async () => {
    jest.resetModules();
    process.env.MAIN_BOT_URL = 'https://bot.example';
    process.env.INTERNAL_API_KEY = 'secret';
    const post = jest.fn().mockResolvedValue({ status: 200, data: { success: true } });
    jest.doMock('axios', () => ({ post }));
    const client = require('../../dashboard/services/portal-coaching.client');
    await client.startSession({ userId: 'u1', key: 'k', saveForLater: true });
    expect(post).toHaveBeenCalledWith('https://bot.example/api/internal/coaching/start',
      expect.objectContaining({ userId: 'u1', key: 'k', saveForLater: true }), expect.anything());
    jest.dontMock('axios');
  });
});
