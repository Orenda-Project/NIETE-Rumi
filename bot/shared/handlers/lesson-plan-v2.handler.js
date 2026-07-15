/**
 * Curriculum Lesson Plan handler — the curriculum / pre-gen serve path.
 *
 * Two lookup tables:
 *   1. `pre_generated_lps` — PDF-based corpus (Rumi PK Punjab SNC 2020, 197 LPs).
 *      Served directly from R2 when a chapter matches.
 *   2. `curriculum_lp_ast` — JSON-based corpus (Taleemabad NBF + Taleemabad,
 *      2,415 LPs). Rendered on-demand via Gamma (grounded mode); cached in R2
 *      via `pdf_r2_key_{en|ur}` on the AST row so subsequent hits skip Gamma.
 *
 * Order of preference:
 *   1. Cached PDF from curriculum_lp_ast (fast — ~3s R2 fetch + send)
 *   2. Legacy pre_generated_lps PDF (Punjab corpus)
 *   3. AST miss but a row matched — send ack, queue for background Gamma
 *      render, return `ast_queued`. Worker picks it up, renders, caches, sends.
 *   4. Fall through to page_prompt (existing Gamma freeform fallback)
 *
 * The synchronous-Gamma path (blocking ~120s while a fresh LP renders) was
 * removed 2026-07-12 — a WhatsApp teacher waiting 2 min with just a typing
 * indicator is the exact "am I broken?" moment. See ASYNC UX section below.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const TopicMatchingService = require('../services/topic-matching.service');
const PreGenLookupService = require('../services/pregen-lookup.service');
const CurriculumLpAstService = require('../services/curriculum-lp-ast.service');
const LessonPlanQueueService = require('../services/lesson-plan-queue.service');
const LpFeedbackService = require('../services/lp-feedback.service');
const OxbridgeLpService = require('../services/oxbridge-lp.service');
const { storeLessonPlan } = require('../database/bot-helpers');
const { downloadFromR2 } = require('../storage/r2');
const WhatsAppService = require('../services/whatsapp.service');
const { logToFile } = require('../utils/logger');

// After a cache-hit synchronous delivery, insert a lesson_plans row (so the
// feedback survey has an FK target) + schedule the 30s "was this useful?"
// prompt. Requires userDbId — a cache-hit for a caller without a UUID (e.g.
// pre-user smoke) is still delivered, just without a feedback prompt.
async function _scheduleFeedbackForCacheHit({
  userDbId, phone, topic, grade, subject, chapterNumber, lpVariant, language, r2Key,
}) {
  if (!userDbId) return;
  try {
    // storeLessonPlan doesn't accept grade/subject columns — so we stash them
    // in `content` JSONB alongside chapter_number, and handleFeedbackButton
    // reads meta.grade / meta.subject when snapshotting onto lp_feedback.
    const content = {
      chapter_number: chapterNumber ?? null,
      grade: grade ?? null,
      subject: subject ?? null,
      lp_variant: lpVariant || null,
      language: language || 'en',
      trigger_mode: 'after_pdf_only',
    };
    const lpRow = await storeLessonPlan(userDbId, topic, 'lesson_plan', null, r2Key, content);
    if (!lpRow?.id) return;
    LpFeedbackService.scheduleFeedbackPrompt({
      lessonPlanId: lpRow.id,
      userId: userDbId,
      phone,
      context: {
        grade, subject, topic,
        chapterNumber: chapterNumber ?? null,
        lpVariant: lpVariant || null,
        language: language || 'en',
      },
    });
  } catch (err) {
    // Feedback scheduling is best-effort — never let it break LP delivery.
    logToFile('LP Feedback: cache-hit scheduling failed (non-fatal)', {
      error: err.message, topic,
    });
  }
}

async function serveR2Pdf(userId, r2Key, filename) {
  let tmpPath;
  try {
    const pdfBuffer = await downloadFromR2(r2Key);
    tmpPath = path.join(os.tmpdir(), `curriculum_lp_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
    fs.writeFileSync(tmpPath, pdfBuffer);
    await WhatsAppService.sendDocument(userId, tmpPath, filename);
    logToFile('Curriculum LP: served from R2', { r2Key });
  } finally {
    if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch (_) { /* best-effort */ } }
  }
}

// ─── ASYNC UX ──────────────────────────────────────────────────────────────
// Fresh Gamma renders take ~120s. Blocking WhatsApp for that long produces
// "is Rumi broken?" panic re-sends. Instead: send an interim ack, queue a
// background job, return `ast_queued` (which the text intercept treats as
// "handled — don't fall through to freeform"). The worker renders, caches
// to R2, and sends the PDF when ready. Second teacher on same LP: ~3s cached.
//
// `userDbId` is REQUIRED for queueing because lesson_plan_requests.user_id
// is a UUID FK on users.id. If the caller doesn't have it (rare — happens
// only when a user record isn't yet created), we return { queued: false }
// and let the handler fall through to freeform.
async function sendAckAndQueue({ phoneNumber, userDbId, lp, language }) {
  if (!userDbId) {
    logToFile('Grounded LP: skipping queue — no userDbId available', { phoneNumber });
    return { queued: false };
  }

  const isUrdu = language === 'ur';
  const ackMsg = isUrdu
    ? `آپ کے لیے لیسن پلان "${lp.topic}" پر تیار کیا جا رہا ہے۔ تقریباً 2 منٹ میں بھیج دوں گا ⏳`
    : `📝 Preparing your lesson plan on "${lp.topic}". I'll send it in about 2 minutes ⏳`;
  try {
    await WhatsAppService.sendMessage(phoneNumber, ackMsg);
  } catch (ackErr) {
    // Ack send failed but we can still queue; the delivered PDF is what matters.
    logToFile('Grounded LP: ack message failed (non-fatal, continuing)', { error: ackErr.message, phoneNumber });
  }

  await LessonPlanQueueService.createAndQueueGrounded({
    userId: userDbId,
    phoneNumber,
    sourceLpUuid: lp.source_lp_uuid,
    topic: lp.topic,
    chapterTitle: lp.chapter_title,
    language,
  });
  return { queued: true };
}

/**
 * @param {object} input
 * @param {string} input.userId   — WhatsApp phone number the reply/document is delivered to
 * @param {string} [input.userDbId] — users.id (UUID); REQUIRED for the async queue path,
 *   OPTIONAL for the cache-hit path. If absent on cache-miss, we fall through to freeform.
 * @param {string} [input.topic]
 * @param {number} [input.grade]
 * @param {string} [input.subject]
 * @param {string} input.curriculum
 * @param {string} [input.language]
 * @returns {Promise<{ source: 'pre_generated'|'ast_cached'|'ast_queued'|'oxbridge_picker'|'page_prompt', promptedForPage: boolean }>}
 */
async function handleCurriculumLessonPlan({ userId, userDbId, topic, grade, subject, curriculum, language }) {
  try {
    if (!topic || !curriculum) return { source: 'page_prompt', promptedForPage: true };

    // Path 0 — Oxbridge Grade 6-12 picker (FEAT-080 / bd-2016). Runs BEFORE
    // the AST + pre-gen paths because for grade 6-12 there is no NBF/Taleemabad
    // pre-gen coverage; Oxbridge is the only curated corpus at this level. If
    // 1+ Oxbridge rows match on grade + topic, send a 2-button picker
    // ([Oxbridge LP] [Generate Rumi LP]) and pause the flow — the button
    // reply (routed in whatsapp-bot.js) resolves the pick.
    if (OxbridgeLpService.isEligibleGrade(grade)) {
      const matches = await OxbridgeLpService.findMatches({ grade, topic, subject });
      if (matches && matches.length > 0) {
        const sent = await OxbridgeLpService.sendPicker(userId, matches, {
          topic, grade, subject, language,
        });
        if (sent) {
          return { source: 'oxbridge_picker', promptedForPage: false };
        }
        // Picker send failed — fall through to legacy paths.
        logToFile('Oxbridge LP: picker send failed, falling through', { userId, topic, grade });
      }
    }

    // Path A — curriculum_lp_ast (Taleemabad NBF / Taleemabad JSON corpus).
    // Try this FIRST because textbook_toc doesn't yet include NBF/Taleemabad
    // chapter titles (only Punjab SNC + Balochistan + Sindh). No curriculum_key
    // filter for NIETE — we serve across NBF + Taleemabad.
    const astLp = await CurriculumLpAstService.findByTopic({ topic, grade, subject });
    if (astLp) {
      // Prefer cache in the requested language; fall back to the OTHER language's
      // cache if the requested one is empty. Rationale: consistent teacher UX —
      // an available cached PDF (even in the "wrong" language) is better than
      // a 2-minute Gamma render for a request that the source content actually
      // does have (source teacher scripts are usually the same language regardless
      // of framework language). We only queue a fresh render when NEITHER cache
      // is populated.
      const primaryCol = language === 'ur' ? 'pdf_r2_key_ur' : 'pdf_r2_key_en';
      const fallbackCol = language === 'ur' ? 'pdf_r2_key_en' : 'pdf_r2_key_ur';
      const primaryKey = astLp[primaryCol];
      const fallbackKey = astLp[fallbackCol];
      const cachedR2Key = primaryKey || fallbackKey;
      const servedFallback = !primaryKey && !!fallbackKey;
      const filename = `${astLp.chapter_title} — ${astLp.topic} - Lesson Plan.pdf`.replace(/["<>?*|\\/]/g, '');

      if (cachedR2Key) {
        await serveR2Pdf(userId, cachedR2Key, filename);
        if (servedFallback) {
          logToFile('Curriculum LP: language fallback served', {
            requested: language, served: language === 'ur' ? 'en' : 'ur',
            source_lp_uuid: astLp.source_lp_uuid,
          });
        }
        await _scheduleFeedbackForCacheHit({
          userDbId, phone: userId,
          topic: astLp.topic, grade: astLp.grade, subject: astLp.subject,
          chapterNumber: astLp.chapter_number,
          lpVariant: astLp.publisher === 'NBF' ? 'nbf_ast' : 'taleemabad_ast',
          language, r2Key: cachedR2Key,
        });
        return { source: 'ast_cached', promptedForPage: false };
      }

      // Neither language cached — ack + queue for background render. Requires userDbId.
      const q = await sendAckAndQueue({ phoneNumber: userId, userDbId, lp: astLp, language });
      if (q.queued) return { source: 'ast_queued', promptedForPage: false };
      // Missing userDbId — fall through to freeform (rare)
    }

    // Path B — legacy pre_generated_lps (Rumi PK Punjab SNC 2020).
    // Requires a textbook_toc chapter match first.
    const chapter = await TopicMatchingService.findChapterByTopic({ topic, grade, subject, curriculum });
    if (chapter) {
      const preGen = await PreGenLookupService.findPreGenLP({
        chapterNumber: chapter.chapter_number, grade, subject, curriculum,
      });
      const langCol = language === 'ur' ? 'pdf_r2_key_ur' : 'pdf_r2_key_en';
      const r2Key = preGen && preGen[langCol];
      if (r2Key) {
        await serveR2Pdf(userId, r2Key, `${chapter.chapter_title} - Lesson Plan.pdf`);
        await _scheduleFeedbackForCacheHit({
          userDbId, phone: userId,
          topic, grade, subject,
          chapterNumber: chapter.chapter_number,
          lpVariant: 'punjab_pregen',
          language, r2Key,
        });
        return { source: 'pre_generated', promptedForPage: false };
      }
    }

    logToFile('Curriculum LP: no AST / pre-gen match, falling through to Gamma freeform', {
      topic, curriculum,
    });
    return { source: 'page_prompt', promptedForPage: true };
  } catch (error) {
    logToFile('Curriculum LP handler error, falling through to Gamma', {
      error: error.message, userId, topic,
    });
    return { source: 'page_prompt', promptedForPage: true };
  }
}

module.exports = handleCurriculumLessonPlan;
