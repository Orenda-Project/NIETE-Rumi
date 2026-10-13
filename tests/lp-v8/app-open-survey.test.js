'use strict';
/**
 * bd-qvevax.2 — the lesson-plan survey follows the teacher into the app.
 *
 * Since 12 Oct 2026 the "Open in app" link is on for every registered teacher: she asks for a plan
 * on WhatsApp, taps the button, and reads it in the teacher app. The survey ("was this plan
 * useful?") only ever fired after a plan DELIVERED ON WHATSAPP, so lp_feedback fell from 613 rows
 * (Tue 6 Oct) to 49 (Mon 12 Oct) while plan use held.
 *
 * The rule: when the portal's own viewer served a plan (a niete_lp_opens row, source 'viewer'),
 * the bot asks the SAME survey the WhatsApp path asks — same message, same buttons, same 30 s
 * delay, same storage — through the same two services. No parallel scheduler.
 *
 * Driven through the REAL survey services, the REAL v8 row writer and the REAL window check; only
 * the network is faked (WhatsApp; Supabase and the cache in memory).
 */

const { createMemorySupabase, createMemoryRedis } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase();
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
  sendReaction: jest.fn().mockResolvedValue(true),
  sendTemplate: jest.fn().mockResolvedValue(true),
  sendTemplateMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => undefined }));
jest.mock('../../bot/shared/services/nudges/lp-coaching-ask.service', () => ({ onLessonDelivered: jest.fn() }));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { logToFile } = require('../../bot/shared/utils/logger');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const V8Catalog = require('../../bot/shared/services/lp-v8-catalog.service');
const Delivery = require('../../bot/shared/services/lp-v8-delivery.service');
const LpFeedback = require('../../bot/shared/services/lp-feedback.service');
const Lp612Feedback = require('../../bot/shared/services/lp612-feedback.service');
const AppSurvey = require('../../bot/shared/services/lp-app-open-survey.service');

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
const SEGMENT = 'grade_9_physics.c02.p010';
const asset = (lessonId) => ({
  id: `asset-${lessonId}`, lesson_id: lessonId, asset_kind: 'lesson', catalog_version: 'v8',
  r2_key: `lp-cache/v8/${lessonId}/aabb.pdf`, content_hash: 'aabb', version_stamp: 'v8-1', is_current: true,
});
const USER = { id: '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10', phone_number: '923001234567', preferred_language: 'en' };
const NOW = new Date('2026-10-13T09:00:00Z');

const open = (id, over = {}) => ({
  id, user_id: USER.id, plan_kind: 'k5', plan_ref: LESSON, lang: null, source: 'viewer',
  opened_at: NOW.toISOString(), ...over,
});

const surveys = () => WhatsAppService.sendInteractiveButtons.mock.calls
  .map((c) => c[1])
  .filter((p) => p && p.buttons && /^(lp_feedback_yes_|lp612_fb_yes_)/.test(p.buttons[0].id));
const everythingSent = () => [
  ...WhatsAppService.sendMessage.mock.calls,
  ...WhatsAppService.sendInteractiveButtons.mock.calls,
  ...WhatsAppService.sendTemplate.mock.calls,
  ...WhatsAppService.sendTemplateMessage.mock.calls,
];
const seconds = (n) => jest.advanceTimersByTimeAsync(n * 1000);

function seed(extra = {}) {
  mockDb.reset({
    users: [USER],
    niete_lp_assets: [asset(LESSON)],
    niete_lp_downloads: [],
    niete_lp612_deliveries: [],
    niete_lp612_segments: [{
      segment_id: SEGMENT, grade: 9, subject: 'physics', chapter_number: 2, subtopic_title: 'Forces', menu_title: 'Forces',
    }],
    lesson_plans: [],
    lp_feedback: [],
    niete_lp_opens: [open('open-1')],
    // she wrote to the bot a few minutes ago: the 24-hour window is open
    chat_sessions: [{ id: 'cs-1', user_id: USER.id, last_activity_at: new Date(NOW.getTime() - 5 * 60_000).toISOString() }],
    ...extra,
  });
}

// The real table mints a uuid per lesson_plans row, and the button id's regex (BUTTON_RX) needs one.
const realFrom = mockDb.from.getMockImplementation();
let planSeq = 0;
mockDb.from.mockImplementation((table) => {
  const b = realFrom(table);
  if (table !== 'lesson_plans') return b;
  const insert = b.insert;
  b.insert = (p) => insert({ id: `00000000-0000-4000-8000-${String((planSeq += 1)).padStart(12, '0')}`, ...p });
  return b;
});

beforeAll(() => V8Catalog.__setCatalogForTests(CATALOG));
afterAll(() => V8Catalog.__setCatalogForTests(null));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'performance'] });
  jest.setSystemTime(NOW);
  mockRedis.reset();
  seed();
});
afterEach(() => { jest.useRealTimers(); });

describe('grades 1-5 — the plan she opened in the app', () => {
  test('the SAME survey arrives 30 seconds later: same body, same two buttons', async () => {
    const out = await AppSurvey.onViewerOpen({ openId: 'open-1' });
    expect(out).toMatchObject({ outcome: 'scheduled' });

    await seconds(29);
    expect(surveys()).toHaveLength(0);
    await seconds(2);
    expect(surveys()).toHaveLength(1);

    const sent = surveys()[0];
    // identical to what a WhatsApp-delivered plan gets (after_pdf_only)
    expect(sent.body).toBe(LpFeedback.__promptBodyForTests('en', 'after_pdf_only'));
    expect(sent.buttons.map((b) => b.title)).toEqual(['👍 Yes, useful', '👎 Not really']);
    expect(sent.buttons.map((b) => b.id.replace(/[0-9a-f-]{36}$/, '<uuid>')))
      .toEqual(['lp_feedback_yes_<uuid>', 'lp_feedback_no_<uuid>']);
  });

  test('the answer is stored exactly as a WhatsApp answer is — lp_feedback linked by lesson_plan_id', async () => {
    await AppSurvey.onViewerOpen({ openId: 'open-1' });
    await seconds(31);
    const yesId = surveys()[0].buttons[0].id;

    await LpFeedback.handleFeedbackButton(yesId, USER.phone_number);

    const [plan] = mockDb.rows('lesson_plans');
    expect(plan).toMatchObject({ user_id: USER.id, type: 'lesson_plan', grade: '1', subject: 'english', topic: 'Topic 3' });
    expect(plan.content).toMatchObject({
      chapter_number: 1, segment_number: 3, grade: 1, subject: 'english', trigger_mode: 'after_pdf_only',
      lp_variant: Delivery.LP_VARIANT,
    });
    const [fb] = mockDb.rows('lp_feedback');
    expect(fb).toMatchObject({
      user_id: USER.id, lesson_plan_id: plan.id, useful: true, grade: 1, subject: 'english',
      chapter_number: 1, segment_number: 3, trigger_mode: 'after_pdf_only', lp_variant: Delivery.LP_VARIANT,
    });
  });

  test('she is asked in HER language (the stored preference)', async () => {
    mockDb.rows('users')[0].preferred_language = 'ur';
    await AppSurvey.onViewerOpen({ openId: 'open-1' });
    await seconds(31);
    expect(surveys()[0].body).toBe(LpFeedback.__promptBodyForTests('ur', 'after_pdf_only'));
  });

  test('the SAME call twice (a retry) asks once', async () => {
    await AppSurvey.onViewerOpen({ openId: 'open-1' });
    const again = await AppSurvey.onViewerOpen({ openId: 'open-1' });
    await seconds(31);
    expect(again).toMatchObject({ outcome: 'skipped', reason: 'already_handled' });
    expect(surveys()).toHaveLength(1);
  });

  test('a SECOND open of the same plan, an hour later, is not surveyed again', async () => {
    await AppSurvey.onViewerOpen({ openId: 'open-1' });
    await seconds(31);
    jest.setSystemTime(new Date(NOW.getTime() + 60 * 60_000));
    mockDb.rows('niete_lp_opens').push(open('open-2', { opened_at: new Date(NOW.getTime() + 60 * 60_000).toISOString() }));

    const out = await AppSurvey.onViewerOpen({ openId: 'open-2' });
    await seconds(31);
    expect(out).toMatchObject({ outcome: 'skipped', reason: 'earlier_open' });
    expect(surveys()).toHaveLength(1);
  });

  test('a plan already DELIVERED on WhatsApp was surveyed there — not asked again', async () => {
    mockDb.rows('niete_lp_downloads').push({ id: 'd1', user_id: USER.id, lesson_id: LESSON, status: 'sent' });
    const out = await AppSurvey.onViewerOpen({ openId: 'open-1' });
    await seconds(31);
    expect(out).toMatchObject({ outcome: 'skipped', reason: 'delivered_on_whatsapp' });
    expect(surveys()).toHaveLength(0);
    expect(mockDb.rows('lesson_plans')).toHaveLength(0);
  });

  test('a FAILED WhatsApp delivery of that plan does not count as surveyed', async () => {
    mockDb.rows('niete_lp_downloads').push({ id: 'd1', user_id: USER.id, lesson_id: LESSON, status: 'failed' });
    const out = await AppSurvey.onViewerOpen({ openId: 'open-1' });
    expect(out).toMatchObject({ outcome: 'scheduled' });
  });

  test('another teacher\'s WhatsApp delivery of the plan is not hers', async () => {
    mockDb.rows('niete_lp_downloads').push({ id: 'd1', user_id: 'someone-else', lesson_id: LESSON, status: 'sent' });
    const out = await AppSurvey.onViewerOpen({ openId: 'open-1' });
    expect(out).toMatchObject({ outcome: 'scheduled' });
  });
});

describe('the 24-hour window — never a template, never outside it', () => {
  test('window closed: nothing is sent, nothing is stored, the skip is logged with its reason', async () => {
    mockDb.rows('chat_sessions')[0].last_activity_at = new Date(NOW.getTime() - 30 * 3600_000).toISOString();
    const out = await AppSurvey.onViewerOpen({ openId: 'open-1' });
    await seconds(60);
    expect(out).toMatchObject({ outcome: 'skipped', reason: 'window_closed' });
    expect(everythingSent()).toHaveLength(0);
    expect(mockDb.rows('lesson_plans')).toHaveLength(0);
    expect(logEvent).toHaveBeenCalledWith('lp.app_open_survey', expect.objectContaining({ outcome: 'skipped', reason: 'window_closed' }));
  });

  test('no chat session at all is a closed window', async () => {
    mockDb.reset({ ...{}, users: [USER], niete_lp_opens: [open('open-1')], chat_sessions: [] });
    const out = await AppSurvey.onViewerOpen({ openId: 'open-1' });
    expect(out).toMatchObject({ outcome: 'skipped', reason: 'window_closed' });
  });
});

describe('what is never surveyed', () => {
  test('an external open (a link handed to another app) is not an open she read', async () => {
    mockDb.rows('niete_lp_opens')[0].source = 'external';
    const out = await AppSurvey.onViewerOpen({ openId: 'open-1' });
    expect(out).toMatchObject({ outcome: 'skipped', reason: 'not_viewer_open' });
    await seconds(60);
    expect(everythingSent()).toHaveLength(0);
  });

  test('an open id that does not exist', async () => {
    const out = await AppSurvey.onViewerOpen({ openId: 'nope' });
    expect(out).toMatchObject({ outcome: 'skipped', reason: 'open_not_found' });
  });

  test('a teacher with no WhatsApp number cannot be asked', async () => {
    mockDb.rows('users')[0].phone_number = null;
    const out = await AppSurvey.onViewerOpen({ openId: 'open-1' });
    expect(out).toMatchObject({ outcome: 'skipped', reason: 'no_phone' });
  });

  test('a lesson the catalogue no longer knows', async () => {
    mockDb.rows('niete_lp_opens')[0].plan_ref = 'grade_1_english_ch9_seg9';
    const out = await AppSurvey.onViewerOpen({ openId: 'open-1' });
    expect(out).toMatchObject({ outcome: 'skipped', reason: 'unknown_plan' });
    expect(mockDb.rows('lesson_plans')).toHaveLength(0);
  });

  test('a database that cannot answer the guards asks nobody (at most ONE is the rule)', async () => {
    const real = mockDb.from.getMockImplementation();
    mockDb.from.mockImplementation((t) => {
      if (t === 'niete_lp_downloads') throw new Error('connection reset');
      return real(t);
    });
    try {
      const out = await AppSurvey.onViewerOpen({ openId: 'open-1' });
      await seconds(60);
      expect(out).toMatchObject({ outcome: 'skipped', reason: 'guard_unavailable' });
      expect(surveys()).toHaveLength(0);
      expect(logToFile).toHaveBeenCalledWith(expect.stringMatching(/open survey/i), expect.anything(), 'error');
    } finally {
      mockDb.from.mockImplementation(real);
    }
  });
});

describe('grades 6-12 — the lesson she opened in the app', () => {
  beforeEach(() => {
    mockDb.rows('niete_lp_opens')[0] = open('open-1', { plan_kind: 'g612', plan_ref: SEGMENT, lang: 'en' });
  });

  test('the SAME survey arrives 30 seconds later, for that segment and language', async () => {
    const out = await AppSurvey.onViewerOpen({ openId: 'open-1' });
    expect(out).toMatchObject({ outcome: 'scheduled' });
    await seconds(31);
    expect(surveys()).toHaveLength(1);
    expect(surveys()[0].buttons.map((b) => b.id)).toEqual([`lp612_fb_yes_en_${SEGMENT}`, `lp612_fb_no_en_${SEGMENT}`]);
    // and no lesson_plans row: a 6-12 lesson has none
    expect(mockDb.rows('lesson_plans')).toHaveLength(0);
  });

  test('the answer is stored as a 6-12 WhatsApp answer is — lp_feedback keyed by lp612_segment_id', async () => {
    await AppSurvey.onViewerOpen({ openId: 'open-1' });
    await seconds(31);
    await Lp612Feedback.handleFeedbackButton(surveys()[0].buttons[0].id, USER.phone_number);
    expect(mockDb.rows('lp_feedback')).toEqual([expect.objectContaining({
      user_id: USER.id, lp612_segment_id: SEGMENT, useful: true, lp_variant: 'lp612_en', grade: 9, subject: 'physics',
    })]);
  });

  test('a lesson delivered on WhatsApp was surveyed there', async () => {
    mockDb.rows('niete_lp612_deliveries').push({ id: 'g1', user_id: USER.id, segment_id: SEGMENT, surface: 'whatsapp' });
    const out = await AppSurvey.onViewerOpen({ openId: 'open-1' });
    expect(out).toMatchObject({ outcome: 'skipped', reason: 'delivered_on_whatsapp' });
  });

  test('the bot\'s own PORTAL claim on the render is not a WhatsApp delivery', async () => {
    mockDb.rows('niete_lp612_deliveries').push({ id: 'g1', user_id: USER.id, segment_id: SEGMENT, surface: 'portal' });
    const out = await AppSurvey.onViewerOpen({ openId: 'open-1' });
    expect(out).toMatchObject({ outcome: 'scheduled' });
  });

  test('a second open of the segment (even in the other language) is not surveyed again', async () => {
    mockDb.rows('niete_lp_opens').unshift(open('open-0', {
      plan_kind: 'g612', plan_ref: SEGMENT, lang: 'ur', opened_at: new Date(NOW.getTime() - 3600_000).toISOString(),
    }));
    const out = await AppSurvey.onViewerOpen({ openId: 'open-1' });
    expect(out).toMatchObject({ outcome: 'skipped', reason: 'earlier_open' });
  });

  test('already answered (the 6-12 survey\'s own once-per-lesson rule) is still honoured at send time', async () => {
    mockDb.rows('lp_feedback').push({ id: 'f1', user_id: USER.id, lp612_segment_id: SEGMENT, useful: true });
    await AppSurvey.onViewerOpen({ openId: 'open-1' });
    await seconds(31);
    expect(surveys()).toHaveLength(0);
  });
});
