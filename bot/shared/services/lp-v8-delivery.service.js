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
const V8Catalog = require('./lp-v8-catalog.service');
const { logToFile } = require('../utils/logger');

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
    await WhatsAppService.sendMessage(phone, 'That lesson plan is still being prepared — try again shortly.');
    return { ok: false, reason: 'no current asset' };
  }

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

  if (!ok) {
    // Never leave the teacher in silence after a failed delivery.
    try {
      await WhatsAppService.sendMessage(
        phone,
        "I couldn't send that lesson plan just now — please try again in a minute.",
      );
    } catch (_) { /* best effort */ }
    return { ok: false, reason: errorText || 'send failed' };
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
        // Voicenotes are NOT live for NIETE, so the quiz covers the lesson plan
        // only; lp_feedback.useful_component (migration 018) is reserved for
        // when they are.
        trigger_mode: 'after_pdf_only',
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
          // Voicenotes are NOT live for NIETE — the quiz covers the lesson plan
          // only. lp_feedback.useful_component is reserved for when they are.
          triggerMode: 'after_pdf_only',
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
