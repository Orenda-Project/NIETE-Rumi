/**
 * bd-a8veu.3 — the O box speaks in ONE voice, and it is the pupil's.
 *
 * Operator, 2026-09-12, item 3 of the v9.3 PDF design review:
 *   *"Learning Outcomes still has objectives written in 3 different styles, it should be just 1,
 *   which should be student facing"*
 *
 * "STILL" is the load-bearing word. This is the second time it has been asked for, and the first
 * time it was answered with brief prose — which is a request, not a rule. So the answer this time
 * is a gate that fails the document.
 *
 * WHAT THE TEACHER IS LOOKING AT. Here is the box, verbatim, off
 * `grade_6_geography_c04_p63_en.pdf` — the operator's own lesson:
 *
 *     LEARNING OUTCOME
 *     You can name Pakistan's four forest types and say where each grows.
 *     ✓ By the end you can answer a short-response question naming a forest type
 *       from its region and climate.
 *     Learning outcome: "Describe the main types of forests found in Pakistan and
 *       locate the regions where each type grows." · p.63–64 · Formative · U
 *     O LEARNING OBJECTIVES
 *       Name Pakistan's four forest types: coniferous, sub-tropical scrub, …   O1
 *       Match each forest type to the region and climate that produces it.     O2
 *       State one importance of mangrove forests to the coast.                 O3
 *
 * Three styles, exactly as counted:
 *
 *   1. `You can …` — the pupil, addressed. This is the one to keep.
 *   2. `Name … / Match … / State …` — bare imperatives. Nobody is addressed; it is the register of
 *      a curriculum document, which is who these were copied from.
 *   3. `Learning outcome: "Describe … locate …"` — a THIRD wording of the same lesson, under a
 *      label that repeats the box's own heading word for word. `L.slo` and `L.outcome` were both
 *      the string "Learning outcome" (overlay.js:176 and :207), so the box said the same two words
 *      twice over two differently-worded sentences. In Urdu they were already distinct
 *      (`متعینہ تدریسی مقصد` / `تدریسی نتیجہ`); the collision was English-only.
 *
 * WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT.
 *
 *   • The three AUTHORED strings — `objectives.outcome`, `objectives.by_the_end`, and every
 *     `objectives.items[].text` — must each address the pupil. `OUTCOME_VOICE` fails the document
 *     otherwise. It is a fail and not a warn because a warn is what we already tried.
 *   • `slo.text_verbatim` is NOT touched and must never be. It is the curriculum's printed wording,
 *     quoted word for word with its page, and lint already forbids overlaying it (§`ur_overlay`).
 *     Rewriting a quotation to fix its register would be a fabrication. What was wrong with it was
 *     never the words — it was the label, which claimed to be the outcome. It is now a citation and
 *     is labelled as one.
 *   • Each objective carries its OWN `You can …`; there is no shared stem on the heading. A stem
 *     prefix reads well enough in English and cannot exist in Urdu, whose verb goes last — the
 *     objective would have to be rebuilt around the label rather than translated. An objective also
 *     has to survive being read alone: it goes through the overlay pass, it is quoted back in
 *     revision rounds, and it is the string the author edits.
 *   • That stem costs two words each, so `OUTCOME_BOX_V9.objective` goes 15 → 17. Furniture the
 *     rule now mandates should not eat the content allowance. The box TOTAL stays at 80: that one
 *     is the measured render bound, and it, not the per-field caps, is what keeps the box off the
 *     whole of page 1.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { lint, OUTCOME_BOX_V9 } = require(path.join(VENDOR, 'lint_lp.js'));
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));
const { LABELS } = require(path.join(VENDOR, 'lib', 'overlay'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(FIXTURE, 'utf8');
const load = () => JSON.parse(raw);

const codesOf = (list) => list.map((s) => String(s).split(':')[0]);
const voiceFails = (doc) => lint(doc).fails.filter((f) => f.startsWith('OUTCOME_VOICE'));

/** The box as it printed on the operator's PDF: the outcome addresses the pupil, the objectives
 *  are bare imperatives lifted from the curriculum. */
function bareImperatives() {
  const d = load();
  d.objectives.items = [
    { text: 'State whether a product is defined by comparing the inner orders.', slo_code: 'M-09-A-07' },
    { text: 'Find the product of two 2×2 matrices row by column.', slo_code: 'M-09-A-07' },
  ];
  return d;
}

/** An Urdu-medium doc. The pupil is `آپ`; the register question is the same one. */
function urdu(items) {
  const d = load();
  d.provenance.medium = 'ur';
  d.objectives.outcome = 'آپ دو ۲×۲ میٹرکس کو ضرب دے سکتے ہیں۔';
  d.objectives.by_the_end = 'دن کے اختتام پر آپ چار نمبر کا مختصر سوال حل کر سکتے ہیں۔';
  d.objectives.items = items.map((text) => ({ text, slo_code: 'M-09-A-07' }));
  return d;
}

describe('bd-a8veu.3 — OUTCOME_VOICE: every authored line of the O box addresses the pupil', () => {
  test('the shipped fixture models the register it now demands', () => {
    // The gate fixture is the exemplar the defect cases are built FROM. If it were itself in the
    // curriculum register, every suite that mutates it would be starting from a failing document.
    const O = load().objectives;
    for (const s of [O.outcome, O.by_the_end, ...O.items.map((i) => i.text)]) {
      expect(s.toLowerCase()).toMatch(/\byou\b/);
    }
  });

  test('an objective in the bare imperative fails the document', () => {
    expect(codesOf(lint(bareImperatives()).fails)).toContain('OUTCOME_VOICE');
  });

  test('it fails, it does not warn — a warn is what was tried the first time', () => {
    expect(codesOf(lint(bareImperatives()).warns)).not.toContain('OUTCOME_VOICE');
  });

  test('every offending objective is named, not just the first', () => {
    // Two are wrong in that variant. Reporting one sends the author round twice.
    expect(voiceFails(bareImperatives())).toHaveLength(2);
  });

  test('the complaint quotes the line and says what to write instead', () => {
    const [msg] = voiceFails(bareImperatives());
    expect(msg).toContain('State whether a product is defined');
    expect(msg).toMatch(/You can/);
  });

  test('the complaint never sends the author at the printed SLO quote', () => {
    // `slo.text_verbatim` is a quotation with its page. An author who "fixes its voice" has
    // falsified a citation, and lint forbids overlaying it in the first place.
    for (const msg of voiceFails(bareImperatives())) {
      expect(msg).not.toMatch(/text_verbatim|verbatim|quoted outcome/i);
    }
  });

  test('the ✓ by-the-end line is held to the same rule as the objectives', () => {
    const d = load();
    d.objectives.by_the_end = 'Answer a 4-mark short-response question on the product of two matrices.';
    expect(voiceFails(d)).toHaveLength(1);
    expect(voiceFails(d)[0]).toContain('by_the_end');
  });

  test('the outcome sentence is held to it too', () => {
    const d = load();
    d.objectives.outcome = 'Multiply two 2×2 matrices and state when the product is defined.';
    expect(voiceFails(d)).toHaveLength(1);
    expect(voiceFails(d)[0]).toContain('outcome');
  });

  test('a box already in one voice draws no complaint', () => {
    expect(voiceFails(load())).toHaveLength(0);
  });

  // ── Urdu ────────────────────────────────────────────────────────────────
  test('an Urdu box that addresses the pupil passes', () => {
    expect(voiceFails(urdu([
      'آپ اندرونی ترتیب دیکھ کر بتا سکتے ہیں کہ ضرب ممکن ہے۔',
      'آپ دو میٹرکس کا حاصلِ ضرب نکال سکتے ہیں۔',
    ]))).toHaveLength(0);
  });

  test('an Urdu objective with nobody in it fails, in Urdu terms', () => {
    // `کریں` is an imperative ending, not an address — the same defect wearing the other script.
    const out = voiceFails(urdu(['اندرونی ترتیب کا موازنہ کریں۔', 'آپ حاصلِ ضرب نکال سکتے ہیں۔']));
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('آپ');
  });

  // ── the ceiling absorbs the stem it now mandates ────────────────────────
  test('the per-objective ceiling makes room for the two words the rule costs', () => {
    expect(OUTCOME_BOX_V9.objective).toBe(17);
    expect(OUTCOME_BOX_V9.total).toBe(80); // the render bound is unchanged
  });

  test('a 17-word student-facing objective clears both gates; an 18-word one does not', () => {
    const at = (n) => {
      const d = load();
      // "You can" + (n-2) more words, so the stem is inside the count, which is the point.
      d.objectives.items = [{ text: `You can ${Array.from({ length: n - 3 }, () => 'name').join(' ')} matrices.`, slo_code: null }];
      return codesOf(lint(d).fails).filter((c) => c === 'OUTCOME_BOX');
    };
    expect(at(17)).toHaveLength(0);
    expect(at(18)).toHaveLength(1);
  });
});

describe('bd-a8veu.3 — the citation stops calling itself the outcome', () => {
  test('English no longer labels two different sentences with the same two words', () => {
    expect(LABELS.en.slo).not.toBe(LABELS.en.outcome);
  });

  test('and Urdu, which never had the collision, keeps its own two labels', () => {
    expect(LABELS.ur.slo).not.toBe(LABELS.ur.outcome);
    expect(LABELS.ur.slo).toBe('متعینہ تدریسی مقصد');
  });

  /**
   * SUPERSEDED BY bd-a8veu.14. This used to prove the box printed the heading once and then the
   * citation UNDER ITS OWN NAME — the fix for the label collision, which was to make the two
   * labels differ so one box could carry both sentences.
   *
   * The operator's answer to that, on the third pass, was that neither sentence belongs there:
   * *"the curriculum SLO isnt needed neither is the learning outcomes, its just repetition."* So
   * the citation is no longer PAINTED at all, and the collision it was named after cannot recur
   * on the page. The two label assertions above still stand — `L.slo` is still a distinct string,
   * still used by the linter's complaint text — but the render side of bd-a8veu.3 is now the
   * removal, and this asserts the removal rather than the old placement.
   *
   * The full new box contract lives in `tests/lp612/outcome-one-voice-render.test.js`.
   */
  test('the citation is no longer painted at all, so the collision cannot recur', () => {
    const doc = load();
    const html = buildHtml(doc, { lang: 'en', docDir: path.dirname(FIXTURE) }).html;
    const body = html.slice(html.indexOf('</style>'));
    const i = body.indexOf('class="slo'); // `atom()` rewrites the class — match the opening
    const box = body.slice(i, i + 3000);

    // the heading is there, once, and it is the OUTCOME's
    expect(box).toContain(LABELS.en.outcome);
    expect(body.split(LABELS.en.slo).length - 1).toBe(0);
    // and the third wording of the lesson is off the page entirely
    expect(body).not.toContain(doc.slo.text_verbatim);
  });
});

describe('bd-a8veu.3 — the briefs carry the rule, in every family', () => {
  const BRIEFS = [
    'brief_author_v3.md',
    'brief_author_v3_flash_sci.md',
    'brief_author_v3_flash_prose.md',
    'brief_author_v3_flash_maths.md',
  ];
  const briefSrc = (f) => fs.readFileSync(path.join(VENDOR, f), 'utf8');

  test.each(BRIEFS)('%s states the one register and names the gate', (f) => {
    const src = briefSrc(f);
    expect(src).toContain('bd-a8veu.3');
    expect(src).toContain('OUTCOME_VOICE');
  });

  test.each(BRIEFS)('%s says it applies to all three fields, and exempts the quotation', (f) => {
    const src = briefSrc(f);
    const para = src.split('\n\n').find((p) => p.includes('OUTCOME_VOICE'));
    expect(para).toBeTruthy();
    expect(para).toMatch(/by_the_end/);
    expect(para).toMatch(/text_verbatim/);
  });

  test.each(BRIEFS)('%s carries the widened per-objective ceiling, not the old 15', (f) => {
    // The ceiling table is what the author actually writes to. Leaving 15 there while lint allows
    // 17 costs a revision round on every plan whose objective needs the stem.
    const src = briefSrc(f);
    const row = src.split('\n').find((l) => /\*\*each\*\* objective/.test(l));
    expect(row).toBeTruthy();
    expect(row).toContain('17');
  });
});
