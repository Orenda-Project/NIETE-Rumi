/**
 * 6-12 LPs · the vendored renderer's bidi pass + per-language page caps.
 *
 * Four defect classes were found live on real Urdu renders that had passed
 * every text-level gate: numeric ranges after an Urdu word painting REVERSED
 * («صفحہ 6-7» → «7-6», UAX#9 W2/W4/N1), the outcome-box citation cluster
 * garbling, English sentences shedding their punctuation inside the RTL base,
 * and flow arrows pointing against the reading direction. The fixes live in the
 * canon renderer and are re-vendored here; this suite pins the vendored copy so
 * a future re-vendor cannot silently drop them.
 *
 * Page caps: word budgets are IDENTICAL across languages (an Urdu plan says no
 * more than an English one); Urdu pays its measured ~+33% paper (same document
 * rendered en=9pp / ur=12pp) in PAGES — teach 7 / support 5 against English's
 * 5 / 4. Under one shared cap, every Urdu render of a full-cap English plan
 * failed PAGE COUNT while carrying identical content.
 *
 * The katex/ajv stubs apply (root suite runs before bot/ npm ci), so these are
 * string-level assertions on the built HTML — the rendered-pixel proof lives in
 * the before/after rasters of the rtl_res fixture, eyeballed per the audit.
 */

const fs = require('fs');
const path = require('path');

const { rich, setRtlProse, isolateRanges } = require('../../bot/vendor/lp-v9/lib/rich');
const { pageCapsFor, MAX_PAGES, WARN_PAGES, MAX_PAGES_UR, WARN_PAGES_UR } =
  require('../../bot/vendor/lp-v9/render_lp.js');
const { buildHtml } = require('../../bot/vendor/lp-v9/lib/template');

const LRI = '⁦';
const PDI = '⁩';

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const load = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

afterEach(() => setRtlProse(false));

// ── per-language page caps ──────────────────────────────────────────────────

describe('page caps are language-aware; word budgets are not', () => {
  test('English caps are unchanged: teach 5/support 4, warn 4/3', () => {
    expect(pageCapsFor('en')).toEqual({ max: { teach: 5, support: 4 }, warn: { teach: 4, support: 3 } });
    expect(pageCapsFor('en').max).toBe(MAX_PAGES);
    expect(pageCapsFor('en').warn).toBe(WARN_PAGES);
  });

  test('Urdu carries the measured +33% footprint: teach 7/support 5, warn 6/4', () => {
    expect(pageCapsFor('ur')).toEqual({ max: { teach: 7, support: 5 }, warn: { teach: 6, support: 4 } });
    expect(pageCapsFor('ur').max).toBe(MAX_PAGES_UR);
    expect(pageCapsFor('ur').warn).toBe(WARN_PAGES_UR);
  });

  test('no language / junk falls back to the English caps', () => {
    expect(pageCapsFor(undefined).max).toBe(MAX_PAGES);
    expect(pageCapsFor('sw').max).toBe(MAX_PAGES);
  });
});

// ── the range trap in prose ─────────────────────────────────────────────────

describe('numeric ranges in RTL prose are isolated', () => {
  test('«صفحہ 6-7» carries an LRI…PDI isolate in RTL mode', () => {
    setRtlProse(true);
    expect(rich('دیکھیں صفحہ 6-7 پر')).toContain(`${LRI}6-7${PDI}`);
  });

  test('Urdu-digit ranges are isolated too', () => {
    setRtlProse(true);
    expect(rich('ص ۸۵-۸۸')).toContain(`${LRI}۸۵-۸۸${PDI}`);
  });

  test('a lone number is left alone — it has no internal order to lose', () => {
    setRtlProse(true);
    expect(rich('ص ۸۵ پر لکھا ہے')).not.toContain(LRI);
  });

  test('outside RTL mode the prose pipeline is byte-identical', () => {
    setRtlProse(false);
    expect(rich('see pages 6-7')).not.toContain(LRI);
    expect(isolateRanges('6-7')).toBe(`${LRI}6-7${PDI}`);
  });
});

// ── the rendered chrome, both directions of one document ────────────────────

describe('the built HTML, en vs ur, from the same document', () => {
  test('RTL chrome isolates printed_pages; flips arrows; carries plaintext prose', () => {
    const doc = load();
    const ur = buildHtml(doc, { docDir: path.dirname(FIXTURE), lang: 'ur' }).html;
    const pp = doc.provenance.printed_pages;

    expect(ur).toContain(`${LRI}${pp}${PDI}`);
    expect(ur).toContain('&larr;');
    expect(ur).not.toContain('&rarr;');
    expect(ur).toContain('unicode-bidi:plaintext');
  });

  test('the English render gains none of it', () => {
    const doc = load();
    const en = buildHtml(doc, { docDir: path.dirname(FIXTURE), lang: 'en' }).html;
    const pp = doc.provenance.printed_pages;

    expect(en).not.toContain(`${LRI}${pp}${PDI}`);
    expect(en).toContain('&rarr;');
    expect(en).not.toContain('&larr;');
    expect(en).not.toContain('unicode-bidi:plaintext');
  });

  test('the outcome box citation atoms are isolated under RTL', () => {
    const doc = load();
    if (!doc.slo.assessment_status) doc.slo.assessment_status = 'Formative';
    const ur = buildHtml(doc, { docDir: path.dirname(FIXTURE), lang: 'ur' }).html;
    expect(ur).toContain(`${LRI}${doc.slo.assessment_status}${PDI}`);
    expect(ur).toContain(`${LRI}${doc.slo.cognitive_level}${PDI}`);
  });
});
