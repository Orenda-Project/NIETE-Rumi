/**
 * Repair ONE cached Urdu render, all the way back onto its own R2 objects and its own row.
 *
 * Split out of `lp612-overlay-backfill.service.js` (bd-0t9ce) because that file was at the
 * 300-line limit and this is a real seam: the backfill WALKS the corpus and decides which rows
 * deserve a repair; this decides what repairing one row means and how it may fail.
 *
 * ── WHY THIS FILE EXISTS AT ALL, which is the part worth reading ──────────────
 *
 * The first version called `renderLessonPlan()` bare and let any throw become a failure. That made
 * the repair path STRICTER THAN THE DELIVERY PATH, and the product has exactly one rule about
 * that: `lp612-render-policy.service.js`. `deliveryVerdict()` says PAGE COUNT is deliverable and
 * flagged `over_cap` — "a long lesson is not a damaged one" (bd-vjk68, operator 2026-09-04: "we
 * will stop cancelling or delaying lesson plans now because of the length issue"). The author
 * worker has applied that verdict since bd-oak77.14, so a PAGE COUNT lesson reaches teachers
 * today. The backfill refusing to repair one meant refusing to fix a lesson the bot itself ships.
 *
 * Measured on production 2026-09-16 (correlationId bd-idneu-repair-1789569145858): of 52 repairable
 * rows, 16 were repaired and 36 refused — 35 PAGE COUNT, 0 TRUNCATION. And TWO of the 36 had
 * rendered CLEAN when the sweep rendered them untouched: the three Urdu provenance strings the
 * top-up adds are longer set in Nastaliq than the English they replace, and that alone pushed a
 * document sitting at the teach cap past it. The pass created the condition it then refused for,
 * so those rows could never be repaired by re-running it. That is the defect, not the page count.
 *
 * ── WHAT DID NOT CHANGE ──────────────────────────────────────────────────────
 *
 * TRUNCATION still fails, and it is the only class that does. Pages of the lesson are MISSING FROM
 * THE FILE; writing that over a teacher's cached PDF would replace a whole lesson with a truncated
 * one. An `infra` failure fails too — a Chromium that never launched produced no PDF to upload.
 *
 * The verdict is IMPORTED, never re-implemented. bd-oak77.14 already recorded what a second copy
 * of this rule costs; this is the fourth call site and it must stay the fourth reader of one rule.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const supabase = require('../config/supabase');
const { uploadBuffer } = require('../storage/r2');
const { renderLessonPlan } = require('./lp612-render.service');
const { deliveryVerdict } = require('./lp612-render-policy.service');
const { topUpOverlay } = require('./lp612-overlay-topup.service');

const RENDERS = 'niete_lp612_renders';

/** Everything the overlay pass wants for context, taken from the document being repaired. */
function segmentFor(row, lpDoc) {
  const p = (lpDoc && lpDoc.provenance) || {};
  return {
    segment_id: row.segment_id,
    subject: p.subject,
    grade: p.grade,
    topic: p.topic,
    language: p.medium,
  };
}

/**
 * Render the repaired document, and answer the ONE question the product already has a rule for:
 * may this go in front of a teacher?
 *
 * The renderer writes the PDF and only then inspects its own report, so a defect throw still
 * carries `pdfPath` and `pageCount` for a complete, correct, merely-longer-than-we-wanted file
 * (lp612-render.service.js:344). That is what makes an over-cap repair a file read rather than a
 * second render.
 *
 * @returns {Promise<{pdfPath:string, pageCount:number, overCap:boolean, degraded:boolean,
 *                    degradedBy:string[]}>}
 * @throws  the renderer's own error, unchanged, when the verdict is not deliverable.
 */
async function renderForRepair(args) {
  try {
    const ok = await renderLessonPlan(args);
    return {
      pdfPath: ok.pdfPath, pageCount: ok.pageCount,
      overCap: false, degraded: false, degradedBy: [],
    };
  } catch (e) {
    const hasPdf = typeof e.pdfPath === 'string' && e.pdfPath.length > 0;
    const verdict = deliveryVerdict(e && e.problems, { hasPdf, infra: e && e.infra });
    if (!verdict.deliverable) throw e;
    return {
      pdfPath: e.pdfPath,
      pageCount: e.pageCount ?? null,
      overCap: verdict.overCap,
      degraded: verdict.degraded,
      degradedBy: verdict.degradedBy || [],
    };
  }
}

/** Repair one row, all the way back onto its own objects. Throws; the caller records and moves on. */
async function repairRow(row, lpDoc, { model, correlationId, keys }) {
  const { pdfKey, docKey } = keys;

  const up = await topUpOverlay({
    lpDoc, segment: segmentFor(row, lpDoc), model, correlationId,
  });
  if (!up.toppedUp) return { repaired: false, reason: up.reason };

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), `lp612-backfill-${row.segment_id}-`));
  try {
    const rendered = await renderForRepair({
      lpDoc: up.doc,
      lang: row.lang,
      stem: row.segment_id,
      outDir,
      correlationId,
      segmentId: row.segment_id,
      phase: 'backfill',
    });

    // Document first — see the backfill's header. A crash between these two writes must leave the
    // repaired document under a stale PDF, never a repaired PDF over a stale document.
    await uploadBuffer(Buffer.from(JSON.stringify(up.doc), 'utf8'), docKey, 'application/json');
    await uploadBuffer(fs.readFileSync(rendered.pdfPath), pdfKey, 'application/pdf');

    const { error } = await supabase.from(RENDERS)
      .update({ page_count: rendered.pageCount, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (error) throw new Error(`row ${row.id}: patch failed after upload — ${error.message}`);

    return {
      repaired: true,
      added: up.added,
      pageCount: rendered.pageCount,
      usage: up.usage,
      // Carried onto the summary row, never swallowed: a pass that quietly ships long lessons is
      // indistinguishable from one that shipped clean ones, and the caps moved for a reason.
      overCap: rendered.overCap,
      degraded: rendered.degraded,
      degradedBy: rendered.degradedBy,
    };
  } finally {
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* temp dir */ }
  }
}

module.exports = { repairRow, renderForRepair, segmentFor };
