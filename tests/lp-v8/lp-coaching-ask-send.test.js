'use strict';
/**
 * 4.2 — the ask, at send time.
 *
 * The sweeper hands this handler a row it has already claimed. Everything the
 * teacher's day might have done between the lesson landing and this moment is
 * re-checked HERE, in the ladder's order, because the schedule was written minutes or
 * a night ago: a lesson may have been recorded since, an analysis may be
 * running, an offer may have gone out, the weekly budget may be spent, or the
 * 24-hour service window may have closed underneath a free-form send.
 *
 * The real handler runs in every case. WhatsApp, Supabase, the store and the
 * intro-video bookkeeping are mocked at the network boundary; the skip ladder,
 * the copy, the button ids and the clip gate are not.
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
  sendVideoWithButtons: jest.fn().mockResolvedValue(true),
  sendVideoByLink: jest.fn().mockResolvedValue(true),
  sendVideoFromUrl: jest.fn().mockResolvedValue(true),
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
const FeatureIntro = require('../../bot/shared/services/feature-intro.service');
const Store = require('../../bot/shared/services/nudges/teacher-nudges.store');
const Sweeper = require('../../bot/shared/services/nudges/teacher-nudges.sweeper');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');

const Ask = require('../../bot/shared/services/nudges/lp-coaching-ask.service');
// Captured at load, before any beforeEach clears the mocks: the registration
// happens once, when the module is first required.
const REGISTRATIONS = Sweeper.register.mock.calls.slice();

const USER = '11111111-1111-4111-8111-111111111111';
const NUDGE = '22222222-2222-4222-8222-222222222222';
const PHONE = '923001234567';
const TODAY = '2026-09-22';                       // Tuesday
const DAY = 24 * 60 * 60 * 1000;

/** 08:00 PKT on the nudge date — inside school hours, outside quiet hours. */
const NOW = new Date(Date.parse(`${TODAY}T00:00:00Z`) + (8 * 60 - 300) * 60000);

const askRow = (over = {}) => ({
  id: NUDGE, user_id: USER, kind: 'coaching_after_lp', nudge_date: TODAY,
  status: 'sending', scheduled_at: NOW.toISOString(),
  context: { lesson_id: 'g3_eng_ch2_seg1', first_time: false }, ...over,
});

function tables({ user = {}, coaching = [], quizzes = [] } = {}) {
  installFrom(supabase.from, {
    users: { data: [{ id: USER, phone_number: PHONE, preferred_language: 'en', last_message_at: new Date(NOW.getTime() - 60000).toISOString(), ...user }], error: null },
    coaching_sessions: { data: coaching, error: null },
    quizzes: { data: quizzes, error: null },
  });
}

describe('the coaching ask goes out', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'performance'] });
    jest.setSystemTime(NOW);
    process.env.LP_COACHING_ASK_ENABLED = 'true';
    delete process.env.LP_COACHING_ASK_WEEKLY_CAP;
    delete process.env.LP_COACHING_HOWTO_VIDEO_EN;
    delete process.env.LP_COACHING_HOWTO_VIDEO_UR;
    Store.rowsFor.mockResolvedValue([]);
    FeatureIntro.introShownCount.mockResolvedValue(0);
    tables();
  });
  afterEach(() => {
    jest.useRealTimers();
    delete process.env.LP_COACHING_ASK_ENABLED;
    delete process.env.LP_COACHING_HOWTO_VIDEO_EN;
  });

  test('the handler registers itself with the sweeper at module load', () => {
    expect(Ask.KIND).toBe('coaching_after_lp');
    expect(REGISTRATIONS).toHaveLength(1);
    expect(REGISTRATIONS[0][0]).toBe('coaching_after_lp');
    expect(typeof REGISTRATIONS[0][1]).toBe('function');
    expect(REGISTRATIONS[0][1]).toBe(Ask.send);
  });

  test('the body and both buttons reach the teacher, with the nudge id on each button', async () => {
    const res = await Ask.send(askRow());
    expect(res).toMatchObject({ sent: true });
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    const [to, opts] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(to).toBe(PHONE);
    expect(opts.body).toBe(UX_STRINGS.lpAskBody.en);
    expect(opts.buttons.map((b) => b.id)).toEqual([`lpask_yes_${NUDGE}`, `lpask_no_${NUDGE}`]);
    expect(opts.buttons.map((b) => b.title)).toEqual([UX_STRINGS.lpAskYes.en, UX_STRINGS.lpAskNo.en]);
  });

  test('a teacher who has never been coached gets the first-time copy, in their language', async () => {
    tables({ user: { preferred_language: 'ur' } });
    await Ask.send(askRow({ context: { lesson_id: 'l1', first_time: true } }));
    const [, opts] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(opts.body).toBe(UX_STRINGS.lpAskBodyFirstTime.ur);
    expect(opts.buttons[0].title).toBe(UX_STRINGS.lpAskYes.ur);
  });

  test('with the flag unset nothing is sent', async () => {
    delete process.env.LP_COACHING_ASK_ENABLED;
    const res = await Ask.send(askRow());
    expect(res).toEqual({ skipped: 'disabled' });
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  });

  test('every button title fits the 20-code-point WhatsApp cap, in both languages', () => {
    for (const key of ['lpAskYes', 'lpAskNo']) {
      for (const lang of ['en', 'ur']) {
        expect([...UX_STRINGS[key][lang]].length).toBeLessThanOrEqual(20);
      }
    }
  });
});

describe('the skip ladder, in order', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'performance'] });
    jest.setSystemTime(NOW);
    process.env.LP_COACHING_ASK_ENABLED = 'true';
    process.env.LP_COACHING_ASK_WEEKLY_CAP = '2';
    Store.rowsFor.mockResolvedValue([]);
    FeatureIntro.introShownCount.mockResolvedValue(0);
    tables();
  });
  afterEach(() => { jest.useRealTimers(); delete process.env.LP_COACHING_ASK_ENABLED; delete process.env.LP_COACHING_ASK_WEEKLY_CAP; });

  const expectSkip = async (reason) => {
    const res = await Ask.send(askRow());
    expect(res).toEqual({ skipped: reason });
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith('lp_ask.skipped', expect.objectContaining({ reason }));
  };

  test('coached_today — a lesson was already recorded this morning', async () => {
    tables({ coaching: [{ id: 'c1', status: 'completed', created_at: new Date(NOW.getTime() - 3600000).toISOString(), observation_type: null }] });
    await expectSkip('coached_today');
  });

  // A session created today is coached_today (the first rung), so the in-flight
  // rung is reached only by one from yesterday: a sweep at 00:05 PKT with an
  // analysis started at 23:55.
  test('in_progress_coaching — an analysis is mid-flight (the voice handler\'s own guard)', async () => {
    const justAfterMidnight = new Date(Date.parse(`${TODAY}T00:00:00Z`) - 5 * 3600000 + 5 * 60000);
    jest.setSystemTime(justAfterMidnight);
    tables({ coaching: [{ id: 'c1', status: 'transcribing', created_at: new Date(justAfterMidnight.getTime() - 10 * 60000).toISOString(), observation_type: null }] });
    const res = await Ask.send(askRow(), { now: justAfterMidnight });
    expect(res).toEqual({ skipped: 'in_progress_coaching' });
  });

  test('in_progress_coaching — waiting on the teacher for a photo or a lesson plan', async () => {
    tables({ coaching: [{ id: 'c1', status: 'awaiting_classroom_photo', created_at: new Date(NOW.getTime() - 10 * 3600000).toISOString(), observation_type: null }] });
    await expectSkip('in_progress_coaching');
  });

  test('a stuck analysis from two days ago does not silence the ask', async () => {
    tables({ coaching: [{ id: 'c1', status: 'transcribing', created_at: new Date(NOW.getTime() - 2 * DAY).toISOString(), observation_type: null }] });
    expect(await Ask.send(askRow())).toMatchObject({ sent: true });
  });

  test('a photo gate abandoned two days ago does not silence it either', async () => {
    tables({ coaching: [{ id: 'c1', status: 'awaiting_lesson_plan', created_at: new Date(NOW.getTime() - 2 * DAY).toISOString(), observation_type: null }] });
    expect(await Ask.send(askRow())).toMatchObject({ sent: true });
  });

  test('a coach observing the teacher is not the teacher’s own session and never blocks the ask', async () => {
    tables({ coaching: [{ id: 'c1', status: 'transcribing', created_at: new Date(NOW.getTime() - 3600000).toISOString(), observation_type: 'leader_observation' }] });
    const res = await Ask.send(askRow());
    expect(res).toMatchObject({ sent: true });
  });

  test('offered_today — a quiz offer already went out today', async () => {
    tables({ quizzes: [{ id: 'q1', teacher_id: USER, created_at: NOW.toISOString(), meta: { offered_at: NOW.toISOString() } }] });
    await expectSkip('offered_today');
  });

  test('weekly_cap — two asks already went out this week', async () => {
    Store.rowsFor.mockResolvedValue([
      { id: 'a', status: 'sent', nudge_date: '2026-09-17', choice: 'yes' },
      { id: 'b', status: 'sent', nudge_date: '2026-09-18', choice: null },
    ]);
    await expectSkip('weekly_cap');
  });

  test('consecutive_day — one went out yesterday', async () => {
    process.env.LP_COACHING_ASK_WEEKLY_CAP = '5';
    Store.rowsFor.mockResolvedValue([{ id: 'a', status: 'sent', nudge_date: '2026-09-21', choice: 'yes' }]);
    await expectSkip('consecutive_day');
  });

  test('declined_streak — the last three asks were all "Not today"', async () => {
    process.env.LP_COACHING_ASK_WEEKLY_CAP = '9';
    Store.rowsFor.mockResolvedValue(
      ['2026-09-18', '2026-09-14', '2026-09-10'].map((nd) => ({ id: nd, status: 'sent', nudge_date: nd, choice: 'no' })),
    );
    await expectSkip('declined_streak');
  });

  test('window_closed — the teacher’s last message is over 24 hours old, so a free-form send would fail', async () => {
    tables({ user: { last_message_at: new Date(NOW.getTime() - 25 * 3600000).toISOString() } });
    await expectSkip('window_closed');
  });

  test('a teacher with no last_message_at at all is out of window, not silently in it', async () => {
    tables({ user: { last_message_at: null } });
    await expectSkip('window_closed');
  });
});

describe('the how-to clip', () => {
  // The clip used to go out as its own video message BEFORE the ask. Meta
  // fetches a linked video and delivers it after a text-sized message sent a
  // moment later, so on a real phone the clip landed UNDER the ask (sandbox,
  // 23 Sep). Now the clip is the ask's own header: one message, one delivery,
  // an order that cannot flip.
  const CLIP_EN = 'https://pub-example.r2.dev/howto_en.mp4';
  const CLIP_UR = 'https://pub-example.r2.dev/howto_ur.mp4';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'performance'] });
    jest.setSystemTime(NOW);
    process.env.LP_COACHING_ASK_ENABLED = 'true';
    process.env.LP_COACHING_HOWTO_VIDEO_EN = CLIP_EN;
    Store.rowsFor.mockResolvedValue([]);
    // clearAllMocks keeps implementations: without this, "never a third time"
    // leaves the count at 2 for every test after it.
    FeatureIntro.introShownCount.mockResolvedValue(0);
    WhatsAppService.sendVideoWithButtons.mockResolvedValue(true);
    tables();
  });
  afterEach(() => {
    jest.useRealTimers();
    delete process.env.LP_COACHING_ASK_ENABLED;
    delete process.env.LP_COACHING_HOWTO_VIDEO_EN;
    delete process.env.LP_COACHING_HOWTO_VIDEO_UR;
  });

  test('rides the ask as its VIDEO HEADER — one message, so the clip can never land after the ask', async () => {
    const res = await Ask.send(askRow());

    expect(WhatsAppService.sendVideoWithButtons).toHaveBeenCalledTimes(1);
    const [to, clip, body, buttons, opts] = WhatsAppService.sendVideoWithButtons.mock.calls[0];
    expect(to).toBe(PHONE);
    expect(clip).toBe(CLIP_EN);
    expect(body).toBe(UX_STRINGS.lpAskBody.en);
    expect(buttons.map((b) => b.id)).toEqual([`lpask_yes_${NUDGE}`, `lpask_no_${NUDGE}`]);
    expect(buttons.map((b) => b.title)).toEqual([UX_STRINGS.lpAskYes.en, UX_STRINGS.lpAskNo.en]);
    // The caption that used to ride the separate clip is the footer under it.
    expect(opts.footer).toBe(UX_STRINGS.lpAskHowtoCaption.en);
    // No second message of any kind.
    expect(WhatsAppService.sendVideoByLink).not.toHaveBeenCalled();
    expect(WhatsAppService.sendVideoFromUrl).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();

    expect(res).toMatchObject({ sent: true, context: expect.objectContaining({ howto: true }) });
    expect(FeatureIntro.markVideoShown).toHaveBeenCalledWith(USER, 'lp_coaching_howto', { incrementIntroCount: true });
    expect(logEvent).toHaveBeenCalledWith('lp_ask.howto_shown', expect.objectContaining({ userId: USER }));
  });

  test('rides the second send too', async () => {
    FeatureIntro.introShownCount.mockResolvedValue(1);
    await Ask.send(askRow());
    expect(WhatsAppService.sendVideoWithButtons).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  });

  test('never a third time — the plain ask goes, with no clip', async () => {
    FeatureIntro.introShownCount.mockResolvedValue(2);
    const res = await Ask.send(askRow());
    expect(WhatsAppService.sendVideoWithButtons).not.toHaveBeenCalled();
    expect(WhatsAppService.sendVideoByLink).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    expect(res.context.howto).toBe(false);
  });

  test('no clip variable for the teacher’s language means no clip, and the ask still goes', async () => {
    delete process.env.LP_COACHING_HOWTO_VIDEO_EN;
    await Ask.send(askRow());
    expect(WhatsAppService.sendVideoWithButtons).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
  });

  test('a header that fails never costs the teacher the ask: the plain ask goes, and the clip is not counted', async () => {
    WhatsAppService.sendVideoWithButtons.mockResolvedValueOnce(false);
    const res = await Ask.send(askRow());
    expect(res).toMatchObject({ sent: true, context: expect.objectContaining({ howto: false }) });
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    const [, opts] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(opts.body).toBe(UX_STRINGS.lpAskBody.en);
    expect(FeatureIntro.markVideoShown).not.toHaveBeenCalledWith(USER, 'lp_coaching_howto', { incrementIntroCount: true });
  });

  test('both failing is a failed row (the sweeper marks it), never a quiet success', async () => {
    WhatsAppService.sendVideoWithButtons.mockResolvedValueOnce(false);
    WhatsAppService.sendInteractiveButtons.mockResolvedValueOnce(false);
    await expect(Ask.send(askRow())).rejects.toThrow(/not delivered/);
  });

  test('an Urdu teacher gets the Urdu clip, body and footer', async () => {
    process.env.LP_COACHING_HOWTO_VIDEO_UR = CLIP_UR;
    tables({ user: { preferred_language: 'ur' } });
    await Ask.send(askRow());
    const [, clip, body, buttons, opts] = WhatsAppService.sendVideoWithButtons.mock.calls[0];
    expect(clip).toBe(CLIP_UR);
    expect(body).toBe(UX_STRINGS.lpAskBody.ur);
    expect(buttons[0].title).toBe(UX_STRINGS.lpAskYes.ur);
    expect(opts.footer).toBe(UX_STRINGS.lpAskHowtoCaption.ur);
  });

  test('the message id of the ask is kept on the row (context.message_ids)', async () => {
    WhatsAppService.sendVideoWithButtons.mockImplementationOnce(async (_to, _clip, _body, _buttons, opts) => {
      opts.onMessageId('wamid.ASK1');
      return true;
    });
    const res = await Ask.send(askRow());
    expect(res.messageIds).toEqual(['wamid.ASK1']);
  });

  test('…and so is the plain ask’s', async () => {
    FeatureIntro.introShownCount.mockResolvedValue(2);
    WhatsAppService.sendInteractiveButtons.mockImplementationOnce(async (_to, _payload, opts) => {
      opts.onMessageId('wamid.ASK2');
      return true;
    });
    const res = await Ask.send(askRow());
    expect(res.messageIds).toEqual(['wamid.ASK2']);
  });
});

describe('the how-to caption (the footer under the clip)', () => {
  test('fits WhatsApp’s 60-code-point footer, in both languages', () => {
    for (const lang of ['en', 'ur']) {
      expect([...UX_STRINGS.lpAskHowtoCaption[lang]].length).toBeLessThanOrEqual(60);
    }
  });

  test('claims no length — the clip runs about 18 s, and WhatsApp prints its real length on the video itself', () => {
    expect(UX_STRINGS.lpAskHowtoCaption.en).not.toMatch(/\d|second|minute/i);
    expect(UX_STRINGS.lpAskHowtoCaption.ur).not.toMatch(/[0-9۰-۹]|سیکنڈ|منٹ/);
  });
});
