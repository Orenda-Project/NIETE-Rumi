'use strict';
/**
 * bd-snkn32.20 — "Your plans for this chapter": her own Make my own plans for the chapter's lessons, so she can
 * open one again and change it. One entry per plan she made (the root row): it opens the newest READY round and
 * says how many changes are left. Failed plans and other teachers' plans are never listed.
 */
const { changesLeft, bandOf, editBase } = require('./lp-own-edit-guard');

const KEY_RE = /^[A-Za-z0-9_.:-]{1,120}$/;
const MAX_KEYS = 60;

/** The lesson ids from the query string: only safe ids (they go inside a PostgREST `in.(…)`), at most 60. */
function cleanKeys(raw) {
  if (typeof raw !== 'string') return [];
  return raw.split(',').map((k) => k.trim()).filter((k) => KEY_RE.test(k)).slice(0, MAX_KEYS);
}

/** Pure: roots + their change rows → one entry per root plan, newest first. */
function summarise(roots, children) {
  return (roots || [])
    .filter((r) => r && r.status !== 'failed')
    .map((r) => {
      const chain = [r, ...(children || []).filter((c) => c && c.parent_own_id === r.id)];
      const open = editBase(chain) || r;
      return {
        ownId: open.id,
        rootId: r.id,
        lesson: r.segment_id || r.lesson_id,
        band: bandOf(r),
        status: r.status,
        changesLeft: changesLeft(chain),
        round: open.edit_round || 0,
        createdAt: r.created_at,
      };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** Her root plans for these lessons. (Plain functions: the schema guards read `.from()` calls written this way.) */
async function readRoots(supabase, userId, keys) {
  const list = keys.join(',');
  const { data, error } = await supabase
    .from('niete_lp612_own_plans')
    .select('id, parent_own_id, edit_round, status, segment_id, lesson_id, created_at')
    .eq('user_id', userId)
    .is('parent_own_id', null)
    .neq('status', 'failed')
    .or(`segment_id.in.(${list}),lesson_id.in.(${list})`)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data || [];
}

async function readRounds(supabase, userId, rootIds) {
  const { data, error } = await supabase
    .from('niete_lp612_own_plans')
    .select('id, parent_own_id, edit_round, status, segment_id, lesson_id, created_at')
    .eq('user_id', userId)
    .in('parent_own_id', rootIds);
  if (error) throw new Error(error.message);
  return data || [];
}

async function listMine(supabase, { userId, keys }) {
  if (!userId || !Array.isArray(keys) || !keys.length) return [];
  const roots = await readRoots(supabase, userId, keys);
  if (!roots.length) return [];
  const rounds = await readRounds(supabase, userId, roots.map((r) => r.id));
  return summarise(roots, rounds);
}

module.exports = {
  cleanKeys, summarise, listMine,
  listMineLive: (args) => listMine(require('../config/supabase'), args),
};
