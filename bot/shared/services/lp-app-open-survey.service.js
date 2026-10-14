'use strict';
/**
 * The lesson-plan survey, for a plan she opened in the teacher app (bd-qvevax.2).
 *
 * WHY IT EXISTS. Since 12 Oct 2026 01:53 PKT the "Open in app" link is on for every registered
 * teacher: she asks for a plan on WhatsApp, taps the button and reads it in the app. The survey
 * ("was this plan useful?") was only ever scheduled by the two WhatsApp DELIVERY paths, so a plan
 * read in the app was never asked about — lp_feedback went from 613 rows (Tue 6 Oct) to 49 (Mon
 * 12 Oct) while plan use held at ~800 teachers a day, and the daily ICT report's plan-quality
 * panel reads that table.
 *
 * WHAT IT DOES. The portal's own viewer served a plan whole → it recorded a niete_lp_opens row
 * (source 'viewer') → it tells the bot the row's id (POST /api/internal/lp/open-survey). The bot
 * reads the open from that row — the portal's word is only "this id" — and, if the guards below
 * pass, schedules THE survey the WhatsApp path schedules: the same two services, the same message,
 * the same two buttons, the same 30 s delay, the same lp_feedback row on the tap. There is NO
 * scheduler here and no copy of the survey; this module only decides WHETHER to ask and hands the
 * rest to the services that already know how.
 *
 *   grades 1-5   a lesson_plans row, written by lp-v8-delivery's recordLessonPlanRow (the same
 *                shape a delivery writes), then LpFeedback.scheduleFeedbackPrompt. lp_feedback is
 *                linked by lesson_plan_id, exactly as for WhatsApp.
 *   grades 6-12  Lp612Feedback.scheduleFeedbackPrompt for the segment + document language.
 *                lp_feedback is keyed by lp612_segment_id, exactly as for WhatsApp.
 *
 * `plan_ref` is the catalogue lesson_id for k5 (data/lp_catalog.json — what niete_lp_downloads
 * .lesson_id holds) and niete_lp612_segments.segment_id for g612.
 *
 * THE GUARDS (each a skip with a reason, each logged as lp.app_open_survey):
 *   not_viewer_open        only a plan the portal's viewer served whole was READ; a link minted for
 *                          another app (source 'external') may never have been opened.
 *   already_handled        this open id was already handled (a retry from the portal).
 *   earlier_open           ONE survey per teacher per PLAN: an earlier viewer open of the plan
 *                          (either language) already had its chance. "A second open" never asks.
 *   delivered_on_whatsapp  the plan reached her on WhatsApp (niete_lp_downloads 'sent' / niete_lp612_
 *                          deliveries surface 'whatsapp') — that path scheduled its own survey.
 *                          The bot's 'portal' claim rows on a render are NOT a delivery.
 *   no_phone               no WhatsApp number to ask on.
 *   window_closed          only inside her 24-hour window, and only as a free message. She asked
 *                          for the link on WhatsApp so it normally is open; if it is not, the survey
 *                          is skipped — never a template (a template for a survey is a paid message
 *                          to someone who has not spoken for a day).
 *   unknown_plan           the catalogue no longer knows the lesson.
 *   guard_unavailable      a database that cannot answer a guard asks NOBODY. "At most one" is the
 *                          rule, so — unlike the survey's own ask-once cache, which fails open — an
 *                          unanswerable guard fails closed, and says so at error level.
 * The survey's own caps still apply after this hands over: the per-lesson ten-minute ask-once claim
 * (K-5, `lessonKey`) and the 6-12 "already answered" check run inside the services.
 *
 * What is deliberately NOT here: no new string, button or screen (the copy is the services'), no
 * per-day cap or quiet hour or opt-out (the WhatsApp survey has none to respect).
 */

const supabase = require('../config/supabase');
const redisService = require('./cache/railway-redis.service');
const { logToFile } = require('../utils/logger');
const { logEvent } = require('../utils/structured-logger');

/** One handled open, remembered long enough that a portal retry cannot ask twice. */
const HANDLED_TTL_SECS = 24 * 60 * 60;
const REDIS_HANDLED_KEY = (openId) => `lp_app_survey_handled:${openId}`;

const OPENS = 'niete_lp_opens';

function skip(reason, fields = {}) {
  logEvent('lp.app_open_survey', { outcome: 'skipped', reason, ...fields });
  return { outcome: 'skipped', reason };
}

/** First row of a guard query, or throw — a guard that cannot be answered is never read as "no". */
async function firstRow(query) {
  const { data, error } = await query.limit(1);
  if (error) throw new Error(error.message || 'guard query failed');
  return (data && data[0]) || null;
}

/**
 * Has this plan already been asked about, or already reached her on WhatsApp?
 * @returns {Promise<'earlier_open'|'delivered_on_whatsapp'|null>}
 */
async function alreadyHadItsChance(row) {
  // An EARLIER viewer open of the same plan (either document language). Strictly earlier: two
  // concurrent first opens must leave exactly one of them standing, not both skipped.
  const earlier = await firstRow(supabase
    .from(OPENS).select('id')
    .eq('user_id', row.user_id).eq('plan_kind', row.plan_kind).eq('plan_ref', row.plan_ref)
    .eq('source', 'viewer')
    .neq('id', row.id)
    .lt('opened_at', row.opened_at));
  if (earlier) return 'earlier_open';

  const delivered = row.plan_kind === 'k5'
    ? await firstRow(supabase
      .from('niete_lp_downloads').select('id')
      .eq('user_id', row.user_id).eq('lesson_id', row.plan_ref).eq('status', 'sent'))
    : await firstRow(supabase
      .from('niete_lp612_deliveries').select('id')
      .eq('user_id', row.user_id).eq('segment_id', row.plan_ref).eq('surface', 'whatsapp'));
  return delivered ? 'delivered_on_whatsapp' : null;
}

/** Claim "this open is handled". False = it already was. Fails OPEN: the guards above still apply. */
async function claimOpen(openId) {
  try {
    if (typeof redisService.setNX !== 'function') return true;
    return (await redisService.setNX(REDIS_HANDLED_KEY(openId), { at: Date.now() }, HANDLED_TTL_SECS)) !== false;
  } catch (err) {
    logToFile('LP app-open survey: handled-claim unavailable — continuing', { openId, error: err.message });
    return true;
  }
}

async function windowIsOpen(phone) {
  const QuizDelivery = require('./quiz/quiz-delivery.service');
  return QuizDelivery._hasOpenMessageWindow(phone);
}

/**
 * She read plan <open row> in the app: ask her the survey, if the guards pass.
 * Never throws. Resolves { outcome: 'scheduled' } or { outcome: 'skipped', reason }.
 *
 * @param {{ openId: string }} p  the niete_lp_opens row the portal just recorded
 */
async function onViewerOpen({ openId } = {}) {
  const ids = { openId: openId || null };
  try {
    if (!openId || typeof openId !== 'string') return skip('open_not_found', ids);

    const { data: row, error: rowError } = await supabase
      .from(OPENS).select('id, user_id, plan_kind, plan_ref, lang, source, opened_at')
      .eq('id', openId).maybeSingle();
    if (rowError) throw new Error(rowError.message);
    if (!row) return skip('open_not_found', ids);

    const at = { ...ids, userId: row.user_id, kind: row.plan_kind, ref: row.plan_ref };
    if (row.source !== 'viewer') return skip('not_viewer_open', at);
    if (!(await claimOpen(openId))) return skip('already_handled', at);

    const { data: user, error: userError } = await supabase
      .from('users').select('id, phone_number, preferred_language').eq('id', row.user_id).maybeSingle();
    if (userError) throw new Error(userError.message);
    if (!user || !user.phone_number) return skip('no_phone', at);

    const chance = await alreadyHadItsChance(row);
    if (chance) return skip(chance, at);

    if (!(await windowIsOpen(user.phone_number))) return skip('window_closed', at);

    if (row.plan_kind === 'k5') {
      const V8Catalog = require('./lp-v8-catalog.service');
      const Delivery = require('./lp-v8-delivery.service');
      const LpFeedback = require('./lp-feedback.service');

      const hit = V8Catalog.lessonById(row.plan_ref);
      if (!hit) return skip('unknown_plan', at);
      const { lesson, chapter, book } = hit;

      // Provenance only — which version of the lesson she can read. A lookup that fails must not
      // cost her the survey, so it is allowed to be absent.
      let asset = null;
      try { asset = await Delivery.currentAssetFor(row.plan_ref); } catch (_) { /* provenance only */ }

      // The portal ask that served this plan (LP_LIFECYCLE_PATHS on), so the survey's plan row leads
      // back to the ask and its timeline. Null leaves the row exactly as it was.
      const requestId = await require('./lp-v8-lifecycle.service').portalAskFor({
        userId: user.id, lessonId: row.plan_ref, openedAt: row.opened_at,
      });
      const lessonPlanId = await Delivery.recordLessonPlanRow({
        userId: user.id, lessonId: row.plan_ref, hit, asset, voicenoteSent: false, surface: 'app', requestId,
      });
      if (!lessonPlanId) {
        logToFile('LP app-open survey: no lesson_plans row, survey not scheduled', at, 'error');
        return skip('no_anchor', at);
      }

      // The same context a WhatsApp delivery hands the survey (lp-v8-delivery), field for field.
      LpFeedback.scheduleFeedbackPrompt({
        lessonPlanId,
        userId: user.id,
        phone: user.phone_number,
        context: {
          grade: book.grade,
          subject: book.subject_key,
          chapterNumber: chapter.number,
          segmentNumber: lesson.segment_index,
          topic: lesson.topic_short || lesson.topic,
          lpVariant: Delivery.LP_VARIANT,
          triggerMode: 'after_pdf_only',
          // Her stored preference; the survey service resolves it again at send time and owns the floor.
          language: user.preferred_language,
          lessonKey: row.plan_ref,
        },
      });
    } else {
      const Lp612Feedback = require('./lp612-feedback.service');
      // The DOCUMENT's language is what she read; a null (an open recorded without one) falls back
      // to her own, which is the survey service's own fallback for the same case.
      Lp612Feedback.scheduleFeedbackPrompt({
        segmentId: row.plan_ref,
        userId: user.id,
        phone: user.phone_number,
        lang: row.lang || user.preferred_language,
        renderId: null,
      });
    }

    logEvent('lp.app_open_survey', { outcome: 'scheduled', ...at });
    return { outcome: 'scheduled' };
  } catch (err) {
    // A guard or a read that could not be answered: ask nobody, and say so where the monitor looks.
    logToFile('❌ LP app-open survey: could not decide — not asked', { ...ids, error: err && err.message }, 'error');
    return skip('guard_unavailable', { ...ids, error: err && err.message });
  }
}

module.exports = { onViewerOpen, HANDLED_TTL_SECS, REDIS_HANDLED_KEY };
