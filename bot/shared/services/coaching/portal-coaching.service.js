/**
 * bd-lfzoz — a teacher's classroom recording, uploaded from the PORTAL.
 *
 * WHY THIS LIVES IN THE BOT
 * -------------------------
 * The portal service cannot run any of this in-process. The queue driver needs
 * aws-sdk v2 and the reflection engine needs supabase-js, axios and openai — all
 * bot/ dependencies the portal never installs, and Node resolves them from the
 * requiring file's directory, so the portal declaring them would not help (see
 * tests/portal/portal-reaches-bot-modules.test.js). The portal asks over the
 * internal API (shared/routes/internal-api.routes.js) and this module does the
 * work with the bot's own code — one job envelope, one reflection engine.
 *
 * WHAT IS DIFFERENT FROM A WHATSAPP RECORDING — AND NOTHING ELSE IS
 * -----------------------------------------------------------------
 *   · The audio is already in R2. audio_url is set at insert and there is no
 *     WhatsApp media id; transcription reads it from R2 (bd-78i2k).
 *   · Consent is the upload itself, so the row starts at 'confirmed'. There is
 *     no Yes/No button to wait on — the same reason observe-capture skips it.
 *   · The lesson plan and classroom photos are collected in the portal, at
 *     upload, instead of by the WhatsApp prompts after transcription. They are
 *     written in the exact shape the WhatsApp path writes them, and
 *     afterTranscription() queues what the WhatsApp taps would have queued.
 *   · Its key is portal_<id>, which is how the pipeline knows (isPortalSession)
 *     to keep the debrief off WhatsApp (operator): the question is generated
 *     silently and the teacher answers it in the portal.
 * Progress messages and the finished report still go to WhatsApp as well.
 *
 * IDENTITY
 * --------
 * Every function takes the userId the PORTAL read from its session. Each one
 * checks that every key and row belongs to that user before touching it.
 */

const crypto = require('crypto');

const PRESIGN_TTL_SECONDS = 15 * 60;

// The WhatsApp path treats a recording under this as a voice note, not a lesson.
// The portal accepts it (the teacher declared intent by uploading) but the UI
// warns that a short recording makes a thin report.
const SHORT_RECORDING_SECONDS = 600;

// MAX_COACHING_PHOTOS in photo-capture-routing.js — the WhatsApp photo step's cap.
const MAX_PHOTOS = 3;

/**
 * One entry per thing a teacher can upload. Types are keyed by EXTENSION because
 * browsers disagree on MIME types for the same file (an .m4a is audio/mp4,
 * audio/x-m4a or audio/m4a by vendor); the extension decides, and the MIME type
 * we SIGN is the canonical one, so the PUT must carry exactly it.
 *
 * Trees and caps:
 *   audio        classroom_audio/<uid>/<YYYY-MM>/portal_<id>   — r2.uploadClassroomAudio's tree.
 *                A 45-min lesson is ~40 MB as m4a and ~250 MB as raw wav.
 *   lesson_plan  lesson_plans/<uid>/portal_<id>                — r2.uploadLessonPlanBuffer's tree.
 *                The formats lesson-plan-processor.detectFileType recognises.
 *   photo        images/<uid>/portal_<id>                      — r2.uploadImageWithRetry's tree.
 */
const KINDS = Object.freeze({
  audio: {
    types: {
      '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.aac': 'audio/aac', '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.amr': 'audio/amr',
      '.3gp': 'audio/3gpp', '.webm': 'audio/webm',
    },
    maxBytes: 300 * 1024 * 1024,
    key: (uid, ym, id, ext) => `classroom_audio/${uid}/${ym}/portal_${id}${ext}`,
    rx: (uid) => new RegExp(`^classroom_audio/${escapeRx(uid)}/\\d{4}-\\d{2}/portal_[A-Za-z0-9-]+(\\.[a-z0-9]+)$`),
  },
  lesson_plan: {
    types: {
      '.pdf': 'application/pdf',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.doc': 'application/msword',
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    },
    maxBytes: 25 * 1024 * 1024,
    key: (uid, ym, id, ext) => `lesson_plans/${uid}/portal_${id}${ext}`,
    rx: (uid) => new RegExp(`^lesson_plans/${escapeRx(uid)}/portal_[A-Za-z0-9-]+(\\.[a-z0-9]+)$`),
  },
  photo: {
    types: { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' },
    maxBytes: 15 * 1024 * 1024,
    key: (uid, ym, id, ext) => `images/${uid}/portal_${id}${ext}`,
    rx: (uid) => new RegExp(`^images/${escapeRx(uid)}/portal_[A-Za-z0-9-]+(\\.[a-z0-9]+)$`),
  },
});

// Kept for callers and tests that speak about audio specifically.
const AUDIO_TYPES = KINDS.audio.types;
const MAX_UPLOAD_BYTES = KINDS.audio.maxBytes;

// THE MARKER. A portal row is recognised by its R2 key, not by a new column.
// coaching_sessions.audio_url has exactly two writers: the insert below, and
// transcription, which REUSES a portal url rather than re-uploading (bd-78i2k).
// WhatsApp's own uploads are keyed <sessionId>_<timestamp>.ext (r2.uploadClassroomAudio),
// so they never match. Measured on sandbox 2026-10-01: 0 of 441 rows with audio
// match this pattern. Reading a column every database already has means no
// migration, and no query anywhere can 400 on a database that lacks one.
const PORTAL_KEY_RX = /\/classroom_audio\/[^/]+\/\d{4}-\d{2}\/portal_[A-Za-z0-9-]+\.[a-z0-9]+$/;

function escapeRx(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPortalSession(row) {
  if (!row || !row.audio_url) return false;
  return PORTAL_KEY_RX.test(String(row.audio_url).split('?')[0]);
}

/**
 * The WhatsApp handlers route any message from a teacher with a session at
 * conducting_conversation into that session as her reflective answer. A portal
 * session's question was never shown on WhatsApp, so it must not capture her
 * chat. Every other row — every WhatsApp session — still does.
 */
function isWhatsAppReflectiveSession(row) {
  return !!row && !isPortalSession(row);
}

function extOf(filename) {
  const m = String(filename || '').toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : '';
}

// .jpeg and .jpg are one format; the stored key and lesson_plan_format use jpg,
// which is what detectFileType returns for the same bytes on WhatsApp.
function canonicalExt(ext) {
  return ext === '.jpeg' ? '.jpg' : ext;
}

function yearMonth(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function buildUploadKey(userId, ext, now, id, kind = 'audio') {
  return KINDS[kind].key(userId, yearMonth(now), id, canonicalExt(ext));
}

/** Is `key` an upload of THIS kind that THIS user's portal minted? */
function isOwnPortalKey(userId, key, kind = 'audio') {
  const spec = KINDS[kind];
  if (!userId || !spec) return false;
  const m = String(key || '').match(spec.rx(userId));
  return !!m && Object.prototype.hasOwnProperty.call(spec.types, m[1]);
}

/**
 * Default collaborators, each required only when first used: signing an upload
 * must not load the reflection engine (and its model clients) to do it.
 */
function withDefaults(deps = {}) {
  const lazy = {
    supabase: () => require('../../config/supabase'),
    r2: () => require('../../storage/r2'),
    queue: () => require('./coaching-job-queue.service'),
    reflective: () => require('./reflective-conversation.service'),
    getUserLanguage: () => require('../../utils/language-cache').getUserLanguage,
    now: () => () => new Date(),
    newId: () => () => crypto.randomUUID(),
  };
  const d = {};
  for (const [name, load] of Object.entries(lazy)) {
    Object.defineProperty(d, name, {
      enumerable: true,
      get: () => (deps[name] !== undefined ? deps[name] : load()),
    });
  }
  return d;
}

/**
 * Sign a direct-to-R2 upload for one file.
 * @param {{userId, filename, sizeBytes?, kind?: 'audio'|'lesson_plan'|'photo'}} args
 * @returns {{status:'ok', uploadUrl, key, contentType, expiresIn, maxBytes}
 *         | {status:'invalid', reason:'no_user'|'unknown_kind'|'not_audio'|'wrong_type'|'too_large'}}
 */
async function presignUpload({ userId, filename, sizeBytes, kind = 'audio' }, deps) {
  if (!userId) return { status: 'invalid', reason: 'no_user' };
  const spec = KINDS[kind];
  if (!spec) return { status: 'invalid', reason: 'unknown_kind' };
  const ext = extOf(filename);
  const contentType = spec.types[ext];
  if (!contentType) return { status: 'invalid', reason: kind === 'audio' ? 'not_audio' : 'wrong_type' };
  const size = Number(sizeBytes);
  if (Number.isFinite(size) && size > spec.maxBytes) return { status: 'invalid', reason: 'too_large' };

  const d = withDefaults(deps);
  const key = buildUploadKey(userId, ext, d.now(), d.newId(), kind);
  const uploadUrl = await d.r2.getPresignedUploadUrl(key, contentType, PRESIGN_TTL_SECONDS);
  return {
    status: 'ok', uploadUrl, key, contentType, expiresIn: PRESIGN_TTL_SECONDS, maxBytes: spec.maxBytes,
  };
}

/** HEAD each key; the first one missing or oversized decides the answer. */
async function checkUploaded(d, items) {
  for (const { key, kind } of items) {
    const head = await d.r2.headObject(key);
    if (!head || !head.exists) return { status: 'invalid', reason: 'upload_missing', key };
    if (Number(head.sizeBytes) > KINDS[kind].maxBytes) return { status: 'invalid', reason: 'too_large', key };
  }
  return null;
}

/**
 * Turn an uploaded recording (and optional lesson plan / photos) into a
 * coaching session and start the pipeline.
 * @param {{userId, key, lessonPlanKey?, photoKeys?: string[]}} args
 * @returns {{status:'ok', coachingSessionId}
 *         | {status:'in_progress', coachingSessionId}
 *         | {status:'invalid', reason}
 *         | {status:'queue_failed', coachingSessionId}}
 */
async function startPortalSession({ userId, key, lessonPlanKey = null, photoKeys = [] }, deps) {
  const photos = Array.isArray(photoKeys) ? photoKeys.filter(Boolean) : [];

  // Every key must be this teacher's own, of the right kind — checked before
  // anything is read or written.
  if (!isOwnPortalKey(userId, key, 'audio')) return { status: 'invalid', reason: 'not_your_upload' };
  if (lessonPlanKey && !isOwnPortalKey(userId, lessonPlanKey, 'lesson_plan')) {
    return { status: 'invalid', reason: 'not_your_upload' };
  }
  if (photos.length > MAX_PHOTOS) return { status: 'invalid', reason: 'too_many_photos' };
  if (photos.some((k) => !isOwnPortalKey(userId, k, 'photo'))) return { status: 'invalid', reason: 'not_your_upload' };

  const d = withDefaults(deps);

  const missing = await checkUploaded(d, [
    { key, kind: 'audio' },
    ...(lessonPlanKey ? [{ key: lessonPlanKey, kind: 'lesson_plan' }] : []),
    ...photos.map((k) => ({ key: k, kind: 'photo' })),
  ]);
  if (missing) return missing;

  // The same rule the WhatsApp classroom-audio branch applies: while one of her
  // recordings is mid-analysis, a second one is deferred, not started in
  // parallel (FEAT-106 #3) — but a stale one can never trap her.
  const { shouldDeferNewClassroomAudio } = require('./coaching-inflight-guard');
  const { data: latest } = await d.supabase
    .from('coaching_sessions')
    .select('id, status, created_at, updated_at, observation_type')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (shouldDeferNewClassroomAudio(latest, d.now().getTime())) {
    return { status: 'in_progress', coachingSessionId: latest.id };
  }

  const { data: user } = await d.supabase
    .from('users').select('id, phone_number').eq('id', userId).single();
  if (!user) return { status: 'invalid', reason: 'no_user' };

  const startedAt = d.now().toISOString();

  // The lesson plan, written field for field as lesson-plan-processor writes
  // it — handleLessonPlanUpload for a plan, the "No" tap for none.
  const lessonPlan = lessonPlanKey
    ? {
      has_lesson_plan: true,
      lesson_plan_url: d.r2.buildR2PublicUrl(lessonPlanKey),
      lesson_plan_r2_key: lessonPlanKey,
      lesson_plan_format: extOf(lessonPlanKey).slice(1),
      lesson_plan_extraction_status: 'pending',
      lesson_plan_extraction_error: null,
    }
    : { has_lesson_plan: false, lesson_plan_link_method: 'none' };

  // Photos in the record shape appendClassroomPhoto writes, on the column AND
  // its conversation_state mirror, as capture.service's mergedPhotoUpdate does.
  const classroomPhotos = photos.map((k) => ({ url: d.r2.buildR2PublicUrl(k), uploaded_at: startedAt }));

  const { data: session, error } = await d.supabase
    .from('coaching_sessions')
    .insert({
      user_id: userId,
      session_id: null,             // no chat session — she never messaged for this one
      audio_id: null,               // no WhatsApp media id; the audio is in R2
      audio_url: d.r2.buildR2PublicUrl(key),
      // audio_duration_seconds is left null: transcription measures it with
      // ffprobe (the backfill beside updateData), rather than trusting a
      // number the browser reported.
      status: 'confirmed',          // consent is the upload; no Yes/No step
      confirmed_at: startedAt,
      ...lessonPlan,
      ...(classroomPhotos.length ? { classroom_photos: classroomPhotos } : {}),
      conversation_state: {
        current_state: 'TRANSCRIBING',
        questions_answered: 0,
        questions: [],
        skipped: false,
        started_at: startedAt,
        last_interaction: startedAt,
        ...(classroomPhotos.length ? { classroom_photos: classroomPhotos } : {}),
      },
      created_at: startedAt,
    })
    .select()
    .single();
  if (error || !session) throw new Error(`portal coaching insert failed: ${error && error.message}`);

  try {
    // `from` is her WhatsApp number: progress messages and the finished report
    // still reach her chat. The debrief does not (isPortalSession).
    await d.queue.queueTranscription(session.id, { from: user.phone_number });
  } catch (queueError) {
    // Loudly, and never leave a row parked at 'confirmed' — no sweep owns that
    // status, so it would sit there forever with the teacher told "analysing".
    await d.supabase
      .from('coaching_sessions')
      .update({ status: 'failed', failed_step: 'queue', error_message: String(queueError.message || queueError) })
      .eq('id', session.id);
    return { status: 'queue_failed', coachingSessionId: session.id };
  }

  return { status: 'ok', coachingSessionId: session.id };
}

/**
 * What a portal row does where a WhatsApp row would send the photo prompt.
 *
 * The photo and lesson plan were collected at upload, so there is nothing to
 * ask. This queues exactly what the WhatsApp taps queue — a plan:
 * extraction THEN analysis (handleLessonPlanUpload + handleLessonPlanResponse;
 * both jobs share the session's FIFO group, so the plan is extracted before
 * analysis reads it); no plan: analysis alone (the "No" tap).
 *
 * @param {object} session  coaching_sessions row
 * @param {string} coachingSessionId
 * @param {string} from     her WhatsApp number
 */
async function afterTranscription(session, coachingSessionId, from, deps) {
  const d = withDefaults(deps);
  if (session && session.has_lesson_plan && session.lesson_plan_r2_key) {
    await d.queue.queueLessonPlanExtraction(coachingSessionId, {
      r2Key: session.lesson_plan_r2_key,
      fileType: session.lesson_plan_format,
      userId: session.user_id,
    });
    await d.queue.queueAnalysis(coachingSessionId, { from, lpUploaded: true });
    return { action: 'lesson_plan_then_analysis' };
  }
  await d.queue.queueAnalysis(coachingSessionId, { from });
  return { action: 'analysis' };
}

/**
 * Record the teacher's answer to her reflective question, through the SAME
 * engine the WhatsApp debrief uses, with nothing sent to WhatsApp.
 * @returns {{status:'ok', done, acknowledgement, ...}
 *         | {status:'not_found'|'not_ready'|'invalid'}}
 */
async function submitReflection({ userId, coachingSessionId, answer }, deps) {
  const text = String(answer == null ? '' : answer).trim();
  if (!text) return { status: 'invalid', reason: 'empty_answer' };
  const d = withDefaults(deps);

  const { data: row } = await d.supabase
    .from('coaching_sessions')
    .select('id, user_id, audio_url, status')
    .eq('id', coachingSessionId)
    .maybeSingle();
  // One answer for "not hers", "not a portal session" and "does not exist", so
  // the endpoint cannot be used to probe which session ids are real.
  if (!row || row.user_id !== userId || !isPortalSession(row)) return { status: 'not_found' };
  if (row.status !== 'conducting_conversation') return { status: 'not_ready', sessionStatus: row.status };

  const { data: user } = await d.supabase
    .from('users').select('id, phone_number').eq('id', userId).single();
  // Same language the WhatsApp text path passes: her current language.
  const language = await d.getUserLanguage(userId);

  const result = await d.reflective.handleReflectiveResponse(
    coachingSessionId, user && user.phone_number, text, 'text', language, { silent: true },
  );
  return { status: 'ok', ...(result || {}) };
}

module.exports = {
  KINDS,
  PORTAL_KEY_RX,
  AUDIO_TYPES,
  MAX_UPLOAD_BYTES,
  MAX_PHOTOS,
  SHORT_RECORDING_SECONDS,
  PRESIGN_TTL_SECONDS,
  isPortalSession,
  isWhatsAppReflectiveSession,
  isOwnPortalKey,
  buildUploadKey,
  presignUpload,
  startPortalSession,
  afterTranscription,
  submitReflection,
};
