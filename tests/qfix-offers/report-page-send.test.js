'use strict';
/**
 * The closed-window coaching report when quiz_offer_closed_window.report_page is on (report-window-send.js
 * sendQuizPage, quiz/report-page-quiz.js pageOffer): still ONE utility message, and it opens a page with "Make a quiz".
 *   C/D (new report)   the link template (report-link-button.js), once; its /cr page carries the block
 *   A/B, undrawn       quiz_page_template (URL button → /cq/<token>) when named; else today's plain template.
 *                      Named per language ({ "en": "…" }): a language with no name = today's plain template
 *   either went        the session's quiz row is written as held, held_path 'template', at send time
 *   switch off         exactly today's chain
 * Real modules end to end; only the network boundary is stubbed: Supabase (in-memory tables), the Meta send
 * (sendShare, which records what would have gone), the window check and the v10 group read.
 */
process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';

jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a), rpc: (...a) => mockDb.rpc(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/coaching/ab-v10-arms', () => ({ groupFor: jest.fn() }));
jest.mock('../../bot/shared/services/feature-intro.service', () => ({ hasSeenIntroVideo: jest.fn().mockResolvedValue(false) }));

const { makeDb } = require('../quiz/helpers/memory-db');

let mockDb;
const { groupFor } = require('../../bot/shared/services/coaching/ab-v10-arms');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { sendReportByTemplateIfWindowClosed } = require('../../bot/shared/services/coaching/report-window-send');
const PageQuiz = require('../../bot/shared/services/quiz/report-page-quiz');
const DeliverySwitch = require('../../bot/shared/services/coaching/report-delivery-switch');
const ClosedWindow = require('../../bot/shared/services/quiz/closed-window-offer');

const SID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';
const PHONE = '923330000011';
const ENV = { ...process.env };
const LONG = 'x'.repeat(2000);

function setup({ page, link = 'share_dc_report_link_v1', group = 'C', transcript = LONG, lang = 'en' } = {}) {
  const settings = [];
  if (page !== undefined) settings.push({ key: 'quiz_offer_closed_window', value: page });
  if (link) settings.push({ key: 'report_delivery_fixes', value: { template_link: link } });
  mockDb = makeDb({
    app_settings: settings,
    coaching_sessions: [{ id: SID, user_id: UID, observation_type: null, transcript_text: transcript, analysis_data: { topic: 'Adding tens', subject: 'Maths' } }],
    quizzes: [],
    users: [{ id: UID, phone_number: PHONE, preferred_language: lang }],
  });
  groupFor.mockResolvedValue(group ? { group, plan: 'v9', report: group === 'C' || group === 'D' ? 'new' : 'today' } : null);
}

/** The Meta send: answers by template name ('refuse' set = refused), records every attempt. */
function sender(refuse = []) {
  const calls = [];
  const sendShare = jest.fn(async (req) => {
    const name = req.clip ? req.clip.template : req.quiz ? req.quiz.template : 'share_dc_report_v1';
    calls.push({ name, token: req.clip ? req.clip.token : null });
    return refuse.includes(name) ? { status: 'failed', reason: 'refused', code: 132001 } : { status: 'sent' };
  });
  return { calls, sendShare };
}

const run = (s) => sendReportByTemplateIfWindowClosed({ phone: PHONE, userId: UID, sessionId: SID }, { windowOpen: async () => false, sendShare: s.sendShare });
const held = () => mockDb.tables.quizzes.filter((q) => q.coaching_session_id === SID);

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV, TRANSCRIPT_QUIZ_ENABLED: 'true', INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co' };
  PageQuiz._resetCache();
  DeliverySwitch._resetCache();
  ClosedWindow._resetCache();
});
afterAll(() => { process.env = ENV; });

test('C/D: one message, the link template; the quiz row is held at send time (held_path template)', async () => {
  setup({ page: { trace: true, report_page: true, quiz_page_template: 'share_dc_report_open_v2' } });
  const s = sender();
  expect(await run(s)).toBe('template');
  expect(s.calls.map((c) => c.name)).toEqual(['share_dc_report_link_v1']);
  expect(held()).toHaveLength(1);
  expect(held()[0]).toMatchObject({ status: 'skipped', meta: expect.objectContaining({ skip_reason: 'window_closed', held_path: 'template' }) });
});

test('A/B: one message, the quiz-page template with the teacher\'s /cr token; held at send time', async () => {
  setup({ page: { trace: true, report_page: true, quiz_page_template: 'share_dc_report_open_v2' }, group: 'A' });
  const s = sender();
  expect(await run(s)).toBe('template');
  expect(s.calls).toHaveLength(1);
  expect(s.calls[0].name).toBe('share_dc_report_open_v2');
  const v = require('../../bot/shared/services/coaching/report-link-token').verifyReportLink(s.calls[0].token);
  expect(v).toMatchObject({ ok: true, sessionId: SID, userId: UID });
  expect(held()[0].meta.held_path).toBe('template');
  expect(logEvent).toHaveBeenCalledWith('coaching.report.quiz_page_template_sent', expect.objectContaining({ sessionId: SID }));
});

test('undrawn school, no quiz-page template named: today\'s plain report, nothing held from here', async () => {
  setup({ page: { trace: true, report_page: true }, group: null });
  const s = sender();
  expect(await run(s)).toBe('template');
  expect(s.calls.map((c) => c.name)).toEqual(['share_dc_report_v1']);
  expect(held()).toHaveLength(0);
});

test('C/D, link template refused: the quiz-page template next, and the link is never tried twice', async () => {
  setup({ page: { trace: true, report_page: true, quiz_page_template: 'share_dc_report_open_v2' } });
  const s = sender(['share_dc_report_link_v1']);
  expect(await run(s)).toBe('template');
  expect(s.calls.map((c) => c.name)).toEqual(['share_dc_report_link_v1', 'share_dc_report_open_v2']);
  expect(held()).toHaveLength(1);
});

test('both refused: today\'s plain report goes, nothing held', async () => {
  setup({ page: { trace: true, report_page: true, quiz_page_template: 'share_dc_report_open_v2' } });
  const s = sender(['share_dc_report_link_v1', 'share_dc_report_open_v2']);
  expect(await run(s)).toBe('template');
  expect(s.calls.map((c) => c.name)).toEqual(['share_dc_report_link_v1', 'share_dc_report_open_v2', 'share_dc_report_v1']);
  expect(held()).toHaveLength(0);
});

test('a session that cannot take a quiz (short transcript): the chain as today, the link template for C/D, nothing held', async () => {
  setup({ page: { trace: true, report_page: true, quiz_page_template: 'share_dc_report_open_v2' }, transcript: 'short' });
  const s = sender();
  expect(await run(s)).toBe('template');
  expect(s.calls.map((c) => c.name)).toEqual(['share_dc_report_link_v1']);
  expect(held()).toHaveLength(0);
});

test.each([
  ['no row', undefined],
  ['trace only', { trace: true }],
  ['report_page false', { trace: true, report_page: false, quiz_page_template: 'share_dc_report_open_v2' }],
])('switch off (%s): A/B get today\'s plain report, never the quiz-page template', async (_n, page) => {
  setup({ page, group: 'B' });
  const s = sender();
  await run(s);
  expect(s.calls.map((c) => c.name)).toEqual(['share_dc_report_v1']);
  expect(held()).toHaveLength(0);
});

describe('quiz_page_template per language (en → share_dc_report_open_v4, ur → none)', () => {
  const PER_LANG = { trace: true, report_page: true, quiz_page_template: { en: 'share_dc_report_open_v4' } };

  test('an en A/B teacher: one message, v4 with the /cr token; held at send time', async () => {
    setup({ page: PER_LANG, group: 'A', lang: 'en' });
    const s = sender();
    expect(await run(s)).toBe('template');
    expect(s.calls.map((c) => c.name)).toEqual(['share_dc_report_open_v4']);
    expect(s.calls[0].token).toEqual(expect.any(String));
    expect(held()).toHaveLength(1);
    expect(held()[0].meta.held_path).toBe('template');
  });

  test('an ur A/B teacher: today\'s plain report (share_dc_report_v1), nothing held, the quiz-page template never tried', async () => {
    setup({ page: PER_LANG, group: 'B', lang: 'ur' });
    const s = sender();
    expect(await run(s)).toBe('template');
    expect(s.calls.map((c) => c.name)).toEqual(['share_dc_report_v1']);
    expect(held()).toHaveLength(0);
    expect(logEvent).not.toHaveBeenCalledWith('coaching.report.quiz_page_template_not_sent', expect.anything());
  });

  test('no language on the teacher: the language the share template is sent in (en), so v4', async () => {
    setup({ page: PER_LANG, group: 'A', lang: null });
    const s = sender();
    await run(s);
    expect(s.calls.map((c) => c.name)).toEqual(['share_dc_report_open_v4']);
  });

  test('an ur C/D teacher: the link template, as before (the map is never asked)', async () => {
    setup({ page: PER_LANG, group: 'C', lang: 'ur' });
    const s = sender();
    await run(s);
    expect(s.calls.map((c) => c.name)).toEqual(['share_dc_report_link_v1']);
    expect(held()).toHaveLength(1);
  });

  test.each([
    ['a bad name', { en: 'Share Dc!' }],
    ['a list', ['share_dc_report_open_v4']],
    ['an empty map', {}],
  ])('a malformed map (%s): today\'s plain report for everyone', async (_n, tpl) => {
    setup({ page: { trace: true, report_page: true, quiz_page_template: tpl }, group: 'A', lang: 'en' });
    const s = sender();
    await run(s);
    expect(s.calls.map((c) => c.name)).toEqual(['share_dc_report_v1']);
    expect(held()).toHaveLength(0);
  });

  test('the teacher read fails: today\'s plain report (never a template the teacher\'s language may not have)', async () => {
    setup({ page: PER_LANG, group: 'A', lang: 'en' });
    const from = mockDb.from;
    mockDb.from = (t) => (t === 'users' ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'down' } }) }) }) } : from(t));
    const s = sender();
    await run(s);
    expect(s.calls.map((c) => c.name)).toEqual(['share_dc_report_v1']);
  });

  test('parseParts: the string form keeps its meaning; the map keeps only en/ur with good names', () => {
    expect(PageQuiz.parseParts({ report_page: true, quiz_page_template: 'share_dc_report_open_v2' }).pageTemplate).toBe('share_dc_report_open_v2');
    expect(PageQuiz.parseParts({ report_page: true, quiz_page_template: { en: 'share_dc_report_open_v4', ur: 'BAD NAME', fr: 'x_v1' } }).pageTemplate)
      .toEqual({ en: 'share_dc_report_open_v4' });
    expect(PageQuiz.parseParts({ report_page: false, quiz_page_template: { en: 'share_dc_report_open_v4' } }).reportPage).toBe(false);
  });
});
