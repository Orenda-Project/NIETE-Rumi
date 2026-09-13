/**
 * bd-jdtdl — THE URDU FACE IS CHOSEN BY WHAT THE DOCUMENT CONTAINS, NOT BY THE LABEL PACK.
 *
 * Operator, on two served lessons: *"Grade 8 urdu didnt render in the PDF AT ALL!!!! It should
 * only be nastaliq font pls"*. Both files were `..._en.pdf` — an URDU-MEDIUM lesson, authored
 * in Urdu, served with the ENGLISH chrome.
 *
 * THE DEFECT, in one decision. `template.js` computes `rtl = lang === "ur"` and then spends it
 * twice: on `fontCss({ urdu: rtl })`, which decides whether the Nastaliq @font-face is embedded
 * at all, and on the sheet's ONLY `font-family` declaration. Chrome language and body language
 * are independent — `--lang` picks the label pack, the model picks the prose — so an Urdu
 * lesson at `lang=en` got no Nastaliq face and no Nastaliq in the stack. Every Urdu codepoint
 * fell to Inter, which has no Arabic glyphs, and then to whatever the renderer's host offered.
 *
 * MEASURED, not assumed. `pdffonts` on the operator's two PDFs: `Inter + LiberationSerif`, no
 * Nastaliq. LiberationSerif has no Arabic glyphs either, so Chrome drew `.notdef` — the boxes
 * she saw. The same fixture rendered at `--lang ur` embeds `NotoNastaliqUrdu-Regular`.
 *
 * THE FIX IS NOT "ALWAYS EMBED IT". The face is 1.1 MB and rides in the HTML as base64; paying
 * that on every English lesson is a real cost. So the rule is CONTENT, not language, and the
 * last describe() below pins the cost: a document with no Urdu in it must still ship no
 * Nastaliq.
 *
 * AND THE POSITION IS THE FIX. Under LTR the face goes SECOND — after Inter, BEFORE the Latin
 * fallbacks. The first shape of this change appended it to the TAIL instead; the sheet named
 * Nastaliq, this suite went green, and `pdffonts` on the re-rendered PDF still showed none,
 * because CSS fallback is per-character and stops at the FIRST family holding the glyph — and
 * macOS Arial has Arabic. The fourth test below asserts the ordering for that reason.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(FIXTURE, 'utf8');
const load = () => JSON.parse(raw);

/** One line of real Urdu prose — the opening of the Grade 8 Nishan-e-Haider passage. */
const URDU = 'نشانِ حیدر پاکستان کا سب سے بڑا فوجی اعزاز ہے جو بہادری پر دیا جاتا ہے۔';

/**
 * The operator's document: an Urdu-medium lesson. Only PROSE is replaced — enum and
 * discriminator values are strings too, and rewriting those breaks the schema rather than the
 * language (learned the hard way: `mode`, `tier`, `kind` are all strings).
 */
function urduBodied() {
  const d = load();
  (function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object') {
      for (const k of Object.keys(n)) {
        if (typeof n[k] === 'string') {
          if (n[k].length > 45) n[k] = URDU;
        } else walk(n[k]);
      }
    }
    return undefined;
  })(d);
  return d;
}

const build = (doc, lang) => buildHtml(doc, { docDir: path.dirname(FIXTURE), lang }).html;

/** The stylesheet with the base64 payloads knocked out — the faces are megabytes each. */
const sheet = (html) =>
  html.slice(0, html.lastIndexOf('</style>')).replace(/url\(data:[^)]*\)/g, 'url(data:)');

/**
 * The document's own font stack, as emitted. The sheet carries `font-family` in three other
 * shapes — the `@font-face` blocks that NAME each face, and KaTeX's ~30 of its own — so the
 * needle is the Latin fallback tail, which only the body stack has.
 */
const stack = (html) => {
  const m = /font-family:[^;}]*Helvetica[^;}]*/.exec(sheet(html));
  return m ? m[0] : '';
};

const NASTALIQ_FACE = "@font-face{font-family:'Noto Nastaliq Urdu'";

// ── the defect, stated directly ─────────────────────────────────────────────

describe('an Urdu-medium lesson served with English chrome', () => {
  test('embeds the Nastaliq face — the whole of the operator report', () => {
    // Before the fix this is absent, and every Urdu character in the lesson prints .notdef.
    expect(sheet(build(urduBodied(), 'en')).includes(NASTALIQ_FACE)).toBe(true);
  });

  test('names Nastaliq in the font stack, so Urdu codepoints have somewhere to land', () => {
    expect(stack(build(urduBodied(), 'en'))).toContain('Noto Nastaliq Urdu');
  });

  test('and keeps Latin on Inter — Nastaliq comes AFTER, not instead', () => {
    // Per-character fallback: English words stay Inter, Arabic script falls through. A stack
    // that put Nastaliq first would reset the Latin typography of an English-chrome page.
    const s = stack(build(urduBodied(), 'en'));
    expect(s.indexOf('Inter')).toBeLessThan(s.indexOf('Noto Nastaliq Urdu'));
  });

  test('but BEFORE Arial — the position is the fix, and the tail is not a position', () => {
    // MEASURED, and it is why this test exists. The first shape of the fix appended Nastaliq
    // to the END of the stack; the sheet said `Noto Nastaliq Urdu`, the suite went green, and
    // `pdffonts` on the rendered PDF still showed no Nastaliq at all. Fallback is
    // per-character and stops at the FIRST family holding the glyph: macOS Arial has Arabic,
    // so Chrome resolved every Urdu codepoint to Arial (naskh, not nastaliq) and never
    // reached the tail. On the Linux container the same slot is LiberationSerif, which has no
    // Arabic — the operator's tofu. Only second place gets Nastaliq on both hosts.
    const s = stack(build(urduBodied(), 'en'));
    expect(s.indexOf('Noto Nastaliq Urdu')).toBeLessThan(s.indexOf('Arial'));
    expect(s.indexOf('Noto Nastaliq Urdu')).toBeLessThan(s.indexOf('Helvetica'));
  });

  test('the Urdu prose itself is still on the page', () => {
    // Guards against a "fix" that drops the text rather than the tofu.
    const html = build(urduBodied(), 'en');
    expect(html.slice(html.lastIndexOf('</style>') + 8)).toContain(URDU);
  });
});

// ── the existing Urdu render must not move ──────────────────────────────────

describe('lang=ur is unchanged', () => {
  test('Nastaliq is still FIRST under RTL — R6, and the whole page is Urdu there', () => {
    const s = stack(build(urduBodied(), 'ur'));
    expect(s.indexOf('Noto Nastaliq Urdu')).toBeLessThan(s.indexOf('Inter'));
  });

  test('the face is still embedded for an Urdu-chrome render', () => {
    expect(sheet(build(urduBodied(), 'ur')).includes(NASTALIQ_FACE)).toBe(true);
  });

  test('Urdu chrome on a document with no Urdu prose still embeds it', () => {
    // The label pack alone is Urdu script, so the face is needed whatever the body says.
    expect(sheet(build(load(), 'ur')).includes(NASTALIQ_FACE)).toBe(true);
  });
});

// ── the cost is pinned: an English lesson pays nothing ──────────────────────

describe('a document with no Urdu in it', () => {
  test('does NOT embed the 1.1 MB face', () => {
    expect(sheet(build(load(), 'en')).includes(NASTALIQ_FACE)).toBe(false);
  });

  test('does NOT name Nastaliq in the stack', () => {
    expect(stack(build(load(), 'en'))).not.toContain('Noto Nastaliq Urdu');
  });
});
