'use strict';
/**
 * Every button a teacher can be holding on a lesson-plan day reaches its own
 * handler and no other — executed through the real webhook route.
 *
 * On one morning a teacher can have, all in the chat at once: the LP survey
 * (and its "did you use it?" follow-up), the 6-12 survey, the coaching ask, a
 * resume offer, the coaching survey and the post-coaching quiz offer, and at
 * 15:00 the lesson-plan quiz offer. They can arrive seconds apart and be tapped
 * in any order. None of them arms anything when it is SENT, so the only way two
 * of them can clash on a tap is a router branch that claims the wrong prefix.
 * This drives each id through `whatsapp-bot.js` with every owner mocked and
 * asserts exactly one owner is called, with that id.
 */
const http = require('http');

const PHONE = '923001234567';
const U = '22222222-2222-4222-8222-222222222222';

function webhookBody(buttonId) {
  return {
    entry: [{
      id: 'waba',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'pnid' },
          messages: [{
            id: `wamid.${buttonId}`,
            from: PHONE,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'interactive',
            interactive: { type: 'button_reply', button_reply: { id: buttonId, title: 'x' } },
          }],
        },
      }],
    }],
  };
}

async function postWebhook(app, body) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try {
    await fetch(`http://127.0.0.1:${port}/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

/** The coaching survey is not on every tier yet (sandbox has it; staging does not). */
const HAS_COACHING_SURVEY = (() => {
  try { require.resolve('../../bot/shared/services/coaching/coaching-feedback.service'); return true; } catch (_) { return false; }
})();

/** Each owner, as the router calls it. Every mock claims the tap (returns true). */
function owners() {
  const yes = () => jest.fn().mockResolvedValue(true);
  return {
    lpFeedback: { handleFeedbackButton: yes(), handleUsageButton: yes() },
    lp612Feedback: { handleFeedbackButton: yes(), handleUsageButton: yes() },
    coachingFeedback: { handleFeedbackButton: yes() },
    ask: { handleButton: yes() },
    offer: { handleButton: yes(), handleListPick: yes() },
    tqOffer: { handleOfferButton: yes(), handleLanguageButton: yes(), MIN_TRANSCRIPT_CHARS: 1500, SESSION_SELECT: 'id' },
    tqList: { handleActionButton: yes() },
    // The first branch in the router: it must own `resume_(yes|no):<flow>` and nothing else.
    resume: {
      handleResumeButton: jest.fn(async (_user, _from, id) => /^resume_(yes|no):[a-z_]+$/.test(id)),
      sweep: jest.fn(),
    },
  };
}

function mockBoundary(o) {
  jest.doMock('../../bot/shared/utils/validators', () => ({
    validateWebhookStatus: () => null,
    validateWebhookMessage: (req) => {
      const value = req.body.entry[0].changes[0].value;
      const message = value.messages[0];
      return {
        entry: req.body.entry[0], message, from: message.from, messageBody: '',
        messageType: message.type, messageTimestamp: message.timestamp,
        phoneNumberId: value.metadata.phone_number_id,
      };
    },
    isOurPhoneNumber: () => true,
    isTestWebhook: () => false,
    isTestPhoneNumber: () => false,
    isWithin24Hours: () => true,
  }));
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
    checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
    get: jest.fn(), set: jest.fn(), delete: jest.fn(), setNX: jest.fn(),
  }));
  jest.doMock('../../bot/shared/services/session.service', () => ({
    isProcessed: jest.fn().mockResolvedValue(false),
    markAsProcessed: jest.fn().mockResolvedValue(undefined),
    getReactionEmoji: jest.fn().mockReturnValue('👍'),
  }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendReaction: jest.fn().mockResolvedValue(true),
    showTypingIndicator: jest.fn().mockResolvedValue(true),
    sendMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  }));
  jest.doMock('../../bot/shared/database/bot-helpers', () => ({
    getOrCreateUser: jest.fn().mockResolvedValue({ id: 'u-1', phone_number: PHONE, preferred_language: 'en' }),
    trackChatStart: jest.fn().mockResolvedValue(undefined),
  }));
  jest.doMock('../../bot/shared/config/supabase', () => {
    const { fromMock } = require('../quiz/helpers/supabase-chain');
    return { from: fromMock({}), rpc: jest.fn().mockResolvedValue({ error: null }) };
  });
  jest.doMock('../../bot/shared/services/conversation-resume.service', () => o.resume);
  jest.doMock('../../bot/shared/services/lp-feedback.service', () => o.lpFeedback);
  jest.doMock('../../bot/shared/services/lp612-feedback.service', () => o.lp612Feedback);
  if (HAS_COACHING_SURVEY) jest.doMock('../../bot/shared/services/coaching/coaching-feedback.service', () => o.coachingFeedback);
  jest.doMock('../../bot/shared/services/nudges/lp-coaching-ask.service', () => o.ask);
  jest.doMock('../../bot/shared/services/nudges/lp-quiz-offer.service', () => o.offer);
  jest.doMock('../../bot/shared/services/quiz/transcript-quiz-offer.service', () => o.tqOffer);
  jest.doMock('../../bot/shared/services/quiz/transcript-quiz-list.service', () => o.tqList);
}

/** [the id the teacher taps, which owner must take it] */
const LP_DAY_IDS = [
  [`lp_feedback_yes_${U}`, 'lpFeedback.handleFeedbackButton'],
  [`lp_feedback_no_${U}`, 'lpFeedback.handleFeedbackButton'],
  [`lp_used_taught_${U}`, 'lpFeedback.handleUsageButton'],
  ['lp612_fb_no_ur_g7_science_ch2_seg1', 'lp612Feedback.handleFeedbackButton'],
  ['lp612_used_planned_g7_science_ch2_seg1', 'lp612Feedback.handleUsageButton'],
  [`lpask_yes_${U}`, 'ask.handleButton'],
  [`lpask_no_${U}`, 'ask.handleButton'],
  [`lpquiz_yes_${U}`, 'offer.handleButton'],
  [`lpquiz_no_${U}`, 'offer.handleButton'],
  [`tq_yes_${U}`, 'tqOffer.handleOfferButton'],
  [`coaching_fb_no_${U}`, 'coachingFeedback.handleFeedbackButton'],
  ['resume_yes:coaching', 'resume.handleResumeButton'],
  // A tier without the coaching survey (staging, until it is promoted) has no
  // coaching_fb_ button to route.
].filter(([, owner]) => HAS_COACHING_SURVEY || !owner.startsWith('coachingFeedback.'));

describe('the lesson-plan day: one owner per button', () => {
  beforeEach(() => jest.resetModules());

  test.each(LP_DAY_IDS)('%s → %s, and nobody else', async (buttonId, owner) => {
    const o = owners();
    mockBoundary(o);
    const { app } = require('../../bot/whatsapp-bot');

    await postWebhook(app, webhookBody(buttonId));

    const called = [];
    for (const [svc, fns] of Object.entries(o)) {
      for (const [fn, mock] of Object.entries(fns)) {
        if (!jest.isMockFunction(mock) || svc === 'resume' && fn === 'sweep') continue;
        const claimed = mock.mock.calls.length > 0
          && (svc !== 'resume' || await mock.mock.results[0].value);
        if (claimed) called.push(`${svc}.${fn}`);
      }
    }
    expect(called).toEqual([owner]);
    const [svc, fn] = owner.split('.');
    const args = o[svc][fn].mock.calls[0];
    expect(args).toContain(buttonId);
  });
});
