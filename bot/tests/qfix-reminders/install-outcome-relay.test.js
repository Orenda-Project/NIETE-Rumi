'use strict';
/**
 * The hub's install card logs ONE install_prompt{step:'outcome', reason, when, held?} per hub view (hub-play.js). The
 * page relay keeps only allow-listed props, so `when` (render | offer | tour_end | hide) and `held` (tour) must be on
 * the list or the outcome arrives without them. Faked boundaries only: Supabase, Redis, WhatsApp, the logger.
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

test('the outcome keeps when and held through the relay', () => {
  Svc.events({ events: [{ n: 'install_prompt', step: 'outcome', src: 'browser', reason: 'shown', when: 'tour_end', held: 'tour', t: 1 }] });
  expect(relayed()).toHaveLength(1);
  expect(relayed()[0]).toMatchObject({ step: 'outcome', src: 'browser', reason: 'shown', when: 'tour_end', held: 'tour' });
});
test.each(['render', 'offer', 'tour_end', 'hide'])('when=%s is kept', (when) => {
  Svc.events({ events: [{ n: 'install_prompt', step: 'outcome', src: 'browser', reason: 'no_slot', when, t: 1 }] });
  expect(relayed()[0].when).toBe(when);
});
test('anything else in when or held is dropped, the rest of the event stays', () => {
  Svc.events({ events: [{ n: 'install_prompt', step: 'outcome', src: 'browser', reason: 'tour', when: 'https://x', held: 'card', t: 1 }] });
  const p = relayed()[0];
  expect(p.reason).toBe('tour');
  expect(p.when).toBeUndefined();
  expect(p.held).toBeUndefined();
});
