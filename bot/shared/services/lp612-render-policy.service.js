/**
 * lp612-render-policy — WHICH RENDER DEFECTS MAY STILL REACH A TEACHER.
 *
 * ONE module, because there are now three callers of this judgement and they were drifting:
 * the worker's final render (`renderFinal`), the author service's timeout recovery
 * (`isDeliverable`), and the Urdu overlay pass's fallback. bd-vjk68 already warned that a second
 * copy of the page-count clause "would fail every Urdu lesson for being long"; this file is that
 * warning taken seriously — the predicate lives in exactly one place and every caller imports it.
 *
 * THE POLICY, and where it comes from.
 *
 *   Operator, 2026-09-04: *"we will stop cancelling or delaying lesson plans now because of the
 *   length issue"*. bd-vjk68 implemented that for LENGTH and bd-0cdug for TIME.
 *
 *   2026-09-06, the FIRST Urdu tap on production (`grade_12_chemistry.c14.p227-230`, row
 *   c41e8fd2-f401-42bc-a177-0897f36a1678) died 5m12s in with ONE defect left:
 *
 *     FIGURE TOO SMALL: diagram "molecule" renders its smallest label at 13.25px in a 729px
 *     column (floor 13.5px). It needs 743px of width — give it a full-width row, or simplify it.
 *
 *   13.25 against a floor of 13.5. A finished, correct, 12-page lesson — already written to disk
 *   as a PDF — was thrown away and replaced with an apology because one diagram's atom labels
 *   were 1.9% under a legibility floor, on a figure that was ALREADY in a full-width row so the
 *   renderer's own advice had nothing left to give. The English tap of the same segment six
 *   minutes earlier delivered fine.
 *
 * SO THE BAR MOVES, ONCE, AND IN ONE DIRECTION: a defect that makes the document UGLIER is
 * delivered and flagged. A defect that makes it INCOMPLETE is not.
 *
 *   DELIVERED, flagged `render_degraded`:
 *     • PAGE COUNT   — a part ran past its cap. Unchanged (bd-vjk68); still flagged `over_cap`,
 *                      NOT `render_degraded`: a long lesson is not a damaged one.
 *     • FIGURE TOO SMALL / FIGURE TOO TALL — a diagram prints small, or takes more height than we
 *                      wanted. The words around it are intact and say the same thing.
 *     • TYPE FLOOR   — body or chip type under the phone-readable floor. Small, not missing.
 *     • OVERFLOW     — the bottom of one page is crowded. The renderer already absorbs the
 *                      furniture-sized ones (bd-c3le6); what is left here is a page that reads
 *                      tight. She is TOLD (see `lp612DegradedPage`).
 *     • anything else the renderer may learn to say — an UNKNOWN defect string is degraded, not
 *                      fatal, because the alternative is that adding a finding to the renderer
 *                      silently starts failing lessons.
 *
 *   NOT DELIVERED — the document is incomplete, not imperfect:
 *     • no PDF at all: an infra failure (`e.infra === true`), SCHEMA_INVALID, OVERLAY_INVALID.
 *       There is nothing on disk to send.
 *     • TRUNCATION — the PDF has FEWER pages than the layout built. Pages of her lesson are
 *       MISSING FROM THE FILE; the plan just ends. render_lp.js calls this "the most expensive
 *       defect this renderer can ship" and it is the one class where a retry genuinely beats what
 *       we have. `LP612_DELIVER_TRUNCATED=true` is the operator's one-variable override if he
 *       decides otherwise; there is no code change behind it.
 *
 * Matching is on the renderer's OWN emitted prefixes (render_lp.js / lib/template.js), the same
 * way `isAdvisory` matches the lint's `CODE: message` shape — never a substring search that could
 * catch the words inside someone's prose, and never a paraphrase this file would keep in sync by
 * hand.
 */

/**
 * `PAGE COUNT: <part> needs N pages; the cap is M.` — render_lp.js
 *
 * bd-a8veu.22 adds `PAGE TARGET: <part> runs to N pages; the soft target is M (hard cap C).`, the
 * renderer's SOFT target. It is a warning, not a `problem`, so it can never arrive here from a
 * FINAL render — that render returned, which is how the warning was read in the first place. It
 * reaches this file only through the ladder's `isDeliverableRenderDefect`, and the answer there is
 * the easy one: a document the renderer was willing to print is a document a teacher may have.
 */
const isPageCount = (d) => /^PAGE (COUNT|TARGET):/.test(String(d));
/** `TRUNCATION: the PDF has N page(s) but the layout built M` — render_lp.js */
const isTruncation = (d) => String(d).startsWith('TRUNCATION:');
/** `FIGURE TOO SMALL: ...` / `FIGURE TOO TALL: ...` — lib/template.js */
const isFigure = (d) => /^FIGURE TOO (SMALL|TALL):/.test(String(d));
/** `TYPE FLOOR: smallest body text is Npx` — render_lp.js */
const isTypeFloor = (d) => String(d).startsWith('TYPE FLOOR:');
/** `OVERFLOW on <page>: content is Npx taller than the page.` — render_lp.js */
const isOverflow = (d) => String(d).startsWith('OVERFLOW on ');
/** The gate's own "I could not verify this" string — never a FINAL-render defect, but if it ever
 *  reaches one it means the document was never examined, which is not the same as clean. */
const isUnverified = (d) => String(d).startsWith('RENDER_INFRA:');

function deliverTruncated() {
  return String(process.env.LP612_DELIVER_TRUNCATED || '').toLowerCase() === 'true';
}

/**
 * Bucket a renderer `problems` list.
 * @returns {{pageCount:string[], figure:string[], typeFloor:string[], overflow:string[],
 *            truncation:string[], unverified:string[], other:string[]}}
 */
function classifyProblems(problems) {
  const out = {
    pageCount: [], figure: [], typeFloor: [], overflow: [], truncation: [], unverified: [], other: [],
  };
  for (const d of Array.isArray(problems) ? problems : []) {
    if (isPageCount(d)) out.pageCount.push(d);
    else if (isTruncation(d)) out.truncation.push(d);
    else if (isFigure(d)) out.figure.push(d);
    else if (isTypeFloor(d)) out.typeFloor.push(d);
    else if (isOverflow(d)) out.overflow.push(d);
    else if (isUnverified(d)) out.unverified.push(d);
    else out.other.push(d);
  }
  return out;
}

/**
 * MAY THIS RENDER BE SENT TO A TEACHER?
 *
 * @param {string[]} problems  the renderer's own defect strings
 * @param {{hasPdf?:boolean, infra?:boolean}} [ctx]  `hasPdf` false (or `infra` true) means there
 *   is no file on disk — nothing can be delivered whatever the list says.
 * @returns {{deliverable:boolean, overCap:boolean, degraded:boolean, classes:string[],
 *            blocking:string[], degradedBy:string[]}}
 *   `classes` are the stable machine names that go on the event and in the bead-searchable log:
 *   'figure' | 'type_floor' | 'overflow' | 'unverified' | 'other'. `overCap` is reported
 *   SEPARATELY from `degraded` — a long lesson is not a damaged one and the two flags answer two
 *   different questions.
 */
function deliveryVerdict(problems, ctx = {}) {
  const c = classifyProblems(problems);
  // `unverified` blocks with truncation, and for the same kind of reason: RENDER_INFRA means the
  // document was never EXAMINED, and an unexamined document is not a whole one — the empty defect
  // list behind it means "we could not look", not "we looked and it was fine" (bd-htueq's whole
  // point). It cannot reach a FINAL render today (the string is emitted by the ladder's gate), and
  // if it ever does, failing is the honest outcome.
  const blocking = [...c.unverified, ...(deliverTruncated() ? [] : c.truncation)];
  const degradedBy = [...c.figure, ...c.typeFloor, ...c.overflow, ...c.other,
    ...(deliverTruncated() ? c.truncation : [])];
  const classes = [];
  if (c.figure.length) classes.push('figure');
  if (c.typeFloor.length) classes.push('type_floor');
  if (c.overflow.length) classes.push('overflow');
  if (c.other.length) classes.push('other');
  if (deliverTruncated() && c.truncation.length) classes.push('truncation');

  const noFile = ctx.infra === true || ctx.hasPdf === false;
  const deliverable = !noFile && blocking.length === 0;
  return {
    deliverable,
    overCap: deliverable && c.pageCount.length > 0,
    degraded: deliverable && degradedBy.length > 0,
    classes,
    blocking,
    degradedBy,
  };
}

/**
 * The single most severe class present, for the ONE honest line the teacher gets.
 *
 * Rule 24(d): one shared fallback sentence across N distinct states misdirects every field report
 * after it. Two states are visible to her and they are different complaints —
 *   'page'   the bottom of a page is crowded (OVERFLOW / TRUNCATION-if-enabled),
 *   'figure' a diagram or a label prints small (FIGURE / TYPE FLOOR),
 * and 'page' wins when both are present because it is the one that can cost her words.
 * Returns null when there is nothing she would notice.
 */
function degradedNotice(classes) {
  const s = new Set(classes || []);
  if (s.has('overflow') || s.has('truncation')) return 'page';
  if (s.has('figure') || s.has('type_floor')) return 'figure';
  if (s.has('other')) return 'figure';
  return null;
}

/**
 * Is ONE defect string a render finding a teacher may still be sent?
 *
 * Exported for the AUTHOR SERVICE's `isDeliverable`, which judges a candidate whose defect list
 * mixes the renderer's findings with the canon LINT's (`CODE: message`). The full `deliveryVerdict`
 * cannot be used there: it classifies an unrecognised string as `other` and DELIVERS it, which is
 * right for the renderer (a new finding must never silently start failing lessons) and wrong for
 * the lint (an unrecognised lint code is a document-quality defect the ladder is entitled to keep
 * working on). So the ladder asks about each string explicitly, and anything this does not
 * recognise keeps blocking exactly as it does today.
 */
const isDeliverableRenderDefect = (d) => isPageCount(d) || isFigure(d) || isTypeFloor(d)
  || isOverflow(d) || (deliverTruncated() && isTruncation(d));

module.exports = {
  classifyProblems,
  isDeliverableRenderDefect,
  deliveryVerdict,
  degradedNotice,
  deliverTruncated,
  // exported for the tests and for anyone adding a renderer finding: if you add a `problems`
  // string, add its matcher here or it becomes an 'other' — degraded, never fatal, by design.
  isPageCount, isTruncation, isFigure, isTypeFloor, isOverflow, isUnverified,
};
