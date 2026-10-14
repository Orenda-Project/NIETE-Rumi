'use strict';
/**
 * v10 coaching test (bd-v0toag.46): the record line on the coaching ask.
 *
 * In the test, every group (A-D) gets the same signed-off line at the end of the ask:
 * "Record as usual. If you can, record the whole lesson, start to end: it gives a fuller
 * analysis." No new ask, no new button. Outside the test (switch off, school not drawn, a
 * lookup error: groupFor returns null) the ask is exactly today's.
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
}));
jest.mock('../../bot/shared/services/feature-intro.service', () => ({
  introShownCount: jest.fn().mockResolvedValue(0),
  markVideoShown: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../bot/shared/services/coaching/ab-v10-arms', () => ({ groupFor: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const { installFrom } = require('../quiz/helpers/supabase-chain');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { groupFor } = require('../../bot/shared/services/coaching/ab-v10-arms');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
const Ask = require('../../bot/shared/services/nudges/lp-coaching-ask.service');

const USER = '11111111-1111-4111-8111-111111111111';
const NUDGE = '22222222-2222-4222-8222-222222222222';
const TODAY = '2026-09-22';
const NOW = new Date(Date.parse(`${TODAY}T00:00:00Z`) + (8 * 60 - 300) * 60000);
const LINE_EN = 'Record as usual. If you can, record the whole lesson, start to end: it gives a fuller analysis.';

const askRow = (context = { lesson_id: 'g3_eng_ch2_seg1', first_time: false }) => ({
  id: NUDGE, user_id: USER, kind: 'coaching_after_lp', nudge_date: TODAY, status: 'sending', context,
});

function teacher(language = 'en') {
  installFrom(supabase.from, {
    users: { data: [{ id: USER, phone_number: '923001234567', preferred_language: language, last_message_at: new Date(NOW.getTime() - 60000).toISOString() }], error: null },
    coaching_sessions: { data: [], error: null },
    quizzes: { data: [], error: null },
  });
}

const sentBody = () => WhatsAppService.sendInteractiveButtons.mock.calls[0][1].body;

describe('the record line on the coaching ask (v10 test)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'performance'] });
    jest.setSystemTime(NOW);
    process.env.LP_COACHING_ASK_ENABLED = 'true';
    delete process.env.LP_COACHING_HOWTO_VIDEO_EN;
    teacher();
  });
  afterEach(() => {
    jest.useRealTimers();
    delete process.env.LP_COACHING_ASK_ENABLED;
  });

  test('the signed-off wording, in English and a gender-neutral Urdu', () => {
    expect(UX_STRINGS.lpAskRecordLine.en).toBe(LINE_EN);
    expect(UX_STRINGS.lpAskRecordLine.ur).toBeTruthy();
  });

  test.each(['A', 'B', 'C', 'D'])('group %s: today\'s ask, then the same line', async (group) => {
    groupFor.mockResolvedValue({ group });
    await Ask.send(askRow(), { now: NOW });
    expect(sentBody()).toBe(`${UX_STRINGS.lpAskBody.en}\n\n${LINE_EN}`);
    expect(WhatsAppService.sendInteractiveButtons.mock.calls[0][1].buttons).toHaveLength(2);
    expect(logEvent).toHaveBeenCalledWith('lp_ask.sent', expect.objectContaining({ abGroup: group }));
  });

  test('in Urdu, on the first-time ask too, and under the 1,024 code-point cap', async () => {
    teacher('ur');
    groupFor.mockResolvedValue({ group: 'C' });
    await Ask.send(askRow({ lesson_id: 'l1', first_time: true }), { now: NOW });
    expect(sentBody()).toBe(`${UX_STRINGS.lpAskBodyFirstTime.ur}\n\n${UX_STRINGS.lpAskRecordLine.ur}`);
    for (const key of ['lpAskBody', 'lpAskBodyFirstTime', 'lpAskBodyNextDay', 'lpAskBodyFirstTimeNextDay']) {
      for (const lang of ['en', 'ur']) {
        expect([...`${UX_STRINGS[key][lang]}\n\n${UX_STRINGS.lpAskRecordLine[lang]}`].length).toBeLessThanOrEqual(1024);
      }
    }
  });

  test('outside the test the ask is exactly today\'s', async () => {
    groupFor.mockResolvedValue(null);
    await Ask.send(askRow(), { now: NOW });
    expect(sentBody()).toBe(UX_STRINGS.lpAskBody.en);
    expect(logEvent).toHaveBeenCalledWith('lp_ask.sent', expect.objectContaining({ abGroup: null }));
  });

  test('a lookup that throws: today\'s ask, still sent', async () => {
    groupFor.mockRejectedValue(new Error('down'));
    const res = await Ask.send(askRow(), { now: NOW });
    expect(res).toMatchObject({ sent: true });
    expect(sentBody()).toBe(UX_STRINGS.lpAskBody.en);
  });
});
