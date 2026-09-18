/**
 * TOPPING UP A CACHED URDU OVERLAY — bd-idneu, the purge half of bd-yhd16.
 *
 * bd-x3dn6 widened `overlayTargets()` so an Urdu lesson's own TITLE and running header can finally
 * be Urdu: `/provenance/topic`, `/provenance/chapter` and `/provenance/chapter_title` are offered
 * now and were not before. Measured on the gate fixture, 89 pointers became 92.
 *
 * THE FIX REACHES NEW DOCUMENTS ONLY. 302 Urdu renders are already cached, and a cache hit returns
 * the stored artifact untouched (`lp612-serving.service.js`), so every one of them keeps serving an
 * English title over Urdu prose. Promoting the fix does not move a single one of them.
 *
 * AND THE OBVIOUS LEVER IS A SILENT NO-OP. `LP_612_TEMPLATE_VERSION` leads the R2 key, so bumping
 * it turns every cached lesson into a miss — but `lp612-author.worker.js` says it in as many words:
 * *a template bump is a re-render, not a re-authoring*. `reuseFromPreviousVersion()` finds the
 * stored `.lp.json`, returns it with `llmCalls: 0`, and the pre-fix overlay comes back with it.
 *
 * So the real choice was: re-author the whole fleet (English included, ~$1.50 a lesson), delete the
 * Urdu rows and re-author 302 documents, or ASK THE MODEL FOR THE STRINGS IT WAS NEVER ASKED FOR.
 * This module is the third. Cents per document, and — the reason it is the safe one — the lesson
 * body is never re-generated, so prose that has already passed every gate and been read by teachers
 * cannot regress.
 *
 * FOUR RULES, each one a way this could have gone wrong:
 *
 *   1. THE DELTA IS DERIVED FROM `overlayTargets()`, NEVER HAND-LISTED. A second copy of that rule
 *      is precisely what the linter's own comment warns about, and a hard-coded list of three
 *      pointers is stale the next time the target set moves.
 *   2. AN UNOVERLAID DOCUMENT IS REFUSED. Translating three pointers onto an English document
 *      yields an Urdu title over English prose — worse than the bug, and it would report success.
 *      That document needs a re-author, which is a bigger and more expensive decision than this
 *      pass is allowed to take on anyone's behalf.
 *   3. AN EXISTING TRANSLATION ALWAYS WINS. Re-rolling 89 good strings is both the cost this exists
 *      to avoid and a way to change a page a teacher has already taught from.
 *   4. IT THROWS RATHER THAN DEGRADING. `overlayLessonPlan` gates its own output — Urdu script,
 *      then coverage against the MERGED document. A failure here means the stored document is left
 *      exactly as it was, still serving, still with an English title. That is the status quo, which
 *      is a worse page but a known one; a half-merged document is neither.
 *
 * WHAT THIS MODULE DOES NOT DO. It does not fetch from R2, re-render, upload, or touch a row. It
 * takes a document and returns a document. The corpus walk that drives it is a separate, explicitly
 * production-reaching step.
 */

const path = require('path');

const V = path.join(__dirname, '..', '..', 'vendor', 'lp-v9');
const { overlayDefects } = require(path.join(V, 'lint_lp.js'));
const { overlayLessonPlan } = require('./lp612-author.service');

/**
 * The pointers bd-x3dn6 added. Documentation and log legibility ONLY — never the definition of the
 * delta, which comes from `overlayTargets()` so that a later widening is picked up without anyone
 * editing this file.
 */
const PROVENANCE_TOPUP_POINTERS = Object.freeze([
  '/provenance/topic',
  '/provenance/chapter',
  '/provenance/chapter_title',
]);

/** Why a document was not topped up. A named reason, so a corpus run is countable by cause. */
const TOPUP_SKIPPED = Object.freeze({
  NOT_A_DOC: 'not_a_document',
  NOT_OVERLAID: 'not_overlaid',
  COMPLETE: 'already_complete',
});

/**
 * The JSON Pointers the CURRENT gate offers that this document's stored overlay does not carry.
 *
 * Never throws: it runs over documents pulled out of R2 that were written by older code, and a
 * throw in the middle of a 302-document walk loses the walk, not just the document.
 *
 * @param {object} doc a stored `lp_doc`
 * @returns {string[]} in `overlayTargets()` order
 */
function missingOverlayPointers(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [];

  let targets;
  try {
    targets = overlayDefects.targets(doc);
  } catch {
    // A document shaped in a way the current walker cannot read is a finding for the caller's
    // ledger, not a crash. It is also not a top-up candidate: we cannot say what it is missing.
    return [];
  }
  if (!Array.isArray(targets)) return [];

  const have = (doc.ur_overlay && typeof doc.ur_overlay === 'object' && !Array.isArray(doc.ur_overlay))
    ? doc.ur_overlay
    : {};

  return targets.filter((ptr) => !Object.prototype.hasOwnProperty.call(have, ptr));
}

/** True when the document carries an overlay we can add to — i.e. it was authored as an Urdu one. */
function hasOverlay(doc) {
  const ov = doc && doc.ur_overlay;
  return !!ov && typeof ov === 'object' && !Array.isArray(ov) && Object.keys(ov).length > 0;
}

/**
 * Translate the pointers a stored Urdu document is missing, and merge them into its overlay.
 *
 * ONE model call, and only when there is something to ask for. The returned document is a COPY:
 * a throw anywhere in here leaves the caller's stored document untouched, which matters because
 * the caller is about to write it back to R2 over the only copy that exists.
 *
 * @param {object}  args.lpDoc   the stored document, overlay and all
 * @param {object}  args.segment for subject/grade/topic context and telemetry
 * @param {string} [args.model]
 * @param {string} [args.correlationId]
 * @returns {Promise<{toppedUp:boolean, reason?:string, doc:object, added:string[],
 *                    missing:string[], usage?:object, model?:string}>}
 * @throws whatever `overlayLessonPlan` throws — OVERLAY_NOT_URDU, OVERLAY_TOO_THIN,
 *         OVERLAY_LLM_FAILED, OVERLAY_UNPARSEABLE. The caller skips that document and records it.
 */
async function topUpOverlay({ lpDoc, segment, model, correlationId } = {}) {
  if (!lpDoc || typeof lpDoc !== 'object' || Array.isArray(lpDoc)) {
    return { toppedUp: false, reason: TOPUP_SKIPPED.NOT_A_DOC, doc: lpDoc, added: [], missing: [] };
  }

  // Rule 2. Checked BEFORE the delta, because a document with no overlay reports its whole target
  // set as missing and would otherwise look like the most urgent case in the corpus.
  if (!hasOverlay(lpDoc)) {
    return {
      toppedUp: false, reason: TOPUP_SKIPPED.NOT_OVERLAID, doc: lpDoc, added: [], missing: [],
    };
  }

  const missing = missingOverlayPointers(lpDoc);
  if (!missing.length) {
    return { toppedUp: false, reason: TOPUP_SKIPPED.COMPLETE, doc: lpDoc, added: [], missing: [] };
  }

  const base = lpDoc.ur_overlay;
  const out = await overlayLessonPlan({
    lpDoc, segment, model, correlationId, targets: missing, baseOverlay: base,
  });

  // Rule 3, applied here rather than trusted upstream: `overlayLessonPlan` already drops a pointer
  // it was not asked for, but the merge is where an existing translation would actually be lost, so
  // that is where it is defended.
  const merged = { ...(out.overlay || {}), ...base };
  const added = Object.keys(out.overlay || {})
    .filter((ptr) => !Object.prototype.hasOwnProperty.call(base, ptr));

  const doc = { ...lpDoc, ur_overlay: merged };

  return {
    toppedUp: added.length > 0,
    doc,
    added,
    missing,
    usage: out.usage,
    model: out.model,
  };
}

module.exports = {
  PROVENANCE_TOPUP_POINTERS,
  TOPUP_SKIPPED,
  missingOverlayPointers,
  topUpOverlay,
};
