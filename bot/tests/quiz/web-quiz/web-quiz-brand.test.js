'use strict';
/**
 * The web quiz's brand comes from configuration, never from code paths: one
 * object per brand (name, marks, colours, mascot, link-preview image, copy),
 * picked by what the deployment already has — an app_settings row first, then
 * the existing ORG_NAME — with this fork's brand as the code default.
 * Supabase is the boundary and is faked; the module runs for real.
 */
const Brand = require('../../../shared/config/web-quiz-brand');

function fakeDb(rows, { fail = false } = {}) {
  const calls = [];
  return {
    calls,
    from(t) {
      const st = { t, filters: [] };
      const b = {
        select() { return b; },
        eq(c, v) { st.filters.push([c, v]); return b; },
        maybeSingle() {
          calls.push(st);
          if (fail) return Promise.reject(new Error('db down'));
          const row = (rows[t] || []).find((r) => st.filters.every(([c, v]) => r[c] === v)) || null;
          return Promise.resolve({ data: row, error: null });
        },
      };
      return b;
    },
  };
}

beforeEach(() => Brand._resetCache());

describe('which brand: setting, then ORG_NAME, then the code default', () => {
  test('nothing configured: NIETE', () => {
    expect(Brand.brandKey({})).toBe('niete');
    expect(Brand.brandKey()).toBe('niete');
  });

  test('the existing ORG_NAME picks a known brand, case-insensitively; an unknown org keeps the default', () => {
    expect(Brand.brandKey({ orgName: 'Rumi' })).toBe('rumi');
    expect(Brand.brandKey({ orgName: ' rumi ' })).toBe('rumi');
    expect(Brand.brandKey({ orgName: 'NIETE' })).toBe('niete');
    expect(Brand.brandKey({ orgName: 'Some Other School' })).toBe('niete');
  });

  test('the open platform defaults (ORG_NAME "Rumi Education", BOT_NAME "Rumi") pick Rumi with no setting', () => {
    expect(Brand.brandKey({ orgName: 'Rumi Education' })).toBe('rumi');
    expect(Brand.brandKey({ orgName: 'NIETE Teaching Assistant' })).toBe('niete');
    expect(Brand.brandKey({ botName: 'Rumi' })).toBe('rumi');
    expect(Brand.brandKey({ orgName: 'Acme Schools', botName: 'Rumi' })).toBe('rumi');
    expect(Brand.brandKey({ orgName: 'NIETE', botName: 'Rumi' })).toBe('niete');
    // A word that merely contains a brand key is not that brand.
    expect(Brand.brandKey({ orgName: 'Rumination Academy' })).toBe('niete');
  });

  test('an app_settings value wins over ORG_NAME; an unknown value is ignored', () => {
    expect(Brand.brandKey({ setting: 'rumi', orgName: 'NIETE' })).toBe('rumi');
    expect(Brand.brandKey({ setting: '"niete"', orgName: 'Rumi' })).toBe('niete');
    expect(Brand.brandKey({ setting: 'acme', orgName: 'Rumi' })).toBe('rumi');
    expect(Brand.brandKey({ setting: { brand: 'x' } })).toBe('niete');
  });

  test('resolveBrandKey reads the web_quiz_brand row, caches it, and falls back when the read fails', async () => {
    const db = fakeDb({ app_settings: [{ key: 'web_quiz_brand', value: 'rumi' }] });
    expect(await Brand.resolveBrandKey({ db, orgName: 'NIETE' })).toBe('rumi');
    expect(await Brand.resolveBrandKey({ db, orgName: 'NIETE' })).toBe('rumi');
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].filters).toEqual([['key', 'web_quiz_brand']]);

    Brand._resetCache();
    expect(await Brand.resolveBrandKey({ db: fakeDb({}), orgName: 'Rumi' })).toBe('rumi');
    Brand._resetCache();
    expect(await Brand.resolveBrandKey({ db: fakeDb({}, { fail: true }), orgName: 'NIETE' })).toBe('niete');
    Brand._resetCache();
    expect(await Brand.resolveBrandKey({ db: null })).toBe('niete');
  });
});

describe('the public brand object (boot JSON) and its CSS variables', () => {
  const HEX = /^#[0-9A-Fa-f]{6}$/;

  test.each(['niete', 'rumi'])('%s carries name, marks, tokens, mascot, preview image and copy in both languages', (key) => {
    const b = Brand.publicBrand(key);
    expect(b.key).toBe(key);
    expect(b.name).toEqual(expect.any(String));
    for (const l of ['en', 'ur']) {
      expect(b.label[l]).toEqual(expect.any(String));
      expect(b.sub[l]).toEqual(expect.any(String));
      expect(b.mascot[l]).toEqual(expect.any(String));
    }
    expect(b.mark.svg).toMatch(/^<svg [^>]*viewBox="[\d .]+"/);
    expect(b.mark.svg).not.toMatch(/<script|on\w+=|href/i);
    expect(b.og.image).toMatch(/^\/wq\/[a-z0-9-]+\.jpg$/);
    for (const v of Object.values(b.tokens)) expect(v).toMatch(HEX);
    for (const t of ['brand', 'brand-d', 'brand-l', 'brand-ink', 'brand-on', 'ground', 'card', 'line', 'tint']) {
      expect(b.tokens[t]).toMatch(HEX);
    }
  });

  test('NIETE uses the brand book colours and the bilingual mark; Rumi uses navy + one warm accent', () => {
    const n = Brand.publicBrand('niete');
    expect(n.tokens.brand.toUpperCase()).toBe('#47BA7D');
    expect(n.tokens['brand-ink'].toUpperCase()).toBe('#333748');
    expect(n.name).toBe('NIETE');
    expect(n.place).toEqual({ en: 'Islamabad', ur: 'اسلام آباد' });
    const r = Brand.publicBrand('rumi');
    expect(r.name).toBe('Rumi');
    expect(r.tokens.brand.toUpperCase()).toBe('#F06E42');
    expect(r.tokens['brand-ink'].toUpperCase()).toBe('#0E2058');
    // The Rumi mark is wide and is never boxed into a square tile.
    expect(r.mark.tile).toBe(false);
    expect(r.place).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/NIETE|Islamabad/);
  });

  test('an unknown key falls back to the default brand', () => {
    expect(Brand.publicBrand('nope').key).toBe('niete');
    expect(Brand.publicBrand(undefined).key).toBe('niete');
  });

  test('cssVars is one :root rule of the brand tokens and nothing that can close a style tag', () => {
    const css = Brand.cssVars(Brand.publicBrand('rumi'));
    expect(css.startsWith(':root{')).toBe(true);
    expect(css).toContain('--brand:#F06E42');
    expect(css).toContain('--brand-ink:#0E2058');
    expect(css).not.toMatch(/[<>]/);
    expect(Brand.cssVars(Brand.publicBrand('niete'))).toContain('--brand:#47BA7D');
  });

  test('favicon is a data: SVG of the mark (no extra request, no new asset)', () => {
    const f = Brand.faviconHref(Brand.publicBrand('niete'));
    expect(f.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(f.slice('data:image/svg+xml,'.length))).toMatch(/<svg[\s\S]*<path/);
  });
});
