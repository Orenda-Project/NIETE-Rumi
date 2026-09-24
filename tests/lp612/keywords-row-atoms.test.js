/**
 * bd-2hmag part B — THE KEY WORDS GLOSSARY, ONE ATOM PER ROW.
 *
 * THE DEFECT, MEASURED. On `g1_ch8_Maths_seg4` page 1 ended after the VIDEO RESOURCE card at 57%
 * fill and page 2 opened with the whole six-row glossary — ~780px emitted as ONE atom, which could
 * not fit the ~1000px page 1 had left, so it moved whole and left the hole. `packAtoms` is an
 * exact DP and cannot put half a block in a hole when there is no half block.
 *
 * WHICH PATH. There are two renderings of the same `keywords` block:
 *   • `keywords` (the in-flow `.blk` emitter, `.kwrow` of inline `.kw` spans) — on a PRIMARY plan
 *     `sectionAtoms` drops the introduction's keywords block, so this path never paints there;
 *     on G6-12 it paints INSIDE the one resources-card atom. Neither is the tall page-2 block.
 *   • `kwTable` (`.rkw > .kwtab`, hoisted into page 1's set-up furniture) — this IS the block in
 *     the render. It is the one split here.
 *
 * THE SHAPE IS THE ONE FOUR OTHER BLOCKS ALREADY USE (see atom-granularity.test.js): one atom per
 * row, `pc-a` / `pc-m` / `pc-z` seam classes with the pieces butting at sp-0 so N pieces paint as
 * one box, the KEY WORDS label and its key icon riding row 1 so a page never opens on a bare
 * definition, and EVERY seam `soft` — never `glue`, which forbids the break outright and measured
 * at +7 pages over the corpus when it was misapplied.
 *
 * WHAT MAY NOT BE CUT, and is pinned here: every authored term and every authored definition is
 * re-emitted verbatim, in authored order, in N wrappers instead of one. Row i of the split is
 * byte-identical to the row the unsplit table draws for the same item, which is what the last
 * describe block proves item by item.
 *
 * AND THE UNSPLIT CASE IS TODAY'S BYTES. A glossary of one row takes no seam classes, no inline
 * track and no extra atom: `<div class="rescard"><div class="rkw">…` exactly as before.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
/** The same fixture re-provenanced to grade 4 — the one thing `isPrimary` reads. */
const primaryDoc = () => {
  const d = baseDoc();
  d.provenance = { ...d.provenance, grade: 4, subject: 'English' };
  return d;
};

const built = (d) => buildHtml(d, { lang: 'en', docDir: path.dirname(FIXTURE) });

/** Every packed atom, with the class the packer sees and the markup it owns. */
function atoms(d) {
  const r = built(d);
  const body = r.html.split('</style>').pop();
  const hits = [...body.matchAll(/<[a-z]+ data-atom[^>]*class="([^"]*)"/g)];
  return r.atoms.teach.map((a, i) => {
    const next = hits[i + 1];
    return {
      ...a,
      cls: hits[i][1],
      html: body.slice(hits[i].index, next ? next.index : body.length),
    };
  });
}

/** The atoms that carry the hoisted glossary — the `.rkw` row of the set-up furniture. */
const kwAtoms = (d) => atoms(d).filter((a) => /class="rkw"/.test(a.html));
const bare = (cls) => cls.replace(/\s*\bsp-\d\b/, '');

const WORDS = [
  ['mass', 'Mass (or weight) is how heavy something is.'],
  ['lighter', 'Lighter means one thing weighs LESS than another.'],
  ['lightest', 'Lightest means, out of three or more, this one weighs the LEAST.'],
  ['heavier', 'Heavier means one thing weighs MORE than another.'],
  ['heaviest', 'Heaviest means, out of three or more, this one weighs the MOST.'],
  ['balance scale', 'A balance scale is a tool with two pans.'],
];

/** Re-author the introduction's keywords block, which is the one the primary layout hoists. */
const setItems = (d, items) => {
  for (const s of d.sections) for (const b of s.blocks || []) if (b.type === 'keywords') b.items = items;
  return d;
};
/** ...with exactly `n` of the rows above. */
const glossary = (d, n) => setItems(d, WORDS.slice(0, n).map(([word, meaning]) => ({ word, meaning })));

/** The `.kr` rows a fragment prints, in order and verbatim. */
const rows = (html) => html.match(/<div class="kr">.*?<\/div><\/div>/g) || [];
const allRows = (a) => a.flatMap((x) => rows(x.html));

/** The first (term) track of the inline `grid-template-columns` the pieces share. */
const trackOf = (a) => {
  const t = (a[0].html.match(/grid-template-columns:([^"]*)"/) || [])[1];
  return t == null ? null : t.slice(0, t.lastIndexOf(' minmax(0, 1fr)'));
};
const track = (n) => trackOf(kwAtoms(glossary(primaryDoc(), n)));
const floor = (n) => { const m = (track(n) || '').match(/min\(45%, ([\d.]+)px\)/); return m && +m[1]; };
/** The floor a one-word glossary of `w` produces — the estimator's output, read off the markup. */
function width(w) {
  const d = setItems(primaryDoc(), [{ word: w, meaning: 'x' }, { word: '', meaning: 'y' }]);
  return +(trackOf(kwAtoms(d)).match(/min\(45%, ([\d.]+)px\)/) || [])[1];
}

// ── 1. ONE ATOM PER ROW ─────────────────────────────────────────────────────
describe('the hoisted glossary is one atom per term/definition row', () => {
  test('a six-row glossary is six atoms, in authored order', () => {
    const a = kwAtoms(glossary(primaryDoc(), 6));
    expect(a).toHaveLength(6);
    expect(a.map((x) => bare(x.cls))).toEqual([
      'rescard pc pc-a',
      ...Array(4).fill('rescard pc pc-m'),
      'rescard pc pc-z',
    ]);
    expect(a.map((x) => rows(x.html).length)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(allRows(a).map((r) => (r.match(/<b>(.*?)<\/b>/) || [])[1]))
      .toEqual(WORDS.map(([w]) => w));
  });

  test('a two-row glossary — the gate — is two atoms', () => {
    expect(kwAtoms(glossary(primaryDoc(), 2))).toHaveLength(2);
  });

  test('a one-row glossary stays ONE atom, with no seam classes', () => {
    const a = kwAtoms(glossary(primaryDoc(), 1));
    expect(a).toHaveLength(1);
    expect(a[0].cls).toBe('rescard sp-1');
    expect(a[0].html).not.toContain('pc-');
  });
});

// ── 2. THE LABEL NEVER ORPHANS ──────────────────────────────────────────────
describe('KEY WORDS rides row 1', () => {
  test('the label and its key icon are in the first atom and nowhere else', () => {
    const a = kwAtoms(glossary(primaryDoc(), 6));
    expect(a[0].html).toContain('<span class="lbl">Key words</span>');
    expect(a[0].html).toContain('&#128273;');
    expect(a[0].html).toContain('<b>mass</b>');
    for (const x of a.slice(1)) {
      expect(x.html).not.toContain('class="lbl"');
      expect(x.html).not.toContain('&#128273;');
    }
  });

  test('the label is printed exactly once across the whole plan', () => {
    const h = built(glossary(primaryDoc(), 6)).html.split('</style>').pop();
    expect((h.match(/<span class="lbl">Key words<\/span>/g) || [])).toHaveLength(1);
  });
});

// ── 3. EVERY SEAM IS SOFT, NONE IS GLUE ─────────────────────────────────────
describe('the new seams are soft costs, never forbidden breaks', () => {
  test('no piece forbids the break after it', () => {
    expect(kwAtoms(glossary(primaryDoc(), 6)).map((x) => x.glue))
      .toEqual(Array(6).fill(false));
  });

  test('every piece but the last charges the packer a `splits` cost', () => {
    expect(kwAtoms(glossary(primaryDoc(), 6)).map((x) => x.soft))
      .toEqual([true, true, true, true, true, false]);
  });

  test('the pieces butt at sp-0, so N pieces measure as the one box they draw', () => {
    expect(kwAtoms(glossary(primaryDoc(), 6)).map((x) => (x.cls.match(/\bsp-\d\b/) || [])[0]))
      .toEqual(['sp-1', 'sp-0', 'sp-0', 'sp-0', 'sp-0', 'sp-0']);
  });
});

// ── 4. NOTHING IS CUT ───────────────────────────────────────────────────────
describe('the split re-emits every authored word, verbatim', () => {
  test('row i of the split is byte-identical to the row the unsplit table draws', () => {
    // One doc per row, each with a glossary of exactly that one row: its `.kr` is the unsplit
    // rendering of that item, and it is compared against the same item inside the six-way split.
    const split = allRows(kwAtoms(glossary(primaryDoc(), 6)));
    expect(split).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      const one = setItems(primaryDoc(), [{ word: WORDS[i][0], meaning: WORDS[i][1] }]);
      const whole = rows(kwAtoms(one)[0].html);
      expect(whole).toHaveLength(1);
      expect(split[i]).toBe(whole[0]);
    }
  });

  test('every term and every definition prints exactly once in the plan', () => {
    const h = built(glossary(primaryDoc(), 6)).html.split('</style>').pop();
    for (const [word, meaning] of WORDS) {
      expect((h.match(new RegExp(`<b>${word}</b>`, 'g')) || [])).toHaveLength(1);
      expect((h.match(new RegExp(`<span>${meaning.replace(/[.()]/g, '\\$&')}</span>`, 'g')) || []))
        .toHaveLength(1);
    }
  });
});

// ── 5. IT PAINTS AS ONE TABLE ───────────────────────────────────────────────
describe('the pieces paint as one continuous table', () => {
  test('the seam classes and the stylesheet rules that open the two boxes both exist', () => {
    const css = built(glossary(primaryDoc(), 6)).html.split('</style>')[0];
    // the .rkw surface
    expect(css).toContain('.pri .rescard.pc-a > .rkw');
    expect(css).toContain('.pri .rescard.pc-z > .rkw');
    // ...and the .kwtab inside it, which is the second box a naive split would restart
    expect(css).toContain('.pri .rescard.pc-m > .rkw .kwtab');
    // the hairline a continuation row would otherwise lose to :first-child
    expect(/\.kr:first-child > \*\{ border-top:1px/.test(css)).toBe(true);
    // and the dashed edge where a page break actually cut it
    expect(css).toContain('border-bottom:2px dashed var(--s-quiet-ink)');
  });

  test('every piece shares ONE term-column track, so the grey column cannot go ragged', () => {
    const a = kwAtoms(glossary(primaryDoc(), 6));
    const tracks = a.map((x) => (x.html.match(/grid-template-columns:([^"]*)"/) || [])[1]);
    expect(tracks.filter(Boolean)).toHaveLength(6);
    expect(new Set(tracks).size).toBe(1);
  });

  test('the shared track is a fixed length — the two near-misses both painted wrong', () => {
    // `minmax(floor, fit-content(45%))` is INVALID CSS (fit-content() cannot appear inside
    // minmax()); Chrome drops the whole declaration with no console error and every grid falls
    // back to the per-grid stylesheet rule — ragged column, markup still looks right.
    // `minmax(floor, 45%)` is valid and still wrong: grid maximises tracks to their growth limit
    // before expanding the 1fr track, so all six sat at the 45% cap, the meaning column lost 13%
    // and the render grew a page. Neither shows up in a "do the pieces agree" assertion, so the
    // shape itself is pinned.
    expect(floor(6)).not.toBeNull();
    expect(track(6)).toBe(`minmax(min(45%, ${floor(6)}px), max-content)`);
    expect(track(6)).not.toContain('fit-content');
  });

  test('the growth limit is max-content, so a bad estimate can never wrap a term', () => {
    // The floor is estimated without a browser, so it WILL be wrong somewhere. `max-content` as
    // the growth limit decides which way it is wrong: a term wider than the floor takes its own
    // width (that one row goes ragged) instead of wrapping onto a second line. A fixed track
    // wraps, and a wrapped Nastaliq term is a real defect, not a cosmetic one.
    expect(track(6)).toMatch(/^minmax\(min\(45%, [\d.]+px\), max-content\)$/);
  });

  test('Nastaliq is estimated as the narrow, ligatured script it is', () => {
    // Measured off the Urdu render: the six terms of g1_ch8 Urdu_seg6 run 0.33-0.57em per
    // character, because Nastaliq joins — the word is far narrower than the sum of its isolated
    // glyphs. The first version charged 1em a character, put the floor at 202.5px where the real
    // column was 116px, took 26% off the meaning column and cost that lesson a WHOLE EXTRA PAGE
    // (15 -> 16). So the non-ASCII rate is pinned between the two Latin buckets that bracket it.
    const SEVEN_UR = 'ابجدہوز';
    expect(width(SEVEN_UR)).toBeLessThan(width('abcdefg'));
    expect(width(SEVEN_UR)).toBeGreaterThan(width('iiiiiii'));
  });

  test('the floor is a measured px width, not a `ch` count', () => {
    // `ch` is the advance of "0", which is far wider than the average lowercase letter: on the
    // proof case it put the floor 35px over the real max-content, the meaning column lost 13% of
    // its width, the definitions re-wrapped and the render came back a page LONGER. A fix that
    // fills a page by adding one is not a fix, so the floor is estimated from the glyphs.
    expect(track(6)).not.toContain('ch');
    expect(track(6)).not.toContain('calc(');
  });

  test('the floor follows the glyphs, not the character count', () => {
    // Same length, different widths: "mmmmmm" is nearly three times "iiiiii" in any humanist
    // sans, and a per-character count cannot tell them apart. If these two ever come out equal
    // the estimator has been flattened back into a character count.
    expect(width('mmmmmm')).toBeGreaterThan(width('iiiiii') * 2);
    // ...and it is monotone in the longest term, which is the one the column has to hold.
    expect(width('balance scales')).toBeGreaterThan(width('balance scale'));
  });

  test('the floor is estimated for the LONGEST term, and only that one', () => {
    const d = setItems(primaryDoc(), [{ word: 'ox', meaning: 'a' }, { word: 'hippopotamus', meaning: 'b' }]);
    expect(trackOf(kwAtoms(d))).toBe(`minmax(min(45%, ${width('hippopotamus')}px), max-content)`);
  });
});

// ── 6. G6-12 AND THE UNSPLIT CASE ARE TODAY'S BYTES ─────────────────────────
describe('nothing else moves', () => {
  test('G6-12 keeps its ONE resources-card atom, glossary and all', () => {
    const a = atoms(baseDoc()).filter((x) => /class="rescard"/.test(x.cls) || /rescard/.test(x.cls));
    expect(a).toHaveLength(1);
    expect(a[0].cls).toBe('rescard sp-2');
    expect(a[0].html).toContain('Key words');
    expect(a[0].html).not.toContain('pc-a');
  });

  test('an unsplit primary glossary emits no seam class and no inline track', () => {
    const a = kwAtoms(glossary(primaryDoc(), 1));
    expect(a[0].html).not.toContain('grid-template-columns');
    expect(a[0].html).toContain('<div class="kwtab">');
  });

  test('a plan with NO keywords block is untouched — the row is simply absent', () => {
    const d = primaryDoc();
    for (const s of d.sections) s.blocks = (s.blocks || []).filter((b) => b.type !== 'keywords');
    expect(kwAtoms(d)).toHaveLength(0);
  });
});
