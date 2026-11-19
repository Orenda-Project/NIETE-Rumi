'use strict';
/**
 * The lesson-plan door with `lp_whatsapp_pdf_off`: a teacher whose programme (GB when lp-own-gb says so, else ICT) is
 * on the list always gets the app link for a lesson plan — never the WhatsApp Flow that ends in a PDF, and never the
 * Play Store notice — whatever app_redirect_lesson_plan says. Not on the list (or no row, or a malformed value): the
 * door decides exactly as today. Other features never read the switch.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/lp-whatsapp-off', () => require('../fixtures/lp-whatsapp-off-fake').module);
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
      if (table === 'users') return Promise.resolve({ data: mockState.users[filters.id] || null, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    upsert: () => { mockState.upserts += 1; return Promise.resolve({ error: null }); },
  };
  return chain;
}

// The data is fixed; the state lives in the copy the mocked module holds (re-required after each reset).
const { PER_TEACHER } = require('../fixtures/lp-whatsapp-off-fake');
let Fake;

const ENV = { ...process.env };
const FROM = '920000000099';
const PORTAL = 'https://portal.example.test';
const teacher = (id) => ({ id, role: 'teacher', name: 'T', registration_completed: true, registration_state: 'completed' });

let svc; let link;
beforeEach(() => {
  jest.resetModules();
  Fake = require('../fixtures/lp-whatsapp-off-fake');
  Fake.reset();
  mockCta.mockReset().mockResolvedValue(true);
  mockSend.mockReset().mockResolvedValue(true);
  mockState = {
    settings: [],
    users: { [Fake.ICT_TEACHER]: teacher(Fake.ICT_TEACHER), [Fake.GB_TEACHER]: teacher(Fake.GB_TEACHER) },
    upserts: 0,
  };
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', PORTAL_URL: PORTAL, SUPABASE_URL: 'https://abcdefgh.supabase.co' };
  svc = require('../../bot/shared/services/app-redirect.service');
  link = require('../../bot/shared/services/app-login-link');
});
afterAll(() => { process.env = ENV; });

const set = (key, value) => mockState.settings.push({ key, value });
const ask = (feature, userId) => svc.redirectIfFlagged(feature, { userId, from: FROM, language: 'en', reason: 'test' });
const landedOn = () => link.verifyAppLink(mockCta.mock.calls[0][1].url.slice(`${PORTAL}/go/`.length));

describe.each(PER_TEACHER)('lp_whatsapp_pdf_off %s, %s teacher, app_redirect_lesson_plan absent', (_l, value, _w, userId, off) => {
  test(off ? 'the app link, one message, no Flow' : 'today: not handled, nothing sent', async () => {
    Fake.setPdfOff(value);
    expect(await ask('lesson_plan', userId)).toBe(off);
    if (off) {
      expect(mockCta).toHaveBeenCalledTimes(1);
      expect(landedOn()).toEqual(expect.objectContaining({ u: userId, f: 'lesson_plan' }));
    } else {
      expect(mockCta).not.toHaveBeenCalled();
    }
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('the switch wins over the per-user redirect', () => {
  test('a pilot list without her: off → the link (today it would be the Flow)', async () => {
    Fake.setPdfOff(['ict']);
    set('app_redirect_lesson_plan', ['11111111-1111-4111-8111-111111111111']);
    expect(await ask('lesson_plan', Fake.ICT_TEACHER)).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
  });

  test('plain true (the Play Store notice): off → the link, not the notice', async () => {
    Fake.setPdfOff(['gb']);
    set('app_redirect_lesson_plan', true);
    expect(await ask('lesson_plan', Fake.GB_TEACHER)).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockState.upserts).toBe(0);
  });

  test('plain true and her programme NOT listed: the Play Store notice, as today', async () => {
    Fake.setPdfOff(['gb']);
    set('app_redirect_lesson_plan', true);
    expect(await ask('lesson_plan', Fake.ICT_TEACHER)).toBe(true);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

test('other features never read the switch', async () => {
  Fake.setPdfOff(['ict', 'gb']);
  expect(await ask('menu', Fake.ICT_TEACHER)).toBe(false);
  expect(await ask('assessment_generator', Fake.GB_TEACHER)).toBe(false);
  expect(Fake.state.calls).toEqual([]);
  expect(mockCta).not.toHaveBeenCalled();
});

describe('sendLessonPlanLink (the in-flight guards send the same link)', () => {
  test('one cta_url that lands on Lesson Plans', async () => {
    expect(await svc.sendLessonPlanLink({ userId: Fake.ICT_TEACHER, from: FROM, language: 'en', reason: 'flow_tap' })).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
    expect(landedOn()).toEqual(expect.objectContaining({ u: Fake.ICT_TEACHER, f: 'lesson_plan' }));
  });

  test('no portal url on this deployment: false, nothing sent', async () => {
    delete process.env.PORTAL_URL;
    expect(await svc.sendLessonPlanLink({ userId: Fake.ICT_TEACHER, from: FROM, language: 'en', reason: 'flow_tap' })).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
  });
});
