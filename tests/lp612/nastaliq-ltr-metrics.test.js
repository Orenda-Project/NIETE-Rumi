/**
 * THE NASTALIQ FACE LANDED ON ENGLISH PAGES WITHOUT ITS METRICS — bd-b8ypq part 2 (P1, 2026-09-14).
 *
 * bd-jdtdl made the Nastaliq face reachable whenever the DOCUMENT carries Urdu, not only when the
 * chrome is Urdu, so an English lesson that quotes "حضرت محمد ﷺ" finally paints glyphs instead of
 * tofu. What it did NOT carry across is the line box those glyphs need. `urduScript` feeds exactly
 * one declaration — the font stack. Every one of the ~30 `line-height` rules, `.hero`'s top padding
 * and `.foot`'s bottom padding still key off `rtl` alone, so an English page gets Nastaliq ink in a
 * 1.55 line box. The operator's Grade 6 English chapter overlapped in three places: the hero
 * subtitle, a Development paragraph, and the footer.
 *
 * Measured off bot/vendor/lp-v9/fonts/NotoNastaliqUrdu.ttf (fontTools, BoundsPen over every glyph,
 * unitsPerEm 1000):
 *
 *     all glyphs        yMin -1.382   yMax +1.808    -> 3.190em of ink   (the extreme IS ﷺ)
 *     excluding U+FDFA  yMin -0.900   yMax +1.563    -> 2.463em
 *     99% of glyphs     yMin -0.479   yMax +1.465    -> 1.944em
 *
 * So there are two defects wearing one costume, and they want different levers:
 *
 *   1. ORDINARY NASTALIQ needs ~1.95em — which is why R6 mandates line-height >= 2.0 for Urdu. On an
 *      English page only the lines that actually carry Arabic need it. Taking the whole page to the
 *      Nastaliq branch would inflate every English lesson carrying a single ﷺ by ~50% and blow the
 *      packer's page budget (render_lp.js:94-117), so the line box is raised per-run instead.
 *   2. THE ﷺ LIGATURE alone paints 3.19em. No line-height an English page can afford contains that,
 *      and it overflows even its own font's 2.50em content box. It gets its own wrapper carrying a
 *      reduced `font-size`, which is legal because the ligature is drawn far larger than the script
 *      around it: at ~61% it still paints ~1.95em, bigger than the Latin text beside it.
 *
 *      A `size-adjust` @font-face scoped to `unicode-range:U+FDFA` would do the same arithmetic, and
 *      was the first design here. It was dropped because a second @font-face means a second copy of
 *      the face, and the Nastaliq face is 1.1 MB of base64 — the same ink reduction is not worth
 *      doubling the weight of every English page that quotes the Prophet's name.
 *
 * RTL Urdu pages are deliberately untouched — the operator confirmed "grde 9 pak studies urdu lp
 * rendered perfectly", and there the whole page is already at 2.05.
 *
 * Red-first: on this branch's base every assertion in the first describe fails — no scoped face, no
 * wrapper, no rule.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(FIXTURE, 'utf8');
const load = () => JSON.parse(raw);

/** The operator's own header line, off page 2 of grade_6_english_c01a_p1_en.pdf. */
const ARABIC = 'Chapter review: the biography of حضرت محمد ﷺ';

/** An English-medium lesson that quotes the Prophet's name in Urdu script, as an English book does. */
function englishWithArabic() {
  const d = load();
  d.provenance.medium = 'en';
  d.provenance.topic = ARABIC;
  d.page2.next_period = 'Yes — حضرت محمد ﷺ asked for a sheet so every tribe could carry the Black Stone.';
  return d;
}

const build = (doc, lang) => buildHtml(doc, { docDir: path.dirname(FIXTURE), lang }).html;

/** The stylesheet with the base64 payloads knocked out — the faces are megabytes each. */
const sheet = (html) =>
  html.slice(0, html.lastIndexOf('</style>')).replace(/url\(data:[^)]*\)/g, 'url(data:)');

/** Everything after the stylesheet — the document body, where the wrapper has to appear. */
const body = (html) => html.slice(html.lastIndexOf('</style>'));

describe('An English page carrying Urdu script gets the Nastaliq metrics, not just the face', () => {
  const html = build(englishWithArabic(), 'en');

  it('gives the Arabic runs a line box tall enough for Nastaliq', () => {
    const rule = /\.ar\{([^}]*)\}/.exec(sheet(html));
    expect(rule).not.toBeNull();
    const lh = /line-height:\s*([\d.]+)\s*[;}]/.exec(rule[1]);
    expect(lh).not.toBeNull();
    // 2.05 is what an RTL page already uses, and the operator confirmed those render correctly.
    expect(Number(lh[1])).toBeGreaterThanOrEqual(1.95);
  });

  it('cuts the ﷺ ligature down to the ink the rest of the Nastaliq occupies', () => {
    const rule = /\.ar-lig\{([^}]*)\}/.exec(sheet(html));
    expect(rule).not.toBeNull();
    const fs_ = /font-size:\s*([\d.]+)em/.exec(rule[1]);
    expect(fs_).not.toBeNull();
    // 1.944em (99th-percentile Nastaliq ink) / 3.190em (the ligature's own ink) = 0.609.
    // Above ~0.70 it still spills a 2.05 line box; below ~0.50 it stops reading as an honorific.
    const scale = Number(fs_[1]);
    expect(scale).toBeGreaterThanOrEqual(0.5);
    expect(scale).toBeLessThanOrEqual(0.7);
  });

  it('wraps the Arabic runs in the hero and in the prose, and leaves the Latin alone', () => {
    const b = body(html);
    expect(b).toContain('<span class="ar">حضرت محمد <span class="ar-lig">ﷺ</span></span>');
    // The wrapper is per-RUN: the English around it must not be swept in.
    expect(b).not.toMatch(/<span class="ar">[^<]*biography/);
    expect(b).not.toMatch(/<span class="ar">[^<]*Black Stone/);
  });

  it('does not pay for a second copy of the 1.1 MB face', () => {
    const faces = (sheet(html).match(/@font-face\{[^}]*\}/g) || [])
      .filter((f) => /font-family:'Noto Nastaliq Urdu'/.test(f));
    expect(faces).toHaveLength(1);
  });
});

describe('The Urdu chrome is untouched — it is already at 2.05 and it renders correctly', () => {
  const html = build(englishWithArabic(), 'ur');

  it('emits no per-run rule and no wrapper — the whole page is the Nastaliq branch', () => {
    expect(sheet(html)).not.toMatch(/\.ar\{/);
    expect(sheet(html)).not.toMatch(/\.ar-lig\{/);
    expect(body(html)).not.toContain('<span class="ar">');
  });
});

describe('A lesson with no Urdu in it pays for none of this', () => {
  const html = build(load(), 'en');

  it('still embeds no Nastaliq face at all', () => {
    expect(sheet(html)).not.toContain("@font-face{font-family:'Noto Nastaliq Urdu'");
  });

  it('emits no per-run rule and no wrapper', () => {
    expect(sheet(html)).not.toMatch(/\.ar\{/);
    expect(sheet(html)).not.toMatch(/\.ar-lig\{/);
    expect(body(html)).not.toContain('<span class="ar">');
  });
});
