/**
 * bd-vxmj1 -- NASTALIQ NEEDS ITS OWN LEADING, AND THE FILE ALREADY SAID SO.
 *
 * OPERATOR, on the first G3 Urdu plan rendered end to end from the live ICT traces:
 * *"the urdu nastaliq script is overlapping on pages"*, and again:
 * *"urdu needs better spacing between lines, some places its too congested"*.
 *
 * She is right, and template.js already carries the law she is describing --
 * law R6 at the top of the file: *"Urdu: dir=rtl, Nastaliq, unitless line-height
 * >= 2.0 -- NEVER a px line-height, which clips Nastaliq's descenders."*
 * It was written down and then not enforced, which is why this suite exists: a law
 * with no test is a comment.
 *
 * TWO WAYS THE SHIPPED URDU SHEET BROKE IT:
 *
 *   1. SELECTORS THAT DID BRANCH, BUT BELOW THE FLOOR. `.hook .q` -- the loudest box
 *      on page 1 and the one carrying the longest run of Urdu prose in the plan --
 *      shipped `line-height:1.95`. That is the block in the operator's screenshot
 *      where the descenders of one line sit inside the next.
 *   2. SELECTORS THAT NEVER BRANCHED AT ALL. A rule written `line-height:1.35` with no
 *      `rtl ?` in front of it is a LATIN leading applied to Nastaliq. Nothing flagged
 *      it, because the Latin value is perfectly correct -- for Latin.
 *
 * WHY THE FLOOR IS HIGHER THAN 2.0 FOR RUNNING PROSE. R6's 2.0 is the minimum below
 * which Nastaliq clips outright. It is not the value at which a PARAGRAPH reads: the
 * face's ink box runs past 3em once a line carries the common descenders (ے ج ح ں),
 * and a caption that survives at 2.0 is a paragraph that collides at 2.0. So the floor
 * here is graded -- prose gets PROSE_MIN, short furniture keeps R6's own 2.0 -- and
 * both are asserted against the sheet that actually ships, not against the source.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED. Page count. Loosening Urdu leading costs pages
 * and the Urdu plan is already past its soft target; the page target is a TARGET and
 * the renderer says so in its own warning. Overlapping script is a defect. A defect
 * does not get paid for with a target.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { buildHtml, setPageFormat } = require('../../bot/vendor/lp-v9/lib/template.js');

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');

/** R6's own floor: below this Nastaliq clips, whatever the selector carries. */
const R6_MIN = 2.0;
/** A run of Urdu prose needs more than the clip floor before it reads as separate lines. */
const PROSE_MIN = 2.35;

/** The selectors that carry running Urdu prose -- a paragraph, not a chip. */
const PROSE = [
  'body', '.hook .q', '.hook .lf', '.slo p', '.tn',
  '.ck .q', '.srq .q', '.exq h4', '.band > div .t', '.ord li', '.tbl td',
];

function urduSheet() {
  const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  doc.provenance = { ...doc.provenance, grade: 3, subject: 'Urdu' };
  const { html } = buildHtml(doc, { docDir: path.dirname(FIXTURE), lang: 'ur' });
  return html.split('<style>')[1].split('</style>')[0]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/url\(data:[^)]*\)/g, 'url()');
}

/**
 * The leading each selector EFFECTIVELY gets, which is the one the page renders.
 *
 * Every rule in this sheet is a bare class or element selector, so they all carry the
 * same specificity and the LAST declaration wins. Reading every declaration instead
 * would fail the fix on the very value it replaced -- the floor block is appended, it
 * does not delete what came before it. Taking the last one also keeps the test honest
 * in the other direction: a new rule added after the floor block becomes the effective
 * one, and is caught.
 */
function leadings(sheet) {
  const seen = new Map();
  for (const rule of sheet.split('}')) {
    const at = rule.indexOf('{');
    if (at < 0) continue;
    const sels = rule.slice(0, at);
    const decl = rule.slice(at + 1);
    const m = /(?:^|[;\s])line-height\s*:\s*([^;]+)/.exec(decl);
    if (!m) continue;
    const value = m[1].trim();
    for (const sel of sels.split(',')) {
      const s = sel.trim().replace(/\s+/g, ' ');
      if (s) seen.set(s, value);
    }
  }
  return [...seen].map(([sel, value]) => ({ sel, value }));
}

let SHEET;
let LEADS;
beforeAll(() => { SHEET = urduSheet(); LEADS = leadings(SHEET); });
afterEach(() => setPageFormat('phone'));

describe('R6: the Urdu sheet never sets a px line-height', () => {
  test('not one declaration carries a px unit', () => {
    const px = LEADS.filter((d) => /\dpx/.test(d.value));
    expect(px.map((d) => `${d.sel} -> ${d.value}`)).toEqual([]);
  });
});

describe('R6: no Urdu leading falls under the clip floor', () => {
  test('every unitless line-height is >= 2.0, or is an intentional 1 on a centred glyph box', () => {
    const under = LEADS
      .filter((d) => /^[\d.]+$/.test(d.value))
      .filter((d) => !d.sel.startsWith('.katex'))   // vendor sheet: math layout, not prose
      .filter((d) => d.sel !== '.board .bn')        // a centred numeric badge, no descenders
      .filter((d) => Number(d.value) !== 1)
      .filter((d) => Number(d.value) < R6_MIN);
    expect(under.map((d) => `${d.sel} -> ${d.value}`)).toEqual([]);
  });
});

describe('running Urdu prose clears the prose floor', () => {
  test.each(PROSE)('%s leads at or above the prose floor', (sel) => {
    const found = LEADS.filter((d) => d.sel === sel && /^[\d.]+$/.test(d.value));
    expect(found.length).toBeGreaterThan(0);
    for (const d of found) expect(Number(d.value)).toBeGreaterThanOrEqual(PROSE_MIN);
  });
});

describe('English is untouched', () => {
  test('the Latin sheet keeps its own tighter leading', () => {
    const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    doc.provenance = { ...doc.provenance, grade: 3, subject: 'English' };
    const { html } = buildHtml(doc, { docDir: path.dirname(FIXTURE), lang: 'en' });
    const sheet = html.split('<style>')[1].split('</style>')[0];
    expect(/\.hook \.q\{[^}]*line-height:1\.55/.test(sheet.replace(/\s*\n\s*/g, ''))).toBe(true);
  });
});
