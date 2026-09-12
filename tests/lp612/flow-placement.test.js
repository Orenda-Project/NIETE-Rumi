/**
 * bd-a8veu.10 — common mistakes and differentiation move OUT of Reference and INTO the flow.
 *
 * Operator, on the grade-6 geography PDF: *"the board image should be where its needed not in
 * reference,, common mistakes should be in the part where its needed much like how its in
 * opening, not stand alone as reference. Differentiation should also be part of practice where
 * students are going to do work, not in reference"*.
 *
 * The board half of that sentence shipped as bd-a8veu.7. This is the other two.
 *
 * WHERE EACH ONE GOES, read off the operator's own words rather than chosen:
 *   • **mistakes → the section where the teaching happens.** "the part where its needed much
 *     like how its in opening" — the Introduction already prints its `watch_out` inline, next
 *     to the sentence that provokes the misconception. Development is where the misconception
 *     actually surfaces, and it already closes on a `watch_out`, so the pupil-says/you-ask pair
 *     follows in the same register.
 *   • **differentiation → the section that carries the practice.** "part of practice where
 *     students are going to do work" — so it is found by the BLOCK (`practice` /
 *     `faded_example`), not by a hardcoded section id. In this fixture that is `activity`.
 *
 * THIS IS A MOVE, NOT A COPY, and it is a RENDERER move only. `page2()` stops emitting the two
 * sections, `S` paints nothing for a section with no bodies, and the support index closes up by
 * itself (render-law 15). The DOCUMENT is untouched: `page2.mistakes` and `page2.differentiation`
 * are still exactly where the schema, `lint_lp.js`, the author briefs and every `ur_overlay`
 * pointer address them — the same contract bd-a8veu.6 kept for the key words and bd-a8veu.7 kept
 * for the board plan.
 *
 * AND THE FALLBACK IS LOAD-BEARING. A host is looked up, not assumed. An LP with no `development`
 * section, or none carrying a practice block, keeps that group in Reference rather than dropping
 * it — content may move, it may never vanish.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));
const { lint } = require(path.join(VENDOR, 'lint_lp.js'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(FIXTURE, 'utf8');
const load = () => JSON.parse(raw);

const build = (doc, lang = 'en') => buildHtml(doc, { docDir: path.dirname(FIXTURE), lang });

/** The two card shapes, matched on the OPENING of the class attribute — `atom()` appends `sp-N`. */
const MIS_CARD = /class="mis\b/g;
const DIFF_LBL = { en: ['If stuck', 'If the method is the barrier', 'If they finish early'] };

const count = (s, re) => (s.match(re) || []).length;

/**
 * The document's two parts. The support page opens on its masthead and runs to the end.
 *
 * `buildHtml().atoms` is deliberately HTML-free — it ships `{sec, first, glue}` for the packer
 * and nothing else — so placement is read off the RENDERED markup, which is the artefact the
 * operator is complaining about anyway.
 *
 * The stylesheet is dropped first. It is emitted ahead of everything, so it used to land inside
 * `teach`, and the sheet's own comments name the very labels these tests search for — bd-a8veu.11
 * added one explaining why "If stuck" is a leaf label and not a group heading, and this suite read
 * that sentence as a differentiation card rendered in the flow. A rule block is not a placement;
 * the markup is.
 */
const split = (html) => {
  const body = html.slice(html.indexOf('</style>'));
  const at = body.indexOf('class="p2head');
  return { teach: body.slice(0, at), support: body.slice(at) };
};

/**
 * Every atom of a part, in paint order, each tagged with the section it falls under.
 *
 * `atom()` stamps `data-atom` on each fragment's root, and a section's own bar is an atom that
 * carries `data-sec`, so walking the fragments and remembering the last bar seen reproduces
 * exactly the `sec` the packer works with.
 */
const walk = (part) => {
  let sec = null;
  return part.split('data-atom').slice(1).map((html) => {
    const m = /class="(?:bar|p2bar)[^"]*"\s*data-sec="([^"]+)"/.exec(html);
    if (m) sec = m[1];
    return { sec, html };
  });
};

const secsOf = (atoms, re) => atoms.filter((a) => re.test(a.html)).map((a) => a.sec);

/** Support-page bar letters in paint order, continuation bars dropped. (page2-answer-keys-optional) */
const barLetters = (html) =>
  [...html.matchAll(/<div[^>]*class="[^"]*\bp2bar\b([^"]*)"[^>]*data-sec="p2-([A-Z])"/g)]
    .filter((m) => !/\bcont\b/.test(m[1]))
    .map((m) => m[2]);

describe('bd-a8veu.10 — mistakes and differentiation render in the flow, not in Reference', () => {
  // ── the fixture is a fair test of the thing ───────────────────────────────
  test('the fixture carries both groups, a development section, and a practice block', () => {
    const d = load();
    expect(Array.isArray(d.page2.mistakes)).toBe(true);
    expect(d.page2.mistakes.length).toBeGreaterThan(1);
    expect(d.page2.differentiation).toEqual(
      expect.objectContaining({ stuck: expect.any(String), barrier: expect.any(String), early: expect.any(String) })
    );
    const ids = d.sections.map((s) => s.id);
    expect(ids).toContain('development');
    const practice = d.sections.find((s) => s.blocks.some((b) => b.type === 'practice' || b.type === 'faded_example'));
    expect(practice).toBeDefined();
    expect(practice.id).toBe('activity');
  });

  // ── 1. the cards are now TEACH atoms, in the right sections ───────────────
  test('every mistake card is a teach atom belonging to development', () => {
    const { teach, support } = split(build(load()).html);
    const secs = secsOf(walk(teach), /class="mis\b/);
    expect(secs.length).toBe(load().page2.mistakes.length);
    expect(new Set(secs)).toEqual(new Set(['development']));
    expect(secsOf(walk(support), /class="mis\b/)).toEqual([]);
  });

  test('the differentiation cards are teach atoms belonging to the practice section', () => {
    const { teach, support } = split(build(load()).html);
    const atoms = walk(teach);
    const hit = (lbl) => atoms.filter((a) => a.html.includes(lbl)).map((a) => a.sec);
    for (const lbl of DIFF_LBL.en) expect(hit(lbl)).toEqual(['activity']);
    for (const lbl of DIFF_LBL.en) expect(support).not.toContain(lbl);
  });

  test('differentiation lands AFTER the practice items, not before them', () => {
    // "part of practice where students are going to do work" — it is the thing a teacher reaches
    // for once the class is working, so it may not sit above the items it differentiates.
    const atoms = walk(split(build(load()).html).teach);
    const lastPractice = atoms.reduce((acc, a, i) => (/class="blk pr\b/.test(a.html) ? i : acc), -1);
    expect(lastPractice).toBeGreaterThan(-1);
    expect(atoms.findIndex((a) => a.html.includes(DIFF_LBL.en[0]))).toBeGreaterThan(lastPractice);
  });

  // ── 2. one card per atom, and a label that is never stranded ──────────────
  test('each card is its own atom, so a page break may fall between them', () => {
    const atoms = walk(split(build(load()).html).teach);
    const carriers = atoms.filter((a) => /class="mis\b/.test(a.html));
    expect(carriers.length).toBe(load().page2.mistakes.length);
    for (const a of carriers) expect(count(a.html, MIS_CARD)).toBe(1);
  });

  test('the group label travels in the SAME atom as its first card', () => {
    // The precedent is the YOU-DO list: the tag ships with item 1 so a page can never open on a
    // bare card with no idea what it is a card OF.
    const atoms = walk(split(build(load()).html).teach);
    const first = atoms.find((a) => /class="mis\b/.test(a.html));
    expect(first.html).toContain('Common mistakes and the question you ask back');
    const diffFirst = atoms.find((a) => a.html.includes(DIFF_LBL.en[0]));
    expect(diffFirst.html).toContain('Differentiation');
  });

  // ── 3. Reference loses both sections, and its index closes up ────────────
  test('the support page paints neither section — no bar, no cards', () => {
    const { html } = build(load());
    const support = html.slice(html.indexOf('class="p2head'));
    expect(support).not.toContain('Common mistakes and the question you ask back');
    expect(support).not.toContain('>Differentiation<');
  });

  test('the remaining support bars keep a contiguous A, B, C … index', () => {
    const letters = barLetters(build(load()).html);
    expect(letters.length).toBeGreaterThan(1);
    expect(letters).toEqual(letters.map((_, i) => String.fromCharCode(65 + i)));
  });

  // ── 4. Urdu moves with it ────────────────────────────────────────────────
  test('Urdu places both groups in the flow too', () => {
    const { teach, support } = split(build(load(), 'ur').html);
    expect(new Set(secsOf(walk(teach), /class="mis\b/))).toEqual(new Set(['development']));
    expect(teach).toContain('عام غلطیاں اور آپ کا جوابی سوال');
    expect(teach).toContain('انفرادی فرق کے مطابق');
    expect(support).not.toContain('انفرادی فرق کے مطابق');
  });

  // ── 5. the fallback — content may move, it may never vanish ──────────────
  test('an LP with no development section keeps its mistakes in Reference', () => {
    const d = load();
    d.sections = d.sections.filter((s) => s.id !== 'development');
    const { teach, support } = split(build(d).html);
    expect(teach).not.toContain('class="mis');
    expect(support).toContain('Common mistakes and the question you ask back');
  });

  test('an LP with no practice block keeps its differentiation in Reference', () => {
    const d = load();
    for (const s of d.sections) s.blocks = s.blocks.filter((b) => b.type !== 'practice' && b.type !== 'faded_example');
    const { teach, support } = split(build(d).html);
    expect(teach).not.toContain(DIFF_LBL.en[0]);
    expect(support).toContain(DIFF_LBL.en[0]);
  });

  // ── 6. the document, the schema and lint are untouched ───────────────────
  test('the doc still carries both under page2, and lints exactly as before', () => {
    const d = load();
    build(d);
    expect(d.page2.mistakes).toBeDefined();
    expect(d.page2.differentiation).toBeDefined();
    const { fails } = lint(load());
    expect(fails.filter((f) => /mistake|differentiation/i.test(f))).toEqual([]);
  });
});
