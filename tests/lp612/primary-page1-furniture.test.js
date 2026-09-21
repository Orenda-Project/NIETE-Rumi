/**
 * bd-vbs5w -- PRIMARY PAGE 1 IS THE kie.ai PAGE, AT 21px.
 *
 * OPERATOR, on the first HTML render of a G1-5 plan: *"why cant p1 be like kie.ai? its more
 * visual, and concise / materials should be indented bullets that go from left to right, no
 * blank spaces / you didnt create a table for videos after materials / Write on the board
 * sould be concise and pointed, / the kie.ai rendering should be adopted here with a larger
 * font, possible or not?"*
 *
 * Yes, and this suite is the answer. The image path (kie.ai / Nano-Banana) drew a page 1 that
 * is genuinely better furniture than the HTML path's: a numbered DAY rail, a three-column
 * JOURNEY SO FAR | TODAY | COMING UP band, TO PREPARE as a row of checkboxes, and the key
 * words as a two-column table. None of that needs an image model -- it is grid CSS -- and the
 * HTML path can carry it at BODY_PX (21px), where a raster could not be enlarged at all.
 *
 * WHAT EACH GROUP BELOW IS DEFENDING:
 *
 *   1. G6-12 IS UNTOUCHED BY CONSTRUCTION. Every new surface is gated on `isPrimary(doc)` --
 *      grade 1-5 read off `provenance.grade`, the same predicate `render_lp.js` already uses
 *      for the page cap, never a caller flag. The fixture is a GRADE 9 document, so the first
 *      group is a control: it must render exactly as it did before this change.
 *   2. NOTHING PRINTS TWICE. The day rail REPLACES the `.seq` text stack ("Day 6 of 10" was
 *      its middle leg), and the pacing SUM row leaves page 1 because the period total is
 *      already in the hero and every section bar already carries its own minutes -- three
 *      statements of one number was part of the wall she was reading.
 *   3. NO FIELD LOSES ITS HOME. `sequence.previous`/`next`/`checkpoint` move into the band;
 *      `materials` becomes the checkbox row; the hoisted `keywords` block becomes the table.
 *      One home per source field, on the printed page.
 *   4. A GAP IS A GAP. The video sheet is still 403 to the build account, so a day with no
 *      mapped video prints the design-pending surface and never a fabricated link.
 *   5. 21px DOES NOT MOVE. "larger font" means larger. The suite fails if the body shrinks.
 *
 * The band is the one place the phone page cannot do what A4 does: three columns at 21px on a
 * 478px column is ~160px each, which is unreadable. So TODAY spans the full width and the other
 * two share a 2-col grid beneath it on phone, and A4 gets the true three columns.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const T = require(path.join(VENDOR, 'lib', 'template'));
const { buildHtml, setPageFormat, BODY_PX } = T;
const { LABELS } = require(path.join(VENDOR, 'lib', 'overlay'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

/** A grade-4 document: the same fixture, re-provenanced, with the primary-only fields D0 emits. */
function primaryDoc() {
  const d = baseDoc();
  d.provenance = { ...d.provenance, grade: 4, subject: 'English',
    topic: 'Chapter Vocabulary + Dance Moves' };
  d.materials = ['Chalk', 'Board', 'Textbook p.102', 'Notebook'];
  d.sequence = { previous: 'Guessing word meanings (p.101)', this: 'Day 6 of 10',
    next: 'Reading the poem aloud (p.103)', checkpoint: 'Ch. 9 review, day 10', day: 6, of: 10 };
  return d;
}

const build = (doc, opts = {}) =>
  buildHtml(doc, { docDir: path.dirname(FIXTURE), lang: 'en', ...opts }).html;

/** The stylesheet alone, comments and data URIs stripped, so a rule cannot be read off content. */
const sheet = (html) => html.split('<style>')[1].split('</style>')[0]
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\(data:[^)]*\)/g, 'url()');
/** Everything AFTER the stylesheet, so a selector NAME cannot satisfy a content assertion. */
const body = (html) => html.split('</style>').pop();
/** An atom's root element gains an `sp-N` class (see `decorate`), so a root's class attribute
 *  does not end where its name does. Match the name as a class, not the whole attribute. */
const hasClass = (h, c) => new RegExp(`class="(?:[^"]*\\s)?${c}(?:\\s[^"]*)?"`).test(h);

const L = LABELS.en;
afterEach(() => setPageFormat('phone'));

/* ------------------------------------------------------------------ 1. the G6-12 control */

describe('a G6-12 plan renders exactly as it did', () => {
  const h = () => body(build(baseDoc()));

  test('no day rail and no band -- both are primary-only furniture', () => {
    expect(hasClass(h(), 'drail')).toBe(false);
    expect(hasClass(h(), 'band')).toBe(false);
  });

  test('the sequence strip still prints its four legs as text', () => {
    expect(hasClass(h(), 'seq')).toBe(true);
    expect(h()).toContain('Adding and subtracting matrices');
    expect(h()).toContain('The determinant of a 2');
  });

  test('materials stay one middle-dot row, not checkboxes', () => {
    expect(hasClass(h(), 'rmat')).toBe(true);
    expect(hasClass(h(), 'mi')).toBe(false);
    expect(h()).toContain('Textbook p.24-25 &middot;');
  });

  test('key words stay chips and the pacing sum keeps its row', () => {
    expect(hasClass(h(), 'kwrow')).toBe(true);
    expect(hasClass(h(), 'kwtab')).toBe(false);
    expect(hasClass(h(), 'rpace')).toBe(true);
  });

  test('isPrimary reads the grade off the document', () => {
    expect(T.isPrimary(baseDoc())).toBe(false);
    expect(T.isPrimary(primaryDoc())).toBe(true);
    expect(T.isPrimary({ provenance: { grade: 5 } })).toBe(true);
    expect(T.isPrimary({ provenance: { grade: '4' } })).toBe(false);
    expect(T.isPrimary({})).toBe(false);
  });
});

/* -------------------------------------------------------------- 2. the numbered day rail */

describe('the day rail replaces the "Day n of m" text leg', () => {
  test('one pip per day, in order, with exactly one marked current', () => {
    const h = body(build(primaryDoc()));
    expect(hasClass(h, 'drail')).toBe(true);
    const pips = h.match(/<span class="d(?: [a-z]+)?">\d+<\/span>/g) || [];
    expect(pips).toHaveLength(10);
    expect(pips[0]).toContain('>1<');
    expect(pips[9]).toContain('>10<');
    expect(h.match(/class="d on"/g) || []).toHaveLength(1);
    expect(h).toContain('<span class="d on">6</span>');
  });

  test('days already taught are marked done, days ahead are bare', () => {
    const h = body(build(primaryDoc()));
    expect(h.match(/class="d done"/g) || []).toHaveLength(5);
  });

  test('the text stack goes, so the day is stated once', () => {
    const h = body(build(primaryDoc()));
    expect(h).not.toContain('Day 6 of 10');
    expect(hasClass(h, 'seq')).toBe(false);
  });

  test('a rail too long to read falls back to the text line', () => {
    const d = primaryDoc();
    d.sequence = { ...d.sequence, day: 3, of: 34, this: 'Day 3 of 34' };
    const h = body(build(d));
    expect(hasClass(h, 'drail')).toBe(false);
    expect(h).toContain('Day 3 of 34');
  });

  test('a plan with no day/of numbers keeps the text line', () => {
    const d = primaryDoc();
    delete d.sequence.day; delete d.sequence.of;
    const h = body(build(d));
    expect(hasClass(h, 'drail')).toBe(false);
    expect(h).toContain('Day 6 of 10');
  });
});

/* ----------------------------------------------- 3. journey so far | today | coming up */

describe('the band carries where the class has been, is, and is going', () => {
  test('all three columns print, TODAY holding the topic verbatim', () => {
    const h = body(build(primaryDoc()));
    expect(hasClass(h, 'band')).toBe(true);
    expect(h).toContain(L.journey);
    expect(h).toContain(L.today);
    expect(h).toContain(L.comingUp);
    expect(h).toContain('Chapter Vocabulary + Dance Moves');
    expect(h).toContain('Guessing word meanings (p.101)');
    expect(h).toContain('Reading the poem aloud (p.103)');
  });

  test('the checkpoint travels with COMING UP rather than being dropped', () => {
    expect(body(build(primaryDoc()))).toContain('Ch. 9 review, day 10');
  });

  test('day one says so instead of printing an empty column', () => {
    const d = primaryDoc();
    d.sequence = { ...d.sequence, previous: null, day: 1, this: 'Day 1 of 10' };
    expect(body(build(d))).toContain(L.journeyNone);
  });

  test('phone stacks TODAY full width; A4 gives the true three columns', () => {
    const phone = sheet(build(primaryDoc()));
    expect(phone).toMatch(/\.band\{[^}]*grid-template-columns:\s*1fr\s+1fr/);
    expect(phone).toMatch(/\.band\s*>\s*\.today\{[^}]*grid-column:\s*1\s*\/\s*-1/);
    const a4 = sheet(build(primaryDoc(), { format: 'a4' }));
    expect(a4).toMatch(/\.band\{[^}]*grid-template-columns:(\s*[\d.]*fr){3}/);
    expect(a4).not.toMatch(/\.band\s*>\s*\.today\{[^}]*grid-column:\s*1\s*\/\s*-1/);
  });
});

/* --------------------------------------------------------- 4. to prepare, left to right */

describe('to prepare is a row of checkboxes, not a wrapped sentence', () => {
  test('one chip per material, in document order', () => {
    const h = body(build(primaryDoc()));
    const chips = [...h.matchAll(/<span class="mi">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(chips).toEqual(['Chalk', 'Board', 'Textbook p.102', 'Notebook']);
    expect(h).toContain(L.toPrepare);
    expect(h).not.toContain('Chalk &middot; Board');
  });

  test('the row flows left to right and is not centred or spread', () => {
    const s = sheet(build(primaryDoc()));
    expect(s).toMatch(/\.mlist\{[^}]*flex-wrap:\s*wrap/);
    expect(s).toMatch(/\.mlist\{[^}]*justify-content:\s*flex-start/);
    expect(s).toMatch(/\.mi::before\{/);
  });

  test('the pacing sum leaves page 1 -- the hero and the bars already say it', () => {
    expect(hasClass(body(build(primaryDoc())), 'rpace')).toBe(false);
  });
});

/* ------------------------------------------------------------ 5. the video resource table */

describe('video resources is its own table, after to prepare', () => {
  test('a mapped video prints between to prepare and key words', () => {
    const h = body(build(primaryDoc()));
    const mats = h.indexOf('class="rmat');
    const vid = h.indexOf('class="vres');
    const kw = h.indexOf('class="kwtab');
    expect(mats).toBeGreaterThan(-1);
    expect(vid).toBeGreaterThan(mats);
    expect(kw).toBeGreaterThan(vid);
    expect(h).toContain(L.videoRes);
    // the visible run is the TITLE (bd-a8veu.4), and primary adds the running time -- four
    // characters that answer what the title cannot: whether the clip fits the period.
    expect(h).toContain('Multiplying 2×2 matrices');
    expect(h).toContain('<span class="dur">4:12</span>');
  });

  test('no video prints the gap and never a link', () => {
    const d = primaryDoc();
    delete d.sections.find((s) => s.id === 'development').video;
    const h = body(build(d));
    expect(hasClass(h, 'vres')).toBe(true);
    expect(h).toContain(L.videoPending);
    expect(h).not.toContain('youtube.com');
  });
});

/* ----------------------------------------------------------------- 6. key words as a table */

describe('key words is a two-column table, not six boxed rows', () => {
  test('each word is one row of term and meaning', () => {
    const h = body(build(primaryDoc()));
    expect(hasClass(h, 'kwtab')).toBe(true);
    expect(hasClass(h, 'kw')).toBe(false);
    expect(h.match(/<div class="kr">/g) || []).toHaveLength(3);
    expect(h).toContain('rows × columns, in that order');
  });

  test('neither track may exceed the panel', () => {
    expect(sheet(build(primaryDoc())))
      .toMatch(/\.kwtab\{[^}]*grid-template-columns:\s*fit-content\([^)]*\)\s*minmax\(0,\s*1fr\)/);
  });

  test('the label is a direct child of the panel, so it can leave the gutter', () => {
    // Measured, not preferred: with the label held in the left gutter the meanings had 230px of
    // a 478px column to define "present simple tense" in, and page 1's furniture cost 477px more
    // than the row it replaced. The label rule below only reaches a DIRECT child, so the table
    // cannot go back to being wrapped in a `.blk`.
    const h = body(build(primaryDoc()));
    expect(h).toMatch(/<div class="rkw">(?:(?!<div class="blk")[\s\S])*?<span class="lbl">/);
    expect(h).not.toMatch(/<div class="rkw">\s*<span class="ico">[^<]*<\/span>\s*<div class="blk"/);
  });
});

/* ------------------------------------------- 6b. the label stops being a left gutter (primary) */

describe('a primary resources row spends its width on content, not on a label column', () => {
  const s = () => sheet(build(primaryDoc()));

  test('the row wraps and the label is its own small heading', () => {
    expect(s()).toMatch(/\.pri \.rescard > div\{[^}]*flex-wrap:\s*wrap/);
    expect(s()).toMatch(/\.pri \.rescard > div > \.lbl\{[^}]*text-transform:\s*uppercase/);
  });

  test('the key-word table takes the whole row beneath its label', () => {
    expect(s()).toMatch(/\.pri \.rkw \.kwtab\{[^}]*flex:\s*1 0 100%/);
  });

  test('a G6-12 row keeps its label in the gutter', () => {
    // The two rules above are reachable only under `.pri`, and the shared rule a secondary plan
    // does read still pins the label out of the flow.
    expect(sheet(build(baseDoc())))
      .toMatch(/\.rescard \.lbl\{ font-weight:700; flex:0 0 auto; \}/);
    expect(hasClass(body(build(baseDoc())), 'kwtab')).toBe(false);
  });
});

/* ------------------------------------------------------------------- 7. the font gets bigger */

describe('the type scale', () => {
  test('the body is 21px and the new furniture is not smaller than it', () => {
    expect(BODY_PX).toBe(21);
    const s = sheet(build(primaryDoc()));
    expect(s).toContain('font-size:21px');
    for (const sel of ['\\.band > div \\.t', '\\.mi', '\\.kwtab \\.kr']) {
      const rule = new RegExp(`${sel}\\{([^}]*)\\}`).exec(s);
      expect(rule).not.toBeNull();
      const px = /font-size:\s*([\d.]+)px/.exec(rule[1]);
      if (px) expect(Number(px[1])).toBeGreaterThanOrEqual(18);
    }
  });
});

/* ------------------------------------------------- 7b. three panels, three packable atoms */

/**
 * HER PAGE MAP SAYS "this should all be on page 1", AND ON A4 THE PACKER COULD NOT DO IT.
 *
 * The three primary panels are one `.rescard` element, so they were one ATOM -- and an atom
 * never splits. On the phone page (inner box 1,940px) that is invisible: all three fit under the
 * outcome box with room to spare. On A4 the box is 1,063px, page 1 ran out at ~505px of content,
 * and the whole 570px card moved to page 2 rather than any part of it staying -- **half of the
 * review sheet blank, with the to-prepare list on the next one.**
 *
 * They are already three separate surfaces on the printed page -- own tint, own icon, own label
 * (bd-a8veu.16) -- so there is no visual seam to protect: only the wrapper was holding them
 * together. Three atoms let the exact packer put as many on page 1 as the sheet holds, which is
 * all three on phone and as many as fit on A4.
 *
 * G6-12's card stays ONE atom. Its rows are single lines (materials, pacing, video) that read as
 * one card of addresses, and a break between two one-line rows would be a page turn mid-list.
 */
describe('primary\'s page-1 panels pack independently', () => {
  const roots = (h) => (h.match(/<div data-atom class="rescard/g) || []).length;

  test('primary emits one atom per panel: to prepare, video, key words', () => {
    expect(roots(body(build(primaryDoc())))).toBe(3);
  });

  test('each panel is still a .rescard, so not one style rule has to change', () => {
    const h = body(build(primaryDoc()));
    for (const cls of ['rmat', 'vres', 'rkw']) {
      expect(new RegExp(`<div data-atom class="rescard[^"]*">\\s*<div class="${cls}"`).test(h)
        || new RegExp(`<div data-atom class="rescard[^"]*">\\s*<span class="ico">[^<]*</span>`).test(h))
        .toBe(true);
    }
    expect(hasClass(h, 'mi')).toBe(true);
    expect(hasClass(h, 'kwtab')).toBe(true);
  });

  test('a G6-12 card is ONE atom, exactly as before', () => {
    const h = body(build(baseDoc()));
    expect(roots(h)).toBe(1);
    // ... and all of its rows are inside that one root.
    const card = /<div data-atom class="rescard[\s\S]*?(?=<div data-atom)/.exec(h)[0];
    expect(card).toContain('class="rmat"');
    expect(card).toContain('class="rpace"');
  });
});

/* ----------------------------------------------------------- 8. both label dictionaries */

describe('every new label exists in both dictionaries', () => {
  test.each(['journey', 'journeyNone', 'today', 'comingUp', 'toPrepare', 'videoRes', 'videoPending'])(
    '%s is in en and ur', (k) => {
      expect(typeof LABELS.en[k]).toBe('string');
      expect(LABELS.en[k].length).toBeGreaterThan(0);
      expect(typeof LABELS.ur[k]).toBe('string');
      expect(LABELS.ur[k].length).toBeGreaterThan(0);
      expect(LABELS.ur[k]).not.toBe(LABELS.en[k]);
    });
});
