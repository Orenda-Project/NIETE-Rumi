'use strict';
/**
 * bd-9652yj (queue #166) — what a coach's next WhatsApp message does after the nudge, and the way back from the app.
 *
 *   reply 1   "1", "۱", "whatsapp" or "واٹس ایپ" — only while the offer is armed (the nudge or the report-ready line
 *             was the bot's last word to her, under 2 h). It runs today's WhatsApp entry for what the nudge offered
 *             (/observe → the observe flow, /menu → the WhatsApp menu, report → the WhatsApp report card) and her
 *             choice holds until PKT midnight. Any other message ends the offer, so a later "1" is a menu choice again.
 *   the code  "Continue my visit on WhatsApp (code V4KQ7)" — typed by the app's "Continue on WhatsApp". The code is
 *             the portal's (Redis, 24 h: user, visit, screen). Only the same coach's code resumes: a visit with no
 *             recording → the teacher is bound and the recording prompt goes; a visit already recorded → observe-resume
 *             at its own step. Wrong, expired, someone else's or no code → plain /observe, never an error.
 *
 * Only coaches pay the Redis read; anyone else's message is untouched.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const mockSend = jest.fn();
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSend(...a),
  sendCtaUrl: jest.fn(),
}));

const mockRedis = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: async (k) => {
    const v = mockRedis.get(k);
    if (v == null) return null;
    try { return JSON.parse(v); } catch (_) { return v; }
  },
  set: async (k, v) => { mockRedis.set(k, typeof v === 'string' ? v : JSON.stringify(v)); return true; },
  delete: async (k) => { mockRedis.delete(k); return true; },
}));

const mockObserve = jest.fn();
jest.mock('../../bot/shared/handlers/observe-command.handler', () => ({ handleObserveCommand: (...a) => mockObserve(...a) }));
const mockMenu = jest.fn();
jest.mock('../../bot/shared/services/menu.service', () => ({ sendMenu: (...a) => mockMenu(...a) }));
const mockResume = jest.fn();
jest.mock('../../bot/shared/services/observe/observe-resume.service', () => ({ resume: (...a) => mockResume(...a) }));
const mockBind = jest.fn();
jest.mock('../../bot/shared/handlers/observe-visit-flow.handler', () => ({ bindAndStart: (...a) => mockBind(...a) }));
jest.mock('../../bot/shared/services/observe/obs612/visit', () => ({ asksClass: async () => false, askForObserve: async () => false }));
const mockReportCard = jest.fn();
jest.mock('../../bot/shared/services/observe/coach-report-whatsapp.service', () => ({
  sendReportCardHere: (...a) => mockReportCard(...a),
}));

let mockVisit;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (table) => mockFrom(table) }));
function mockFrom(table) {
  const filters = {};
  const chain = {
    select: () => chain,
    eq: (c, v) => { filters[c] = v; return chain; },
    maybeSingle: () => {
      if (table !== 'observation_schedules') return Promise.resolve({ data: null, error: null });
      const v = mockVisit && mockVisit.id === filters.id && mockVisit.leader_user_id === filters.leader_user_id ? mockVisit : null;
      return Promise.resolve({ data: v, error: null });
    },
  };
  return chain;
}

const ME = '60530046-7ac3-4ea3-a976-b43c37c23213';
const OTHER = '11111111-1111-4111-8111-111111111111';
const VISIT = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const FROM = '923330000099';
const coach = (extra = {}) => ({ id: ME, role: 'coach', preferred_language: 'en', ...extra });

let nudge; let logger;
beforeEach(() => {
  jest.resetModules();
  mockRedis.clear();
  [mockSend, mockObserve, mockMenu, mockResume, mockBind, mockReportCard].forEach((m) => m.mockReset());
  mockSend.mockResolvedValue(true);
  mockObserve.mockResolvedValue(true);
  mockMenu.mockResolvedValue(true);
  mockResume.mockResolvedValue(undefined);
  mockReportCard.mockResolvedValue(true);
  mockBind.mockResolvedValue({ action: 'bound', boundTeacher: { teacher_name: 'Ayesha Testwala', user_id: 'tch-1' } });
  mockVisit = null;
  nudge = require('../../bot/shared/services/coach-app-nudge.service');
  logger = require('../../bot/shared/utils/logger');
});

const inbound = (text, { user = coach(), ctx = { language: 'en', sessionId: 'chat-1' } } = {}) =>
  nudge.handleInbound(user, FROM, text, ctx);
const events = (name) => logger.logToFile.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
const arm = (kind, extra = {}) => nudge.armReply(ME, kind, { journeyId: 'jrn-abc', ...extra });

describe('reply 1 after the /observe nudge', () => {
  test.each(['1', ' 1 ', '۱', '١', 'whatsapp', 'WhatsApp', 'Whats App', 'واٹس ایپ', '1.'])('"%s" runs today\'s /observe flow', async (text) => {
    await arm('observe');
    expect(await inbound(text)).toBe(true);
    expect(mockObserve).toHaveBeenCalledWith(expect.objectContaining({ id: ME }), FROM, '/observe');
    expect(await nudge.choseWhatsappToday(ME)).toBe(true);
    expect(mockRedis.has(nudge.replyKey(ME))).toBe(false);
    expect(events('app_funnel.fallback_reply')[0]).toEqual(expect.objectContaining({
      event: 'app_funnel.fallback_reply', journeyId: 'jrn-abc', userId: ME, kind: 'observe', audience: 'coach',
    }));
  });

  test('any other message ends the offer: it is not handled, and a later "1" is not taken', async () => {
    await arm('observe');
    expect(await inbound('hello')).toBe(false);
    expect(mockRedis.has(nudge.replyKey(ME))).toBe(false);
    expect(await inbound('1')).toBe(false);
    expect(mockObserve).not.toHaveBeenCalled();
    expect(await nudge.choseWhatsappToday(ME)).toBe(false);
  });

  test('"1" with no offer armed is not handled (a menu choice stays a menu choice)', async () => {
    expect(await inbound('1')).toBe(false);
    expect(mockObserve).not.toHaveBeenCalled();
  });

  test('"12" or "1 more" is not the reply', async () => {
    await arm('observe');
    expect(await inbound('12')).toBe(false);
    await arm('observe');
    expect(await inbound('1 more thing')).toBe(false);
  });

  test('a teacher\'s message never reads Redis and is never handled', async () => {
    await arm('observe');
    expect(await inbound('1', { user: coach({ role: 'teacher' }) })).toBe(false);
    expect(mockRedis.has(nudge.replyKey(ME))).toBe(true);
  });
});

describe('reply 1 after the /menu nudge', () => {
  test('sends the WhatsApp menu, in her language, with her chat session', async () => {
    await arm('menu');
    expect(await inbound('1', { ctx: { language: 'ur', sessionId: 'chat-9' } })).toBe(true);
    expect(mockMenu).toHaveBeenCalledWith(FROM, ME, 'chat-9', 'ur', expect.objectContaining({ id: ME }));
    expect(mockObserve).not.toHaveBeenCalled();
  });
});

describe('reply 1 after the report-ready line', () => {
  test('sends the WhatsApp report card for that report', async () => {
    await arm('report', { sessionId: SESSION });
    expect(await inbound('1')).toBe(true);
    expect(mockReportCard).toHaveBeenCalledWith(expect.objectContaining({ sessionId: SESSION, from: FROM, user: expect.objectContaining({ id: ME }) }));
    expect(events('app_funnel.fallback_reply')[0]).toEqual(expect.objectContaining({ kind: 'report', sessionId: SESSION }));
  });

  test('the card could not be sent: one line telling her where to find it, never silence', async () => {
    mockReportCard.mockResolvedValue(false);
    await arm('report', { sessionId: SESSION });
    expect(await inbound('1')).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][1]).toMatch(/\/observe/);
  });
});

describe('the app\'s "Continue on WhatsApp" line', () => {
  const putCode = (code, payload) => mockRedis.set(nudge.handoffKey(code), JSON.stringify(payload));

  test('parseHandoffLine reads the English and the Urdu line, with or without a code', () => {
    expect(nudge.parseHandoffLine('continue my visit on whatsapp (code v4kq7)')).toEqual({ code: 'V4KQ7' });
    expect(nudge.parseHandoffLine('Continue my visit on WhatsApp (code V4KQ7)')).toEqual({ code: 'V4KQ7' });
    expect(nudge.parseHandoffLine('میرا دورہ واٹس ایپ پر جاری رکھیں (کوڈ V4KQ7)')).toEqual({ code: 'V4KQ7' });
    expect(nudge.parseHandoffLine('Continue my visit on WhatsApp')).toEqual({ code: null });
    expect(nudge.parseHandoffLine('Continue my visit on WhatsApp (code 0O1IL)')).toEqual({ code: null });
    expect(nudge.parseHandoffLine('what is the code for wifi')).toBeNull();
    expect(nudge.parseHandoffLine('1')).toBeNull();
  });

  test('her own code for a visit not yet recorded: the teacher is bound and the recording prompt goes', async () => {
    putCode('V4KQ7', { u: ME, v: VISIT, s: 'record', j: 'jrn-app' });
    mockVisit = { id: VISIT, leader_user_id: ME, status: 'upcoming', session_id: null, teacher_ext_id: 't-9', school_ext_id: 's-4', teacher_name: 'Ayesha Testwala' };
    expect(await inbound('continue my visit on whatsapp (code v4kq7)')).toBe(true);
    expect(mockBind).toHaveBeenCalledWith(ME, { teacher_ext_id: 't-9', school_ext_id: 's-4' }, expect.objectContaining({ id: ME }));
    expect(mockSend).toHaveBeenCalledTimes(1);
    const text = mockSend.mock.calls[0][1];
    expect(text).toMatch(/carry on with your visit/i);
    expect(text).toContain('Ayesha Testwala');
    expect(mockObserve).not.toHaveBeenCalled();
    expect(await nudge.choseWhatsappToday(ME)).toBe(true);
    expect(mockRedis.has(nudge.handoffKey('V4KQ7'))).toBe(false); // one use
    expect(events('app_funnel.resume')[0]).toEqual(expect.objectContaining({
      event: 'app_funnel.resume', userId: ME, journeyId: 'jrn-app', step: 'record', ok: true, outcome: 'recording_prompt',
    }));
  });

  test('in Urdu, the prompt is Urdu', async () => {
    putCode('V4KQ7', { u: ME, v: VISIT, s: 'visit' });
    mockVisit = { id: VISIT, leader_user_id: ME, status: 'upcoming', session_id: null, teacher_ext_id: 't-9', school_ext_id: 's-4', teacher_name: 'Ayesha Testwala' };
    expect(await inbound('میرا دورہ واٹس ایپ پر جاری رکھیں (کوڈ V4KQ7)', {
      user: coach({ preferred_language: 'ur' }), ctx: { language: 'ur', sessionId: 'chat-1' },
    })).toBe(true);
    expect(mockSend.mock.calls[0][1]).toMatch(/واٹس ایپ پر جاری/);
  });

  test('a visit already recorded: observe-resume at its own step', async () => {
    putCode('V4KQ7', { u: ME, v: VISIT, s: 'sending' });
    mockVisit = { id: VISIT, leader_user_id: ME, status: 'done', session_id: SESSION, teacher_ext_id: 't-9', school_ext_id: 's-4', teacher_name: 'A' };
    expect(await inbound('Continue my visit on WhatsApp (code V4KQ7)')).toBe(true);
    expect(mockResume).toHaveBeenCalledWith(SESSION, FROM, expect.objectContaining({ id: ME }));
    expect(mockBind).not.toHaveBeenCalled();
    expect(events('app_funnel.resume')[0]).toEqual(expect.objectContaining({ ok: true, outcome: 'observation' }));
  });

  test('an observation id on the code (no visit): observe-resume', async () => {
    putCode('V4KQ7', { u: ME, o: SESSION, s: 'observation' });
    expect(await inbound('Continue my visit on WhatsApp (code V4KQ7)')).toBe(true);
    expect(mockResume).toHaveBeenCalledWith(SESSION, FROM, expect.objectContaining({ id: ME }));
  });

  test.each([
    ['someone else\'s code', () => putCode('V4KQ7', { u: OTHER, v: VISIT, s: 'record' }), 'other'],
    ['an unknown or expired code', () => {}, 'unknown'],
    ['a visit that is not hers (or gone)', () => { putCode('V4KQ7', { u: ME, v: VISIT, s: 'record' }); mockVisit = { id: VISIT, leader_user_id: OTHER, status: 'upcoming' }; }, 'own'],
    ['the hub (no visit on the code)', () => putCode('V4KQ7', { u: ME, s: 'observe' }), 'own'],
  ])('%s → plain /observe, never an error', async (_n, arrange, match) => {
    arrange();
    expect(await inbound('Continue my visit on WhatsApp (code V4KQ7)')).toBe(true);
    expect(mockObserve).toHaveBeenCalledWith(expect.objectContaining({ id: ME }), FROM, '/observe');
    expect(mockBind).not.toHaveBeenCalled();
    expect(mockResume).not.toHaveBeenCalled();
    expect(events('app_funnel.resume')[0]).toEqual(expect.objectContaining({ outcome: 'observe', match }));
    if (match === 'other') expect(mockRedis.has(nudge.handoffKey('V4KQ7'))).toBe(true); // not hers to spend
  });

  test('the line with no code → plain /observe', async () => {
    expect(await inbound('Continue my visit on WhatsApp')).toBe(true);
    expect(mockObserve).toHaveBeenCalledTimes(1);
    expect(events('app_funnel.resume')[0]).toEqual(expect.objectContaining({ code: false, match: 'none', outcome: 'observe' }));
  });

  test('the line also ends an armed reply-1 offer', async () => {
    await arm('observe');
    await inbound('Continue my visit on WhatsApp');
    expect(mockRedis.has(nudge.replyKey(ME))).toBe(false);
  });

  test('a teacher typing the line is not handled here', async () => {
    expect(await inbound('Continue my visit on WhatsApp (code V4KQ7)', { user: coach({ role: 'teacher' }) })).toBe(false);
  });
});

describe('the text handler asks first', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../bot/shared/handlers/text-message.handler.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  test('handleInbound is called, and before the /observe door and the menu', () => {
    const at = src.indexOf('CoachAppNudge.handleInbound(');
    const observeDoor = src.indexOf("redirectToApp('observe', 'command')");
    const menuDoor = src.indexOf("redirectToApp('menu', reason)");
    expect(at).toBeGreaterThan(-1);
    expect(observeDoor).toBeGreaterThan(-1);
    expect(menuDoor).toBeGreaterThan(-1);
    expect(at).toBeLessThan(observeDoor);
    expect(at).toBeLessThan(menuDoor);
  });
});
