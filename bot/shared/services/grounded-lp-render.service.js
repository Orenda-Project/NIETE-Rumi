/**
 * Grounded LP Render Service
 *
 * Extracted from lesson-plan-v2.handler.js so the worker can reuse the same
 * render-cache-serve logic. Turns a curriculum_lp_ast row into a delivered PDF:
 *
 *   1. Call Gamma via ContentService.generateLessonPlan with { curriculumLpAst: lp }
 *   2. Download the resulting PDF into a buffer
 *   3. Upload buffer to R2 under lps/curriculum-ast/{uuid}.{lang}.pdf
 *   4. Update the curriculum_lp_ast row's pdf_r2_key_{en|ur} so subsequent
 *      hits skip Gamma entirely (~3s cached vs ~2min fresh)
 *   5. Send the PDF via WhatsApp
 *
 * Two callers:
 *   - Async worker (workers/lesson-plan-generation.worker.js) — normal path
 *   - Handler (shared/handlers/lesson-plan-v2.handler.js) — cache-hit fast path
 *     only calls step 5 (via serveR2Pdf), NOT this service; the cache-miss
 *     path defers to the worker to avoid blocking WhatsApp for ~2min.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const ContentService = require('./content.service');
const CurriculumLpAstService = require('./curriculum-lp-ast.service');
const WhatsAppService = require('./whatsapp.service');
const { uploadBuffer } = require('../storage/r2');
const { logToFile } = require('../utils/logger');

function astR2Key(lp, language) {
  const lang = language === 'ur' ? 'ur' : 'en';
  return `lps/curriculum-ast/${lp.source_lp_uuid}.${lang}.pdf`;
}

function astFilename(lp) {
  return `${lp.chapter_title} — ${lp.topic} - Lesson Plan.pdf`.replace(/["<>?*|\\/]/g, '');
}

/**
 * Render an AST row via Gamma-grounded, cache to R2, send document.
 * @param {object} input
 * @param {string} input.userId
 * @param {object} input.lp  — curriculum_lp_ast row (must have source_lp_uuid, topic, chapter_title)
 * @param {'en'|'ur'} [input.language]
 * @returns {Promise<{ok: true, r2Key: string} | {ok: false, error: string}>}
 */
async function renderAndServeGrounded({ userId, lp, language = 'en' }) {
  const filename = astFilename(lp);
  let tmpPath;
  try {
    logToFile('Grounded LP: Gamma render starting', {
      source_lp_uuid: lp.source_lp_uuid, publisher: lp.publisher, topic: lp.topic, language,
    });

    // 1. Gamma render — the grounded prompt embeds the source's step arrays verbatim
    const { pdfUrl } = await ContentService.generateLessonPlan(
      lp.topic || lp.chapter_title,
      lp.topic || lp.chapter_title,
      language === 'ur' ? 'ur' : 'en',
      { curriculumLpAst: lp },
    );
    if (!pdfUrl) throw new Error('Gamma returned no pdfUrl');

    // 2. Download PDF into buffer
    const resp = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
    const pdfBuffer = Buffer.from(resp.data);

    // 3. Upload to R2 under our stable key
    const r2Key = astR2Key(lp, language);
    await uploadBuffer(pdfBuffer, r2Key, 'application/pdf');
    // 4. Update AST row so future hits skip Gamma
    await CurriculumLpAstService.setRenderedPdfKey(lp.source_lp_uuid, r2Key, language === 'ur' ? 'ur' : 'en');
    logToFile('Grounded LP: cached in R2', { source_lp_uuid: lp.source_lp_uuid, r2Key });

    // 5. Send the freshly rendered PDF
    tmpPath = path.join(os.tmpdir(), `grounded_lp_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
    fs.writeFileSync(tmpPath, pdfBuffer);
    await WhatsAppService.sendDocument(userId, tmpPath, filename);

    // 6. FEAT-059 enrichment media (voicenote + demo video) if the AST row has them.
    // The `lp` passed in from the worker's requeue path may not have the new
    // columns hydrated — refetch to be safe.
    let enrichedLp = lp;
    if (!('voicenote_ogg_r2_key' in lp) && !('demo_video_r2_key' in lp)) {
      const supabase = require('../config/supabase');
      const { data } = await supabase
        .from('curriculum_lp_ast')
        .select('source_lp_uuid, voicenote_ogg_r2_key, demo_video_r2_key')
        .eq('source_lp_uuid', lp.source_lp_uuid)
        .maybeSingle();
      if (data) enrichedLp = { ...lp, ...data };
    }
    await sendEnrichmentMedia({ userId, lp: enrichedLp });

    return { ok: true, r2Key };
  } catch (error) {
    logToFile('Grounded LP: render failed', {
      source_lp_uuid: lp.source_lp_uuid, error: error.message,
    });
    return { ok: false, error: error.message };
  } finally {
    if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch (_) { /* best-effort */ } }
  }
}

/**
 * FEAT-059 enrichment media send.
 *
 * After the LP PDF has been delivered, send the accompanying voicenote and
 * demo video (if present on the AST row) with pacing:
 *
 *   PDF (already sent by caller)
 *      ↓ 5s
 *   Voicenote (OGG-Opus, renders as WhatsApp voice-message bubble)
 *      ↓ 8s
 *   Demo video (MP4, teacher-executes-lesson clip; only for the 3 flagship LPs)
 *
 * The pacing prevents the teacher's WhatsApp from receiving three heavy media
 * blobs in one flood, which reads as chaotic. Errors are swallowed inside each
 * send — a voicenote failure never blocks the video, and neither blocks the
 * PDF (which is already delivered by the time this runs).
 *
 * @param {object} input
 * @param {string} input.userId - Recipient phone number
 * @param {object} input.lp     - curriculum_lp_ast row (must have voicenote_ogg_r2_key + demo_video_r2_key nullable)
 * @returns {Promise<void>}
 */
async function sendEnrichmentMedia({ userId, lp }) {
  const hasVoicenote = !!lp.voicenote_ogg_r2_key;
  const hasVideo = !!lp.demo_video_r2_key;
  if (!hasVoicenote && !hasVideo) return;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const started = Date.now();
  logToFile('LP enrichment: media sequence starting', {
    source_lp_uuid: lp.source_lp_uuid, hasVoicenote, hasVideo,
  });

  if (hasVoicenote) {
    try {
      await sleep(5000);
      await WhatsAppService.sendVoicenoteFromR2Key(userId, lp.voicenote_ogg_r2_key);
    } catch (e) {
      logToFile('LP enrichment: voicenote send failed (non-fatal)', {
        source_lp_uuid: lp.source_lp_uuid, error: e.message,
      });
    }
  }

  if (hasVideo) {
    try {
      await sleep(8000);
      const endpoint = (process.env.R2_ENDPOINT || '').replace(/\/$/, '');
      const bucket = process.env.R2_BUCKET_NAME;
      const fullVideoUrl = `${endpoint}/${bucket}/${lp.demo_video_r2_key}`;
      await WhatsAppService.sendVideoFromUrl(userId, fullVideoUrl);
    } catch (e) {
      logToFile('LP enrichment: demo video send failed (non-fatal)', {
        source_lp_uuid: lp.source_lp_uuid, error: e.message,
      });
    }
  }

  logToFile('LP enrichment: media sequence complete', {
    source_lp_uuid: lp.source_lp_uuid, elapsedMs: Date.now() - started,
  });
}

module.exports = {
  renderAndServeGrounded,
  sendEnrichmentMedia,
  astR2Key,
  astFilename,
};
