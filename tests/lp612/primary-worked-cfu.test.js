/**
 * The worked example closes on a check.
 *
 * Operator's page map: *"worked example should be better formatted ending with a CFU
 * like usual"*.
 *
 * The check already exists. Primary Stage-C authors `generated.cfuExplain` -- an
 * instruction to the teacher, "ask for the clue, not the word" -- and today D0 files it as
 * a stand-alone `ask` block in the CONCLUSION, which prints it pages after the modelling it
 * checks. Her map lists no CFU in the close. So this is a RELOCATION, not a second surface:
 * ONE HOME PER SOURCE FIELD, and the home is the box whose work it checks.
 *
 * WHY A FIELD AND NOT A SIXTEENTH SCRIPT TURN. A `kind:"ask"` turn appended to `turns`
 * would be separated from turn 15 by the 2px gap `.scr` draws, so it reads as one more
 * line of speech rather than as the box's closing question. A field also survives the
 * `.exq` split-card idiom (SYNC 3.18): it travels in `pc-z` with the result, so a box that
 * breaks over a page still closes on its check.
 *
 * ADDITIVE, so G6-12 is untouched BY CONSTRUCTION -- the `d0_diagram.py` precedent. No
 * G6-12 document carries `cfu`, and the grade-9 gate fixture below is the control that
 * says its bytes do not move.
 */
const fs = require("fs");
const path = require("path");

const VENDOR = path.join(__dirname, "..", "..", "bot", "vendor", "lp-v9");
const T = require(path.join(VENDOR, "lib", "template"));
const { buildHtml, setPageFormat } = T;

const FIXTURE = path.join(__dirname, "__fixtures__", "v9_gate_base.lp.json");
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
const built = (d, opts = {}) => buildHtml(d, { docDir: path.dirname(FIXTURE), lang: "en", ...opts });
const build = (d, opts = {}) => built(d, opts).html;
const sheet = (html) => html.split("<style>")[1].split("</style>")[0];

afterEach(() => setPageFormat("phone"));

const ASK = "Which apostrophe job is this, and how do you know?";

/** The worked example in the gate fixture: development, id `ido`, five flat steps. */
const ido = (doc) => doc.sections.find((s) => s.id === "development")
  .blocks.find((b) => b.id === "ido");

/** Everything the renderer emitted for one atom, from its root to the next atom root. */
const atomOf = (html, cls) => {
  const re = new RegExp(`<div[^>]*class="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"[^>]*>`);
  const at = html.search(re);
  if (at < 0) return "";
  const next = html.indexOf("data-atom", html.indexOf("data-atom", at) + 1);
  return html.slice(at, next < 0 ? html.length : next);
};

const withCfu = () => {
  const d = baseDoc();
  ido(d).cfu = ASK;
  return d;
};

// ── the surface ───────────────────────────────────────────────────────────────

test("the check prints inside the worked example, as its closing row", () => {
  const box = atomOf(build(withCfu()), "exq");
  expect(box).toContain(ASK);
  expect(box).toMatch(/<div class="cfu">/);
});

test("it is labelled with the label the teacher already reads on this exact string", () => {
  // `L.askPlain` -- "Ask this" / "یہ سوال پوچھیں". `cfuExplain` prints under that label
  // today, in the conclusion's `ask` block. Moving the string must not move its name, and
  // reusing the label means Urdu needs no new entry in the overlay table.
  expect(atomOf(build(withCfu()), "exq"))
    .toMatch(/<div class="cfu"><span class="cl">Ask this<\/span>/);
});

test("the check comes after the result, so the box ends on the question", () => {
  const box = atomOf(build(withCfu()), "exq");
  expect(box.indexOf('class="cfu"')).toBeGreaterThan(box.indexOf('class="res"'));
});

test("a worked example with no check prints exactly what it printed before", () => {
  expect(build(baseDoc())).toBe(build(baseDoc()));
  expect(build(baseDoc())).not.toContain('class="cfu"');
});

// ── the split card: the check travels with the close ──────────────────────────

const split = () => {
  const d = baseDoc();
  const b = ido(d);
  // Four turns is where `blockAtoms` first splits an example (SYNC 3.18).
  b.turns = [
    { kind: "say", text: "Look at the pair on the board." },
    { kind: "ask", text: "Who owns the ball?" },
    { kind: "do", text: "Underline the owner." },
    { kind: "say", text: "Now write the apostrophe and the s." },
  ];
  b.cfu = ASK;
  return d;
};

test("when the box breaks over a page, the check rides in the closing piece", () => {
  const html = build(split());
  const pieces = html.match(/<div[^>]*class="[^"]*\bpc-[amz]\b[^"]*"[^>]*>[\s\S]*?(?=<div data-atom|$)/g) || [];
  expect(pieces.length).toBeGreaterThan(1);
  const holders = pieces.filter((p) => p.includes('class="cfu"'));
  expect(holders).toHaveLength(1);
  expect(holders[0]).toMatch(/\bpc-z\b/);
});

test("the closing piece still closes on the check, not on the result", () => {
  const html = build(split());
  const z = html.slice(html.search(/<div[^>]*class="[^"]*\bpc-z\b/));
  expect(z.indexOf('class="cfu"')).toBeGreaterThan(z.indexOf('class="res"'));
});

// ── the ladder ────────────────────────────────────────────────────────────────

test("the closing rule is drawn from the surface tokens, never a hex", () => {
  // `surface-ladder.test.js` says this for the whole sheet. Said here too, because the
  // seam between a check and the work above it is exactly where a stray hex gets typed.
  const css = sheet(build(withCfu()));
  const rules = css.match(/\.cfu\b[^{]*\{[^}]*\}/g) || [];
  expect(rules.length).toBeGreaterThan(0);
  for (const r of rules) {
    expect(r).not.toMatch(/border[^;]*#[0-9a-fA-F]{3,8}/);
    const radii = r.match(/border-radius:([^;}]+)/g) || [];
    for (const d of radii) expect(d).toMatch(/var\(--r-(?:1|2|pill)\)|0|50%/);
  }
});

// ── G6-12 is untouched by construction ─────────────────────────────────

/**
 * MARKUP, not the whole file. The stylesheet is one string shared by every document, so a
 * new rule lands in a G6-12 render too -- and that is the point of a rule that matches
 * nothing there. What must not move is the BODY, and these two digests were taken from the
 * renderer as it stood BEFORE `cfu` existed.
 *
 * A digest, not a golden file: a 1.8MB snapshot gets re-blessed without anyone reading the
 * diff. If one of these ever fails, the honest response is to explain the diff, not to
 * paste in the new hash. (They are taken under THIS runner -- `tests/jest.config.js` maps
 * several bot-only modules to stubs, so a raw `node` build hashes differently.)
 */
//
// THE A4 DIGEST MOVED ONCE, on 2026-09-18, and this is the explanation the rule above asks
// for. bd-ip4xh changed `groupAtoms` to emit one ROW per atom instead of one CARD per atom,
// so on A4 the three mistake cards and the three differentiation cards each collapse from
// three single-card `.grid3` atoms into one full three-card row. Diffed line by line: the
// ONLY changes are those two wrappers. No word, no label, no other class moved, and the
// PHONE digest below is unchanged to the byte -- `PAGE.oneColumn` already made a row a card
// there. Nothing to do with `cfu`, which is still what this file exists to guard.
//
// BOTH DIGESTS MOVED ON 2026-09-23, and this is that explanation. bd-p5418 moved the page/
// minutes locator out of the meta column and onto the kicker's own line, inside a new
// `.hero .h-top` row -- operator: *"the header caption containing the page numbr and minutes
// of the class can be on the right ... save space Claude!!!"*. Diffed body against body, both
// formats: ONE hunk, six lines, and it is exactly that move --
//
//     -      <div class="kicker">Grade 9 &middot; Mathematics</div>
//     +      <div class="h-top">
//     +        <div class="kicker">Grade 9 &middot; Mathematics</div>
//     +        <div class="h-loc">p.24-25 &middot; <b>40 min</b></div>
//     +      </div>
//            <div class="h-title">Multiplying two 2×2 matrices</div>
//          <div class="h-meta">
//            <div>Ch. 1 &middot; Matrices and Determinants</div>
//     -      <div>p.24-25 &middot; <b>40 min</b></div>
//
// No word changed, nothing was added or dropped, the chapter and the board chip stayed in the
// meta column, and no other class moved in either format. Nothing to do with `cfu`, which is
// still what this file exists to guard.
//
// BOTH DIGESTS MOVED AGAIN ON 2026-09-23, and this is that explanation. bd-2hmag packs a
// `key_points` list one bullet per atom, because as one atom it was among the blocks that would
// not fit the space a page had left and so left it blank. The control has one such list, of
// three bullets. Diffed body against body, both formats: ONE hunk, and it is exactly that split
// --
//
//     -      <ul class="kp">
//     +<ul class="kp">
//              <li>A product is defined only when ...</li>
//     +</ul>
//     +</div>
//     +<div data-atom class="blk sp-0">
//     +<ul class="kp" style="margin-top:0">
//              <li>Entry c_ij is row i of A times column j of B.</li>
//     ... and the same two lines again before the third bullet.
//
// Three `<ul class="kp">` where there was one, in two more `.blk` atoms, and the label still
// rides bullet 1. NO WORD CHANGED, no bullet was added, dropped or reordered, and no other
// class moved in either format. It paints identically: `.blk` is `margin:0`, the pieces butt at
// `sp-0`, and each continuation list zeroes the `--sp-1` top margin `.kp` would otherwise take,
// so the three lists print as the one list did. Nothing to do with `cfu`, which is still what
// this file exists to guard.
const G9_BODY_SHA = {
  a4: "12b0ed157554e4032acbd8d0891064d437497b7d9583c517943b8f7dafde6252",
  phone: "9852ad2830211f397e0690c3a68d3b6f94bdd6c0677717277fd7afef0caf7c19",
};

test.each(["a4", "phone"])("the grade-9 markup is byte-for-byte what it was (%s)", (format) => {
  const doc = baseDoc();
  expect(doc.provenance.grade).toBe(9);
  const body = build(doc, { format }).split("</style>").pop();
  expect(require("crypto").createHash("sha256").update(body).digest("hex")).toBe(G9_BODY_SHA[format]);
});

test("no G6-12 document carries the field, so the path does not run for one", () => {
  // The `d0_diagram.py` precedent: additive by construction beats a grade gate, because
  // there is no flag to get wrong.
  const doc = baseDoc();
  expect(JSON.stringify(doc)).not.toContain('"cfu"');
});
