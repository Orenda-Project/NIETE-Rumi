/**
 * The job that writes a 6-12 lesson nobody has asked for before.
 *
 * Author -> render -> store -> deliver, in that order, for one
 * (segment, lang, template_version). It runs on the SQS worker rather than the
 * web service because it takes minutes: ~2-3 typically, and up to ~10 when the
 * revision ladder runs its full length. The webhook cannot wait that long and
 * the teacher should not have to look at a spinner while it does.
 *
 * Three properties this job has to hold, each of them learned rather than
 * assumed:
 *
 *  - **Every waiter gets the lesson — including the ones who arrived while it was
 *    being written.** The audience is the list as it stands AT THE END, claimed
 *    atomically once the terminal status is written, never a snapshot taken
 *    minutes earlier at the top of the job. One delivery failure does not cancel
 *    the others.
 *  - **SQS delivers at least once.** A redelivered job whose render is already
 *    `ready` must not author a second time; the status check at the top is the
 *    idempotency key.
 *  - **No silent failure.** Every exit path either sends a PDF or sends a
 *    sentence, and writes a status and an error code to the row so the next tap
 *    knows to retry rather than joining a run that is never coming back.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const supabase = require('../shared/config/supabase');
const { logToFile } = require('../shared/utils/logger');
// Additive semantic-event channel (feature.action.result). Every prose line stays as it was.
const { logEvent } = require('../shared/utils/structured-logger');
const WhatsAppService = require('../shared/services/whatsapp.service');
const { uploadBuffer } = require('../shared/storage/r2');
const { resolveUx } = require('../shared/config/ux-strings');
const { authorLessonPlan } = require('../shared/services/lp612-author.service');
const { renderLessonPlan } = require('../shared/services/lp612-render.service');
// The caps the renderer gated on, read from the renderer itself so the over-cap event can never
// quote a number the gate did not use (bd-vjk68). Never retyped here — see `pageCapsFor`.
const { pageCapsFor } = require('../vendor/lp-v9/render_lp.js');
const Serving = require('../shared/services/lp612-serving.service');
const {
  resolveAuthorModel, authorTierFor, authorRounds, authorTimeoutMs, followupAfterMs,
} = require('../shared/config/lp612-flags');
const { familyForBook } = require('../shared/config/lp612-families');

const RENDERS = 'niete_lp612_renders';
const SEGMENTS = 'niete_lp612_segments';

const nowIso = () => new Date().toISOString();

/** null, not the string "undefined": this goes into a TEXT column that serving
 *  tests for emptiness before it sends anything. */
function oneScreenOf(authored) {
  const v = authored && authored.lpDoc && authored.lpDoc.one_screen;
  return v ? String(v) : null;
}

async function loadRender(renderId) {
  const { data, error } = await supabase
    .from(RENDERS)
    .select('id, status, waiters, segment_id, lang, template_version')
    .eq('id', renderId)
    .maybeSingle();
  if (error) {
    logToFile('LP 6-12 worker: render lookup failed', { renderId, error: error.message });
    return null;
  }
  return data || null;
}

async function loadSegment(segmentId) {
  const { data, error } = await supabase
    .from(SEGMENTS)
    .select('*')
    .eq('segment_id', segmentId)
    .maybeSingle();
  if (error) {
    logToFile('LP 6-12 worker: segment lookup failed', { segmentId, error: error.message });
    return null;
  }
  return data || null;
}

/**
 * Take the job, and RECORD THAT WE TOOK IT.
 *
 * bd-dr216: `niete_lp612_renders` had one clock where it needed two. `started_at` is the INSERT's
 * own `DEFAULT NOW()` — it says when the teacher asked, i.e. when the job was ENQUEUED — and
 * nothing anywhere recorded when a worker actually began. The stranded-render reaper therefore
 * measured a run's age from enqueue and condemned jobs that were still sitting in the queue,
 * unattempted, at ~17 minutes. Under the current one-replica capacity fault (bd-nxkme) the measured
 * p90 enqueue->done is 1023s, so ordinary queue wait crossed that line by itself.
 *
 * This is that second clock. It is written at PICKUP and re-written on every redelivery, so the
 * reaper always measures the latest attempt.
 *
 * IT IS ALSO THE IDEMPOTENCY CHECK, which it was not before. `process()` used to read the row and
 * then compare `status !== 'authoring'` in JS — two statements, so two deliveries of the same
 * at-least-once message could both read `authoring` and both author the same lesson (~$0.60 and a
 * scarce authoring slot each). Guarding the stamp on `status = 'authoring'` makes claiming and
 * checking one statement: exactly one delivery matches a row, and the loser is told it lost.
 *
 * @returns {boolean} true if this worker owns the run.
 */
async function claimPickup(renderId) {
  const { data, error } = await supabase
    .from(RENDERS)
    .update({ picked_up_at: nowIso(), updated_at: nowIso() })
    .eq('id', renderId)
    .eq('status', 'authoring')
    .select('id')
    .maybeSingle();
  if (error) {
    // Not fatal to the job — the lesson is what she is owed and the row is already `authoring`.
    // What it costs is the reaper's ability to date this run, so it is never silent.
    logToFile('LP 6-12 worker: could not stamp pickup', { renderId, error: error.message });
    return true;
  }
  return !!data;
}

async function patch(renderId, fields) {
  const { error } = await supabase
    .from(RENDERS)
    .update({ ...fields, updated_at: nowIso() })
    .eq('id', renderId);
  if (error) {
    logToFile('LP 6-12 worker: render update failed', { renderId, error: error.message });
  }
}

const waitersOf = (render) => (Array.isArray(render && render.waiters) ? render.waiters : [])
  .filter((w) => w && w.phone);

/**
 * Who is waiting RIGHT NOW — read fresh, and left on the row.
 *
 * Used by the follow-up message, which fires minutes into the run: by then the list has usually
 * grown, and consoling the snapshot means the teachers who joined most recently — the ones who
 * have seen nothing at all yet — are the ones told nothing.
 *
 * A failed read or a vanished row falls back to what the caller already knows rather than going
 * silent. Distinguishing that from a legitimately empty list matters: an empty list must NOT
 * resurrect a stale snapshot.
 */
async function readWaiters(renderId, fallback) {
  const { data, error } = await supabase
    .from(RENDERS)
    .select('waiters')
    .eq('id', renderId)
    .maybeSingle();
  if (error || !data) {
    logToFile('LP 6-12 worker: could not re-read the waiter list', {
      renderId, error: error && error.message,
    });
    return fallback;
  }
  return waitersOf(data);
}

/**
 * Take the audience off the row, atomically, and empty it.
 *
 * THE DEFECT THIS EXISTS FOR. The worker used to read `waiters` at the top of the job and deliver
 * to that snapshot two to ten minutes later, having just written `waiters: []` over the real list.
 * Every teacher who joined DURING authoring was appended correctly by V1.3.2's atomic RPC, never
 * read, then erased. V1.3.2 fixed the append; the drop simply moved one step downstream.
 *
 * Reading the list and clearing it have to be ONE statement for the same reason the append did:
 * split in two, a teacher who joins in the gap is cleared without ever being read.
 *
 * CALL IT ONLY AFTER THE TERMINAL STATUS IS WRITTEN. `lp612_join_waiters` refuses a row that is
 * no longer `authoring`, so once the status has flipped a late joiner is turned away with
 * 'not_authoring' and the serving path re-decides her into a cache hit. Claim before the flip and
 * that guard is not yet armed — there is a window, and it is the window this whole change closes.
 */
async function claimWaiters(renderId, fallback) {
  const { data, error } = await supabase.rpc('lp612_claim_waiters', { p_render_id: renderId });
  if (error) {
    // Never silent, and never nobody. The teachers we already know about still get their lesson,
    // and the row's status was written before we got here, so it is not left stranded.
    logToFile('LP 6-12 worker: could not claim the waiter list', {
      renderId, error: error.message,
    });
    return fallback;
  }
  return waitersOf({ waiters: data });
}

/** Tell every waiter the same thing — each in HER OWN ui language (the waiter
 *  entry carries `ui_lang`; the job's document language is only the fallback
 *  for entries written before the language step shipped). Never throws — a
 *  failure to console someone must not become the reason the job dies. */
async function tellAll(waiters, key, lang) {
  for (const w of waiters) {
    try {
      await WhatsAppService.sendMessage(w.phone, resolveUx(key, { language: w.ui_lang || lang }));
    } catch (err) {
      logToFile('LP 6-12 worker: could not message waiter', {
        phone: w.phone, key, error: err.message,
      });
    }
  }
}

/**
 * KEEP THE DOCUMENT THE RENDERER REFUSED — bd-owx8t.
 *
 * The success path already stores the authored lp_doc beside its PDF. The failure path stored
 * nothing, and the failures are the only ones anybody ever needs to read.
 *
 * On 2026-09-04 the question was: derive a content ceiling from the nine page-cap failures
 * staging had just produced. Thirty-nine DELIVERED documents came back out of R2 in seconds. All
 * nine failures came back `NoSuchKey` — the worker writes the document into a temp dir, uploads
 * the PDF, and `finally` removes the directory, so every over-long lesson was gone within seconds
 * of being refused. The corpus therefore describes only lessons that fit, which is the one
 * population that cannot answer "why is this one too long".
 *
 * Keyed under `failed/` inside the same guarded prefix: it can never collide with a delivered
 * document, and the serving path looks for `.pdf` only, so nothing can serve it by accident.
 *
 * ITS OWN FAILURE IS SWALLOWED, exactly as the success-path twin's is. The teacher has already
 * been failed for a reason she is about to be told; an R2 problem here must not overwrite that
 * reason with a different one.
 */
async function keepFailedDoc({ doc, segmentId, lang, templateVersion, renderId, correlationId }) {
  if (!doc) return;                       // died before authoring — there is nothing to keep
  try {
    const key = Serving.assertKeyInPrefix(
      Serving.r2KeyFor(segmentId, lang, templateVersion).replace(/\/([^/]+)\.pdf$/, '/failed/$1.lp.json'),
    );
    await uploadBuffer(Buffer.from(JSON.stringify(doc, null, 1), 'utf8'), key, 'application/json');
  } catch (err) {
    logToFile('LP 6-12 worker: could not store the refused document', {
      renderId, segmentId, error: err.message, correlationId,
    });
  }
}

/**
 * Fail one render: mark the row, tell everyone waiting, and return a result the
 * SQS switch can ack. A failed row is not a dead lesson — the next tap sees
 * `failed` and retries.
 */
/**
 * Codes for which "tap it again in a few minutes" is a LIE.
 *
 * An over-long page range fails identically on every retry, so the generic copy invites her to
 * wait and tap for ever on something that can never succeed. Rule 24(d): one shared fallback
 * across distinct states misdirects the teacher and every field report after her.
 */
const NO_RETRY_CODES = new Set(['PAGE_RANGE_TOO_LARGE', 'PAGE_TRUTH_TOO_LARGE']);

/**
 * @param {string|null} [model] WHICH MODEL FAILED IT.
 *
 * On 2026-09-03 two rows sat at status='failed', error_code='AUTHOR_TIMEOUT', model_used NULL, and
 * could not answer the one question they existed to answer: the maths/physics pilot routes some
 * families to a different model by env alone (bd-u6za9), so "did the pilot time out, or sonnet?"
 * is the whole point of a failed row. `model_used` was written only inside the SUCCESS patch,
 * which is the one path that never needs it urgently.
 *
 * It is passed rather than re-resolved here: the worker already resolved it from the segment's
 * family before the try block, and re-deriving it would re-read the env at a different moment and
 * could name a model this run never used. `null` when the run died before a segment was loaded —
 * there was no family, so there was no model, and a guess on the row would be worse than a NULL.
 */
async function fail(renderId, snapshot, lang, code, detail, model = null) {
  // Status FIRST, then claim. From the moment this write lands, `lp612_join_waiters` refuses the
  // row and a teacher mid-tap is re-decided by the serving path (a failed row is retried, which
  // is what she is owed) rather than being parked on a list about to be emptied.
  await patch(renderId, {
    status: 'failed',
    error_code: code || 'UNKNOWN',
    error_detail: String(detail || '').slice(0, 2000),
    ...(model ? { model_used: model } : {}),
    completed_at: nowIso(),
  });
  // The failure path needs the live list every bit as much as the success path: a teacher who
  // joined during a run that then died was getting no message at all, just silence on a lesson
  // that had already given up.
  const waiters = await claimWaiters(renderId, snapshot);
  await tellAll(waiters, NO_RETRY_CODES.has(code) ? 'lp612TooLong' : 'lp612Failed', lang);
  return { status: 'failed', errorCode: code || 'UNKNOWN' };
}

function withTimeout(promise, ms, code) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`lp612 authoring exceeded ${ms}ms`);
      err.code = code;
      reject(err);
    }, ms);
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @param {object} payload {renderId, segmentId, lang, templateVersion, correlationId}
 */
async function process(payload) {
  const { renderId, segmentId, lang, templateVersion, correlationId } = payload || {};
  const startedAt = Date.now();

  const render = await loadRender(renderId);
  if (!render) {
    logToFile('LP 6-12 worker: no render row, skipping', { renderId, correlationId });
    return { status: 'skipped', reason: 'render_missing' };
  }
  // Idempotency. SQS is at-least-once; a redelivered job for a render that has
  // already finished must not author the lesson a second time.
  if (render.status !== 'authoring') {
    logToFile('LP 6-12 worker: render not in flight, skipping', {
      renderId, status: render.status, correlationId,
    });
    return { status: 'skipped', reason: `status_${render.status}` };
  }

  // Claim it and start the authoring clock. See claimPickup above: this is both the second
  // timestamp the reaper needs (bd-dr216) and the idempotency check the read above only
  // approximated.
  if (!await claimPickup(renderId)) {
    logToFile('LP 6-12 worker: lost the pickup race, another delivery owns this run', {
      renderId, correlationId,
    });
    return { status: 'skipped', reason: 'pickup_lost' };
  }

  // A SNAPSHOT, and named one so it cannot quietly become the delivery audience again. It is a
  // FALLBACK only — for the two moments where a fresh read is unavailable — because by the time
  // this job finishes the real list will have grown by everyone who tapped the same lesson while
  // it was being written.
  const snapshot = waitersOf(render);

  const segment = await loadSegment(segmentId);
  if (!segment) {
    return fail(renderId, snapshot, lang, 'SEGMENT_MISSING',
      `segment ${segmentId} not found`);
  }

  // The slow tail gets a second message rather than silence. Cleared on every
  // exit path so a fast render cannot leave a "still working" message behind it.
  //
  // It re-reads the list instead of consoling the snapshot: this fires MINUTES in, which is
  // exactly when the list has grown, and the teachers who joined most recently are the ones with
  // nothing to go on. Non-destructive — the row keeps its waiters; only the claim at the end
  // empties them.
  let followup = setTimeout(() => {
    (async () => {
      await tellAll(await readWaiters(renderId, snapshot), 'lp612StillWorking', lang);
    })().catch(() => {});
  }, followupAfterMs());
  if (followup.unref) followup.unref();
  const stopFollowup = () => { clearTimeout(followup); followup = null; };

  // PER FAMILY, and the family comes from the segment we just loaded.
  //
  // This line previously read `resolveAuthorModel()` with no argument, and it is
  // the only caller that runs in production — the worker passes `model` EXPLICITLY
  // to authorLessonPlan(), so the service's own family-aware default was never
  // reached. The maths/physics pilot was inert on staging (a Grade 9 physics
  // segment authored on sonnet) while the service-level tests were green, because
  // they called authorLessonPlan the way the worker does not: without a model.
  const family = familyForBook(segment.book_stem);
  const model = resolveAuthorModel(family);
  // The harness the model runs on. Resolved HERE, beside the model, so a failed run reports the
  // same (model, family, tier) triple a successful one does — authorLessonPlan returns all three,
  // but a run that threw returns nothing at all.
  //
  // SWALLOWED ON PURPOSE. `authorTierFor` throws on a typo'd LP612_AUTHOR_TIER, deliberately, so
  // that a mislabelled A/B cannot run. That throw belongs INSIDE the try below, where it becomes a
  // failed row and a sentence to the teacher — which is where it happens today, via
  // authorLessonPlan. Letting a telemetry line move it out here would turn a named failure into an
  // unhandled rejection with no row written and nobody told.
  const tier = (() => { try { return authorTierFor(model); } catch (_) { return null; } })();
  let tmpDir;
  // Hoisted out of the IIFE below ON PURPOSE: the catch needs the document the renderer refused,
  // and inside the closure it is unreachable from there. See `keepFailedDoc`.
  let authoredDoc = null;

  try {
    const result = await withTimeout((async () => {
      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lp612-'));

      /**
       * THE RENDER GATE, handed to the ladder.
       *
       * The packer decides `PAGE COUNT: support needs 6 pages; the cap is 4`, and it used to run
       * only AFTER authoring had finished — so the ladder polished a lint-clean document that
       * could never become a PDF, and every English lesson died there. The worker is the only
       * caller with a browser, so it is the only one that can close that loop.
       *
       * Returns the renderer's OWN defect strings, verbatim, because those go in front of the
       * model.
       *
       * bd-htueq: a renderer that dies for ITS OWN reasons (OOM, a launch that could not get a
       * slot under contention, a crash) is not the document's fault — but it used to be reported
       * as `[]`, "no defects", which `runGates`/`blockingCost` in the author service reads as
       * "the page-cap gate passed". That silently disables the ONE gate that catches an unfittable
       * document, exactly when load makes contention (and this failure) most likely. A gate that
       * turns itself off under load is worse than no gate.
       *
       * Fix: classify the failure (see lp612-render.service.js's `.infra` flag — `true` for a
       * renderer blow-up, `false` for a real document defect it validated and rejected). A real
       * defect is returned as-is, same as before. An infra failure gets ONE retry — the semaphore
       * added alongside this makes a transient blip the common case, so most of these resolve
       * here — and if it fails again we return an explicit, always non-empty, always-blocking
       * defect string instead of `[]`. The ladder can then never mistake "unverified" for "clean".
       */
      const isInfraRenderFailure = (e) => (
        e.infra === true || !Array.isArray(e.problems) || e.problems.length === 0
      );

      const attemptRenderCheck = async (candidate) => {
        try {
          await renderLessonPlan({
            lpDoc: candidate,
            lang,
            stem: `gate_${Date.now()}`,
            outDir: tmpDir,
            correlationId,
            // `stem` is `gate_<ts>` here, so nothing in the render service could join this probe
            // back to a lesson. `phase` is what separates a ladder probe from the document the
            // teacher receives — without it the two are one undifferentiated stream and the
            // gate-rejection rate is unmeasurable.
            segmentId,
            renderId,
            phase: 'gate',
          });
          return { clean: true };
        } catch (e) {
          return {
            clean: false,
            infra: isInfraRenderFailure(e),
            problems: Array.isArray(e.problems) ? e.problems : [],
          };
        }
      };

      const renderCheck = async (candidate) => {
        let result = await attemptRenderCheck(candidate);
        if (result.clean) return [];
        if (!result.infra) return result.problems; // a real defect — feed it to the model, once

        result = await attemptRenderCheck(candidate); // the one retry
        if (result.clean) return [];
        if (!result.infra) return result.problems;

        logEvent('lp612.render.gate_infra_unresolved', {
          segmentId, renderId, correlationId, phase: 'gate',
        });
        return [
          'RENDER_INFRA: the page-cap gate could not be verified after 2 attempts because the '
          + 'renderer failed for infrastructure reasons (not a document defect). Treating this '
          + 'round as not render-clean.',
        ];
      };

      const authored = await authorLessonPlan({
        segment, lang, model, rounds: authorRounds(), correlationId, renderCheck,
      });
      // Recorded the moment it exists, so a render that refuses it below is still explicable.
      authoredDoc = authored.lpDoc;

      let rendered;
      let overCap = false;
      try {
        rendered = await renderLessonPlan({
          lpDoc: authored.lpDoc,
          lang,
          stem: segmentId.replace(/[^A-Za-z0-9._-]/g, '_'),
          outDir: tmpDir,
          correlationId,
          segmentId,
          renderId,
          phase: 'final',
        });
      } catch (e) {
        // ── bd-vjk68: A LESSON IS NEVER LOST FOR BEING LONG ──────────────────
        //
        // Operator, 2026-09-04: *"we will stop cancelling or delaying lesson plans now because
        // of the length issue"*. 9 of the 20 failures in the 59-lesson live window were page
        // count — 6 of them the identical "teach needs 6; the cap is 5" — and every one of them
        // was a lesson that had already been authored, rendered, and written to disk, then
        // thrown away and replaced with an apology.
        //
        // The PDF EXISTS at this point. `lp612-render.service` writes the file and only then
        // inspects the report, so `e.pdfPath` on a defect throw points at a complete, correct,
        // merely-longer-than-we-wanted document. Delivering it costs one file read.
        //
        // THE CONDITION IS DELIBERATELY NARROW, and each clause earns its place:
        //   • `infra === false` — a Chromium that never launched produced no PDF at all; there
        //     is nothing to deliver and `e.problems` is a crash message, not a defect list.
        //   • EVERY problem is `PAGE COUNT:` — not merely "at least one is". `OVERFLOW` means
        //     content is clipped off the bottom of a page and `TRUNCATION` means pages of the
        //     lesson are missing from the file. Those are broken documents, not long ones, and
        //     a teacher must never be sent one. A mixed set fails, exactly as it does today.
        //   • a non-empty `pdfPath` — the belt to the braces above.
        //
        // Rule 24(a)/(b): this is a distinct persisted state, not a silent fallback. The row
        // carries `over_cap`, the event `lp612.deliver.over_cap` carries the pages AND the caps
        // they were measured against, and both exist so the question the raised caps opened —
        // does the distribution simply refill to the new ceiling? — is answerable from data
        // after ~40 lessons rather than argued about.
        const pageOnly = e && e.infra === false
          && Array.isArray(e.problems) && e.problems.length > 0
          && e.problems.every((p) => String(p).startsWith('PAGE COUNT:'))
          && typeof e.pdfPath === 'string' && e.pdfPath.length > 0;
        if (!pageOnly) throw e;

        overCap = true;
        rendered = {
          pdfPath: e.pdfPath,
          htmlPath: e.htmlPath,
          pageCount: e.pageCount ?? null,
          pagesByPart: e.pagesByPart || {},
          overlayApplied: e.overlayApplied || [],
          warnings: e.warnings || [],
          problems: e.problems,
        };
      }

      return { authored, rendered, overCap };
    })(), authorTimeoutMs(), 'AUTHOR_TIMEOUT');

    const { authored, rendered, overCap } = result;

    const pdf = await fs.promises.readFile(rendered.pdfPath);
    // Guarded, not merely well-named: NIETE shares this bucket with PK production and `lp612/`
    // is the only isolation there is. Applied at the put so no future edit can construct a key
    // some other way and skip it.
    const r2Key = Serving.assertKeyInPrefix(Serving.r2KeyFor(segmentId, lang, templateVersion));
    await uploadBuffer(pdf, r2Key, 'application/pdf');

    // KEEP THE DOCUMENT THAT MADE THE PDF.
    //
    // The operator asked why a graph appeared twice in his lesson and the honest answer needed
    // the authored lp_doc — which did not exist. The renderer writes it to a temp dir, this
    // worker uploaded only the pdf, and the directory is deleted in `finally`. R2 held three
    // PDFs and nothing else. His document was gone seconds after it rendered, and the diagnosis
    // had to be reconstructed from a raster.
    //
    // A few KB beside a ~200KB PDF, in the SAME prefix and the same key shape, so it is findable
    // from the render row without a second lookup and the shared-bucket prefix guard covers it
    // unchanged.
    //
    // Its failure is swallowed on purpose: the PDF is the product, keeping the source is for us,
    // and it must never turn a finished lesson into a failed one.
    try {
      await uploadBuffer(
        Buffer.from(JSON.stringify(authored.lpDoc, null, 1), 'utf8'),
        Serving.assertKeyInPrefix(r2Key.replace(/\.pdf$/, '.lp.json')),
        'application/json',
      );
    } catch (err) {
      logToFile('LP 6-12 worker: could not store the authored document', {
        renderId, segmentId, error: err.message, correlationId,
      });
    }

    stopFollowup();

    // THE OVER-CAP EVENT — the measurement the raised caps are on probation for (bd-vjk68).
    //
    // Emitted BEFORE the row patch and the sends, so it exists even if delivery then fails: this
    // is a fact about the DOCUMENT, not about whether Meta accepted it.
    //
    // The caps travel WITH the pages on purpose. `teach_pages: 7` is uninterpretable six weeks
    // from now unless the row also says what the cap was at the time — and moving the cap is
    // precisely what this bead did, so a reader who assumes today's constants will misread every
    // row written before the next change. Same failure shape as reading `status` without the
    // payload (rule 24(a)).
    if (overCap) {
      const caps = pageCapsFor(lang).max;
      const byPart = rendered.pagesByPart || {};
      logEvent('lp612.deliver.over_cap', {
        renderId,
        segmentId,
        correlationId: correlationId || null,
        lang,
        templateVersion,
        teach_pages: byPart.teach ?? null,
        support_pages: byPart.support ?? null,
        cap_teach: caps.teach,
        cap_support: caps.support,
        page_count: rendered.pageCount ?? null,
        rounds: authored.rounds ?? null,
        problems: rendered.problems || [],
      });
      logToFile('LP 6-12 worker: delivering an over-cap lesson rather than failing it', {
        renderId, segmentId, lang, pagesByPart: byPart, caps, correlationId,
      }, 'warn');
    }

    // AN URDU RENDER THAT LOST ITS OVERLAY IS SAID SO, ON THE ROW (rule 24(b):
    // a silent fallback is a regression mask). An EN-medium book asked for in
    // Urdu whose ur_overlay did not survive (sanitizeOverlay dropped it, or the
    // model never wrote one) serves an essentially-English document in RTL
    // chrome — every delivery from this row, first hit and cache hits alike,
    // appends the honest caption. A UR-medium book needs no overlay and an
    // English render dropped nothing, so neither is ever flagged.
    const overlayDropped = lang === 'ur'
      && segment.language !== 'ur'
      && !(Array.isArray(rendered.overlayApplied) && rendered.overlayApplied.length > 0);

    await patch(renderId, {
      status: 'ready',
      // bd-7yxsu: STATUS AND ERROR CODE MAY NEVER DISAGREE.
      //
      // A run can legitimately recover — the reaper wrote `failed` on a row this worker was still
      // authoring (bd-w36m5), or an earlier attempt failed and this one is the retry — and this
      // patch used to leave `error_code` untouched. An UPDATE that does not name a column leaves
      // whatever is in it, so `grade_11_physics.c01.p014-018` came out of that as status=ready,
      // error_code=AUTHOR_STRANDED: a healthy, delivered lesson reading as errored in every query
      // anyone ran, and inflating every failure count quoted on 2026-09-04. Naming them here is
      // what makes the two columns incapable of contradicting each other.
      error_code: null,
      error_detail: null,
      r2_key: r2Key,
      overlay_dropped: overlayDropped,
      // bd-vjk68. A DELIVERED OVER-CAP LESSON IS DISTINGUISHABLE, ON THE ROW.
      //
      // Always written, never left to whatever was in the column: the flag's whole job is to
      // answer "of the lessons we sent, how many were over the cap", and a NULL that means "we
      // did not look" is indistinguishable from a false in every query anyone will run. Same
      // reasoning as `error_code: null` two lines up (bd-7yxsu) — a column an UPDATE does not
      // name keeps its old value, and a retry after an over-cap attempt would inherit `true`.
      over_cap: overCap === true,
      page_count: rendered.pageCount ?? null,
      model_used: authored.model || model,
      rounds_used: authored.rounds ?? null,
      lint_clean: authored.lintClean === true,
      // Recorded even on a clean run (as []), so "was this ever gated?" is
      // answerable from the row rather than only from a log that rolls off.
      lint_fails: authored.fails || [],
      // The lesson on one phone screen, STORED and not merely sent. Every
      // teacher after the first is served entirely from this row, and without
      // it she would get the file with no summary while the first got both.
      one_screen: oneScreenOf(authored),
      completed_at: nowIso(),
    });

    // `waiters` is deliberately NOT in the patch above. Emptying the list blind is what erased
    // every teacher who joined during authoring; the claim below reads it and empties it in one
    // locked statement, and it runs AFTER the status flip so a join arriving now is refused
    // ('not_authoring') and re-decided into a cache hit rather than dropped.
    const waiters = await claimWaiters(renderId, snapshot);

    // bd-m1xyt: ONE deadline for the WHOLE loop, not one per waiter. This send runs after the
    // `withTimeout(...)` above, so it is unbounded by LP612_AUTHOR_TIMEOUT_MS — a lesson with many
    // waiters, all hitting Meta's pair rate limit (131056; see the constant's own comment in
    // lp612-serving.service.js), could otherwise stack N x up-to-12s of backoff and push this job
    // past its SQS visibility window. Sharing the deadline means a pile-up shortens later waiters'
    // retries instead of extending the job without bound; every waiter still gets at least one
    // attempt.
    const deliveryDeadline = Date.now() + Serving.SEND_TOTAL_BUDGET_MS;

    let delivered = 0;
    let deliveryFailures = 0;
    for (const w of waiters) {
      try {
        await Serving.deliverRender({
          // `userId` is what the shelf write is keyed by, and the waiter list is the only place
          // this worker knows one. Without it the recording no-ops for every teacher who waited
          // on a first render — precisely the people the feature exists for.
          phone: w.phone,
          userId: w.user_id,
          r2Key,
          segment,
          lang,
          oneScreen: oneScreenOf(authored),
          overlayDropped,
          renderId,
          sendDeadlineAt: deliveryDeadline,
        });
        delivered += 1;
      } catch (err) {
        deliveryFailures += 1;
        logToFile('LP 6-12 worker: delivery failed for one waiter', {
          renderId, phone: w.phone, error: err.message, correlationId,
        });
      }
    }

    logToFile('LP 6-12 worker: lesson authored and delivered', {
      renderId,
      segmentId,
      lang,
      templateVersion,
      model: authored.model || model,
      rounds: authored.rounds,
      lintClean: authored.lintClean,
      pageCount: rendered.pageCount,
      // First-hit latency is THE metric for this feature. Logged per run so it
      // is answerable without waiting for the table to fill.
      elapsedMs: Date.now() - startedAt,
      delivered,
      deliveryFailures,
      correlationId,
    });

    // The terminal event for the whole job. `authored.model/family/tier` are preferred over the
    // worker's own because they are what the authoring run REPORTED using; the worker's are the
    // floor for a document authored before the service returned them.
    logEvent('lp612.deliver.completed', {
      outcome: 'ready',
      renderId,
      segmentId,
      lang,
      templateVersion,
      correlationId: correlationId || null,
      model: authored.model || model,
      family: authored.family || family,
      tier: authored.tier || tier,
      rounds: authored.rounds ?? null,
      lintClean: authored.lintClean === true,
      pageCount: rendered.pageCount ?? null,
      // The per-part pages on EVERY delivery, not only the over-cap ones (bd-vjk68). "Does the
      // distribution refill to the new cap?" is a question about all delivered lessons; a
      // sample of only the ones that spilled cannot answer it.
      pagesByPart: rendered.pagesByPart || null,
      overCap: overCap === true,
      overlayDropped,
      delivered,
      deliveryFailures,
      elapsedMs: Date.now() - startedAt,
    });

    return { status: 'ready', r2Key, delivered, deliveryFailures, elapsedMs: Date.now() - startedAt };
  } catch (err) {
    stopFollowup();
    logToFile('LP 6-12 worker: authoring failed', {
      renderId, segmentId, lang, model,
      code: err.code || 'UNKNOWN',
      error: err.message,
      elapsedMs: Date.now() - startedAt,
      correlationId,
    });
    // The failure twin of the event above, carrying the SAME provenance triple. The row records
    // model_used (see fail()); this records the family and the tier too, which the renders table
    // has no columns for and which a pilot cannot be read without.
    logEvent('lp612.deliver.failed', {
      outcome: 'failed',
      renderId,
      segmentId,
      lang,
      templateVersion,
      correlationId: correlationId || null,
      model,
      family,
      tier,
      errorCode: err.code || 'UNKNOWN',
      error: err.message,
      elapsedMs: Date.now() - startedAt,
    });
    await keepFailedDoc({ doc: authoredDoc, segmentId, lang, templateVersion, renderId, correlationId });
    return fail(renderId, snapshot, lang, err.code, err.message, model);
  } finally {
    stopFollowup();
    if (tmpDir) {
      fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

module.exports = { process };
