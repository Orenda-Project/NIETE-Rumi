/**
 * Oxbridge Lesson-Plan service — FEAT-080 (bd-2016).
 *
 * When a teacher on grade 6-12 requests a lesson plan, we check the
 * `lesson_plan_catalog` table for `source='oxbridge'` rows that match on
 * grade + topic. If one or more matches exist we send a 2-button picker
 * ([Oxbridge LP] [Generate Rumi LP]); on tap of "Oxbridge LP" we deliver
 * the row's `content_html` verbatim as a plain-text message + a PDF
 * attachment. NO LLM rewrite — the content_html is the authoritative
 * Oxbridge lesson plan.
 *
 * Data shape (from `lesson_plan_catalog`):
 *   - `grade`         — human string: "Grade Six" .. "Grade Twelve"
 *   - `subject`       — "Biology" | "Chemistry" | "Computer Science"
 *                       | "General Science" | "Physics"
 *   - `chapter_title` — broad chapter, e.g. "Waves and Energy"
 *   - `description`   — HTML that embeds "<strong>Topic: </strong>Dispersion Of Light"
 *   - `content_html`  — the full LP body (HTML)
 *
 * The topic teachers type on WhatsApp is unstructured (e.g. "grade 7
 * physics dispersion of light"), so we match with case-insensitive
 * substring against BOTH `chapter_title` AND `description`. Subject is
 * captured but NOT used to filter (teachers say "Physics" for what
 * Oxbridge tags as "General Science"); it's used to break ties in ordering.
 *
 * Pending-picker state is cached in Redis keyed by phone number for 30
 * minutes so the button reply can resolve back to the picked row.
 */

const supabase = require('../config/supabase');
const redisService = require('./cache/railway-redis.service');
const WhatsAppService = require('./whatsapp.service');
const { logToFile } = require('../utils/logger');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GRADE_WORDS = {
  6: 'Grade Six', 7: 'Grade Seven', 8: 'Grade Eight', 9: 'Grade Nine',
  10: 'Grade Ten', 11: 'Grade Eleven', 12: 'Grade Twelve',
};

const PICKER_TTL_SECONDS = 30 * 60;

function gradeWord(gradeInt) {
  return GRADE_WORDS[gradeInt] || null;
}

function isEligibleGrade(gradeInt) {
  const n = parseInt(gradeInt, 10);
  return Number.isFinite(n) && n >= 6 && n <= 12;
}

/**
 * Extract the "Topic:" value from the description HTML.
 * @param {string} descriptionHtml
 * @returns {string|null}
 */
function extractTopicFromDescription(descriptionHtml) {
  if (!descriptionHtml) return null;
  const m = descriptionHtml.match(/Topic:\s*<\/strong>\s*([^<]+)/i);
  return m ? m[1].trim() : null;
}

/**
 * Strip HTML tags for a plain-text delivery. Collapses whitespace and preserves
 * line breaks on block-level element boundaries. Deliberately simple — the
 * WhatsApp text is a companion to the PDF, not the primary artifact.
 * @param {string} html
 * @returns {string}
 */
function htmlToPlainText(html) {
  if (!html) return '';
  return html
    // Convert block element close tags to newlines
    .replace(/<\/(p|div|h[1-6]|li|tr|br|hr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Strip remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode a handful of common entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Collapse >2 blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Find Oxbridge catalog matches for a teacher's LP request.
 *
 * @param {object} args
 * @param {number} args.grade    — integer 6..12
 * @param {string} args.topic    — teacher's raw topic string
 * @param {string} [args.subject]— optional coarse subject (used for ordering only)
 * @returns {Promise<Array<object>>} matched rows (empty if none)
 */
async function findMatches({ grade, topic, subject }) {
  if (!isEligibleGrade(grade)) return [];
  if (!topic || typeof topic !== 'string' || topic.trim().length < 2) return [];

  const gword = gradeWord(parseInt(grade, 10));
  if (!gword) return [];

  const needle = topic.trim().toLowerCase();

  // Pull all oxbridge rows for the grade — the corpus is small (max ~12 rows
  // per grade) so a client-side filter on both `chapter_title` and the
  // description-embedded topic is cheaper + safer than two roundtrips with
  // ILIKE-ORs.
  const { data, error } = await supabase
    .from('lesson_plan_catalog')
    .select('id, source, grade, subject, chapter_title, description, content_html')
    .eq('source', 'oxbridge')
    .eq('grade', gword)
    .eq('is_active', true);

  if (error) {
    logToFile('Oxbridge LP: catalog lookup failed', { error: error.message, grade, topic });
    return [];
  }
  if (!Array.isArray(data) || data.length === 0) return [];

  // Extract the topic keywords from the teacher's message. We match any
  // catalog row whose chapter_title OR extracted description-topic contains
  // ANY of the significant tokens from the teacher's message — this is more
  // forgiving than whole-string substring, matching Ramisha's "chapter_title ≈"
  // spec.
  const stopwords = new Set([
    'lesson', 'plan', 'lp', 'for', 'the', 'a', 'an', 'on', 'of', 'in',
    'grade', 'class', 'physics', 'chemistry', 'biology', 'science',
    'general', 'computer', 'and', 'to', 'please', 'want', 'need',
    'chapter', 'topic', 'about',
  ]);
  const tokens = needle
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 3 && !stopwords.has(t) && !/^\d+$/.test(t));

  const scored = data.map(row => {
    const chapter = (row.chapter_title || '').toLowerCase();
    const descTopic = (extractTopicFromDescription(row.description) || '').toLowerCase();
    let score = 0;
    // Whole-substring match (Ramisha's "≈" — e.g. topic "dispersion of light"
    // exactly matches description-topic "dispersion of light"). Strongest signal.
    if (chapter && needle.includes(chapter)) score += 10;
    if (descTopic && needle.includes(descTopic)) score += 12;
    if (chapter && chapter.includes(needle)) score += 6;
    if (descTopic && descTopic.includes(needle)) score += 8;
    // Token overlap
    for (const t of tokens) {
      if (chapter.includes(t)) score += 2;
      if (descTopic.includes(t)) score += 3;
    }
    // Subject tie-break: prefer rows whose subject the teacher mentioned
    if (subject && row.subject && row.subject.toLowerCase().includes(String(subject).toLowerCase())) {
      score += 1;
    }
    return { row, score };
  }).filter(x => x.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.map(x => x.row);
}

/**
 * Look up a catalog row by id (used by the button-reply handler to resolve
 * the row the teacher picked).
 */
async function getById(id) {
  const { data, error } = await supabase
    .from('lesson_plan_catalog')
    .select('id, source, grade, subject, chapter_title, description, content_html')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    logToFile('Oxbridge LP: getById failed', { error: error.message, id });
    return null;
  }
  return data || null;
}

// ─── Pending picker state (Redis) ──────────────────────────────────────────

function pickerKey(phone) {
  return `oxbridge_picker:${phone}`;
}

async function savePendingPicker(phone, payload) {
  try {
    if (!redisService.isConnected()) return false;
    await redisService.redis.setex(
      pickerKey(phone), PICKER_TTL_SECONDS, JSON.stringify(payload)
    );
    return true;
  } catch (err) {
    logToFile('Oxbridge LP: savePendingPicker failed', { error: err.message, phone });
    return false;
  }
}

async function getPendingPicker(phone) {
  try {
    if (!redisService.isConnected()) return null;
    const raw = await redisService.redis.get(pickerKey(phone));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    logToFile('Oxbridge LP: getPendingPicker failed', { error: err.message, phone });
    return null;
  }
}

async function clearPendingPicker(phone) {
  try {
    if (!redisService.isConnected()) return;
    await redisService.redis.del(pickerKey(phone));
  } catch (err) {
    logToFile('Oxbridge LP: clearPendingPicker failed', { error: err.message, phone });
  }
}

// ─── Delivery ──────────────────────────────────────────────────────────────

/**
 * Send the picker: 2 buttons, [Oxbridge LP] [Generate Rumi LP].
 * The best-scored match's id is embedded in the "Oxbridge LP" button id so
 * we always resolve back to the top match on tap.
 *
 * @param {string} phone
 * @param {Array<object>} matches — findMatches() result (non-empty)
 * @param {object} ctx           — { topic, grade, subject, language }
 */
async function sendPicker(phone, matches, ctx = {}) {
  if (!matches || matches.length === 0) return false;
  const top = matches[0];
  const isUrdu = ctx.language === 'ur';
  const chapter = top.chapter_title || 'lesson';
  const body = isUrdu
    ? `📚 آپ کے موضوع "${ctx.topic || chapter}" پر ایک Oxbridge لیسن پلان موجود ہے۔\n\nکیا آپ Oxbridge والا لیسن پلان لینا چاہیں گے، یا Rumi خود ایک تیار کرے؟`
    : `📚 We have an Oxbridge lesson plan matching "${ctx.topic || chapter}".\n\nWould you like the Oxbridge lesson plan, or should Rumi generate a fresh one?`;

  // Cache the match set + the original topic so the button handler can act
  // on the pick without re-running the query.
  await savePendingPicker(phone, {
    matchIds: matches.map(m => m.id),
    topic: ctx.topic || '',
    grade: ctx.grade || null,
    subject: ctx.subject || null,
    language: ctx.language || 'en',
    createdAt: Date.now(),
  });

  const ok = await WhatsAppService.sendInteractiveButtons(phone, {
    body,
    buttons: [
      { id: `oxbridge_lp_pick_${top.id}`, title: isUrdu ? 'Oxbridge LP' : 'Oxbridge LP' },
      { id: 'oxbridge_lp_rumi', title: isUrdu ? 'Rumi LP بنائیں' : 'Generate Rumi LP' },
    ],
  });
  logToFile('Oxbridge LP: picker sent', {
    phone, topMatchId: top.id, matches: matches.length, ok,
  });
  return ok;
}

/**
 * Deliver the Oxbridge LP content: a text message with the plain-text body
 * AND a PDF attachment rendered from content_html. NO LLM rewrite.
 */
async function deliverOxbridgeLp(phone, row, language) {
  if (!row || !row.content_html) {
    logToFile('Oxbridge LP: no content_html on row', { rowId: row && row.id });
    return false;
  }
  const isUrdu = language === 'ur';

  // 1. Text message — plain-text extraction of content_html.
  const plain = htmlToPlainText(row.content_html);
  // WhatsApp text limit ~4096; long LP bodies may exceed. We chunk safely.
  const header = isUrdu
    ? `📖 *Oxbridge لیسن پلان — ${row.chapter_title || ''}*\n\n`
    : `📖 *Oxbridge Lesson Plan — ${row.chapter_title || ''}*\n\n`;
  const text = header + plain;
  await sendChunkedText(phone, text);

  // 2. PDF — render content_html via Playwright.
  let tmpPath;
  try {
    const { htmlToPdf } = require('../utils/html-to-pdf');
    const fullHtml = wrapAsStandaloneHtml(row);
    const pdfBuffer = await htmlToPdf(fullHtml, { timeout: 30000 });
    tmpPath = path.join(
      os.tmpdir(),
      `oxbridge_lp_${row.id}_${Date.now()}.pdf`
    );
    fs.writeFileSync(tmpPath, pdfBuffer);
    const safeChapter = (row.chapter_title || 'lesson-plan').replace(/["<>?*|\\/]/g, '');
    const filename = `Oxbridge — ${safeChapter} — Lesson Plan.pdf`;
    await WhatsAppService.sendDocument(phone, tmpPath, filename);
    logToFile('Oxbridge LP: delivered', {
      phone, rowId: row.id, sizeKB: (pdfBuffer.length / 1024).toFixed(1),
    });
    return true;
  } catch (err) {
    // Customer-visible failure — must page Axiom (level='error'), not hide
    // in info-level noise. A silent PDF-render failure means the teacher
    // gets a text-only fallback that strips <img> tags from the LP body.
    logToFile('Oxbridge LP: PDF render/send failed', {
      error: err.message, rowId: row.id, phone,
    }, 'error');
    return false;
  } finally {
    if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch (_) { /* best-effort */ } }
  }
}

async function sendChunkedText(phone, text) {
  const MAX = 3800; // conservative under WhatsApp's 4096
  if (text.length <= MAX) {
    await WhatsAppService.sendMessage(phone, text);
    return;
  }
  let cursor = 0;
  while (cursor < text.length) {
    let end = Math.min(cursor + MAX, text.length);
    if (end < text.length) {
      // Break on nearest newline before MAX to keep chunks legible.
      const nl = text.lastIndexOf('\n', end);
      if (nl > cursor + 1000) end = nl;
    }
    await WhatsAppService.sendMessage(phone, text.slice(cursor, end));
    cursor = end;
  }
}

/**
 * Wrap the LP content in a print-friendly HTML shell so the PDF renders
 * with readable margins + typography. Keeps the raw content_html intact —
 * only the surrounding chrome is ours.
 */
function wrapAsStandaloneHtml(row) {
  const title = `Oxbridge — ${row.chapter_title || 'Lesson Plan'}`.replace(/</g, '&lt;');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; color: #222; line-height: 1.5; }
  h1, h2, h3 { color: #1a3a6c; }
  strong { color: #1a3a6c; }
  table { border-collapse: collapse; margin: 12px 0; }
  td, th { border: 1px solid #cbd5e0; padding: 6px 10px; }
  p { margin: 8px 0; }
  .lp-header { border-bottom: 2px solid #1a3a6c; padding-bottom: 8px; margin-bottom: 16px; }
</style></head>
<body>
  <div class="lp-header">
    <div style="font-size: 12px; color: #666;">Oxbridge Lesson Plan</div>
    <div style="font-size: 20px; font-weight: bold; color: #1a3a6c;">${(row.chapter_title || '').replace(/</g, '&lt;')}</div>
    <div style="font-size: 12px; color: #666;">${(row.grade || '')} — ${(row.subject || '')}</div>
  </div>
  ${row.content_html || ''}
</body></html>`;
}

module.exports = {
  findMatches,
  getById,
  savePendingPicker,
  getPendingPicker,
  clearPendingPicker,
  sendPicker,
  deliverOxbridgeLp,
  // Exported for testing:
  extractTopicFromDescription,
  htmlToPlainText,
  isEligibleGrade,
  gradeWord,
};
