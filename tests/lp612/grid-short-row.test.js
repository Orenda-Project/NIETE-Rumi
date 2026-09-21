/**
 * A card group fills the width it reserves (bd-ip4xh).
 *
 * Operator, on the G4 English Ch.9 render: *"materials should be indented bullets that go
 * from left to right, no blank spaces"* -- and, of A4 p7 and p13, the same complaint in a
 * new place. The mistakes box and each differentiation card printed in a narrow left
 * column with two thirds of the page blank beside them.
 *
 * THE CAUSE IS NOT CSS, IT IS THE ATOM SHAPE. `groupAtoms` emitted ONE CARD PER ATOM and
 * wrapped each one in its own `.grid3` -- a three-column grid holding a single card, so the
 * card took a third of the measure and the other two thirds printed blank. Three
 * differentiation cards meant three near-empty rows, not one full one.
 *
 * That shape is right on the PHONE, where `PAGE.oneColumn` makes `.grid3` a single column
 * and a card IS a row; a break may never fall inside a row, so three cards in one atom
 * would force all three onto a fresh page. It is wrong on A4, where a row holds three. So
 * the rule is the one `gridRows` already documents for the support page: pack the row, and
 * let the atom be the ROW rather than the card.
 *
 * ONE ROW SHORT OF ITS COLUMNS still leaves a gap -- a single mistake card in a row of
 * three. When a group is one row and that row is short, the grid sizes its columns to the
 * cards it actually holds. A MULTI-row group keeps the fixed three, because a trailing card
 * stretched to full width beside full rows above it breaks the column rhythm that makes a
 * grid readable.
 *
 * NOT ADDITIVE, and this is the honest part: G6-12 renders through the same `groupAtoms`,
 * so a grade-9 A4 body changes here too. Its three mistake cards stop printing as three
 * one-third-width rows and become one full row. That is the same defect being fixed, not a
 * side effect of a primary change.
 */
const fs = require("fs");
const path = require("path");

const VENDOR = path.join(__dirname, "..", "..", "bot", "vendor", "lp-v9");
const T = require(path.join(VENDOR, "lib", "template"));
const { buildHtml, setPageFormat } = T;

const FIXTURE = path.join(__dirname, "__fixtures__", "v9_gate_base.lp.json");
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
// `buildHtml` calls setPageFormat(opts.format || "phone") itself, so the format rides the
// options here; calling setPageFormat first would be overwritten before the sheet is built.
const build = (d, opts = {}) => buildHtml(d, { docDir: path.dirname(FIXTURE), lang: "en", ...opts }).html;
const a4 = (d) => build(d, { format: "a4" });
const body = (html) => html.split("</style>").pop();
const sheet = (html) => html.split("<style>")[1].split("</style>")[0];

afterEach(() => setPageFormat("phone"));

/** Every `.grid3` in the body, as {cls, cards} -- cls is the full class attribute. */
const grids = (html) => {
  const out = [];
  const re = /<div (?:data-atom )?class="((?:[^"]*\s)?grid3(?:\s[^"]*)?)"\s*>/g;
  const b = body(html);
  let m;
  while ((m = re.exec(b))) {
    const from = m.index + m[0].length;
    const next = b.indexOf('class="grid', from);
    const seg = b.slice(from, next < 0 ? b.length : next);
    out.push({ cls: m[1], cards: (seg.match(/class="(?:mis|card)"/g) || []).length });
  }
  return out;
};

const withMistakes = (n) => {
  const d = baseDoc();
  // Differentiation renders through the SAME group, so leaving it in would put its cards in
  // the counts below and stop these assertions being about one group.
  delete d.page2.differentiation;
  d.page2.mistakes = Array.from({ length: n }, (_, i) => ({
    pupil_says: `wrong answer ${i + 1}`, you_ask: `the question back ${i + 1}`,
  }));
  return d;
};

const misGrids = (html) => grids(html).filter((g) => g.cards > 0);

// ── A4: the atom is the row, not the card ────────────────────────────────────

describe("on A4 a card group packs its row", () => {
  test("three mistake cards ride ONE grid, not three", () => {
    const got = misGrids(a4(withMistakes(3)));
    const three = got.filter((g) => g.cards === 3);
    expect(three.length).toBeGreaterThan(0);
    expect(got.some((g) => g.cards === 1 && /n1/.test(g.cls))).toBe(false);
  });

  test("a group of one sizes its grid to one column", () => {
    const got = misGrids(a4(withMistakes(1)));
    expect(got.length).toBeGreaterThan(0);
    expect(got[0].cards).toBe(1);
    expect(got[0].cls).toMatch(/\bn1\b/);
  });

  test("a group of two sizes its grid to two columns", () => {
    const got = misGrids(a4(withMistakes(2)));
    expect(got[0].cards).toBe(2);
    expect(got[0].cls).toMatch(/\bn2\b/);
  });

  test("a multi-row group keeps the fixed three columns, trailing row included", () => {
    const got = misGrids(a4(withMistakes(4)));
    expect(got.map((g) => g.cards)).toEqual(expect.arrayContaining([3, 1]));
    expect(got.every((g) => !/\bn[12]\b/.test(g.cls))).toBe(true);
  });

  test("the group label still rides the first row, so a page never opens on a bare card", () => {
    const b = body(a4(withMistakes(3)));
    expect(b).toMatch(/<div class="lbl g">Common mistakes[^<]*<\/div><div class="grid3/);
  });
});

// ── the phone is untouched: one card per atom, no sizing class ───────────────

describe("the phone page keeps one card per atom", () => {
  test("three cards are three atoms and none is width-classed", () => {
    const got = misGrids(build(withMistakes(3)));
    expect(got.map((g) => g.cards)).toEqual([1, 1, 1]);
    expect(got.every((g) => !/\bn[12]\b/.test(g.cls))).toBe(true);
  });

  test("a lone card carries no sizing class either -- oneColumn already fills the measure", () => {
    const got = misGrids(build(withMistakes(1)));
    expect(got[0].cards).toBe(1);
    expect(got[0].cls).not.toMatch(/\bn1\b/);
  });
});

// ── the stylesheet carries the two rules, on the ladder ──────────────────────

test("the sheet sizes n1 and n2 and nothing else", () => {
  const css = sheet(a4(withMistakes(1)));
  expect(css).toMatch(/\.grid3\.n1[^{]*\{[^}]*grid-template-columns:\s*1fr\s*;/);
  expect(css).toMatch(/\.grid3\.n2\s*\{[^}]*grid-template-columns:\s*1fr 1fr\s*;/);
  expect(css).not.toMatch(/\.grid3\.n3\b/);
});
