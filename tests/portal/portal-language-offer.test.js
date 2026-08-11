/**
 * The portal offers the same two languages as the bot.
 *
 * The portal kept its own i18n stack — four locales, its own supported list, its
 * own switcher list, its own RTL rule — none of it aware that this deployment
 * serves Urdu and English. So a teacher could read the portal in Spanish while
 * every message from Rumi arrived in Urdu.
 *
 * Six places disagreed, and the audit named four of them. The two it missed are
 * the ones worth noting, because both are teacher-facing:
 *
 *   - the switcher's own hardcoded language array (a tenth language list)
 *   - a reading-assessment FILTER dropdown offering Arabic and Spanish, for data
 *     that can only ever be en or ur — dead options that return nothing
 *
 * Source-level assertions, because the portal's own Vitest suite is not run by the
 * root Jest suite (`testMatch` is `tests/**`), so a guard placed there would never
 * execute in CI. This file lives where it actually runs.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const OFF_MARKET = ['es', 'ar'];

describe('portal i18n — two languages, from one list', () => {
  const config = read('portal/src/i18n/config.ts');

  it('supports exactly Urdu and English', () => {
    const m = config.match(/supportedLngs:\s*\[([^\]]*)\]/);
    expect(m).toBeTruthy();
    const codes = m[1].match(/'([^']+)'/g).map((s) => s.replace(/'/g, ''));
    expect(codes.sort()).toEqual(['en', 'ur']);
  });

  it('imports no off-market locale bundle', () => {
    for (const code of OFF_MARKET) {
      expect(config).not.toMatch(new RegExp(`locales/${code}\\.json`));
    }
  });

  it('ships no off-market locale FILE — an unused 10KB translation is a promise we are not keeping', () => {
    for (const code of OFF_MARKET) {
      expect(exists(`portal/src/i18n/locales/${code}.json`)).toBe(false);
    }
  });

  it('keeps the two it does serve', () => {
    expect(exists('portal/src/i18n/locales/en.json')).toBe(true);
    expect(exists('portal/src/i18n/locales/ur.json')).toBe(true);
  });

  it('applies RTL for Urdu, and does not reference a language it no longer has', () => {
    expect(config).toMatch(/'ur'/);
    expect(config).not.toMatch(/lng === 'ar'/);
  });
});

describe('portal switcher — the list the audit missed', () => {
  const sw = read('portal/src/components/LanguageSwitcher.tsx');

  it('offers exactly two languages', () => {
    const codes = [...sw.matchAll(/code:\s*'([a-z-]+)'/g)].map((m) => m[1]);
    expect(codes.sort()).toEqual(['en', 'ur']);
  });

  it('names them in their own script', () => {
    expect(sw).toMatch(/اردو/);
  });
});

describe('portal reading-assessment filter — the other list the audit missed', () => {
  const page = read('portal/src/portal/pages/PortalReadingAssessments.tsx');

  it('does not filter by a language the data can never contain', () => {
    for (const code of OFF_MARKET) {
      expect(page).not.toMatch(new RegExp(`<option value="${code}"`));
    }
  });

  it('still filters by the two that exist', () => {
    expect(page).toMatch(/<option value="en"/);
    expect(page).toMatch(/<option value="ur"/);
  });
});

describe('portal app shell', () => {
  it('does not carry an RTL branch for a language it no longer offers', () => {
    const app = read('portal/src/App.tsx');
    expect(app).not.toMatch(/currentLang === 'ar'/);
    expect(app).toMatch(/currentLang === 'ur'/);
  });
});
