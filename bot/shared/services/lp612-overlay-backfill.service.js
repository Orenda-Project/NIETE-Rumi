/**
 * WALKING THE CACHE AND PUTTING THE REPAIR BACK — bd-idneu, the driver half.
 *
 * `lp612-overlay-topup.service` repairs one document in memory. This walks `niete_lp612_renders`,
 * fetches each stored Urdu document out of R2, tops it up, re-renders it, and writes the result
 * back over the same objects — so that the ~302 cached Urdu lessons stop serving an English title
 * over Urdu prose without anyone re-authoring a single lesson.
 *
 * THIS IS THE HALF THAT TOUCHES PRODUCTION. It overwrites live R2 objects and patches live rows,
 * and the shape of the module is mostly the consequences of that:
 *
 *   DRY RUN IS THE DEFAULT AND COSTS NOTHING. `backfillUrduOverlays()` with no arguments reads,
 *   classifies, and reports. It does not call the model, does not render, does not upload, does not
 *   patch. A driver whose zero-argument call rewrites the corpus is one absent-minded `node -e` away
 *   from an accident nobody can undo, and the inventory is the thing a live run gets approved from.
 *
 *   THE REPAIR OVERWRITES IN PLACE. The cache key is `segment_id + lang + template_version`, and
 *   the row already points at `r2_key`. A repaired PDF written anywhere else is invisible to every
 *   future cache hit: the run reports success and no teacher sees a different page. So the key is
 *   DERIVED from the row and then checked against the row's own `r2_key`, and a disagreement is a
 *   refusal rather than a guess — see `backfillKeysFor`.
 *
 *   THE DOCUMENT GOES UP BEFORE THE PDF. If the process dies between the two writes, doc-then-pdf
 *   leaves a repaired document under a stale PDF, and the next template bump re-renders it correctly
 *   (a template bump is a re-render, not a re-authoring — it reuses the stored document, which is
 *   the whole trap this bead exists inside, and here it works FOR us). Pdf-then-doc leaves the
 *   mirror image: a correct PDF that any future re-render would silently regress. Both orders are
 *   idempotent; only one of them fails safely.
 *
 *   IT STOPS WHEN IT IS CLEARLY BROKEN. A per-row failure is recorded and the walk continues — one
 *   bad document must not cost the other 301. But a run of consecutive failures means the model,
 *   the bucket or Chromium is down, and the honest response to a wall is to stop hitting it.
 *
 * WHAT IT DOES NOT DO. It does not re-author, it does not delete a row, it does not bump
 * `template_version`, and it does not touch an English render. Every one of those is a bigger
 * decision than a repair pass is allowed to take.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const supabase = require('../config/supabase');
const { downloadFromR2, uploadBuffer } = require('../storage/r2');
const { renderLessonPlan } = require('./lp612-render.service');
const Serving = require('./lp612-serving.service');
const { topUpOverlay, missingOverlayPointers } = require('./lp612-overlay-topup.service');
const { refsFromDoc, stageFigures } = require('./lp612-pagetruth.service');
const { logToFile } = require('../utils/logger');
const { logEvent } = require('../utils/structured-logger');

const RENDERS = 'niete_lp612_renders';

/** Why a row was not repaired. Named, so a 302-row run is countable by cause. */
const BACKFILL_SKIPPED = Object.freeze({
  NO_DOC: 'no_stored_doc',
  NOT_OVERLAID: 'not_overlaid',
  COMPLETE: 'already_complete',
  FIGURES_MISSING: 'figures_missing',
});

/**
 * The two objects this row owns — derived from the row's own cache key, then CHECKED against the
 * `r2_key` it already carries.
 *
 * The check is the point. A row whose stored key does not match its own
 * `segment_id + lang + template_version` is not the plain cache entry this repair is written for:
 * it is a hand-patched row, or an edit fork under `.../edits/{segment}/{hash}.pdf`, or a row whose
 * template_version moved after the render. Writing a repair on top of an object we have not
 * identified is worse than leaving the bug in place, and there is no reading of a mismatch that
 * makes overwriting correct.
 *
 * @throws {Error} on a missing or disagreeing `r2_key`
 */
function backfillKeysFor(row) {
  const r = row || {};
  const derived = Serving.r2KeyFor(r.segment_id, r.lang, r.template_version);

  if (!r.r2_key) {
    throw new Error(`row ${r.id}: no r2_key — there is no cached object to repair`);
  }
  if (r.r2_key !== derived) {
    throw new Error(
      `row ${r.id}: r2_key does not match its own cache key (${r.r2_key} vs ${derived}) — `
      + 'refusing to overwrite an object this repair has not identified',
    );
  }

  return {
    pdfKey: Serving.assertKeyInPrefix(derived),
    docKey: Serving.assertKeyInPrefix(Serving.docKeyFor(r.segment_id, r.lang, r.template_version)),
  };
}

/**
 * One row, one verdict, before a token is spent.
 *
 * @param {object} row
 * @param {object|null} lpDoc the stored document, or null when R2 had no object at the doc key
 * @returns {{action:'repair'|'skip', reason?:string, missing?:string[]}}
 */
function classifyRow(row, lpDoc) {
  // R2 had nothing there. The PDF exists and is being served, but the document beside it does not —
  // the worker swallows that upload failure on purpose, so this is a real state and not a bug here.
  // Reading it as "an empty overlay" would turn an unreadable lesson into the corpus's most urgent
  // repair; we cannot repair what we cannot read, and re-authoring is not this driver's call.
  if (!lpDoc || typeof lpDoc !== 'object') {
    return { action: 'skip', reason: BACKFILL_SKIPPED.NO_DOC };
  }

  const ov = lpDoc.ur_overlay;
  const overlaid = !!ov && typeof ov === 'object' && !Array.isArray(ov) && Object.keys(ov).length > 0;
  if (!overlaid) {
    // Three Urdu strings over English prose is a worse page than the bug, and it would report
    // success. Same refusal `topUpOverlay` makes, made here so it costs nothing to reach.
    return { action: 'skip', reason: BACKFILL_SKIPPED.NOT_OVERLAID };
  }

  const missing = missingOverlayPointers(lpDoc);
  if (!missing.length) return { action: 'skip', reason: BACKFILL_SKIPPED.COMPLETE };

  return { action: 'repair', missing };
}

/**
 * AN ABSENT OBJECT AND AN UNREACHABLE BUCKET READ THE SAME AND MEAN THE OPPOSITE.
 *
 * Both come back as "no document", and the first version of this function treated them alike — so
 * the first real dry run reported 309 of 331 rows as `no_stored_doc` when what had actually
 * happened was a DNS failure. Every one of those rows is repairable; the summary said none of them
 * were, and said it in the calm voice of a clean run with zero failures.
 *
 * So: a genuine miss (the key is not in the bucket) is `null`, and the row is skipped for good.
 * Anything else — DNS, credentials, a 500, a truncated body, unparseable JSON — is thrown, which
 * makes it a recorded row failure and lets a wall of them abort the run.
 *
 * @returns {Promise<object|null>} the stored document, or null iff the key genuinely is not there
 * @throws on any failure that is NOT a clean miss
 */
function isNotFound(err) {
  const name = String((err && (err.name || err.Code || err.code)) || '');
  const status = err && err.$metadata && err.$metadata.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || status === 404;
}

async function readStoredDoc(docKey) {
  let buf;
  try {
    buf = await downloadFromR2(docKey);
  } catch (e) {
    if (isNotFound(e)) return null;
    throw new Error(`could not read ${docKey}: ${e.message}`);
  }
  if (!buf) return null;
  try {
    return JSON.parse(Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf));
  } catch (e) {
    // A document that is there but unreadable is an anomaly worth a name, not a quiet skip.
    throw new Error(`stored document at ${docKey} is not parseable JSON: ${e.message}`);
  }
}

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

/** Repair one row, all the way back onto its own objects. Throws; the caller records and moves on. */
async function repairRow(row, lpDoc, { model, correlationId }) {
  const { pdfKey, docKey } = backfillKeysFor(row);

  const up = await topUpOverlay({
    lpDoc, segment: segmentFor(row, lpDoc), model, correlationId,
  });
  if (!up.toppedUp) return { repaired: false, reason: up.reason };

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), `lp612-backfill-${row.segment_id}-`));
  try {
    // bd-u8ii8. THE CROPS COME WITH IT. The renderer inlines a book figure from
    // `<outDir>/<ref>.jpg`, and this directory is brand new — so without this step every
    // `textbook_figure` re-renders as an empty framed box, badge and caption over nothing, and
    // that box is then written over the live PDF. It is invisible: the renderer reports a missing
    // crop through `ctx.warn`, which reaches no delivery verdict and sets no `render_degraded`.
    // Same call, same position, as the authoring worker (lp612-author.worker.js:1051-1053).
    //
    // A crop it cannot fetch REFUSES THE ROW. The lesson on the teacher's phone today has the
    // picture in it; a repair that trades a picture for a title is a regression she would have to
    // notice herself. The row is left for a later run and counted by name in the summary.
    const figRefs = refsFromDoc(up.doc);
    if (figRefs.length) {
      const { missing } = await stageFigures({ refs: figRefs, outDir, correlationId });
      if (missing.length) {
        return { repaired: false, reason: BACKFILL_SKIPPED.FIGURES_MISSING, missing };
      }
    }

    const rendered = await renderLessonPlan({
      lpDoc: up.doc,
      lang: row.lang,
      stem: row.segment_id,
      outDir,
      correlationId,
      segmentId: row.segment_id,
      phase: 'backfill',
    });

    // Document first — see the header. A crash between these two writes must leave the repaired
    // document under a stale PDF, never a repaired PDF over a stale document.
    await uploadBuffer(Buffer.from(JSON.stringify(up.doc), 'utf8'), docKey, 'application/json');
    await uploadBuffer(fs.readFileSync(rendered.pdfPath), pdfKey, 'application/pdf');

    const { error } = await supabase.from(RENDERS)
      .update({ page_count: rendered.pageCount, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (error) throw new Error(`row ${row.id}: patch failed after upload — ${error.message}`);

    return { repaired: true, added: up.added, pageCount: rendered.pageCount, usage: up.usage };
  } finally {
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* temp dir */ }
  }
}

/**
 * Walk the cached Urdu renders and repair the ones missing the pointers bd-x3dn6 added.
 *
 * @param {boolean} [args.dryRun=true]   THE DEFAULT. Inventory only: no model call, no render,
 *                                       no upload, no row patch.
 * @param {number}  [args.limit=1000]
 * @param {string}  [args.templateVersion] restrict to one template version
 * @param {number}  [args.maxConsecutiveFailures=5] abort after this many failures in a row
 * @returns {Promise<object>} the run summary — the only thing anyone reads after 302 rows
 */
async function backfillUrduOverlays({
  dryRun = true, limit = 1000, templateVersion, model, correlationId,
  maxConsecutiveFailures = 5, onProgress,
} = {}) {
  let q = supabase.from(RENDERS)
    .select('id, segment_id, lang, template_version, status, r2_key, page_count')
    .eq('lang', 'ur')
    .eq('status', 'ready');
  if (templateVersion) q = q.eq('template_version', templateVersion);

  const { data, error } = await q.order('segment_id', { ascending: true }).limit(limit);
  if (error) throw new Error(`lp612 overlay backfill could not read ${RENDERS}: ${error.message}`);

  const summary = {
    dryRun,
    scanned: 0,
    wouldRepair: 0,
    repaired: 0,
    skipped: {},
    failed: [],
    aborted: false,
    rows: [],
  };
  const skip = (reason) => { summary.skipped[reason] = (summary.skipped[reason] || 0) + 1; };

  let consecutive = 0;

  for (const row of (data || [])) {
    summary.scanned += 1;
    try {
      const { docKey } = backfillKeysFor(row);
      const lpDoc = await readStoredDoc(docKey);
      const verdict = classifyRow(row, lpDoc);

      if (verdict.action === 'skip') {
        skip(verdict.reason);
        summary.rows.push({ segmentId: row.segment_id, action: 'skip', reason: verdict.reason });
        consecutive = 0;
        continue;
      }

      summary.wouldRepair += 1;
      summary.rows.push({
        segmentId: row.segment_id, action: 'repair', missing: verdict.missing,
      });

      if (!dryRun) {
        const res = await repairRow(row, lpDoc, { model, correlationId });
        if (res.repaired) summary.repaired += 1; else skip(res.reason);
      }
      consecutive = 0;
    } catch (e) {
      summary.failed.push({ segmentId: row.segment_id, error: e.message });
      consecutive += 1;
      logToFile('lp612 overlay backfill: row failed', {
        segmentId: row.segment_id, error: e.message,
      }, 'error');
      if (consecutive >= maxConsecutiveFailures) {
        // A wall, not a bad document. Keep spending and this just buys 300 more of the same error.
        summary.aborted = true;
        break;
      }
    }
    if (typeof onProgress === 'function') onProgress(summary);
  }

  logEvent('lp612.overlay.backfill', {
    dryRun, scanned: summary.scanned, wouldRepair: summary.wouldRepair,
    repaired: summary.repaired, failed: summary.failed.length, aborted: summary.aborted,
    correlationId: correlationId || null,
  });

  return summary;
}

module.exports = {
  BACKFILL_SKIPPED,
  backfillKeysFor,
  classifyRow,
  repairRow,
  backfillUrduOverlays,
};
