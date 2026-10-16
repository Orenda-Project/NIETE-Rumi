'use strict';
/**
 * bd-v0toag.10 (c) — "who helped?" one tap after a child finishes a lesson quiz on WhatsApp:
 * no one / classmate / teacher / family, en and ur, stored on quiz_sessions.helped_by.
 * Behind app_settings quiz_slo_retest_enabled (default off).
 */
const { makeDb } = require('./helpers/memory-db');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const WhatsApp = require('../../bot/shared/services/whatsapp.service');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { resolveUx } = require('../../bot/shared/config/ux-strings');
const Flag = require('../../bot/shared/services/quiz/quiz-v21-flag');
const Helped = require('../../bot/shared/services/quiz/quiz-helped-by');

const cp = (s) => [...String(s)].length;
const SID = '11111111-2222-3333-4444-555555555555';
const seed = ({ flag = true, helped = null } = {}) => {
  mockDb = makeDb({
    app_settings: flag ? [{ key: 'quiz_slo_retest_enabled', value: { enabled: true } }] : [],
    quiz_sessions: [{ id: SID, quiz_id: 'Q1', status: 'completed', helped_by: helped }],
  });
};
const state = (over = {}) => ({ sessionId: SID, quizId: 'Q1', language: 'en', ...over });

beforeEach(() => { jest.clearAllMocks(); Flag._reset(); });

describe('strings (language protocol: flat en/ur, WhatsApp caps in code points)', () => {
  test.each(['en', 'ur'])('%s: every string set, list button ≤20, row titles ≤24, body set', (language) => {
    const u = (k) => resolveUx(k, { language });
    expect(cp(u('vqHelpedPick'))).toBeLessThanOrEqual(20);
    Helped.CHOICES.forEach(({ key }) => { expect(u(key)).toBeTruthy(); expect(cp(u(key))).toBeLessThanOrEqual(24); });
    expect(u('vqHelpedAsk')).toBeTruthy();
    expect(u('vqHelpedThanks')).toBeTruthy();
  });
  test('ur strings are Urdu, not the English fallback', () => {
    ['vqHelpedAsk', 'vqHelpedPick', 'vqHelpedThanks', ...Helped.CHOICES.map((c) => c.key)].forEach((k) => {
      expect(resolveUx(k, { language: 'ur' })).not.toBe(resolveUx(k, { language: 'en' }));
    });
  });
  test('the four values match the column CHECK', () => {
    expect(Helped.CHOICES.map((c) => c.value)).toEqual(['no_one', 'classmate', 'teacher', 'family']);
  });
});

describe('offer — after a child finishes', () => {
  test('switch off → nothing sent', async () => {
    seed({ flag: false });
    expect(await Helped.offer('923001', state(), 'lp_v8')).toBe(false);
    expect(WhatsApp.sendInteractiveMessage).not.toHaveBeenCalled();
  });
  test('not a lesson quiz (a video quiz) → nothing sent', async () => {
    seed();
    expect(await Helped.offer('923001', state(), 'video')).toBe(false);
    expect(WhatsApp.sendInteractiveMessage).not.toHaveBeenCalled();
  });
  test('switch on, lesson quiz → one list with the four rows, ids carry the session and the quiz language', async () => {
    seed();
    expect(await Helped.offer('923001', state({ language: 'ur' }), 'lp_v8')).toBe(true);
    const [phone, msg] = WhatsApp.sendInteractiveMessage.mock.calls[0];
    expect(phone).toBe('923001');
    expect(msg.body.text).toBe(resolveUx('vqHelpedAsk', { language: 'ur' }));
    expect(msg.action.button).toBe(resolveUx('vqHelpedPick', { language: 'ur' }));
    expect(msg.action.sections[0].rows.map((r) => r.id)).toEqual(['n', 'c', 't', 'f'].map((k) => `vqh_${k}_ur_${SID}`));
    expect(logEvent).toHaveBeenCalledWith('quiz.helped_by_asked', expect.objectContaining({ sessionId: SID, sent: true }));
  });
  test('a send that throws never breaks the finish', async () => {
    seed();
    WhatsApp.sendInteractiveMessage.mockRejectedValueOnce(new Error('meta down'));
    await expect(Helped.offer('923001', state(), 'lp_v8')).resolves.toBe(false);
  });
});

describe('handleTap', () => {
  test('not ours → false, nothing written', async () => {
    seed();
    expect(await Helped.handleTap('923001', 'vq_a_1')).toBe(false);
    expect(await Helped.handleTap('923001', `vqh_x_en_${SID}`)).toBe(false);
    expect(await Helped.handleTap('923001', `vqh_c_fr_${SID}`)).toBe(false);
  });
  test('a tap → helped_by stored, thanked in the quiz language', async () => {
    seed();
    expect(await Helped.handleTap('923001', `vqh_c_ur_${SID}`)).toBe(true);
    expect(mockDb.tables.quiz_sessions[0].helped_by).toBe('classmate');
    expect(WhatsApp.sendMessage).toHaveBeenCalledWith('923001', resolveUx('vqHelpedThanks', { language: 'ur' }));
    expect(logEvent).toHaveBeenCalledWith('quiz.helped_by_answered', expect.objectContaining({ sessionId: SID, helpedBy: 'classmate' }));
  });
  test('a second tap does not overwrite the first answer', async () => {
    seed({ helped: 'no_one' });
    expect(await Helped.handleTap('923001', `vqh_f_en_${SID}`)).toBe(true);
    expect(mockDb.tables.quiz_sessions[0].helped_by).toBe('no_one');
  });
});
