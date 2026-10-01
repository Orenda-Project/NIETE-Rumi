'use strict';
/**
 * Meta bill cut NL1 (bd-w2daa.9): the lesson-plan survey's thank-you texts go; a reaction stays
 * (FX1, bd-w2daa.22: our own 🙏 on the tap, not the webhook's 👍 alone — see the TAP helper).
 *
 * From 1 Oct 2026 Meta bills every message we send. After every survey tap and every typed reason
 * the bot sent a text whose whole content was "thanks". The webhook already puts a 👍 reaction on
 * EVERY inbound message before any handler runs (whatsapp-bot.js, `sendReaction` right after the
 * processed-message check), and a reaction is free. So the text said nothing the reaction had not
 * already said, and it cost a billed message each time (~$262/month at the 7-day volumes).
 *
 * What must NOT change: anything that ASKS the teacher something. The 👎 "what didn't work?" line asks for
 * input, and the 👍-after-a-voice-note usage question asks for input. Both stay, and both are
 * pinned below so the cut cannot over-reach.
 *
 * Driven through the real services with only the network boundary faked: Supabase (a stateful
 * in-memory table set), the cache and WhatsApp.
 */

const { createMemorySupabase, createMemoryRedis } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase();
const mockRedis = createMemoryRedis();
jest.mock('../../bot/shared/config/supabase', () => mockDb);
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendReaction: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const LpFeedback = require('../../bot/shared/services/lp-feedback.service');
const Lp612Feedback = require('../../bot/shared/services/lp612-feedback.service');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

const PHONE = '923001234567';
const TEACHER = '11111111-1111-4111-8111-111111111111';
const LP = '33333333-3333-4333-8333-333333333333';
const SEGMENT_ID = 'grade_9_chemistry.c01.p007-008';

function seed({ language = 'en', triggerMode = 'after_pdf_only', feedback = [] } = {}) {
  mockDb.reset({
    users: [{ id: TEACHER, phone_number: PHONE, preferred_language: language }],
    lesson_plans: [{
      id: LP, user_id: TEACHER, topic: 'Introducing Myself', grade: '1', subject: 'english',
      type: 'lesson_plan',
      content: { chapter_number: 1, segment_number: 3, lp_variant: 'niete_v8_segment', grade: 1,
        subject: 'english', trigger_mode: triggerMode },
    }],
    lp_feedback: feedback,
    niete_lp612_segments: [{ segment_id: SEGMENT_ID, grade: 9, subject: 'chemistry', chapter_number: 1,
      subtopic_title: 'Atoms', menu_title: 'Atoms' }],
  });
}

const texts = () => WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
// FX1 (bd-w2daa.22): the receipt is a 🙏 reaction on the teacher's own message (the tap's wamid),
// not the webhook's 👍 alone. Without a wamid the original text goes — pinned at the end.
const TAP = { messageId: 'wamid.TAP_1' };
const thanked = () => WhatsAppService.sendReaction.mock.calls.map((c) => c[2]);
const buttonMessages = () => WhatsAppService.sendInteractiveButtons.mock.calls.map((c) => c[1]);

beforeEach(() => {
  jest.clearAllMocks();
  mockRedis.reset();
  seed();
});

// ── grades 1-5 (lp-feedback.service) ───────────────────────────────────────────
describe('K-5 survey: a tap that only needed a receipt gets the reaction, not a text', () => {
  test.each(['en', 'ur'])('👍 on a PDF-only lesson (%s) records the verdict and sends NOTHING', async (language) => {
    seed({ language });
    expect(await LpFeedback.handleFeedbackButton(`lp_feedback_yes_${LP}`, PHONE, TAP)).toBe(true);

    expect(mockDb.rows('lp_feedback')).toHaveLength(1);
    expect(mockDb.rows('lp_feedback')[0]).toMatchObject({ user_id: TEACHER, lesson_plan_id: LP, useful: true });
    expect(texts()).toEqual([]);
    expect(thanked()).toEqual(['🙏']);   // FX1: our own receipt on the tap
    expect(buttonMessages()).toEqual([]);
  });

  test('a repeat 👍 on the same lesson sends NOTHING (it used to re-thank the teacher)', async () => {
    seed({ feedback: [{ id: 'fb-1', user_id: TEACHER, lesson_plan_id: LP, useful: true }] });
    expect(await LpFeedback.handleFeedbackButton(`lp_feedback_yes_${LP}`, PHONE, TAP)).toBe(true);
    expect(texts()).toEqual([]);
    expect(thanked()).toEqual(['🙏']);   // FX1: our own receipt on the tap
  });

  test('a 👍 whose row could not be written still sends NOTHING — and is still owned', async () => {
    seed();
    const realFrom = mockDb.from.getMockImplementation();
    mockDb.from.mockImplementation((table) => {
      const b = realFrom(table);
      if (table !== 'lp_feedback') return b;
      const origInsert = b.insert;
      b.insert = (p) => { origInsert(p); return { select: () => ({ single: async () => ({ data: null, error: { message: 'boom' } }) }) }; };
      return b;
    });
    try {
      expect(await LpFeedback.handleFeedbackButton(`lp_feedback_yes_${LP}`, PHONE, TAP)).toBe(true);
    } finally {
      mockDb.from.mockImplementation(realFrom);
    }
    expect(texts()).toEqual([]);
    expect(thanked()).toEqual(['🙏']);   // FX1: our own receipt on the tap
  });

  test('a tap on a lesson we cannot find sends NOTHING, and is still owned', async () => {
    mockDb.reset({ users: [], lesson_plans: [], lp_feedback: [] });
    expect(await LpFeedback.handleFeedbackButton(`lp_feedback_yes_${LP}`, PHONE)).toBe(true);
    expect(texts()).toEqual([]);
  });

  test('the usage answer ("Taught it today") is recorded and sends NOTHING', async () => {
    seed({ triggerMode: 'after_voice_note', feedback: [{ id: 'fb-1', user_id: TEACHER, lesson_plan_id: LP, useful: true }] });
    expect(await LpFeedback.handleUsageButton(`lp_used_taught_${LP}`, PHONE, TAP)).toBe(true);
    expect(mockDb.rows('lp_feedback')[0].used_in_class).toBe('taught');
    expect(texts()).toEqual([]);
    expect(thanked()).toEqual(['🙏']);   // FX1: our own receipt on the tap
  });

  test('the typed reason after 👎 is saved and sends NOTHING (the reaction is the receipt)', async () => {
    seed({ language: 'ur' });
    await LpFeedback.handleFeedbackButton(`lp_feedback_no_${LP}`, PHONE);
    WhatsAppService.sendMessage.mockClear();

    expect(await LpFeedback.consumeReasonIfPending(TEACHER, PHONE, 'سرگرمیاں بہت لمبی تھیں', TAP)).toBe(true);
    expect(mockDb.rows('lp_feedback')[0].reason_text).toBe('سرگرمیاں بہت لمبی تھیں');
    expect(texts()).toEqual([]);
    expect(thanked()).toEqual(['🙏']);   // FX1: our own receipt on the tap
  });

  test('an orphaned reason (the 👎 row never landed) is consumed and sends NOTHING', async () => {
    await mockRedis.set(LpFeedback.REDIS_REASON_KEY(TEACHER), { lpFeedbackId: '__orphan__', lessonPlanId: LP }, 600);
    expect(await LpFeedback.consumeReasonIfPending(TEACHER, PHONE, 'too long', TAP)).toBe(true);
    expect(texts()).toEqual([]);
    expect(thanked()).toEqual(['🙏']);   // FX1: our own receipt on the tap
  });

  // ── the asks stay ─────────────────────────────────────────────────────────
  test('👎 STILL asks what did not work — that line asks for input, it is not a receipt', async () => {
    expect(await LpFeedback.handleFeedbackButton(`lp_feedback_no_${LP}`, PHONE)).toBe(true);
    expect(texts()).toHaveLength(1);
    expect(texts()[0]).toMatch(/What didn't work\?/);
  });

  test('a repeat 👎 STILL re-asks for the reason', async () => {
    seed({ feedback: [{ id: 'fb-1', user_id: TEACHER, lesson_plan_id: LP, useful: true }] });
    await LpFeedback.handleFeedbackButton(`lp_feedback_no_${LP}`, PHONE);
    expect(texts()).toHaveLength(1);
    expect(texts()[0]).toMatch(/What didn't work\?/);
  });

  test('👍 after a voice note STILL asks whether the lesson was taught', async () => {
    seed({ triggerMode: 'after_voice_note' });
    await LpFeedback.handleFeedbackButton(`lp_feedback_yes_${LP}`, PHONE);
    expect(buttonMessages()).toHaveLength(1);
    expect(buttonMessages()[0].body).toMatch(/use it in class/);
    expect(texts()).toEqual([]);
  });
});

// ── grades 6-12 (lp612-feedback.service) ───────────────────────────────────────
describe('6-12 survey: same rule, catalog strings', () => {
  test.each(['en', 'ur'])('the usage answer (%s) is recorded and sends NOTHING', async (language) => {
    seed({ language, feedback: [{ id: 'fb-9', user_id: TEACHER, lp612_segment_id: SEGMENT_ID, useful: true }] });
    expect(await Lp612Feedback.handleUsageButton(`lp612_used_planned_${SEGMENT_ID}`, PHONE, TAP)).toBe(true);
    expect(mockDb.rows('lp_feedback')[0].used_in_class).toBe('planned');
    expect(texts()).toEqual([]);
    expect(thanked()).toEqual(['🙏']);   // FX1: our own receipt on the tap
  });

  test('a usage tap from a phone we cannot attribute is owned and sends NOTHING', async () => {
    mockDb.reset({ users: [], lp_feedback: [] });
    expect(await Lp612Feedback.handleUsageButton(`lp612_used_taught_${SEGMENT_ID}`, PHONE, TAP)).toBe(true);
    expect(texts()).toEqual([]);
    expect(thanked()).toEqual(['🙏']);   // FX1: our own receipt on the tap
  });

  test('the typed reason after 👎 is saved and sends NOTHING', async () => {
    await Lp612Feedback.handleFeedbackButton(`lp612_fb_no_en_${SEGMENT_ID}`, PHONE);
    expect(texts()).toEqual([resolveUx('lp612FeedbackAskReason', { language: 'en' })]); // the ask stays
    WhatsAppService.sendMessage.mockClear();

    expect(await Lp612Feedback.consumeReasonIfPending(TEACHER, PHONE, 'needs apparatus we do not have', TAP)).toBe(true);
    expect(mockDb.rows('lp_feedback')[0].reason_text).toBe('needs apparatus we do not have');
    expect(texts()).toEqual([]);
    expect(thanked()).toEqual(['🙏']);   // FX1: our own receipt on the tap
  });

  test('an orphaned 6-12 reason is consumed and sends NOTHING', async () => {
    await mockRedis.set(Lp612Feedback.REDIS_REASON_KEY(TEACHER), { feedbackId: '__orphan__', segmentId: SEGMENT_ID }, 600);
    expect(await Lp612Feedback.consumeReasonIfPending(TEACHER, PHONE, 'too long', TAP)).toBe(true);
    expect(texts()).toEqual([]);
    expect(thanked()).toEqual(['🙏']);   // FX1: our own receipt on the tap
  });

  test('👍 STILL asks whether the lesson was taught (Q2 asks for input)', async () => {
    await Lp612Feedback.handleFeedbackButton(`lp612_fb_yes_en_${SEGMENT_ID}`, PHONE);
    expect(buttonMessages()).toHaveLength(1);
    expect(buttonMessages()[0].body).toBe(resolveUx('lp612UsedAsk', { language: 'en' }));
    expect(texts()).toEqual([]);
  });
});

describe('FX1 — no wamid (or the reaction refused) → the original thank-you text, never silence', () => {
  test.each([
    ['en', 'Thanks — glad it helped!'], ['ur', 'شکریہ — خوشی ہے یہ مفید تھی!'],
  ])('K-5 👍 without a wamid (%s) → "%s"', async (language, expected) => {
    seed({ language });
    await LpFeedback.handleFeedbackButton(`lp_feedback_yes_${LP}`, PHONE);
    expect(thanked()).toEqual([]);
    expect(texts()).toEqual([expected]);
  });

  test('6-12 usage answer, reaction refused → lp612UsedThanks', async () => {
    WhatsAppService.sendReaction.mockResolvedValueOnce(false);
    seed({ feedback: [{ id: 'fb-612', user_id: TEACHER, lp612_segment_id: SEGMENT_ID, useful: true }] });
    await Lp612Feedback.handleUsageButton(`lp612_used_taught_${SEGMENT_ID}`, PHONE, TAP);
    expect(texts()).toEqual([resolveUx('lp612UsedThanks', { language: 'en' })]);
  });
});
