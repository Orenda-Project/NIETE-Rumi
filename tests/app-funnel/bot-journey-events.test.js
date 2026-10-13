'use strict';
/**
 * bd-4r3rei — the bot half of the funnel. Driven through the real redirectIfFlagged → sendAppLink path with only the
 * edges mocked (WhatsApp, Supabase, the logger sink). Every decision about the app link is one journey:
 *   app_funnel.command   she asked (feature, door, verdict, why)
 *   app_funnel.link_sent / app_funnel.link_failed   what we did about it — the SAME journeyId, and the SAME one inside the link.
 */
const mockLog = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a), logError: jest.fn() }));
const mockCta = jest.fn();
const mockSend = jest.fn();
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSend(...a),
  sendCtaUrl: (...a) => mockCta(...a),
}));

let mockState;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (table) => mockFrom(table) }));
function mockFrom(table) {
  const filters = {};
  const chain = {
    select: () => chain,
    eq: (c, v) => { filters[c] = v; return chain; },
    in: (_c, vals) => Promise.resolve({ data: mockState.settings.filter((r) => vals.includes(r.key)), error: null }),
    maybeSingle: () => {
      if (table === 'users') {
        if (mockState.usersError) return Promise.resolve({ data: null, error: { message: 'boom' } });
        return Promise.resolve({ data: mockState.users[filters.id] || null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    upsert: () => Promise.resolve({ error: null }),
  };
  return chain;
}

const ENV = { ...process.env };
const ME = '60530046-7ac3-4ea3-a976-b43c37c23213';
const FROM = '923330000099';
const PORTAL = 'https://portal.example.test';
const row = (role, extra = {}) => ({ id: ME, role, name: 'Hataf', registration_completed: true, registration_state: 'completed', ...extra });

let svc; let link;
beforeEach(() => {
  jest.resetModules();
  mockLog.mockReset();
  mockCta.mockReset().mockResolvedValue(true);
  mockSend.mockReset().mockResolvedValue(true);
  mockState = { settings: [], users: { [ME]: row('teacher') }, usersError: false };
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', PORTAL_URL: PORTAL, SUPABASE_URL: 'https://abcdefgh.supabase.co' };
  delete process.env.WEB_TRAINING_TOKEN_SECRET;
  svc = require('../../bot/shared/services/app-redirect.service');
  link = require('../../bot/shared/services/app-login-link');
});
afterAll(() => { process.env = ENV; });

const set = (key, value) => mockState.settings.push({ key, value });
const teachersToday = () => {
  for (const k of ['menu', 'lesson_plan', 'assessment_generator', 'teacher_training', 'attendance', 'classes']) set(`app_redirect_${k}`, 'teachers');
  set('portal_teacher_v2', 'teachers');
};
const ask = (feature, reason = 'command') => svc.redirectIfFlagged(feature, { userId: ME, from: FROM, language: 'en', reason });
/** The semantic funnel rows the bot wrote: [{ message, data }]. */
const funnel = () => mockLog.mock.calls
  .filter(([msg, data]) => typeof msg === 'string' && msg.startsWith('app_funnel.') && data && data.event === msg)
  .map(([message, data]) => ({ message, data }));
const tokenOf = () => link.verifyAppLink(mockCta.mock.calls[0][1].url.slice(`${PORTAL}/go/`.length));

describe('a teacher the switch covers', () => {
  test.each([
    ['menu', 'menu_command'], ['lesson_plan', 'bare_command'], ['assessment_generator', 'command'],
    ['teacher_training', 'command'], ['attendance', 'keyword'], ['classes', 'command'], ['lesson_plan', 'intent'], ['menu', 'chip'],
  ])('%s via %s: command → link_sent, ONE journey id, the same one inside the link', async (feature, door) => {
    teachersToday();
    expect(await ask(feature, door)).toBe(true);
    const rows = funnel();
    expect(rows.map((r) => r.message)).toEqual(['app_funnel.command', 'app_funnel.link_sent']);
    const [command, sent] = rows.map((r) => r.data);
    expect(command).toEqual(expect.objectContaining({ userId: ME, feature, door, verdict: 'link' }));
    expect(command.journeyId).toMatch(/^j_[0-9a-f]{16}$/);
    expect(sent).toEqual(expect.objectContaining({ userId: ME, feature, door, journeyId: command.journeyId, via: 'cta_url' }));
    expect(tokenOf().j).toBe(command.journeyId);
  });

  test('two asks are two journeys', async () => {
    teachersToday();
    await ask('menu', 'menu_command');
    await ask('lesson_plan', 'bare_command');
    const ids = funnel().filter((r) => r.message === 'app_funnel.command').map((r) => r.data.journeyId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  test('Meta refuses the button: the same link goes as text, and the row says so', async () => {
    teachersToday();
    mockCta.mockResolvedValue(false);
    expect(await ask('menu', 'menu_command')).toBe(true);
    const sent = funnel().find((r) => r.message === 'app_funnel.link_sent');
    expect(sent.data.via).toBe('text');
  });

  test('both sends fail: link_failed with the journey id, and the caller still runs the WhatsApp flow (false)', async () => {
    teachersToday();
    mockCta.mockResolvedValue(false); mockSend.mockResolvedValue(false);
    expect(await ask('menu', 'menu_command')).toBe(false);
    const rows = funnel();
    expect(rows.map((r) => r.message)).toEqual(['app_funnel.command', 'app_funnel.link_failed']);
    expect(rows[1].data).toEqual(expect.objectContaining({ journeyId: rows[0].data.journeyId, reason: 'send_refused' }));
  });

  test('the send throws: link_failed reason send_threw', async () => {
    teachersToday();
    mockCta.mockRejectedValue(new Error('network'));
    expect(await ask('menu', 'menu_command')).toBe(false);
    expect(funnel().find((r) => r.message === 'app_funnel.link_failed').data.reason).toBe('send_threw');
  });

  test.each([['PORTAL_URL'], ['INTERNAL_API_KEY']])('no %s on this deployment: link_failed reason no_portal_or_key, and the flow runs', async (name) => {
    teachersToday();
    delete process.env[name];
    expect(await ask('menu', 'menu_command')).toBe(false);
    expect(funnel().find((r) => r.message === 'app_funnel.link_failed').data.reason).toBe('no_portal_or_key');
  });
});

describe('a sender the switch does not cover: she keeps WhatsApp, and we still know she asked', () => {
  test.each([
    ['principal', () => { mockState.users[ME] = row('principal'); }, 'not_a_teacher'],
    ['unnamed teacher', () => { mockState.users[ME] = row('teacher', { name: null, registration_completed: false, registration_state: null }); }, 'not_registered'],
    ['no account row', () => { mockState.users = {}; }, 'no_account'],
  ])('%s → app_funnel.command verdict whatsapp, why %s, no link, no link_sent', async (_n, arrange, why) => {
    teachersToday(); arrange();
    expect(await ask('lesson_plan', 'bare_command')).toBe(false);
    const rows = funnel();
    expect(rows.map((r) => r.message)).toEqual(['app_funnel.command']);
    expect(rows[0].data).toEqual(expect.objectContaining({ userId: ME, feature: 'lesson_plan', door: 'bare_command', verdict: 'whatsapp', why }));
    expect(rows[0].data.journeyId).toMatch(/^j_/);
    expect(mockCta).not.toHaveBeenCalled();
  });

  test('her account cannot be read → verdict whatsapp, why account_unreadable', async () => {
    teachersToday(); mockState.usersError = true;
    expect(await ask('menu', 'menu_command')).toBe(false);
    expect(funnel()[0].data).toEqual(expect.objectContaining({ verdict: 'whatsapp', why: 'account_unreadable' }));
  });
});

describe('quiet when there is no app link in play', () => {
  test('switch off: nothing is logged for the funnel', async () => {
    expect(await ask('menu', 'menu_command')).toBe(false);
    expect(funnel()).toEqual([]);
  });
  test('a feature with no app page (quiz) logs nothing', async () => {
    teachersToday(); set('app_redirect_quiz', 'teachers');
    await ask('quiz', 'command');
    expect(funnel()).toEqual([]);
  });
  test('a log failure never changes the answer', async () => {
    teachersToday();
    mockLog.mockImplementation((msg) => { if (String(msg).startsWith('app_funnel.')) throw new Error('sink down'); });
    expect(await ask('menu', 'menu_command')).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
  });
});

describe('the payload has no PII', () => {
  test('no phone, no name, no token in any funnel row', async () => {
    teachersToday();
    await ask('menu', 'menu_command');
    const dump = JSON.stringify(funnel());
    expect(dump).not.toContain(FROM);
    expect(dump).not.toContain('Hataf');
    expect(dump).not.toContain('/go/');
    expect(dump).not.toContain(mockCta.mock.calls[0][1].url.split('/go/')[1]);
  });
});
