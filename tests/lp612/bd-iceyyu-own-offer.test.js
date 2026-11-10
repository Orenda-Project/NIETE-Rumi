'use strict';
/**
 * bd-iceyyu — "Make my own" in the bot: the offer module (lp612-own-offer.js) and its signed link.
 *
 * Operator, 9 Nov: WhatsApp messages cost money since 1 Oct, so the bot does not run the five questions in chat. A
 * flag-on teacher sees a "Make my own" row FIRST on the chapter's lesson screen (a Flow screen: not a billed message);
 * tapping it sends ONE cta_url message that opens the portal's Make my own page for that chapter, signed in.
 *
 * The switch is the portal's own (portal_lp_make_own, read with the portal's rule) AND the teacher app
 * (portal_teacher_v2), because the portal page needs both: one feature, one answer on both surfaces.
 */

const mockSettings = new Map();
const mockReads = [];
let mockFail = false;
let mockRole = 'teacher';

function mockBuilder(table) {
  const state = { table, keys: null };
  const b = {
    select: () => b,
    eq: (c, v) => { if (c === 'key') state.keys = [v]; return b; },
    in: (c, v) => { if (c === 'key') state.keys = v; return b; },
    maybeSingle: () => {
      mockReads.push(table);
      if (mockFail) return Promise.resolve({ data: null, error: { message: 'boom' } });
      if (table === 'users') return Promise.resolve({ data: { id: 'u', role: mockRole }, error: null });
      const k = state.keys && state.keys[0];
      return Promise.resolve({ data: mockSettings.has(k) ? { value: mockSettings.get(k) } : null, error: null });
    },
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilder(t)) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendCtaUrl: jest.fn(async () => true),
  sendMessage: jest.fn(async () => true),
}));
const mockOnApp = jest.fn(async () => true);
jest.mock('../../bot/shared/services/app-redirect.service', () => ({ isOnTeacherApp: (...a) => mockOnApp(...a) }));

const USER = '2598108b-0000-4000-8000-000000000001';
const ENV = { ...process.env };
let Offer;
let WA;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', PORTAL_URL: 'https://portal.test' };
  mockSettings.clear();
  mockReads.length = 0;
  mockFail = false;
  mockRole = 'teacher';
  mockOnApp.mockClear().mockResolvedValue(true);
  Offer = require('../../bot/shared/services/lp612-own-offer');
  WA = require('../../bot/shared/services/whatsapp.service');
  WA.sendCtaUrl.mockClear().mockResolvedValue(true);
  WA.sendMessage.mockClear().mockResolvedValue(true);
});
afterAll(() => { process.env = ENV; });

describe('who is offered it (the portal rule, fail closed)', () => {
  test('no row: off after ONE settings read — no users read, no teacher-app read', async () => {
    expect(await Offer.isOfferedTo(USER, { now: 1 })).toBe(false);
    expect(mockReads).toEqual(['app_settings']);
    expect(mockOnApp).not.toHaveBeenCalled();
  });

  test('the switch is cached: a second ask inside 30 s reads nothing (no new load per Flow screen)', async () => {
    await Offer.isOfferedTo(USER, { now: 1000 });
    await Offer.isOfferedTo(USER, { now: 20_000 });
    expect(mockReads).toEqual(['app_settings']);
    await Offer.isOfferedTo(USER, { now: 40_000 });
    expect(mockReads).toEqual(['app_settings', 'app_settings']);
  });

  test('a failed read is off and is not cached', async () => {
    mockFail = true;
    expect(await Offer.isOfferedTo(USER, { now: 1 })).toBe(false);
    mockFail = false;
    mockSettings.set('portal_lp_make_own', [USER]);
    expect(await Offer.isOfferedTo(USER, { now: 2 })).toBe(true);
  });

  test('a list holding her, and on the teacher app: on', async () => {
    mockSettings.set('portal_lp_make_own', JSON.stringify([USER]));
    expect(await Offer.isOfferedTo(USER, { now: 1 })).toBe(true);
    expect(mockOnApp).toHaveBeenCalledWith(USER);
  });

  test('a list without her: off, and the teacher app is never asked', async () => {
    mockSettings.set('portal_lp_make_own', ['someone-else']);
    expect(await Offer.isOfferedTo(USER, { now: 1 })).toBe(false);
    expect(mockOnApp).not.toHaveBeenCalled();
  });

  test('on for her but not on the teacher app: off (the portal page would turn her away)', async () => {
    mockSettings.set('portal_lp_make_own', true);
    mockOnApp.mockResolvedValue(false);
    expect(await Offer.isOfferedTo(USER, { now: 1 })).toBe(false);
  });

  test('"teachers": on for a teacher, off for a coach', async () => {
    mockSettings.set('portal_lp_make_own', 'teachers');
    expect(await Offer.isOfferedTo(USER, { now: 1 })).toBe(true);
    mockRole = 'coach';
    expect(await Offer.isOfferedTo(USER, { now: 2 })).toBe(false);
  });

  test('no user: off, nothing read', async () => {
    expect(await Offer.isOfferedTo('', { now: 1 })).toBe(false);
    expect(mockReads).toEqual([]);
  });
});

describe('the row', () => {
  const cps = (s) => [...s].length;

  test('English book: the reviewer-signed copy, inside the NavigationList caps, one data_exchange step', () => {
    const row = Offer.ownRow({ grade: 7, subject: 'Physics', chapterKey: 'c01', rtl: false });
    expect(row.id).toBe(Offer.ROW_ID);
    expect(row['main-content'].title).toBe('Make my own');
    expect(row['main-content'].description).toBe('5 questions · 1 min');
    expect(row['on-click-action']).toEqual({
      name: 'data_exchange',
      payload: { step: 'lp612_own', grade: '7', subject: 'Physics', chapter_key: 'c01' },
    });
  });

  test('Urdu book: Urdu row, RTL-led, still inside the caps', () => {
    const mc = Offer.ownRow({ grade: 7, subject: 'Urdu', chapterKey: 'c02', rtl: true })['main-content'];
    expect(mc.title).toContain('اپنا پلان بنائیں');
    expect(mc.title.startsWith('‏')).toBe(true);
    expect(cps(mc.title)).toBeLessThanOrEqual(30);
    expect(cps(mc.description)).toBeLessThanOrEqual(20);
    expect(cps(mc.metadata || '')).toBeLessThanOrEqual(80);
  });
});

describe('the one message', () => {
  const at = { grade: 7, subject: 'Physics', chapterKey: 'c01' };

  test('exactly ONE cta_url whose button opens /go/<token>, the token landing on this chapter\'s Make my own', async () => {
    const ok = await Offer.sendOwnLink({ userId: USER, phone: '923345027774', language: 'en', ...at });
    expect(ok).toBe(true);
    expect(WA.sendCtaUrl).toHaveBeenCalledTimes(1);
    expect(WA.sendMessage).not.toHaveBeenCalled();
    const [to, { body, buttonText, url }] = WA.sendCtaUrl.mock.calls[0];
    expect(to).toBe('923345027774');
    expect(buttonText).toBe('Make my own');
    expect(body).toMatch(/24 hours/);
    const m = url.match(/^https:\/\/portal\.test\/go\/([A-Za-z0-9_-]+)$/);
    expect(m).not.toBeNull();
    const Link = require('../../bot/shared/services/app-login-link');
    const p = Link.verifyAppLink(m[1]);
    expect(p).toEqual(expect.objectContaining({ u: USER, f: 'lp_make_own', q: { grade: 7, subject: 'Physics', chapter: 'c01' } }));
    expect(Link.LANDINGS.lp_make_own + Link.landingQuery(p))
      .toBe('/portal/teacher/lessons/own?grade=7&subject=Physics&chapter=c01');
  });

  test('grades 1-5: a v8 subject key and chapter (number or review R1) land on that chapter', async () => {
    const Link = require('../../bot/shared/services/app-login-link');
    for (const [q, want] of [
      [{ grade: 3, subject: 'urdu', chapterKey: '4' }, '?grade=3&subject=urdu&chapter=4'],
      [{ grade: 1, subject: 'general_knowledge', chapterKey: 'R1' }, '?grade=1&subject=general_knowledge&chapter=R1'],
    ]) {
      WA.sendCtaUrl.mockClear();
      expect(await Offer.sendOwnLink({ userId: USER, phone: '92', language: 'en', ...q })).toBe(true);
      const token = WA.sendCtaUrl.mock.calls[0][1].url.split('/go/')[1];
      const p = Link.verifyAppLink(token);
      expect(p).not.toBeNull();
      expect(Link.landingQuery(p)).toBe(want);
    }
  });

  test('Urdu: the Urdu line and button', async () => {
    await Offer.sendOwnLink({ userId: USER, phone: '92', language: 'ur', ...at });
    const [, { body, buttonText }] = WA.sendCtaUrl.mock.calls[0];
    expect(buttonText).toBe('اپنا پلان بنائیں');
    expect(body).toContain('اپنا پلان بنائیں');
  });

  test('Meta refuses the button: the same link once as text — still one message', async () => {
    WA.sendCtaUrl.mockResolvedValue(false);
    expect(await Offer.sendOwnLink({ userId: USER, phone: '92', language: 'en', ...at })).toBe(true);
    expect(WA.sendMessage).toHaveBeenCalledTimes(1);
    expect(WA.sendMessage.mock.calls[0][1]).toMatch(/https:\/\/portal\.test\/go\//);
  });

  test('no signing key or portal: nothing is sent', async () => {
    delete process.env.INTERNAL_API_KEY;
    expect(await Offer.sendOwnLink({ userId: USER, phone: '92', language: 'en', ...at })).toBe(false);
    expect(WA.sendCtaUrl).not.toHaveBeenCalled();
  });

  test('a send that throws is false, never a throw into the Flow', async () => {
    WA.sendCtaUrl.mockRejectedValue(new Error('meta down'));
    expect(await Offer.sendOwnLink({ userId: USER, phone: '92', language: 'en', ...at })).toBe(false);
  });
});

describe('the token\'s pre-fill is checked', () => {
  const Link = () => require('../../bot/shared/services/app-login-link');

  test.each([
    [{ grade: 13, subject: 'Physics', chapter: 'c01' }],
    [{ grade: 7, subject: 'Phys<script>', chapter: 'c01' }],
    [{ grade: 7, subject: 'Physics', chapter: '../x' }],
    [{ grade: '7', subject: 'Physics', chapter: 'c01' }],
  ])('a malformed pre-fill is dropped: %j', (q) => {
    const L = Link();
    const p = L.verifyAppLink(L.signAppLink(USER, 'lp_make_own', null, q));
    expect(p.q).toBeNull();
  });

  test('a subject with spaces and the p3c01 chapter shape survive', () => {
    const L = Link();
    const p = L.verifyAppLink(L.signAppLink(USER, 'lp_make_own', null, { grade: 9, subject: 'Pakistan Studies', chapter: 'p3c01' }));
    expect(p.q).toEqual({ grade: 9, subject: 'Pakistan Studies', chapter: 'p3c01' });
    expect(L.landingQuery(p)).toBe('?grade=9&subject=Pakistan+Studies&chapter=p3c01');
  });
});
