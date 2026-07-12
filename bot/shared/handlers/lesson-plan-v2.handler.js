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
 *   1. Cached PDF from curriculum_lp_ast (if the LP AST row has pdf_r2_key)
 *   2. Legacy pre_generated_lps PDF (Punjab corpus)
 *   3. Gamma-grounded render from the AST row → cache to R2 → serve
 *   4. Fall through to page_prompt (existing Gamma freeform fallback)
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const TopicMatchingService = require('../services/topic-matching.service');
const PreGenLookupService = require('../services/pregen-lookup.service');
const CurriculumLpAstService = require('../services/curriculum-lp-ast.service');
const ContentService = require('../services/content.service');
const { downloadFromR2, uploadBuffer } = require('../storage/r2');
const WhatsAppService = require('../services/whatsapp.service');
const { logToFile } = require('../utils/logger');

function astR2Key(lp, language) {
  const lang = language === 'ur' ? 'ur' : 'en';
  return `lps/curriculum-ast/${lp.source_lp_uuid}.${lang}.pdf`;
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

/**
 * Render an LP AST row via Gamma-grounded → cache PDF to R2 → send.
 * Returns true on success, false on any failure so the caller can fall through.
 */
async function renderAndServeFromAst({ userId, lp, language }) {
  try {
    const filename = `${lp.chapter_title} — ${lp.topic} - Lesson Plan.pdf`.replace(/["<>?*|\\/]/g, '');
    logToFile('Curriculum LP: rendering via Gamma-grounded', {
      source_lp_uuid: lp.source_lp_uuid, publisher: lp.publisher, topic: lp.topic,
    });

    // Gamma render — grounded on the AST row
    const { pdfUrl } = await ContentService.generateLessonPlan(
      lp.topic || lp.chapter_title,
      lp.topic || lp.chapter_title, // fullUserMessage — grounded prompt embeds the source anyway
      language === 'ur' ? 'ur' : 'en',
      { curriculumLpAst: lp },
    );
    if (!pdfUrl) throw new Error('Gamma returned no pdfUrl');

    // Download the Gamma PDF into a buffer, then persist to R2 with our key
    const axios = require('axios');
    const resp = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
    const pdfBuffer = Buffer.from(resp.data);

    const r2Key = astR2Key(lp, language);
    await uploadBuffer(pdfBuffer, r2Key, 'application/pdf');
    await CurriculumLpAstService.setRenderedPdfKey(lp.source_lp_uuid, r2Key, language === 'ur' ? 'ur' : 'en');
    logToFile('Curriculum LP: Gamma render cached in R2', { source_lp_uuid: lp.source_lp_uuid, r2Key });

    // Send the just-generated PDF
    let tmpPath = path.join(os.tmpdir(), `curriculum_lp_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
    try {
      fs.writeFileSync(tmpPath, pdfBuffer);
      await WhatsAppService.sendDocument(userId, tmpPath, filename);
    } finally {
      try { fs.unlinkSync(tmpPath); } catch (_) { /* best-effort */ }
    }
    return true;
  } catch (error) {
    logToFile('Curriculum LP: Gamma-grounded render failed', {
      source_lp_uuid: lp.source_lp_uuid, error: error.message,
    });
    return false;
  }
}

/**
 * @param {object} input
 * @param {string} input.userId
 * @param {string} [input.topic]
 * @param {number} [input.grade]
 * @param {string} [input.subject]
 * @param {string} input.curriculum
 * @param {string} [input.language]
 * @returns {Promise<{ source: 'pre_generated'|'ast_cached'|'ast_generated'|'page_prompt', promptedForPage: boolean }>}
 */
async function handleCurriculumLessonPlan({ userId, topic, grade, subject, curriculum, language }) {
  try {
    if (!topic || !curriculum) return { source: 'page_prompt', promptedForPage: true };

    // Path A — curriculum_lp_ast (Taleemabad NBF / Taleemabad JSON corpus).
    // Try this FIRST because textbook_toc doesn't yet include NBF/Taleemabad
    // chapter titles (only Punjab SNC + Balochistan + Sindh). This makes the
    // handler work today; longer-term we can backfill textbook_toc too.
    //
    // No curriculum_key filter for NIETE — we serve across NBF + Taleemabad.
    const astLp = await CurriculumLpAstService.findByTopic({ topic, grade, subject });
    if (astLp) {
      const langCol = language === 'ur' ? 'pdf_r2_key_ur' : 'pdf_r2_key_en';
      const cachedR2Key = astLp[langCol];
      const filename = `${astLp.chapter_title} — ${astLp.topic} - Lesson Plan.pdf`.replace(/["<>?*|\\/]/g, '');

      if (cachedR2Key) {
        await serveR2Pdf(userId, cachedR2Key, filename);
        return { source: 'ast_cached', promptedForPage: false };
      }

      // Not cached — render via Gamma-grounded and cache
      const rendered = await renderAndServeFromAst({ userId, lp: astLp, language });
      if (rendered) return { source: 'ast_generated', promptedForPage: false };
      // Fall through to Path B / freeform if grounded render fails
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
