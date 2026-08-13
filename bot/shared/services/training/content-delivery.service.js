/**
 * Teacher Training — Content Delivery Service
 *
 * Given a teacher + course, find the next unfinished module and deliver it
 * to WhatsApp: video from R2 (or PDF), caption with module title/progress,
 * and a CTA button whose label depends on whether a quick check gates the
 * module — "📝 Take quiz" if it does, "▶ Next video" if it doesn't. See
 * moduleCta below; bd-2446 for why that distinction is load-bearing.
 *
 * State lives in `teacher_training_progress` (user_id, module_id, completed_at).
 * Position within a course is derived — always the lowest order_index module
 * without a progress row — so there's no separate "current position" state
 * to keep in sync.
 */
const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { getPresignedUrl } = require('../../storage/r2');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
// bd-2390 — the single writer for teacher_training_progress. Lives in its own
// module so quiz-delivery can record a completion without requiring this file
// (which requires quiz-delivery back).
const { markModuleComplete, countActiveQuestions } = require('./progress.service');

/**
 * A module is delivered as a PDF (not a video) when it has no video_url but
 * does have a source_media_url pointing at a `.pdf`. This is the shape the
 * Beacon House migration produces for the 155 PDF training modules — see
 * scripts/migrate-beacon-house.py: video assets populate both video_url and
 * source_media_url; PDF assets populate source_media_url only.
 */
function isPdfModule(m) {
  if (!m) return false;
  if (m.video_url) return false;
  if (!m.source_media_url) return false;
  return /\.pdf(\?|$)/i.test(m.source_media_url);
}

/**
 * bd-2446 — every teacher-facing string about "what happens when you tap" is
 * generated here, from the two facts that decide it: what the module ships
 * (video / PDF / nothing yet) and whether a quick check gates it.
 *
 * The bug this replaces: bd-2390 made the quiz a gate, so on a quizzed module
 * the tap opens a quiz and delivers no video — but the button still read
 * "▶ Next video" and the caption still told teachers to tap "✓ Done", a button
 * that had not existed since before bd-2390. Three strings, three different
 * stories, none of them what the handler does. Deriving all of them from one
 * predicate is what stops them drifting apart again.
 *
 * @param {object} m training_modules row
 * @param {boolean} hasQuiz whether an active quick check gates this module
 * @param {boolean} [reviewMode] re-watching an already-completed module
 * @returns {{title: string, body: string, trailer: string}}
 *   title   — the button label (WhatsApp caps these at 20 chars)
 *   body    — the interactive-button body ("Finished watching …?")
 *   trailer — the caption's closing line, telling them what the tap does
 */
function moduleCta(m, hasQuiz, reviewMode = false) {
  const kind = isPdfModule(m) ? 'pdf' : (m?.video_url ? 'video' : 'none');
  const verb = {
    pdf: { imperative: 'Read the PDF', finished: 'Finished reading' },
    video: { imperative: 'Watch the video', finished: 'Finished watching' },
    none: { imperative: null, finished: null },
  }[kind];

  // "▶ Next video" is only honest on a video module — the Beacon House corpus
  // is 155 PDFs, where the next thing to arrive is a document, not a video.
  const title = hasQuiz
    ? '📝 Take quiz'
    : (kind === 'video' ? '▶ Next video' : '➡ Next module');
  // A quizzed tap does not hand over the next module — passing it does.
  // The "Next module" label already names the outcome, so don't repeat it.
  const outcome = hasQuiz
    ? ' — passing it unlocks the next module.'
    : (kind === 'video' ? ' for the next module.' : ' to continue.');

  const trailer = verb.imperative
    ? `${reviewMode ? `${verb.imperative} again to review` : verb.imperative}, then tap ${title}${outcome}`
    : `Tap ${title}${outcome}`;

  const body = verb.finished
    ? `${verb.finished} "${m.title}"?`
    : `Ready to continue with "${m.title}"?`;

  return { title, body, trailer };
}

/**
 * Deliver a PDF training module to a teacher as a WhatsApp document.
 * Uses sendDocumentByLink (link mode) — the S3 URL is publicly readable,
 * so we don't need to download + reupload via Meta's media API. WhatsApp's
 * client renders the PDF as a tappable document card and opens it natively.
 *
 * @param {string} phoneNumber - Teacher's WhatsApp number
 * @param {object} module - training_modules row (needs id, title, source_media_url)
 * @param {object} [opts] - { userId, vendorKey } for the semantic event
 * @returns {Promise<boolean>}
 */
async function deliverPdfModule(phoneNumber, module, opts = {}) {
  const { userId, vendorKey } = opts;
  if (!module || !module.source_media_url) {
    logToFile('⚠️ deliverPdfModule: no source_media_url — sending "PDF not available yet"', {
      moduleId: module?.id,
      userId,
    });
    try {
      await WhatsAppService.sendMessage(
        phoneNumber,
        `📄 *${module?.title || 'This module'}*\n\nPDF not available yet — please check back soon.`
      );
    } catch (err) {
      logToFile('⚠️ deliverPdfModule fallback sendMessage failed', { moduleId: module?.id, error: err?.message });
    }
    return false;
  }

  const filename = `${module.title}.pdf`;

  // Meta fetches this link SERVER-SIDE, so it must be reachable without our
  // credentials. A legacy asset on the open third-party bucket is already
  // public; an asset on our own R2 bucket is NOT, and answers 400 unless the
  // URL carries a signature. getPresignedUrl passes non-R2 URLs through
  // untouched, so this is a no-op for the legacy corpus.
  //
  // Getting this wrong fails SILENTLY: sendDocumentByLink still returns true
  // (our API call to Meta succeeded) and the teacher sees the caption and the
  // buttons with no document between them.
  let documentUrl = module.source_media_url;
  try {
    documentUrl = await getPresignedUrl(module.source_media_url, 3600);
  } catch (err) {
    logToFile('⚠️ deliverPdfModule: presign failed, falling back to the stored URL', {
      moduleId: module.id,
      error: err?.message,
    });
  }

  logToFile('🎓 Delivering PDF training module', {
    userId,
    moduleId: module.id,
    moduleTitle: module.title,
    urlPrefix: String(documentUrl).slice(0, 80),
  });

  let ok = false;
  try {
    ok = await WhatsAppService.sendDocumentByLink(phoneNumber, documentUrl, filename, module.title);
  } catch (err) {
    logToFile('❌ deliverPdfModule: sendDocumentByLink threw', {
      moduleId: module.id,
      userId,
      error: err?.message,
    });
    return false;
  }

  if (!ok) {
    logToFile('❌ deliverPdfModule: sendDocumentByLink returned false', {
      moduleId: module.id,
      userId,
    });
    return false;
  }

  logEvent('training_pdf_module_delivered', {
    module_id: module.id,
    user_id: userId || null,
    vendor_key: vendorKey || null,
  });
  return true;
}

/**
 * Find the next uncompleted module for a teacher in a course.
 * Returns null if the course is fully done.
 */
async function findNextModule(userId, courseId) {
  const { data: modules, error: mErr } = await supabase
    .from('training_modules')
    .select('id, course_id, title, video_url, audio_url, source_media_url, order_index')
    .eq('course_id', courseId)
    .eq('is_active', true)
    .order('order_index', { ascending: true });
  if (mErr || !modules || modules.length === 0) return null;

  const { data: progress } = await supabase
    .from('teacher_training_progress')
    .select('module_id')
    .eq('user_id', userId)
    .in('module_id', modules.map(m => m.id));
  const doneIds = new Set((progress || []).map(p => p.module_id));

  const totalCount = modules.length;
  const nextModule = modules.find(m => !doneIds.has(m.id));
  return nextModule ? {
    module: nextModule,
    completedCount: doneIds.size,
    totalCount,
    positionLabel: `${doneIds.size + 1} of ${totalCount}`,
  } : { module: null, completedCount: doneIds.size, totalCount, positionLabel: `${totalCount} of ${totalCount}` };
}

/**
 * Deliver the next uncompleted module to the teacher, or a completion
 * message if the course is done.
 *
 * @param {string} userId - Supabase user UUID
 * @param {number|string} courseId - training_courses.id (int)
 * @param {string} phoneNumber - Teacher's WhatsApp number
 */
async function deliverNextModule(userId, courseId, phoneNumber) {
  const courseIdNum = parseInt(courseId, 10);
  if (!courseIdNum) {
    logToFile('⚠️ Invalid courseId in deliverNextModule', { userId, courseId });
    return false;
  }

  const { data: course } = await supabase
    .from('training_courses')
    .select('id, title')
    .eq('id', courseIdNum)
    .single();
  const courseTitle = course?.title || `Course #${courseIdNum}`;

  const state = await findNextModule(userId, courseIdNum);
  if (!state) {
    await WhatsAppService.sendMessage(phoneNumber, `${courseTitle} has no active modules yet — please check back soon.`);
    return true;
  }

  // "Review mode": if every module in this course is already done (which is
  // the case for any course inside a certified level after the pass-based
  // progress backfill), deliver the FIRST module of the course as a
  // re-watch instead of the "you're done" text — that's what teachers
  // actually want when they open a completed course.
  let m;
  let reviewMode = false;
  let positionLabel;
  if (!state.module) {
    const { data: firstMod } = await supabase
      .from('training_modules')
      .select('id, course_id, title, video_url, audio_url, source_media_url, order_index')
      .eq('course_id', courseIdNum)
      .eq('is_active', true)
      .order('order_index', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!firstMod) {
      await WhatsAppService.sendMessage(phoneNumber, `${courseTitle} has no active modules yet — please check back soon.`);
      return true;
    }
    m = firstMod;
    reviewMode = true;
    positionLabel = `Review · 1 of ${state.totalCount}`;
  } else {
    m = state.module;
    positionLabel = state.positionLabel;
  }

  // bd-2446 — the CTA has to know whether a quick check gates this module
  // before it can name the button honestly. Same predicate handleModuleDone
  // branches on, so the label always matches the tap.
  const hasQuiz = (await countActiveQuestions(m.id)) > 0;
  const cta = moduleCta(m, hasQuiz, reviewMode);

  const caption = reviewMode
    ? `📘 *${courseTitle}* — ${positionLabel}\n\n*${m.title}*\n\nYou've already completed this course. ${cta.trailer}`
    : `📘 *${courseTitle}* — Module ${positionLabel}\n\n*${m.title}*\n\n${cta.trailer}`;

  logToFile('🎓 Delivering training module', { userId, courseId: courseIdNum, moduleId: m.id, moduleTitle: m.title, videoUrl: m.video_url, sourceMediaUrl: m.source_media_url });

  // PDF modules — Beacon House corpus (155 modules) has PDF assets on
  // asset-manager-approved.s3.ap-south-1.amazonaws.com (publicly readable,
  // ~100-500KB each). Route to sendDocumentByLink so WhatsApp renders a
  // tappable document card that opens in the native PDF viewer.
  if (isPdfModule(m)) {
    // Header caption first (title + progress), then the PDF as a document.
    await WhatsAppService.sendMessage(phoneNumber, caption);
    await deliverPdfModule(phoneNumber, m, { userId });
  } else if (m.video_url) {
  // Send the video as a plain-text presigned link. The training corpus has
  // files up to 611 MB (median 100 MB); both video-type (16 MB) and document-
  // type (100 MB) WhatsApp media caps reject them with async error 131053.
  // A text-mode URL bypasses the API media pipeline — WhatsApp's client
  // renders its own link preview and opens the file in the in-app viewer.
    try {
      const signed = await getPresignedUrl(m.video_url, 3600); // 1h TTL is plenty
      logToFile('🎓 Sending training video as link', { moduleId: m.id, urlPrefix: signed.slice(0, 80) });
      await WhatsAppService.sendMessage(phoneNumber, `${caption}\n\n▶️ ${signed}`);
    } catch (err) {
      logToFile('⚠️ Presign failed', { moduleId: m.id, error: err.message });
      await WhatsAppService.sendMessage(phoneNumber, caption + `\n\n(Video could not be delivered — please contact NIETE support.)`);
    }
  } else {
    logToFile('⚠️ Module has no video_url — sending "no video available" text', { moduleId: m.id, courseId: courseIdNum });
    await WhatsAppService.sendMessage(
      phoneNumber,
      `📘 *${courseTitle}* — ${positionLabel}\n\n*${m.title}*\n\nNo file is available for this module yet. ${cta.trailer}`
    );
  }

  // Delay the CTA button so it lands AFTER the video finishes fetching +
  // delivering (link-mode is async — Meta acknowledges our API call in ~200ms
  // but fetches from R2 asynchronously for another 3-6s). Without this delay
  // the button appears above the video in the chat.
  await new Promise(resolve => setTimeout(resolve, 1000));

  await WhatsAppService.sendInteractiveButtons(phoneNumber, {
    body: cta.body,
    buttons: [
      { id: `training_module_done_${m.id}`, title: cta.title },
      { id: `training_pause`, title: '⏸ Pause' },
    ],
  });
  return true;
}


/**
 * bd-2472/bd-2473 — the single post-completion step.
 *
 * A module can complete on either of two paths: the tap, for a module with no
 * quiz, or gradeAttempt, once the quick check is passed. Everything that must
 * happen AFTER a module is credited belongs here so it cannot be stranded on
 * one branch — which is exactly what happened to the capstone offer. It lived
 * only in the no-quiz branch, and since every Beacon House module has a quiz,
 * no capstone was ever offered to anyone: 0 attempts in the entire database.
 *
 * @param {string} userId
 * @param {number} moduleId the module just credited
 * @param {string} phoneNumber
 */
async function onModuleCompleted(userId, moduleId, phoneNumber) {
  // Capstone offer — fire-and-forget, never blocks forward progress. The
  // service itself checks vendor type, capstone existence, full completion and
  // prior passes, so calling it after every completion is safe and cheap.
  {
    const CapstoneDelivery = require('./capstone-delivery.service');
    Promise.resolve(CapstoneDelivery.maybeOfferCapstone(userId, moduleId, phoneNumber))
      .catch((err) => logToFile('⚠️ Non-blocking capstone offer failed', { moduleId, error: err?.message }));
  }
  return advanceAfterModule(userId, moduleId, phoneNumber);
}

/**
 * bd-2473 — advance within the LEVEL, not the course.
 *
 * gradeAttempt used to call deliverNextModule(course_id). Finish the last
 * module of a course and nothing in that course is incomplete, so it fell into
 * review mode and re-sent module 1 — a teacher who had just passed the final
 * module of Beacon House English was shown "Review · 1 of 11".
 *
 * Order matches what the Flow renders (course order_index, then module
 * order_index) so "next" means the same thing in both surfaces.
 */
async function advanceAfterModule(userId, moduleId, phoneNumber) {
  const { data: mod } = await supabase
    .from('training_modules').select('id, course_id').eq('id', moduleId).maybeSingle();
  if (!mod?.course_id) {
    logToFile('⚠️ Completed module has no course_id — cannot advance', { moduleId });
    return true;
  }
  const { data: course } = await supabase
    .from('training_courses').select('id, level_id').eq('id', mod.course_id).maybeSingle();
  if (!course?.level_id) return deliverNextModule(userId, mod.course_id, phoneNumber);

  const { data: courses } = await supabase
    .from('training_courses').select('id, order_index')
    .eq('level_id', course.level_id).eq('is_active', true);
  const courseIds = (courses || []).map(c => c.id);
  const { data: levelModules } = courseIds.length
    ? await supabase.from('training_modules').select('id, course_id, order_index')
        .in('course_id', courseIds).eq('is_active', true)
    : { data: [] };
  const { data: progress } = await supabase
    .from('teacher_training_progress').select('module_id').eq('user_id', userId);
  const done = new Set((progress || []).map(p => p.module_id));
  const orderOf = new Map((courses || []).map(c => [c.id, c.order_index ?? 0]));
  const ordered = (levelModules || []).slice().sort((a, b) =>
    (orderOf.get(a.course_id) - orderOf.get(b.course_id))
    || (a.course_id - b.course_id)                       // stable across duplicate course order_index
    || ((a.order_index || 0) - (b.order_index || 0)));

  const next = ordered.find(m => !done.has(m.id));
  if (next) return deliverModuleById(next.id, phoneNumber, { userId, courseId: next.course_id, reviewMode: false });

  // Level complete. Do NOT loop back to module 1 — say so and let the exam
  // surface take over (the capstone offer above, or the Flow's exam CTA).
  logToFile('🎓 Level complete after module', { userId, moduleId, levelId: course.level_id });
  await WhatsAppService.sendMessage(
    phoneNumber,
    "🎉 That's every module in this level complete.\n\nSend /training to take the level exam."
  );
  return true;
}

/**
 * Mark a module complete and deliver the next one (or completion message).
 * Called from the button-reply handler.
 */
async function handleModuleDone(userId, moduleId, phoneNumber) {
  const moduleIdNum = parseInt(moduleId, 10);
  if (!moduleIdNum) return false;

  const { data: mod } = await supabase
    .from('training_modules')
    .select('id, course_id, title, order_index')
    .eq('id', moduleIdNum)
    .single();
  if (!mod) {
    logToFile('⚠️ Module not found for done-mark', { moduleId: moduleIdNum });
    await WhatsAppService.sendMessage(phoneNumber, 'That module could not be found. Send /training to start over.');
    return false;
  }

  // bd-2390 — the module quiz GATES completion; the progress row is no
  // longer written here. Tapping the module button is a request to move on,
  // not proof of learning. Previously this handler upserted progress on the
  // tap and fired the quiz + next module in parallel, so "completed" meant
  // "tapped the button" — a teacher could tap through a whole course in
  // seconds and every module read as done (and the certificate services
  // then issued level certificates off completions nobody earned).
  //
  // Now: a module WITH a quiz sends only the quiz and stops. The progress
  // row and the next module are handled by quiz-delivery.gradeAttempt once
  // the teacher passes. A module with NO questions keeps the old
  // tap-completes behaviour — otherwise it could never be finished.

  // Does a quick check gate this module? bd-2446 routes this through the
  // shared countActiveQuestions rather than an inline count, because the
  // delivery functions call the SAME predicate to label the button. If the
  // two ever diverged we'd be back to a button that lies about its own tap.
  const quizQCount = await countActiveQuestions(moduleIdNum);
  const eligPayload = {
    user_uuid: userId,
    module_row_id: moduleIdNum,
    questions_found: quizQCount || 0,
    source: 'module_done',
  };
  logEvent('training_quiz_eligibility_checked', eligPayload);

  if (quizQCount && quizQCount > 0) {
    const QuizDelivery = require('./quiz-delivery.service');
    logToFile('🎓 Module quiz gates completion — sending quiz, holding next module', {
      userId, moduleId: moduleIdNum, questions: quizQCount,
    });
    try {
      await QuizDelivery.startTrainingQuiz(userId, moduleIdNum, phoneNumber);
    } catch (err) {
      // If the quiz can't be delivered the teacher would be stranded with no
      // way forward, so fall back to the legacy tap-completion. Logged loudly
      // — this is a real failure, not a normal path.
      logToFile('❌ Module quiz failed to start — falling back to tap-completion', {
        userId, moduleId: moduleIdNum, error: err?.message,
      });
      await markModuleComplete(userId, moduleIdNum);
      await WhatsAppService.sendMessage(phoneNumber, `✅ *${mod.title}* — marked done. Loading next module…`);
      return await deliverNextModule(userId, mod.course_id, phoneNumber);
    }
    return true;
  }

  // No quiz on this module — the tap is the only completion signal available.
  await markModuleComplete(userId, moduleIdNum);
  logToFile('🎓 Module marked done (no quiz)', { userId, moduleId: moduleIdNum, courseId: mod.course_id, title: mod.title });

  // bd-2472/2473 — one shared post-completion step for BOTH paths.
  return onModuleCompleted(userId, moduleIdNum, phoneNumber);
}

/**
 * Send a specific module by id. Two call paths:
 *   1. Flow module-picker → module_id straight from the dropdown (no reviewMode/courseId prehint)
 *   2. Review-mode advancement from handleModuleDone (passes reviewMode + courseId)
 * If reviewMode is not supplied, we infer it from whether the user already
 * has a progress row for this module — "already watched" is review mode.
 */
async function deliverModuleById(moduleId, phoneNumber, opts = {}) {
  let { reviewMode, courseId, userId } = opts;
  const { data: m } = await supabase
    .from('training_modules')
    .select('id, course_id, title, video_url, source_media_url, order_index')
    .eq('id', moduleId)
    .single();
  if (!m) {
    logToFile('⚠️ deliverModuleById: module not found', { moduleId });
    await WhatsAppService.sendMessage(phoneNumber, 'That module could not be found. Send /training to start over.');
    return false;
  }
  if (!courseId) courseId = m.course_id;

  // Infer review mode from progress if not supplied
  if (reviewMode === undefined && userId) {
    const { data: p } = await supabase
      .from('teacher_training_progress')
      .select('module_id')
      .eq('user_id', userId)
      .eq('module_id', m.id)
      .maybeSingle();
    reviewMode = !!p;
  }

  const { data: course } = await supabase.from('training_courses').select('title').eq('id', courseId).maybeSingle();
  const { count: totalCount } = await supabase.from('training_modules').select('id', { count: 'exact', head: true }).eq('course_id', courseId).eq('is_active', true);
  const courseTitle = course?.title || `Course #${courseId}`;
  const label = reviewMode ? `Review · ${m.order_index} of ${totalCount}` : `${m.order_index} of ${totalCount}`;
  // bd-2446 — see deliverNextModule: the button must name what the tap does.
  const hasQuiz = (await countActiveQuestions(m.id)) > 0;
  const cta = moduleCta(m, hasQuiz, reviewMode);
  const caption = `📘 *${courseTitle}* — ${label}\n\n*${m.title}*\n\n${cta.trailer}`;
  if (isPdfModule(m)) {
    // PDF module — send the header caption, then the PDF as a document.
    // See deliverPdfModule for the delivery mechanics.
    await WhatsAppService.sendMessage(phoneNumber, caption);
    await deliverPdfModule(phoneNumber, m, { userId });
  } else if (m.video_url) {
    try {
      const signed = await getPresignedUrl(m.video_url, 3600);
      // See deliverNextModule for why we send as a text link, not video/document
      logToFile('🎓 deliverModuleById sending as link', { moduleId, urlPrefix: signed.slice(0, 80) });
      await WhatsAppService.sendMessage(phoneNumber, `${caption}\n\n▶️ ${signed}`);
    } catch (err) {
      logToFile('⚠️ deliverModuleById presign/send failed', { moduleId, error: err.message });
      await WhatsAppService.sendMessage(phoneNumber, caption + `\n\n(Video could not be delivered — please contact NIETE support.)`);
    }
  } else {
    logToFile('⚠️ Module has no video_url — sending "no video available" text (deliverModuleById)', { moduleId: m.id, courseId });
    await WhatsAppService.sendMessage(
      phoneNumber,
      `📘 *${courseTitle}* — ${label}\n\n*${m.title}*\n\nNo file is available for this module yet. ${cta.trailer}`
    );
  }
  await new Promise(resolve => setTimeout(resolve, 1000));
  await WhatsAppService.sendInteractiveButtons(phoneNumber, {
    body: cta.body,
    buttons: [
      { id: `training_module_done_${m.id}`, title: cta.title },
      { id: `training_pause`, title: '⏸ Pause' },
    ],
  });
  return true;
}

// markModuleComplete is re-exported for the existing callers/tests that reach
// for it here; progress.service.js is the definition.
module.exports = { deliverNextModule, handleModuleDone, onModuleCompleted, advanceAfterModule, deliverModuleById, deliverPdfModule, isPdfModule, markModuleComplete };
