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
const { authorLessonPlan, overlayLessonPlan } = require('../shared/services/lp612-author.service');
// bd-oak77.14 — the ONE predicate deciding whether a rendered document may reach a teacher.
// Imported rather than restated: three call sites make that judgement (the final render, the
// timeout recovery, the Urdu overlay fallback) and bd-vjk68 already recorded what happens when a
// second copy of the rule quietly omits a clause.
const { deliveryVerdict, degradedNotice } = require('../shared/services/lp612-render-policy.service');
const { renderLessonPlan } = require('../shared/services/lp612-render.service');
// The caps the renderer gated on, read from the renderer itself so the over-cap event can never
// quote a number the gate did not use (bd-vjk68). Never retyped here — see `pageCapsFor`.
const { pageCapsFor } = require('../vendor/lp-v9/render_lp.js');
const { refsFromDoc, stageFigures } = require('../shared/services/lp612-pagetruth.service');
const Serving = require('../shared/services/lp612-serving.service');
const {
  resolveAuthorModel, authorTierFor, authorRounds, authorTimeoutMs, overlayTimeoutMs,
  overlayPassOff,
  followupAfterMs,
  checkpointOff,
  previousTemplateVersions,
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

/** The columns this job has always needed. */
const RENDER_COLUMNS = 'id, status, waiters, segment_id, lang, template_version';

/**
 * Does this PostgREST error mean "that column is not there"?
 *
 * It has to be answerable, because `V1.3.9__lp612_checkpoint.sql` is applied BY HAND on this
 * deployment (NIETE deploys do not run migrations, bd-tqkq9) and the code can therefore reach
 * production before the column does. `loadRender` returning null ABORTS THE JOB, so a hard select
 * on an unapplied column would not degrade — it would kill every lesson on the service.
 */
function isMissingColumn(error) {
  if (!error) return false;
  if (error.code === '42703') return true;
  return /column .*does not exist|could not find the .* column/i.test(String(error.message || ''));
}

async function loadRender(renderId) {
  // bd-oak77.11: ONE read, not two. A second select for the checkpoint would be safer to reason
  // about but shifts every fixture in the worker's existing test harness by one, which is the exact
  // breakage bd-dr216's pickup stamp caused there; and the fallback below already gives the
  // safety that a separate read was buying.
  let { data, error } = await supabase
    .from(RENDERS)
    .select(`${RENDER_COLUMNS}, checkpoint`)
    .eq('id', renderId)
    .maybeSingle();

  if (error && isMissingColumn(error)) {
    logToFile('LP 6-12 worker: no checkpoint column on this database — resuming is unavailable, '
      + 'authoring proceeds from round 0 (apply V1.3.9__lp612_checkpoint.sql)', { renderId });
    ({ data, error } = await supabase
      .from(RENDERS)
      .select(RENDER_COLUMNS)
      .eq('id', renderId)
      .maybeSingle());
  }

  if (error) {
    logToFile('LP 6-12 worker: render lookup failed', { renderId, error: error.message });
    return null;
  }
  return data || null;
}

/** The only checkpoint shape this worker understands. Bumped when the shape changes. */
const CHECKPOINT_VERSION = 1;

/**
 * The document a previous attempt already paid for, or `null`.
 *
 * bd-oak77.11. Every guard here is about NOT resuming from a document that is not this lesson: the
 * cache key is (segment_id, lang, template_version) and a row survives a template bump, so a
 * checkpoint written under v9.0 must not seed a v9.1 run, and an Urdu document must not seed an
 * English one. An unrecognised `v` is ignored rather than trusted — a future shape change can then
 * never make a still-running worker resume from a document it cannot read.
 */
function resumeFromOf(render, { lang, templateVersion }) {
  if (checkpointOff()) return null;
  const cp = render && render.checkpoint;
  if (!cp || typeof cp !== 'object') return null;
  if (cp.v !== CHECKPOINT_VERSION) return null;
  if (!cp.lp_doc || typeof cp.lp_doc !== 'object') return null;
  if (cp.lang !== lang) return null;
  if (cp.template_version !== templateVersion) return null;
  const rounds = Number.isFinite(cp.round) ? cp.round : 0;
  return { lpDoc: cp.lp_doc, rounds, blocking: Array.isArray(cp.blocking) ? cp.blocking : [] };
}

/**
 * Persist the ladder's best-so-far document, without ever getting in its way.
 *
 * SINGLE-FLIGHT, not queued. Rounds are ~60s apart and a write is milliseconds, so a pending write
 * only exists when the database is slow — and in that case the RIGHT answer is to drop the older
 * candidate and keep the newer one, never to queue a backlog of 23KB writes behind a struggling
 * connection on a path a teacher is waiting on.
 *
 * FIRE AND FORGET, and every failure swallowed. This rides `onCandidate`, whose contract in
 * lp612-author.service.js is explicit that a telemetry-shaped side channel must never be able to
 * kill the authoring run it observes. `patch()` already logs and swallows its own errors; the
 * catch here is for anything else.
 */
function makeCheckpointWriter(renderId, { lang, templateVersion, correlationId }) {
  let inFlight = false;
  let pending = null;

  const flush = () => {
    if (inFlight || !pending) return;
    const cand = pending;
    pending = null;
    inFlight = true;
    Promise.resolve()
      .then(() => patch(renderId, {
        checkpoint: {
          v: CHECKPOINT_VERSION,
          round: Number.isFinite(cand.rounds) ? cand.rounds : 0,
          lp_doc: cand.lpDoc,
          blocking: Array.isArray(cand.fails) ? cand.fails.slice(0, 20) : [],
          deliverable: cand.deliverable === true,
          lint_clean: cand.lintClean === true,
          model: cand.model || null,
          family: cand.family || null,
          tier: cand.tier || null,
          template_version: templateVersion,
          lang,
          at: nowIso(),
        },
      }))
      .catch((e) => logToFile('LP 6-12 worker: checkpoint write failed (non-fatal)', {
        renderId, correlationId, error: e.message,
      }))
      .finally(() => { inFlight = false; flush(); });
  };

  return (candidate) => {
    if (checkpointOff()) return;
    if (!candidate || !candidate.lpDoc) return;
    pending = candidate;
    flush();
  };
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

/**
 * PostgREST's "that column does not exist" — bd-oak77.14.
 *
 * `PGRST204` is the schema-cache miss; `42703` is Postgres's own undefined_column, which surfaces
 * when the cache is warm and the column genuinely is not there. Both name the column in the
 * message, which is what makes the retry below targeted rather than a blind field-stripping loop.
 */
const MISSING_COLUMN_CODES = new Set(['PGRST204', '42703']);

/** The column name PostgREST/Postgres quoted, or null. */
function missingColumnOf(error, fields) {
  if (!error || !MISSING_COLUMN_CODES.has(String(error.code))) return null;
  const m = String(error.message || '').match(/'([^']+)'|"([^"]+)"/);
  const name = m && (m[1] || m[2]);
  // Only when it is a column WE sent. Otherwise the retry would resend the identical payload and
  // loop the same failure.
  return name && Object.prototype.hasOwnProperty.call(fields, name) ? name : null;
}

/**
 * Write to the render row, and SURVIVE A COLUMN THE DATABASE DOES NOT HAVE YET.
 *
 * Deploys do not run migrations on NIETE (bd-tqkq9), so every lp612 migration since V1.3.3 carries
 * the same line in its header: *a merged column that does not exist is a total lp612 outage*. The
 * mechanism is unforgiving — PostgREST rejects the WHOLE update when it names an unknown column,
 * so the success patch fails, the row never reaches `ready`, the waiters are never claimed, and
 * every lesson on the fleet dies at the last step holding a finished document. It has been avoided
 * three times by remembering to hand-apply first. On a go-live day with four lanes merging,
 * "remembering" is not a control.
 *
 * So the write degrades: retry ONCE without the column it named, and say which one, loudly. The
 * lesson ships; one flag is lost; `lp612.row.column_missing` makes it impossible to miss.
 *
 * This is NOT a licence to skip a migration. It converts a fleet outage into one missing flag.
 */
async function patch(renderId, fields) {
  const payload = { ...fields, updated_at: nowIso() };
  const { error } = await supabase.from(RENDERS).update(payload).eq('id', renderId);
  if (!error) return;

  const column = missingColumnOf(error, payload);
  if (!column) {
    logToFile('LP 6-12 worker: render update failed', { renderId, error: error.message });
    return;
  }

  const { [column]: _dropped, ...without } = payload;
  logEvent('lp612.row.column_missing', {
    renderId, column, code: String(error.code), table: RENDERS,
  });
  logToFile('LP 6-12 worker: the renders table is missing a column this build writes — '
    + 'delivering without it. APPLY THE MIGRATION.', {
    renderId, column, error: error.message,
  }, 'error');

  const retry = await supabase.from(RENDERS).update(without).eq('id', renderId);
  if (retry.error) {
    logToFile('LP 6-12 worker: render update failed', { renderId, error: retry.error.message });
  }
}

/**
 * The waiter list, sanitised — but NOT narrowed to WhatsApp.
 *
 * This used to `.filter(w => w.phone)`, which was right when a phone number was the only way a
 * waiter could exist. It is now wrong in a way that would have been very hard to see: the portal
 * parks phoneless waiters on this same list, and dropping them HERE means they are dropped from
 * `claimWaiters` too — the one statement that both reads the list and empties it. She would be
 * silently discarded at the moment her lesson succeeded, and the counters would still add up,
 * because as far as every downstream count was concerned she was never waiting.
 *
 * So the filter now removes only entries that are structurally junk. Deciding who can be SENT to
 * belongs to the delivery loop, which knows about phones; deciding who is WAITING belongs here,
 * and the portal teacher is waiting.
 */
const waitersOf = (render) => (Array.isArray(render && render.waiters) ? render.waiters : [])
  .filter((w) => w && (w.phone || w.user_id));

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
    // Nobody to tell. A portal waiter reads the outcome off the row when her browser next polls,
    // and `waitersOf` deliberately no longer strips her (see its comment) — so the "can we send
    // to this waiter?" question, which used to be answered by her mere presence in the list,
    // has to be asked explicitly here. Mirrors the same guard in lp612-serving's `tell()`.
    if (!w.phone) continue;
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
      // The sibling-document key shape comes from `docKeyFor` (bd-oak77.12) — this only moves it
      // into `failed/`, so a refused document can never be mistaken for one the reuse path may
      // re-render.
      Serving.docKeyFor(segmentId, lang, templateVersion)
        .replace(/\/([^/]+)\.lp\.json$/, '/failed/$1.lp.json'),
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
 * Codes for which "I could not finish" is the WRONG SENTENCE — bd-oak77.14.
 *
 * The lesson WAS finished; what failed was turning it into pages. Since the never-fail policy
 * (`lp612-render-policy.service`) now delivers every render defect that leaves the document
 * whole, what is left under this code is narrow and specific: a renderer that would not start, a
 * document the schema refused, or a PDF that came out with pages MISSING from the file.
 *
 * Rule 24(d). On 2026-09-06 a teacher was told "I could not finish that lesson plan this time"
 * about a complete 17-page document sitting on disk, in the same words an author timeout and a
 * stranded worker produce. She re-typed "Lesson plan" 43 seconds later. Four states, one
 * sentence, and the sentence was false for one of them.
 */
const UNRENDERABLE_CODES = new Set(['RENDER_FAILED']);

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
    // bd-oak77.11 — see the `ready` patch. A failed row is RETRIED by the next tap, and that retry
    // must start clean rather than from a document this run has already judged unusable.
    checkpoint: null,
    error_code: code || 'UNKNOWN',
    error_detail: String(detail || '').slice(0, 2000),
    ...(model ? { model_used: model } : {}),
    completed_at: nowIso(),
  });
  // The failure path needs the live list every bit as much as the success path: a teacher who
  // joined during a run that then died was getting no message at all, just silence on a lesson
  // that had already given up.
  const waiters = await claimWaiters(renderId, snapshot);
  const copyKey = NO_RETRY_CODES.has(code)
    ? 'lp612TooLong'
    : (UNRENDERABLE_CODES.has(code) ? 'lp612Unrenderable' : 'lp612Failed');
  await tellAll(waiters, copyKey, lang);
  return { status: 'failed', errorCode: code || 'UNKNOWN' };
}

/** A coded Error, with no side effects. `fail()` above WRITES A ROW; this one does not. */
function fail0(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
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

  // bd-oak77.11 — TWO HALVES OF ONE THING, both read from the row we just claimed.
  //
  // `resumeFrom` is what a previous attempt already paid for: a deploy, an OOM or a host eviction
  // that killed the owner mid-run leaves the row `authoring` with the ladder's best document on it,
  // and this is what stops the redelivered job authoring the whole lesson again from round 0
  // (~$0.30-0.60 and 2.5-7 minutes, on a teacher who has already been waiting for both).
  //
  // `writeCheckpoint` is the other half: it keeps that document current for whoever comes next,
  // including this same process one round from now.
  const resumeFrom = resumeFromOf(render, { lang, templateVersion });
  const writeCheckpoint = makeCheckpointWriter(renderId, { lang, templateVersion, correlationId });
  if (resumeFrom) {
    logToFile('LP 6-12 worker: resuming from a checkpoint — a previous attempt died mid-run', {
      renderId, segmentId, lang, round: resumeFrom.rounds, correlationId,
    });
    logEvent('lp612.author.resumed', {
      renderId, segmentId, lang, round: resumeFrom.rounds, correlationId,
    });
  }

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
  /**
   * The Urdu overlay pass's verdict for this render, or `null` when no pass was attempted
   * (bd-zle0u). Hoisted here for the same reason `authoredDoc` is: the delivery block below has
   * to tell a DEFERRAL apart from a FAILURE, and the only place that distinction is knowable is
   * where the pass either ran or did not.
   */
  let overlayOutcome = null;
  /**
   * The best document the ladder has published so far (bd-0cdug), or `null`. Hoisted for exactly
   * the same reason `authoredDoc` is: `withTimeout` RACES the authoring closure and cannot cancel
   * it, so when the clock wins, everything still inside that closure is unreachable — including a
   * finished lesson. On 2026-09-05 two of three timed-out cells were holding renderable documents
   * when they were thrown away.
   */
  let bestSoFar = null;
  /** True when this lesson is being delivered off that recovery path rather than normally. */
  let overTime = false;

  /**
   * Render a document for DELIVERY, and accept it when the only thing wrong with it is length.
   *
   * Factored out of the inline final render (bd-zle0u) so the ENGLISH document and the OVERLAID
   * one are judged by exactly the same rule. They must be: an Urdu overlay makes a page longer
   * far more often than it makes one shorter, so a second copy of this policy that quietly
   * omitted the page-count clause would fail every Urdu lesson for being long — the precise
   * outcome bd-vjk68 exists to forbid — while the English one sailed through.
   *
   * @param {object} lpDoc  the document to draw
   * @param {'final'|'overlay'} phase  which pass this is, for the render service's telemetry
   * @returns {Promise<{rendered:object, overCap:boolean}>}
   */
  const renderFinal = async (lpDoc, phase) => {
    try {
      const out = await renderLessonPlan({
        lpDoc,
        lang,
        stem: `${segmentId.replace(/[^A-Za-z0-9._-]/g, '_')}${phase === 'overlay' ? '_ur' : ''}`,
        outDir: tmpDir,
        correlationId,
        segmentId,
        renderId,
        phase,
      });
      return { rendered: out, overCap: false, degraded: false, degradedClasses: [], degradedBy: [] };
    } catch (e) {
      // ── bd-vjk68: A LESSON IS NEVER LOST FOR BEING LONG ──────────────────
      //
      // Operator, 2026-09-04: *"we will stop cancelling or delaying lesson plans now because
      // of the length issue"*. 9 of the 20 failures in the 59-lesson live window were page
      // count — 6 of them the identical "teach needs 6; the cap is 5" — and every one of them
      // was a lesson that had already been authored, drawn, and written to disk, then thrown
      // away and replaced with an apology.
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
      //     `OVERLAY_INVALID` lands here too, and must: an overlaid document the drawer
      //     refuses is not a long document, and its caller falls back to the English one.
      //   • a non-empty `pdfPath` — the belt to the braces above.
      //
      // Rule 24(a)/(b): this is a distinct persisted state, not a silent fallback. The row
      // carries `over_cap`, the event `lp612.deliver.over_cap` carries the pages AND the caps
      // they were measured against, and both exist so the question the raised caps opened —
      // does the distribution simply refill to the new ceiling? — is answerable from data
      // after ~40 lessons rather than argued about.
      //
      // ── bd-oak77.14: AND NEVER LOST FOR A DEFECT THAT ONLY MAKES IT UGLIER ──
      //
      // Every clause above still holds, word for word. The middle one has only stopped being a
      // list of ONE code.
      //
      // 2026-09-06, the first Urdu tap on production (`grade_12_chemistry.c14.p227-230`, row
      // c41e8fd2-f401-42bc-a177-0897f36a1678). The final render's defect list was
      //   [ FIGURE TOO SMALL: … 13.25px in a 729px column (floor 13.5px) …,
      //     PAGE COUNT: teach needs 10 pages; the cap is 7,
      //     PAGE COUNT: support needs 7 pages; the cap is 6 ]
      // — a MIXED set, so `every(PAGE COUNT)` was false, so a finished 17-page document already
      // written to disk was thrown away over a diagram label 0.25px under a legibility floor. The
      // teacher re-typed "Lesson plan" 43 seconds later, re-tapped the same lesson, and that run
      // delivered: same code, same cell, a different roll of the authoring dice. A refusal nobody
      // can reproduce is not a quality gate, it is a coin toss she pays five minutes for.
      //
      // Operator, the same day: *"There should be no failures."*
      //
      // `deliveryVerdict` owns the judgement now, in one module, because three call sites make it
      // (this one, the timeout recovery below, and the Urdu overlay fallback) and bd-vjk68 already
      // recorded what a second copy of the rule costs. Class by class:
      //   PAGE COUNT                  -> delivered, `over_cap`      (unchanged)
      //   FIGURE / TYPE FLOOR / OVERFLOW / anything new
      //                               -> delivered, `render_degraded`, and she is told which kind
      //   TRUNCATION                  -> still FAILS. Pages of her lesson are MISSING FROM THE
      //                                  FILE; the plan just ends. `LP612_DELIVER_TRUNCATED=true`
      //                                  is the operator's one-variable override.
      const hasPdf = typeof e.pdfPath === 'string' && e.pdfPath.length > 0;
      const verdict = deliveryVerdict(e && e.problems, { hasPdf, infra: e && e.infra });
      if (!verdict.deliverable || !Array.isArray(e.problems) || e.problems.length === 0) throw e;

      return {
        overCap: verdict.overCap,
        degraded: verdict.degraded,
        degradedClasses: verdict.classes,
        degradedBy: verdict.degradedBy,
        rendered: {
          pdfPath: e.pdfPath,
          htmlPath: e.htmlPath,
          pageCount: e.pageCount ?? null,
          pagesByPart: e.pagesByPart || {},
          overlayApplied: e.overlayApplied || [],
          warnings: e.warnings || [],
          problems: e.problems,
        },
      };
    }
  };

  /**
   * A TEMPLATE BUMP IS A RE-RENDER, NOT A RE-AUTHORING — bd-oak77.12.
   *
   * The R2 cache key leads with the template version, so moving `LP_612_TEMPLATE_VERSION` turns
   * every already-cached lesson into a miss, and a miss lands here: the LLM writes the lesson
   * again. That is minutes and dollars per segment for a document we already hold — this worker
   * stores the exact `lp_doc` that made each PDF as `lp612/{tv}/{lang}/{segment}.lp.json`, beside
   * the PDF, on every successful run.
   *
   * So before authoring anything, look for that document under the versions this renderer is known
   * to accept (`previousTemplateVersions`, newest first) and, on the first hit, hand it back
   * shaped exactly like an authoring result. Every downstream reader of `authored` is satisfied:
   * `lpDoc` is the document, `model`/`rounds`/`lintClean`/`fails` exist rather than being absent,
   * and `reusedFrom` is what lets the row and the telemetry NAME this as a reuse (rule 24(d)).
   *
   * `templateVersion` here is the PAYLOAD's — the version the row and the key are keyed on — not
   * whatever the env happens to say when this line runs.
   *
   * Returns `null` when there is nothing to reuse, which is the ordinary case for a new segment.
   */
  const reuseFromPreviousVersion = async () => {
    const tried = previousTemplateVersions(templateVersion);
    // No fallback configured (the oldest version, an unknown one, or the explicit
    // `LP_612_TEMPLATE_FALLBACK=` off switch). Nothing was attempted, so neither arm is reported —
    // an event here would inflate the miss rate with runs that never looked.
    if (!tried.length) return null;

    const startedReuseAt = Date.now();
    for (const prev of tried) {
      const lpDoc = await Serving.readStoredDoc({
        segmentId, lang, tv: prev, correlationId,
      });
      if (!lpDoc) continue;
      logEvent('lp612.render.reused', {
        renderId,
        segmentId,
        correlationId: correlationId || null,
        lang,
        fromVersion: prev,
        toVersion: templateVersion,
        elapsedMs: Date.now() - startedReuseAt,
        llmCalls: 0,
      });
      logToFile('LP 6-12 worker: re-rendering a stored lesson for the new template version', {
        renderId, segmentId, lang, fromVersion: prev, toVersion: templateVersion, correlationId,
      });
      return {
        lpDoc,
        // NOT the worker's resolved model: no model ran. The row writes `reused:<version>` and
        // `null` here is what stops `authored.model || model` naming one that never was.
        model: null,
        rounds: 0,
        lintClean: null,
        fails: [],
        reusedFrom: prev,
      };
    }

    // Rule 24(b): a denominator that only exists when things go well is not a denominator. Without
    // this the reuse RATE is unknowable — "how many bumped lessons did we actually save" needs the
    // misses too, and a fleet-wide drop to zero hits (a key shape that moved, a permissions
    // change) would otherwise look exactly like a healthy first-run corpus.
    logEvent('lp612.render.reuse_miss', {
      renderId,
      segmentId,
      correlationId: correlationId || null,
      lang,
      toVersion: templateVersion,
      tried,
    });
    return null;
  };

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

      /**
       * THE SOFT TARGET IS A FINDING OF A SUCCESSFUL RENDER — bd-a8veu.22.
       *
       * `PAGE COUNT:` is a `problem`: the render throws and the defect reaches the ladder through
       * the catch below. `PAGE TARGET:` is a WARNING: the render succeeds, so it comes back on
       * the RETURN, and until now `attemptRenderCheck` threw that return away and answered
       * `{ clean: true }`. That is why the target had never once moved a document — nothing
       * downstream of the renderer could see it. Matched on the renderer's own emitted prefix,
       * the same way every other finding in this lane is matched, because `warnings` also carries
       * layout notes from the template build that are not addressed to the author.
       */
      const targetFindings = (res) => (
        Array.isArray(res && res.warnings) ? res.warnings.filter((w) => String(w).startsWith('PAGE TARGET:')) : []
      );

      const attemptRenderCheck = async (candidate) => {
        try {
          const res = await renderLessonPlan({
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
          return { clean: true, targets: targetFindings(res) };
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
        if (result.clean) return result.targets || [];
        if (!result.infra) return result.problems; // a real defect — feed it to the model, once

        result = await attemptRenderCheck(candidate); // the one retry
        if (result.clean) return result.targets || [];
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

      // bd-oak77.12. INSIDE the clock and OUTSIDE the spend: this is the first thing tried, and
      // `authorLessonPlan` — the first line in this job that can reach an LLM — runs only when it
      // comes back empty.
      const reused = await reuseFromPreviousVersion();
      const authored = reused || await authorLessonPlan({
        segment, lang, model, rounds: authorRounds(), correlationId, renderCheck,
        // bd-oak77.11. What a previous attempt already paid for, when there was one. `undefined`
        // when there was not, which is every first attempt and therefore the overwhelming majority
        // of runs — the ladder's behaviour is unchanged for them.
        ...(resumeFrom ? { resumeFrom } : {}),
        // bd-0cdug. The ladder hands out its best document as it goes, so a timeout has something
        // to deliver. Keeping only the DELIVERABLE ones means the catch below never has to
        // re-derive the delivery bar, and the two cannot drift apart.
        //
        // bd-oak77.11 rides the SAME hook: the candidate that makes a timeout survivable is
        // exactly the candidate that makes a SIGKILL survivable, once it is on the row.
        onCandidate: (c) => {
          if (c && c.deliverable) bestSoFar = c;
          writeCheckpoint(c);
        },
      });
      // Recorded the moment it exists, so a render that refuses it below is still explicable.
      authoredDoc = authored.lpDoc;

      // bd-17mht: pull down the book crops this document actually references,
      // into the same directory the renderer inlines from. Deliberately here —
      // after the LLM call that just cost minutes, before the render — so the
      // one or two small downloads never sit on the critical path. A crop that
      // fails to arrive is logged and the page degrades to its book-reference
      // card, exactly as it does today.
      const figRefs = refsFromDoc(authored.lpDoc);
      if (figRefs.length) {
        await stageFigures({ refs: figRefs, outDir: tmpDir, correlationId });
      }

      const final = await renderFinal(authored.lpDoc, 'final');

      return { authored, ...final };
    })(), authorTimeoutMs(), 'AUTHOR_TIMEOUT')
      // ── bd-0cdug: A LESSON IS NEVER LOST FOR TAKING TOO LONG ──────────────
      //
      // bd-vjk68 settled this for LENGTH — *a lesson is never lost for being long*. This is the
      // same rule applied to TIME, and it is here because the same waste was measured: on
      // 2026-09-05 three Urdu cells hit AUTHOR_TIMEOUT at 840s and two of them were still holding
      // renderable documents. d05's round-3 render had logged `lp612 render ok`, 11 pages. The
      // teacher got an apology for a lesson that existed.
      //
      // Deliberately narrow, each clause earning its place exactly as the over-cap one does:
      //   • ONLY on AUTHOR_TIMEOUT. Every other failure re-throws untouched — a recovery that
      //     swallowed PAGE_TRUTH_MISSING would turn a named fault into a mystery.
      //   • ONLY a DELIVERABLE candidate, and the service owns that word (`isDeliverable`):
      //     schema valid, nothing blocking but page count. OVERFLOW clips content off a page and
      //     TRUNCATION drops pages out of the file; however long she has waited, she must not be
      //     sent either.
      //   • the recovery DRAW is itself bounded, and if it fails the lesson fails as
      //     AUTHOR_TIMEOUT — the code it would have had anyway, not a new one nobody can read.
      .catch(async (e) => {
        if (e.code !== 'AUTHOR_TIMEOUT' || !bestSoFar) throw e;
        logToFile('LP 6-12 worker: the clock ran out on a lesson that already renders — delivering it', {
          renderId, segmentId, lang, correlationId,
          rounds: bestSoFar.rounds, fails: (bestSoFar.fails || []).slice(0, 5),
        }, 'warn');
        let recovered;
        try {
          recovered = await withTimeout(
            renderFinal(bestSoFar.lpDoc, 'final'), overlayTimeoutMs(), 'AUTHOR_TIMEOUT',
          );
        } catch (_) {
          throw e;   // the ORIGINAL timeout, not a second code for the same lost lesson
        }
        overTime = true;
        authoredDoc = bestSoFar.lpDoc;
        return {
          authored: {
            lpDoc: bestSoFar.lpDoc,
            rounds: bestSoFar.rounds,
            fails: bestSoFar.fails || [],
            lintClean: bestSoFar.lintClean === true,
            warns: [],
            model: bestSoFar.model || model,
            family: bestSoFar.family || family,
            tier: bestSoFar.tier || tier,
          },
          rendered: recovered.rendered,
          overCap: recovered.overCap,
          degraded: recovered.degraded,
          degradedClasses: recovered.degradedClasses,
          degradedBy: recovered.degradedBy,
        };
      });

    const { authored } = result;
    // `let`, because the Urdu overlay pass below may replace BOTH with the overlaid document and
    // its render. Everything downstream — the R2 put, the row, the caption — reads these, so the
    // swap happens exactly once, here, and nothing after it needs to know which one it got.
    let {
      rendered, overCap, degraded, degradedClasses, degradedBy,
    } = result;
    let deliveredDoc = authored.lpDoc;

    // ── THE URDU OVERLAY PASS (bd-zle0u) ────────────────────────────────────
    //
    // The separate pass over the finished document — the one a per-request prompt line claimed
    // existed for the whole life of this lane while `git grep ur_overlay` found only readers,
    // and every English-medium book asked for in Urdu was delivered in English (bd-vnyuw).
    //
    // IT RUNS HERE, AND HERE IS THE WHOLE POINT. Above this line the ladder has finished and the
    // English PDF exists on disk; `withTimeout(..., authorTimeoutMs(), 'AUTHOR_TIMEOUT')` has
    // already been raced and won. Putting the overlay inside that race — which is what emitting
    // it inline amounted to — cost ~+7,000 completion tokens on EVERY one of five rounds and
    // timed out all three Urdu cells at 840s. One call, at the end, on a document nobody is
    // going to revise again, is ~50s.
    //
    // AND IT CANNOT LOSE THE LESSON. Every failure path below — a call that fails, an overlay
    // that is thin or not actually Urdu, a renderer that refuses the overlaid document, the
    // pass's own clock — falls back to the English PDF this worker is already holding, with the
    // honest caption. That is the one rule this week has taught twice: the previous two attempts
    // each replaced a wrong-language lesson with NO lesson, and both were worse than the bug.
    // `!overTime` (bd-0cdug): she has already waited past the author timeout. Spending another
    // ~150s translating is the wrong trade — she gets the English lesson and the honest caption
    // that exists for exactly this, and the row records BOTH facts.
    // `!authored.reusedFrom` (bd-oak77.12): a REUSED Urdu document already carries its
    // `ur_overlay` — the worker stores `deliveredDoc`, which for a landed pass IS the overlaid
    // clone, so the pointers came down from R2 with the document. Translating it again would spend
    // ~50s and a full call to reproduce something we already have, and could not reproduce it
    // exactly: a second pass is a second generation, so the lesson a teacher has already been
    // served would quietly change wording underneath her on a template bump.
    if (lang === 'ur' && segment.language !== 'ur' && !overlayPassOff() && !overTime
        && !authored.reusedFrom) {
      const passStartedAt = Date.now();
      let pointers = 0;
      let coverage = null;
      let usage = null;
      try {
        const pass = await withTimeout((async () => {
          const out = await overlayLessonPlan({
            lpDoc: authored.lpDoc, segment, model, correlationId,
          });
          // A CLONE. The English document stays intact and renderable on this variable, because
          // it is the fallback — mutating it here would destroy the thing we fall back to.
          const overlaid = JSON.parse(JSON.stringify(authored.lpDoc));
          overlaid.ur_overlay = out.overlay;
          const render = await renderFinal(overlaid, 'overlay');
          return { out, overlaid, render };
        })(), overlayTimeoutMs(), 'OVERLAY_TIMEOUT');

        pointers = Array.isArray(pass.render.rendered.overlayApplied)
          ? pass.render.rendered.overlayApplied.length : 0;
        coverage = pass.out.coverage;
        usage = pass.out.usage;

        // A render that applied NOTHING is not a success with zero pointers — it is the failure
        // this whole bead is about, wearing a success's clothes. Treated as a drop so the
        // fallback runs and the caption stays honest (rule 24(a): the status is a claim; the
        // payload is the evidence).
        if (!pointers) throw fail0('OVERLAY_APPLIED_NONE', 'the overlaid render applied no pointers');

        rendered = pass.render.rendered;
        overCap = pass.render.overCap;
        // The OVERLAID render's verdict replaces the English one wholesale — including a clean
        // one. An overlay that repaired nothing must not inherit the English render's degradation,
        // and an overlaid page that came out crowded must not hide behind a clean English render.
        degraded = pass.render.degraded;
        degradedClasses = pass.render.degradedClasses;
        degradedBy = pass.render.degradedBy;
        deliveredDoc = pass.overlaid;
        overlayOutcome = 'applied';
      } catch (e) {
        overlayOutcome = 'failed';
        logToFile('LP 6-12 worker: the Urdu overlay pass did not land — delivering the English lesson', {
          renderId, segmentId, correlationId, code: e.code || null, error: e.message,
          elapsedMs: Date.now() - passStartedAt,
        }, 'warn');
      }

      // Emitted on BOTH paths, always, because a denominator that only exists when things go
      // wrong is not a denominator (rule 24(b)). This is the event that answers "what does the
      // pass cost, and how often does it land" — the two questions the inline overlay could
      // never be asked, since its cost was buried inside the authoring total.
      logEvent('lp612.overlay.pass', {
        renderId,
        segmentId,
        correlationId: correlationId || null,
        lang,
        medium: segment.language || null,
        outcome: overlayOutcome,
        pointers,
        coverage,
        elapsedMs: Date.now() - passStartedAt,
        tokens: usage ? usage.total_tokens : null,
        completionTokens: usage ? usage.completion_tokens : null,
        calls: usage ? usage.calls : null,
        model: authored.model || model,
      });
    }

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
        // The document that MADE THIS PDF — the overlaid one when the Urdu pass landed. Keeping
        // the English original here would make every Urdu diagnosis start from the wrong file.
        Buffer.from(JSON.stringify(deliveredDoc, null, 1), 'utf8'),
        // ONE definition of the sibling key (bd-oak77.12). The reuse path READS this object on a
        // later template version, so the writer and the reader must be incapable of disagreeing
        // about where it lives.
        Serving.assertKeyInPrefix(Serving.docKeyFor(segmentId, lang, templateVersion)),
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
    // THE OVER-TIME EVENT — bd-0cdug, and the same shape as over_cap for the same reason. This
    // is a fact about the RUN, so it is emitted before the row patch and the sends: it must exist
    // even if delivery then fails. `timeoutMs` travels with it because the clock is an env var
    // that moves (staging runs 840000 against a code default of 720000), and a `rounds: 4` six
    // weeks from now is uninterpretable unless the row also says what it was racing.
    if (overTime) {
      logEvent('lp612.deliver.over_time', {
        renderId,
        segmentId,
        correlationId: correlationId || null,
        lang,
        templateVersion,
        rounds: authored.rounds ?? null,
        timeoutMs: authorTimeoutMs(),
        page_count: rendered.pageCount ?? null,
        lintClean: authored.lintClean === true,
        fails: (authored.fails || []).slice(0, 4),
        elapsedMs: Date.now() - startedAt,
      });
    }

    // THE DEGRADED EVENT — bd-oak77.14, and deliberately the same shape as over_cap and over_time
    // for the same reason. "We shipped one long", "we shipped one late" and "we shipped one with a
    // small diagram" are three different questions and each needs its own countable answer. The
    // defect STRINGS ride along because the class alone ("figure") does not say whether the fleet
    // is drifting toward one diagram type — and finding that out from the render event instead
    // means joining two streams by renderId for every weekly read.
    if (degraded) {
      logEvent('lp612.deliver.degraded', {
        renderId,
        segmentId,
        correlationId: correlationId || null,
        lang,
        templateVersion,
        classes: degradedClasses || [],
        problems: degradedBy || [],
        notice: degradedNotice(degradedClasses),
        page_count: rendered.pageCount ?? null,
        pagesByPart: rendered.pagesByPart || null,
        rounds: authored.rounds ?? null,
        overCap: overCap === true,
        overTime: overTime === true,
      });
      logToFile('LP 6-12 worker: delivering a lesson with a render defect rather than failing it', {
        renderId, segmentId, lang, classes: degradedClasses, problems: degradedBy, correlationId,
      }, 'warn');
    }

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

    // Was an overlay ever ATTEMPTED for this render? Today: never — the overlay pass (bd-zle0u
    // step 2) is what will set this, and until it lands every Urdu request against an
    // English-medium book is a deliberate DEFERRAL, not a failure. Kept as an explicit variable
    // rather than inlined `false` so the two states are named where they are decided, and so the
    // pass has one place to plug into.
    const overlayAttempted = overlayOutcome !== null;

    // …AND IT IS AN EVENT, NOT ONLY A COLUMN (bd-vnyuw). The column answers "was this row's
    // lesson in the wrong language"; it cannot answer "how often, and did the fix hold" without
    // someone thinking to run that query. This lane went its whole life at 6-of-6 dropped with
    // nobody noticing, because the only trace was a boolean on a row nothing alerted on. The
    // event is the rate. `overlay.applied` is emitted on the good path for the same reason: a
    // denominator that only exists when things go wrong is not a denominator (rule 24(b)).
    //
    // AND A DEFERRAL IS NOT A FAILURE — bd-zle0u, rule 24(b)/(d). There are now THREE states
    // here, not two, and collapsing any pair of them makes the rate of each unreadable:
    //
    //   applied   — the overlay pass ran and its pointers reached the page. She has Urdu.
    //   deferred  — no overlay was attempted for this render. This is a POLICY outcome, not a
    //               fault, and it is the state every delivery is in until the overlay pass is
    //               live. It must not be counted as breakage, or the breakage rate is noise.
    //   dropped   — an overlay WAS attempted and did not survive. That is a fault, it is rare,
    //               and it is the number anyone debugging the pass actually wants.
    //
    // The row still records `overlay_dropped = true` for both of the last two, because the row's
    // column answers the teacher-facing question — "is this document in the language she asked
    // for?" — and for her the two are the same disappointment. The EVENTS are what separate a
    // deliberate deferral from a translation that broke.
    if (lang === 'ur' && segment.language !== 'ur') {
      const overlayEvent = !overlayDropped
        ? 'lp612.overlay.applied'
        : (overlayAttempted ? 'lp612.overlay.dropped' : 'lp612.overlay.deferred');
      logEvent(overlayEvent, {
        renderId,
        segmentId,
        correlationId,
        lang,
        medium: segment.language || null,
        pointers: Array.isArray(rendered.overlayApplied) ? rendered.overlayApplied.length : 0,
        rounds: authored.rounds ?? null,
        model: authored.model || model,
      });
      if (overlayDropped) {
        logToFile(
          overlayAttempted
            ? 'LP 6-12 worker: the Urdu overlay was attempted and did not survive — serving English'
            : 'LP 6-12 worker: no Urdu overlay was attempted — serving English, and saying so',
          { renderId, segmentId, lang, medium: segment.language || null, correlationId },
          overlayAttempted ? 'error' : 'warn',
        );
      }
    }

    await patch(renderId, {
      status: 'ready',
      // bd-oak77.11: the run is over, so the ladder's working copy is dead weight — and worse, a
      // redelivery of this same message must never resume from it. Named explicitly for the same
      // reason `error_code` and `over_cap` are: an UPDATE that does not name a column leaves
      // whatever was in it.
      checkpoint: null,
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
      // bd-0cdug. ALWAYS written, never left to whatever was in the column — same reasoning as
      // `over_cap` above and `error_code: null` below it. A NULL that means "we did not look" is
      // indistinguishable from a false in every query anyone will run, and a retry after a
      // recovered attempt would otherwise inherit `true`.
      over_time: overTime === true,
      // bd-oak77.14. ALWAYS written, never left to whatever was in the column — the identical
      // reasoning as `over_cap` and `over_time` above. This is the flag that makes "of the lessons
      // we sent, how many carried a render defect" answerable from the table, which is the only
      // way the never-fail policy can be judged rather than argued about; and a retry after a
      // degraded attempt must not inherit `true` (the bd-7yxsu mechanism).
      render_degraded: degraded === true,
      page_count: rendered.pageCount ?? null,
      // bd-oak77.12. A REUSED RENDER IS NAMEABLE ON THE ROW, never indistinguishable from an
      // authored one (rule 24(d)). No model ran and no ladder ran, so `model_used` records WHERE
      // THE DOCUMENT CAME FROM — `reused:v9.1` — rather than the model this worker would have
      // used, and the two lint columns stay NULL because "we did not look" is the truth here and
      // is a different fact from `false`/`[]`, which mean "we looked and it was not clean".
      model_used: authored.reusedFrom
        ? `reused:${authored.reusedFrom}`
        : (authored.model || model),
      rounds_used: authored.reusedFrom ? 0 : (authored.rounds ?? null),
      lint_clean: authored.reusedFrom ? null : (authored.lintClean === true),
      // Recorded even on a clean run (as []), so "was this ever gated?" is
      // answerable from the row rather than only from a log that rolls off.
      lint_fails: authored.reusedFrom ? null : (authored.fails || []),
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
    let selfServe = 0;
    for (const w of waiters) {
      // A WAITER WITH NO PHONE IS NOT A FAILED DELIVERY.
      //
      // Portal waiters are parked on this same list deliberately: the row is the only record of
      // who is owed this lesson, and leaving them off it would mean a teacher whose 3-minute
      // render finished had no way to be told. But they must not be SENT to. The lesson is
      // already sitting in R2 and her browser will presign it on its next poll — there is
      // nothing for this loop to do for her.
      //
      // Skipping is not a nicety. `deliverRender` would hand `phone: undefined` to Meta, throw,
      // and be counted as `deliveryFailures` — a lesson authored perfectly well, recorded as
      // lost. And because this loop shares ONE deadline across every waiter (see
      // SEND_TOTAL_BUDGET_MS), each doomed attempt spends retry budget belonging to the real
      // WhatsApp waiters queued behind it. One portal waiter could shorten the retries of the
      // teachers who actually need them.
      if (!w.phone) {
        selfServe += 1;
        continue;
      }
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
          // bd-oak77.14 — the honesty line for a lesson delivered with a layout defect.
          renderDegraded: degraded === true,
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
      // Waiters who collect the lesson themselves (the portal polls for it). Counted separately
      // so `delivered + deliveryFailures` no longer has to account for every waiter — without
      // this the arithmetic silently stops adding up once the portal is live.
      selfServe,
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
      // WHO ACTUALLY GOT IT, on the terminal event rather than only in a log line that rolls
      // off. `delivered + deliveryFailures` used to equal the whole waiter list; once the portal
      // parks phoneless waiters here it does not, and a gap with no name for it reads as lost
      // lessons. `selfServe` is that name — she is owed nothing by this loop because her browser
      // presigns the object on its next poll.
      delivered,
      deliveryFailures,
      selfServe,
      // The per-part pages on EVERY delivery, not only the over-cap ones (bd-vjk68). "Does the
      // distribution refill to the new cap?" is a question about all delivered lessons; a
      // sample of only the ones that spilled cannot answer it.
      pagesByPart: rendered.pagesByPart || null,
      overCap: overCap === true,
      overTime: overTime === true,
      renderDegraded: degraded === true,
      degradedClasses: degradedClasses || [],
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

module.exports = {
  process,
  // Exported for tests only. `patch` is the one write every terminal state goes through, and its
  // missing-column behaviour cannot be exercised through `process()` without also standing up an
  // author, a renderer and an R2 (see tests/lp612/missing-column-guard.test.js).
  patchForTest: patch,
};
