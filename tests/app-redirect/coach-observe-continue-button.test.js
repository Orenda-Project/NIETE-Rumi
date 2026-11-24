'use strict';
/**
 * A coach on the portal's HITL switches asking to observe gets the app's button AND a "Continue on WhatsApp" button.
 *
 * The operator, 24 Nov ~14:40: "when the coaches do /observe, they should still [get] the portal link, but a button to
 * still continue thru the whatsapp just in case something breaks." And ~14:50: "The WhatsApp fallback is just for the
 * coaches. Principal can only do it on the app."
 *
 * Who: users.role coach AND the portal's own v6/v7 rule for a coach (observer-report-copy flowV6OnFor: portal_coach_v2
 * AND portal_coach_full_app AND portal_coach_flow_v2 name them: true, "true" or a list holding them). No other switch
 * is needed (coach_app_nudge stays as it was). Observe only: /menu is untouched.
 *
 * What: the app's link button first (cta_url, [Open in the app], signed in on the coach app's Observe page), then ONE
 * reply-button message whose single button "Continue on WhatsApp" (id coach_app_wa:observe) starts today's WhatsApp
 * /observe. A WhatsApp message carries a link button OR reply buttons, never both (only an approved template mixes
 * them), so these are two messages back to back. Every ask gets both: no day's-choice skip.
 *
 * Principals keep the app's button only (2g), with no WhatsApp button. Everyone else: exactly as before.
 *
 * Driven through the real redirectIfFlagged → sendAppLink path with only the edges mocked (WhatsApp, Supabase, Redis,
 * logger), as coach-app-nudge.test.js is.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const mockCta = jest.fn();
const mockSend = jest.fn();
const mockButtons = jest.fn();
const mockOrder = [];
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => { mockOrder.push('text'); return mockSend(...a); },
  sendCtaUrl: (...a) => { mockOrder.push('cta'); return mockCta(...a); },
  sendInteractiveButtons: (...a) => { mockOrder.push('buttons'); return mockButtons(...a); },
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
    upsert: () => Promise.resolve({ error: null }),
  };
  return chain;
}

const ENV = { ...process.env };
const ME = '60530046-7ac3-4ea3-a976-b43c37c23213';
const OTHER = '11111111-1111-4111-8111-111111111111';
const FROM = '923330000099';
const PORTAL = 'https://portal.example.test';
const BUTTON_ID = 'coach_app_wa:observe';

const row = (role) => ({ id: ME, role, name: 'Test Coach', registration_completed: true, registration_state: 'completed' });

let svc; let link; let nudge; let logger;
beforeEach(() => {
  jest.resetModules();
  mockRedis.clear();
  mockOrder.length = 0;
  mockCta.mockReset().mockResolvedValue(true);
  mockSend.mockReset().mockResolvedValue(true);
  mockButtons.mockReset().mockResolvedValue(true);
  mockState = { settings: [], users: { [ME]: row('coach') }, usersError: false, settingsError: false };
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', PORTAL_URL: PORTAL, SUPABASE_URL: 'https://abcdefgh.supabase.co' };
  delete process.env.WEB_TRAINING_TOKEN_SECRET;
  svc = require('../../bot/shared/services/app-redirect.service');
  link = require('../../bot/shared/services/app-login-link');
  nudge = require('../../bot/shared/services/coach-app-nudge.service');
  logger = require('../../bot/shared/utils/logger');
});
afterAll(() => { process.env = ENV; });

const set = (key, value) => mockState.settings.push({ key, value });
const ask = (feature, { userId = ME, language = 'en', reason = 'command' } = {}) =>
  svc.redirectIfFlagged(feature, { userId, from: FROM, language, reason });
/** A coach the portal shows the HITL visit flow to — prod's shape on 24 Nov: v2 true, the other two id lists. */
const hitl = (ids = [ME]) => { set('portal_coach_v2', true); set('portal_coach_full_app', ids); set('portal_coach_flow_v2', ids); };
const tokenOf = (opts) => link.verifyAppLink(opts.url.slice(`${PORTAL}/go/`.length));
const events = (name) => logger.logToFile.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
const cp = (s) => [...s].length;

describe('a coach on the portal\'s HITL switches asks to observe', () => {
  test('the app\'s button first, then ONE message with the "Continue on WhatsApp" button', async () => {
    hitl();
    expect(await ask('observe')).toBe(true);
    expect(mockOrder).toEqual(['cta', 'buttons']);

    const [to, opts] = mockCta.mock.calls[0];
    expect(to).toBe(FROM);
    expect(opts.body).toBe('Take your observation in the app.');
    expect(opts.body).not.toMatch(/reply|\*1\*/);
    expect(opts.buttonText).toBe('Open in the app');
    expect(tokenOf(opts)).toEqual(expect.objectContaining({ u: ME, f: 'coach_observe' }));

    const [to2, payload] = mockButtons.mock.calls[0];
    expect(to2).toBe(FROM);
    expect(payload.body).toMatch(/If the app gives trouble/);
    expect(payload.body).toMatch(/WhatsApp/);
    expect(payload.buttons).toEqual([{ id: BUTTON_ID, title: 'Continue on WhatsApp' }]);
    expect(cp(payload.buttons[0].title)).toBeLessThanOrEqual(20);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('in Urdu: the Urdu line, button and WhatsApp button, inside Meta\'s caps', async () => {
    hitl();
    expect(await ask('observe', { language: 'ur' })).toBe(true);
    const opts = mockCta.mock.calls[0][1];
    expect(opts.body).toBe('اپنا مشاہدہ ایپ میں لیں۔');
    expect(opts.buttonText).toBe('ایپ میں کھولیں');
    const payload = mockButtons.mock.calls[0][1];
    // «واٹس ایپ» is joined by a no-break space, as the copy deck asks
    expect(payload.body).toMatch(/واٹس ایپ/);
    expect(payload.body).not.toMatch(/If the app/);
    expect(payload.buttons[0].id).toBe(BUTTON_ID);
    expect(payload.buttons[0].title).toBe('واٹس ایپ پر کریں');
    expect(cp(payload.buttons[0].title)).toBeLessThanOrEqual(20);
    expect(cp(payload.body)).toBeLessThanOrEqual(1024);
  });

  test('switch values written as JSON text read the same; true reads as everyone', async () => {
    set('portal_coach_v2', 'true'); set('portal_coach_full_app', JSON.stringify([ME])); set('portal_coach_flow_v2', true);
    expect(await ask('observe')).toBe(true);
    expect(mockOrder).toEqual(['cta', 'buttons']);
  });

  test('every ask gets both, even after she chose WhatsApp earlier today', async () => {
    hitl();
    await nudge.markWhatsappToday(ME, Date.now());
    expect(await ask('observe')).toBe(true);
    expect(mockOrder).toEqual(['cta', 'buttons']);
  });

  test('the funnel says a link went with the WhatsApp button offered', async () => {
    hitl();
    await ask('observe');
    expect(events('app_funnel.command')[0]).toEqual(expect.objectContaining({
      userId: ME, feature: 'observe', verdict: 'link', audience: 'coach', offer: 'wa_button',
    }));
    expect(events('app_funnel.link_sent')[0]).toEqual(expect.objectContaining({ via: 'cta_url' }));
  });

  test('no reply-1 offer is armed (the button is the way back)', async () => {
    hitl();
    await ask('observe');
    expect(mockRedis.has(nudge.replyKey(ME))).toBe(false);
  });

  test('Meta refuses the link button: the line and link go as text, then the WhatsApp button', async () => {
    hitl();
    mockCta.mockResolvedValue(false);
    expect(await ask('observe')).toBe(true);
    expect(mockOrder).toEqual(['cta', 'text', 'buttons']);
    expect(mockSend.mock.calls[0][1]).toContain(`${PORTAL}/go/`);
  });

  test('the link went but the WhatsApp button did not: still handled (she has the link)', async () => {
    hitl();
    mockButtons.mockResolvedValue(false);
    expect(await ask('observe')).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
  });

  test('the WhatsApp button throws: still handled, never an error to the caller', async () => {
    hitl();
    mockButtons.mockRejectedValue(new Error('meta down'));
    await expect(ask('observe')).resolves.toBe(true);
  });

  test('nothing could be sent: false (the WhatsApp flow runs, never silence), and no WhatsApp button either', async () => {
    hitl();
    mockCta.mockResolvedValue(false); mockSend.mockResolvedValue(false);
    expect(await ask('observe')).toBe(false);
    expect(mockButtons).not.toHaveBeenCalled();
  });

  test('a coach also on coach_app_nudge gets this form, not the reply-1 line', async () => {
    hitl(); set('coach_app_nudge', true);
    expect(await ask('observe')).toBe(true);
    expect(mockCta.mock.calls[0][1].body).not.toMatch(/reply/);
    expect(mockButtons).toHaveBeenCalledTimes(1);
  });
});

describe('/menu is not part of this', () => {
  test('a coach on every HITL switch asking for the menu: today\'s path (no link, no button)', async () => {
    hitl();
    expect(await ask('menu')).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockButtons).not.toHaveBeenCalled();
  });
});

describe('principals: the app only, never the WhatsApp button', () => {
  test('a principal on the principal app and the flow switch: the app\'s button only', async () => {
    mockState.users[ME] = row('principal');
    set('portal_principal_app', [ME]); set('portal_coach_flow_v2', [ME]);
    expect(await ask('observe')).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
    expect(tokenOf(mockCta.mock.calls[0][1])).toEqual(expect.objectContaining({ f: 'principal_observe' }));
    expect(mockButtons).not.toHaveBeenCalled();
  });

  test('a principal on every coach switch (and the principal app): still no WhatsApp button', async () => {
    mockState.users[ME] = row('principal');
    hitl(); set('portal_principal_app', [ME]);
    expect(await ask('observe')).toBe(true);
    expect(mockButtons).not.toHaveBeenCalled();
  });
});

describe('switch off: exactly as before', () => {
  test.each([
    ['no switches at all', () => {}],
    ['not on portal_coach_flow_v2', () => { set('portal_coach_v2', true); set('portal_coach_full_app', [ME]); set('portal_coach_flow_v2', [OTHER]); }],
    ['no portal_coach_flow_v2 row', () => { set('portal_coach_v2', true); set('portal_coach_full_app', [ME]); }],
    ['not on portal_coach_full_app', () => { set('portal_coach_v2', true); set('portal_coach_full_app', [OTHER]); set('portal_coach_flow_v2', [ME]); }],
    ['not on portal_coach_v2', () => { set('portal_coach_v2', [OTHER]); set('portal_coach_full_app', [ME]); set('portal_coach_flow_v2', [ME]); }],
    ['flow switch = "teachers"', () => { set('portal_coach_v2', true); set('portal_coach_full_app', [ME]); set('portal_coach_flow_v2', 'teachers'); }],
    ['a teacher-role account on every switch', () => { hitl(); mockState.users[ME] = row('teacher'); }],
    ['no users row', () => { hitl(); delete mockState.users[ME]; }],
    ['the account cannot be read', () => { hitl(); mockState.usersError = true; }],
    ['the settings cannot be read', () => { hitl(); mockState.settingsError = true; }],
  ])('%s: today\'s WhatsApp flow, nothing sent', async (_name, arrange) => {
    arrange();
    expect(await ask('observe')).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockButtons).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
});
