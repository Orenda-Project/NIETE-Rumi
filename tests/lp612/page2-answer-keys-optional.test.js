/**
 * bd-s19g8 — the two answer keys on the support page become OPTIONAL.
 *
 * Operator, 2026-09-11: *"we didnt need model answers"*, then *"yes do item 3, homework key
 * goes too"*. So both reference blocks — `page2.model_answers` (section B) and
 * `page2.homework_key` (section F) — stop being mandatory structures.
 *
 * WHY THIS IS NOT A ONE-LINE RENDER CHANGE. Three layers currently conspire to make an LP
 * without them impossible:
 *
 *   1. BOTH schemas list the two keys in `page2.required`, so a doc without them is a SCHEMA
 *      failure — and `lint()` returns early on SCHEMA, so nothing below it even runs.
 *   2. `lib/template.js`'s `S()` ALWAYS emits a section's bar before its bodies, so an absent
 *      array would leave a naked "B MODEL ANSWERS" rule over an empty grid.
 *   3. `lint_lp.js`'s REVERSE REF_ABSENT rule — *"asked and never answered, not in place and
 *      not in the reference block"* — is the real blocker. `lib/questions.js` builds every
 *      CHECKPOINT and every HOMEWORK entry with `a: null` *structurally* (:52, :57): their
 *      answers can only ever live in a reference block. Drop the blocks and that rule fires on
 *      every checkpoint and every homework item in every LP.
 *
 * THE RULE THAT REPLACES IT: **an answer key that exists must be complete; an LP need no
 * longer have one.** A doc that ships `model_answers` still has to answer every checkpoint;
 * a doc that ships `homework_key` still has to solve every homework item. A doc that ships
 * neither is simply an LP without an answer key, which is now a legitimate shape. The FORWARD
 * direction is untouched and stays absolute: an answer pointing at a question the LP never
 * states is still a defect, because that one is a lie on the page either way.
 *
 * And the lettering: the support page's A…H bars are wayfinding, not identity — nothing keys
 * off them (`grep -rn 'p2-[A-H]'` finds no consumer outside the generator). A page that ran
 * A, C, D, E, G, H would read as a printing fault, so the letters are assigned in emission
 * order and stay contiguous whatever is present.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));
const { lint } = require(path.join(VENDOR, 'lint_lp.js'));
const { validateDoc } = require(path.join(VENDOR, 'lib', 'validate'));
const { allQuestions } = require(path.join(VENDOR, 'lib', 'questions'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(FIXTURE, 'utf8');
const load = () => JSON.parse(raw);

/** The fixture with the two reference blocks taken away — the shape the operator asked for. */
function noKeys() {
  const d = load();
  delete d.page2.model_answers;
  delete d.page2.homework_key;
  return d;
}

const build = (doc, lang = 'en') =>
  buildHtml(doc, { docDir: path.dirname(FIXTURE), lang }).html;

/**
 * The letter of every support-page bar, in the order they are painted.
 *
 * Read off the rendered markup, which `atom()` has already decorated —
 * `<div data-atom class="p2bar sp-2" data-sec="p2-B">` — so the class is matched loosely.
 * CONTINUATION bars (`p2bar cont`, rebuilt at the top of a page that opens mid-section)
 * repeat a letter that is already in the list and are dropped.
 */
const barLetters = (html) =>
  [...html.matchAll(/<div[^>]*class="[^"]*\bp2bar\b([^"]*)"[^>]*data-sec="p2-([A-Z])"/g)]
    .filter((m) => !/\bcont\b/.test(m[1]))
    .map((m) => m[2]);

const codesOf = (list) => list.map((s) => String(s).split(':')[0]);

describe('page2.model_answers and page2.homework_key are optional', () => {
  // ── the fixture is a fair test of the thing ────────────────────────────────
  test('the fixture really does carry both keys, and questions that only they can answer', () => {
    const d = load();
    expect(Array.isArray(d.page2.model_answers)).toBe(true);
    expect(Array.isArray(d.page2.homework_key)).toBe(true);
    // the structural blocker, asserted rather than assumed: these carry `a: null` from
    // lib/questions.js, so the reverse rule has nowhere else to look for their answers.
    const kinds = allQuestions(d).filter((q) => q.a == null).map((q) => q.kind);
    expect(kinds).toContain('checkpoint');
    expect(kinds).toContain('homework');
  });

  // ── 1. schema, both of them ───────────────────────────────────────────────
  test('a 3.0 doc without either key validates', () => {
    const v = validateDoc(noKeys());
    expect(v.schema).toBe('lp_doc.schema.json');
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
  });

  test('the frozen 2.0 schema stops requiring them too', () => {
    // The 2.0 corpus (2,600+ stored LPs) is judged against its own file, and that file has the
    // same two entries in `page2.required`. Asserted on the ERRORS rather than on `ok`: this
    // 3.0 fixture is not a valid 2.0 doc for unrelated reasons, and the question here is only
    // whether these two keys are still demanded.
    const d = noKeys();
    d.schema_version = '2.0';
    const v = validateDoc(d);
    expect(v.schema).toBe('lp_doc.v2.schema.json');
    const about = v.errors.filter((e) => /model_answers|homework_key/.test(e));
    expect(about).toEqual([]);
  });

  // ── 2. lint ───────────────────────────────────────────────────────────────
  test('it lints with no SCHEMA, no REF_ABSENT and no MODELS complaint', () => {
    const { fails, warns } = lint(noKeys());
    expect(codesOf(fails)).not.toContain('SCHEMA');
    // the reverse rule, which without the fix fires once per checkpoint and once per homework item
    expect(fails.filter((f) => /^REF_ABSENT/.test(f))).toEqual([]);
    expect(codesOf(warns)).not.toContain('MODELS');
  });

  test('but a key that IS present must still be complete', () => {
    // The half of the old rule that survives. Keep `homework_key`, drop the entry that solves
    // H1, and the LP is once again claiming to answer homework it does not answer.
    const d = load();
    delete d.page2.model_answers;
    const hw = allQuestions(d).find((q) => q.kind === 'homework');
    d.page2.homework_key = d.page2.homework_key.filter((k) => k.ref !== hw.ref);
    const { fails } = lint(d);
    expect(fails.some((f) => f.startsWith('REF_ABSENT') && f.includes(hw.ref))).toBe(true);
  });

  test('and an answer pointing at a question the LP never asks still fails, key or no key', () => {
    // The FORWARD direction — the expert's original defect — is not relaxed by any of this.
    const d = load();
    delete d.page2.model_answers;
    d.page2.homework_key = [...d.page2.homework_key, { ref: 'H99', answer: 'answers nothing' }];
    const { fails } = lint(d);
    expect(fails.some((f) => f.startsWith('REF_ABSENT') && f.includes('H99'))).toBe(true);
  });

  // ── 3. render ─────────────────────────────────────────────────────────────
  test('neither section is painted — no bar, no empty grid', () => {
    const html = build(noKeys());
    expect(html).not.toContain('Model answers');
    expect(html).not.toContain('Homework, in full');
    expect(html).not.toContain('class="grid2"');   // both sections are the page's only grid2s
  });

  test('Urdu drops them too', () => {
    const html = build(noKeys(), 'ur');
    expect(html).not.toContain('نمونہ جوابات');
    expect(html).not.toContain('گھر کے کام کے مکمل جوابات');
  });

  test('the remaining bars keep a contiguous A, B, C … index', () => {
    // The floor only guards against the assertion going vacuous on a one-bar page; it is not a
    // count of what Reference holds. That count keeps shrinking as sections move into the flow —
    // bd-a8veu.7 took the board plan into the Introduction, bd-a8veu.10 took mistakes into
    // Development and differentiation into the practice section. Contiguity is the invariant.
    const letters = barLetters(build(noKeys()));
    expect(letters.length).toBeGreaterThan(1);
    expect(letters).toEqual(letters.map((_, i) => String.fromCharCode(65 + i)));
  });

  // ── 4. nothing changes for a doc that still has them ──────────────────────
  test('a doc that still carries both renders exactly as it does today', () => {
    const html = build(load());
    expect(html).toContain('Model answers');
    expect(html).toContain('Homework, in full');
    // Both keys still paint, and the index is still gapless. The run used to be spelled
    // A…H here; bd-a8veu.7 moved the board plan out of Reference and into the Introduction,
    // so it is one shorter — which is exactly what the sibling contiguity test above already
    // says the right way. The count was never this test's subject.
    const letters = barLetters(html);
    expect(letters.length).toBeGreaterThan(3);
    expect(letters).toEqual(letters.map((_, i) => String.fromCharCode(65 + i)));
  });
});
