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
 *  - **Every waiter gets the lesson.** The render row's waiter list is the whole
 *    audience, not just whoever's tap happened to lose the insert race. One
 *    delivery failure does not cancel the others.
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
const WhatsAppService = require('../shared/services/whatsapp.service');
const { uploadBuffer } = require('../shared/storage/r2');
const { resolveUx } = require('../shared/config/ux-strings');
const { authorLessonPlan } = require('../shared/services/lp612-author.service');
const { renderLessonPlan } = require('../shared/services/lp612-render.service');
const Serving = require('../shared/services/lp612-serving.service');
const {
  resolveAuthorModel, authorRounds, authorTimeoutMs, followupAfterMs,
} = require('../shared/config/lp612-flags');

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

/** Tell every waiter the same thing. Never throws — a failure to console
 *  someone must not become the reason the job dies. */
async function tellAll(waiters, key, lang) {
  for (const w of waiters) {
    try {
      await WhatsAppService.sendMessage(w.phone, resolveUx(key, { language: lang }));
    } catch (err) {
      logToFile('LP 6-12 worker: could not message waiter', {
        phone: w.phone, key, error: err.message,
      });
    }
  }
}

/**
 * Fail one render: mark the row, tell everyone waiting, and return a result the
 * SQS switch can ack. A failed row is not a dead lesson — the next tap sees
 * `failed` and retries.
 */
async function fail(renderId, waiters, lang, code, detail) {
  await patch(renderId, {
    status: 'failed',
    error_code: code || 'UNKNOWN',
    error_detail: String(detail || '').slice(0, 2000),
    completed_at: nowIso(),
  });
  await tellAll(waiters, 'lp612Failed', lang);
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

  const waiters = waitersOf(render);

  const segment = await loadSegment(segmentId);
  if (!segment) {
    return fail(renderId, waiters, lang, 'SEGMENT_MISSING',
      `segment ${segmentId} not found`);
  }

  // The slow tail gets a second message rather than silence. Cleared on every
  // exit path so a fast render cannot leave a "still working" message behind it.
  let followup = setTimeout(() => {
    tellAll(waiters, 'lp612StillWorking', lang).catch(() => {});
  }, followupAfterMs());
  if (followup.unref) followup.unref();
  const stopFollowup = () => { clearTimeout(followup); followup = null; };

  const model = resolveAuthorModel();
  let tmpDir;

  try {
    const result = await withTimeout((async () => {
      const authored = await authorLessonPlan({
        segment, lang, model, rounds: authorRounds(), correlationId,
      });

      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lp612-'));
      const rendered = await renderLessonPlan({
        lpDoc: authored.lpDoc,
        lang,
        stem: segmentId.replace(/[^A-Za-z0-9._-]/g, '_'),
        outDir: tmpDir,
        correlationId,
      });

      return { authored, rendered };
    })(), authorTimeoutMs(), 'AUTHOR_TIMEOUT');

    const { authored, rendered } = result;

    const pdf = await fs.promises.readFile(rendered.pdfPath);
    const r2Key = Serving.r2KeyFor(segmentId, lang, templateVersion);
    await uploadBuffer(pdf, r2Key, 'application/pdf');

    stopFollowup();

    await patch(renderId, {
      status: 'ready',
      r2_key: r2Key,
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
      // The audience is consumed. Leaving it populated would re-send the lesson
      // to everyone if this row were ever reprocessed.
      waiters: [],
      completed_at: nowIso(),
    });

    let delivered = 0;
    let deliveryFailures = 0;
    for (const w of waiters) {
      try {
        await Serving.deliverRender({
          phone: w.phone, r2Key, segment, lang, oneScreen: oneScreenOf(authored),
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
    return fail(renderId, waiters, lang, err.code, err.message);
  } finally {
    stopFollowup();
    if (tmpDir) {
      fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

module.exports = { process };
