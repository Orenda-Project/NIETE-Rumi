/**
 * bd-5o0ay.10.38 — THE PAGE REF WAS THE PART THE ELLIPSIS ATE.
 *
 * The A/B sample (263 v9 plans, 16 Oct) found footers reading "Grade 3 Math · Ch.4 · Division
 * Dives: Splitting Numbers · pp. …" while page 1 of the same plan printed "p.68". The data was
 * fine. `.foot .fl` is one nowrap line clipped with `text-overflow:ellipsis` (page-furniture-trim),
 * and the page ref is the LAST thing on that line — so any chapter title long enough to fill the
 * 478px column pushed the page numbers under the ellipsis. The page ref is the one part of the
 * footer a teacher uses (it points at the book), so it must be the part that never clips:
 * the chapter shrinks, the page ref keeps its width.
 */

const fs = require('fs');
const path = require('path');

const { buildHtml } = require('../../bot/vendor/lp-v9/lib/template');

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const doc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const out = (d = doc()) => buildHtml(d, { docDir: path.dirname(FIXTURE) }).html;

function body(html) {
  const i = html.indexOf('<body');
  return html.slice(html.indexOf('>', i) + 1, html.lastIndexOf('</body>'));
}

function sheet(html) {
  const open = html.indexOf('<style>');
  return html
    .slice(open + 7, html.lastIndexOf('</style>'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/url\(data:[^)]*\)/g, 'url(data:)');
}

function rule(css, selector) {
  const m = css.match(new RegExp(`(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  return m ? m[2] : null;
}

const text = (s) => s.replace(/<[^>]*>/g, '').replace(/&middot;/g, '·').replace(/&mdash;/g, '—').replace(/[⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();

/** Every footer's left half, split into the clipped chapter run and the pinned page-ref run. */
function leftHalves(html) {
  return [...body(html).matchAll(/<div class="fl">([\s\S]*?)<\/div><div class="fr">/g)].map((m) => {
    const ch = m[1].match(/<span class="fch">([\s\S]*?)<\/span><span class="fpp">/);
    const pp = m[1].match(/<span class="fpp">([\s\S]*?)<\/span>\s*$/);
    return { chapter: ch && text(ch[1]), pages: pp && text(pp[1]) };
  });
}

const LONG = (d) => {
  d.provenance.chapter = 'Ch.4 · Division Dives: Splitting Numbers Into Equal Groups and Sharing Them Fairly';
  d.provenance.chapter_title = 'Division Dives: Splitting Numbers Into Equal Groups and Sharing Them Fairly';
  return d;
};

describe('the footer page ref', () => {
  test('sits in its own run after the chapter, on every footer', () => {
    const halves = leftHalves(out(LONG(doc())));
    expect(halves.length).toBeGreaterThan(0);
    for (const h of halves) {
      expect(h.chapter).toContain('Division Dives');
      expect(h.pages).toContain(doc().provenance.printed_pages);
    }
  });

  test('the chapter run is the one that clips; the page-ref run never shrinks', () => {
    const css = sheet(out());
    const fl = rule(css, '.foot .fl');
    expect(fl).toMatch(/display:\s*flex/);
    const fch = rule(css, '.foot .fch');
    expect(fch).not.toBeNull();
    expect(fch).toMatch(/min-width:\s*0/);
    expect(fch).toMatch(/overflow:\s*hidden/);
    expect(fch).toMatch(/text-overflow:\s*ellipsis/);
    expect(fch).toMatch(/white-space:\s*nowrap/);
    const fpp = rule(css, '.foot .fpp');
    expect(fpp).not.toBeNull();
    expect(fpp).toMatch(/flex:\s*none|flex-shrink:\s*0/);
    expect(fpp).toMatch(/white-space:\s*nowrap/);
  });

  test('an Urdu plan keeps the same split', () => {
    const d = LONG(doc());
    d.provenance.medium = 'ur';
    const halves = leftHalves(out(d));
    expect(halves.length).toBeGreaterThan(0);
    for (const h of halves) expect(h.pages).toContain(doc().provenance.printed_pages);
  });
});
