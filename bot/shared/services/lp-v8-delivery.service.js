'use strict';
/**
 * Deliver one v8 lesson plan.
 *
 * Mirrors 02_Main Rumi Bot's storybook-delivery.service.js: send, record the
 * attempt (sent OR failed), emit, then schedule the survey only on success.
 *
 * Two failure modes this deployment has already paid for, both guarded:
 *  1. buildR2PublicUrl returns the S3-endpoint URL, which anonymous
 *     GETs reject with HTTP 400 — Meta gets a 400 and the send fails silently.
 *     It MUST be wrapped in getPresignedUrl.
 *  2. a delivery that fails and leaves no row is invisible. Every
 *     attempt is recorded, and the teacher is always told something.
 */

const supabase = require('../config/supabase');
const { buildR2PublicUrl, getPresignedUrl } = require('../storage/r2');
const WhatsAppService = require('./whatsapp.service');
const LpFeedback = require('./lp-feedback.service');
const LPShelfService = require('./lp-shelf.service');
const V8Catalog = require('./lp-v8-catalog.service');
const { resolveUx } = require('../config/ux-strings');
const { logToFile } = require('../utils/logger');
const { recordDeliveryMarker } = require('./lp-delivery-marker.service');

const LP_VARIANT = 'niete_v8_segment';
const FILENAME_MAX = 64;

/** WhatsApp-safe filename that names the lesson a teacher just asked for. */
function buildFilename({ book, chapter, lesson }) {
  const base = `Grade ${book.grade} ${book.subject} — Ch${chapter.number} ${lesson.day_label} — ${lesson.topic_short || lesson.topic}`
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const room = FILENAME_MAX - 4;                       // ".pdf"
  return `${base.length > room ? base.slice(0, room).trim() : base}.pdf`;
}

// lesson_plans.topic is VARCHAR(200) NOT NULL on the live NIETE database
// (verified 2026-08-16). topic_short is bounded by the 80-cp metadata budget,
// but the `|| lesson.topic` fallback is not: raw corpus topics reach 211 code
// points. Over-long would throw INSIDE the "non-fatal" try, so the teacher
// would get her PDF and silently never get the survey.
const TOPIC_MAX = 200;

function lessonPlanTopic(lesson, lessonId) {
  const raw = String(lesson.topic_short || lesson.topic || lesson.section || lessonId || 'Lesson plan');
  return raw.length <= TOPIC_MAX ? raw : `${raw.slice(0, TOPIC_MAX - 1).trim()}…`;
}

function buildCaption({ book, chapter, lesson }) {
  return `📘 ${lesson.day_label} · ${lesson.row.title}\n${lesson.topic} (${lesson.pages_label})\n`
    + `Grade ${book.grade} ${book.subject} — Ch${chapter.number}: ${chapter.title}`;
}

/**
 * The marking scheme travels as its OWN document, and it must never be mistaken
 * for the pupil paper — it carries every answer. Name and caption both say so.
 */
function buildAnswerKeyFilename({ book, chapter }) {
  const base = `Grade ${book.grade} ${book.subject} — Ch${chapter.number} Answer Key (Teacher)`
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const room = FILENAME_MAX - 4;
  return `${base.length > room ? base.slice(0, room).trim() : base}.pdf`;
}
function buildAnswerKeyCaption({ book, chapter }) {
  return '🔑 Answer key & marking scheme — for you, not for the pupils.\n'
    + `Marks per question and the mistakes to watch for.\n`
    + `Grade ${book.grade} ${book.subject} — Ch${chapter.number}: ${chapter.title}`;
}

// PostgREST caps every response at db-max-rows regardless of the .limit() asked
// for, and returns NO error when it truncates. Measured on this project
// (2026-08-16): limit=5000 on a 118k-row table returns exactly 1000 rows,
// Content-Range 0-999/*. The corpus is 2,038 lessons, so a single .limit(5000)
// would silently serve half of it and hide the rest of the menu.
const PAGE = 1000;
const MAX_PAGES = 20;   // 20,000 ids — an order of magnitude above the corpus

/**
 * Read a whole id column by paging with .range(), stopping on the first short
 * page. Never truncates silently: a set that somehow exceeds MAX_PAGES is
 * logged loudly rather than quietly cut off.
 */
async function pagedIdSet(label, buildQuery, column = 'lesson_id') {
  const ids = new Set();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE;
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) { logToFile(`LP v8: ${label} error`, { error: error.message, page }); return ids; }
    const rows = data || [];
    for (const r of rows) ids.add(r[column]);
    if (rows.length < PAGE) return ids;
    if (page === MAX_PAGES - 1) {
      logToFile(`LP v8: ${label} hit the page ceiling — the set may be incomplete`, {
        pages: MAX_PAGES, collected: ids.size,
      });
    }
  }
  return ids;
}

/** Every lesson_id with a current asset — this is what "servable" means. */
async function availableLessonIds(catalogVersion = 'v8') {
  try {
    return await pagedIdSet('availableLessonIds', () => supabase
      .from('niete_lp_assets')
      .select('lesson_id')
      .eq('catalog_version', catalogVersion)
      .eq('asset_kind', 'lesson')
      .eq('is_current', true));
  } catch (err) {
    logToFile('LP v8: availableLessonIds threw', { error: err.message });
    return new Set();
  }
}

/** Lessons this teacher has already received, in ANY version — the ✓ tick. */
async function downloadedLessonIds(userId) {
  if (!userId) return new Set();
  try {
    return await pagedIdSet('downloadedLessonIds', () => supabase
      .from('niete_lp_downloads')
      .select('lesson_id')
      .eq('user_id', userId)
      .eq('status', 'sent'));
  } catch (err) {
    logToFile('LP v8: downloadedLessonIds threw', { error: err.message });
    return new Set();
  }
}

async function currentAssetFor(lessonId, assetKind = 'lesson') {
  const { data } = await supabase
    .from('niete_lp_assets')
    .select('id, lesson_id, asset_kind, r2_key, content_hash, version_stamp, is_current')
    .eq('lesson_id', lessonId)
    .eq('asset_kind', assetKind)
    .eq('is_current', true)
    .maybeSingle();
  return data || null;
}

async function getUser(userId) {
  if (!userId) return null;
  const { data } = await supabase
    .from('users').select('id, phone_number, preferred_language').eq('id', userId).maybeSingle();
  return data || null;
}

async function recordDownload(fields) {
  try {
    await supabase.from('niete_lp_downloads').insert(fields);
  } catch (err) {
    logToFile('LP v8: download insert failed', { lessonId: fields.lesson_id, error: err.message });
  }
}

/**
 * Deliver one v8 lesson to one teacher.
 * Never throws — the Flow has already returned SUCCESS by the time this runs.
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
/**
 * Send the answer key for an assessment, if one has been rendered and uploaded.
 * Never throws: the worksheet has already gone out by the time this runs, and a
 * missing or failing key must not turn a successful delivery into a failed one.
 */
async function sendAnswerKeyIfAny({ userId, lessonId, phone, book, chapter, context }) {
  try {
    const key = await currentAssetFor(lessonId, 'answer_key');
    if (!key || !key.r2_key) {
      // Not rendered yet for this chapter. Silent by design — see caller.
      logToFile('LP v8: no answer key for assessment', { lessonId });
      return;
    }
    const presigned = await getPresignedUrl(buildR2PublicUrl(key.r2_key));
    const resp = await WhatsAppService.sendDocumentByLink(
      phone,
      presigned,
      buildAnswerKeyFilename({ book, chapter }),
      buildAnswerKeyCaption({ book, chapter }),
    );
    await recordDownload({
      ...context,
      user_id: userId,
      asset_id: key.id,
      version_stamp: key.version_stamp,
      content_hash: key.content_hash,
      phone,
      status: resp ? 'sent' : 'failed',
      error_text: resp ? null : 'answer key send returned falsy',
    });
  } catch (err) {
    logToFile('LP v8: answer key send failed (non-fatal)', { userId, lessonId, error: err.message });
  }
}

/**
 * The voice note that rides with the lesson. Returns whether it actually reached her —
 * the survey needs to know, because asking "was the voice note useful?" about a voice note
 * that never arrived is worse than not asking at all.
 *
 * @returns {Promise<boolean>} true only if WhatsApp accepted the voice message
 */
async function sendVoicenoteIfAny({ userId, lessonId, phone, asset }) {
  if (!asset || !asset.r2_key) return false;
  const oggKey = String(asset.r2_key).replace(/\.pdf$/i, '.ogg');
  if (oggKey === asset.r2_key) return false;               // not a .pdf key — nothing to derive
  if (typeof WhatsAppService.sendVoicenoteFromR2Key !== 'function') return false;

  try {
    const sent = await WhatsAppService.sendVoicenoteFromR2Key(phone, oggKey);
    if (!sent) {
      // Silent by design: voicenotes exist for the current corpus version only, and a teacher
      // who gets none should simply get her lesson, not an apology for a thing she never
      // knew was coming. Same stance as the answer key.
      logToFile('LP v8: no voicenote for this lesson version', { userId, lessonId, oggKey });
      return false;
    }
    return true;
  } catch (err) {
    logToFile('LP v8: voicenote send failed (non-fatal)', { userId, lessonId, oggKey, error: err.message });
    return false;
  }
}

async function deliverV8Lesson({ userId, lessonId, correlationId = null }) {
  const hit = V8Catalog.lessonById(lessonId);
  if (!hit) {
    logToFile('LP v8: unknown lesson requested', { userId, lessonId });
    return { ok: false, reason: 'unknown lesson' };
  }
  const { lesson, chapter, book } = hit;

  const context = {
    lesson_id: lessonId,
    grade: book.grade,
    subject: book.subject_key,
    chapter_number: chapter.number,
    segment_index: lesson.segment_index,
    correlation_id: correlationId,
  };

  const user = await getUser(userId);
  const phone = user && user.phone_number;
  if (!phone) {
    logToFile('LP v8: no phone for user', { userId, lessonId });
    await recordDownload({ ...context, user_id: userId || null, phone: null, status: 'failed', error_text: 'no phone for user' });
    return { ok: false, reason: 'no phone' };
  }

  const asset = await currentAssetFor(lessonId);
  if (!asset || !asset.r2_key) {
    logToFile('LP v8: no current asset', { userId, lessonId });
    await recordDownload({ ...context, user_id: userId, phone, status: 'failed', error_text: 'no current asset' });
    await WhatsAppService.sendMessage(phone, resolveUx('lpV8StillPreparing', { user }));
    return { ok: false, reason: 'no current asset' };
  }

  // Staging feedback round 1: presign + Meta's document fetch take several
  // seconds after the Flow has already closed — tell her it is coming before
  // the silence reads as a failed request. Best-effort: the PDF is the
  // deliverable, so an ack failure must never abort the send.
  try {
    await WhatsAppService.sendMessage(phone, resolveUx('lpV8Preparing', { user }));
  } catch (_) { /* best effort */ }

  const filename = buildFilename({ book, chapter, lesson });
  const caption = buildCaption({ book, chapter, lesson });

  let ok = false;
  let errorText = null;
  try {
    // Presign, always. The raw public URL 400s for Meta.
    const presigned = await getPresignedUrl(buildR2PublicUrl(asset.r2_key));
    const resp = await WhatsAppService.sendDocumentByLink(phone, presigned, filename, caption);
    ok = !!resp;
    if (!ok) errorText = 'sendDocumentByLink returned falsy';
  } catch (err) {
    errorText = err.message;
    logToFile('LP v8: send threw', { userId, lessonId, error: err.message });
  }

  await recordDownload({
    ...context,
    user_id: userId,
    asset_id: asset.id,
    version_stamp: asset.version_stamp,
    content_hash: asset.content_hash,
    phone,
    status: ok ? 'sent' : 'failed',
    error_text: errorText,
  });

  // bd-wpupy F5: leave a trace of the hand-over in the dialogue itself, so a
  // later "give me this in text form" has a correct antecedent. Grade/chapter
  // only — deliberately no title or content (see the service header). Only on
  // success: a failed send is not something she can refer back to.
  if (ok) {
    await recordDeliveryMarker({
      userId,
      lessonId,
      grade: book && book.grade,
      subject: book && (book.subject || book.subject_key),
      chapterNumber: chapter && chapter.number,
      segmentLabel: lesson && (lesson.day_label || null),
    });
  }

  if (!ok) {
    // Never leave the teacher in silence after a failed delivery.
    try {
      await WhatsAppService.sendMessage(phone, resolveUx('lpV8SendFailed', { user }));
    } catch (_) { /* best effort */ }
    return { ok: false, reason: errorText || 'send failed' };
  }

  // ── The voice note (bd-vw0aj) ─────────────────────────────────────────────
  //
  // Sent AFTER the PDF and never allowed to gate it. The teacher hears ~55s of
  // Sara telling her the heart of this lesson and the slip to watch for.
  //
  // Convention path, exactly as the curriculum_lp_ast corpus already does
  // (pakistan-lp-endpoint.js): the LP's own r2_key with `.ogg`. That binds the
  // audio to THIS content_hash — re-render the lesson and the stale voicenote
  // simply stops being found, which is what we want. A note describing a lesson
  // that changed underneath it is worse than no note.
  //
  // Soft-fail by design: R2 hiccup, missing upload, WhatsApp rejection — all of
  // it is logged and none of it costs her the PDF or the survey.
  const voicenoteSent = await sendVoicenoteIfAny({ userId, lessonId, phone, asset });

  // ── The marking scheme (bd-52f1x) ─────────────────────────────────────────
  //
  // An assessment worksheet on its own is half a deliverable: the answer key is
  // what carries the mark allocation and the named misconceptions ("Watch for:
  // writes eid with a small letter"). It lives under a DIFFERENT asset_kind, and
  // until this fix nothing ever asked for one — 18 uploaded keys sat on R2 with
  // no code path able to reach them.
  //
  // Deliberately best-effort and deliberately silent when absent: keys exist for
  // only some chapters while the rest are regenerated, and a teacher who gets no
  // key should simply get the worksheet, not an apology for a thing she never
  // knew was coming. It is sent AFTER the worksheet and can never gate it.
  if (lesson.lp_type === 'assessment') {
    await sendAnswerKeyIfAny({ userId, lessonId, phone, book, chapter, lesson, context });
  }

  // A lesson_plans row is what the feedback survey hangs off (lp_feedback
  // FK-references it). Base-schema columns ONLY — nothing here may depend on a
  // column migration 018 does not itself create, so this insert works on the
  // 10-column schema a fresh clone gets as well as on NIETE's drifted 19-column
  // live table. The v8 detail rides in `content`.
  let lessonPlanId = null;
  try {
    const { data } = await supabase.from('lesson_plans').insert({
      user_id: userId,
      topic: lessonPlanTopic(lesson, lessonId),
      grade: String(book.grade),
      subject: book.subject_key,
      type: 'lesson_plan',
      content: {
        // TOP LEVEL: exactly the keys lp-feedback.service.handleFeedbackButton
        // snapshots onto the lp_feedback row. Nesting these only under `v8`
        // would land every v8 feedback row with NULL context — the service
        // being "ported" says nothing about the two agreeing on a shape.
        chapter_number: chapter.number,
        segment_number: lesson.segment_index,
        lp_variant: LP_VARIANT,
        grade: book.grade,
        subject: book.subject_key,
        // Derived from what actually reached her, never assumed (bd-vw0aj). The
        // survey asks a different question when a voice note landed, so a wrong
        // value here asks her about audio she never heard.
        trigger_mode: voicenoteSent ? 'after_voice_note' : 'after_pdf_only',
        // Provenance detail, v8-specific.
        v8: {
          lesson_id: lessonId,
          version_stamp: asset.version_stamp,
          content_hash: asset.content_hash,
          r2_key: asset.r2_key,
          chapter_number: chapter.number,
          segment_index: lesson.segment_index,
          section: lesson.section,
          pages: lesson.pages,
          lp_variant: LP_VARIANT,
        },
      },
    }).select('id').single();
    lessonPlanId = data && data.id;
  } catch (err) {
    logToFile('LP v8: lesson_plans insert failed (non-fatal)', { userId, lessonId, error: err.message });
  }

  // ── The shelf entry (bd-njn7u) ────────────────────────────────────────────
  //
  // The record of "what was this teacher recently given", read by LP Q&A when
  // she asks about a lesson later. Keys only, never content: lesson_id +
  // content_hash resolve the voicenote script (R2 .txt) and the lesson's move
  // list fresh at question time, so she is always answered about the precise
  // version she was sent. voicenote_sent is derived from the actual send —
  // context claiming "the voice note you heard" about audio that never arrived
  // would be worse than no context.
  try {
    await LPShelfService.pushToShelf(userId, {
      lesson_id: lessonId,
      grade: book.grade,
      subject: book.subject_key,
      subject_label: book.subject,
      chapter_number: chapter.number,
      chapter_title: chapter.title,
      topic: lesson.topic_short || lesson.topic,
      pages_label: lesson.pages_label,
      r2_key: asset.r2_key,
      content_hash: asset.content_hash,
      version_stamp: asset.version_stamp,
      voicenote_sent: voicenoteSent,
      lesson_plan_id: lessonPlanId,
      delivered_at: new Date().toISOString(),
    });
  } catch (err) {
    logToFile('LP v8: shelf push failed (non-fatal)', { userId, lessonId, error: err.message });
  }

  if (lessonPlanId) {
    try {
      LpFeedback.scheduleFeedbackPrompt({
        lessonPlanId,
        userId,
        phone,
        context: {
          grade: book.grade,
          subject: book.subject_key,
          chapterNumber: chapter.number,
          segmentNumber: lesson.segment_index,
          topic: lesson.topic_short || lesson.topic,
          lpVariant: LP_VARIANT,
          // Same derived value as the lesson_plans row above — the two must agree,
          // or the survey and its stored context describe different deliveries.
          triggerMode: voicenoteSent ? 'after_voice_note' : 'after_pdf_only',
          language: (user && user.preferred_language) || 'en',
        },
      });
    } catch (err) {
      logToFile('LP v8: scheduleFeedbackPrompt threw (non-fatal)', { lessonPlanId, error: err.message });
    }
  }

  return { ok: true };
}

module.exports = {
  deliverV8Lesson,
  availableLessonIds,
  downloadedLessonIds,
  currentAssetFor,
  buildFilename,
  buildCaption,
  LP_VARIANT,
};
