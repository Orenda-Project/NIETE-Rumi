/**
 * bd-2469 — the password-reset OTP must go out in the USER'S language.
 *
 * The reset template is approved on the NIETE WABA in en AND ur, and the bot
 * picks the variant from the `language` field the portal sends. But the route
 * called sendResetCode(phoneNumber) with no language and the service defaulted
 * to 'en', so every Urdu coach got an English verification code.
 *
 * The service already loads the user row, so it should decide: read
 * `preferred_language` (never `user.language` — dead column, CLAUDE.md rule 20)
 * and clamp to what the WABA actually has (en/ur) so an unexpected value can't
 * ask Meta for a template variant that doesn't exist.
 */

// A registered teacher as the row really is: the name lives in `name` (bd-x7aprz.3 sends a code to a registered adult;
// `first_name` is a dead column).
const mockUserRow = {
  id: 'u-1', name: 'Rifat', portal_activated: true, preferred_language: 'ur',
};

jest.mock('../config/supabase', () => ({
  from: jest.fn(() => ({
    select: jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ data: [global.__USER_ROW__], error: null })),
    })),
    update: jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ error: null })),
    })),
  })),
}));

jest.mock('axios', () => ({ post: jest.fn(() => Promise.resolve({ data: { success: true } })) }));

const axios = require('axios');
const PasswordResetService = require('../services/password-reset.service');

function sentLanguage() {
  const [, body] = axios.post.mock.calls[axios.post.mock.calls.length - 1];
  return body.language;
}

describe('sendResetCode language (bd-2469)', () => {
  beforeEach(() => {
    axios.post.mockClear();
    global.__USER_ROW__ = { ...mockUserRow };
  });

  it("sends the Urdu template for a teacher whose preferred_language is 'ur'", async () => {
    const res = await PasswordResetService.sendResetCode('923238001437');
    expect(res.success).toBe(true);
    expect(sentLanguage()).toBe('ur');
  });

  it("sends English for an English user", async () => {
    global.__USER_ROW__ = { ...mockUserRow, preferred_language: 'en' };
    await PasswordResetService.sendResetCode('923365709413');
    expect(sentLanguage()).toBe('en');
  });

  it('clamps a language the WABA has no template for down to English', async () => {
    // sw/ar exist upstream but NOT on the NIETE WABA — asking for them would
    // make Meta reject the send outright.
    for (const lang of ['sw', 'ar', 'pa-PK', null, undefined, '']) {
      global.__USER_ROW__ = { ...mockUserRow, preferred_language: lang };
      await PasswordResetService.sendResetCode('923000000000');
      expect({ lang, sent: sentLanguage() }).toEqual({ lang, sent: 'en' });
    }
  });

  it('an explicit language argument still wins (callers may override)', async () => {
    global.__USER_ROW__ = { ...mockUserRow, preferred_language: 'en' };
    await PasswordResetService.sendResetCode('923000000000', 'ur');
    expect(sentLanguage()).toBe('ur');
  });
});
