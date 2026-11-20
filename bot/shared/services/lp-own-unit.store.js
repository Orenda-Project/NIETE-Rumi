'use strict';
/**
 * bd-snkn32.59 (queue #165) — the reads and writes behind "A whole unit". Plain functions over a passed client (the
 * dashboard's), so the schema guards can read the `.from()` calls. Every read and write is scoped to her user_id.
 *
 *   unitOn(supabase, userId)  — portal_lp_own_unit is LIST-ONLY while it is tested: a JSON list of users.id names who
 *                               has it; true, "teachers", absent, anything else or a failed read = off.
 *   createUnitStore(supabase) — insert, list, get, update, dayPlans, latestPeriod (lp-own-unit.service's `store`).
 */

const UNIT_KEY = 'portal_lp_own_unit';
const TABLE = 'niete_lp_own_units';
const COLUMNS = 'id, user_id, class_id, book_stem, grade, subject, start_kind, chapter_from, chapter_to, period_minutes, pace, outline, status, created_at, updated_at';
const LIST_MAX = 50;

function listOf(v) {
  let x = v;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch (_) { return []; } }
  return Array.isArray(x) ? x : [];
}

/** Is "A whole unit" on for this user? Never throws. */
async function unitOn(supabase, userId) {
  if (typeof userId !== 'string' || !userId) return false;
  try {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', UNIT_KEY).maybeSingle();
    if (error || !data) return false;
    return listOf(data.value).includes(userId);
  } catch (_) {
    return false;
  }
}

const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

function createUnitStore(supabase) {
  const units = () => supabase.from(TABLE);

  async function insert(row) {
    return must(await units().insert(row).select(COLUMNS).single(), 'unit insert');
  }

  async function list(userId) {
    return must(await units().select(COLUMNS).eq('user_id', userId).is('deleted_at', null)
      .order('updated_at', { ascending: false }).limit(LIST_MAX), 'unit list') || [];
  }

  async function get(userId, id) {
    return must(await units().select(COLUMNS).eq('user_id', userId).eq('id', id).is('deleted_at', null).maybeSingle(), 'unit read');
  }

  async function update(userId, id, patch) {
    return must(await units().update({ ...patch, updated_at: new Date().toISOString() })
      .eq('user_id', userId).eq('id', id).select(COLUMNS).single(), 'unit update');
  }

  /** Her plans made for this unit's days (first makes only, not "Change this plan" rounds), as { id, status, day_no }. */
  async function dayPlans(userId, unitId) {
    const rows = must(await supabase.from('niete_lp612_own_plans')
      .select('id, status, answers, created_at')
      .eq('user_id', userId)
      .is('parent_own_id', null)
      .eq('answers->unit->>unit_id', unitId)
      .order('created_at', { ascending: false })
      .limit(200), 'unit day plans') || [];
    // newest first: a day remade after a failure shows its newest plan
    const seen = new Set();
    return rows.map((r) => ({ id: r.id, status: r.status, day_no: Number(r.answers && r.answers.unit && r.answers.unit.day_no) }))
      .filter((r) => (seen.has(r.day_no) ? false : seen.add(r.day_no)));
  }

  /** The period of her latest unit for this grade + subject ("saved for this class"), or null. */
  async function latestPeriod(userId, { grade, subject }) {
    const rows = must(await units().select('period_minutes').eq('user_id', userId).eq('grade', grade).eq('subject', subject)
      .is('deleted_at', null).order('updated_at', { ascending: false }).limit(1), 'unit period') || [];
    return rows.length ? rows[0].period_minutes : null;
  }

  return { insert, list, get, update, dayPlans, latestPeriod };
}

module.exports = { unitOn, createUnitStore, UNIT_KEY };
