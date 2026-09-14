/**
 * bd-a8veu.14 — THE OUTCOME BOX SPEAKS ONCE, AND THE RENDERER IS WHERE THAT IS DECIDED.
 *
 * OPERATOR, 2026-09-12, for the third time: *"The learning outcomess are still stated 3 ways, only
 * the first ones are needed, the curriculum SLO isnt needed neither is the learning outcomes, its
 * just repetition"* — followed by *"why am i giving the same feedback over and over again? Pls pay
 * attention"*.
 *
 * He is right, and the reason it survived two rounds is worth writing down because it is the whole
 * lesson of this bead:
 *
 *   bd-a8veu.3 answered exactly this complaint in commit 93e948cf. `git show --stat 93e948cf` is
 *   four author briefs, `lint_lp.js`, the schema, a fixture and a test. **Zero renderer files.**
 *   An author-side rule only takes effect when a model re-writes the lesson from scratch. It can
 *   never reach a document already stored in R2, and it can never reach a re-render of a stored
 *   document — which is what a template-version bump produces, by design and for zero model spend.
 *   So every lesson he opened kept printing the three voices the briefs had been told to stop
 *   writing.
 *
 * A defect you can SEE ON THE PAGE is a renderer defect. Fixed here, it lands on every one of the
 * ~4,700 stored lessons the moment they re-render, with no model called and nothing re-authored.
 *
 * WHAT THE PAGE MUST SHOW — measured off `_format_check_v9.3/g06_biography_plan.pdf`, where four
 * registers of the same sentence stacked on page 1:
 *
 *   LEARNING OUTCOME · E-06-WR-02
 *     Sort facts about one person onto a four-branch mind map — p23's guiding questions a-d.   KEEP
 *     ✓ By the end you can answer the p23 Writing task … 8 marks: plan 3, draft 5.             KEEP
 *     Curriculum SLO: "You will write about a biographical essay…" · p.8 · Internal · A        DROP
 *   O LEARNING OBJECTIVES                                                                      DROP
 *     Sort facts about one person onto a four-branch mind map — p23's guiding questions a-d.   DROP
 *     …                                                                                        (verbatim repeat of the outcome)
 *
 * The ✓ line stays because it is the ONLY place the assessment task and its mark split appear; it
 * is not a restatement of the outcome, it is what the outcome is worth. The curriculum SLO and the
 * objectives list are the two he named, and both are repetition.
 *
 * `doc.slo` and `doc.objectives.items` are NOT removed from the schema — the linter still gates on
 * them, the author still writes them, and `slo.code` still titles the box. They simply stop being
 * PAINTED.
 */

const fs = require('fs');
const path = require('path');

const { buildHtml } = require('../../bot/vendor/lp-v9/lib/template');

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

const html = (doc) => buildHtml(doc, { docDir: path.dirname(FIXTURE) }).html;

/** CSS comments ship verbatim inside the emitted <style>; the body starts after it. */
const body = (out) => out.slice(out.lastIndexOf('</style>') + 8);

/**
 * The outcome box alone. `atom()` rewrites the outer class, so it ships as
 * `<div data-atom class="slo sp-2">…</div>` — match the OPENING of the attribute.
 * Scoping matters: `.src` is also the class of the past-paper citation in the exam bank,
 * which is a legitimate second use and must not be caught by a whole-page assertion.
 */
const outcomeBox = (out) => {
  const b = body(out);
  const i = b.indexOf('class="slo');
  expect(i).toBeGreaterThan(-1);
  return b.slice(i, b.indexOf('</div>\n<div data-atom', i));
};

describe('bd-a8veu.14 — the outcome box prints ONE statement of the outcome', () => {
  test('the outcome itself is still printed', () => {
    const d = baseDoc();
    expect(body(html(d))).toContain(d.objectives.outcome);
  });

  test('the ✓ by-the-end line survives — it carries the marks, nothing else does', () => {
    const d = baseDoc();
    expect(body(html(d))).toContain(d.objectives.by_the_end);
  });

  test('the curriculum SLO verbatim is NOT painted', () => {
    const d = baseDoc();
    const out = body(html(d));
    expect(out).not.toContain(d.slo.text_verbatim);
    expect(out).not.toContain('Curriculum SLO');
  });

  test('the source-page / assessment-status / cognitive-level tail goes with it', () => {
    const d = baseDoc();
    expect(body(html(d))).not.toContain(d.slo.assessment_status);
    expect(outcomeBox(html(d))).not.toMatch(/class="src"/);
  });

  test('the box is now exactly the label, the outcome and the ✓ line', () => {
    const d = baseDoc();
    const box = outcomeBox(html(d));
    expect(box.match(/<div class="/g)).toHaveLength(2); // .lbl and .bythe
    expect(box).toMatch(/<p>/);
  });

  test('the O · LEARNING OBJECTIVES bar and its list are NOT painted', () => {
    const d = baseDoc();
    const out = body(html(d));
    expect(out).not.toMatch(/class="objhd"/);
    expect(out).not.toMatch(/class="objs"/);
    expect(out).not.toContain('Learning objectives');
    for (const it of d.objectives.items) expect(out).not.toContain(it.text);
  });

  test('the SLO CODE still titles the box — it is an identifier, not a restatement', () => {
    const d = baseDoc();
    expect(body(html(d))).toContain(d.slo.code);
  });

  test('an objective that repeats the outcome verbatim can no longer print twice', () => {
    const d = baseDoc();
    d.objectives.items[0].text = d.objectives.outcome;
    const out = body(html(d));
    const hits = out.split(d.objectives.outcome).length - 1;
    expect(hits).toBe(1);
  });
});
