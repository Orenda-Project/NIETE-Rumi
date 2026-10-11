'use strict';
/**
 * bd-fmf24g.46 — the app link for EVERY teacher, not just a pilot list.
 *
 * A switch (`app_redirect_<feature>`) reading the string "teachers" sends ONE cta_url message — a line and a button
 * that opens the teacher app signed in, on that feature's page — to every REGISTERED TEACHER on the teacher app.
 * Everyone else keeps today's WhatsApp flow: a principal, a coach, a number that never registered, a child's handset,
 * a teacher not on the teacher app, an account that cannot be read. Never the Play Store notice: that is plain `true`,
 * whose meaning does not change. "teachers" is a string, not `true`, so code from before this change reads it as OFF.
 *
 * The teacher app's own switch (`portal_teacher_v2`) takes the same value, with the same meaning, and the bot's
 * "is she on the teacher app?" gives the portal's answer (dashboard/lib/feature-flags.js isFlagEnabledForUser) —
 * a link is never sent to a page she cannot open. That agreement is pinned at the bottom, value by value, role by role.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
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
        mockState.userReads += 1;
        if (mockState.usersError) return Promise.resolve({ data: null, error: { message: 'boom' } });
        return Promise.resolve({ data: mockState.users[filters.id] || null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    upsert: () => { mockState.upserts += 1; return Promise.resolve({ error: null }); },
  };
  return chain;
}

const ENV = { ...process.env };
const ME = '60530046-7ac3-4ea3-a976-b43c37c23213';
const FROM = '923330000099';
const PORTAL = 'https://portal.example.test';
const LINKED = {
  menu: '/portal/teacher',
  lesson_plan: '/portal/teacher/lessons',
  assessment_generator: '/portal/teacher/assessment',
  teacher_training: '/portal/teacher/training',
  attendance: '/portal/teacher/attendance',
  classes: '/portal/teacher/classes',
};
const SIX = Object.keys(LINKED);

/** users rows by id. A registered teacher has a name (the roster import) or a completed registration. */
const row = (role, extra = {}) => ({ id: ME, role, name: 'Ayesha', registration_completed: false, registration_state: 'unregistered', ...extra });

let svc; let link;
beforeEach(() => {
  jest.resetModules();
  mockCta.mockReset().mockResolvedValue(true);
  mockSend.mockReset().mockResolvedValue(true);
  mockState = { settings: [], users: { [ME]: row('teacher') }, usersError: false, userReads: 0, upserts: 0 };
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', PORTAL_URL: PORTAL, SUPABASE_URL: 'https://abcdefgh.supabase.co' };
  delete process.env.WEB_TRAINING_TOKEN_SECRET;
  svc = require('../../bot/shared/services/app-redirect.service');
  link = require('../../bot/shared/services/app-login-link');
});
afterAll(() => { process.env = ENV; });

const set = (key, value) => mockState.settings.push({ key, value });
const ask = (feature, { userId = ME, language = 'en' } = {}) =>
  svc.redirectIfFlagged(feature, { userId, from: FROM, language, reason: 'test' });
const everyone = (feature, v2 = 'teachers') => { set(`app_redirect_${feature}`, 'teachers'); set('portal_teacher_v2', v2); };

describe.each(SIX)('%s switched to "teachers"', (feature) => {
  test('a registered teacher on the teacher app gets ONE cta_url link that lands on the feature', async () => {
    everyone(feature);
    expect(await ask(feature)).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalled();
    const [to, opts] = mockCta.mock.calls[0];
    expect(to).toBe(FROM);
    expect(opts.url.startsWith(`${PORTAL}/go/`)).toBe(true);
    expect(link.verifyAppLink(opts.url.slice(`${PORTAL}/go/`.length))).toEqual(expect.objectContaining({ u: ME, f: feature }));
    expect(link.LANDINGS[feature]).toBe(LINKED[feature]);
    expect(opts.url).not.toContain('play.google.com');
    expect(mockState.upserts).toBe(0); // no quiet hour
  });

  test.each([
    ['a principal', row('principal')],
    ['a coach', row('coach')],
    ['role unregistered', row('unregistered')],
    ['a teacher row with no name and no completed registration (a cold number, a child\'s handset)', row('teacher', { name: null })],
    ['a teacher row whose name is an empty string', row('teacher', { name: '' })],
  ])('%s keeps today\'s WhatsApp flow: not handled, nothing sent', async (_label, user) => {
    everyone(feature);
    mockState.users[ME] = user;
    expect(await ask(feature)).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockState.upserts).toBe(0);
  });

  test('registered by a completed run (no name yet) counts as registered', async () => {
    everyone(feature);
    mockState.users[ME] = row('teacher', { name: null, registration_completed: true });
    expect(await ask(feature)).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
  });

  test('no users row, or the read fails: today\'s flow, nothing sent', async () => {
    everyone(feature);
    delete mockState.users[ME];
    expect(await ask(feature)).toBe(false);
    mockState.users[ME] = row('teacher');
    mockState.usersError = true;
    expect(await ask(feature)).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('a teacher NOT on the teacher app gets no link (the pilot gate and the v2 flag agree)', async () => {
    everyone(feature, ['11111111-1111-4111-8111-111111111111']);
    expect(await ask(feature)).toBe(false);
    mockState.settings = [];
    set(`app_redirect_${feature}`, 'teachers'); // portal_teacher_v2 absent
    expect(await ask(feature)).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('portal_teacher_v2 true (everyone) or a list holding her also puts her on the teacher app', async () => {
    everyone(feature, true);
    expect(await ask(feature)).toBe(true);
    mockState.settings = [];
    everyone(feature, [ME]);
    expect(await ask(feature)).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(2);
  });

  test('the value written as JSON text ("\\"teachers\\"") reads the same', async () => {
    set(`app_redirect_${feature}`, '"teachers"');
    set('portal_teacher_v2', '"teachers"');
    expect(await ask(feature)).toBe(true);
  });
});

test('a pilot list still works when portal_teacher_v2 is "teachers": she is in it as a teacher, not as a principal', async () => {
  set('app_redirect_menu', [ME]);
  set('portal_teacher_v2', 'teachers');
  expect(await ask('menu')).toBe(true);
  expect(mockCta).toHaveBeenCalledTimes(1);
  mockState.users[ME] = row('principal');
  expect(await ask('menu')).toBe(false);
  expect(mockCta).toHaveBeenCalledTimes(1);
  expect(mockSend).not.toHaveBeenCalled();
});

test('ai_coaching left as its pilot list: a teacher not on the list keeps WhatsApp even with the other six on', async () => {
  for (const f of SIX) set(`app_redirect_${f}`, 'teachers');
  set('app_redirect_ai_coaching', ['22222222-2222-4222-8222-222222222222']);
  set('portal_teacher_v2', 'teachers');
  expect(await ask('ai_coaching')).toBe(false);
  expect(mockCta).not.toHaveBeenCalled();
  expect(mockSend).not.toHaveBeenCalled();
});

test('"teachers" on a feature with no v2 page is OFF: no link, no Play Store notice', async () => {
  set('portal_teacher_v2', 'teachers');
  for (const f of ['quiz', 'reading_test', 'homework', 'exam_checker', 'presentation', 'general_chat', 'video', 'remark', 'observe']) {
    set(`app_redirect_${f}`, 'teachers');
    expect(await ask(f)).toBe(false);
  }
  expect(mockCta).not.toHaveBeenCalled();
  expect(mockSend).not.toHaveBeenCalled();
});

test('general_chat (asked on every open message) never reads the users row', async () => {
  set('app_redirect_general_chat', 'teachers');
  set('portal_teacher_v2', 'teachers');
  await ask('general_chat');
  expect(mockState.userReads).toBe(0);
});

test('plain true keeps today\'s meaning (the Play Store notice), unchanged', async () => {
  set('app_redirect_lesson_plan', true);
  set('portal_teacher_v2', 'teachers');
  expect(await ask('lesson_plan')).toBe(true);
  expect(mockCta).not.toHaveBeenCalled();
  expect(mockSend.mock.calls[0][1]).toContain('play.google.com');
});

test('a failed link send falls back to plain text; if that fails too, the flow runs', async () => {
  everyone('lesson_plan');
  mockCta.mockResolvedValue(false);
  expect(await ask('lesson_plan')).toBe(true);
  expect(mockSend.mock.calls[0][1]).toContain(`${PORTAL}/go/`);
  mockSend.mockResolvedValue(false);
  expect(await ask('lesson_plan')).toBe(false);
});

/*
 * The agreement: for every value portal_teacher_v2 can hold and every role, the bot's "on the teacher app" (driven
 * here through a pilot list, which asks exactly that) equals the portal's isFlagEnabledForUser for the same user.
 */
describe('the bot and the portal agree on who is on the teacher app', () => {
  const VALUES = [true, 'true', false, [ME], ['someone-else'], 'teachers', '"teachers"', 'Teachers ', {}, 'nope', null];
  const ROLES = ['teacher', 'principal', 'coach', 'unregistered', 'aeo', ' Teacher ', null];

  test.each(VALUES.flatMap((v) => ROLES.map((r) => [JSON.stringify(v), v, r])))('value %s, role %s', async (_l, value, role) => {
    const user = row(role);
    // the bot
    mockState.users[ME] = user;
    set('app_redirect_menu', [ME]);
    if (value !== null) set('portal_teacher_v2', value);
    const bot = await ask('menu');
    // the portal
    const { isFlagEnabledForUser } = require('../../dashboard/lib/feature-flags');
    const portalDb = {
      from: (table) => {
        const f = {};
        const c = {
          select: () => c,
          eq: (k, v) => { f[k] = v; return c; },
          maybeSingle: async () => {
            if (table === 'users') return { data: f.id === ME ? { role } : null, error: null };
            return { data: value === null ? null : { value }, error: null };
          },
        };
        return c;
      },
    };
    const portal = await isFlagEnabledForUser(portalDb, 'portal_teacher_v2', ME);
    expect(bot).toBe(portal);
  });
});
