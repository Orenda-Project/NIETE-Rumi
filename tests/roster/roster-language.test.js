/**
 * `/roster` is a leader-facing command and every string on it was an English
 * literal: the role refusal, and all four Flow chrome fields. Leaders read Urdu
 * on this deployment like everyone else.
 *
 * The command body is lifted out of the text handler into a callable function so
 * this can be a behavioural test rather than a source contract — the handler
 * requires ~40 services at module load and cannot be booted in this suite.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });

jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(() => Promise.resolve(global.__ROSTER_LANG || 'ur')),
  setUserLanguage: jest.fn(),
  DEFAULT_LANGUAGE: 'en',
}));
const mockSendMessage = jest.fn(() => Promise.resolve());
const mockSendFlow = jest.fn(() => Promise.resolve(true));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
  sendFlow: (...a) => mockSendFlow(...a),
}));
jest.mock('../../bot/shared/services/observe/observe-gate', () => ({
  isSchoolLeader: (u) => u && u.role === 'principal',
}));

const { handleRosterCommand } =
  require('../../bot/shared/handlers/roster-command');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

const FROM = '923001234567';
const LEADER = { id: 'u1', role: 'principal' };
const TEACHER = { id: 'u2', role: 'teacher' };
const typing = { stop: jest.fn() };

const cp = (s) => [...s].length;

beforeEach(() => {
  jest.clearAllMocks();
  global.__ROSTER_LANG = 'ur';
  process.env.ROSTER_FLOW_ID = 'flow-123';
});

describe('/roster speaks the reader language', () => {
  test('the role refusal is Urdu for an Urdu-reading teacher', async () => {
    await handleRosterCommand({ user: TEACHER, from: FROM, typingController: typing });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage.mock.calls[0][1]).toBe(resolveUx('rosterRoleRefusal', { language: 'ur' }));
    expect(mockSendMessage.mock.calls[0][1]).not.toMatch(/[A-Za-z]{4,}/);
    expect(mockSendFlow).not.toHaveBeenCalled();
  });

  test('the Flow chrome is Urdu for an Urdu-reading leader', async () => {
    await handleRosterCommand({ user: LEADER, from: FROM, typingController: typing });

    expect(mockSendFlow).toHaveBeenCalledTimes(1);
    const payload = mockSendFlow.mock.calls[0][1];
    expect(payload.header).toBe(resolveUx('rosterFlowHeader', { language: 'ur' }));
    expect(payload.body).toBe(resolveUx('rosterFlowBody', { language: 'ur' }));
    expect(payload.footer).toBe(resolveUx('rosterFlowFooter', { language: 'ur' }));
    expect(payload.buttonText).toBe(resolveUx('rosterFlowButton', { language: 'ur' }));
    for (const field of ['header', 'footer', 'buttonText']) {
      expect(payload[field]).not.toMatch(/[A-Za-z]{4,}/);
    }
  });

  test('an English-reading leader still gets English', async () => {
    global.__ROSTER_LANG = 'en';

    await handleRosterCommand({ user: LEADER, from: FROM, typingController: typing });

    const payload = mockSendFlow.mock.calls[0][1];
    expect(payload.header).toBe(resolveUx('rosterFlowHeader', { language: 'en' }));
  });

  test('the Flow token and id are unchanged — only the copy moved', async () => {
    await handleRosterCommand({ user: LEADER, from: FROM, typingController: typing });

    const payload = mockSendFlow.mock.calls[0][1];
    expect(payload.flowId).toBe('flow-123');
    expect(payload.flowToken).toBe('u1');
  });

  test('no chrome field exceeds its WhatsApp cap, in code points', async () => {
    for (const language of ['en', 'ur']) {
      expect(cp(resolveUx('rosterFlowHeader', { language }))).toBeLessThanOrEqual(60);
      expect(cp(resolveUx('rosterFlowFooter', { language }))).toBeLessThanOrEqual(60);
      expect(cp(resolveUx('rosterFlowButton', { language }))).toBeLessThanOrEqual(20);
      expect(cp(resolveUx('rosterFlowBody', { language }))).toBeLessThanOrEqual(1024);
      expect(cp(resolveUx('rosterRoleRefusal', { language }))).toBeLessThanOrEqual(1024);
    }
  });

  test('with no published Flow the command does not exist at all', async () => {
    delete process.env.ROSTER_FLOW_ID;

    await handleRosterCommand({ user: LEADER, from: FROM, typingController: typing });

    expect(mockSendFlow).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
