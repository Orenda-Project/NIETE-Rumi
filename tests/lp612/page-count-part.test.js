/**
 * bd-a8veu.13 — THE PAGE-COUNT REPAIR INSTRUCTION HAS TO TALK ABOUT THE PART THAT IS OVER.
 *
 * Operator, on four sandbox renders: *"all of them are 7 pages long"*.
 *
 * The renderer refuses an over-cap part and names it: `PAGE COUNT: teach needs 7 pages; the cap
 * is 4`. It also says, in the same sentence, exactly how much has to come out and in what unit —
 * *"The 2 block(s) past the cap are 365px of content, out of teach's 29 — that is what has to
 * come out, and a BLOCK is the unit"* (bd-a8veu.1). That sentence reaches the revision prompt
 * verbatim. And then the HOW TO FIX block underneath it redirected the model to the other half
 * of the document: every object it named to cut — exam_bank questions, model_answers entries —
 * lives on the SUPPORT page, and no number of support cuts removes a teach page.
 *
 * Evidence, sandbox 2026-09-12, correlationId
 * lp612:grade_6_geography.c04.p063-064:2598108b — `PAGE COUNT: teach needs 7 pages, cap is 4`
 * carried through all five rounds, and the lesson shipped at 10 PDF pages. The instruction was
 * not ignored; it was unactionable for the part that was over.
 *
 * The block was stale a second way. bd-a8veu.10 moved `page2.mistakes` into the end of
 * Development and `page2.differentiation` into the end of the section that carries the practice,
 * so both now cost TEACH pages — while the prompt went on listing them as support-page cuts.
 *
 * WHAT THIS SUITE PINS. Three things, and it reads the renderer's own strings to do it rather
 * than paraphrasing them:
 *
 *   1. A defect naming `teach` gets teach-part guidance — whole blocks out of `sections[]`, the
 *      two page2 groups that print in the flow — and is told in as many words that support cuts
 *      do not move the number. It must NOT carry the imperative to drop exam_bank questions.
 *   2. A defect naming `support` keeps today's instruction, the one that was always correct for
 *      it: card count, and remove whole items.
 *   3. Whatever the part, the two protections survive — no required property is dropped to save
 *      space, and no diagram is deleted to satisfy a length note.
 */

const svc = require('../../bot/shared/services/lp612-author.service');

const DOC = require('./__fixtures__/v9_gate_base.lp.json');

const gate = (over) => ({ schema: [], lint: [], render: [], warns: [], ...over });

/** The renderer's own sentences, verbatim — a paraphrase here would let the two drift apart. */
const R = require('../../bot/vendor/lp-v9/render_lp.js');
const CAPS = R.pageCapsFor('en');

const TEACH_OVER = `PAGE COUNT: teach needs ${CAPS.max.teach + 3} pages; the cap is ${CAPS.max.teach}. `
  + `The 2 block(s) past the cap are 365px of content, out of teach's 29 — `
  + 'that is what has to come out, and a BLOCK is the unit: shortening the prose inside a block '
  + 'removes no page. Tallest sections in teach: development "Building it up" 9 blocks/1220px, '
  + 'introduction 5 blocks/610px, conclusion 3 blocks/290px. '
  + 'Cut whole blocks from the tallest, or move them to the other part.';

const SUPPORT_OVER = `PAGE COUNT: support needs ${CAPS.max.support + 2} pages; the cap is `
  + `${CAPS.max.support}. Cut it, or move content to the other part.`;

const TEACH_TARGET = `PAGE TARGET: teach runs to ${CAPS.max.teach} pages; the soft target is `
  + `${CAPS.warn.teach} (hard cap ${CAPS.max.teach}). Aim for ${CAPS.warn.teach}: cut whole `
  + 'blocks, or move them to the other part. '
  + 'This is a TARGET, not the cap: the lesson renders and is delivered either way.';

// The two PAGE COUNT problems that name no part at all: the whole-PDF guards at render_lp.js
// :1009 and :1014. Neither can be attributed, so neither may narrow the advice.
const NO_PART = 'PAGE COUNT: the PDF has 9 page(s) but the layout built 8. A block is splitting '
  + 'across a page break.';

const promptFor = (render) => svc.buildRevisionPrompt({
  doc: DOC, gates: gate({ render }), originalUser: 'THE ORIGINAL TASK', notes: null, lang: 'en',
});

const HOWTO = 'HOW TO FIX A PAGE-COUNT ERROR';

/** Just the repair block, so an assertion cannot be satisfied by the document JSON above it. */
function howTo(prompt) {
  const i = prompt.indexOf(HOWTO);
  expect(i).toBeGreaterThan(-1);
  const j = prompt.indexOf('=== LINT WARNINGS ===', i);
  return prompt.slice(i, j > -1 ? j : undefined);
}

describe('a TEACH over-cap is told how to cut TEACH', () => {
  const block = () => howTo(promptFor([TEACH_OVER]));

  test('it names the teach part and the containers a teach page is actually built from', () => {
    const b = block();
    expect(b).toMatch(/TEACH IS OVER/);
    expect(b).toMatch(/sections\[\]/);
    expect(b).toMatch(/block/i);
  });

  test('it does NOT issue the support-page imperative', () => {
    // The whole defect: five rounds of "drop exam_bank questions and model_answers entries"
    // against a part where neither object exists.
    const b = block();
    expect(b).not.toMatch(/drop exam_bank questions/);
    expect(b).not.toMatch(/REMOVE WHOLE ITEMS/);
  });

  test('it says out loud that cutting the support page does not move this number', () => {
    // Naming the wrong lever is the counter-pressure. The model reached for it for five rounds.
    expect(block()).toMatch(/support page.{0,120}(not|never)|(not|never).{0,120}support page/i);
  });

  test('mistakes and differentiation are described where bd-a8veu.10 put them — in the flow', () => {
    const b = block();
    expect(b).toMatch(/page2\.mistakes/);
    expect(b).toMatch(/page2\.differentiation/);
  });

  test('a PAGE TARGET on teach gets the same teach guidance', () => {
    // The soft target is priced exactly like the cap (bd-a8veu.22) and is the lever that is
    // supposed to pull a 7-page lesson down to 5. Handing it support advice wastes the round.
    expect(howTo(promptFor([TEACH_TARGET]))).toMatch(/TEACH IS OVER/);
  });
});

describe('a SUPPORT over-cap keeps the instruction that was always right for it', () => {
  const block = () => howTo(promptFor([SUPPORT_OVER]));

  test('card count, and remove whole items', () => {
    const b = block();
    expect(b).toMatch(/pages are spent on CARD COUNT/);
    expect(b).toMatch(/REMOVE WHOLE ITEMS/);
    expect(b).toMatch(/drop exam_bank questions and model_answers entries/);
  });

  test('it does not hand the model the teach-part advice instead', () => {
    expect(block()).not.toMatch(/TEACH IS OVER/);
  });
});

describe('both parts, and neither', () => {
  test('both over at once gets both clauses', () => {
    const b = howTo(promptFor([TEACH_OVER, SUPPORT_OVER]));
    expect(b).toMatch(/TEACH IS OVER/);
    expect(b).toMatch(/SUPPORT IS OVER/);
  });

  test('a PAGE COUNT that names no part gets both — an unattributable defect may not narrow', () => {
    const b = howTo(promptFor([NO_PART]));
    expect(b).toMatch(/TEACH IS OVER/);
    expect(b).toMatch(/SUPPORT IS OVER/);
  });

  test('no page-count defect, no repair block', () => {
    const p = svc.buildRevisionPrompt({
      doc: DOC,
      gates: gate({ render: ['OVERFLOW on s2: content is 40px taller than the page.'] }),
      originalUser: 'x', notes: null, lang: 'en',
    });
    expect(p).not.toContain(HOWTO);
  });
});

describe('the two protections survive on every branch', () => {
  test.each([['teach', TEACH_OVER], ['support', SUPPORT_OVER], ['neither', NO_PART]])(
    '%s — no required property is dropped, and no diagram is deleted',
    (_name, defect) => {
      const b = howTo(promptFor([defect]));
      expect(b).toMatch(/NEVER REMOVE A REQUIRED PROPERTY/);
      expect(b).toMatch(/stuck, barrier and early/);
      expect(b).toMatch(/DO NOT REMOVE A DIAGRAM/);
    },
  );
});
