'use strict';
/**
 * bd-4joiqz (second commit) — a LEADER asking for a grade 6-12 plan in the portal is not a teacher's ask.
 *
 * The portal sends a leader's ask with `reader: 'leader'` (it decides the role from `users`). The bot then:
 *
 *   KEEPS   the leader's claim on the render (niete_lp612_deliveries, surface portal): /status and /file are answered
 *           only to a user with a claim, so without it the leader could not read the lesson they asked for
 *   WRITES  no lesson_plan_requests row: not at a cache hit (recordPortalReady), not for an ask that ends there
 *           (recordRequestOutcome), not when the worker finishes or fails a render they wait on
 *
 * A teacher's ask is unchanged.
 *
 * Driven through the REAL internal route, the REAL serving module, deliveries store, lifecycle writer and worker;
 * faked: Supabase (stateful, in memory), the 6-12 catalogue, WhatsApp, R2, the LLM author and renderer, the logs.
 */

const mockSegmentById = jest.fn();
const mockAuthorLessonPlan = jest.fn();
const mockRenderLessonPlan = jest.fn();
const mockReadFile = jest.fn();

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocumentByLink: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({ pushToShelf: jest.fn(), getDeliveryType: () => 'segment' }));
jest.mock('../../bot/shared/services/lp612-feedback.service', () => ({ scheduleFeedbackPrompt: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('ok'),
  getPresignedUrl: jest.fn().mockResolvedValue('https://signed.example/x.pdf'),
  buildR2PublicUrl: (k) => `https://r2.example/${k}`,
}));
jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({ segmentById: (...a) => mockSegmentById(...a) }));
jest.mock('../../bot/shared/services/lp612-author.service', () => ({ authorLessonPlan: (...a) => mockAuthorLessonPlan(...a) }));
jest.mock('../../bot/shared/services/lp612-render.service', () => ({ renderLessonPlan: (...a) => mockRenderLessonPlan(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => undefined }));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: { ...jest.requireActual('fs').promises, readFile: (...a) => mockReadFile(...a) },
}));

const { createMemorySupabase } = require('../quiz/helpers/memory-supabase');

let mockDb;
let mockJoined = [];
let mockClaimed = [];
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (t) => mockDb.from(t),
  rpc: (...a) => mockDb.rpc(...a),
}));

const KEY = 'internal-test-key';
process.env.INTERNAL_API_KEY = KEY;

const Serving = require('../../bot/shared/services/lp612-serving.service');
const Lp612Lifecycle = require('../../bot/shared/services/lp612-lifecycle.service');
const Worker = require('../../bot/workers/lp612-author.worker');
const router = require('../../bot/shared/routes/internal-api.routes');
const { templateVersion } = require('../../bot/shared/config/lp612-flags');

const SEGMENT = {
  segment_id: 'grade_8_mathematics.c05.p071-073', book_stem: 'grade_8_mathematics', chapter_key: 'c05', grade: 8,
  subject: 'Mathematics', chapter_number: 5, chapter_title: 'Sets', subtopic_title: 'Set-builder notation',
  menu_title: 'Sets & notation', printed_page_start: 71, printed_page_end: 73, is_religious: false, language: 'en',
};
const RENDER = '22222222-2222-4222-8222-222222222222';
const LEADER = '66666666-6666-4666-8666-666666666666';
const TEACHER = '44444444-4444-4444-8444-444444444444';
const USERS = [
  { id: LEADER, role: 'coach', phone_number: '923005550006', preferred_language: 'en' },
  { id: TEACHER, role: 'teacher', phone_number: '923005550000', preferred_language: 'en' },
];

const READY = () => ({
  id: RENDER, segment_id: SEGMENT.segment_id, lang: 'en', template_version: templateVersion(), status: 'ready',
  r2_key: Serving.r2KeyFor(SEGMENT.segment_id, 'en', templateVersion()), one_screen: 'x', waiters: [],
});
const rows = (t) => mockDb.table(t);

function findRoute(method, path) {
  for (const layer of router.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  throw new Error(`route ${method.toUpperCase()} ${path} not found`);
}
/** POST /lp612/request through the real middleware + handler — what the portal calls. */
async function ask(body) {
  const stack = findRoute('post', '/lp612/request');
  const req = { headers: { 'x-api-key': KEY }, body, ip: '127.0.0.1', method: 'POST', path: '/lp612/request' };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  for (const handler of stack) {
    let next = false;
    // eslint-disable-next-line no-await-in-loop
    await handler(req, res, () => { next = true; });
    if (!next) break;
  }
  return { statusCode, payload };
}

const ENV_KEYS = ['LP_LIFECYCLE_PATHS', 'REGION', 'LP_612_RELIGIOUS_ENABLED'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  // The lifecycle is ON throughout: a leader's missing row is a real absence, a teacher's row a real presence.
  process.env.LP_LIFECYCLE_PATHS = 'niete_lp612';
  process.env.REGION = 'niete';
  delete process.env.LP_612_RELIGIOUS_ENABLED;
  jest.clearAllMocks();
  mockJoined = [];
  mockClaimed = [];
  mockDb = createMemorySupabase(
    { niete_lp612_deliveries: [], lesson_plan_requests: [], niete_lp612_renders: [READY()], niete_lp612_segments: [SEGMENT], users: USERS },
    { rpc: {
      lp612_join_waiters: (args) => { mockJoined.push(args.p_entry); return 'joined'; },
      lp612_claim_waiters: () => ({ data: mockClaimed, error: null }),
    } },
  );
  require('../../bot/shared/services/lp612-deliveries.store').__resetForTests();
  mockSegmentById.mockResolvedValue(SEGMENT);
  mockReadFile.mockResolvedValue(Buffer.from('%PDF-1.7 fake'));
  mockAuthorLessonPlan.mockResolvedValue({
    lpDoc: { lesson_id: 'x', one_screen: 'a summary' }, lintClean: true, fails: [], rounds: 2,
    model: 'anthropic/claude-sonnet-5', family: 'maths', tier: 'standard',
  });
  mockRenderLessonPlan.mockResolvedValue({ pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html', pageCount: 9, warnings: [], overlayApplied: [] });
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

describe('a portal cache hit, through POST /lp612/request', () => {
  test('a LEADER: their claim is written (so /status and /file answer them) — and NO lifecycle row', async () => {
    const { statusCode, payload } = await ask({ segmentId: SEGMENT.segment_id, userId: LEADER, lang: 'en', reader: 'leader' });
    expect(statusCode).toBe(202);
    expect(payload).toEqual(expect.objectContaining({ success: true, state: 'ready', renderId: RENDER }));
    const claims = rows('niete_lp612_deliveries');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toEqual(expect.objectContaining({ user_id: LEADER, render_id: RENDER, surface: 'portal' }));
    expect(claims[0]).not.toHaveProperty('request_id');
    expect(rows('lesson_plan_requests')).toHaveLength(0);
  });

  test('a TEACHER: exactly today — one completed lifecycle row, and her claim names it (golden)', async () => {
    const { statusCode } = await ask({ segmentId: SEGMENT.segment_id, userId: TEACHER, lang: 'en' });
    expect(statusCode).toBe(202);
    const asks = rows('lesson_plan_requests');
    expect(asks).toHaveLength(1);
    expect(asks[0]).toEqual(expect.objectContaining({ user_id: TEACHER, channel: 'portal', status: 'completed' }));
    expect(rows('niete_lp612_deliveries')[0]).toEqual(expect.objectContaining({ user_id: TEACHER, request_id: asks[0].id }));
  });
});

describe('a leader\'s ask that ends there, or that waits on a render', () => {
  test('a held (religious) segment: 403 as for anyone — and no failed lifecycle row for the leader', async () => {
    mockSegmentById.mockResolvedValue({ ...SEGMENT, is_religious: true });
    const { statusCode } = await ask({ segmentId: SEGMENT.segment_id, userId: LEADER, lang: 'en', reader: 'leader' });
    expect(statusCode).toBe(403);
    expect(rows('lesson_plan_requests')).toHaveLength(0);
  });

  test('a leader who joins a render being written carries reader "leader" on their waiter entry', async () => {
    await Serving.joinWaiters(RENDER, { userId: LEADER, phone: null, uiLang: 'en', surface: 'portal', correlationId: 'c-1', reader: 'leader' });
    expect(mockJoined[0]).toEqual(expect.objectContaining({ user_id: LEADER, surface: 'portal', reader: 'leader' }));
  });

  test('the worker finishes the render a leader waits on: their claim is written, no lifecycle row', async () => {
    mockDb.tables.niete_lp612_renders = [{ id: RENDER, segment_id: SEGMENT.segment_id, lang: 'en', template_version: 'v9.7', status: 'authoring', waiters: [] }];
    mockClaimed = [{ user_id: LEADER, phone: null, ui_lang: 'en', surface: 'portal', reader: 'leader', requested_at: '2026-10-22T05:00:00.000Z' }];
    await Worker.process({ renderId: RENDER, segmentId: SEGMENT.segment_id, lang: 'en', templateVersion: 'v9.7', correlationId: 'job-1' });
    expect(rows('niete_lp612_renders')[0].status).toBe('ready');
    const [claim] = rows('niete_lp612_deliveries');
    expect(claim).toEqual(expect.objectContaining({ user_id: LEADER, surface: 'portal' }));
    expect(claim).not.toHaveProperty('request_id');
    expect(rows('lesson_plan_requests')).toHaveLength(0);
  });

  test('a failed render: a failed row for the teacher waiting on it, none for the leader', async () => {
    const n = await Lp612Lifecycle.recordWaitersFailed({
      waiters: [
        { user_id: LEADER, phone: null, ui_lang: 'en', surface: 'portal', reader: 'leader', requested_at: '2026-10-22T05:00:00.000Z' },
        { user_id: TEACHER, phone: null, ui_lang: 'en', surface: 'portal', requested_at: '2026-10-22T05:01:00.000Z' },
      ],
      segment: SEGMENT, segmentId: SEGMENT.segment_id, lang: 'en', code: 'RENDER_FAILED', detail: 'x',
    });
    expect(n).toBe(1);
    expect(rows('lesson_plan_requests').map((r) => r.user_id)).toEqual([TEACHER]);
  });
});
