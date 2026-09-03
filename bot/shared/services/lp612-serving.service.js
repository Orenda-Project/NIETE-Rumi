/**
 * What happens between the tap and the PDF, for grades 6-12.
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
// NB: the queue is required LAZILY, inside enqueue() — see the note there.
const { buildR2PublicUrl, getPresignedUrl } = require('../storage/r2');
const { resolveUx, clampLanguage } = require('../config/ux-strings');
const Catalog = require('./lp612-catalog.service');
// The shelf `buildLpContext` reads. Required at module scope deliberately: it pulls in the Redis
// wrapper, which the root suites already stub, and a lazy require here would hide a missing
// dependency until the first real delivery.
const LPShelfService = require('./lp-shelf.service');
const { isReligiousEnabled, templateVersion, authorTimeoutMs } = require('../config/lp612-flags');

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

/** The ONLY isolation this lane has. */
const R2_KEY_PREFIX = 'lp612/';

/**
 * Refuse to write anywhere but under `lp612/`.
 *
 * NIETE and PK production share ONE bucket with byte-identical credentials. There is no separate
 * bucket, no separate account, and nothing at the storage layer that would stop a wrong key
 * landing on top of a PK production asset — `pre_gen_lps/`, `lesson_plans/`, `lp-cache/v8/` and
 * `audio/` are all one mistake away.
 *
 * The page-truth uploader has carried this guard since day one, and its comment says exactly why
 * it is applied at the put and not at plan time: "so that no future caller can construct a key
 * some other way and skip it." The serving path WAS that future caller — it uploaded the PDF, and
 * later the authored document, with keys that were correct only because `r2KeyFor` happened to
 * build them. That is a convention, not an enforcement.
 *
 * It lives HERE, beside the key builder, so key shape and key safety are decided in one place.
 *
 * Traversal is checked FIRST: `lp612/../pre_gen_lps/x` starts with the prefix and does not stay
 * inside it.
 */
function assertKeyInPrefix(key) {
  const k = String(key == null ? '' : key);
  if (!k) throw new Error('refusing to write an empty R2 key');
  if (k.includes('..')) {
    throw new Error(`refusing to write "${k}": path traversal outside ${R2_KEY_PREFIX}`);
  }
  if (!k.startsWith(R2_KEY_PREFIX)) {
    throw new Error(
      `refusing to write "${k}": this bucket is shared with PK production and this lane `
      + `may only write under the ${R2_KEY_PREFIX} prefix`,
    );
  }
  return k;
}

function buildFilename(segment, lang) {
  const base = `${segment.book_stem}_${segment.chapter_key}_p${segment.printed_page_start}`
    .replace(/[^A-Za-z0-9_-]/g, '_');
  return `${base}_${lang}.pdf`.slice(0, FILENAME_MAX);
}

/** "71" for a single page, "71-73" for a range. One definition, two callers. */
function pagesLabel(segment) {
  return segment.printed_page_start === segment.printed_page_end
    ? String(segment.printed_page_start)
    : `${segment.printed_page_start}-${segment.printed_page_end}`;
}

function buildCaption(segment, lang, { overlayDropped = false } = {}) {
  const pages = pagesLabel(segment);
  const caption = resolveUx('lp612Caption', {
    language: lang,
    params: {
      topic: segment.subtopic_title || segment.menu_title || '',
      grade: segment.grade,
      subject: segment.subject,
      pages,
    },
  });
  // The honesty line (rule 24(c)/(d)): an Urdu delivery whose document lost its
  // ur_overlay is an essentially-English document under an Urdu label, and the
  // caption says so instead of promising what the pages do not hold. Urdu
  // territory only — an English delivery of an English book dropped nothing.
  if (overlayDropped && lang === 'ur') {
    return `${caption}\n${resolveUx('lp612OverlayDropped', { language: lang })}`;
  }
  return caption;
}

/** Say something, always, and never let saying it break the caller. */
async function tell(phone, key, lang) {
  try {
    await WhatsAppService.sendMessage(phone, resolveUx(key, { language: lang }));
  } catch (err) {
    logToFile('LP 6-12: could not send message', { key, error: err.message });
  }
}

/**
 * How long past its own hard stop a run has to be before we call it dead.
 *
 * The worker gives up at authorTimeoutMs and writes `failed`. If a row is STILL `authoring` well
 * past that, nobody is coming to write it: the process that owned it is gone. The grace is there
 * so we do not shoot a run that is merely finishing its upload — authoring the same lesson twice
 * costs ~$0.60 and several minutes, and the unique constraint exists precisely to avoid that.
 */
const STRANDED_GRACE_MS = 3 * 60 * 1000;

/**
 * Is this row a corpse?
 *
 * Measured on staging: a deploy killed the worker mid-authoring, the SQS message was never acked
 * and dead-lettered, and the row sat at `authoring` indefinitely. `requestLesson` reads that as
 * "someone else is already paying for this one", so every later tap joined a run that was never
 * coming back — the teacher told her lesson was being written, forever, with no error and no way
 * out. Nothing else in this table can express "the owner died", so it is inferred from the clock.
 */
function isStrandedAuthoring(render) {
  if (!render || render.status !== 'authoring' || !render.started_at) return false;
  const startedAt = Date.parse(render.started_at);
  if (!Number.isFinite(startedAt)) return false;
  return (Date.now() - startedAt) > (authorTimeoutMs() + STRANDED_GRACE_MS);
}

/**
 * The sweep, for when nobody taps.
 *
 * The tap path below heals the teacher standing in front of us, but a stranded row that nobody
 * touches is still lying about its state when the NEXT teacher arrives. This transitions those
 * rows to `failed` with a NAMED code, so the next tap retries — and so that "how often does a
 * deploy strand a lesson?" is answerable by query rather than from logs that have rolled off.
 *
 * Returns a count and never throws: it runs inside the worker's periodic sweep, where an
 * exception would take the other sweeps down with it.
 */
async function reapStrandedRenders() {
  const cutoff = new Date(Date.now() - (authorTimeoutMs() + STRANDED_GRACE_MS)).toISOString();
  const { data, error } = await supabase
    .from(RENDERS)
    .select('id, segment_id, started_at')
    .eq('status', 'authoring')
    .lt('started_at', cutoff);
  if (error) {
    logToFile('LP 6-12: stranded-render sweep read failed', { error: error.message });
    return 0;
  }
  const rows = data || [];
  if (!rows.length) return 0;

  const { error: patchError } = await supabase
    .from(RENDERS)
    .update({
      status: 'failed',
      error_code: 'AUTHOR_STRANDED',
      error_detail: 'The worker that owned this run went away (almost always a restart mid-authoring). Reset by the sweep so the next tap retries.',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in('id', rows.map((r) => r.id));
  if (patchError) {
    logToFile('LP 6-12: stranded-render sweep write failed', { error: patchError.message });
    return 0;
  }
  logToFile('LP 6-12: reaped stranded renders', {
    count: rows.length, segmentIds: rows.map((r) => r.segment_id).slice(0, 20),
  });
  return rows.length;
}

async function findRender(segmentId, lang, tv) {
  const { data, error } = await supabase
    .from(RENDERS)
    .select('id, status, r2_key, waiters, error_code, one_screen, started_at, overlay_dropped')
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

/**
 * The message that goes out beside the file.
 *
 * `one_screen` is the lesson on one phone screen — the field the authoring brief
 * calls "the WhatsApp body" and the lint gate sizes at 150-260 words. The video
 * link, when the segment has one, is appended as a PLAIN url: WhatsApp linkifies
 * it, and a bare url needs no catalog string, which means no new teacher-facing
 * copy and no field cap to get wrong in either language.
 *
 * Returns '' when there is nothing to say. Renders cached before this shipped
 * carry no stored `one_screen`, and an empty message is worse than none.
 */
function buildBody({ oneScreen, segment }) {
  const yt = segment && segment.yt;
  const parts = [];
  if (oneScreen && String(oneScreen).trim()) parts.push(String(oneScreen).trim());
  // `yt.url`, never `yt` — the swarm writes a slot for every segment it
  // considered and only a resolved one carries a url. A truthy urlless object
  // would put a lone emoji on its own line.
  if (yt && yt.url) parts.push(`\u{1F4FA} ${yt.url}`);
  return parts.join('\n\n');
}

/** Send a finished render to one phone. Exported because the worker delivers
 *  the same bytes to the same shape of recipient when the job completes.
 *  `overlayDropped` rides along so the caption can be honest about a degraded
 *  Urdu document — on the first delivery AND on every cache hit after it. */
/**
 * Leave a trace of this delivery where the CHAT can find it.
 *
 * Until this existed, `deliverRender` sent two messages and returned. `buildLpContext` reads the
 * LP shelf and then `niete_lp_downloads`; this lane wrote to neither, so a teacher who replied
 * "what does the activity mean?" was answered by a model that had never seen her lesson — a
 * confident, ungrounded reply that reads like an answer.
 *
 * THE ENTRY IS DELIBERATELY THIN. `lp-context.service`'s renderEntry runs two K-5 resolvers over
 * every shelf entry: `resolveMoveList` returns null the moment `lesson_id` is absent (free), but
 * `getVoicenoteScript` derives a `.txt` key from `r2_key` and FETCHES IT FROM R2. A 6-12 lesson
 * has no voicenote, so passing the PDF key would buy a guaranteed-missing R2 round-trip on every
 * turn of every conversation. So: no `lesson_id`, no `content_hash`, no `r2_key`. What is here is
 * exactly what `headingFor` renders plus the one-screen summary, which is the part that actually
 * grounds her question.
 *
 * `lane` marks it ours without anyone having to infer "6-12" from which fields are missing.
 *
 * Soft-fail, like the body send above it and for the same reason: the lesson is the document.
 * Redis being down must never cost her the thing she asked for.
 */
async function recordDelivery({ userId, segment, lang, oneScreen }) {
  if (!userId) return;
  try {
    await LPShelfService.pushToShelf(userId, {
      lane: 'lp612',
      segment_id: segment.segment_id,
      grade: segment.grade,
      subject: segment.subject,
      chapter_number: segment.chapter_number,
      chapter_title: segment.chapter_title,
      topic: segment.subtopic_title || segment.menu_title || '',
      pages_label: pagesLabel(segment),
      one_screen: oneScreen || null,
      lang,
      delivered_at: new Date().toISOString(),
    });
  } catch (err) {
    logToFile('LP 6-12: could not record the delivery on the shelf', {
      segmentId: segment && segment.segment_id, userId, error: err.message,
    });
  }
}

async function deliverRender({ phone, userId, r2Key, segment, lang, oneScreen, overlayDropped }) {
  const url = await getPresignedUrl(buildR2PublicUrl(r2Key));

  // The body goes FIRST: she is on a phone, and the summary is readable in the
  // seconds before a multi-megabyte PDF has finished downloading.
  //
  // Its failure is swallowed on purpose. The lesson is the document; losing the
  // summary must never cost her the thing she actually asked for, and the whole
  // point of the ordering is defeated if it can throw before the file is sent.
  const body = buildBody({ oneScreen, segment });
  if (body) {
    try {
      await WhatsAppService.sendMessage(phone, body);
    } catch (err) {
      logToFile('LP 6-12: could not send lesson body', {
        segmentId: segment && segment.segment_id, error: err.message,
      });
    }
  }

  await WhatsAppService.sendDocumentByLink(
    phone,
    url,
    buildFilename(segment, lang),
    buildCaption(segment, lang, { overlayDropped: overlayDropped === true }),
  );

  // AFTER the document, never before: recording is for us, the PDF is for her.
  await recordDelivery({ userId, segment, lang, oneScreen });
}

/** `ui_lang` is the language SHE is spoken to in — recorded per waiter, because
 *  two teachers waiting on one render need not share one. The document's own
 *  language is on the row; this is the other territory. */
function waiterEntry({ userId, phone, uiLang }) {
  return {
    user_id: userId, phone, ui_lang: uiLang, requested_at: new Date().toISOString(),
  };
}

/**
 * Join the waiter list, ATOMICALLY.
 *
 * This used to read `waiters`, append in JS, and write the whole array back. Measured on staging:
 * twenty concurrent taps on one lesson, all twenty told "I'll send it here as soon as it's ready",
 * and TWO waiters survived — 90% dropped, worst on the most popular lesson. Every caller read the
 * same array and wrote a one-element array back; last write won. Nothing errored, nothing logged,
 * and the ack had already gone out, so the failure was invisible from both sides.
 *
 * The append now happens inside ONE statement in `lp612_join_waiters`, where the row lock
 * serialises writers and `waiters` is re-read while held. Retrying a lost write would not have
 * fixed this — only atomicity does.
 *
 * @returns 'joined' | 'duplicate' | 'not_authoring' | 'missing' | 'error'
 */
async function joinWaiters(renderId, req) {
  const { data, error } = await supabase.rpc('lp612_join_waiters', {
    p_render_id: renderId,
    p_entry: waiterEntry(req),
  });
  if (error) {
    // Never silent: she is still told something by the caller, and this is the line that says why
    // a lesson went missing if it ever does again.
    logToFile('LP 6-12: could not join waiter list', { renderId, error: error.message });
    return 'error';
  }
  return data || 'error';
}

async function enqueue({ renderId, segmentId, lang, tv, correlationId }) {
  // Required HERE, not at module scope, for two independent reasons.
  //
  // 1. `./queue` pulls in the SQS driver, which requires `aws-sdk` at module
  //    scope. Root suites run before `bot/ npm ci`, so a module-scope require
  //    kills every suite FILE that transitively reaches this service — which is
  //    how a change here took the existing pakistan-lp-endpoint suite red
  //    without touching a line of its behaviour. `video-job-queue.service.js`
  //    requires the queue inside each method for the same reason.
  //
  // 2. It is the SINGLETON, never a destructured method: queueJob reads
  //    `this.queueUrl` and `this.quizQueueUrl`, so pulling the function off the
  //    module strips its receiver and throws on the first real enqueue.
  const SQSQueueService = require('./queue');

  await SQSQueueService.queueJob(segmentId, JOB_TYPE, {
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
 * @param {string} [req.lang]     the DOCUMENT's language, clamped to the offer (en/ur)
 * @param {string} [req.uiLang]   the language SHE is spoken to in (acks, holds,
 *                                failures). Defaults to `lang` — she did just
 *                                choose it — but the two are separate
 *                                territories: an Urdu-UI teacher ordering an
 *                                English physics plan gets an English PDF and
 *                                Urdu acks. (language-protocol invariant 4)
 * @param {string} [req.correlationId]
 * @returns {Promise<{outcome: string, [key: string]: any}>}
 *   outcome ∈ cache_hit | queued | joined | retry | held | not_found | deliver_failed | error
 */
async function requestLesson({ segmentId, userId, phone, lang, uiLang, correlationId }, depth = 0) {
  const language = clampLanguage(lang);
  const voice = clampLanguage(uiLang || lang);
  const tv = templateVersion();

  const segment = await Catalog.segmentById(segmentId);
  if (!segment) {
    logToFile('LP 6-12: segment not found', { segmentId, correlationId });
    await tell(phone, 'lp612NotFound', voice);
    return { outcome: 'not_found' };
  }

  // The operator's hold. Checked on the row rather than on a subject name, so
  // a seerah chapter inside a non-Islamiat book is held too — and checked HERE,
  // after the menu's own filter, so a forged or stale payload arriving at any
  // step (lp612_segment, lp612_serve) meets it in both languages identically.
  if (segment.is_religious && !isReligiousEnabled()) {
    logToFile('LP 6-12: religious segment withheld', { segmentId, correlationId });
    await tell(phone, 'lp612Held', voice);
    return { outcome: 'held' };
  }

  const req = { userId, phone, uiLang: voice };
  const existing = await findRender(segmentId, language, tv);

  // ── hit ──────────────────────────────────────────────────────────────────
  // `ready` is a claim; r2_key is the evidence. A ready row with no key is
  // treated as a miss — presigning `undefined` would fail at Meta with nothing
  // useful logged.
  if (existing && existing.status === 'ready' && existing.r2_key) {
    try {
      await deliverRender({
        phone,
        userId,
        r2Key: existing.r2_key,
        segment,
        lang: language,
        oneScreen: existing.one_screen,
        overlayDropped: existing.overlay_dropped === true,
      });
      logToFile('LP 6-12: served from cache', { segmentId, lang: language, tv, correlationId });
      return { outcome: 'cache_hit', renderId: existing.id };
    } catch (err) {
      logToFile('LP 6-12: cache delivery failed', {
        segmentId, r2Key: existing.r2_key, error: err.message, correlationId,
      });
      await tell(phone, 'lp612Failed', voice);
      return { outcome: 'deliver_failed', error: err.message };
    }
  }

  // ── already running ──────────────────────────────────────────────────────
  // A LIVE run is joined — that is what the unique constraint is for, and paying twice for one
  // lesson is the thing it prevents. A STRANDED one falls through to the reset below instead,
  // because joining a corpse is how a teacher ends up waiting forever.
  if (existing && existing.status === 'authoring' && !isStrandedAuthoring(existing)) {
    const joined = await joinWaiters(existing.id, req);

    // The run finished between our read and our append. The worker clears `waiters` when it
    // delivers, so parking her on that list now means she waits for ever for a job that is
    // already over. Re-decide once against the row as it now stands — she is owed the lesson,
    // which by definition is sitting in R2.
    if (joined === 'not_authoring' && depth === 0) {
      logToFile('LP 6-12: render finished mid-join, re-deciding', {
        segmentId, renderId: existing.id, correlationId,
      });
      return requestLesson({ segmentId, userId, phone, lang, uiLang, correlationId }, depth + 1);
    }

    await tell(phone, 'lp612AlreadyPreparing', voice);
    logToFile('LP 6-12: joined render in flight', {
      segmentId, renderId: existing.id, result: joined, correlationId,
    });
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
      await tell(phone, 'lp612Failed', voice);
      return { outcome: 'error', error: error.message };
    }
    // Distinct copy for a distinct state (rule 24(d)). A stranded run is not a fresh request and
    // it is not an ordinary failure — she watched it say "preparing" and nothing came.
    const stranded = isStrandedAuthoring(existing);
    await tell(phone, stranded ? 'lp612Restarted' : 'lp612Preparing', voice);
    await enqueue({ renderId: existing.id, segmentId, lang: language, tv, correlationId });
    logToFile('LP 6-12: retrying render', {
      segmentId,
      renderId: existing.id,
      previous: existing.error_code,
      // Named separately so a query can count how often a restart costs a lesson.
      reason: stranded ? 'stranded' : 'failed',
      correlationId,
    });
    return { outcome: 'retry', renderId: existing.id, stranded };
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
        await joinWaiters(winner.id, req);
        await tell(phone, 'lp612AlreadyPreparing', voice);
        logToFile('LP 6-12: lost insert race, joined winner', {
          segmentId, renderId: winner.id, correlationId,
        });
        return { outcome: 'joined', renderId: winner.id };
      }
    }
    logToFile('LP 6-12: could not claim render', {
      segmentId, error: insertError.message, code: insertError.code, correlationId,
    });
    await tell(phone, 'lp612Failed', voice);
    return { outcome: 'error', error: insertError.message };
  }

  // Ack FIRST. Two minutes of silence is the failure mode this prevents.
  await tell(phone, 'lp612Preparing', voice);
  await enqueue({ renderId: created.id, segmentId, lang: language, tv, correlationId });
  logToFile('LP 6-12: queued runtime authoring', {
    segmentId, renderId: created.id, lang: language, tv, correlationId,
  });
  return { outcome: 'queued', renderId: created.id };
}

module.exports = {
  requestLesson,
  deliverRender,
  buildBody,
  isStrandedAuthoring,
  reapStrandedRenders,
  joinWaiters,
  buildFilename,
  buildCaption,
  r2KeyFor,
  assertKeyInPrefix,
  R2_KEY_PREFIX,
  RENDERS,
  JOB_TYPE,
};
