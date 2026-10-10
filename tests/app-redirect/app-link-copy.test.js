'use strict';
/**
 * bd-fmf24g.42 — the pilot's one-tap app link says ONE short line per command, in her language, and nothing else.
 *
 * The operator, verbatim: "When talking to customer, we want to be very clear and straightforward, and dont give any
 * information when if not needed. Here you say you are already signed in. We dont need to say that. Just tell them to
 * open the app. And ideally different copy for all the slash commands."
 *
 * So: each of the seven linkable features (LANDINGS) has its own body and button; the plain-text fallback (sent when
 * Meta refuses the button) uses the same body; no line says "signed in" in either language; every button fits Meta's
 * 20-code-point cap; and a linkable feature with no line of its own gets the generic "Open the NIETE app." — never
 * the old wording.
 *
 * The English is the operator-approved table. The Urdu is the teacher app's own vocabulary (portal teacher copy.ts:
 * لیسن پلان, پرچہ بنائیں, سبق ریکارڈ کریں, ٹریننگ, حاضری لگائیں, میری کلاسیں, کھولیں).
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
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => mockFrom() }));
function mockFrom() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: (_c, vals) => Promise.resolve({ data: mockState.settings.filter((r) => vals.includes(r.key)), error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    upsert: () => Promise.resolve({ error: null }),
  };
  return chain;
}

const ENV = { ...process.env };
const PILOT = '60530046-7ac3-4ea3-a976-b43c37c23213';
const FROM = '923330000099';
const PORTAL = 'https://portal.example.test';
const LOGIN_LINK = '../../bot/shared/services/app-login-link';
let svc;
beforeEach(() => {
  jest.resetModules();
  mockCta.mockReset().mockResolvedValue(true);
  mockSend.mockReset().mockResolvedValue(true);
  mockState = { settings: [] };
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', PORTAL_URL: PORTAL };
  svc = require('../../bot/shared/services/app-redirect.service');
});
afterAll(() => { process.env = ENV; });

const set = (key, value) => mockState.settings.push({ key, value });
const pilot = (feature) => { set(`app_redirect_${feature}`, [PILOT]); set('portal_teacher_v2', true); };
const ask = (feature, language) => svc.redirectIfFlagged(feature, { userId: PILOT, from: FROM, language, reason: 'test' });

// Direction marks are layout, not words: an Urdu line that opens with "NIETE" carries a U+200F (catalog rule).
const shown = (s) => String(s).replace(/[‎‏⁦-⁩]/g, '');
const codePoints = (s) => [...s].length;
const SIGNED_IN = /sign(ed)?[\s-]*in|لاگ\s*اِ?ن|پہلے سے/i;

/** feature → { language: [body, button] } — the copy, as approved. */
const COPY = {
  menu: {
    en: ['Open the NIETE app.', 'Open app'],
    ur: ['NIETE ایپ کھولیں۔', 'ایپ کھولیں'],
  },
  lesson_plan: {
    en: ['Open your lesson plans.', 'Lesson plans'],
    ur: ['اپنے لیسن پلان کھولیں۔', 'لیسن پلان'],
  },
  assessment_generator: {
    en: ['Make a paper in the app.', 'Make a paper'],
    ur: ['ایپ میں پرچہ بنائیں۔', 'پرچہ بنائیں'],
  },
  ai_coaching: {
    en: ['Record your lesson in the app.', 'Record lesson'],
    ur: ['ایپ میں اپنا سبق ریکارڈ کریں۔', 'سبق ریکارڈ کریں'],
  },
  teacher_training: {
    en: ['Open your training.', 'Training'],
    ur: ['اپنی ٹریننگ کھولیں۔', 'ٹریننگ'],
  },
  attendance: {
    en: ['Take attendance in the app.', 'Attendance'],
    ur: ['ایپ میں حاضری لگائیں۔', 'حاضری'],
  },
  classes: {
    en: ['Open your classes.', 'My classes'],
    ur: ['اپنی کلاسیں کھولیں۔', 'میری کلاسیں'],
  },
};
const GENERIC = COPY.menu;

const CASES = Object.entries(COPY).flatMap(([feature, langs]) =>
  Object.entries(langs).map(([language, [body, button]]) => [feature, language, body, button]));

test('the table covers exactly the seven linkable features', () => {
  const { LANDINGS } = require(LOGIN_LINK);
  expect(Object.keys(COPY).sort()).toEqual(Object.keys(LANDINGS).sort());
});

describe.each(CASES)('%s in %s', (feature, language, body, button) => {
  test('sends its own one line and its own button', async () => {
    pilot(feature);
    expect(await ask(feature, language)).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
    const opts = mockCta.mock.calls[0][1];
    expect(shown(opts.body)).toBe(body);
    expect(shown(opts.buttonText)).toBe(button);
    expect(opts.url.startsWith(`${PORTAL}/go/`)).toBe(true);
  });

  test('says nothing about being signed in', async () => {
    pilot(feature);
    await ask(feature, language);
    const opts = mockCta.mock.calls[0][1];
    expect(opts.body).not.toMatch(SIGNED_IN);
    expect(opts.buttonText).not.toMatch(SIGNED_IN);
  });

  test('the button fits Meta\'s 20-code-point cap', async () => {
    pilot(feature);
    await ask(feature, language);
    expect(codePoints(mockCta.mock.calls[0][1].buttonText)).toBeLessThanOrEqual(20);
  });

  test('the plain-text fallback is the same line, then the link', async () => {
    pilot(feature);
    mockCta.mockResolvedValue(false);
    expect(await ask(feature, language)).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [line, url] = mockSend.mock.calls[0][1].split('\n');
    expect(shown(line)).toBe(body);
    expect(url.startsWith(`${PORTAL}/go/`)).toBe(true);
    expect(mockSend.mock.calls[0][1]).not.toMatch(SIGNED_IN);
  });
});

test('every feature has a DIFFERENT line from every other, in both languages', async () => {
  for (const language of ['en', 'ur']) {
    const bodies = new Set();
    for (const feature of Object.keys(COPY)) {
      mockCta.mockClear();
      mockState.settings = [];
      svc._resetForTests();   // the switches are cached for 30 s; each feature is a fresh read
      pilot(feature);
      await ask(feature, language);
      bodies.add(mockCta.mock.calls[0][1].body);
    }
    expect(bodies.size).toBe(Object.keys(COPY).length);
  }
});

describe('a linkable feature with no line of its own gets the generic line, never the old wording', () => {
  // `observe` has a switch but no v2 page today. Give it one (as a later bead might) without giving it copy.
  beforeEach(() => {
    jest.resetModules();
    jest.doMock(LOGIN_LINK, () => {
      const actual = jest.requireActual(LOGIN_LINK);
      return {
        ...actual,
        LANDINGS: Object.freeze({ ...actual.LANDINGS, observe: '/portal/teacher/observe' }),
        signAppLink: (userId) => (userId ? 'T'.repeat(48) : null),
      };
    });
    svc = require('../../bot/shared/services/app-redirect.service');
  });
  afterEach(() => { jest.dontMock(LOGIN_LINK); });

  test.each(['en', 'ur'])('%s', async (language) => {
    pilot('observe');
    expect(await ask('observe', language)).toBe(true);
    const opts = mockCta.mock.calls[0][1];
    expect(shown(opts.body)).toBe(GENERIC[language][0]);
    expect(shown(opts.buttonText)).toBe(GENERIC[language][1]);
    expect(opts.body).not.toMatch(SIGNED_IN);
    expect(opts.body).not.toMatch(/Tap below|نیچے دیا گیا بٹن/);
  });
});
