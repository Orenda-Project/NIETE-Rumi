/**
 * bd-a8veu.20 — THE REFERENCE PAGE STOPS RE-PRINTING WHAT PAGE 1 ALREADY SAYS.
 *
 * Operator, on a grade-6 English plan: *"inside Reference, A is not at all needed since on
 * Page 1 it is already present, so pls remove the whole thing."*
 *
 * A IS NOT AN IDENTIFIER. The support page's section letters are assigned by `S` in EMISSION
 * ORDER (render-law 15, `template.js:1895-1915`), and a section with an empty body is not
 * painted at all — so the same block is B on one lesson and A on the next. On a v9.4 grade-6
 * plan every earlier section is skipped: `model_answers` and `homework_key` are no longer
 * authored (bd-s19g8), mistakes and differentiation print in the flow (bd-a8veu.10), and the
 * FBISE bank is SSC-only (bd-a8veu.18). What is left in first position is
 * `S(p2Next / p2NotGoing)` — and its "Next period" half prints the same fact as the page-1
 * sequence strip's `Next:` line (`template.js:1694`). That is the duplication, and it is the
 * operator's own stated reason.
 *
 * THE FIX IS RENDER-ONLY, exactly like bd-a8veu.18. `next_period` and `not_going` stay
 * REQUIRED in both schemas (`lp_doc.v2.schema.json:352-359`, `lp_doc.schema.json:307`), the
 * briefs keep ordering them, and lint keeps its rules — so a lesson already sitting in the
 * store re-renders without the section at no model cost. This suite pins both halves of that:
 * the page no longer paints it, and the document did not move.
 *
 * NOTE ON NEEDLES. `"A"` is not a testable string — the single-letter trap. Every assertion
 * below names the section by its TITLE or by `data-sec="p2-A"` together with the title, and
 * the body text is driven with sentinels so a `not.toContain` cannot pass by accident.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));
const { lint } = require(path.join(VENDOR, 'lint_lp.js'));
const { validateDoc } = require(path.join(VENDOR, 'lib', 'validate'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(FIXTURE, 'utf8');
const load = () => JSON.parse(raw);

/** The two printed labels, as `overlay.js:191` writes them. */
const NEXT = 'Next period';
const NOT_GOING = 'Not going today';
const COACH = 'Coaching corner';

/**
 * The fixture reshaped into what a v9.4 GRADE-6 plan actually is — which is the only shape in
 * which the operator sees this section as A. Nothing here is invented: each deletion is a
 * decision already shipped, named beside it.
 */
function grade6() {
  const d = load();
  delete d.page2.model_answers; // bd-s19g8 — no longer authored
  delete d.page2.homework_key; //  bd-s19g8 — no longer authored
  delete d.page2.exam_bank; //     bd-a8veu.18 — SSC only, and this is grade 6
  d.provenance.grade = 6;
  d.board_weight = null; // the FBISE badge travels with the grade, not with the bank
  return d;
}

const build = (doc, lang = 'en') =>
  buildHtml(doc, { docDir: path.dirname(FIXTURE), lang }).html;

/** Everything after the stylesheet. CSS comments ship verbatim, so the sheet is sliced off
 *  before any class name or label is counted. */
const body = (html) => html.slice(html.lastIndexOf('</style>') + 8);

/** `[letter, name]` for each section bar, continuation bars dropped (they repeat a letter). */
const bars = (html) =>
  [...body(html).matchAll(
    /class="[^"]*\bp2bar\b([^"]*)"[^>]*data-sec="p2-([A-Z])"[^>]*>\s*<span class="badge">[^<]*<\/span><span class="nm">([^<]*)</g,
  )]
    .filter((m) => !/\bcont\b/.test(m[1]))
    .map((m) => [m[2], m[3]]);

/** Does the rendered page carry an element of this class? `atom()` rewrites the class
 *  attribute — `class="nxt"` with its closing quote never appears — so match the word. */
const hasClass = (html, name) => new RegExp(`class="[^"]*\\b${name}\\b`).test(body(html));

// ── 1. the section is gone from the page the operator reads ──────────────────

describe('the support page no longer carries Next period / Not going today', () => {
  test('on a grade-6 plan the FIRST reference section is the coaching corner', () => {
    // The operator's sentence in one assertion: what was A is gone, and what takes A is the
    // thing they said there was now room for.
    const list = bars(build(grade6()));
    expect(list.length).toBeGreaterThan(0);
    expect(list[0][1]).toBe(COACH);
    expect(list.map(([, name]) => name)).not.toContain(`${NEXT} / ${NOT_GOING}`);
  });

  test('the letters still close up with no gap — render-law 15 does it by itself', () => {
    const letters = bars(build(grade6())).map(([l]) => l);
    expect(letters).toEqual(letters.map((_, i) => String.fromCharCode(65 + i)));
  });

  test('neither half is painted, on a full grade-9 plan either', () => {
    // Not a grade rule and not a "the section happened to be empty" accident: the block is
    // simply not emitted, on the richest document the suite has.
    const html = build(load());
    expect(body(html)).not.toContain(NEXT);
    expect(body(html)).not.toContain(NOT_GOING);
    expect(hasClass(html, 'nxt')).toBe(false);
  });

  test('and neither BODY is printed — sentinels, so this cannot pass by accident', () => {
    const d = grade6();
    d.page2.next_period = 'ZZ_NEXT_PERIOD_SENTINEL_ZZ';
    d.page2.not_going = 'ZZ_NOT_GOING_SENTINEL_ZZ';
    const out = body(build(d));
    expect(out.includes('ZZ_NEXT_PERIOD_SENTINEL_ZZ')).toBe(false);
    expect(out.includes('ZZ_NOT_GOING_SENTINEL_ZZ')).toBe(false);
  });

  test('Urdu drops it too — this is the page, not the label pack', () => {
    const html = build(grade6(), 'ur');
    expect(body(html)).not.toContain('اگلا پیریڈ');
    expect(hasClass(html, 'nxt')).toBe(false);
  });
});

// ── 2. the fact survives, once, where the operator says it already is ────────

describe('the next lesson is still on page 1, and now only there', () => {
  test('the page-1 sequence strip still names the next lesson', () => {
    const d = grade6();
    d.sequence.next = 'ZZ_SEQ_NEXT_SENTINEL_ZZ';
    const out = body(build(d));
    expect(out).toContain('ZZ_SEQ_NEXT_SENTINEL_ZZ');
    expect(out).toContain('Next:');
  });

  test('the same fact is printed ONCE, not twice — the defect, stated directly', () => {
    // Drive both fields with one string. Before the fix this is 2: the strip on page 1 and
    // the reference section. The whole of the operator's complaint is this count.
    const d = grade6();
    d.sequence.next = 'ZZ_ONE_FACT_SENTINEL_ZZ';
    d.page2.next_period = 'ZZ_ONE_FACT_SENTINEL_ZZ';
    const out = body(build(d));
    expect(out.split('ZZ_ONE_FACT_SENTINEL_ZZ').length - 1).toBe(1);
  });
});

// ── 3. the DOCUMENT did not move — render-only, so stored lessons re-render free ──

describe('the document is untouched', () => {
  test('a doc still carrying next_period and not_going validates', () => {
    const d = grade6();
    expect(d.page2.next_period).toBeTruthy();
    expect(d.page2.not_going).toBeTruthy();
    const v = validateDoc(d);
    expect(v.errors.filter((e) => /next_period|not_going/.test(e))).toEqual([]);
  });

  test('the frozen 2.0 schema still requires both — the stored corpus keeps validating', () => {
    const d = grade6();
    delete d.page2.next_period;
    delete d.page2.not_going;
    d.schema_version = '2.0';
    const v = validateDoc(d);
    expect(v.schema).toBe('lp_doc.v2.schema.json');
    expect(v.errors.filter((e) => /next_period/.test(e)).length).toBeGreaterThan(0);
    expect(v.errors.filter((e) => /not_going/.test(e)).length).toBeGreaterThan(0);
  });

  test('lint has no new complaint about a doc that carries them', () => {
    const { fails } = lint(grade6());
    expect(fails.filter((f) => /next_period|not_going/.test(f))).toEqual([]);
  });
});
