'use strict';
/**
 * Meta bill cut NL3 (bd-w2daa.9): "Lesson plans now come from your textbook" rides INSIDE the Flow.
 *
 * Under LP_612_ROUTE_ALL a teacher who typed or spoke a lesson-plan request got two messages: the
 * one-line redirect ("Lesson plans now come straight from your own textbook…") and, a second later,
 * the catalogue Flow. 99.3% of those lines were followed by the Flow within 15 s (2,371 opens in
 * 7 days). Same words, one bubble: the line becomes the opening paragraph of the Flow message body
 * (~240 code points of a 1024 cap), so nothing the teacher reads changes — only the count of billed sends.
 *
 * Other doors (the /menu tap, the bare "lp" command, the ice-breaker) keep the plain body: the
 * prefix is an OPTIONAL argument and they never pass it. If a prefix would ever push the body past
 * Meta's 1024-code-point cap, the old two-message shape is kept rather than risk a rejected send.
 *
 * Network boundary faked (WhatsApp); the catalogue copy is the real one.
 */

const { createMemorySupabase } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase();   // no app_settings rows → no app-redirect switch is on
jest.mock('../../bot/shared/config/supabase', () => mockDb);
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendFlow: jest.fn().mockResolvedValue(true),
  sendMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { openLpBrowseFlow } = require('../../bot/shared/services/lp-browse-entry.service');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

const FLOW_ID = '1565529551677911';
const PHONE = '923365709413';
const cps = (s) => [...String(s || '')].length;
const flows = () => WhatsAppService.sendFlow.mock.calls.map((c) => c[1]);
const texts = () => WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);

beforeEach(() => {
  jest.clearAllMocks();
  process.env.PAKISTAN_LP_FLOW_ID = FLOW_ID;
});
afterAll(() => { delete process.env.PAKISTAN_LP_FLOW_ID; });

describe('openLpBrowseFlow — the optional body prefix', () => {
  test.each(['en', 'ur'])('with a prefix (%s): ONE message — the Flow — whose body is the line, a blank line, then the usual body', async (language) => {
    const line = resolveUx('lp612RouteRedirect', { language });
    const sent = await openLpBrowseFlow({ from: PHONE, userId: 'u-1', language, reason: 'lesson_plan_intent', bodyPrefix: line });

    expect(sent).toBe(true);
    expect(texts()).toEqual([]);
    expect(flows()).toHaveLength(1);
    expect(flows()[0].flowId).toBe(FLOW_ID);
    expect(flows()[0].body).toBe(`${line}\n\n${resolveUx('lpBrowseBody', { language })}`);
    expect(cps(flows()[0].body)).toBeLessThanOrEqual(1024);
    // header and button are untouched
    expect(flows()[0].header).toBe(resolveUx('lpBrowseHeader', { language }));
    expect(flows()[0].buttonText).toBe(resolveUx('lpBrowseButton', { language }));
  });

  test('without a prefix (menu tap, bare "lp", ice-breaker): the body is exactly today\'s', async () => {
    await openLpBrowseFlow({ from: PHONE, userId: 'u-1', language: 'en', reason: 'menu' });
    expect(texts()).toEqual([]);
    expect(flows()[0].body).toBe(resolveUx('lpBrowseBody', { language: 'en' }));
  });

  test('a prefix that would break the 1024-code-point cap falls back to TWO messages: the line, then the plain Flow', async () => {
    const huge = 'ب'.repeat(1000);   // 1000 code points + 2 + body > 1024
    const sent = await openLpBrowseFlow({ from: PHONE, userId: 'u-1', language: 'ur', reason: 'lesson_plan_intent', bodyPrefix: huge });
    expect(sent).toBe(true);
    expect(texts()).toEqual([huge]);
    expect(flows()).toHaveLength(1);
    expect(flows()[0].body).toBe(resolveUx('lpBrowseBody', { language: 'ur' }));
    // the line still goes BEFORE the Flow, as it always did
    expect(WhatsAppService.sendMessage.mock.invocationCallOrder[0])
      .toBeLessThan(WhatsAppService.sendFlow.mock.invocationCallOrder[0]);
  });

  test('both offered languages fit merged, measured in code points', () => {
    for (const language of ['en', 'ur']) {
      const merged = `${resolveUx('lp612RouteRedirect', { language })}\n\n${resolveUx('lpBrowseBody', { language })}`;
      expect(cps(merged)).toBeLessThanOrEqual(1024);
    }
  });
});
