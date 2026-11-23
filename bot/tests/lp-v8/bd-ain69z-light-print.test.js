// bd-ain69z (queue #203, sheet Lesson Plan row 960). Plans printed almost black on a school printer: about
// 30 solid navy / band fills (title, section bars, "open with this question", check, coach and board boxes).
// Amena, 22 Nov: make the print/PDF lighter, ICT and GB, English + Urdu. Every one of those boxes now ends
// white with a coloured edge and dark ink; the words do not change.
const { buildHtml } = require('../../vendor/lp-v9/lib/template.js');
const doc = () => JSON.parse(JSON.stringify(require('../fixtures/lp-v9/GK_g1_seg2.ur.lp.json')));

const styleOf = (html) => (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
// The LAST background any rule naming `sel` gives it, !important beating a plain declaration.
function finalBackground(css, sel) {
  let plain = null; let important = null;
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[},\\s])${esc}\\s*(,[^{]*)?\\{([^}]*)\\}`, 'g');
  for (const m of css.matchAll(re)) {
    for (const d of m[3].matchAll(/background(?:-color)?\s*:\s*([^;}]+)/g)) {
      const v = d[1].trim();
      if (/!important/.test(v)) important = v.replace(/\s*!important/, ''); else plain = v;
    }
  }
  return important || plain;
}
const DARK = ['.s-o', '.s-h', '.hero', '.hook', '.ck', '.srq', '.coach', '.s-w', '.s-i', '.s-d', '.s-a', '.s-c', '.board .lbl'];

describe('lp-v9 light print (bd-ain69z)', () => {
  for (const lang of ['en', 'ur']) {
    it(`${lang}: no large box prints as a solid dark fill`, () => {
      const css = styleOf(buildHtml(doc(), { lang, format: 'phone' }).html);
      expect(css.length).toBeGreaterThan(1000);
      for (const sel of DARK) expect([sel, finalBackground(css, sel)]).toEqual([sel, '#fff']);
    });
    it(`${lang}: the ink inside those boxes is dark, not white`, () => {
      const css = styleOf(buildHtml(doc(), { lang, format: 'phone' }).html);
      expect(css).toMatch(/\.hero \*, \.hook \*, \.ck \*, \.srq \*, \.coach \*\s*\{\s*color:var\(--ink\) !important;/);
    });
  }
});
