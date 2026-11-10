'use strict';
/**
 * bd-snkn32.5 — "My own plans" on Lesson Plans home: her own Make my own plans across every lesson (not one chapter),
 * newest first, so the portal can open each one with the edit options from its home page — not only from inside
 * Make my own. Each entry is lp-own-mine's summary plus where it lives: a 6-12 plan by its segment row, a 1-5 plan by
 * its catalogue day. A plan whose lesson can no longer be placed is left out (it could not open).
 */
const { summarise, readRounds } = require('./lp-own-mine');

const RECENT = 20;

/** Pure: { grade, subject, chapter, title } joined onto a summary entry, or null when its lesson is unknown. */
function placeOf(p, { segs, lessonById }) {
  if (p.band === 'k5') {
    const hit = lessonById(p.lesson);
    if (!hit || !hit.book || !hit.chapter) return null;
    const l = hit.lesson || {};
    return { ...p, grade: Number(hit.book.grade), subject: hit.book.subject_key, chapter: String(hit.chapter.number), title: l.topic || l.section || '' };
  }
  const s = segs[p.lesson];
  if (!s) return null;
  return { ...p, grade: Number(s.grade), subject: s.subject, chapter: s.chapter_key, title: s.subtopic_title || s.menu_title || '' };
}

async function readRecentRoots(supabase, userId) {
  const { data, error } = await supabase
    .from('niete_lp612_own_plans')
    .select('id, parent_own_id, edit_round, status, segment_id, lesson_id, created_at')
    .eq('user_id', userId)
    .is('parent_own_id', null)
    .neq('status', 'failed')
    .order('created_at', { ascending: false })
    .limit(RECENT);
  if (error) throw new Error(error.message);
  return data || [];
}

async function readSegments(supabase, ids) {
  if (!ids.length) return {};
  const { data, error } = await supabase
    .from('niete_lp612_segments')
    .select('segment_id, grade, subject, chapter_key, menu_title, subtopic_title')
    .in('segment_id', ids);
  if (error) throw new Error(error.message);
  return Object.fromEntries((data || []).map((s) => [s.segment_id, s]));
}

async function listRecent(supabase, { userId }, { lessonById }) {
  if (!userId) return [];
  const roots = await readRecentRoots(supabase, userId);
  if (!roots.length) return [];
  const rounds = await readRounds(supabase, userId, roots.map((r) => r.id));
  const segs = await readSegments(supabase, [...new Set(roots.map((r) => r.segment_id).filter(Boolean))]);
  return summarise(roots, rounds).map((p) => placeOf(p, { segs, lessonById })).filter(Boolean);
}

module.exports = {
  placeOf, listRecent,
  listRecentLive: (args) => listRecent(require('../config/supabase'), args, {
    lessonById: (id) => require('./lp-v8-catalog.service').lessonById(id),
  }),
};
