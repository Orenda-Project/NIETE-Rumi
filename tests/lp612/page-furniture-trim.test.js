/**
 * THE FURNITURE A TEACHER DOES NOT READ — two operator notes of 2026-09-13, one shape.
 *
 * 1. *"the footer contains v2026-09-01 pls remove that tag from the footer as well"*, and
 *    *"footer to take no more than 2 lines pls"*.
 * 2. *"HW has O1,O2 type marking with Blooms tag, the tag can remain, but the O1 type objective
 *    tagging should be gone"*.
 *
 * THE FOOTER. v8.1 already moved `lesson_id`, `book_stem` and `schema_version` out of the page and
 * into the PDF Info dictionary on exactly this reasoning — *"isn't this an internal ref?"*. The
 * `provenance.version` date is the last survivor of that set: it is the date OUR author run stamped
 * the document, it tells a teacher nothing about her lesson, and it sat in the strip that prints on
 * every single page.
 *
 * And the strip was over two lines before the date was even counted. Since v9.3 the footer is
 * STACKED — `.fl` on one line, `.fr` under it — which is two lines only while each half fits the
 * 478px column. `.fl` reads "Grade 9 Mathematics · Ch. 1 · Matrices and Determinants — Matrices and
 * Determinants · pp. 24-25", where the chapter title is printed TWICE because `provenance.chapter`
 * already contains it, and wraps. So the fix is both halves: say the chapter once, and make each
 * half structurally incapable of wrapping. A `white-space:nowrap` block has exactly one line box
 * whatever string it holds, which is what "no more than 2 lines" has to mean for a strip whose
 * content is a chapter title of unknown length.
 *
 * THE HOMEWORK TAG. Each item carried `[<slo_code>, <level>]` — `[O1, U]` on her plan, `[M-09-A-07,
 * U]` on the gate fixture. The Bloom's level is for the teacher: it says what the question asks a
 * student to DO. The SLO code is a curriculum key, ours, and the same class of internal reference
 * the footer was cleared of. The level stays, the code goes, the marks are untouched.
 */

const fs = require('fs');
const path = require('path');

const { buildHtml } = require('../../bot/vendor/lp-v9/lib/template');

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const doc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

const out = (d = doc()) => buildHtml(d, { docDir: path.dirname(FIXTURE) }).html;

/** Everything inside `<body>` — so an assertion cannot be satisfied by the stylesheet. */
function body(html) {
  const i = html.indexOf('<body');
  return html.slice(html.indexOf('>', i) + 1, html.lastIndexOf('</body>'));
}

/** The emitted sheet, comments and font payloads stripped. */
function sheet(html) {
  const open = html.indexOf('<style>');
  return html
    .slice(open + 7, html.lastIndexOf('</style>'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/url\(data:[^)]*\)/g, 'url(data:)');
}

/** One rule's declaration body, by exact selector. */
function rule(css, selector) {
  const m = css.match(new RegExp(`(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  expect(m).not.toBeNull();
  return m[2];
}

/**
 * The inside of every element opened by `open`, as a string that still closes its own children.
 *
 * TWO TRAPS, both of which cost this suite a vacuous green before it caught anything. A run
 * ending `([\s\S]*?)</div></div>` stops at the FIRST `</div></div>`, which is the last child's
 * close followed by the parent's — so the capture holds every child but is missing that last
 * child's closing tag, and a per-child regex that requires one comes back `null`. Putting the
 * `</div>` back is the whole fix. And the class attribute is not what the source wrote: the
 * packer re-emits every block as `<div data-atom class="blk hw sp-2">`, so an exact-match
 * `class="blk hw"` finds nothing at all and every assertion over it filters an empty list.
 */
function elements(html, open) {
  return [...body(html).matchAll(new RegExp(`${open}([\\s\\S]*?)</div>\\s*</div>`, 'g'))].map((m) => `${m[1]}</div>`);
}

const text = (s) => s.replace(/<[^>]*>/g, '').replace(/&middot;/g, '·').replace(/&mdash;/g, '—').replace(/\s+/g, ' ').trim();

const FOOT = '<div class="foot">';
const HW = '<div[^>]*class="blk hw[^"]*"[^>]*>';

/** Every footer on the document, as `{ fl, fr }` of plain text. */
function footers(html) {
  return elements(html, FOOT).map((inner) => {
    const half = (cls) => {
      const h = inner.match(new RegExp(`<div class="${cls}">([\\s\\S]*?)</div>`));
      return h ? text(h[1]) : null;
    };
    return { fl: half('fl'), fr: half('fr') };
  });
}

/** Every homework item's tag, as plain text. */
function hwTags(html) {
  return elements(html, HW)
    .map((inner) => {
      const t = inner.match(/<span class="tag">([\s\S]*?)<\/span>/);
      return t ? text(t[1]) : null;
    })
    .filter(Boolean);
}

describe('the page footer', () => {
  test('prints no author-run version date', () => {
    const halves = footers(out()).flatMap((f) => [f.fl, f.fr]);
    // Guard the filter below: an extractor that returns nothing makes "no dates" vacuously true.
    expect(halves.filter(Boolean).length).toBe(halves.length);
    expect(halves.length).toBeGreaterThan(0);
    expect(halves.filter((s) => /v\d{4}-\d{2}-\d{2}/.test(s))).toEqual([]);
  });

  test('the document still carries the version — it moved off the page, it was not deleted', () => {
    // The date belongs in the PDF Info dictionary and <stem>.render.json, same as book_stem did.
    expect(doc().provenance.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('is two line boxes and cannot become three — neither half may wrap', () => {
    const css = sheet(out());
    for (const sel of ['.foot .fl', '.foot .fr']) {
      const decl = rule(css, sel);
      expect(decl).toMatch(/white-space:\s*nowrap/);
      // nowrap alone overflows the column; the strip has to clip, not run off the page edge.
      expect(decl).toMatch(/overflow:\s*hidden/);
      expect(decl).toMatch(/text-overflow:\s*ellipsis/);
    }
  });

  test('the footer holds exactly those two halves and nothing else', () => {
    // A third block is a third line however it is styled.
    const feet = elements(out(), FOOT);
    expect(feet.length).toBeGreaterThan(0);
    for (const inner of feet) expect(inner.match(/<div class="/g) || []).toHaveLength(2);
  });

  test('the chapter is named once, not twice', () => {
    // `provenance.chapter` already ends with the chapter title on every document the authors emit;
    // appending `chapter_title` to it printed "Ch. 1 · Matrices — Matrices" and is what pushed the
    // left half over the column.
    const { fl } = footers(out())[0];
    const title = doc().provenance.chapter_title;
    expect(fl).toContain(title);
    expect(fl.split(title)).toHaveLength(2);
  });

  test('a document whose chapter does NOT contain its title still prints the title', () => {
    const d = doc();
    d.provenance.chapter = 'Ch. 1';
    d.provenance.chapter_title = 'Matrices and Determinants';
    const { fl } = footers(out(d))[0];
    expect(fl).toContain('Ch. 1');
    expect(fl).toContain('Matrices and Determinants');
  });
});

describe('the homework item tag', () => {
  test('keeps the Bloom level', () => {
    const tags = hwTags(out());
    expect(tags.length).toBeGreaterThan(0);
    for (const t of tags) expect(t).toMatch(/^\[[KUA]\]/);
  });

  test('drops the SLO code — a curriculum key is not a teacher-facing label', () => {
    const codes = doc().sections.find((s) => s.id === 'homework').homework.items.map((i) => i.slo_code);
    expect(codes.filter(Boolean).length).toBeGreaterThan(0);
    const printed = hwTags(out()).join(' ');
    for (const code of codes) if (code) expect(printed).not.toContain(code);
  });

  test('the marks are untouched — they are the teacher\'s own weighting', () => {
    const items = doc().sections.find((s) => s.id === 'homework').homework.items;
    const marked = items.filter((i) => i.marks);
    expect(marked.length).toBeGreaterThan(0);
    const tags = hwTags(out());
    for (const it of marked) expect(tags[items.indexOf(it)]).toContain(String(it.marks));
  });
});
