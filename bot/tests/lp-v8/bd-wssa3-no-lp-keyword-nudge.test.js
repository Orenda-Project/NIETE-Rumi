/**
 * bd-wssa3 — the feature-intro keyword nudge must not fire on "lesson plan".
 *
 * Staging, 2026-08-30 21:40 PKT: 33 seconds after a lesson was delivered the
 * operator typed "give me short version of the lesson plan above". No reply
 * row was ever written. The message was eaten by detectAndOfferVideo — the
 * substring "lesson plan" scores 0.5, the consent buttons went out, and the
 * handler returned early. Tapping "Just tell me" then replied:
 *   "Just tell me what you want to teach … and I'll create a detailed 5-step
 *    lesson plan with activities."
 * — a Gamma-era promise the bot can no longer keep (bd-2540). The intro video
 * it offers shows the retired generation flow.
 *
 * Same class as bd-hgwfo: a keyword gate deciding a turn before the classifier
 * sees it. Reading and coaching nudges are untouched — those features exist.
 */

const sent = [];
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendInteractiveButtons: jest.fn(async (to, payload) => { sent.push(payload); return true; }),
  sendMessage: jest.fn(async () => true),
}));
jest.mock('../../shared/services/feature-intro.service', () => ({
  hasSeenIntroVideo: jest.fn(async () => false),
  markFeatureUsed: jest.fn(async () => {}),
}));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  redis: { get: jest.fn(async () => null), setex: jest.fn(async () => 'OK') },
}));
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const Detector = require('../../shared/services/feature-keyword-detector.service');

beforeEach(() => { sent.length = 0; });

describe('bd-wssa3 — no lesson-plan nudge', () => {
  test.each([
    'give me short version of the lesson plan above',
    'shorten this lesson plan',
    'create lesson plan',
    'lesson plan for grade 3',
    'teaching plan for tomorrow',
  ])('never intercepts %p', async (msg) => {
    const handled = await Detector.detectAndOfferVideo(msg, 'u-1', '9230', 'en');
    expect(handled).toBe(false);
    expect(sent).toHaveLength(0);
  });

  test('the scorer no longer has a lesson_plan feature at all', () => {
    const scores = Detector.calculateFeatureScores('create a lesson plan');
    expect(scores).not.toHaveProperty('lesson_plan');
  });

  test('reading and coaching nudges still work (a real feature, first time)', async () => {
    const handled = await Detector.detectAndOfferVideo('can you check my student reading fluency', 'u-1', '9230', 'en');
    expect(handled).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].buttons[0].id).toBe('keyword_show_video_reading');
  });
});
