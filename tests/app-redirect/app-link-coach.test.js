'use strict';
/**
 * bd-fmf24g.52 — the one-tap app link for a COACH: /menu and /observe open the coach app, signed in.
 *
 * The teacher link (bd-fmf24g.35/.46) goes only to teachers and only lands on teacher pages, so a coach's /observe
 * still opened the old WhatsApp observe form. Now a coach gets ONE cta_url message — a line and a button — when ALL
 * of these hold:
 *   - users.role is coach;
 *   - they are on the coach app (portal_coach_v2, read with the portal's own rule: true, or a list holding them);
 *   - they are on the coach-link pilot switch `coach_app_link` — a JSON list of users.id, SEPARATE from
 *     portal_coach_v2, so putting more coaches on the coach app never changes WhatsApp by itself.
 * /menu lands on coach Home (/portal/coach), /observe on the coach app's Observe page (/portal/coach/observe).
 *
 * Everyone else keeps today's behaviour exactly: every teacher (her link still lands on /portal/teacher), every
 * coach not on the switch, principals, and anyone whose account cannot be read. The switch takes ONLY a list: true,
 * "teachers", an object or no row is OFF — and old code never reads the key at all, so a rollback cannot turn it into
 * a Play Store notice or a link for anyone.
 *
 * Driven through the real redirectIfFlagged → sendAppLink path with only the edges mocked (WhatsApp, Supabase, logger).
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
    in: (_c, vals) => {
      if (mockState.settingsError) return Promise.resolve({ data: null, error: { message: 'boom' } });
      return Promise.resolve({ data: mockState.settings.filter((r) => vals.includes(r.key)), error: null });
    },
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
const OTHER = '11111111-1111-4111-8111-111111111111';
const FROM = '923330000099';
const PORTAL = 'https://portal.example.test';
const COACH_PAGES = { menu: ['coach_menu', '/portal/coach'], observe: ['coach_observe', '/portal/coach/observe'] };
const TWO = Object.keys(COACH_PAGES);

const row = (role, extra = {}) => ({ id: ME, role, name: 'Hataf', registration_completed: true, registration_state: 'completed', ...extra });

let svc; let link;
beforeEach(() => {
  jest.resetModules();
  mockCta.mockReset().mockResolvedValue(true);
  mockSend.mockReset().mockResolvedValue(true);
  mockState = { settings: [], users: { [ME]: row('coach') }, usersError: false, settingsError: false, userReads: 0, upserts: 0 };
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', PORTAL_URL: PORTAL, SUPABASE_URL: 'https://abcdefgh.supabase.co' };
  delete process.env.WEB_TRAINING_TOKEN_SECRET;
  svc = require('../../bot/shared/services/app-redirect.service');
  link = require('../../bot/shared/services/app-login-link');
});
afterAll(() => { process.env = ENV; });

const set = (key, value) => mockState.settings.push({ key, value });
const ask = (feature, { userId = ME, language = 'en' } = {}) =>
  svc.redirectIfFlagged(feature, { userId, from: FROM, language, reason: 'test' });
/** Production today: every teacher has the /menu link ("teachers"), the operator alone is on the coach app. */
const prodToday = () => {
  set('app_redirect_menu', 'teachers');
  set('portal_teacher_v2', 'teachers');
  set('portal_coach_v2', [ME]);
};
const pilotCoach = () => { prodToday(); set('coach_app_link', [ME]); };
const tokenOf = (opts) => link.verifyAppLink(opts.url.slice(`${PORTAL}/go/`.length));

describe.each(TWO)('a pilot coach sends %s', (feature) => {
  const [tokenFeature, page] = COACH_PAGES[feature];

  test(`ONE cta_url message whose link signs them in and lands on ${page}`, async () => {
    pilotCoach();
    expect(await ask(feature)).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalled();
    const [to, opts] = mockCta.mock.calls[0];
    expect(to).toBe(FROM);
    expect(opts.url.startsWith(`${PORTAL}/go/`)).toBe(true);
    expect(tokenOf(opts)).toEqual(expect.objectContaining({ u: ME, f: tokenFeature }));
    expect(link.COACH_LANDINGS[tokenFeature]).toBe(page);
    expect(opts.url).not.toContain('play.google.com');
    expect(mockState.upserts).toBe(0); // no quiet hour
  });

  test('portal_coach_v2 = true (every coach) also counts as on the coach app', async () => {
    set('portal_coach_v2', true);
    set('coach_app_link', [ME]);
    expect(await ask(feature)).toBe(true);
    expect(tokenOf(mockCta.mock.calls[0][1]).f).toBe(tokenFeature);
  });

  test('the switch values written as JSON text read the same', async () => {
    set('portal_coach_v2', JSON.stringify([ME]));
    set('coach_app_link', JSON.stringify([ME]));
    expect(await ask(feature)).toBe(true);
  });

  test('role written loosely (" Coach ") is still a coach, as the portal reads it', async () => {
    pilotCoach();
    mockState.users[ME] = row(' Coach ');
    expect(await ask(feature)).toBe(true);
  });

  test.each([
    ['not on coach_app_link (list without them)', () => { prodToday(); set('coach_app_link', [OTHER]); }],
    ['no coach_app_link row', () => { prodToday(); }],
    ['coach_app_link = true (only a list is a value)', () => { prodToday(); set('coach_app_link', true); }],
    ['coach_app_link = "true"', () => { prodToday(); set('coach_app_link', 'true'); }],
    ['coach_app_link = "teachers"', () => { prodToday(); set('coach_app_link', 'teachers'); }],
    ['coach_app_link = "coaches"', () => { prodToday(); set('coach_app_link', 'coaches'); }],
    ['coach_app_link = an object', () => { prodToday(); set('coach_app_link', { [ME]: true }); }],
    ['on the switch but NOT on the coach app (portal_coach_v2 a list without them)', () => {
      set('app_redirect_menu', 'teachers'); set('portal_teacher_v2', 'teachers'); set('portal_coach_v2', [OTHER]); set('coach_app_link', [ME]);
    }],
    ['on the switch but portal_coach_v2 absent', () => {
      set('app_redirect_menu', 'teachers'); set('portal_teacher_v2', 'teachers'); set('coach_app_link', [ME]);
    }],
    ['on the switch but portal_coach_v2 = "teachers" (never a coach)', () => {
      set('app_redirect_menu', 'teachers'); set('portal_teacher_v2', 'teachers'); set('portal_coach_v2', 'teachers'); set('coach_app_link', [ME]);
    }],
    ['on the switch but portal_coach_v2 = false', () => {
      set('app_redirect_menu', 'teachers'); set('portal_teacher_v2', 'teachers'); set('portal_coach_v2', false); set('coach_app_link', [ME]);
    }],
  ])('a coach %s keeps today\'s WhatsApp flow: not handled, nothing sent', async (_label, setup) => {
    setup();
    expect(await ask(feature)).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockState.upserts).toBe(0);
  });

  test.each([
    ['a principal', 'principal'],
    ['an aeo', 'aeo'],
    ['a school leader', 'school_leader'],
    ['role unregistered', 'unregistered'],
    ['no role', null],
  ])('%s on the switch and on the coach app gets no coach link, and today\'s flow runs', async (_label, role) => {
    pilotCoach();
    mockState.users[ME] = row(role);
    expect(await ask(feature)).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('no users row, or the read fails: today\'s flow, nothing sent', async () => {
    pilotCoach();
    delete mockState.users[ME];
    expect(await ask(feature)).toBe(false);
    mockState.users[ME] = row('coach');
    mockState.usersError = true;
    expect(await ask(feature)).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('the app_settings read fails: OFF, nothing sent', async () => {
    pilotCoach();
    mockState.settingsError = true;
    expect(await ask(feature)).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('a failed button falls back to the same line + link as plain text; if that fails too, the flow runs', async () => {
    pilotCoach();
    mockCta.mockResolvedValue(false);
    expect(await ask(feature)).toBe(true);
    expect(mockSend.mock.calls[0][1]).toContain(`${PORTAL}/go/`);
    mockSend.mockResolvedValue(false);
    expect(await ask(feature)).toBe(false);
  });
});

test('/observe for a pilot coach is the link even if app_redirect_observe is on (the link comes before the notice)', async () => {
  pilotCoach();
  set('app_redirect_observe', true);
  expect(await ask('observe')).toBe(true);
  expect(mockCta).toHaveBeenCalledTimes(1);
  expect(mockSend).not.toHaveBeenCalled();
});

test('only /menu and /observe: every other feature for a pilot coach is exactly today\'s path', async () => {
  pilotCoach();
  for (const f of Object.keys(svc.APP_REDIRECT_FLAGS).filter((k) => !TWO.includes(k))) {
    expect(await ask(f)).toBe(false);
  }
  expect(mockCta).not.toHaveBeenCalled();
  expect(mockSend).not.toHaveBeenCalled();
});

test('general_chat (asked on every open message) never reads the users row, even for a pilot coach', async () => {
  pilotCoach();
  await ask('general_chat');
  expect(mockState.userReads).toBe(0);
});

test('a user NOT on coach_app_link costs no users read for /observe (the list is checked first)', async () => {
  prodToday();
  set('coach_app_link', [OTHER]);
  await ask('observe');
  expect(mockState.userReads).toBe(0);
});

describe('teachers are unchanged', () => {
  test('a teacher\'s /menu still gets the TEACHER link, landing on /portal/teacher — even if she is on coach_app_link', async () => {
    pilotCoach();
    mockState.users[ME] = row('teacher');
    expect(await ask('menu')).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
    const t = tokenOf(mockCta.mock.calls[0][1]);
    expect(t).toEqual(expect.objectContaining({ u: ME, f: 'menu' }));
    expect(link.LANDINGS[t.f]).toBe('/portal/teacher');
  });

  test('a teacher\'s /observe stays today\'s flow (no link, no notice)', async () => {
    pilotCoach();
    mockState.users[ME] = row('teacher');
    expect(await ask('observe')).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('a teacher\'s link words are the teacher words', async () => {
    prodToday();
    mockState.users[ME] = row('teacher');
    await ask('menu');
    expect(mockCta.mock.calls[0][1]).toEqual(expect.objectContaining({ body: 'Open the NIETE app.', buttonText: 'Open app' }));
  });
});

/* The copy: one short line per command, en + ur, the coach app's own words, button <= 20 code points. */
const shown = (s) => String(s).replace(/[‎‏⁦-⁩]/g, '');
const codePoints = (s) => [...s].length;
const SIGNED_IN = /sign(ed)?[\s-]*in|لاگ\s*اِ?ن|پہلے سے/i;
const COPY = {
  menu: { en: ['Open the NIETE app.', 'Open app'], ur: ['NIETE ایپ کھولیں۔', 'ایپ کھولیں'] },
  observe: { en: ['Take an observation in the app.', 'Take observation'], ur: ['ایپ میں مشاہدہ لیں۔', 'مشاہدہ لیں'] },
};
describe.each(Object.entries(COPY).flatMap(([f, l]) => Object.entries(l).map(([lang, [b, btn]]) => [f, lang, b, btn])))(
  'copy: %s in %s', (feature, language, body, button) => {
    test('its own line and button, nothing about signing in, button within 20 code points', async () => {
      pilotCoach();
      expect(await ask(feature, { language })).toBe(true);
      const opts = mockCta.mock.calls[0][1];
      expect(shown(opts.body)).toBe(body);
      expect(shown(opts.buttonText)).toBe(button);
      expect(opts.body).not.toMatch(SIGNED_IN);
      expect(codePoints(opts.buttonText)).toBeLessThanOrEqual(20);
      expect(opts.body.split('\n')).toHaveLength(1);
    });
  });

/*
 * The agreement: for every value portal_coach_v2 can hold and every role, the bot's "is this coach on the coach app?"
 * equals the portal's (dashboard/lib/feature-flags.js isCoachAppUser — the flag by isFlagEnabledForUser, and role coach,
 * which is what CoachGate + requireLeaderRole let through). A link is never sent to a page its coach cannot open.
 */
describe('the bot and the portal agree on who is on the coach app', () => {
  const VALUES = [true, 'true', false, [ME], ['someone-else'], 'teachers', '"teachers"', {}, 'nope', null];
  const ROLES = ['coach', ' Coach ', 'teacher', 'principal', 'aeo', 'unregistered', null];

  test.each(VALUES.flatMap((v) => ROLES.map((r) => [JSON.stringify(v), JSON.stringify(r), v, r])))('value %s, role %s', async (_l, _r, value, role) => {
    mockState.users[ME] = row(role);
    set('coach_app_link', [ME]);
    if (value !== null) set('portal_coach_v2', value);
    const bot = await ask('observe');
    const { isCoachAppUser } = require('../../dashboard/lib/feature-flags');
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
    const portal = await isCoachAppUser(portalDb, ME);
    expect(bot).toBe(portal);
  });

  test('the portal side fails closed: no user, a failed read', async () => {
    const { isCoachAppUser } = require('../../dashboard/lib/feature-flags');
    const failing = { from: () => { const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) }; return c; } };
    expect(await isCoachAppUser(failing, ME)).toBe(false);
    expect(await isCoachAppUser(failing, null)).toBe(false);
  });
});

describe('rollback safety: the switch is its own key, never an app_redirect_* key', () => {
  test('coach_app_link is not one of the redirect switches (old code reads only those + portal_teacher_v2)', () => {
    expect(Object.values(svc.APP_REDIRECT_FLAGS)).not.toContain('coach_app_link');
    expect(Object.values(svc.APP_REDIRECT_FLAGS).every((k) => k.startsWith('app_redirect_'))).toBe(true);
  });

  test('with ONLY coach_app_link + portal_coach_v2 set, no feature sends a Play Store notice to anyone', async () => {
    set('coach_app_link', [ME]);
    set('portal_coach_v2', [ME]);
    for (const role of ['teacher', 'principal', 'coach']) {
      mockState.users[ME] = row(role);
      for (const f of Object.keys(svc.APP_REDIRECT_FLAGS)) await ask(f);
    }
    expect(mockSend.mock.calls.filter(([, b]) => String(b).includes('play.google.com'))).toHaveLength(0);
  });
});
