/**
 * bd-5jaag — EVEN FILL: the two split-family openers that FORBID their own first seam.
 *
 * OPERATOR, repeatedly: *"fix the wasted white space too"*, *"this should be fixed and dynamic,
 * there's way too much open space"*, *"too much space left empty, we should be accounting for all
 * the space in the LP"*.
 *
 * WHAT WAS ACTUALLY WRONG. bd-5jaag was filed as "the packer has no even-fill tie-break". It has
 * one: `gapSq` in `better()` (render_lp.js) is Σ(px a page falls short of the 85% floor)², it
 * ranks above `splits`, and since bd-l7vig it counts the final page too. `packAtoms` is an exact
 * DP and was verified page-optimal against brute force over every break set on 400 random shapes
 * (0 mismatches). The tie-break is not missing; the SEAMS it is allowed to use are.
 *
 * bd-2hmag cut the tall blocks into pieces and wrote the rule down: *"EVERY NEW SEAM IS `soft`,
 * NEVER `glue`. `glue` forbids the break outright; `soft` charges the break as a `splits` cost, so
 * a block stays whole wherever staying whole is free and yields where it is not."* Two openers did
 * not get that treatment:
 *
 *   • `exqAtoms` — explicitly out of scope for bd-2hmag (*"a block WITH `turns` is handed to the
 *     packer exactly as it was"*). Its `pc-a` carries `glue: true`, which forbids a break between
 *     turn 1 and turn 2 — the very seam the function's own header declares legal.
 *   • the `practice` branch — bd-2hmag relaxed the TWO-item list to `soft` and left `glue` on
 *     three-or-more, on the theory that *"there are then later seams for the packer to use"*.
 *     Measured, there are not: six of 112 lessons each lose a whole page to precisely that glue.
 *
 * MEASURED, replaying the real packer on the real measured atom heights of 112 rendered lessons
 * (2 chapters × 5 grades × 4 subjects):
 *      base                    879 pages, 284 of 655 non-final under the floor (43.36%)
 *      exq `pc-a` soft         875 pages,                        264 (40.55%)
 *      + practice `pc-a` soft  869 pages,                        238 (36.90%)
 * Ten lessons lose a page; ZERO lessons gain one.
 *
 * NOTHING IS CUT. `soft` changes only WHERE a break may fall. Every turn, every practice item and
 * every heading is emitted by the same call as before, in the same order — pinned below.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));
const { packAtoms } = require(path.join(VENDOR, 'render_lp.js'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');

/** The shared fixture re-provenanced to grade 4 — the one thing `isPrimary` reads. */
function primaryDoc() {
  const d = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  d.provenance = { ...d.provenance, grade: 4, subject: 'English' };
  return d;
}

/** Every teach atom, with the class the packer never sees and the markup it owns. */
function atoms(d) {
  const r = buildHtml(d, { lang: 'en', docDir: path.dirname(FIXTURE) });
  const body = r.html.split('</style>').pop();
  const hits = [...body.matchAll(/<[a-z]+ data-atom[^>]*class="([^"]*)"/g)];
  return r.atoms.teach.map((a, i) => {
    const next = hits[i + 1];
    return { ...a, cls: hits[i][1], html: body.slice(hits[i].index, next ? next.index : body.length) };
  });
}
const like = (d, rx) => atoms(d).filter((a) => rx.test(a.cls));

/** Give the document's worked_example the four turns that send it down `exqAtoms`. */
const TURNS = [
  { kind: 'do', text: 'Teacher draws the ten-frame on the board and fills seven squares.' },
  { kind: 'say', text: 'Watch me count on from seven: eight, nine.' },
  { kind: 'ask', text: 'How many squares are still empty?' },
  { kind: 'say', text: 'Nine and one more makes ten, so the answer is ten.' },
];
function docWithTurns() {
  const d = primaryDoc();
  for (const s of d.sections || []) {
    for (const b of s.blocks || []) {
      if (b.type === 'worked_example') b.turns = TURNS.map((t) => ({ ...t }));
    }
  }
  return d;
}

// ---------------------------------------------------------------------------
// 1. THE MECHANISM, on the packer itself: `glue` is not a tie-break the DP can
//    lose — it removes the break from the search space entirely, so no amount of
//    even-fill pressure can reach it. `soft` leaves it reachable and prices it.
// ---------------------------------------------------------------------------
test('glue on a split opener costs a page that the same soft seam does not', () => {
  const CAP = 1000, SLACK = 12;
  const furn = { strip: 0, contBar: {} };
  // A preamble atom, then a split-family opener, then the rest of the block. The even-fill
  // packing is [preamble + opener] / [rest] — a break falling immediately AFTER the opener,
  // which is exactly the break `glue` removes from the search space. The orphan escape hatch
  // does not reach it: the opener is not alone on its page.
  const shape = (openerMeta) => [
    { h: 400, mt: 0 },
    { h: 500, mt: 0, ...openerMeta },
    { h: 600, mt: 0 },
    { h: 400, mt: 0 },
  ];
  const glued = packAtoms(shape({ glue: true }), CAP, furn, { slack: SLACK });
  const softened = packAtoms(shape({ soft: true }), CAP, furn, { slack: SLACK });
  expect(softened.breaks.length + 1).toBe(2); // soft packs the block in two pages
  expect(glued.breaks.length + 1).toBe(3); // glue spends a third page on the forbidden seam
  expect(softened.breaks.length).toBeLessThan(glued.breaks.length);
});

// ---------------------------------------------------------------------------
// 2. THE TWO OPENERS. Red before the fix, green after.
// ---------------------------------------------------------------------------
test('exqAtoms opener takes a soft seam, never glue', () => {
  const found = like(docWithTurns(), /\bexq\b.*\bpc-a\b/);
  expect(found.length).toBeGreaterThan(0); // the fixture must produce a split turns-script
  for (const a of found) {
    expect([a.cls, a.glue, a.soft]).toEqual([a.cls, false, true]);
  }
});

test('a practice list of three or more takes a soft seam, never glue', () => {
  const d = primaryDoc();
  const n = (d.sections || []).flatMap((s) => s.blocks || [])
    .filter((b) => b.type === 'practice').map((b) => (b.items || []).length);
  expect(n.some((x) => x >= 3)).toBe(true); // the fixture must carry a 3+ item practice list
  const found = like(d, /\bpr\b.*\bpc-a\b/);
  expect(found.length).toBeGreaterThan(0); // practice must split into pieces
  for (const a of found) {
    expect([a.cls, a.glue, a.soft]).toEqual([a.cls, false, true]);
  }
});

// ---------------------------------------------------------------------------
// 3. NOTHING MAY BE CUT — the seam moves, the words do not.
// ---------------------------------------------------------------------------
test('every authored turn and practice item still appears exactly once', () => {
  const d = docWithTurns();
  const all = atoms(d).map((a) => a.html).join('');
  for (const t of TURNS) {
    const needle = t.text.slice(0, 40);
    const hits = all.split(needle).length - 1;
    expect([needle, hits]).toEqual([needle, 1]);
  }
  for (const b of (d.sections || []).flatMap((s) => s.blocks || [])) {
    if (b.type !== 'practice') continue;
    for (const it of b.items || []) {
      const txt = typeof it === 'string' ? it : (it.text || it.prompt || '');
      if (txt.length < 20) continue;
      const needle = txt.slice(0, 20);
      expect([needle, all.includes(needle)]).toEqual([needle, true]);
    }
  }
});

test('the heading still rides with its first item — no orphaned tag', () => {
  const d = docWithTurns();
  for (const a of like(d, /\bpr\b.*\bpc-a\b/)) {
    expect(/class="tag"/.test(a.html)).toBe(true); // the practice tag rides in the opening piece
  }
  for (const a of like(d, /\bexq\b.*\bpc-a\b/)) {
    expect(/class="scr"/.test(a.html)).toBe(true); // turn 1 rides in the opening piece
  }
});
