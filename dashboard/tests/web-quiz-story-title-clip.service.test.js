'use strict';
/**
 * bd-5gyspy.5.2 (design-qa-r5 042809, P1; NIETE twin of 04 bd-6dbdwy.74): the story page's title is one line with an
 * ellipsis (`.wqs-top h2{overflow:hidden;…}`), and in Nastaliq the dots and tails sit below the line box, so the clip
 * cut them: «پودے کا سفر» read «یودے». Reading the shipped CSS: wherever the title clips in Urdu, the box keeps room
 * below the line for that ink (≥ .45em, the page's own --upad-t for Nastaliq), and gives it back with a negative margin
 * so nothing on the page moves.
 * Here the book title's <h2> carries the BOOK's language (wq-stories.js top(): `<h2 lang="' + l + '"`), so an Urdu book
 * on an English page is `html[lang=en] … h2[lang=ur]`; the shelf heading has no lang of its own and takes its screen's:
 * every screen is `<section class="wqs" lang=l>` (scr()), and the shelf's en/ur chips change that without touching
 * <html> (redteam 053252 LOW-1), so an Urdu shelf on an English page is `html[lang=en] .wqs[lang=ur] … h2`.
 */
const fs = require('fs');
const path = require('path');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const css = ['wq.css', 'wq-stories.css'].map((f) => fs.readFileSync(path.join(WQ, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');
// flat rules only (the title rules are not inside @media)
const rules = [];
css.replace(/([^{}@]+)\{([^{}]*)\}/g, (_, sel, body) => { rules.push({ sels: sel.split(',').map((s) => s.trim()), body }); return ''; });

// does `sel` reach a title <h2 lang=h2Lang> in a <section class="wqs" lang=secLang> on a page <html lang=pageLang>
// (no wq-ur2 class)?
const appliesTo = (sel, pageLang, secLang, h2Lang) => {
  const m = /^(html[^\s]*\s+)?(\.wqs(?:\[[^\]]+\])*\s+)?\.wqs-top\s+h2((?:\[[^\]]+\]|:not\(\[lang\]\))*)$/.exec(sel);
  if (!m) return false;
  const want = (part, lang) => [...(part || '').matchAll(/\[lang=["']?([a-z]+)["']?\]/g)].every((x) => x[1] === lang);
  if (/\.[\w-]+/.test(m[1] || '')) return false;
  if (!want(m[1], pageLang) || !want(m[2], secLang)) return false;
  if (m[3] === ':not([lang])') return h2Lang == null;
  if (m[3] && !/^(\[lang=["']?[a-z]+["']?\])+$/.test(m[3])) return false;
  return m[3] ? h2Lang != null && want(m[3], h2Lang) : true;
};
const em = (v) => {
  const x = String(v || '').trim();
  if (/^-?[\d.]+em$/.test(x)) return parseFloat(x);
  if (/^0(px)?$/.test(x)) return 0;
  return NaN;
};
function boxFor(pageLang, secLang, h2Lang) {
  const out = {};
  for (const r of rules) {
    if (!r.sels.some((s) => appliesTo(s, pageLang, secLang, h2Lang))) continue;
    for (const d of r.body.split(';')) {
      const i = d.indexOf(':');
      if (i < 0) continue;
      const k = d.slice(0, i).trim();
      const v = d.slice(i + 1).trim();
      if (k === 'padding-block') { const [a, b = a] = v.split(/\s+/); out.pt = a; out.pb = b; } else if (k === 'padding-bottom') out.pb = v;
      else if (k === 'margin-block') { const [a, b = a] = v.split(/\s+/); out.mt = a; out.mb = b; } else if (k === 'margin-bottom') out.mb = v;
      else out[k] = v;
    }
  }
  return out;
}

describe('the story title keeps its Nastaliq ink (bd-5gyspy.5.2)', () => {
  it('the title still clips to one line with an ellipsis (the premise)', () => {
    expect(boxFor('en', 'en', 'en')).toEqual(expect.objectContaining({ overflow: 'hidden', 'white-space': 'nowrap', 'text-overflow': 'ellipsis' }));
  });
  it.each([
    ['an Urdu page, its book title', 'ur', 'ur', 'ur'],
    ['an Urdu page, the shelf heading (no lang of its own)', 'ur', 'ur', null],
    ['an Urdu book on an English page', 'en', 'en', 'ur'],
    ['an Urdu shelf (its chip) on an English page, the shelf heading', 'en', 'ur', null],
  ])('%s: room below the line for the dots and tails, given back so the bar does not move', (_, pageLang, secLang, h2Lang) => {
    const b = boxFor(pageLang, secLang, h2Lang);
    expect(b.overflow).toBe('hidden');
    expect(em(b.pb)).toBeGreaterThanOrEqual(0.45);
    expect(em(b.mb)).toBeCloseTo(-em(b.pb), 5);
    expect(em(b.mt || '0')).toBeCloseTo(-em(b.pt || '0'), 5);
  });
  it.each([['en', 'en', 'en'], ['en', 'en', null], ['ur', 'ur', 'en'], ['ur', 'en', null]])('English (page %s, screen %s, title %s) is untouched: no extra room', (pageLang, secLang, h2Lang) => {
    const b = boxFor(pageLang, secLang, h2Lang);
    expect(b.pb).toBeUndefined();
    expect(b.mb).toBeUndefined();
  });
});
