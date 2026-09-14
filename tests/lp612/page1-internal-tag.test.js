/**
 * bd-ydz6z — the internal `lp_type` tag must never reach page 1 of a teacher's lesson plan.
 *
 * Operator, 2026-09-11, verbatim: *"the tag in the 1st page of the pdf still exists"*.
 *
 * WHAT A TEACHER SEES TODAY. `page1()`'s hero paints a chips row in the top right:
 *
 *     <div class="chips">
 *       <span class="tchip">STEM-2</span>
 *       <span class="tchip plain">FBISE SSC-I · ~5 marks</span>
 *     </div>
 *
 * `STEM-2` is `doc.lp_type` — OUR authoring taxonomy, enum STEM-1/2/3, LL-1/2/3, SS-1/2/3,
 * RECALL, GEN-6-8. It decides the Development/Activity internals and it is chosen before a
 * word of the lesson is written. A teacher has no use for it, cannot act on it, and has no
 * way to find out what it means.
 *
 * This is the same defect class the v8.1 footer already fixed — `grade_11_chemistry ·
 * PK_G11_CHEM_CH4_MOLE_RATIO · lp_doc 2.0`, operator: *"isn't this an internal ref?"* — and
 * the same class as bd-w56zx's `previous: grade_10_urdu.p1c01.r990`. The rule those two
 * established is that an internal key may live in the document and in the PDF's Info
 * dictionary, but not on a page a teacher prints and carries into a classroom.
 *
 * WHAT STAYS. `board_weight` ("FBISE SSC-I · ~5 marks") is the other chip in that row and it
 * is teacher-meaningful — it says what this topic is worth in the exam she is preparing them
 * for. It is asserted here precisely so the fix cannot take the whole chips row with it.
 *
 * And `lp_type` stays in the document: the author service routes on it and the gates read it.
 * It just stops being painted.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const load = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
// The BODY, deliberately — never the whole document. `<head>` carries
// `<meta name="subject" content="lesson_id=…">` and `<meta name="keywords" content="…; lp_doc 2.0;
// STEM-2">`, and `render_lp.js:783` copies the same three into the PDF's Keywords field. That IS
// the sanctioned home the v8.1 footer fix established: an internal key belongs in the Info
// dictionary. What this suite is about is the painted page, so it reads the painted page.
const build = (doc, lang) => {
  const { html } = buildHtml(doc, { docDir: path.dirname(FIXTURE), lang });
  const body = html.slice(html.indexOf('<body'));
  expect(body).toContain('</body>');   // the slice found a body, rather than silently asserting ''
  return body;
};

describe('page 1 carries no internal lp_type tag', () => {
  test('the enum value never appears in the rendered HTML', () => {
    const doc = load();
    expect(doc.lp_type).toBe('STEM-2');           // the fixture really does carry one
    expect(build(doc, 'en')).not.toContain('STEM-2');
  });

  test('nor does any other lp_type the schema allows', () => {
    // Read from the schema, not restated: a value added upstream must be covered the day it
    // is added, and a literal list here would keep passing while the two diverged.
    const { enum: LP_TYPES } = JSON.parse(
      fs.readFileSync(path.join(VENDOR, 'schema', 'lp_doc.v2.schema.json'), 'utf8'),
    ).properties.lp_type;
    expect(LP_TYPES.length).toBeGreaterThan(1);

    for (const t of LP_TYPES) {
      const doc = load();
      doc.lp_type = t;
      expect(build(doc, 'en')).not.toContain(t);
    }
  });

  test('Urdu loses it too — the tag is internal in every language', () => {
    const doc = load();
    expect(build(doc, 'ur')).not.toContain('STEM-2');
  });

  test('but board_weight, which a teacher CAN act on, still prints', () => {
    const doc = load();
    expect(doc.board_weight).toBe('FBISE SSC-I · ~5 marks');
    const html = build(doc, 'en');
    expect(html).toContain('FBISE SSC-I');
    expect(html).toContain('<div class="chips">');        // the chips row itself survives
    expect(html).toContain('<span class="tchip plain">'); // as the one chip in it
  });

  test('a grade 6-8 doc has no board_weight, so it prints no chip at all', () => {
    // The other half of the row: `board_weight` is null for grades 6-8 (FBISE's examining
    // remit starts at SSC). With lp_type gone, there is nothing left to paint — and an empty
    // `.chips` box must not leave a gap in the hero.
    const doc = load();
    doc.board_weight = null;
    // Asserted on the MARKUP, not on the bare class name: `.hero .tchip` and `.hero .chips` are
    // rules in the stylesheet and stay there whether or not anything wears them. The question is
    // whether a span and a row are PAINTED.
    const html = build(doc, 'en');
    expect(html).not.toContain('FBISE SSC-I');
    expect(html).not.toMatch(/<span class="tchip/);
    expect(html).not.toContain('<div class="chips">');
  });
});
