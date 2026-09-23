'use strict';
/**
 * The coaching ask never says "today" about a lesson planned the day before.
 *
 * A lesson taken at or after 14:00 PKT books its ask for 07:30 on the NEXT
 * school day (`scheduleFor`, branch `next_school_day`). The body said "You
 * planned a lesson with me today … Would you like to record today's lesson?" —
 * so a teacher who planned at 16:30 read, the next morning, that they had
 * planned it that morning. The row's context carries `delivered_at`; when the
 * PKT day the ask goes out is later than the PKT day of that delivery, the body
 * names when the lesson was planned ("yesterday", or the date across a weekend)
 * and asks to record it when it is taught.
 *
 * The real send handler runs at the instant the real `scheduleFor` books.
 * WhatsApp, supabase, the store and the intro-video bookkeeping are mocked at
 * the boundary.
 */

jest.mock('../../bot/shared/services/nudges/teacher-nudges.store', () => ({
  schedule: jest.fn(),
  rowsFor: jest.fn(async () => []),
  markSent: jest.fn(), markSkipped: jest.fn(), markFailed: jest.fn(), recordAnswer: jest.fn(),
  KINDS: { COACHING_AFTER_LP: 'coaching_after_lp', LP_QUIZ_OFFER: 'lp_quiz_offer' },
}));
jest.mock('../../bot/shared/services/nudges/teacher-nudges.sweeper', () => ({
  register: jest.fn(), runSweep: jest.fn(),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendVideoByLink: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/feature-intro.service', () => ({
  introShownCount: jest.fn().mockResolvedValue(0),
  markVideoShown: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const { installFrom } = require('../quiz/helpers/supabase-chain');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Store = require('../../bot/shared/services/nudges/teacher-nudges.store');
const { atPkt } = require('../../bot/shared/services/nudges/pkt-time');
const { resolveUx, UX_STRINGS } = require('../../bot/shared/config/ux-strings');
const Ask = require('../../bot/shared/services/nudges/lp-coaching-ask.service');

const USER = '11111111-1111-4111-8111-111111111111';
const NUDGE = '22222222-2222-4222-8222-222222222222';
const PHONE = '923001234567';

/** The booking the real scheduler makes for a lesson delivered at `deliveredAt`, and its row. */
function booked(deliveredAt, { firstTime = false } = {}) {
  const { nudgeDate, scheduledAt, branch } = Ask.scheduleFor(deliveredAt, { delay: 10 });
  return {
    branch,
    at: scheduledAt,
    row: {
      id: NUDGE, user_id: USER, kind: 'coaching_after_lp', nudge_date: nudgeDate, status: 'sending',
      scheduled_at: scheduledAt.toISOString(),
      context: { lesson_id: 'grade_4_math_ch5_seg3', delivered_at: deliveredAt.toISOString(), first_time: firstTime },
    },
  };
}

function tables(lang, lastMessageAt) {
  installFrom(supabase.from, {
    users: { data: [{ id: USER, phone_number: PHONE, preferred_language: lang, last_message_at: lastMessageAt.toISOString(), role: 'teacher' }], error: null },
    coaching_sessions: { data: [], error: null },
    quizzes: { data: [], error: null },
  });
}

async function sendAt({ deliveredAt, lang = 'en', firstTime = false }) {
  const b = booked(deliveredAt, { firstTime });
  // The teacher wrote to the bot shortly before the ask, so the window is open.
  tables(lang, new Date(b.at.getTime() - 30 * 60000));
  const res = await Ask.send(b.row, { now: b.at });
  const [, opts] = WhatsAppService.sendInteractiveButtons.mock.calls[0] || [];
  return { res, body: opts && opts.body, branch: b.branch };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.LP_COACHING_ASK_ENABLED = 'true';
  delete process.env.LP_COACHING_ASK_WEEKLY_CAP;
  delete process.env.LP_COACHING_HOWTO_VIDEO_EN;
  delete process.env.LP_COACHING_HOWTO_VIDEO_UR;
  Store.rowsFor.mockResolvedValue([]);
});
afterEach(() => { delete process.env.LP_COACHING_ASK_ENABLED; });

describe('planned in the evening, asked the next morning', () => {
  // Monday 16:30 PKT → the ask goes out Tuesday 07:30 PKT.
  const MONDAY_EVENING = atPkt('2026-09-21', 16, 30);

  test('the premise: this booking really is next-morning', () => {
    const b = booked(MONDAY_EVENING);
    expect(b.branch).toBe('next_school_day');
    expect(b.row.nudge_date).toBe('2026-09-22');
  });

  test('the body says the lesson was planned yesterday, never "today"', async () => {
    const { res, body } = await sendAt({ deliveredAt: MONDAY_EVENING });
    expect(res).toMatchObject({ sent: true });
    expect(body).not.toMatch(/today/i);
    expect(body).toBe(resolveUx('lpAskBodyNextDay', {
      language: 'en', params: { when: resolveUx('lpAskWhenYesterday', { language: 'en' }) },
    }));
    expect(body).toMatch(/yesterday/);
    expect(res.context.body).toBe('lpAskBodyNextDay');
  });

  test('in Urdu, first time: the first-time copy, next-day form, with no آج in it', async () => {
    const { body } = await sendAt({ deliveredAt: MONDAY_EVENING, lang: 'ur', firstTime: true });
    expect(body).not.toMatch(/آج/);
    expect(body).toBe(resolveUx('lpAskBodyFirstTimeNextDay', {
      language: 'ur', params: { when: resolveUx('lpAskWhenYesterday', { language: 'ur' }) },
    }));
  });
});

describe('planned on Friday evening, asked on Monday morning', () => {
  const FRIDAY_EVENING = atPkt('2026-09-18', 16, 0);

  test('the body names the day it was planned — not "today", and not "yesterday"', async () => {
    const { res, body, branch } = await sendAt({ deliveredAt: FRIDAY_EVENING });
    expect(branch).toBe('next_school_day');
    expect(res).toMatchObject({ sent: true });
    expect(body).not.toMatch(/today|yesterday/i);
    expect(body).toContain('on 18 Sep');
  });

  test('in Urdu it carries the date, isolated, and neither آج nor کل', async () => {
    const { body } = await sendAt({ deliveredAt: FRIDAY_EVENING, lang: 'ur' });
    expect(body).toContain('⁨18 ستمبر⁩ کو');
    expect(body).not.toMatch(/آج|کل /);
  });
});

describe('planned and asked on the same day', () => {
  test('a morning lesson keeps the "today" copy, unchanged', async () => {
    const { res, body } = await sendAt({ deliveredAt: atPkt('2026-09-22', 8, 0) });
    expect(res).toMatchObject({ sent: true });
    expect(body).toBe(UX_STRINGS.lpAskBody.en);
  });

  test('a row with no delivered_at (booked before this change) keeps the "today" copy', async () => {
    const b = booked(atPkt('2026-09-21', 16, 30));
    delete b.row.context.delivered_at;
    tables('en', new Date(b.at.getTime() - 30 * 60000));
    await Ask.send(b.row, { now: b.at });
    expect(WhatsAppService.sendInteractiveButtons.mock.calls[0][1].body).toBe(UX_STRINGS.lpAskBody.en);
  });
});
