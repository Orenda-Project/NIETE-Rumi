/**
 * Exam checker: an old or idle exam session must not swallow the next message (bd-krhhgp).
 *
 * Prod, 21 Nov 2026 08:27 PKT: the operator sent "Hey" to the NIETE number and got
 * 'Send more exam images or tap "Process now" when ready.' + 'You have 0 images.' with
 * Add more / Process now. The log line (niete-logs 03:27:31Z):
 *   📝 Exam checker text received {"triggered":false,"hasSession":true,"textPreview":"Hey"}
 * His exam_check_sessions row was opened on 6 Aug 2026, status collecting_images, 0 images,
 * never touched again. ExamSessionService.getActive counted ANY row not completed/cancelled/error
 * as live, with no age limit (the Redis copy lasts 24 h, the Supabase fallback forever), and the
 * text handler sends every plain text to the exam checker while a session is live. His texts
 * since 6 Aug were all slash commands (which skip the checker), so "Hey" was the first to land.
 * 633 prod texts in 60 days were taken the same way ("Lesson plan", "Thanks", "Aoa", ...).
 *
 * Locked here:
 *   1. a session idle past its window is closed (cancelled) on the next look, and is not active;
 *   2. a fresh session still counts (the checker keeps working mid-collection);
 *   3. a greeting goes to the normal bot even mid-session; an empty session is closed by it;
 *   4. "You have 0 images" never offers "Process now", and Process now with 0 images runs no OCR.
 */

const MIN = 60 * 1000;
const NOW = Date.parse('2026-11-21T03:27:31Z');

// ---------- shared mocks ----------
const mockDb = { rows: [], updates: [] };
const mockRedis = { store: new Map(), deleted: [] };
const mockLogs = [];

function mockChain() {
  // A tiny PostgREST chain over mockDb.rows: select().eq().not().order().limit().single(),
  // update().eq().select().single(), insert().select().single().
  const st = { op: 'select', filters: [], patch: null, insert: null };
  const run = () => {
    if (st.op === 'insert') {
      const row = { id: `new-${mockDb.rows.length + 1}`, created_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString(), ...st.insert };
      mockDb.rows.push(row);
      return { data: row, error: null };
    }
    let rows = mockDb.rows.filter((r) => st.filters.every((f) => f(r)));
    if (st.op === 'update') {
      rows.forEach((r) => Object.assign(r, st.patch));
      mockDb.updates.push({ ids: rows.map((r) => r.id), patch: st.patch });
    }
    rows = rows.slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    return rows.length ? { data: { ...rows[0] }, error: null } : { data: null, error: { message: 'no rows' } };
  };
  const c = {
    select: () => c,
    insert: (v) => { st.op = 'insert'; st.insert = v; return c; },
    update: (v) => { st.op = 'update'; st.patch = v; return c; },
    eq: (k, v) => { st.filters.push((r) => r[k] === v); return c; },
    not: (k, _op, list) => {
      const vals = String(list).replace(/[()"]/g, '').split(',');
      st.filters.push((r) => !vals.includes(r[k]));
      return c;
    },
    in: (k, vals) => { st.filters.push((r) => vals.includes(r[k])); return c; },
    lt: () => c,
    order: () => c,
    limit: () => c,
    single: async () => run(),
    then: (res, rej) => Promise.resolve(run()).then(res, rej),
  };
  return c;
}

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn(() => mockChain()) }));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(async (k) => (mockRedis.store.has(k) ? JSON.parse(JSON.stringify(mockRedis.store.get(k))) : null)),
  set: jest.fn(async (k, v) => { mockRedis.store.set(k, JSON.parse(JSON.stringify(v))); return true; }),
  delete: jest.fn(async (k) => { mockRedis.deleted.push(k); mockRedis.store.delete(k); return true; }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn((msg, data) => mockLogs.push({ msg, ...(data || {}) })),
  logError: jest.fn(),
  logWarn: jest.fn(),
}));

const mockSent = [];
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async (to, text) => { mockSent.push({ kind: 'text', to, text }); return true; }),
  sendInteractiveButtons: jest.fn(async (to, payload) => { mockSent.push({ kind: 'buttons', to, payload }); return true; }),
  sendInteractiveMessage: jest.fn(async (to, payload) => { mockSent.push({ kind: 'interactive', to, payload }); return true; }),
  sendFlow: jest.fn(async () => true),
  startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })),
  downloadMedia: jest.fn(),
}));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadImageWithRetry: jest.fn() }));
// The barrel also loads OCR/grading (and the LLM SDK); the handler only needs these two.
jest.mock('../../bot/shared/services/exam-checker', () => ({
  ExamCheckerOrchestrator: jest.requireActual('../../bot/shared/services/exam-checker/exam-checker.orchestrator').ExamCheckerOrchestrator,
  ExamSessionService: jest.requireActual('../../bot/shared/services/exam-checker/exam-session.service'),
}));

const ExamSessionService = require('../../bot/shared/services/exam-checker/exam-session.service');
const { ExamCheckerOrchestrator } = require('../../bot/shared/services/exam-checker/exam-checker.orchestrator');
const ExamCheckerHandler = require('../../bot/shared/handlers/exam-checker.handler');

const USER = { id: '60530046-0000-0000-0000-000000000000' };
const REDIS_KEY = `exam_session:${USER.id}`;

function row(overrides = {}) {
  return {
    id: 'sess-6aug',
    user_id: USER.id,
    status: 'collecting_images',
    original_images: [],
    created_at: '2026-08-06T11:43:43.391644+00:00',
    updated_at: '2026-08-06T11:43:43.391644+00:00',
    ...overrides,
  };
}

function minutesAgo(m) { return new Date(NOW - m * MIN).toISOString(); }

const allButtonIds = (sent) => sent.flatMap((s) => (s.payload?.buttons || []).map((b) => b.id));

beforeEach(() => {
  mockDb.rows = [];
  mockDb.updates = [];
  mockRedis.store.clear();
  mockRedis.deleted = [];
  mockLogs.length = 0;
  mockSent.length = 0;
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => { jest.restoreAllMocks(); });

describe('ExamSessionService.getActive: an idle session is closed, not kept forever', () => {
  it('the 6 Aug collecting_images session (0 images) is NOT active on 21 Nov and is closed as cancelled', async () => {
    mockDb.rows.push(row());
    const active = await ExamSessionService.getActive(USER.id);
    expect(active).toBeNull();
    expect(mockDb.rows[0].status).toBe('cancelled');
    expect(mockLogs.some((l) => l.event === 'exam_checker.session_expired' && l.sessionId === 'sess-6aug')).toBe(true);
  });

  it('a stale copy in Redis is not trusted either: the session is closed and the cache cleared', async () => {
    mockDb.rows.push(row());
    mockRedis.store.set(REDIS_KEY, row());
    const active = await ExamSessionService.getActive(USER.id);
    expect(active).toBeNull();
    expect(mockRedis.store.has(REDIS_KEY)).toBe(false);
    expect(mockDb.rows[0].status).toBe('cancelled');
  });

  it('a Redis copy that looks old but whose DB row was just touched stays active (the DB row wins)', async () => {
    mockDb.rows.push(row({ updated_at: minutesAgo(2), original_images: [{ url: 'r2://a' }] }));
    mockRedis.store.set(REDIS_KEY, row({ updated_at: minutesAgo(300) }));
    const active = await ExamSessionService.getActive(USER.id);
    expect(active && active.id).toBe('sess-6aug');
    expect(mockDb.rows[0].status).toBe('collecting_images');
  });

  it('a session touched a few minutes ago is still active (mid-collection keeps working)', async () => {
    mockDb.rows.push(row({ updated_at: minutesAgo(5), original_images: [{ url: 'r2://a' }] }));
    const active = await ExamSessionService.getActive(USER.id);
    expect(active && active.id).toBe('sess-6aug');
    expect(mockDb.rows[0].status).toBe('collecting_images');
  });

  it('a session idle just past the waiting window is closed; just inside it is kept', async () => {
    const win = ExamSessionService.WAITING_IDLE_MS / MIN;
    mockDb.rows.push(row({ updated_at: minutesAgo(win - 1) }));
    expect(await ExamSessionService.getActive(USER.id)).not.toBeNull();
    mockDb.rows[0].updated_at = minutesAgo(win + 1);
    mockRedis.store.clear();
    expect(await ExamSessionService.getActive(USER.id)).toBeNull();
  });

  it('a processing session (OCR/grading) gets the longer window: 2 h old is kept, 2 days old is closed', async () => {
    mockDb.rows.push(row({ status: 'grading', updated_at: minutesAgo(120) }));
    expect(await ExamSessionService.getActive(USER.id)).not.toBeNull();
    mockDb.rows[0].updated_at = minutesAgo(2 * 24 * 60);
    mockRedis.store.clear();
    expect(await ExamSessionService.getActive(USER.id)).toBeNull();
  });

  it('getOrCreate on an idle session closes it and starts a fresh one', async () => {
    mockDb.rows.push(row({ status: 'detecting_questions', original_images: [{ url: 'r2://a' }] }));
    const s = await ExamSessionService.getOrCreate(USER.id);
    expect(s.id).not.toBe('sess-6aug');
    expect(s.status).toBe('collecting_images');
    expect(mockDb.rows.find((r) => r.id === 'sess-6aug').status).toBe('cancelled');
  });

  it('adding an image refreshes updated_at in the Redis copy too, so an active collection never looks idle', async () => {
    mockDb.rows.push(row({ updated_at: minutesAgo(30) }));
    await ExamSessionService.addImage('sess-6aug', 'r2://new');
    const cached = mockRedis.store.get(REDIS_KEY);
    // The old code copied the row's previous updated_at (30 min ago) into the cache.
    expect(Date.parse(cached.updated_at)).toBeGreaterThan(Date.parse(minutesAgo(30)));
  });
});

describe('exam-checker.handler handleExamText: the operator\'s "Hey"', () => {
  const msg = (body) => ({ id: 'wamid.x', text: { body } });

  it('with the 6 Aug session open, "Hey" is NOT handled by the exam checker (normal routing answers)', async () => {
    mockDb.rows.push(row());
    const r = await ExamCheckerHandler.handleExamText(msg('Hey'), '92300', USER);
    expect(r).toBeNull();
    expect(mockSent).toHaveLength(0);
  });

  it('any plain text after the idle window goes to normal routing ("Lesson plan")', async () => {
    mockDb.rows.push(row({ updated_at: minutesAgo(3 * 60), original_images: [{ url: 'r2://a' }] }));
    const r = await ExamCheckerHandler.handleExamText(msg('Lesson plan'), '92300', USER);
    expect(r).toBeNull();
    expect(mockSent).toHaveLength(0);
  });

  it('a greeting in a FRESH empty session also goes to normal routing, and closes the empty session', async () => {
    mockDb.rows.push(row({ updated_at: minutesAgo(1) }));
    const r = await ExamCheckerHandler.handleExamText(msg('Assalam o alaikum'), '92300', USER);
    expect(r).toBeNull();
    expect(mockSent).toHaveLength(0);
    expect(mockDb.rows[0].status).toBe('cancelled');
  });

  it('a greeting in a fresh session that holds images goes to normal routing but keeps the images', async () => {
    mockDb.rows.push(row({ updated_at: minutesAgo(1), original_images: [{ url: 'r2://a' }, { url: 'r2://b' }] }));
    const r = await ExamCheckerHandler.handleExamText(msg('hi'), '92300', USER);
    expect(r).toBeNull();
    expect(mockDb.rows[0].status).toBe('collecting_images');
  });

  it('"check exams" still starts the exam checker', async () => {
    const r = await ExamCheckerHandler.handleExamText(msg('check exams'), '92300', USER);
    expect(r).toEqual({ handled: true });
    expect(mockDb.rows).toHaveLength(1);
  });
});

describe('orchestrator: "You have 0 images" never offers Process now', () => {
  it('a text in an empty collecting_images session asks for photos, with no Process now button', async () => {
    mockDb.rows.push(row({ updated_at: minutesAgo(1) }));
    const res = await ExamCheckerOrchestrator.process({ type: 'text', text: 'what now' }, USER.id);
    const ids = (res.interactive?.action?.buttons || []).map((b) => b.reply.id);
    expect(ids).not.toContain('ech_process_now');
    expect(JSON.stringify(res)).not.toMatch(/0 images/);
  });

  it('a Process now tap with 0 images runs no OCR and does not move the session to processing', async () => {
    mockDb.rows.push(row({ updated_at: minutesAgo(1) }));
    const ocr = jest.spyOn(ExamCheckerOrchestrator, 'handleOCRProcessing');
    const res = await ExamCheckerOrchestrator.process({ type: 'button', buttonId: 'ech_process_now' }, USER.id);
    expect(ocr).not.toHaveBeenCalled();
    expect(mockDb.rows[0].status).toBe('collecting_images');
    const ids = (res.interactive?.action?.buttons || []).map((b) => b.reply.id);
    expect(ids).not.toContain('ech_process_now');
  });

  it('with images in hand, a text still offers Add more / Process now (unchanged)', async () => {
    mockDb.rows.push(row({ updated_at: minutesAgo(1), original_images: [{ url: 'r2://a' }, { url: 'r2://b' }] }));
    const res = await ExamCheckerOrchestrator.process({ type: 'text', text: 'ok' }, USER.id);
    const ids = (res.interactive?.action?.buttons || []).map((b) => b.reply.id);
    expect(ids).toEqual(['ech_add_more', 'ech_process_now']);
    expect(res.interactive.body.text).toMatch(/2 images/);
  });

  it('the handler path for an empty session never sends a Process now button', async () => {
    mockDb.rows.push(row({ updated_at: minutesAgo(1) }));
    await ExamCheckerHandler.handleExamText({ id: 'w', text: { body: 'what do I do' } }, '92300', USER);
    expect(allButtonIds(mockSent)).not.toContain('ech_process_now');
  });
});
