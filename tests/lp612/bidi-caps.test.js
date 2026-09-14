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
 * rendered en=9pp / ur=12pp) in PAGES — teach 5 / support 4 against English's
 * 4 / 3. Under one shared cap, every Urdu render of a full-cap English plan
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
  // Both caps moved one sheet on 2026-09-04 (bd-vjk68), then again on 2026-09-06 with the v9.2
  // type scale (EN 6/4 -> 7/6, UR 7/6 -> 9/7).
  //
  // Lowered again 2026-09-11 (bd-g6sww, closing bd-q29w9): the operator flagged 11-16 page LPs as
  // unreadable, a range the v9.2-type-scale ceiling alone still permitted. New universal ceiling
  // (applies to every subject, not just core — subject-level tightening is a word-budget lever in
  // lint_lp.js, not this cap): EN teach 4 / support 3. UR keeps its measured Nastaliq premium —
  // UR = round(EN x 1.33) — giving teach 5 / support 4.
  //
  // The per-language SHAPE — which this suite exists to protect — is unchanged.
  test('English: teach 4/support 3, warn 3/2', () => {
    expect(pageCapsFor('en')).toEqual({ max: { teach: 4, support: 3 }, warn: { teach: 3, support: 2 } });
    expect(pageCapsFor('en').max).toBe(MAX_PAGES);
    expect(pageCapsFor('en').warn).toBe(WARN_PAGES);
  });

  test('Urdu carries the measured +33% footprint: teach 5/support 4, warn 4/3', () => {
    expect(pageCapsFor('ur')).toEqual({ max: { teach: 5, support: 4 }, warn: { teach: 4, support: 3 } });
    expect(pageCapsFor('ur').max).toBe(MAX_PAGES_UR);
    expect(pageCapsFor('ur').warn).toBe(WARN_PAGES_UR);
  });

  test('and Urdu is still never TIGHTER than English on any part', () => {
    // The property the two constants must always satisfy, whatever the numbers become: an
    // Urdu page carries ~2/3 the lines of an English one, so an Urdu cap below the English
    // one would fail every Urdu render of a document English delivers.
    for (const part of ['teach', 'support']) {
      expect(MAX_PAGES_UR[part]).toBeGreaterThanOrEqual(MAX_PAGES[part]);
    }
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

  /**
   * SUPERSEDED BY bd-a8veu.14, and widened rather than deleted.
   *
   * This used to assert the outcome box's citation cluster — `Formative · U`, the assessment
   * status and cognitive level — was wrapped LRI…PDI. Those atoms are no longer PAINTED: the
   * operator's *"the curriculum SLO isnt needed neither is the learning outcomes, its just
   * repetition"* took the whole citation tail off the box, so `isoQuote` and that cluster went
   * with it (`tests/lp612/outcome-one-voice-render.test.js` is what pins the removal).
   *
   * The defect class the original test belonged to is still live, though — a Latin/numeric atom
   * dropped into Urdu chrome reverses under UAX#9 — and the page range is now the only atom of
   * that kind left on the page. It is stamped at THREE sites (teach header, teach h-meta, support
   * header), and the test above proves one of them. So this now proves there is no un-isolated
   * fourth: every occurrence, not the first.
   */
  test('every page-range atom in the Urdu build is isolated — no un-isolated fourth site', () => {
    const doc = load();
    const ur = buildHtml(doc, { docDir: path.dirname(FIXTURE), lang: 'ur' }).html;
    const pp = doc.provenance.printed_pages;
    // CSS COMMENTS SHIP VERBATIM inside the emitted <style>, and one of them quotes a page range
    // as an example. Count what is PAINTED, which starts after the sheet.
    const body = ur.slice(ur.lastIndexOf('</style>') + 8);

    const isolated = body.split(`${LRI}${pp}${PDI}`).length - 1;
    const total = body.split(pp).length - 1;
    expect(isolated).toBeGreaterThanOrEqual(3); // the three known stamps
    expect(total).toBe(isolated); // and nothing paints it bare
  });

  test('the citation cluster the box used to carry is gone, not merely unisolated', () => {
    // Guards the other half: a re-render that brought the tail back WITHOUT its isolates would
    // otherwise slip past, because the assertion above only counts page ranges.
    //
    // Both fields are given sentinels first. `cognitive_level` ships as a single letter ("A"),
    // which is a substring of every HTML document ever written — asserting on the fixture's own
    // value would be a test that can never fail.
    const doc = load();
    doc.slo.assessment_status = 'ZZ_STATUS_SENTINEL_ZZ';
    doc.slo.cognitive_level = 'ZZ_COGLEVEL_SENTINEL_ZZ';
    const ur = buildHtml(doc, { docDir: path.dirname(FIXTURE), lang: 'ur' }).html;
    expect(ur).not.toContain(doc.slo.assessment_status);
    expect(ur).not.toContain(doc.slo.cognitive_level);
  });
});
