'use strict';
/**
 * The hub's install meter tags every install_prompt row with `platform` (android | ios | desktop | other) and
 * `display_mode` (browser | standalone | minimal-ui | fullscreen) so installs count by platform (hub-play.js). The page
 * relay keeps only allow-listed props, so both must be on the list, with these values only. Faked boundaries only:
 * Supabase, Redis, WhatsApp, the logger.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  isAvailable: () => false, get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true), setNX: jest.fn(async () => true),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendInteractiveButtons: jest.fn(), sendFlow: jest.fn(), sendCtaUrl: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const { logEvent } = require('../../shared/utils/structured-logger');
const Svc = require('../../shared/services/quiz/web-quiz.service');
const Hub = require('../../shared/services/quiz/web-quiz-hub');

const relayed = () => logEvent.mock.calls.filter(([n]) => n === 'web_quiz.install_prompt').map(([, p]) => p);

beforeEach(async () => {
  jest.clearAllMocks();
  const fake = makeFake({ app_settings: [{ key: 'web_quiz_install_prompt', value: true }] });
  supabase.from = (t) => fake.from(t);
  await Hub.flags();
});

test.each([['android', 'browser'], ['ios', 'standalone'], ['desktop', 'minimal-ui'], ['other', 'fullscreen']])(
  'platform %s and display_mode %s are kept', (platform, mode) => {
    Svc.events({ events: [{ n: 'install_prompt', step: 'installed', src: 'browser', platform, display_mode: mode, t: 1 }] });
    expect(relayed()[0]).toMatchObject({ step: 'installed', platform, display_mode: mode });
  });
test('sw_registered is a step the relay keeps', () => {
  Svc.events({ events: [{ n: 'install_prompt', step: 'sw_registered', src: 'browser', platform: 'android', display_mode: 'browser', t: 1 }] });
  expect(relayed()[0]).toMatchObject({ step: 'sw_registered', platform: 'android' });
});
test('anything else in platform or display_mode is dropped, the rest of the event stays', () => {
  Svc.events({ events: [{ n: 'install_prompt', step: 'accepted', src: 'browser', platform: 'Mozilla/5.0 (Linux; Android 13)', display_mode: 'window-controls-overlay', t: 1 }] });
  const p = relayed()[0];
  expect(p.step).toBe('accepted');
  expect(p.platform).toBeUndefined();
  expect(p.display_mode).toBeUndefined();
});
