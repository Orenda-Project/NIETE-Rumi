/**
 * The page format is an argument, not a module constant.
 *
 * v9.5 laid out on ONE page box — `PAGE_FORMATS.phone`, 520x2000 — and said so in a comment:
 * *"A printable render changes this by passing a format, once the parameter exists."* This is
 * that parameter. Amena asked for both renders of every primary plan: *"Both — A4 to review,
 * phone to deliver"*, because her page map for G1-5 is drawn on A4 (three tables side by side)
 * while what a teacher actually receives is the one-column phone page.
 *
 * Two things can go wrong when a module constant becomes selectable, and both are silent:
 *
 *   1. HALF THE GEOMETRY MOVES. Five lengths are derived from the page box. If a format change
 *      updates some and not others, the layout measures against a page it is not drawn on and
 *      the only symptom is content mysteriously overflowing.
 *   2. A CONSUMER KEEPS THE OLD VALUE. `module.exports = { PAGE }` copies the number once, at
 *      require time. `render_lp.js` destructured exactly that, so the Chromium viewport and the
 *      PDF box would have stayed 520px wide while the HTML's own `@page` rule said 794px.
 *
 * So the assertions below are about AGREEMENT, not about any one number: every derived length
 * moves together, the HTML says the same size the caller is told to print at, and going back to
 * the default lands exactly where it started.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const T = require(path.join(VENDOR, 'lib', 'template'));
const { buildHtml, setPageFormat, PAGE_FORMATS, FIG_CHROME, FULL_COL_A4, DIAGRAM_MIN_PX_A4 } = T;

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const build = (opts = {}) => buildHtml(baseDoc(), { docDir: path.dirname(FIXTURE), lang: 'en', ...opts });

/** Every length the format owns, read through the exports a real consumer uses. */
const geometry = () => ({
  w: T.PAGE.w, h: T.PAGE.h,
  inner: T.PAGE_INNER_W, fullCol: T.FULL_COL,
  diagramMin: T.DIAGRAM_MIN_PX, figGrow: T.FIG_GROW_MAX, contentH: T.PAGE_CONTENT_H,
});

/** The size Chromium is told to print at comes out of the stylesheet's own @page rule. */
const atPageSize = (html) => {
  const m = html.match(/@page\s*\{\s*size:\s*([\d.]+)px\s+([\d.]+)px/);
  return m && { w: Number(m[1]), h: Number(m[2]) };
};

afterEach(() => setPageFormat('phone'));   // the default is the delivered page; never leak a4

describe('the default is unchanged', () => {
  test('a build with no format is the phone page', () => {
    const out = build();
    expect(T.PAGE).toBe(PAGE_FORMATS.phone);
    expect(atPageSize(out.html)).toEqual({ w: 520, h: 2000 });
  });

  test('buildHtml reports the geometry it used, so no caller has to assume', () => {
    expect(build({ format: 'a4' }).page).toBe(PAGE_FORMATS.a4);
    expect(build({ format: 'phone' }).page).toBe(PAGE_FORMATS.phone);
    expect(build().page).toBe(PAGE_FORMATS.phone);
  });
});

describe('every derived length moves together', () => {
  test('a4 recomputes to the published A4 reference values', () => {
    setPageFormat('a4');
    const g = geometry();
    // These are not new numbers. FULL_COL_A4 and DIAGRAM_MIN_PX_A4 are the module's own A4
    // anchors, kept from v9.2 when A4 WAS the page — so a correct recompute has to land on
    // them exactly. That is the strongest available check that nothing was left behind.
    expect(g.inner).toBe(794 - 21 * 2);
    expect(g.fullCol).toBe(FULL_COL_A4);
    expect(g.diagramMin).toBe(DIAGRAM_MIN_PX_A4);
    expect(g.contentH).toBe(1123 - 10 - 4);
  });

  test('the derivations hold on BOTH formats, not just the one they were written for', () => {
    for (const name of Object.keys(PAGE_FORMATS)) {
      setPageFormat(name);
      const g = geometry();
      const f = PAGE_FORMATS[name];
      expect(g.inner).toBe(f.w - f.padX * 2);
      expect(g.fullCol).toBe(g.inner - FIG_CHROME);
      expect(g.contentH).toBe(f.h - f.padT - f.padB);
      expect(g.figGrow).toBe(f.padX - 3);
      // the diagram floor is an A4-referenced RATIO, so it shrinks with the column
      expect(g.diagramMin).toBeCloseTo(DIAGRAM_MIN_PX_A4 * (g.fullCol / FULL_COL_A4), 2);
    }
  });

  test('switching there and back is exactly where it started', () => {
    const before = geometry();
    setPageFormat('a4');
    expect(geometry()).not.toEqual(before);
    setPageFormat('phone');
    expect(geometry()).toEqual(before);
  });
});

describe('the HTML and the caller cannot disagree about the page size', () => {
  test.each(Object.keys(PAGE_FORMATS))('%s: @page, the returned geometry and the format agree', (name) => {
    const out = build({ format: name });
    const f = PAGE_FORMATS[name];
    expect(atPageSize(out.html)).toEqual({ w: f.w, h: f.h });
    expect({ w: out.page.w, h: out.page.h }).toEqual({ w: f.w, h: f.h });
  });

  test('the format survives a repaginating rebuild', () => {
    // render_lp.js builds TWICE for a real render: once to measure, once with the breaks it
    // computed. The second call re-enters the template, so a format that did not ride along
    // would reset to the default halfway through and repaginate against the wrong box.
    const first = build({ format: 'a4' });
    const again = buildHtml(baseDoc(), {
      docDir: path.dirname(FIXTURE), lang: 'en', format: 'a4', breaks: first.breaks || undefined,
    });
    expect(atPageSize(again.html)).toEqual({ w: 794, h: 1123 });
    expect(again.page).toBe(PAGE_FORMATS.a4);
  });
});

describe('an unknown format is refused', () => {
  test('setPageFormat throws, names the format and lists the real ones', () => {
    expect(() => setPageFormat('letter')).toThrow(/unknown page format "letter"/);
    expect(() => setPageFormat('letter')).toThrow(/a4/);
    expect(() => setPageFormat('letter')).toThrow(/phone/);
  });

  test('it carries BAD_FORMAT, so the CLI reports it as input and not as a crash', () => {
    try {
      setPageFormat('letter');
      throw new Error('expected setPageFormat to throw');
    } catch (e) {
      expect(e.code).toBe('BAD_FORMAT');
    }
  });

  test('a refused format leaves the geometry untouched', () => {
    const before = geometry();
    expect(() => buildHtml(baseDoc(), { docDir: path.dirname(FIXTURE), format: 'letter' })).toThrow();
    expect(geometry()).toEqual(before);
  });
});

describe('a4 lays out in columns and phone does not', () => {
  test('oneColumn drives the three-up grid Amena\'s page map needs', () => {
    // Her G1-5 map puts TO PREPARE | VIDEO RESOURCES | KEY WORDS side by side, which is a
    // .grid3 — three real columns on A4, stacked on the phone.
    expect(build({ format: 'a4' }).html).toMatch(/\.grid3\{[^}]*grid-template-columns:1fr 1fr 1fr/);
    expect(build({ format: 'phone' }).html).toMatch(/\.grid3\{[^}]*grid-template-columns:1fr/);
    expect(build({ format: 'phone' }).html).not.toMatch(/\.grid3\{[^}]*1fr 1fr 1fr/);
  });
});
