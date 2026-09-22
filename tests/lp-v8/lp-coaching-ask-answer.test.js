'use strict';
/**
 * 4.3 — the teacher answers the coaching ask.
 *
 * "Record my lesson" goes through the SAME door as the menu's Classroom
 * Coaching row: the real `MenuService._handleClassroomCoachingChoice` runs, the
 * real conversation-state service writes the users row, and only WhatsApp,
 * Supabase and the LLM client are mocked at the network boundary. The copy that
 * door sends is the catalog's `lpAskYesReply` — the mic, 20–45 minutes — and no
 * longer the old "at least 15 minutes" line, for every entry into it.
 */

jest.mock('../../bot/shared/services/nudges/teacher-nudges.store', () => ({
  schedule: jest.fn(),
  rowsFor: jest.fn(async () => []),
  recordAnswer: jest.fn(async () => true),
  KINDS: { COACHING_AFTER_LP: 'coaching_after_lp', LP_QUIZ_OFFER: 'lp_quiz_offer' },
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendVideoByLink: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({}),
  getClientForModel: (m) => ({ client: {}, model: String(m || '') }),
}));
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  storeConversation: jest.fn(), getOrCreateSession: jest.fn().mockResolvedValue('session-1'),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const { installFrom } = require('../quiz/helpers/supabase-chain');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Store = require('../../bot/shared/services/nudges/teacher-nudges.store');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
const MenuService = require('../../bot/shared/services/menu.service');
const Ask = require('../../bot/shared/services/nudges/lp-coaching-ask.service');

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const NUDGE = '22222222-2222-4222-8222-222222222222';
const PHONE = '923001234567';
const teacher = (over = {}) => ({ id: USER, phone_number: PHONE, preferred_language: 'en', role: 'teacher', ...over });

function tables({ nudge = { id: NUDGE, user_id: USER, kind: 'coaching_after_lp', choice: null } } = {}) {
  installFrom(supabase.from, {
    teacher_nudges: { data: nudge ? [nudge] : [], error: null },
    // conversation-state reads the row, then writes it back with an update.
    users: { data: [{ conversation_state: null, conversation_state_expires_at: null }], error: null },
  });
}

/** The conversation_state the real state service wrote to the users row. */
function writtenState() {
  const updates = supabase.from.callsFor('users')
    .flatMap((calls) => calls.filter((c) => c[0] === 'update').map((c) => c[1]));
  return updates.map((u) => u.conversation_state).filter(Boolean).pop() || null;
}

beforeEach(() => {
  jest.clearAllMocks();
  Store.recordAnswer.mockResolvedValue(true);
  tables();
});

describe('"Record my lesson"', () => {
  test('records yes on the row and opens the Classroom Coaching wait through the menu door', async () => {
    const spy = jest.spyOn(MenuService, '_handleClassroomCoachingChoice');
    const handled = await Ask.handleButton(`lpask_yes_${NUDGE}`, PHONE, teacher());
    expect(handled).toBe(true);
    expect(Store.recordAnswer).toHaveBeenCalledWith(NUDGE, { choice: 'yes' });
    expect(spy).toHaveBeenCalledWith(USER, 'session-1', PHONE, 'en');
    const state = writtenState();
    expect(state).not.toBeNull();
    expect(JSON.stringify(state)).toContain('AWAITING_CLASSROOM_AUDIO');
    expect(logEvent).toHaveBeenCalledWith('lp_ask.answered', expect.objectContaining({ choice: 'yes', nudgeId: NUDGE }));
    spy.mockRestore();
  });

  test('the reply is the mic instruction for 20–45 minutes, in the teacher\'s language', async () => {
    await Ask.handleButton(`lpask_yes_${NUDGE}`, PHONE, teacher({ preferred_language: 'ur' }));
    const texts = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
    expect(texts).toContain(UX_STRINGS.lpAskYesReply.ur);
  });

  test('a tap on a row that belongs to someone else records nothing but still answers', async () => {
    tables({ nudge: { id: NUDGE, user_id: OTHER, kind: 'coaching_after_lp', choice: null } });
    const handled = await Ask.handleButton(`lpask_yes_${NUDGE}`, PHONE, teacher());
    expect(handled).toBe(true);
    expect(Store.recordAnswer).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage.mock.calls.map((c) => c[1])).toContain(UX_STRINGS.lpAskYesReply.en);
  });
});

describe('"Not today"', () => {
  test('records no and sends one line, nothing else', async () => {
    const handled = await Ask.handleButton(`lpask_no_${NUDGE}`, PHONE, teacher());
    expect(handled).toBe(true);
    expect(Store.recordAnswer).toHaveBeenCalledWith(NUDGE, { choice: 'no' });
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, UX_STRINGS.lpAskDeclined.en);
    expect(writtenState()).toBeNull();
  });
});

describe('ids that are not ours', () => {
  test.each(['tq_yes_x', 'lpquiz_yes_' + NUDGE, 'lpask_maybe_' + NUDGE, 'lpask_yes_not-a-uuid', ''])(
    '%s falls through', async (id) => {
      expect(await Ask.handleButton(id, PHONE, teacher())).toBe(false);
      expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
    },
  );
});

describe('the one coaching door, from the menu too', () => {
  test.each(['en', 'ur'])('%s: the menu entry sends lpAskYesReply and never "15 minutes"', async (lang) => {
    await MenuService._handleClassroomCoachingChoice(USER, 'session-1', PHONE, lang);
    const [, text] = WhatsAppService.sendMessage.mock.calls[0];
    expect(text).toBe(UX_STRINGS.lpAskYesReply[lang]);
    expect(text).not.toMatch(/15 minutes|15 منٹ/);
    expect(text).toMatch(/20/);
    expect(text).toMatch(/45/);
  });

  test('the yes-reply and the ask copy carry no gendered pronoun for the teacher', () => {
    const keys = ['lpAskBody', 'lpAskBodyFirstTime', 'lpAskYes', 'lpAskNo', 'lpAskYesReply',
      'lpAskHowtoCaption', 'lpAskDeclined', 'lpAskTooShort'];
    for (const k of keys) {
      expect(UX_STRINGS[k].en).not.toMatch(/\b(she|her|hers|he|him|his)\b/i);
      // Urdu gendered forms the language audit checks for the addressee.
      expect(UX_STRINGS[k].ur).not.toMatch(/(سکتی ہیں|سکتا ہے|کرتی ہیں|رہی ہیں|گئی ہیں|چاہتی ہیں)/);
      expect(UX_STRINGS[k].en).not.toMatch(/you taught/i);
    }
  });
});

describe('yesterday\'s unanswered asks are "ignored"', () => {
  beforeEach(() => { process.env.LP_COACHING_ASK_ENABLED = 'true'; });
  afterEach(() => { delete process.env.LP_COACHING_ASK_ENABLED; });

  test('one bounded update, once per PKT day', async () => {
    installFrom(supabase.from, { teacher_nudges: { data: [{ id: 'a' }, { id: 'b' }], error: null } });
    const now = new Date('2026-09-23T03:00:00Z'); // 08:00 PKT Wednesday
    expect(await Ask.markIgnored({ now })).toBe(2);
    const calls = supabase.from.callsFor('teacher_nudges')[0];
    expect(calls).toEqual(expect.arrayContaining([
      ['update', expect.objectContaining({ choice: 'ignored' })],
      ['eq', 'kind', 'coaching_after_lp'],
      ['eq', 'status', 'sent'],
      ['is', 'choice', null],
      ['lt', 'nudge_date', '2026-09-23'],
      ['gte', 'nudge_date', '2026-09-16'],
    ]));
    expect(await Ask.markIgnored({ now })).toBe(0);
    expect(supabase.from.callsFor('teacher_nudges')).toHaveLength(1);
  });
});
