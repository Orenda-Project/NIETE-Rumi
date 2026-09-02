/**
 * FEAT-080 — what happens between the tap and the PDF.
 *
 * The operator's decision was runtime authoring with NO pre-generation: the
 * first teacher to ask for a lesson pays for it being written, and every teacher
 * after her is served from R2 instantly. So this service answers exactly one
 * question — is there a render for (segment_id, lang, template_version)? — and
 * has four honest answers:
 *
 *   ready      → presign and send it. Nothing is enqueued.
 *   authoring  → someone else is already paying for this one. Join their waiter
 *                list and say so.
 *   failed     → reset it and try again. A failed row is not a dead lesson.
 *   absent     → claim it, ack her, enqueue the authoring job.
 *
 * Two design points worth stating because they are easy to undo:
 *
 * **The ack comes before the enqueue.** Authoring takes ~2 minutes typically and
 * has been measured up to ~10 with a full revision ladder. The acknowledgement
 * is the only thing standing between the teacher and two minutes of a bot that
 * looks broken, so it is sent first and its failure does not stop the job.
 *
 * **The unique constraint is the lock.** Two teachers tapping the same lesson in
 * the same minute both find no row and both try to insert; Postgres lets exactly
 * one through and hands the other a 23505, which is caught here and turned into
 * joining the winner. Without it the lesson is authored twice — about $1.50 and
 * several minutes of worker time thrown away, and neither run knows about the
 * other.
 */

const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const WhatsAppService = require('./whatsapp.service');
const { queueJob } = require('./queue');
const { buildR2PublicUrl, getPresignedUrl } = require('../storage/r2');
const { resolveUx, clampLanguage } = require('../config/ux-strings');
const Catalog = require('./lp612-catalog.service');
const { isReligiousEnabled, templateVersion } = require('../config/lp612-flags');

const RENDERS = 'niete_lp612_renders';
const JOB_TYPE = 'lp612_author';

/** Postgres unique_violation — the concurrency signal, not an error to report. */
const UNIQUE_VIOLATION = '23505';

const FILENAME_MAX = 64;

/** R2 layout. template_version leads so a version's whole cache is one prefix
 *  and can be listed, measured or expired without touching another's. */
function r2KeyFor(segmentId, lang, tv) {
  return `lp612/${tv}/${lang}/${segmentId}.pdf`;
}

function buildFilename(segment, lang) {
  const base = `${segment.book_stem}_${segment.chapter_key}_p${segment.printed_page_start}`
    .replace(/[^A-Za-z0-9_-]/g, '_');
  return `${base}_${lang}.pdf`.slice(0, FILENAME_MAX);
}

function buildCaption(segment, lang) {
  const pages = segment.printed_page_start === segment.printed_page_end
    ? String(segment.printed_page_start)
    : `${segment.printed_page_start}-${segment.printed_page_end}`;
  return resolveUx('lp612Caption', {
    language: lang,
    params: {
      topic: segment.subtopic_title || segment.menu_title || '',
      grade: segment.grade,
      subject: segment.subject,
      pages,
    },
  });
}

/** Say something, always, and never let saying it break the caller. */
async function tell(phone, key, lang) {
  try {
    await WhatsAppService.sendMessage(phone, resolveUx(key, { language: lang }));
  } catch (err) {
    logToFile('LP 6-12: could not send message', { key, error: err.message });
  }
}

async function findRender(segmentId, lang, tv) {
  const { data, error } = await supabase
    .from(RENDERS)
    .select('id, status, r2_key, waiters, error_code')
    .eq('segment_id', segmentId)
    .eq('lang', lang)
    .eq('template_version', tv)
    .maybeSingle();
  if (error) {
    logToFile('LP 6-12: render lookup failed', { segmentId, lang, tv, error: error.message });
    return null;
  }
  return data || null;
}

/** Send a finished render to one phone. Exported because the worker delivers
 *  the same bytes to the same shape of recipient when the job completes. */
async function deliverRender({ phone, r2Key, segment, lang }) {
  const url = await getPresignedUrl(buildR2PublicUrl(r2Key));
  await WhatsAppService.sendDocumentByLink(
    phone,
    url,
    buildFilename(segment, lang),
    buildCaption(segment, lang),
  );
}

function waiterEntry({ userId, phone }) {
  return { user_id: userId, phone, requested_at: new Date().toISOString() };
}

async function addWaiter(renderId, waiters, req) {
  const list = Array.isArray(waiters) ? waiters : [];
  // Tapping twice must not mean being sent the lesson twice.
  if (list.some((w) => w && w.user_id === req.userId)) return list;
  const next = [...list, waiterEntry(req)];
  const { error } = await supabase
    .from(RENDERS)
    .update({ waiters: next, updated_at: new Date().toISOString() })
    .eq('id', renderId);
  if (error) {
    logToFile('LP 6-12: could not join waiter list', { renderId, error: error.message });
  }
  return next;
}

async function enqueue({ renderId, segmentId, lang, tv, correlationId }) {
  await queueJob(segmentId, JOB_TYPE, {
    renderId,
    segmentId,
    lang,
    templateVersion: tv,
    correlationId,
  });
}

/**
 * The whole serving decision.
 *
 * @param {object} req
 * @param {string} req.segmentId  the row a teacher tapped
 * @param {string} req.userId
 * @param {string} req.phone
 * @param {string} [req.lang]     clamped to the deployment's offer (en/ur)
 * @param {string} [req.correlationId]
 * @returns {Promise<{outcome: string, [key: string]: any}>}
 *   outcome ∈ cache_hit | queued | joined | retry | held | not_found | deliver_failed | error
 */
async function requestLesson({ segmentId, userId, phone, lang, correlationId }) {
  const language = clampLanguage(lang);
  const tv = templateVersion();

  const segment = await Catalog.segmentById(segmentId);
  if (!segment) {
    logToFile('LP 6-12: segment not found', { segmentId, correlationId });
    await tell(phone, 'lp612NotFound', language);
    return { outcome: 'not_found' };
  }

  // The operator's hold. Checked on the row rather than on a subject name, so
  // a seerah chapter inside a non-Islamiat book is held too.
  if (segment.is_religious && !isReligiousEnabled()) {
    logToFile('LP 6-12: religious segment withheld', { segmentId, correlationId });
    await tell(phone, 'lp612Held', language);
    return { outcome: 'held' };
  }

  const req = { userId, phone };
  const existing = await findRender(segmentId, language, tv);

  // ── hit ──────────────────────────────────────────────────────────────────
  // `ready` is a claim; r2_key is the evidence. A ready row with no key is
  // treated as a miss — presigning `undefined` would fail at Meta with nothing
  // useful logged.
  if (existing && existing.status === 'ready' && existing.r2_key) {
    try {
      await deliverRender({ phone, r2Key: existing.r2_key, segment, lang: language });
      logToFile('LP 6-12: served from cache', { segmentId, lang: language, tv, correlationId });
      return { outcome: 'cache_hit', renderId: existing.id };
    } catch (err) {
      logToFile('LP 6-12: cache delivery failed', {
        segmentId, r2Key: existing.r2_key, error: err.message, correlationId,
      });
      await tell(phone, 'lp612Failed', language);
      return { outcome: 'deliver_failed', error: err.message };
    }
  }

  // ── already running ──────────────────────────────────────────────────────
  if (existing && existing.status === 'authoring') {
    await addWaiter(existing.id, existing.waiters, req);
    await tell(phone, 'lp612AlreadyPreparing', language);
    logToFile('LP 6-12: joined render in flight', { segmentId, renderId: existing.id, correlationId });
    return { outcome: 'joined', renderId: existing.id };
  }

  // ── retry a failure, or re-claim a ready row with no bytes ───────────────
  if (existing) {
    const { error } = await supabase
      .from(RENDERS)
      .update({
        status: 'authoring',
        error_code: null,
        error_detail: null,
        waiters: [waiterEntry(req)],
        requested_by: userId,
        correlation_id: correlationId,
        started_at: new Date().toISOString(),
        completed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (error) {
      logToFile('LP 6-12: could not reset render for retry', {
        renderId: existing.id, error: error.message, correlationId,
      });
      await tell(phone, 'lp612Failed', language);
      return { outcome: 'error', error: error.message };
    }
    await tell(phone, 'lp612Preparing', language);
    await enqueue({ renderId: existing.id, segmentId, lang: language, tv, correlationId });
    logToFile('LP 6-12: retrying failed render', {
      segmentId, renderId: existing.id, previous: existing.error_code, correlationId,
    });
    return { outcome: 'retry', renderId: existing.id };
  }

  // ── miss: claim it ───────────────────────────────────────────────────────
  const { data: created, error: insertError } = await supabase
    .from(RENDERS)
    .insert({
      segment_id: segmentId,
      lang: language,
      template_version: tv,
      status: 'authoring',
      waiters: [waiterEntry(req)],
      requested_by: userId,
      correlation_id: correlationId,
    })
    .select('id')
    .single();

  if (insertError) {
    // Lost the race. The winner is already authoring exactly this lesson.
    if (insertError.code === UNIQUE_VIOLATION) {
      const winner = await findRender(segmentId, language, tv);
      if (winner) {
        await addWaiter(winner.id, winner.waiters, req);
        await tell(phone, 'lp612AlreadyPreparing', language);
        logToFile('LP 6-12: lost insert race, joined winner', {
          segmentId, renderId: winner.id, correlationId,
        });
        return { outcome: 'joined', renderId: winner.id };
      }
    }
    logToFile('LP 6-12: could not claim render', {
      segmentId, error: insertError.message, code: insertError.code, correlationId,
    });
    await tell(phone, 'lp612Failed', language);
    return { outcome: 'error', error: insertError.message };
  }

  // Ack FIRST. Two minutes of silence is the failure mode this prevents.
  await tell(phone, 'lp612Preparing', language);
  await enqueue({ renderId: created.id, segmentId, lang: language, tv, correlationId });
  logToFile('LP 6-12: queued runtime authoring', {
    segmentId, renderId: created.id, lang: language, tv, correlationId,
  });
  return { outcome: 'queued', renderId: created.id };
}

module.exports = {
  requestLesson,
  deliverRender,
  buildFilename,
  buildCaption,
  r2KeyFor,
  RENDERS,
  JOB_TYPE,
};
