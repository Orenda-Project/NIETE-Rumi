/**
 * P0.3 (bd-1hae7.3) — the strings a DECLINED caller receives.
 *
 * She rang and the phone did not answer. These are the only thing that stops
 * that being a dead end, so they go through the catalog like every other
 * teacher-facing string, and they obey the language protocol:
 *
 *  - both languages present, resolvable through `resolveUx`
 *  - **gender-neutral when ADDRESSING her** — cohorts are mixed-gender, so the
 *    verb is a neutral imperative (لکھ دیں), never a gendered second person
 *    (لکھ سکتی ہیں / لکھ سکتے ہیں). Rumi's own first person stays feminine.
 *  - آپ register, never tum-forms
 *  - short: these arrive unbidden, right after a call she expected to connect
 */

const { resolveUx } = require('../../shared/config/ux-strings');

const KEYS = ['callBusyOverflow', 'callBudgetOverflow', 'callDailyLimitOverflow'];

describe('overflow strings — coverage', () => {
  test.each(KEYS)('%s resolves in Urdu and English', (key) => {
    ['ur', 'en'].forEach((language) => {
      const text = resolveUx(key, { language });
      expect(typeof text).toBe('string');
      expect(text.trim().length).toBeGreaterThan(10);
    });
  });

  test.each(KEYS)('%s has a genuinely different Urdu and English form', (key) => {
    expect(resolveUx(key, { language: 'ur' })).not.toBe(resolveUx(key, { language: 'en' }));
  });

  test.each(KEYS)('%s falls back to English for an unknown language', (key) => {
    expect(resolveUx(key, { language: 'sw' })).toBe(resolveUx(key, { language: 'en' }));
  });

  test.each(KEYS)('%s leaves no unfilled placeholders', (key) => {
    ['ur', 'en'].forEach((language) => {
      expect(resolveUx(key, { language })).not.toMatch(/\{[a-zA-Z_]+\}/);
    });
  });
});

describe('overflow strings — Urdu register and gender', () => {
  test.each(KEYS)('%s never uses a gendered 2nd-person verb for the teacher', (key) => {
    const ur = resolveUx(key, { language: 'ur' });
    // The trap: سکتی ہیں / سکتے ہیں / رہی ہیں / رہے ہیں aimed at HER.
    expect(ur).not.toMatch(/سکتی ہیں|سکتے ہیں|رہی ہیں|رہے ہیں/);
  });

  test.each(KEYS)('%s uses the آپ register, never tum-forms', (key) => {
    const ur = resolveUx(key, { language: 'ur' });
    expect(ur).toMatch(/آپ/);
    // Whole-word boundaries, spelled out: JS \b does not work on Arabic script,
    // and a naive /کرو/ also matches کروں گی — Rumi's own feminine "I will do".
    expect(ur).not.toMatch(/(^|[\s،۔])(تم|کرو|لکھو|دیکھو|سنو|بتاؤ)([\s،۔]|$)/);
  });

  test.each(KEYS)('%s keeps Rumi speaking about herself in the feminine', (key) => {
    const ur = resolveUx(key, { language: 'ur' });
    expect(ur).not.toMatch(/کروں گا|ہوں گا|رہا ہوں/); // masculine self-reference
  });
});

describe('overflow strings — brevity and tone', () => {
  test.each(KEYS)('%s stays short enough to read at a glance', (key) => {
    ['ur', 'en'].forEach((language) => {
      expect([...resolveUx(key, { language })].length).toBeLessThanOrEqual(160);
    });
  });

  test.each(KEYS)('%s offers a way through — it never just says no', (key) => {
    expect(resolveUx(key, { language: 'ur' })).toMatch(/پیغام/);      // "message"
    expect(resolveUx(key, { language: 'en' })).toMatch(/message/i);
  });

  test('no string blames the teacher or reads as a telling-off', () => {
    KEYS.forEach((key) => {
      expect(resolveUx(key, { language: 'en' })).not.toMatch(/too many|limit exceeded|you have used/i);
    });
  });
});
