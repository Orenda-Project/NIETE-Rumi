'use strict';
/**
 * Serving a GB K-5 plan (bd-rj6w0n.14.7).
 *
 * GB plans are imported, never authored by the bot: each ready render (template_version 'gb_v10')
 * points at a hosted v10 coach card with v9 embedded, r2_key `gb-k5/.../<x>.card.html`, published on
 * a public R2 host. She gets the LINK as a text message, not a PDF.
 *
 * The curriculum guard is #4091's rule (book-curriculum.service): a teacher gets her curriculum's book
 * where it has one for the grade+subject, ICT's otherwise. So an nbf_snc (GB) plan never goes to an
 * ICT teacher, and an ICT plan goes to a GB teacher only where GB has no book of its own. Flag
 * LP_GB_K5_ENABLED off, nobody reads GB: only non-ICT plans are refused and no user is looked up, so
 * ICT serving is exactly today's.
 */
const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const { resolveUx } = require('../config/ux-strings');
const WhatsAppService = require('./whatsapp.service');
const { isGbK5Enabled } = require('../config/lp612-flags');
const BookCurriculum = require('./book-curriculum.service');
const Lp612Catalog = require('./lp612-catalog.service');

const CARD_TEMPLATE = 'gb_v10';
// The public host S6 publishes the cards on. Overridable per environment.
const DEFAULT_CARD_BASE = 'https://pub-bc776040d1fa4d778dacc04cfa6571a1.r2.dev';

const isHostedCard = (r2Key) => /\.html$/i.test(String(r2Key || ''));

function cardUrl(r2Key) {
  const base = (process.env.LP_GB_CARD_BASE_URL || DEFAULT_CARD_BASE).replace(/\/+$/, '');
  return `${base}/${String(r2Key).split('/').map(encodeURIComponent).join('/')}`;
}

/** A segment of a non-ICT curriculum (GB's nbf_snc); a row that does not say is ICT's. */
const isGbSegment = (segment) => BookCurriculum.curriculumOf(segment) !== BookCurriculum.ICT;

/** True when this teacher must not be served this segment. Never throws (both helpers fail open to ICT). */
async function refusesCurriculum({ segment, userId }) {
  const own = BookCurriculum.curriculumOf(segment);
  if (!isGbK5Enabled()) return own !== BookCurriculum.ICT;
  const hers = await BookCurriculum.curriculumForUser(userId);
  if (own !== BookCurriculum.ICT) return own !== hers;
  if (hers === BookCurriculum.ICT) return false;
  // An ICT plan to a GB teacher: refused only where her curriculum has its own book for this grade+subject.
  return (await Lp612Catalog.curriculumOf(segment.grade, segment.subject, hers)) !== BookCurriculum.ICT;
}

/** The segment's ready card, her language first. Shaped like findRender's answer. */
async function findGbRender(segmentId, lang) {
  const { data, error } = await supabase.from('niete_lp612_renders')
    .select('id, status, r2_key, lang, one_screen')
    .eq('segment_id', segmentId)
    .eq('template_version', CARD_TEMPLATE)
    .eq('status', 'ready');
  if (error) {
    logToFile('LP GB: card lookup failed', { segmentId, lang, error: error.message });
    return { render: null, readFailed: true };
  }
  const rows = (data || []).filter((r) => r && r.r2_key);
  return { render: rows.find((r) => r.lang === lang) || rows[0] || null, readFailed: false };
}

/** Caption + link as one text message. Same answer shape as sendDocumentWithRetry; never throws. */
async function sendCardLink({ phone, url, caption, lang }) {
  const text = [caption, resolveUx('lp612GbCardLink', { language: lang, params: { url } })]
    .filter(Boolean).join('\n');
  try {
    const ok = !!(await WhatsAppService.sendMessage(phone, text));
    return ok ? { ok, attempts: 1, text } : { ok, attempts: 1, error: 'sendMessage returned falsy' };
  } catch (err) {
    return { ok: false, attempts: 1, error: err.message };
  }
}

module.exports = {
  CARD_TEMPLATE, isHostedCard, cardUrl, isGbSegment, refusesCurriculum, findGbRender, sendCardLink,
};
