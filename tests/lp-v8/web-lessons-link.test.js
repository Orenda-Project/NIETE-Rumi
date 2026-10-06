'use strict';
/**
 * Lesson plans on the web, opened from WhatsApp.
 *
 * Every lesson-plan door ends in openLpBrowseFlow (the menu row, the "lp"
 * command, the text and voice intents, the generation cut-over). With
 * app_settings `web_lessons_enabled` on and the teacher allowed by
 * `web_lessons_teachers` ("all", or a list of user ids), that door sends the
 * `lesson_plans_open_v1` template instead of the catalogue Flow. Its URL button
 * carries a signed link for THIS teacher, for the lesson-plan area only, which
 * WhatsApp opens in its own browser on the portal's lesson plans.
 *
 * A topic-bearing door's one-line prefix cannot ride inside a template's fixed
 * body, so it goes as its own message first; if the template then fails, the
 * Flow follows WITHOUT the line, so she never reads it twice.
 *
 * Everything else — off, missing row, unreadable settings, not listed, no
 * secret, a failed send — is today's Flow, byte for byte.
 *
 * Network boundary faked (WhatsApp); app_settings is an in-memory table; the
 * catalogue copy and the token signer are the real ones.
 */
const { createMemorySupabase } = require('../fixtures/memory-supabase');
const mockDb = createMemorySupabase();
jest.mock('../../bot/shared/config/supabase', () => mockDb);
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendFlow: jest.fn().mockResolvedValue(true),
  sendMessage: jest.fn().mockResolvedValue(true),
  sendTemplate: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { openLpBrowseFlow } = require('../../bot/shared/services/lp-browse-entry.service');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

// New modules, required inside the tests so this file runs (and the
// template-vs-Flow assertions fail for their own reason) before they exist.
const token = () => require('../../bot/shared/services/portal-link-token');
const lessonsLink = () => require('../../bot/shared/services/lesson-plans-web-link');

const FLOW_ID = '1565529551677911';
const PHONE = '920000000001';
const TEACHER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const flows = () => WhatsAppService.sendFlow.mock.calls.map((c) => c[1]);
const texts = () => WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
const templates = () => WhatsAppService.sendTemplate.mock.calls;

function settings(rows) {
  mockDb.reset({ app_settings: rows });
}
const ON = [
  { key: 'web_lessons_enabled', value: true },
  { key: 'web_lessons_teachers', value: [TEACHER] },
];

const ENV = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV, PAKISTAN_LP_FLOW_ID: FLOW_ID, INTERNAL_API_KEY: 'test-internal-key' };
  delete process.env.WEB_TRAINING_TOKEN_SECRET;
  delete process.env.WEB_LESSONS_TEMPLATE;
  settings([]);
  try { lessonsLink()._resetCache(); } catch (_) { /* not built yet */ }
});
afterAll(() => { process.env = ENV; });

describe('a listed teacher gets the lesson-plans template instead of the Flow', () => {
  test.each(['en', 'ur'])('in %s, with a link that opens HER lesson plans and nothing else', async (language) => {
    settings(ON);

    const sent = await openLpBrowseFlow({ from: PHONE, userId: TEACHER, language, reason: 'menu' });

    expect(sent).toBe(true);
    expect(flows()).toEqual([]);
    expect(templates()).toHaveLength(1);
    const [to, name, lang, components] = templates()[0];
    expect([to, name, lang]).toEqual([PHONE, 'lesson_plans_open_v1', language]);
    const button = components.find((c) => c.type === 'button');
    expect(button).toMatchObject({ sub_type: 'url', index: '0' });
    expect(token().verifyPortalLink(button.parameters[0].text)).toMatchObject({ u: TEACHER, area: 'lessons' });
  });

  test('"all" lets every teacher through, and the template name can change per deployment', async () => {
    process.env.WEB_LESSONS_TEMPLATE = 'lesson_plans_open_v2';
    settings([{ key: 'web_lessons_enabled', value: 'true' }, { key: 'web_lessons_teachers', value: '"all"' }]);

    await openLpBrowseFlow({ from: PHONE, userId: OTHER, language: 'en', reason: 'bare_command' });

    expect(templates()[0][1]).toBe('lesson_plans_open_v2');
    expect(flows()).toEqual([]);
  });

  test('a topic door\'s line goes first, on its own, then the template', async () => {
    settings(ON);
    const line = resolveUx('lp612RouteRedirect', { language: 'en' });

    const sent = await openLpBrowseFlow({ from: PHONE, userId: TEACHER, language: 'en', reason: 'lesson_plan_intent', bodyPrefix: line });

    expect(sent).toBe(true);
    expect(texts()).toEqual([line]);
    expect(templates()).toHaveLength(1);
    expect(WhatsAppService.sendMessage.mock.invocationCallOrder[0])
      .toBeLessThan(WhatsAppService.sendTemplate.mock.invocationCallOrder[0]);
    expect(flows()).toEqual([]);
  });

  test('a template that fails falls back to the Flow, and the line is never sent twice', async () => {
    settings(ON);
    WhatsAppService.sendTemplate.mockResolvedValueOnce(false);
    const line = resolveUx('lp612RouteRedirect', { language: 'ur' });

    const sent = await openLpBrowseFlow({ from: PHONE, userId: TEACHER, language: 'ur', reason: 'lesson_plan_intent', bodyPrefix: line });

    expect(sent).toBe(true);
    expect(texts()).toEqual([line]);
    expect(flows()).toHaveLength(1);
    expect(flows()[0].body).toBe(resolveUx('lpBrowseBody', { language: 'ur' }));
  });
});

describe('everything else is today\'s Flow', () => {
  test.each([
    ['the switch is off', [{ key: 'web_lessons_enabled', value: false }, { key: 'web_lessons_teachers', value: 'all' }]],
    ['the switch row is missing', [{ key: 'web_lessons_teachers', value: 'all' }]],
    ['the teacher is not on the list', [{ key: 'web_lessons_enabled', value: true }, { key: 'web_lessons_teachers', value: [OTHER] }]],
    ['training is on but lesson plans are not', [{ key: 'web_training_enabled', value: true }, { key: 'web_training_teachers', value: 'all' }]],
  ])('%s', async (_label, rows) => {
    settings(rows);
    const line = resolveUx('lp612RouteRedirect', { language: 'en' });

    const sent = await openLpBrowseFlow({ from: PHONE, userId: TEACHER, language: 'en', reason: 'lesson_plan_intent', bodyPrefix: line });

    expect(sent).toBe(true);
    expect(templates()).toEqual([]);
    expect(texts()).toEqual([]);
    expect(flows()).toHaveLength(1);
    expect(flows()[0].body).toBe(`${line}\n\n${resolveUx('lpBrowseBody', { language: 'en' })}`);
  });

  test('no signing secret on this deployment', async () => {
    delete process.env.INTERNAL_API_KEY;
    settings(ON);

    await openLpBrowseFlow({ from: PHONE, userId: TEACHER, language: 'en', reason: 'menu' });

    expect(templates()).toEqual([]);
    expect(flows()).toHaveLength(1);
  });
});

describe('the web link can never break the door', () => {
  test('a settings read that throws, with a logger that throws too, still sends the Flow', async () => {
    const logger = require('../../bot/shared/utils/logger');
    logger.logWarn.mockImplementation(() => { throw new Error('logger down'); });
    const realFrom = mockDb.from.getMockImplementation();
    mockDb.from.mockImplementation((table) => {
      if (table === 'app_settings') throw new Error('db down');
      return realFrom(table);
    });
    try {
      const sent = await openLpBrowseFlow({ from: PHONE, userId: TEACHER, language: 'en', reason: 'menu' });

      expect(sent).toBe(true);
      expect(templates()).toEqual([]);
      expect(flows()).toHaveLength(1);
    } finally {
      mockDb.from.mockImplementation(realFrom);
      logger.logWarn.mockReset();
    }
  });
});

describe('one link format for every area', () => {
  test('a training link keeps its old shape, so links already sent still open training', () => {
    const T = token();
    const t = T.signPortalLink(TEACHER, 'training');
    const payload = JSON.parse(Buffer.from(t.split('.')[0], 'base64url').toString('utf8'));
    expect(payload).not.toHaveProperty('a');
    expect(T.verifyPortalLink(t)).toMatchObject({ u: TEACHER, area: 'training' });
  });

  test('a lesson-plans link names its area; an area nobody defined is never signed or accepted', () => {
    const T = token();
    expect(T.verifyPortalLink(T.signPortalLink(TEACHER, 'lessons'))).toMatchObject({ u: TEACHER, area: 'lessons' });
    expect(T.signPortalLink(TEACHER, 'coaching')).toBeNull();
  });
});
