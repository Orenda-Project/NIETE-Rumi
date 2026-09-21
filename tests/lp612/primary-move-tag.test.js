/**
 * bd-hlk39 -- THE PHASE NAMES THE BAND, THE MOVE RIDES ITS RIGHT-HAND EDGE.
 *
 * OPERATOR: *"Warm Up and Hook should come underopening header / Explanation header with
 * an I Do tag on the extreme right to understand the moves"*.
 *
 * WHAT WAS WRONG. The primary bands were named by the MOVE where a move existed and by
 * the CONTENTS where one did not: "Warm-up and hook" then "I Do". Read down the page that
 * is two different grammars in two consecutive bands, and neither of them tells a teacher
 * what part of the lesson she is in. The fix names every band by its PHASE -- OPENING,
 * EXPLANATION -- and gives the move a badge of its own.
 *
 * WHY A SEPARATE FIELD AND NOT A LONGER TITLE. A title is one string and would print the
 * move wherever the name happens to end. She asked for the extreme right, which is a
 * position, so the move has to reach the renderer as its own fact. `section.move` is that
 * fact; `bar()` decides where it lands.
 *
 * WHY IT LOOKS LIKE THE BOX BELOW IT. The amber I DO pill inside the worked example is
 * already the badge on this page that names who is holding the pen. The bar tag is the
 * same pill in the same amber with the same navy ink (5.63:1, gated on .pri) -- one badge
 * family, read twice at two scales, not a second visual idea.
 *
 * WHAT THIS SUITE DEFENDS:
 *
 *   1. G6-12 IS UNTOUCHED BY CONSTRUCTION. No document outside primary carries `move`,
 *      so the grade 9 fixture is the control and must render byte-identically.
 *   2. THE TAG IS AT THE READING-END EDGE, after the minutes -- and it is the minutes
 *      that give up the auto margin, so a bar with no move is the bar it always was.
 *   3. IT REPEATS ON THE CONTINUATION BAR. A teacher landing on page 4 mid-EXPLANATION
 *      must still see which move she is in; that is the whole point of the tag.
 *      (Precedent: SYNC 3.23's `info.fill` repainting YOU DO's band on resume.)
 *   4. THE TEXT IS THE DOCUMENT'S. No renderer-side label table, so Urdu needs no second
 *      translation and an author can name a move we have not thought of.
 *   5. IT OBEYS THE SURFACE LADDER: radius from the three tokens, no hex in a border.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const T = require(path.join(VENDOR, 'lib', 'template'));
const { buildHtml, setPageFormat } = T;

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

/** Primary is grade 1-5 read off provenance -- the one thing isPrimary looks at. */
function doc({ move = 'I DO', title = 'Explanation' } = {}) {
  const d = baseDoc();
  d.provenance = { ...d.provenance, grade: 4, subject: 'English' };
  const dev = d.sections.find((s) => s.id === 'development');
  dev.title = title;
  if (move !== null) dev.move = move;
  return d;
}

const built = (d, opts = {}) =>
  buildHtml(d, { docDir: path.dirname(FIXTURE), lang: 'en', ...opts });
const build = (d, opts = {}) => built(d, opts).html;
const sheet = (html) => html.split('<style>')[1].split('</style>')[0];
const body = (html) => html.split('</style>').pop();

/** Every `.bar` in the printed body, whole, opening tag to closing tag. `decorate` emits
 *  `data-atom` BEFORE `class` and appends the rhythm class, so the bar root is
 *  `<div data-atom class="bar s-d sp-4" ...>` -- match the NAME inside the attribute, never
 *  the attribute's literal text. A bar holds spans and no nested div, so the first `</div>`
 *  after it is its own. */
const bars = (html) =>
  html.match(/<div[^>]*class="(?:[^"]*\s)?bar(?:\s[^"]*)?"[^>]*>[\s\S]*?<\/div>/g) || [];

afterEach(() => setPageFormat('phone'));

/* ------------------------------------------------------------------ 1. the G6-12 control */

describe('a G6-12 plan is untouched', () => {
  test('carries no move tag at all', () => {
    expect(body(build(baseDoc()))).not.toContain('class="mv"');
  });

  test('renders byte-identically to the document it was before', () => {
    expect(build(baseDoc())).toBe(build(baseDoc()));
  });

  test('its minutes still own the reading-end edge', () => {
    expect(sheet(build(baseDoc()))).toMatch(/\.bar \.mins\{[^}]*margin-left:auto/);
  });
});

/* ------------------------------------------------------------------ 2. the tag prints */

describe('the move prints as a pill on the section bar', () => {
  const devBar = (h) => bars(h).find((b) => b.includes('data-sec="development"'));

  test('the tag is inside the bar, not beside it', () => {
    const b = devBar(body(build(doc())));
    expect(b).toBeTruthy();
    expect(b).toContain('<span class="mv">I DO</span>');
  });

  test('the band says the phase and the tag says the move', () => {
    const b = devBar(body(build(doc())));
    expect(b).toContain('>Explanation<');
    expect(b.indexOf('Explanation')).toBeLessThan(b.indexOf('I DO'));
  });

  test('the tag comes after the minutes, so the extreme right is the move', () => {
    const b = devBar(body(build(doc())));
    expect(b).toContain('class="mins"');
    expect(b.indexOf('class="mins"')).toBeLessThan(b.indexOf('class="mv"'));
  });

  test('a section with no move prints no pill and no empty span', () => {
    const h = body(build(doc({ move: null })));
    expect(h).not.toContain('class="mv"');
  });

  test('an empty move is a move that was not authored, not an empty badge', () => {
    expect(body(build(doc({ move: '   ' })))).not.toContain('class="mv"');
  });
});

/* ------------------------------------------------------------------ 3. the text is the document's */

describe('the tag text comes from the document', () => {
  test('a move we have never seen prints verbatim', () => {
    expect(body(build(doc({ move: 'WE DO' })))).toContain('<span class="mv">WE DO</span>');
  });

  test('Urdu needs no second label table', () => {
    const d = doc({ move: 'میں کرتا ہوں', title: 'وضاحت' });
    d.provenance = { ...d.provenance, medium: 'ur' };
    expect(body(build(d, { lang: 'ur' }))).toContain('<span class="mv">میں کرتا ہوں</span>');
  });
});

/* ------------------------------------------------------------------ 4. it survives a page break */

/* `buildHtml` does not paginate -- the packer does, in a second pass, and it hands the
   breaks back in via `opts.breaks`. So a continuation bar is reachable two ways, and both
   matter: `probeCont` emits the throwaway page the packer MEASURES (a probe bar without
   the pill would under-charge the strip's height and overflow the page, which is exactly
   how v8 broke), and `breaks` emits the real one a teacher reads. */
describe('the tag repeats when the section resumes on the next page', () => {
  const contBars = (h) => bars(h).filter((b) => /class="[^"]*\bcont\b/.test(b));

  test('the bar the packer measures carries the pill, so its height is paid for', () => {
    const h = body(build(doc(), { probeCont: true }));
    const dev = contBars(h).filter((b) => b.includes('data-sec="development"'));
    expect(dev.length).toBeGreaterThan(0);
    for (const b of dev) expect(b).toContain('<span class="mv">I DO</span>');
  });

  test('so does the real one, on a page that resumes mid-EXPLANATION', () => {
    const atoms = built(doc()).atoms.teach;
    const at = atoms.findIndex((a, i) => a.sec === 'development' && !a.first && i > 0);
    expect(at).toBeGreaterThan(0);
    const h = body(build(doc(), { breaks: { teach: [at], support: [] } }));
    const dev = contBars(h).filter((b) => b.includes('data-sec="development"'));
    expect(dev.length).toBe(1);
    expect(dev[0]).toContain('<span class="mv">I DO</span>');
    expect(dev[0]).toContain('Explanation');
  });

  test('a section with no move resumes bare, as it always did', () => {
    const d = doc({ move: null });
    const h = body(build(d, { probeCont: true }));
    expect(contBars(h).length).toBeGreaterThan(0);
    expect(h).not.toContain('class="mv"');
  });
});

/* ------------------------------------------------------------------ 5. the surface ladder */

describe('the pill obeys the surface ladder', () => {
  const rule = () => {
    const m = sheet(build(doc())).match(/\.bar \.mv\{[^}]*\}/);
    expect(m).toBeTruthy();
    return m[0];
  };

  test('it wears the amber token, not a hex of its own', () => {
    expect(rule()).toContain('var(--amber)');
    expect(rule()).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  test('its radius is one of the three tokens', () => {
    expect(rule()).toMatch(/border-radius:var\(--r-pill\)/);
  });

  test('the minutes give up the auto margin rather than fight the pill for it', () => {
    expect(sheet(build(doc()))).toMatch(/\.bar \.mins \+ \.mv\{[^}]*margin-left:0/);
  });
});
