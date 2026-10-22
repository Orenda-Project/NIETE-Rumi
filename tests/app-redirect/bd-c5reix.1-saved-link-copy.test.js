'use strict';
/**
 * bd-c5reix.1 — the WhatsApp line for a classroom recording kept for the app (operator, 22 Oct): it says the recording
 * is saved and to tap the button below to complete Digital Coaching, and the button says Digital Coaching. The Urdu
 * says the same as the English.
 *
 *   AC1 the catalog holds exactly the new en and ur text
 *   AC2 a saved-recording link (onLink → the ai_coaching_recording landing) sends that body and button, in her language
 *   AC3 the button fits Meta's 20-code-point cap
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const mockCta = jest.fn();
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true),
  sendCtaUrl: (...a) => mockCta(...a),
}));
let mockSettings;
const ME = '60530046-7ac3-4ea3-a976-b43c37c23213';
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (table) => {
    const filters = {};
    const chain = {
      select: () => chain,
      eq: (c, v) => { filters[c] = v; return chain; },
      in: (_c, vals) => Promise.resolve({ data: mockSettings.filter((r) => vals.includes(r.key)), error: null }),
      maybeSingle: () => Promise.resolve({
        data: table === 'users' && filters.id === ME
          ? { id: ME, role: 'teacher', name: 'Ayesha', registration_completed: true, registration_state: 'completed' }
          : null,
        error: null,
      }),
      upsert: () => Promise.resolve({ error: null }),
    };
    return chain;
  },
}));

const NEW = {
  en: ['Your recording is saved ✅ Tap the button below to complete your Digital Coaching.', 'Digital Coaching'],
  ur: ['آپ کی ریکارڈنگ محفوظ ہو گئی ہے ✅ اپنی ڈیجیٹل کوچنگ مکمل کرنے کے لیے نیچے دیا گیا بٹن دبائیں۔', 'ڈیجیٹل کوچنگ'],
};
const ENV = { ...process.env };
beforeEach(() => {
  jest.resetModules();
  mockCta.mockReset().mockResolvedValue(true);
  mockSettings = [{ key: 'app_redirect_ai_coaching', value: 'teachers' }, { key: 'portal_teacher_v2', value: 'teachers' }];
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', PORTAL_URL: 'https://portal.example.test', SUPABASE_URL: 'https://abcdefgh.supabase.co' };
});
afterAll(() => { process.env = ENV; });

test('AC1 — the catalog holds exactly the new words, in English and Urdu', () => {
  const { resolveUx } = require('../../bot/shared/config/ux-strings');
  for (const [language, [body, button]] of Object.entries(NEW)) {
    expect(resolveUx('appLinkBodyCoachingSaved', { language })).toBe(body);
    expect(resolveUx('appLinkButtonCoachingSaved', { language })).toBe(button);
  }
});

test.each(Object.entries(NEW))('AC2/AC3 — a saved-recording link in %s sends that line and that button, within the cap', async (language, [body, button]) => {
  const svc = require('../../bot/shared/services/app-redirect.service');
  expect(await svc.redirectIfFlagged('ai_coaching', {
    userId: ME, from: '+92300FIXTURE1', language, reason: 'classroom_audio', onLink: async () => ({ landing: 'ai_coaching_recording' }),
  })).toBe(true);
  expect(mockCta).toHaveBeenCalledTimes(1);
  const opts = mockCta.mock.calls[0][1];
  expect(opts.body).toBe(body);
  expect(opts.buttonText).toBe(button);
  expect([...opts.buttonText].length).toBeLessThanOrEqual(20);
});
