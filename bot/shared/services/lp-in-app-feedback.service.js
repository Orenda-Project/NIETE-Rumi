// KNOWN DESIGN DEBT (Nov 2026): lesson plans are spread over ~20 tables, one set per product generation
// (K-5 v8/v9, 6-12, GB, legacy). Do NOT add another per-region or per-generation LP table, cache or env
// flag: extend the existing table with the book as the separator, say so in the PR, and ask the operator
// before any new LP table.
// Why, target model, follow-up (audit planned): docs/lesson-plan-data-model-debt.md
'use strict';
/**
 * The lesson-plan survey ("was this plan useful?") answered INSIDE the teacher app: the bar at the end of the plan
 * viewer. The portal asks through POST /api/internal/lp/feedback (the portal cannot load bot code); the user id is
 * always the portal session's, never the teacher's word.
 *
 * ONE ROW PER TEACHER PER PLAN, in the table the WhatsApp survey writes (lp_feedback), so every reader of that table
 * (the daily plan-quality panel, the A/B reads) counts it with no change:
 *   first tap    Useful / Not useful → INSERT, trigger_mode 'in_app', useful_component 'lp_only' (no voice note here).
 *   In class     → UPDATE used_in_class on that row (only after Useful, only once).
 *   the reason   → UPDATE reason_text / reason_received_at / reason_language / reason_polarity 'disliked' on that row
 *                  (only after Not useful, only once).
 *   anything else for a plan that already has a row (from the app OR from WhatsApp) → `already_answered`, the row's
 *   state, nothing written. A Useful is never turned into a Not useful here.
 *
 * THE BAND RULE (the same as the app-open survey's): grades 1-5 → lesson_plan_id, on a lesson_plans row recorded with
 * surface 'app' by the delivery path's own writer; grades 6-12 → lp612_segment_id. A grades 1-5 catalogue lesson id
 * that arrives as 'g612' (her own and shelf plans come through the 6-12 routes) is a grades 1-5 plan.
 *
 * Logs carry ids only (user, kind, plan ref, the answer), never the reason's words.
 */

const supabase = require('../config/supabase');
const { logEvent } = require('../utils/structured-logger');
const { withBand } = require('./lp-app-open-survey.service');

const KINDS = ['k5', 'g612'];
const USED_IN_CLASS = ['taught', 'planned', 'not_yet'];
const REASON_MAX = 300;
const REF_MAX = 200;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URDU_SCRIPT_RX = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

/**
 * The request, checked: { userId, kind, ref, lang, useful, usedInClass, reasonText } with null for an absent answer,
 * or null when anything is wrong (a non-uuid user, an unknown kind, no plan, no answer, a bad value, a reason over 300).
 */
function parse(body) {
  const b = body && typeof body === 'object' ? body : {};
  const userId = typeof b.userId === 'string' ? b.userId.trim() : '';
  const ref = typeof b.ref === 'string' ? b.ref.trim() : '';
  if (!UUID_RX.test(userId) || !KINDS.includes(b.kind) || !ref || ref.length > REF_MAX) return null;
  if (b.useful !== undefined && typeof b.useful !== 'boolean') return null;
  if (b.usedInClass !== undefined && !USED_IN_CLASS.includes(b.usedInClass)) return null;
  let reasonText = null;
  if (b.reasonText !== undefined) {
    if (typeof b.reasonText !== 'string') return null;
    reasonText = b.reasonText.trim();
    if (!reasonText || reasonText.length > REASON_MAX) return null;
  }
  const useful = typeof b.useful === 'boolean' ? b.useful : null;
  const usedInClass = b.usedInClass || null;
  if (useful === null && !usedInClass && !reasonText) return null;
  const lang = b.lang === 'en' || b.lang === 'ur' ? b.lang : null;
  return { userId, kind: b.kind, ref, lang, useful, usedInClass, reasonText };
}

const bandOf = (kind, ref) => withBand({ plan_kind: kind, plan_ref: ref }).plan_kind;

function must({ data, error }) {
  if (error) throw new Error(error.message || 'lp_feedback read failed');
  return data || [];
}

/** Her newest row for this plan (from the app or from WhatsApp), or null. Throws when the database cannot answer. */
async function findRow(userId, band, ref) {
  const cols = 'id, useful, used_in_class, reason_text, created_at';
  if (band === 'k5') {
    const plans = must(await supabase.from('lesson_plans').select('id')
      .eq('user_id', userId).eq('content->v8->>lesson_id', ref));
    if (!plans.length) return null;
    const rows = must(await supabase.from('lp_feedback').select(cols)
      .eq('user_id', userId).in('lesson_plan_id', plans.map((p) => p.id))
      .order('created_at', { ascending: false }).limit(1));
    return rows[0] || null;
  }
  const rows = must(await supabase.from('lp_feedback').select(cols)
    .eq('user_id', userId).eq('lp612_segment_id', ref)
    .order('created_at', { ascending: false }).limit(1));
  return rows[0] || null;
}

const stateOf = (row) => (row ? { useful: row.useful === true, usedInClass: row.used_in_class || null } : null);

/** Whether she has answered this plan: null, or { useful, usedInClass }. Throws when the database cannot answer. */
async function state({ userId, kind, ref }) {
  return stateOf(await findRow(userId, bandOf(kind, ref), ref));
}

function reasonFields(text) {
  return {
    reason_text: text,
    reason_received_at: new Date().toISOString(),
    reason_language: URDU_SCRIPT_RX.test(text) ? 'ur' : 'en',
    reason_polarity: 'disliked',
  };
}

/** The columns a grades 1-5 row snapshots, with its lesson_plans anchor; null when the catalogue does not know it. */
async function k5Columns(userId, ref) {
  const hit = require('./lp-v8-catalog.service').lessonById(ref);
  if (!hit) return null;
  const Delivery = require('./lp-v8-delivery.service');
  let asset = null;
  try { asset = await Delivery.currentAssetFor(ref); } catch (_) { /* provenance only */ }
  const lessonPlanId = await Delivery.recordLessonPlanRow({
    userId, lessonId: ref, hit, asset, voicenoteSent: false, surface: 'app',
  });
  if (!lessonPlanId) throw new Error('no lesson_plans row');
  const { lesson, chapter, book } = hit;
  return {
    lesson_plan_id: lessonPlanId,
    lp_variant: Delivery.LP_VARIANT,
    grade: book.grade,
    subject: book.subject_key,
    chapter_number: chapter.number,
    segment_number: lesson.segment_index,
    topic: lesson.topic_short || lesson.topic,
  };
}

/** The columns a grades 6-12 row snapshots (as the WhatsApp tap does); null for an unknown segment. */
async function g612Columns(ref, lang) {
    const { data: segment, error } = await supabase.from('niete_lp612_segments')
    .select('segment_id, grade, subject, curriculum, chapter_number, subtopic_title, menu_title')
    .eq('segment_id', ref).maybeSingle();
  if (error) throw new Error(error.message || 'segment read failed');
  if (!segment) return null;
  const { variantOf } = require('./lp612-feedback-taps.service');
  return {
    lp612_segment_id: ref,
    lp_variant: await variantOf(segment, lang || 'en'),
    grade: segment.grade,
    subject: segment.subject,
    chapter_number: segment.chapter_number,
    topic: segment.subtopic_title || segment.menu_title,
  };
}

/**
 * Save one answer from the bar. Resolves { outcome, feedback? }:
 *   saved             inserted (first tap) or updated (In class / reason); `feedback` is the row's state now
 *   already_answered  the plan already has her answer; nothing written; `feedback` is its state
 *   no_answer         an In class / reason with no first tap to hang it on; nothing written
 *   unknown_plan      the catalogue does not know the plan; nothing written
 * Throws when the database cannot answer (the route says 500, the bar "Not saved").
 */
async function save(p) {
  const band = bandOf(p.kind, p.ref);
  const ids = { userId: p.userId, kind: band, ref: p.ref };
  const done = (outcome, extra = {}) => {
    logEvent('lp.in_app_feedback', {
      outcome, ...ids, useful: p.useful, usedInClass: p.usedInClass, reason: !!p.reasonText, ...extra,
    });
    return outcome;
  };
  const row = await findRow(p.userId, band, p.ref);

  if (!row) {
    if (p.useful === null) return { outcome: done('no_answer') };
    const cols = band === 'k5' ? await k5Columns(p.userId, p.ref) : await g612Columns(p.ref, p.lang);
    if (!cols) return { outcome: done('unknown_plan') };
    const insert = {
      user_id: p.userId,
      ...cols,
      useful: p.useful,
      trigger_mode: 'in_app',
      useful_component: 'lp_only',
      ...(p.useful && p.usedInClass ? { used_in_class: p.usedInClass } : {}),
      ...(!p.useful && p.reasonText ? reasonFields(p.reasonText) : {}),
    };
    const { data, error } = await supabase.from('lp_feedback').insert(insert).select('id').single();
    if (error || !data) throw new Error((error && error.message) || 'lp_feedback insert returned no row');
    done('saved', { feedbackId: data.id });
    return { outcome: 'saved', feedback: { useful: p.useful, usedInClass: insert.used_in_class || null } };
  }

  const update = {};
  if (p.useful === null && p.usedInClass && row.useful === true && !row.used_in_class) update.used_in_class = p.usedInClass;
  if (p.useful === null && p.reasonText && row.useful === false && !row.reason_text) Object.assign(update, reasonFields(p.reasonText));
  if (!Object.keys(update).length) {
    done('already_answered', { feedbackId: row.id });
    return { outcome: 'already_answered', feedback: stateOf(row) };
  }
  const { error } = await supabase.from('lp_feedback').update(update).eq('id', row.id).eq('user_id', p.userId);
  if (error) throw new Error(error.message || 'lp_feedback update failed');
  done('saved', { feedbackId: row.id });
  return { outcome: 'saved', feedback: stateOf({ ...row, ...update }) };
}

module.exports = { parse, state, save, REASON_MAX, USED_IN_CLASS };
