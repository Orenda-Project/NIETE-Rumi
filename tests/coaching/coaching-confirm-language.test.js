/**
 * The classroom-audio confirmation is the single most-sent message in the
 * coaching flow, and it was built from English literals with no language read on
 * the path at all. Almost every teacher on this deployment reads Urdu.
 *
 * Executes initiateSession(); Supabase and WhatsApp are mocked at the boundary.
 */

jest.mock('../../bot/shared/config/supabase', () => {
  const builder = {
    select: jest.fn(() => builder),
    insert: jest.fn(() => builder),
    update: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve({ data: global.__CONFIRM_ROW, error: null })),
    maybeSingle: jest.fn(() => Promise.resolve({ data: global.__CONFIRM_ROW, error: null })),
    then: (resolve) => resolve({ data: null, error: null }),
  };
  return { from: jest.fn(() => builder) };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });

jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(() => Promise.resolve('ur')),
  setUserLanguage: jest.fn(),
  DEFAULT_LANGUAGE: 'en',
}));
const mockButtons = jest.fn(() => Promise.resolve());
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendInteractiveButtons: (...a) => mockButtons(...a),
  sendMessage: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({
  flushShelf: jest.fn(() => Promise.resolve()),
}));

const CoachingSessionService =
  require('../../bot/shared/services/coaching/coaching-session.service');
const { getCoachingMessage, COACHING_MESSAGES, TODO } =
  require('../../bot/shared/config/coaching-messages');
const { LANGUAGE_OFFER } = require('../../bot/shared/config/languages');

const cp = (s) => [...s].length;

beforeEach(() => {
  jest.clearAllMocks();
  global.__CONFIRM_ROW = { id: 'cs-1', status: 'initiated', name: 'Ayesha' };
});

describe('the classroom-audio confirmation speaks the teacher language', () => {
  test('the body is the Urdu copy, with the duration interpolated', async () => {
    await CoachingSessionService.initiateSession('u1', 's1', 'a1', '923001234567', 1080);

    expect(mockButtons).toHaveBeenCalledTimes(1);
    const payload = mockButtons.mock.calls[0][1];
    expect(payload.body).toBe(
      getCoachingMessage('coaching_confirmAudio', 'ur').replace('{minutes}', '18'),
    );
    expect(payload.body).toContain('18');
    expect(payload.body).not.toMatch(/[A-Za-z]{4,}/);
  });

  test('both button titles are the Urdu copy', async () => {
    await CoachingSessionService.initiateSession('u1', 's1', 'a1', '923001234567', 1080);

    const payload = mockButtons.mock.calls[0][1];
    const titles = payload.buttons.map((b) => b.title);
    expect(titles).toEqual([
      getCoachingMessage('coaching_confirmYes', 'ur'),
      getCoachingMessage('coaching_confirmNo', 'ur'),
    ]);
    for (const t of titles) expect(t).not.toMatch(/[A-Za-z]{4,}/);
  });

  test('the button ids are untouched — only the titles are translated', async () => {
    await CoachingSessionService.initiateSession('u1', 's1', 'a1', '923001234567', 1080);

    const payload = mockButtons.mock.calls[0][1];
    expect(payload.buttons[0].id).toBe('coaching_confirm_cs-1');
    expect(payload.buttons[1].id).toBe('coaching_cancel_cs-1');
  });
});

describe('field caps, measured in code points', () => {
  test('every confirmation button title fits the 20-code-point reply cap', () => {
    for (const key of ['coaching_confirmYes', 'coaching_confirmNo']) {
      for (const lang of LANGUAGE_OFFER) {
        expect(cp(getCoachingMessage(key, lang))).toBeLessThanOrEqual(20);
      }
    }
    expect(cp(getCoachingMessage('coaching_confirmYes', 'ur'))).toBe(14);
    expect(cp(getCoachingMessage('coaching_confirmNo', 'ur'))).toBe(4);
  });

  test('the confirmation body fits the 1024-code-point body cap', () => {
    for (const lang of LANGUAGE_OFFER) {
      expect(cp(getCoachingMessage('coaching_confirmAudio', lang))).toBeLessThanOrEqual(1024);
    }
  });
});

describe('catalogue completeness', () => {
  /**
   * The file header promises a ratchet: every message has a real string for
   * every offered language. It allowed fifteen untranslated keys, so a teacher
   * in Urdu was walked through her whole coaching session in English.
   */
  test('no offered language is left on the untranslated sentinel', () => {
    const gaps = [];
    for (const [key, variants] of Object.entries(COACHING_MESSAGES)) {
      for (const lang of LANGUAGE_OFFER) {
        if (!variants[lang] || variants[lang] === TODO) gaps.push(`${key}:${lang}`);
      }
    }
    expect(gaps).toEqual([]);
  });
});
