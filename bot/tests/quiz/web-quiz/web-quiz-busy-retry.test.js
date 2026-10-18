'use strict';
/**
 * The busy page's own re-ask (app_settings web_quiz_busy_retry, web-quiz-busy-page.js). On (only the stored JSON boolean
 * true) AND the busy page on: the answers that say `busy_page: true` also say `busy_retry: true`, and the portal's
 * switch learner (GET /edge) says it too. Off, or the busy page off: the key is absent from the answers (the learner
 * says false), byte for byte #2872's.
 * The key rides the hub's one batched app_settings read (web-quiz-hub-flags.js): no settings read of its own.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));

const KEY = 'web_quiz_busy_retry';
let Flags;
let Busy;
beforeEach(() => {
  jest.resetModules();
  Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
  Busy = require('../../../shared/services/quiz/web-quiz-busy-page');
});
const prime = (rows) => Flags.prime(rows, Date.now());
const HUB = () => ({ lang: 'en', kids: [{ kid: '0123456789abcdef', name: 'Sana Testwala' }] });

describe('the switch', () => {
  test('the key is one more in the hub\'s one batched read', () => {
    expect(Flags.KEYS).toContain(KEY);
    expect(Busy.RETRY_KEY).toBe(KEY);
  });
  test('busy page on + retry JSON true: the answer says busy_page and busy_retry', async () => {
    prime([{ key: 'web_quiz_busy_page', value: true }, { key: KEY, value: true }]);
    expect(await Busy.carry(HUB())).toEqual({ ...HUB(), busy_page: true, busy_retry: true });
  });
  test.each([['absent', undefined], ['false', false], ['the string true', 'true'], ['1', 1], ['an object', {}]])('retry %s: #2872\'s answer (busy_page only)', async (_n, v) => {
    prime([{ key: 'web_quiz_busy_page', value: true }, ...(v === undefined ? [] : [{ key: KEY, value: v }])]);
    expect(await Busy.carry(HUB())).toEqual({ ...HUB(), busy_page: true });
  });
  test('retry on but the busy page off: nothing added', async () => {
    prime([{ key: KEY, value: true }]);
    expect(await Busy.carry(HUB())).toEqual(HUB());
  });
  test('a cold cache: nothing added, never a read of its own', async () => {
    expect(await Busy.carry(HUB())).toEqual(HUB());
  });
});
