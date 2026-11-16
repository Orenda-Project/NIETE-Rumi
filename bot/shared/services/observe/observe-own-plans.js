'use strict';
/**
 * bd-snkn32.41 — the teacher's own "Make my own" plans on a coach's Check and send.
 *
 * "Their recent plans" read only the plans she DOWNLOADED (library.recent). The plans she made herself
 * (niete_lp612_own_plans, grades 1-5 by lesson_id, 6-12 by segment) were missing. Here they join that list,
 * labelled own, and a picked one ({ ownId }) resolves to her stored PDF (r2_key), which portal-observe writes
 * onto the observation as its plan file — the same lesson_plan_r2_key path an uploaded plan takes — so the
 * extraction worker reads it and Section B is scored from it.
 *
 * The listing is lp-own-recent's: her root plans (never failed), each opening its newest READY round. Only
 * a ready one is listed (a plan still being written has no PDF). Strictly her rows (by user id).
 */
const RECENT_CAP = 8; // the WhatsApp recent list's cap (recent-fidelity-lps), kept for the merged list
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** null when the pick is not an own-plan pick; { ownId } when it is; { bad: true } when it is malformed. */
function ownPick(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.ownId === undefined) return null;
  const keys = Object.keys(raw).filter((k) => raw[k] !== undefined);
  if (keys.length !== 1 || !UUID_RX.test(String(raw.ownId))) return { bad: true };
  return { ownId: raw.ownId };
}

/** Pure: an lp-own-recent entry → a row of the portal's recent list. */
function toPortalPlan(p) {
  return {
    own: true,
    ownId: p.ownId,
    lessonId: p.lesson || null,
    topic: p.title || null,
    grade: p.grade != null ? p.grade : null,
    subject: p.subject || null,
    chapterNumber: p.chapter != null ? p.chapter : null,
    madeAt: p.createdAt || null,
  };
}

const whenOf = (p) => String(p.downloadedAt || p.madeAt || '');

/** Pure: downloads + own plans, newest first, within the cap. */
function mergeRecent(downloads, own, cap = RECENT_CAP) {
  return [...(downloads || []), ...(own || [])]
    .sort((a, b) => whenOf(b).localeCompare(whenOf(a)))
    .slice(0, cap);
}

async function listForTeacher(userId, deps = {}) {
  if (!userId) return [];
  const listRecent = deps.listRecent
    || ((uid) => require('../lp-own-recent').listRecentLive({ userId: uid }));
  const rows = await listRecent(userId);
  return (rows || []).filter((p) => p && p.status === 'ready' && p.ownId).map(toPortalPlan);
}

/** Her ready plan's PDF key, or null (another teacher's, not ready, or gone). */
async function resolveKey({ userId, ownId }, deps = {}) {
  if (!userId || !ownId) return null;
  const supabase = deps.supabase || require('../../config/supabase');
  const { data, error } = await supabase
    .from('niete_lp612_own_plans')
    .select('r2_key')
    .eq('id', ownId)
    .eq('user_id', userId)
    .eq('status', 'ready')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data && data.r2_key) || null;
}

module.exports = {
  RECENT_CAP, ownPick, toPortalPlan, mergeRecent, listForTeacher, resolveKey,
  list: (userId) => listForTeacher(userId),
};
