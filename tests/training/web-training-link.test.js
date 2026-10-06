'use strict';
/**
 * Training on the web, opened from WhatsApp.
 *
 * When app_settings `web_training_enabled` is on and the teacher is allowed by
 * `web_training_teachers` ("all", or a list of user ids), opening Training sends
 * the `training_open_v1` template instead of the Flow. Its URL button carries a
 * signed link that logs THIS teacher into the portal's training pages
 * (`<portal>/t/<token>`); a template link button is what opens inside
 * WhatsApp's own browser.
 *
 * Everything else — the flag off, a missing row, a read error, a teacher not
 * on the list, no signing secret, a template send that fails — is today's
 * Flow, unchanged. The Flow is the kill switch.
 *
 * openTrainingFlow is driven for real; Supabase, WhatsApp and the app-redirect
 * switch are the stand-ins.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
  sendTemplate: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/app-redirect.service', () => ({
  redirectIfFlagged: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WA = require('../../bot/shared/services/whatsapp.service');
const { installFrom } = require('../quiz/helpers/supabase-chain');
const Entry = require('../../bot/shared/services/training/training-entry.service');

// The two new modules are required inside the tests, so this file still runs
// (and the Flow-vs-template assertions still fail for their own reason) before
// they exist.
const webLink = () => require('../../bot/shared/services/training/training-web-link');
const token = () => require('../../bot/shared/services/portal-link-token');

const TEACHER = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PHONE = '920000000001';
const BASE = 'https://portal.example.test';

function settings({ enabled, teachers, error } = {}) {
  if (error) return { data: null, error: { message: 'boom' } };
  const rows = [];
  if (enabled !== undefined) rows.push({ key: 'web_training_enabled', value: enabled });
  if (teachers !== undefined) rows.push({ key: 'web_training_teachers', value: teachers });
  return { data: rows, error: null };
}

/** The URL-button parameter of the one template sent. */
function sentToken() {
  expect(WA.sendTemplate).toHaveBeenCalledTimes(1);
  const [, , , components] = WA.sendTemplate.mock.calls[0];
  const button = components.find((c) => c.type === 'button');
  expect(button).toMatchObject({ sub_type: 'url', index: '0' });
  return button.parameters[0].text;
}

const ENV = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', PORTAL_URL: `${BASE}/`, TEACHER_TRAINING_FLOW_ID: 'flow-1' };
  delete process.env.WEB_TRAINING_TOKEN_SECRET;
  delete process.env.WEB_TRAINING_TEMPLATE;
  try { webLink()._resetCache(); } catch (_) { /* not built yet */ }
});
afterAll(() => { process.env = ENV; });

describe('opening Training with the web switch on', () => {
  test('a listed teacher gets the training_open_v1 template, in her language, with a link that logs HER in', async () => {
    installFrom(supabase.from, { app_settings: settings({ enabled: true, teachers: [TEACHER.id] }) });

    const sent = await Entry.openTrainingFlow(TEACHER, PHONE, 'ur');

    expect(sent).toBe(true);
    expect(WA.sendFlow).not.toHaveBeenCalled();
    const [to, name, lang] = WA.sendTemplate.mock.calls[0] || [];
    expect([to, name, lang]).toEqual([PHONE, 'training_open_v1', 'ur']);
    const payload = token().verifyPortalLink(sentToken());
    expect(payload).toMatchObject({ k: 't', u: TEACHER.id });
  });

  test('"all" lets every teacher through; English is the floor for any other language', async () => {
    installFrom(supabase.from, { app_settings: settings({ enabled: 'true', teachers: '"all"' }) });

    await Entry.openTrainingFlow(TEACHER, PHONE, 'sd');

    expect(WA.sendTemplate.mock.calls[0][2]).toBe('en');
    expect(WA.sendFlow).not.toHaveBeenCalled();
  });

  test('the template name can be changed per deployment', async () => {
    process.env.WEB_TRAINING_TEMPLATE = 'training_open_v2';
    installFrom(supabase.from, { app_settings: settings({ enabled: true, teachers: 'all' }) });

    await Entry.openTrainingFlow(TEACHER, PHONE, 'en');

    expect(WA.sendTemplate.mock.calls[0][1]).toBe('training_open_v2');
  });

  test('the link is sent even where the Flow is not published', async () => {
    delete process.env.TEACHER_TRAINING_FLOW_ID;
    installFrom(supabase.from, { app_settings: settings({ enabled: true, teachers: 'all' }) });

    const sent = await Entry.openTrainingFlow(TEACHER, PHONE, 'en');

    expect(sent).toBe(true);
    expect(WA.sendTemplate).toHaveBeenCalledTimes(1);
    expect(WA.sendMessage).not.toHaveBeenCalled();
  });

  test('a template that fails to send falls back to the Flow, and says so at warning level', async () => {
    WA.sendTemplate.mockResolvedValueOnce(false);
    installFrom(supabase.from, { app_settings: settings({ enabled: true, teachers: 'all' }) });

    const sent = await Entry.openTrainingFlow(TEACHER, PHONE, 'en');

    expect(sent).toBe(true);
    expect(WA.sendFlow).toHaveBeenCalledTimes(1);
    expect(require('../../bot/shared/utils/logger').logWarn)
      .toHaveBeenCalledWith(expect.stringMatching(/template send failed/), expect.objectContaining({ userId: TEACHER.id }));
  });
});

describe('every other case is today\'s Flow', () => {
  test.each([
    ['the switch is off', settings({ enabled: false, teachers: 'all' })],
    ['the switch row is missing', settings({ teachers: 'all' })],
    ['the teacher is not on the list', settings({ enabled: true, teachers: [OTHER] })],
    ['the list is missing', settings({ enabled: true })],
    ['app_settings cannot be read', settings({ error: true })],
  ])('%s', async (_label, rows) => {
    installFrom(supabase.from, { app_settings: rows });

    const sent = await Entry.openTrainingFlow(TEACHER, PHONE, 'en');

    expect(sent).toBe(true);
    expect(WA.sendTemplate).not.toHaveBeenCalled();
    expect(WA.sendFlow).toHaveBeenCalledTimes(1);
  });

  test('no signing secret on this deployment', async () => {
    delete process.env.INTERNAL_API_KEY;
    installFrom(supabase.from, { app_settings: settings({ enabled: true, teachers: 'all' }) });

    await Entry.openTrainingFlow(TEACHER, PHONE, 'en');

    expect(WA.sendTemplate).not.toHaveBeenCalled();
    expect(WA.sendFlow).toHaveBeenCalledTimes(1);
  });
});

describe('the web link can never break the door', () => {
  test('a settings read that throws, with a logger that throws too, still sends the Flow', async () => {
    const logger = require('../../bot/shared/utils/logger');
    logger.logWarn.mockImplementation(() => { throw new Error('logger down'); });
    supabase.from.mockImplementation(() => { throw new Error('db down'); });
    try {
      const sent = await Entry.openTrainingFlow(TEACHER, PHONE, 'en');

      expect(sent).toBe(true);
      expect(WA.sendTemplate).not.toHaveBeenCalled();
      expect(WA.sendFlow).toHaveBeenCalledTimes(1);
    } finally {
      logger.logWarn.mockReset();
    }
  });
});

describe('the training link token', () => {
  test('is genuine only unaltered, unexpired and of the training kind', () => {
    const T = token();
    const good = T.signPortalLink(TEACHER.id);
    expect(T.verifyPortalLink(good)).toMatchObject({ k: 't', u: TEACHER.id });

    const [body, sig] = good.split('.');
    const forged = Buffer.from(JSON.stringify({ k: 't', u: OTHER, exp: 9999999999 })).toString('base64url');
    expect(T.verifyPortalLink(`${forged}.${sig}`)).toBeNull();
    expect(T.verifyPortalLink(`${body}.${sig.slice(0, -1)}x`)).toBeNull();
    expect(T.verifyPortalLink('')).toBeNull();
    expect(T.verifyPortalLink(null)).toBeNull();
  });

  test('lasts 24 hours', () => {
    const T = token();
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
    const good = T.signPortalLink(TEACHER.id);
    spy.mockReturnValue(now + 24 * 60 * 60 * 1000 - 1000);
    expect(T.verifyPortalLink(good)).not.toBeNull();
    spy.mockReturnValue(now + 24 * 60 * 60 * 1000 + 1000);
    expect(T.verifyPortalLink(good)).toBeNull();
    spy.mockRestore();
  });

  test('a web quiz token is not a training link, and a key change voids old links', () => {
    const T = token();
    const QuizToken = require('../../bot/shared/services/quiz/web-quiz-token');
    const quiz = QuizToken.signPreview({ shareCodeId: OTHER, teacherUserId: TEACHER.id });
    expect(quiz).toBeTruthy();
    expect(T.verifyPortalLink(quiz)).toBeNull();

    const good = T.signPortalLink(TEACHER.id);
    process.env.INTERNAL_API_KEY = 'rotated';
    expect(T.verifyPortalLink(good)).toBeNull();
  });

  test('signs nothing without a secret', () => {
    delete process.env.INTERNAL_API_KEY;
    expect(token().signPortalLink(TEACHER.id)).toBeNull();
    expect(token().signPortalLink(null)).toBeNull();
  });
});
