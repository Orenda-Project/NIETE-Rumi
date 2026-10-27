/**
 * Mock lane — the transcript-quiz offer's 240 s delay is lane-tunable (bd-aqi0ay).
 *
 * The coaching pipeline walker (coaching-ext.cjs) ends a run only once the report AND the quiz offer
 * have arrived, and gives up after 240 s with no progress. The offer is a `quiz_offer` job the worker
 * enqueues with delaySeconds = OFFER_DELAY_SECONDS = 240 — so every completed pipeline run waited the
 * whole stall window and died at 241 s: four stalls × 240 s in run 20261023-2041-par, with COA20/28/29/30
 * BLOCKED on "no progress for 241s at steps [2]". Same remedy as VIDEO_QUIZ_JOIN_LOCK_SECS (60 s in
 * production, 5 on the lane): an env knob with the production default unchanged.
 *
 * Red-first: fails on the bd-aqi0ay branch — the constant is hard-coded and local-stack.sh does not set it.
 */
const fs = require('fs');
const path = require('path');

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendInteractiveButtons: jest.fn() }));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-digest.service', () => ({ run: jest.fn() }));
jest.mock('../../bot/shared/services/feature-intro.service', () => ({ maybeSendIntro: jest.fn(), sendIntro: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const REPO = path.resolve(__dirname, '..', '..');
const fresh = (env) => {
  jest.resetModules();
  delete process.env.TRANSCRIPT_QUIZ_OFFER_DELAY_SECS;
  Object.assign(process.env, env);
  return require('../../bot/shared/services/quiz/transcript-quiz-offer.service');
};

describe('transcript-quiz-offer.service — OFFER_DELAY_SECONDS reads TRANSCRIPT_QUIZ_OFFER_DELAY_SECS', () => {
  test('unset: 240 s, as in production', () => { expect(fresh({}).OFFER_DELAY_SECONDS).toBe(240); });
  test('a whole number of seconds up to 900 is honoured (5 on the lane)', () => {
    expect(fresh({ TRANSCRIPT_QUIZ_OFFER_DELAY_SECS: '5' }).OFFER_DELAY_SECONDS).toBe(5);
    expect(fresh({ TRANSCRIPT_QUIZ_OFFER_DELAY_SECS: '0' }).OFFER_DELAY_SECONDS).toBe(0);
  });
  test('anything else keeps 240', () => {
    expect(fresh({ TRANSCRIPT_QUIZ_OFFER_DELAY_SECS: 'soon' }).OFFER_DELAY_SECONDS).toBe(240);
    expect(fresh({ TRANSCRIPT_QUIZ_OFFER_DELAY_SECS: '901' }).OFFER_DELAY_SECONDS).toBe(240);
    expect(fresh({ TRANSCRIPT_QUIZ_OFFER_DELAY_SECS: '-1' }).OFFER_DELAY_SECONDS).toBe(240);
  });
});

describe('local-stack.sh composes it for the lane', () => {
  test('TRANSCRIPT_QUIZ_OFFER_DELAY_SECS=5, overridable through E2E_TRANSCRIPT_QUIZ_OFFER_DELAY_SECS', () => {
    const src = fs.readFileSync(path.join(REPO, 'bot', 'scripts', 'e2e', 'local-stack.sh'), 'utf8');
    expect(src).toMatch(/echo "TRANSCRIPT_QUIZ_OFFER_DELAY_SECS=\$\{E2E_TRANSCRIPT_QUIZ_OFFER_DELAY_SECS:-5\}"/);
  });
});
