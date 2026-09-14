/**
 * bd-a8veu.16 — MATERIALS, PACING AND KEY WORDS ARE BLOCKS, NOT ROWS IN A LIST.
 *
 * OPERATOR, 2026-09-12: *"Materials, Pacing and Key words should be spaced as their own blocks on
 * page 1, with slightly different colours and formats to hold the eye like Video does."*
 *
 * bd-a8veu.6 put all four on page 1 and collapsed them into ONE panel — deliberately, to spend one
 * border instead of three. That was the right call for *placement* and the wrong one for *reading*:
 * four facts of four different kinds (what to bring, how long it takes, what the words mean, what
 * to play) now arrive as four undifferentiated grey rows, and only the video — which kept its icon
 * and its amber link — is findable at a glance. The operator is naming the video as the standard
 * the other three should meet.
 *
 * So each of the four gets its own tinted, bordered block with its own icon, and the panel stops
 * drawing a box of its own — a box of boxes reads as clutter and costs a border for nothing. The
 * panel remains the ATOM, so nothing about pagination changes: the four still travel together, and
 * the packer still sees one indivisible unit on page 1.
 *
 * "Slightly different" is the operating word and it is asserted literally below: four DISTINCT
 * backgrounds, all of them pale, so the page reads as one card of four parts rather than four
 * unrelated widgets.
 *
 * WHAT MUST NOT CHANGE — bd-a8veu.6's contract, re-asserted here so a re-style cannot undo a move:
 * each of the three renders in exactly ONE place, all of them ahead of the Introduction bar, and
 * the card still holds on a lesson with no video.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const doc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

const buildFrom = (d, lang = 'en') => buildHtml(d, { lang, docDir: path.dirname(FIXTURE) }).html;
const built = (lang = 'en') => buildFrom(doc(), lang);

/** the one rule the emitted sheet declares for `sel`, as it was written */
function rule(html, sel) {
  const m = html.match(new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{[^}]*\\}`));
  if (!m) throw new Error(`the emitted stylesheet has no rule for \`${sel}\``);
  return m[0];
}

/** everything after the stylesheet — CSS comments ship verbatim */
const body = (html) => html.slice(html.indexOf('</style>'));

/** the resources card as emitted. `atom()` rewrites the class, so match the attribute's OPENING. */
function card(html) {
  const b = body(html);
  const i = b.indexOf('class="rescard');
  if (i < 0) throw new Error('the emitted document has no resources card');
  const open = b.lastIndexOf('<div', i);
  return b.slice(open, b.indexOf('data-sec="introduction"', i));
}

/** the four blocks, by the class each one is expected to carry */
const BLOCKS = [
  { what: 'video', sel: '.vres' },
  { what: 'materials', sel: '.rmat' },
  { what: 'pacing', sel: '.rpace' },
  { what: 'key words', sel: '.rkw' },
];

const bg = (r) => (r.match(/background:\s*([^;}]+)/) || [])[1];

describe('bd-a8veu.16 — page 1 is four blocks, each holding the eye on its own', () => {
  test('each of the four is a block with its own fill and its own edge', () => {
    const html = built();
    for (const { what, sel } of BLOCKS) {
      const r = rule(html, sel);
      expect([what, r]).toEqual([what, expect.stringMatching(/background:/)]);
      expect([what, r]).toEqual([what, expect.stringMatching(/border:\s*[\d.]/)]);
    }
    // Radius, padding and the icon gutter are SHARED, and that is the other half of "slightly":
    // only the fill varies, so the four read as one card of four parts.
    const shared = rule(html, '.rescard > div');
    expect(shared).toMatch(/border-radius:/);
    expect(shared).toMatch(/padding:/);
  });

  test('the four fills are slightly different — no two blocks share a colour', () => {
    const html = built();
    const fills = BLOCKS.map(({ sel }) => bg(rule(html, sel)));
    expect(fills.every(Boolean)).toBe(true);
    expect(new Set(fills).size).toBe(BLOCKS.length);
  });

  test('each block leads with an icon, the way the video row already does', () => {
    const c = card(built());
    for (const { what, sel } of BLOCKS) {
      const cls = sel.slice(1);
      const i = c.indexOf(`class="${cls}"`);
      expect([what, i > -1]).toEqual([what, true]);
      // the icon is the first thing inside the block
      expect([what, c.slice(i, i + 200)]).toEqual([what, expect.stringMatching(/<span class="ico">/)]);
    }
  });

  test('the panel stops drawing a box of its own — boxes inside a box read as clutter', () => {
    const r = rule(built(), '.rescard');
    expect(r).not.toMatch(/border:\s*[\d.]/);
    expect(r).not.toMatch(/background:/);
    // it is still the thing that spaces them apart
    expect(r).toMatch(/gap:/);
  });

  test('bd-a8veu.6 still holds — one copy of each, all ahead of the Introduction', () => {
    const html = built();
    const b = body(html);
    const intro = b.indexOf('data-sec="introduction"');
    expect(b.match(/class="kwrow"/g)).toHaveLength(1);
    expect(b.match(/class="vres"/g)).toHaveLength(1);
    for (const needle of ['class="vres"', 'class="rmat"', 'class="rpace"', 'class="kwrow"']) {
      const i = b.indexOf(needle);
      expect([needle, i > -1 && i < intro]).toEqual([needle, true]);
    }
    // the fixture's own materials, so this cannot pass on a label alone
    expect(b.indexOf('Squared paper')).toBeLessThan(intro);
  });

  test('a lesson with no video still gets three blocks', () => {
    const d = doc();
    delete d.sections.find((s) => s.id === 'development').video;
    const c = card(buildFrom(d));
    expect(c).not.toMatch(/class="vres"/);
    for (const cls of ['rmat', 'rpace', 'rkw']) expect(c).toContain(`class="${cls}"`);
  });

  test('the Urdu build gets the same blocks', () => {
    const c = card(built('ur'));
    for (const cls of ['rmat', 'rpace', 'rkw']) expect(c).toContain(`class="${cls}"`);
  });
});
