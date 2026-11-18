'use strict';
/**
 * bd-9652yj (queue #166, option B) — the coach app NUDGE: for a coach on `coach_app_nudge`, /observe (and the menu's
 * Observe row) and /menu answer with ONE cta_url message: a line that says "reply 1 and I'll carry on here on
 * WhatsApp" and a button that opens the coach app signed in (Observe home / coach Home).
 *
 * Who: `coach_app_nudge` = true → every coach the portal shows the FULL coach app to (users.role coach AND
 * portal_coach_v2 on for them AND portal_coach_full_app on for them: the portal's own rule, true or a list); a JSON list
 * of users.id → only those, and they must pass the same rule. Anything else (no row, "coaches", "teachers", an object, a
 * failed read) is OFF: today's flow exactly. Old code never reads the key, so a rollback is OFF.
 *
 * After the nudge: a "reply 1" offer is armed for 2 h (Redis). Once she has chosen WhatsApp, the rest of the PKT day
 * goes straight to the WhatsApp flow (no second nudge).
 *
 * Driven through the real redirectIfFlagged → sendAppLink path with only the edges mocked (WhatsApp, Supabase, Redis,
 * logger).
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const mockCta = jest.fn();
const mockSend = jest.fn();
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSend(...a),
  sendCtaUrl: (...a) => mockCta(...a),
}));

const mockRedis = new Map();
const mockTtl = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: async (k) => {
    const v = mockRedis.get(k);
    if (v == null) return null;
    try { return JSON.parse(v); } catch (_) { return v; }
  },
  set: async (k, v, ttl) => { mockRedis.set(k, typeof v === 'string' ? v : JSON.stringify(v)); mockTtl.set(k, ttl); return true; },
  delete: async (k) => { mockRedis.delete(k); return true; },
}));

let mockState;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (table) => mockFrom(table) }));
function mockFrom(table) {
  const filters = {};
  const chain = {
    select: () => chain,
    eq: (c, v) => { filters[c] = v; return chain; },
    in: (_c, vals) => {
      if (mockState.settingsError) return Promise.resolve({ data: null, error: { message: 'boom' } });
      return Promise.resolve({ data: mockState.settings.filter((r) => vals.includes(r.key)), error: null });
    },
    maybeSingle: () => {
      if (table === 'users') {
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
const OTHER = '11111111-1111-4111-8111-111111111111';
const FROM = '923330000099';
const PORTAL = 'https://portal.example.test';
const PAGES = { observe: 'coach_observe', menu: 'coach_menu' };

const row = (role) => ({ id: ME, role, name: 'Test Coach', registration_completed: true, registration_state: 'completed' });

let svc; let link; let nudge; let logger;
beforeEach(() => {
  jest.resetModules();
  mockRedis.clear();
  mockTtl.clear();
  mockCta.mockReset().mockResolvedValue(true);
  mockSend.mockReset().mockResolvedValue(true);
  mockState = { settings: [], users: { [ME]: row('coach') }, usersError: false, settingsError: false, upserts: 0 };
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', PORTAL_URL: PORTAL, SUPABASE_URL: 'https://abcdefgh.supabase.co' };
  delete process.env.WEB_TRAINING_TOKEN_SECRET;
  svc = require('../../bot/shared/services/app-redirect.service');
  link = require('../../bot/shared/services/app-login-link');
  nudge = require('../../bot/shared/services/coach-app-nudge.service');
  logger = require('../../bot/shared/utils/logger');
});
afterAll(() => { process.env = ENV; });

const set = (key, value) => mockState.settings.push({ key, value });
const ask = (feature, { userId = ME, language = 'en', reason = 'command', now } = {}) =>
  svc.redirectIfFlagged(feature, { userId, from: FROM, language, reason, ...(now ? { now } : {}) });
/** A coach the portal shows the full coach app to. */
const fullApp = (ids = [ME]) => { set('portal_coach_v2', ids); set('portal_coach_full_app', ids); };
const tokenOf = (opts) => link.verifyAppLink(opts.url.slice(`${PORTAL}/go/`.length));
const events = (name) => logger.logToFile.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

describe.each(Object.keys(PAGES))('a coach on coach_app_nudge sends %s', (feature) => {
  test('ONE cta_url message: the reply-1 line and [Open in the app], signed in on the right page', async () => {
    fullApp(); set('coach_app_nudge', true);
    expect(await ask(feature)).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalled();
    const [to, opts] = mockCta.mock.calls[0];
    expect(to).toBe(FROM);
    expect(opts.body).toMatch(/reply \*1\* and I'll carry on here on WhatsApp/);
    expect(opts.buttonText).toBe('Open in the app');
    expect(tokenOf(opts)).toEqual(expect.objectContaining({ u: ME, f: PAGES[feature] }));
  });

  test('in Urdu: the Urdu line and button', async () => {
    fullApp(); set('coach_app_nudge', true);
    expect(await ask(feature, { language: 'ur' })).toBe(true);
    const opts = mockCta.mock.calls[0][1];
    expect(opts.body).toMatch(/لکھ کر بھیجیں، میں یہیں واٹس ایپ پر جاری رکھوں گی/);
    expect(opts.buttonText).toBe('ایپ میں کھولیں');
    expect([...opts.buttonText].length).toBeLessThanOrEqual(20);
  });

  test('a list holding them counts, when the portal also shows them the full app', async () => {
    fullApp(); set('coach_app_nudge', [ME]);
    expect(await ask(feature)).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
  });

  test('switch values written as JSON text read the same', async () => {
    set('portal_coach_v2', JSON.stringify([ME])); set('portal_coach_full_app', JSON.stringify([ME]));
    set('coach_app_nudge', 'true');
    expect(await ask(feature)).toBe(true);
  });

  test('the reply-1 offer is armed for 2 hours, carrying the journey', async () => {
    fullApp(); set('coach_app_nudge', true);
    await ask(feature);
    const armed = JSON.parse(mockRedis.get(nudge.replyKey(ME)));
    expect(armed).toEqual(expect.objectContaining({ kind: feature }));
    expect(armed.journeyId).toBeTruthy();
    expect(mockTtl.get(nudge.replyKey(ME))).toBe(2 * 60 * 60);
    const cmd = events('app_funnel.command')[0];
    expect(cmd).toEqual(expect.objectContaining({ audience: 'coach', verdict: 'link', offer: 'reply1', journeyId: armed.journeyId }));
  });

  test('once she chose WhatsApp today, the next ask is today\'s flow: no second nudge', async () => {
    fullApp(); set('coach_app_nudge', true);
    await nudge.markWhatsappToday(ME, Date.now());
    expect(await ask(feature)).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect(events('app_funnel.command')[0]).toEqual(expect.objectContaining({ verdict: 'whatsapp', why: 'chose_whatsapp_today' }));
  });

  test('Meta refuses the button: the same line and link go as text (still one message, still reply 1)', async () => {
    fullApp(); set('coach_app_nudge', true);
    mockCta.mockResolvedValue(false);
    expect(await ask(feature)).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][1]).toMatch(/reply \*1\*/);
    expect(mockSend.mock.calls[0][1]).toContain(`${PORTAL}/go/`);
    expect(mockRedis.has(nudge.replyKey(ME))).toBe(true);
  });

  test('nothing could be sent: false (the WhatsApp flow runs, never silence), no offer armed', async () => {
    fullApp(); set('coach_app_nudge', true);
    mockCta.mockResolvedValue(false); mockSend.mockResolvedValue(false);
    expect(await ask(feature)).toBe(false);
    expect(mockRedis.has(nudge.replyKey(ME))).toBe(false);
  });

  test.each([
    ['no coach_app_nudge row', () => { fullApp(); }],
    ['coach_app_nudge = "coaches"', () => { fullApp(); set('coach_app_nudge', 'coaches'); }],
    ['coach_app_nudge = "teachers"', () => { fullApp(); set('coach_app_nudge', 'teachers'); }],
    ['coach_app_nudge = an object', () => { fullApp(); set('coach_app_nudge', { [ME]: true }); }],
    ['coach_app_nudge = false', () => { fullApp(); set('coach_app_nudge', false); }],
    ['a list without them', () => { fullApp(); set('coach_app_nudge', [OTHER]); }],
    ['not on the full app (portal_coach_full_app without them)', () => {
      set('portal_coach_v2', [ME]); set('portal_coach_full_app', [OTHER]); set('coach_app_nudge', true);
    }],
    ['no portal_coach_full_app row', () => { set('portal_coach_v2', [ME]); set('coach_app_nudge', true); }],
    ['not on the coach app (portal_coach_v2 without them)', () => {
      set('portal_coach_v2', [OTHER]); set('portal_coach_full_app', [ME]); set('coach_app_nudge', [ME]);
    }],
    ['a teacher-role account on every switch', () => { fullApp(); set('coach_app_nudge', true); mockState.users[ME] = row('teacher'); }],
    ['a principal on every switch', () => { fullApp(); set('coach_app_nudge', true); mockState.users[ME] = row('principal'); }],
    ['the account cannot be read', () => { fullApp(); set('coach_app_nudge', true); mockState.usersError = true; }],
    ['the settings cannot be read', () => { fullApp(); set('coach_app_nudge', true); mockState.settingsError = true; }],
  ])('OFF — %s: today\'s flow, nothing sent, no offer armed', async (_name, arrange) => {
    arrange();
    expect(await ask(feature)).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockRedis.has(nudge.replyKey(ME))).toBe(false);
  });
});

describe('the nudge sits beside the October coach link, it does not replace it', () => {
  test('a coach on coach_app_link but not on the nudge still gets the old link (no reply-1 line)', async () => {
    fullApp(); set('coach_app_link', [ME]);
    expect(await ask('observe')).toBe(true);
    expect(mockCta.mock.calls[0][1].body).not.toMatch(/reply/);
    expect(mockRedis.has(nudge.replyKey(ME))).toBe(false);
  });

  test('on both: the nudge is asked first', async () => {
    fullApp(); set('coach_app_link', [ME]); set('coach_app_nudge', true);
    await ask('observe');
    expect(mockCta).toHaveBeenCalledTimes(1);
    expect(mockCta.mock.calls[0][1].body).toMatch(/reply \*1\*/);
  });

  test('training and the School card are not nudged (their own switches decide)', async () => {
    fullApp(); set('coach_app_nudge', true);
    expect(await ask('teacher_training', { reason: 'command' })).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
  });

  test('isCoachNudged answers the same rule (the report line asks it)', async () => {
    fullApp(); set('coach_app_nudge', true);
    expect(await svc.isCoachNudged(ME)).toBe(true);
    mockState.users[ME] = row('teacher');
    svc._resetForTests();
    expect(await svc.isCoachNudged(ME)).toBe(false);
  });
});

describe('the WhatsApp-today choice ends at PKT midnight', () => {
  test('secondsToPktMidnight: 23:00 PKT → one hour; 00:00 PKT → a full day', () => {
    // 23:00 PKT = 18:00 UTC
    expect(nudge.secondsToPktMidnight(Date.UTC(2026, 10, 18, 18, 0, 0))).toBe(3600);
    // 00:00 PKT = 19:00 UTC the day before
    expect(nudge.secondsToPktMidnight(Date.UTC(2026, 10, 18, 19, 0, 0))).toBe(86400);
  });

  test('markWhatsappToday stores it until then', async () => {
    const now = Date.UTC(2026, 10, 18, 18, 0, 0);
    await nudge.markWhatsappToday(ME, now);
    expect(await nudge.choseWhatsappToday(ME)).toBe(true);
    expect(mockTtl.get(nudge.todayKey(ME))).toBe(3600);
  });
});
