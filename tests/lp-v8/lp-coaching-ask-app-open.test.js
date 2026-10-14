'use strict';
/**
 * The coaching ask follows a K-5 lesson plan read in the teacher app.
 *
 * The ask ("would you like this lesson recorded and coached?") was booked only by the WhatsApp
 * delivery path (lp-v8-delivery → LpCoachingAsk.onLessonDelivered). Since the app took over plan
 * reading, a plan read in the app's viewer booked nothing, and the ask all but stopped.
 *
 * The portal already tells the bot about every recorded viewer open (POST /api/internal/lp/
 * open-survey with the open's id). That same call now also books THE SAME ask through THE SAME
 * service — same teacher_nudges row, same once-a-day UNIQUE, same 14:00 rule, same send.
 *
 * Driven through the REAL internal route, the REAL survey + coaching-ask services and the REAL
 * nudges store; only the network is faked (WhatsApp; Supabase and the cache in memory, the
 * teacher_nudges UNIQUE (user_id, nudge_date, kind) enforced as the table does).
 */

const { PassThrough } = require('stream');
const { createMemorySupabase, createMemoryRedis } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase({}, { unique: { teacher_nudges: ['user_id', 'nudge_date', 'kind'] } });
const mockRedis = createMemoryRedis();
jest.mock('../../bot/shared/config/supabase', () => mockDb);
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/storage/r2', () => ({
  buildR2PublicUrl: jest.fn((k) => `https://s3.example/bucket/${k}`),
  getPresignedUrl: jest.fn(async (u) => `${u}?sig=1`),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocumentByLink: jest.fn().mockResolvedValue({ messages: [{ id: 'wamid.DOC' }] }),
  sendVoicenoteFromR2Key: jest.fn().mockResolvedValue(false),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendVideoWithButtons: jest.fn().mockResolvedValue(true),
  sendReaction: jest.fn().mockResolvedValue(true),
  sendTemplate: jest.fn().mockResolvedValue(true),
  sendTemplateMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => undefined }));

const { logToFile } = require('../../bot/shared/utils/logger');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const V8Catalog = require('../../bot/shared/services/lp-v8-catalog.service');
const LpCoachingAsk = require('../../bot/shared/services/nudges/lp-coaching-ask.service');
const router = require('../../bot/shared/routes/internal-api.routes');

const lessonRow = (i) => ({
  lesson_id: `grade_1_english_ch1_seg${i}`, segment_index: i, lp_type: 'content',
  day_label: `Day ${i}`, section: 'Diving Deeper', section_short: 'Diving Deeper',
  topic: `Topic ${i}`, topic_short: `Topic ${i}`, pages: [i], pages_label: `p.${i}`,
  row: { title: 'Diving Deeper', description: `Day ${i}`, metadata: `Topic ${i} · p.${i}` },
});
const CATALOG = {
  catalog_version: 'v8',
  counts: { books: 1, chapters: 1, lessons: 2 },
  books: [{
    stem: 'grade_1_english', grade: 1, subject: 'English', subject_key: 'english', rtl: false,
    chapters: [{ number: 1, title: 'Hello World!', title_short: 'Hello World!', lessons: [lessonRow(3), lessonRow(4)] }],
  }],
};
const LESSON = 'grade_1_english_ch1_seg3';
const OTHER_LESSON = 'grade_1_english_ch1_seg4';
const asset = (lessonId) => ({
  id: `asset-${lessonId}`, lesson_id: lessonId, asset_kind: 'lesson', catalog_version: 'v8',
  r2_key: `lp-cache/v8/${lessonId}/aabb.pdf`, content_hash: 'aabb', version_stamp: 'v8-1', is_current: true,
});
const USER = {
  id: '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10', phone_number: '923001234567', preferred_language: 'en', role: 'teacher',
};
// Tue 13 Oct 2026, 09:00 UTC = 14:00 PKT would be the cutoff; use 04:00 UTC = 09:00 PKT (morning).
const NOW = new Date('2026-10-13T04:00:00Z');
const OPEN_1 = '11111111-1111-4111-8111-000000000001';
const OPEN_2 = '11111111-1111-4111-8111-000000000002';

const open = (id, over = {}) => ({
  id, user_id: USER.id, plan_kind: 'k5', plan_ref: LESSON, lang: null, source: 'viewer',
  opened_at: NOW.toISOString(), ...over,
});

function seed(extra = {}) {
  mockDb.reset({
    users: [{ ...USER, last_message_at: new Date(NOW.getTime() - 5 * 60_000).toISOString() }],
    niete_lp_assets: [asset(LESSON), asset(OTHER_LESSON)],
    niete_lp_downloads: [],
    niete_lp612_deliveries: [],
    lesson_plans: [],
    lp_feedback: [],
    teacher_nudges: [],
    coaching_sessions: [],
    niete_lp_opens: [open(OPEN_1)],
    chat_sessions: [{ id: 'cs-1', user_id: USER.id, last_activity_at: new Date(NOW.getTime() - 5 * 60_000).toISOString() }],
    ...extra,
  });
}

// lesson_plans rows get a uuid, as the real table mints one (the survey's button id needs it).
const realFrom = mockDb.from.getMockImplementation();
let planSeq = 0;
mockDb.from.mockImplementation((table) => {
  const b = realFrom(table);
  if (table !== 'lesson_plans') return b;
  const insert = b.insert;
  b.insert = (p) => insert({ id: `00000000-0000-4000-8000-${String((planSeq += 1)).padStart(12, '0')}`, ...p });
  return b;
});

function findRoute(method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.methods[method] && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  throw new Error(`route ${method} ${path} not found`);
}

/** POST /lp/open-survey past the key check — the handler the portal reaches. */
async function postOpen(openId) {
  const handlers = findRoute('post', '/lp/open-survey');
  const handler = handlers[handlers.length - 1];
  const res = new PassThrough();
  res.statusCode = 200;
  res.status = (c) => { res.statusCode = c; return res; };
  let body = null;
  res.json = (b) => { body = b; return res; };
  await handler({ body: { openId }, headers: {} }, res);
  return { status: res.statusCode, body };
}

const asks = () => mockDb.rows('teacher_nudges').filter((r) => r.kind === 'coaching_after_lp');
const decisions = () => logEvent.mock.calls.filter((c) => c[0] === 'coaching_ask.app_open').map((c) => c[1]);

let savedEnv;
beforeAll(() => V8Catalog.__setCatalogForTests(CATALOG));
afterAll(() => V8Catalog.__setCatalogForTests(null));

beforeEach(() => {
  savedEnv = { ...process.env };
  process.env.LP_COACHING_ASK_ENABLED = '1';
  delete process.env.COACHING_ASK_COUNT_APP_OPENS;
  delete process.env.LP_COACHING_ASK_DELAY_MINUTES;
  jest.clearAllMocks();
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'performance'] });
  jest.setSystemTime(NOW);
  mockRedis.reset();
  seed();
});
afterEach(() => {
  jest.useRealTimers();
  process.env = savedEnv;
});

describe('a K-5 plan read in the app books the coaching ask', () => {
  test('a viewer open for an eligible teacher books exactly one ask, the same row the WhatsApp path books', async () => {
    const out = await postOpen(OPEN_1);
    expect(out.status).toBe(200);

    expect(asks()).toHaveLength(1);
    const [row] = asks();
    const expected = LpCoachingAsk.scheduleFor(NOW);
    expect(row).toMatchObject({
      user_id: USER.id, kind: 'coaching_after_lp', nudge_date: expected.nudgeDate, // status 'pending' is the table default
    });
    expect(new Date(row.scheduled_at).toISOString()).toBe(expected.scheduledAt.toISOString());
    expect(row.context).toMatchObject({
      lesson_id: LESSON, asset_id: `asset-${LESSON}`, delivered_at: NOW.toISOString(), first_time: true,
    });
    expect(decisions()).toEqual([expect.objectContaining({ outcome: 'scheduled' })]);
    expect(out.body).toMatchObject({ success: true, coachingAsk: { outcome: 'scheduled' } });
  });

  test('the booked ask is SENT by the same send the WhatsApp path uses', async () => {
    await postOpen(OPEN_1);
    const [row] = asks();
    const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
    const later = new Date(NOW.getTime() + 11 * 60_000);
    const sent = await LpCoachingAsk.send(row, { now: later });
    expect(sent).toMatchObject({ sent: true });
    const buttons = WhatsAppService.sendInteractiveButtons.mock.calls.map((c) => c[1].buttons[0].id);
    expect(buttons).toContain(`lpask_yes_${row.id}`);
  });

  test('the row records the version the app SERVED at the open — a push after the open does not change it', async () => {
    // v8-1 was current when she opened; a new version lands a minute later, before the bot is told.
    const [served] = mockDb.rows('niete_lp_assets');
    Object.assign(served, { created_at: new Date(NOW.getTime() - 86400e3).toISOString(), is_current: false,
      superseded_at: new Date(NOW.getTime() + 60_000).toISOString() });
    mockDb.rows('niete_lp_assets').push({
      ...asset(LESSON), id: `asset-${LESSON}-new`, version_stamp: 'v8-2', content_hash: 'ccdd', is_current: true,
      created_at: new Date(NOW.getTime() + 60_000).toISOString(),
    });
    jest.setSystemTime(new Date(NOW.getTime() + 2 * 60_000));
    await postOpen(OPEN_1);
    const [row] = asks();
    expect(row.context).toMatchObject({ lesson_id: LESSON, asset_id: `asset-${LESSON}`, version_stamp: 'v8-1', content_hash: 'aabb' });
  });

  test('a plan opened after 14:00 PKT waits for 07:30 on the next school day, as on WhatsApp', async () => {
    const afternoon = new Date('2026-10-13T10:30:00Z'); // 15:30 PKT
    jest.setSystemTime(afternoon);
    mockDb.rows('niete_lp_opens')[0].opened_at = afternoon.toISOString();
    await postOpen(OPEN_1);
    const [row] = asks();
    expect(row.nudge_date).toBe('2026-10-14');
    expect(new Date(row.scheduled_at).toISOString()).toBe('2026-10-14T02:30:00.000Z');
  });
});

describe('asks once — never twice for one teacher-day, whichever surface came first', () => {
  test('the same call twice (a portal retry) books one ask', async () => {
    await postOpen(OPEN_1);
    const again = await postOpen(OPEN_1);
    expect(asks()).toHaveLength(1);
    expect(again.body.coachingAsk).toMatchObject({ outcome: 'skipped', reason: 'already_handled' });
  });

  test('a second open later the same day (same or another lesson) does not book a second ask', async () => {
    await postOpen(OPEN_1);
    const later = new Date(NOW.getTime() + 60 * 60_000);
    jest.setSystemTime(later);
    mockDb.rows('niete_lp_opens').push(open(OPEN_2, { plan_ref: OTHER_LESSON, opened_at: later.toISOString() }));
    const out = await postOpen(OPEN_2);
    expect(asks()).toHaveLength(1);
    expect(out.body.coachingAsk).toMatchObject({ outcome: 'skipped', reason: 'already_asked_today' });
  });

  test('a lesson DELIVERED on WhatsApp first today: the app open does not ask again', async () => {
    const delivered = await LpCoachingAsk.onLessonDelivered({
      userId: USER.id, lessonId: LESSON, deliveredAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
    });
    expect(delivered.scheduled).toBe(true);
    const out = await postOpen(OPEN_1);
    expect(asks()).toHaveLength(1);
    expect(out.body.coachingAsk).toMatchObject({ outcome: 'skipped', reason: 'already_asked_today' });
  });

  test('opened in the app first: a WhatsApp delivery the same day does not ask again', async () => {
    await postOpen(OPEN_1);
    const delivered = await LpCoachingAsk.onLessonDelivered({
      userId: USER.id, lessonId: LESSON, deliveredAt: new Date(NOW.getTime() + 30 * 60_000).toISOString(),
    });
    expect(delivered).toMatchObject({ scheduled: false, reason: 'already_asked_today' });
    expect(asks()).toHaveLength(1);
  });
});

// bd-2wgr3d.22.1 — operator 14 Oct: a plan she took counts whatever the route, and the fixes carry
// no switch of their own (the app link is the only on/off).
describe('a hand-off counts, and there is no switch', () => {
  test("a plan handed from the app to another app ('external') books the same ask", async () => {
    mockDb.rows('niete_lp_opens')[0].source = 'external';
    const out = await postOpen(OPEN_1);
    expect(asks()).toHaveLength(1);
    expect(out.body.coachingAsk).toMatchObject({ outcome: 'scheduled' });
  });

  test('COACHING_ASK_COUNT_APP_OPENS=off changes nothing: the open still books', async () => {
    process.env.COACHING_ASK_COUNT_APP_OPENS = 'off';
    const out = await postOpen(OPEN_1);
    expect(asks()).toHaveLength(1);
    expect(out.body.coachingAsk).toMatchObject({ outcome: 'scheduled' });
  });
});

describe('who is never asked from an app open', () => {

  test('a grade 6-12 open never books (the WhatsApp ask is K-5 only)', async () => {
    Object.assign(mockDb.rows('niete_lp_opens')[0], { plan_kind: 'g612', plan_ref: 'grade_9_physics.c02.p010', lang: 'en' });
    const out = await postOpen(OPEN_1);
    expect(asks()).toHaveLength(0);
    expect(out.body.coachingAsk).toMatchObject({ outcome: 'skipped', reason: 'not_k5' });
  });

  test('a coach or school leader (no self-coaching) is not asked', async () => {
    mockDb.rows('users')[0].role = 'coach';
    const out = await postOpen(OPEN_1);
    expect(asks()).toHaveLength(0);
    expect(out.body.coachingAsk).toMatchObject({ outcome: 'skipped', reason: 'not_self_coach' });
  });

  test('an open hours old (a late retry) is not asked about', async () => {
    mockDb.rows('niete_lp_opens')[0].opened_at = new Date(NOW.getTime() - 7 * 60 * 60_000).toISOString();
    const out = await postOpen(OPEN_1);
    expect(asks()).toHaveLength(0);
    expect(out.body.coachingAsk).toMatchObject({ outcome: 'skipped', reason: 'stale_open' });
  });

  test('a lesson the catalogue does not know is not asked about', async () => {
    mockDb.rows('niete_lp_opens')[0].plan_ref = 'grade_1_english_ch9_seg99';
    const out = await postOpen(OPEN_1);
    expect(asks()).toHaveLength(0);
    expect(out.body.coachingAsk).toMatchObject({ outcome: 'skipped', reason: 'unknown_plan' });
  });

  test('the ask feature flag off: nothing is booked', async () => {
    process.env.LP_COACHING_ASK_ENABLED = '';
    const out = await postOpen(OPEN_1);
    expect(asks()).toHaveLength(0);
    expect(out.body.coachingAsk).toMatchObject({ outcome: 'skipped', reason: 'disabled' });
  });
});

describe('fails closed', () => {
  test('a user read that errors asks nobody and says so at error level', async () => {
    const before = mockDb.from.getMockImplementation();
    mockDb.from.mockImplementation((table) => {
      const b = before(table);
      if (table !== 'users') return b;
      b.maybeSingle = async () => ({ data: null, error: { message: 'connection reset' } });
      return b;
    });
    try {
      const out = await postOpen(OPEN_1);
      expect(asks()).toHaveLength(0);
      expect(out.body.coachingAsk).toMatchObject({ outcome: 'skipped', reason: 'guard_unavailable' });
      expect(logToFile.mock.calls.some((c) => /coaching ask/i.test(c[0]) && c[2] === 'error')).toBe(true);
    } finally {
      mockDb.from.mockImplementation(before);
    }
  });

  test('a store insert that errors asks nobody and says so at error level', async () => {
    const before = mockDb.from.getMockImplementation();
    mockDb.from.mockImplementation((table) => {
      const b = before(table);
      if (table !== 'teacher_nudges') return b;
      b.insert = () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '57014', message: 'timeout' } }) }) });
      return b;
    });
    try {
      const out = await postOpen(OPEN_1);
      expect(asks()).toHaveLength(0);
      expect(out.body.coachingAsk).toMatchObject({ outcome: 'skipped', reason: 'guard_unavailable' });
    } finally {
      mockDb.from.mockImplementation(before);
    }
  });
});
