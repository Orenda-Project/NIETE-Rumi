/**
 * bd-a8veu.21 — A TABLE PRIMITIVE, BECAUSE THE PLAN HAS NO WAY TO SAY "THESE N THINGS SHARE
 * THESE FIELDS" EXCEPT PROSE.
 *
 * Operator, on a 10-page grade-6 geography plan: *"i want the text to be in readable diagrams,
 * boxes or flow charts so that the LP can be reduced further in page number and is more readable
 * cz there is just so much text!"* — and, in the same breath, *"i wasnt asking you to cut
 * words"*. So the lever cannot be fewer words or smaller type. It has to be a denser SHAPE for
 * the same words.
 *
 * THE GAP. v3 defines fifteen block types — ask · board · chem · diagram · faded_example ·
 * key_points · keywords · latex · paragraph · practice · split · support_extension ·
 * textbook_figure · watch_out · worked_example — and not one of them is tabular. The 28-type
 * diagram engine has none either (`grid` is a maths grid, not a data table). An author holding N
 * cases that share the same attributes has exactly one option: one sentence per case, repeating
 * every attribute NAME inside every row. That is where the page count goes.
 *
 * THIS BLOCK'S HEADLINE NUMBER WAS WRONG TWICE, IN TWO DIFFERENT WAYS, AND BOTH WAYS WERE THE
 * SAME MISTAKE: THE TWO SIDES OF THE A/B WERE NOT COMPARABLE. Recorded here in full, because a
 * green assertion cannot catch either one.
 *
 *   Artefact 1 — UNEQUAL TYPE. The original A/B reported -42.5%, laying a 21px prose list against
 *   15px table cells. That is not a table beating prose, it is small type beating big type, which
 *   is the operator's veto in a different costume. It escaped notice because every font-size in
 *   the sheet is multiplied by TYPE_SCALE (1.1667) on the way out, and because the renderer's
 *   in-page type probe checks BODY_SEL / CHIP_SEL — neither of which matches `td` or `th`. A new
 *   block type can ship below the type floor in total silence; the type-floor test below is the
 *   only thing that now stands in the way.
 *
 *   Artefact 2 — UNEQUAL FACTS. The re-measurement at the floors reported -17.7% for 3 columns.
 *   That rig built its 3-column table by dropping the 'Trees' column off the 4-column one, while
 *   the prose baseline it was measured against still carried every tree list. The table was
 *   winning by holding less content — cutting words in a third costume.
 *
 * MEASURED AGAIN with the type equal AND the facts equal on both sides, through the real emitter
 * and the real emitted stylesheet, at the real 478px phone column, `emulateMedia('print')`:
 *
 *     the operator's own geography key-points, trees kept on BOTH sides
 *         prose 579.3px   table 565.1px    -2.5%   <- HEIGHT-NEUTRAL
 *
 *     same facts either way, varying only how long a cell is
 *         cells of 1-2 words       prose 384.0   table 289.1   -24.7%   <- the only real win
 *         cells of 3-4 words       prose 286.4   table 323.8   +13.1%
 *         sentence-length cells    prose 416.6   table 465.5   +11.7%
 *
 * SO THE TRIGGER IS CELL LENGTH, NOT CASE COUNT, and the mechanism is arithmetic: a row is as tall
 * as its tallest cell, so ONE cell that wraps costs the WHOLE row a line. Sweeping cell length at
 * this column width, a row holds one line up to:
 *
 *     3 columns   <= 14 characters per cell   (39.3px row; 16 chars -> 67.7px)
 *     2 columns   <= 24 characters per cell   (39.3px row; 26 chars -> 67.7px)
 *
 * THE BLOCK IS THEREFORE A READABILITY DEVICE (bd-a8veu item 11), NOT A PAGE-COUNT LEVER. It is
 * worth shipping because a comparison set as a grid is scanned rather than read — but the schema
 * says so in the author-facing text, and nothing here should be quoted as a page saving.
 *
 * The COLUMN cap is separately measured, and predates the fact-matching correction because both
 * sides of THAT comparison were 4 columns: at 478px a 4-column table is 728.9px against a 644.4px
 * prose list, +13.1%. Per-row heights say why — 4 columns wraps to [152.7, 152.7, 124.4, 152.7],
 * 3 columns to [96, 96, 96, 96]; a fourth column is ~119px wide and body-size text in 119px breaks
 * across four or five lines per row. Which is why the rejection test below is on a FOURTH column,
 * not a fifth.
 *
 * `table-layout:auto` was re-confirmed at the same body size (728.9 auto vs 785.6 fixed at 4
 * columns): the columns genuinely want different widths — a one-word TYPE column beside a
 * sentence-long WHERE column — so `auto` is a measured choice, not the default falling through,
 * and the test below pins it for that reason.
 *
 * THE CAPS ARE LOAD-BEARING, NOT COSMETIC. `blockAtoms` (template.js) has exactly ONE per-type
 * branch and it is `practice` — every other block is a single indivisible atom. A table
 * therefore CANNOT break across a page, and `.page` is `overflow:hidden`, so an over-tall table
 * is CLIPPED, not flowed. Hence a row cap as well as a column cap, and hence the two rejection
 * tests.
 *
 * v3 ONLY. `lp_doc.v2.schema.json` is frozen and read-only (validate.js says so in its own
 * header): the 2.0 corpus was authored before this block existed and can never contain one.
 *
 * Note on the rejection assertions — THE MESSAGE IS NOT ASSERTABLE HERE, so the tests assert the
 * BOUNDARY instead. Three different things mangle the error string, and all three are real:
 *   1. The root suite runs against `tests/__mocks__/ajv.js`, not ajv — ajv is a bot-only dependency
 *      and CI runs this suite before `bot/ npm ci`. The stub checks `oneOf` by running each branch
 *      into a throwaway array and reporting only `must match a schema in oneOf`, so the specific
 *      `maxItems` message never leaves it.
 *   2. `validateDoc` DROPS `oneOf` errors whenever there is more than one error — here there is
 *      exactly one, so the wrapper survives; relying on either behaviour would be brittle.
 *   3. The bot runs real Ajv 6, which reports `dataPath`; `validateDoc` reads `instancePath`, gets
 *      `undefined`, and falls back to "/", so under the bot the message is path-less.
 * What IS stable is the boundary: N passes and N+1 fails. Each rejection test below therefore
 * pairs the accepted maximum with the first rejected value, which pins the cap itself rather than
 * a string that three layers are free to rewrite.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));
const { validateDoc } = require(path.join(VENDOR, 'lib', 'validate'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(FIXTURE, 'utf8');
const load = () => JSON.parse(raw);

/** The operator's own page-3 content, decomposed into the three attributes her prose repeated. */
const TABLE = {
  type: 'table',
  columns: ['Type', 'Climate', 'Where'],
  rows: [
    ['Tropical', 'Hot & wet all year', 'Amazon, Congo'],
    ['Temperate', 'Four **seasons**', 'Europe, north China'],
    ['Boreal', 'Long cold winter', 'Siberia, Canada'],
  ],
};

/** A table lives in a section's block flow like any other block. */
const withTable = (over) => {
  const d = load();
  d.sections[1].blocks.push(Object.assign({}, TABLE, over || {}));
  return d;
};

const build = (doc, lang) => buildHtml(doc, { docDir: path.dirname(FIXTURE), lang: lang || 'en' }).html;

/** The stylesheet, with the base64 font payloads knocked out — the faces are megabytes each. */
const sheet = (html) =>
  html.slice(0, html.lastIndexOf('</style>')).replace(/url\(data:[^)]*\)/g, 'url(data:)');

/** The document body — everything after the sheet, so a CSS string never satisfies a body test. */
const body = (html) => html.slice(html.lastIndexOf('</style>') + 8);

/** The first rendered table element, markup only. */
const table = (html) => {
  const m = /<table class="tbl">[\s\S]*?<\/table>/.exec(body(html));
  return m ? m[0] : '';
};

const count = (s, re) => (s.match(re) || []).length;

// ── the document accepts one ────────────────────────────────────────────────

describe('the schema', () => {
  test('accepts a table block', () => {
    const r = validateDoc(withTable());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test('accepts it with a title, and with an explicitly empty one', () => {
    expect(validateDoc(withTable({ title: 'Forest types' })).ok).toBe(true);
    expect(validateDoc(withTable({ title: '' })).ok).toBe(true);
  });

  test('rejects a fourth column — measured at +13.1%, worse than the prose it replaces', () => {
    // Not a style preference and not a safety margin: 728.9px against a 644.4px prose list, on
    // the operator's own content, at the same type size. A 4-column table is a regression.
    const three = validateDoc(
      withTable({ columns: ['Type', 'Climate', 'Where'], rows: [['Tropical', 'Hot', 'Amazon']] })
    );
    expect(three.errors).toEqual([]);

    const four = validateDoc(
      withTable({
        columns: ['Type', 'Climate', 'Where', 'Trees'],
        rows: [['Tropical', 'Hot', 'Amazon', 'Tall']],
      })
    );
    expect(four.ok).toBe(false);
    expect(four.errors.join(' ')).toContain('/sections/1/blocks/');
  });

  test('rejects a seventh row — a table cannot break across a page, so it would be clipped', () => {
    const row = ['Tropical', 'Hot & wet', 'Amazon'];
    const six = [row, row, row, row, row, row];
    expect(validateDoc(withTable({ rows: six })).errors).toEqual([]);

    const seven = validateDoc(withTable({ rows: six.concat([row]) }));
    expect(seven.ok).toBe(false);
    expect(seven.errors.join(' ')).toContain('/sections/1/blocks/');
  });

  test('rejects a stray property, like every other block', () => {
    const r = validateDoc(withTable({ caption: 'Forest types' }));
    expect(r.ok).toBe(false);
  });
});

// ── the renderer paints one ─────────────────────────────────────────────────

describe('the rendered table', () => {
  test('is one <th> per column and one body <tr> per row', () => {
    const t = table(build(withTable()));
    expect(t).not.toBe('');
    expect(count(t, /<th>/g)).toBe(3);
    expect(count(t, /<tr>/g)).toBe(4); // the header row plus three body rows
    expect(count(t, /<td>/g)).toBe(9);
  });

  test('cells go through rich() — markup renders, and the text is escaped', () => {
    const t = table(build(withTable()));
    expect(t).toContain('<b>seasons</b>');
    expect(t).toContain('Hot &amp; wet all year');
    expect(t).not.toContain('**seasons**');
  });

  test('a ragged row is padded, not dropped', () => {
    // The author is a language model. A short row must cost an empty cell, never a lost row or
    // a column shunted one place left for the rest of the table.
    const d = withTable({
      rows: [
        ['Tropical', 'Hot & wet', 'Amazon'],
        ['Boreal', 'Long cold winter'],
      ],
    });
    const t = table(build(d));
    expect(count(t, /<tr>/g)).toBe(3);
    expect(count(t, /<td>/g)).toBe(6);
    expect(t).toContain('Long cold winter');
  });

  test('a title prints as a section label; no title prints none', () => {
    const withLabel = body(build(withTable({ title: 'Forest types' })));
    expect(withLabel).toContain('<div class="lbl g">Forest types</div>');
    // No title, no label row: the column headers already say what each column is, so an
    // untitled table costs no extra line.
    const withoutLabel = body(build(withTable()));
    expect(count(withoutLabel, /<div class="lbl g">/g)).toBe(
      count(withLabel, /<div class="lbl g">/g) - 1
    );
    // And an explicit "" is the same as none — the key_points convention, kept.
    expect(count(body(build(withTable({ title: '' }))), /<div class="lbl g">/g)).toBe(
      count(withoutLabel, /<div class="lbl g">/g)
    );
  });
});

// ── the stylesheet carries the measured shape ───────────────────────────────

describe('the .tbl rules', () => {
  test('are in the emitted sheet at all', () => {
    expect(sheet(build(withTable()))).toContain('.tbl');
  });

  test('use table-layout:auto — the measured winner, 728.9px against 785.6px fixed', () => {
    const s = sheet(build(withTable()));
    const rule = /\.tbl\{[^}]*\}/.exec(s);
    expect(rule).not.toBeNull();
    expect(rule[0].replace(/\s/g, '')).toContain('table-layout:auto');
  });

  test('set cells at the body size and headers at the chip size — the two type floors', () => {
    // The whole point of the re-measurement. `scaledPx` multiplies every source size by 1.1667,
    // so 18px emits at 21px = BODY_FLOOR_PX and 14px at 16.33px = CHIP_FLOOR_PX. The renderer's
    // probe does NOT police td/th — BODY_SEL and CHIP_SEL match neither — so this assertion is
    // the only thing standing between a future edit and a silently sub-floor table.
    const s = sheet(build(withTable())).replace(/\n/g, ' ');
    expect(/\.tbl td\{[^}]*font-size:21px/.test(s)).toBe(true);
    expect(/\.tbl th\{[^}]*font-size:16\.33px/.test(s)).toBe(true);
  });

  test('align cells to the start edge, so RTL mirrors', () => {
    const en = sheet(build(withTable(), 'en'));
    const ur = sheet(build(withTable(), 'ur'));
    expect(/\.tbl th\{[^}]*text-align:left/.test(en.replace(/\n/g, ''))).toBe(true);
    expect(/\.tbl th\{[^}]*text-align:right/.test(ur.replace(/\n/g, ''))).toBe(true);
  });
});
