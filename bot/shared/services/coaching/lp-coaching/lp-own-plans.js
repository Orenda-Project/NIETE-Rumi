'use strict';
/**
 * bd-snkn32.45 — the observed teacher's own "Make my own" plans on the WhatsApp lesson-plan list.
 *
 * The portal's Check and send got them in bd-snkn32.41 (observe-own-plans). This is the WhatsApp side:
 * the same listing (observe-own-plans.listForTeacher — her root plans by user id, each at its newest READY
 * round, never failed) becomes lp_own_{ownId}_{sessionId} rows next to her downloads, newest first within
 * the list's 8 plan rows; a picked one resolves through observe-own-plans.resolveKey (her user id, status
 * ready) and goes onto the observation exactly as the portal writes it: the attached-PDF fields, extraction
 * pending, so the extraction worker reads it and Section B is scored from it.
 *
 * The label never guesses the teacher's gender (a teacher can be a man or a woman).
 */
const OwnPlans = require('../../observe/observe-own-plans');
const { truncateCp, relTime } = require('./lp-selection-format');

const MAX_LP_ROWS = 8; // the list's plan rows (lp-selection-list: 10 WhatsApp rows minus 2 option rows)
const TITLE_MAX = 24;
const DESC_MAX = 72;
const LABEL = Object.freeze({ en: 'Made by the teacher', ur: 'ٹیچر کا بنایا ہوا' });

const ownLabel = (lang) => (lang === 'ur' ? LABEL.ur : LABEL.en);

/** Pure: an observe-own-plans entry → a list entry (created_at orders it beside her downloads). */
function toListLp(p) {
  return {
    own: true,
    id: p.ownId,
    ownId: p.ownId,
    lesson_id: p.lessonId || null,
    topic: p.topic || null,
    grade: p.grade != null ? p.grade : null,
    subject: p.subject || null,
    chapter_number: p.chapterNumber != null ? p.chapterNumber : null,
    created_at: p.madeAt || null,
  };
}

const cap1 = (s) => { const t = String(s || '').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; };

/** Pure: an own list entry → its WhatsApp row text. Code-point caps, Urdu-safe. */
function formatOwnRow(lp, lang = 'en', opts = {}) {
  const gradeBit = lp.grade != null ? `Grade ${lp.grade}${lp.subject ? ` ${cap1(lp.subject)}` : ''}` : cap1(lp.subject);
  const parts = [
    ownLabel(lang),
    gradeBit,
    lp.chapter_number != null ? `Ch${lp.chapter_number}` : '',
    relTime(lp.created_at, opts.now || new Date()),
  ].filter(Boolean);
  return {
    title: truncateCp(lp.topic || 'Lesson plan', TITLE_MAX),
    description: truncateCp(parts.join(' · '), DESC_MAX),
  };
}

/** Pure: downloads + own plans, newest first, within the 8 plan rows. */
function mergeWithOwn(downloads, own, cap = MAX_LP_ROWS) {
  const when = (r) => String(r.created_at || '');
  return [...(downloads || []), ...(own || [])]
    .sort((a, b) => when(b).localeCompare(when(a)))
    .slice(0, cap);
}

/**
 * The session owner's list entries: her downloads (deps.downloads) plus her ready own plans. A failure loading
 * her own plans leaves the downloads — the list must never vanish over it.
 */
async function recentWithOwn(ownerUserId, deps = {}) {
  const downloads = deps.downloads ? await deps.downloads(ownerUserId) : [];
  if (!ownerUserId) return downloads || [];
  const listOwn = deps.listOwn || ((uid) => OwnPlans.listForTeacher(uid));
  let own = [];
  try { own = (await listOwn(ownerUserId)) || []; } catch (err) {
    require('../../../utils/logger').logToFile('[lp-own] her own plans did not load (downloads only)', { error: err && err.message });
  }
  return mergeWithOwn(downloads, own.map(toListLp));
}

/**
 * Put her plan on the observation, as observe-own-plans' portal path does: the PDF is resolved for the
 * session OWNER (the observed teacher) and written as an attached plan, then its extraction is queued.
 * @returns {Promise<{attached: true, r2Key: string}|{attached: false}>}
 */
async function attachOwnPlan(sessionId, ownId, deps = {}) {
  const supabase = deps.supabase || require('../../../config/supabase');
  const resolveKey = deps.resolveKey || OwnPlans.resolveKey;
  const queueExtraction = deps.queueExtraction
    || ((sid, meta) => require('../coaching-job-queue.service').queueLessonPlanExtraction(sid, meta));
  const publicUrl = deps.publicUrl || ((k) => require('../../../storage/r2').buildR2PublicUrl(k));

  const { data: session } = await supabase
    .from('coaching_sessions').select('user_id').eq('id', sessionId).maybeSingle();
  const userId = session && session.user_id;
  const r2Key = userId ? await resolveKey({ userId, ownId }) : null;
  if (!r2Key) return { attached: false };

  const ext = (String(r2Key).match(/\.([a-z0-9]+)$/i) || [])[1];
  const fileType = ext ? ext.toLowerCase() : 'pdf';
  await supabase
    .from('coaching_sessions')
    .update({
      has_lesson_plan: true,
      lesson_plan_url: publicUrl(r2Key),
      lesson_plan_r2_key: r2Key,
      lesson_plan_format: fileType,
      lesson_plan_extraction_status: 'pending',
      lesson_plan_extraction_error: null,
    })
    .eq('id', sessionId);
  await queueExtraction(sessionId, { r2Key, fileType, userId });
  return { attached: true, r2Key };
}

/** The tapped own row's text, rebuilt from the same listing, for the "use this plan?" confirmation. */
async function describeOwn(sessionId, ownId, lang, deps = {}) {
  try {
    const supabase = deps.supabase || require('../../../config/supabase');
    const { data } = await supabase.from('coaching_sessions').select('user_id').eq('id', sessionId).maybeSingle();
    if (!data || !data.user_id) return null;
    const plans = await OwnPlans.listForTeacher(data.user_id);
    const p = plans.find((x) => x.ownId === ownId);
    return p ? formatOwnRow(toListLp(p), lang) : null;
  } catch (_) { return null; }
}

module.exports = {
  LABEL, ownLabel, toListLp, formatOwnRow, mergeWithOwn, recentWithOwn, attachOwnPlan, describeOwn,
};
