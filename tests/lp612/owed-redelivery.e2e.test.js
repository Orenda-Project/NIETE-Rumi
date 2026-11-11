'use strict';
/**
 * E2E — bd-s8mi25: a teacher whose PDF send was cut off by a dying container still gets it.
 *
 * The worker flips the row to ready, claims the waiter list (emptying it), then sends. When the
 * container died inside that send, SQS redelivered the job, the retry saw a ready row and skipped
 * it ("render not in flight"), and the teacher who tapped never got her PDF. Nothing else held
 * her name: the claim had emptied the list.
 *
 * Driven the way a teacher drives it: `Serving.requestLesson`, then the queued job through
 * `Worker.process`. The first run's send never returns (the container is gone); the same job then
 * arrives again, as SQS redelivers it. Doubled: the network (model SDK, R2, PostgREST, SQS, Meta,
 * Redis), the out-of-process renderer and the deliveries table.
 */

const mockCreate = jest.fn();
jest.mock('openai', () => function OpenAI() {
  return { chat: { completions: { create: (...args) => mockCreate(...args) } } };
});
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn(async () => 'ok'),
  downloadFromR2: jest.fn(),
  buildR2PublicUrl: (k) => `https://r2.test/${k}`,
  getPresignedUrl: jest.fn(async (u) => `${u}?signed=1`),
}));
const mockQueued = [];
jest.mock('../../bot/shared/services/queue', () => ({
  queueJob: jest.fn(async (g, t, payload) => { mockQueued.push(payload); return { ok: true }; }),
}));
jest.mock('../../bot/shared/config/supabase', () => require('./helpers/lp612-db-double').db);
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => ({ ok: true })),
  sendDocument: jest.fn(async () => ({ ok: true })),
  sendDocumentByLink: jest.fn(async () => ({ ok: true })),
}));
const mockRedis = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  set: jest.fn(async (k, v) => { mockRedis.set(k, JSON.stringify(v)); return true; }),
  get: jest.fn(async (k) => (mockRedis.has(k) ? JSON.parse(mockRedis.get(k)) : null)),
  delete: jest.fn(async (k) => { mockRedis.delete(k); return true; }),
}));
const mockDelivered = [];
jest.mock('../../bot/shared/services/lp612-deliveries.store', () => ({
  record: jest.fn(async (r) => { mockDelivered.push(r); return true; }),
  claimsRender: jest.fn(async (renderId, userId) =>
    mockDelivered.some((d) => d.renderId === renderId && d.userId === userId)),
  recentForTeacher: jest.fn(async () => []),
  byIdForTeacher: jest.fn(async () => null),
  portalRenderIds: jest.fn(async () => []),
  sentSegmentIds: jest.fn(async () => new Set()),
}));
const mockRendered = { pdfPath: null };
jest.mock('../../bot/shared/services/lp612-render.service', () => ({
  renderLessonPlan: jest.fn(async ({ lpDoc }) => ({
    pdfPath: mockRendered.pdfPath, htmlPath: mockRendered.pdfPath, pageCount: 4, warnings: [],
    pagesByPart: { teach: 2, support: 2 },
    overlayApplied: Object.keys((lpDoc && lpDoc.ur_overlay) || {}),
  })),
}));

const { reset, state } = require('./helpers/lp612-db-double');
const { downloadFromR2 } = require('../../bot/shared/storage/r2');
const WhatsApp = require('../../bot/shared/services/whatsapp.service');
const H = require('./helpers/overlay-chrome-e2e');
const Serving = require('../../bot/shared/services/lp612-serving.service');
const Worker = require('../../bot/workers/lp612-author.worker');

const tree = H.installFixtureTree();
const PHONE = '923001234567';
const TAP = {
  segmentId: H.SEG_ID, userId: 'teacher-1', phone: PHONE,
  lang: 'ur', uiLang: 'ur', correlationId: 'tap-1', surface: 'whatsapp',
};
const pdfsTo = (phone) => WhatsApp.sendDocumentByLink.mock.calls.filter(([to]) => String(to).endsWith(phone.slice(-10)));
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  jest.clearAllMocks();
  mockQueued.length = 0;
  mockDelivered.length = 0;
  mockRedis.clear();
  reset([H.SEGMENT]);
  mockRendered.pdfPath = tree.pdfPath;
  H.installLlm(mockCreate);
  process.env.LP_612_TEMPLATE_VERSION = 'v9.6';
  downloadFromR2.mockImplementation(async (key) => {
    throw Object.assign(new Error(`NoSuchKey: ${key}`), { name: 'NoSuchKey' });
  });
});
afterEach(() => { delete process.env.LP_612_TEMPLATE_VERSION; });

/** The tap parks her on the row; the double's claim RPC hands back whatever the row holds. */
async function tap() {
  await Serving.requestLesson(TAP);
  state.waiters = state.renders[0].waiters;
  return mockQueued[0];
}

/** First run: the send to her never returns — the container died inside it. */
async function tapAndDieMidSend() {
  const job = await tap();
  let reachedSend;
  const atSend = new Promise((r) => { reachedSend = r; });
  WhatsApp.sendDocumentByLink.mockImplementationOnce(() => { reachedSend(); return new Promise(() => {}); });
  Worker.process(job); // never settles
  await atSend;
  await flush();
  return job;
}

test('the retry SQS delivers after a mid-send death sends her the PDF', async () => {
  const job = await tapAndDieMidSend();
  expect(state.renders[0].status).toBe('ready');
  expect(mockDelivered).toHaveLength(0);

  const out = await Worker.process(job);

  expect(out.status).toBe('redelivered');
  expect(out.delivered).toBe(1);
  expect(pdfsTo(PHONE)).toHaveLength(2); // the cut-off send, then the one that landed
  expect(mockDelivered.map((d) => d.userId)).toEqual(['teacher-1']);
  expect([...mockRedis.keys()].filter((k) => k.startsWith("lp612:owed:"))).toEqual([]);
});

test('a third delivery of the same job sends nothing more', async () => {
  const job = await tapAndDieMidSend();
  await Worker.process(job);
  WhatsApp.sendDocumentByLink.mockClear();

  const out = await Worker.process(job);

  expect(out.status).not.toBe('redelivered');
  expect(WhatsApp.sendDocumentByLink).not.toHaveBeenCalled();
});

test('a job that finished cleanly is not re-sent when SQS delivers it twice', async () => {
  const job = await tap();
  expect((await Worker.process(job)).status).toBe('ready');
  WhatsApp.sendDocumentByLink.mockClear();

  await Worker.process(job);

  expect(WhatsApp.sendDocumentByLink).not.toHaveBeenCalled();
});
