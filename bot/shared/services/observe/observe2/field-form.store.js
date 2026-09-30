'use strict';

/**
 * /observe2 — the one reader and writer of `observation_field_forms` (one row per coach visit).
 *
 * The rules that matter live here, not in the callers:
 * - Parts are saved only while the record is unsealed (every write filters sealed_at IS NULL).
 * - The seal is a compare-and-set: the first "Seal and send" wins; a second tap finds it sealed.
 *   The database also refuses any change to what was sealed (trigger, migration V1.5.7).
 * - A recording links to a form once (coaching_session_id IS NULL filter).
 * - The check is submitted once (checked_at IS NULL filter).
 * Every Supabase error is logged at 'error' and returned, never swallowed as "no row".
 */

const supabase = require('../../../config/supabase');
const { logToFile } = require('../../../utils/logger');

const TABLE = 'observation_field_forms';
const RUBRIC_VERSION = 'fico-ict-17-2026-09';
// How long after Start a recording may still attach to the coach's open form.
const LINK_WINDOW_HOURS = 6;

const PART_KEYS = {
  p1: ['present', 'p1_spoke', 'p1_picked', 'p1_groups', 'p1_listen', 'p1_listen_other', 'p1_materials', 'p1_change', 'p1_change_how', 'p1_notes'],
  p2: ['p2_spoke', 'p2_new', 'p2_picked', 'p2_groups', 'p2_listen', 'p2_listen_other', 'p2_materials', 'p2_change', 'p2_change_how', 'p2_notes'],
  seal: ['incident', 'detail', 'note', 'lp', 'priority'],
};

// Keep only the fields a screen owns; drop empty strings for fields the coach left blank.
function pick(answers, keys) {
  const out = {};
  for (const k of keys) {
    const v = (answers || {})[k];
    if (v === undefined || v === null || v === '') continue;
    out[k] = Array.isArray(v) ? v.map(String) : String(v);
  }
  return out;
}

function fail(where, error, extra) {
  logToFile(`[observe2] ${where} failed`, { ...extra, error: error && (error.message || String(error)) }, 'error');
  return { ok: false, error: error && (error.message || String(error)) };
}

async function createForm({ observerUserId, teacherUserId = null, visitContext = {} }) {
  const { data, error } = await supabase.from('observation_field_forms')
    .insert({
      observer_user_id: observerUserId,
      teacher_user_id: teacherUserId,
      visit_context: visitContext,
      rubric_version: RUBRIC_VERSION,
    })
    .select('*')
    .single();
  if (error) return fail('createForm', error, { observerUserId });
  return { ok: true, form: data };
}

async function getForm(id) {
  const { data, error } = await supabase.from('observation_field_forms').select('*').eq('id', id).maybeSingle();
  if (error) return fail('getForm', error, { id });
  return { ok: true, form: data || null };
}

async function setPeriod(id, minutes) {
  const m = Number(minutes);
  if (!Number.isInteger(m) || m < 20 || m > 90) return { ok: false, error: 'period out of range' };
  const { data, error } = await supabase.from('observation_field_forms')
    .update({ period_minutes: m }).eq('id', id).is('sealed_at', null).select('id');
  if (error) return fail('setPeriod', error, { id });
  return { ok: (data || []).length === 1 };
}

async function markOpened(id) {
  const { error } = await supabase.from('observation_field_forms')
    .update({ opened_at: new Date().toISOString() }).eq('id', id).is('opened_at', null);
  if (error) return fail('markOpened', error, { id });
  return { ok: true };
}

// Save one part. `current` is the row as read by the caller (answers merge on top of it).
async function savePart(current, part, answers) {
  if (!current || current.sealed_at) return { ok: false, sealed: Boolean(current && current.sealed_at) };
  const merged = { ...(current.answers || {}), ...pick(answers, PART_KEYS[part]) };
  const stamp = part === 'p1' ? 'part1_done_at' : 'part2_done_at';
  const patch = { answers: merged };
  if (!current[stamp]) patch[stamp] = new Date().toISOString();
  const { data, error } = await supabase.from('observation_field_forms')
    .update(patch).eq('id', current.id).is('sealed_at', null).select('*');
  if (error) return fail('savePart', error, { id: current.id, part });
  if (!(data || []).length) return { ok: false, sealed: true };
  return { ok: true, form: data[0] };
}

// The seal: merge the last screen's answers and stamp sealed_at, once.
async function seal(current, answers) {
  if (!current) return { ok: false, error: 'no form' };
  if (current.sealed_at) return { ok: false, alreadySealed: true, form: current };
  const merged = { ...(current.answers || {}), ...pick(answers, PART_KEYS.seal) };
  const { data, error } = await supabase.from('observation_field_forms')
    .update({ answers: merged, sealed_at: new Date().toISOString() })
    .eq('id', current.id).is('sealed_at', null).select('*');
  if (error) return fail('seal', error, { id: current.id });
  if (!(data || []).length) {
    const again = await getForm(current.id);
    return { ok: false, alreadySealed: true, form: again.form || current };
  }
  return { ok: true, form: data[0] };
}

async function setPhotos(id, photos) {
  const { error } = await supabase.from('observation_field_forms').update({ photos }).eq('id', id);
  if (error) return fail('setPhotos', error, { id });
  return { ok: true };
}

// The coach's most recent form that has no recording yet, started within the link window.
async function findOpenFormForCapture(observerUserId, now = Date.now()) {
  const since = new Date(now - LINK_WINDOW_HOURS * 3600 * 1000).toISOString();
  const { data, error } = await supabase.from('observation_field_forms')
    .select('*')
    .eq('observer_user_id', observerUserId)
    .is('coaching_session_id', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return fail('findOpenFormForCapture', error, { observerUserId });
  return { ok: true, form: (data || [])[0] || null };
}

async function linkSession(id, sessionId) {
  const { data, error } = await supabase.from('observation_field_forms')
    .update({ coaching_session_id: sessionId }).eq('id', id).is('coaching_session_id', null).select('id');
  if (error) return fail('linkSession', error, { id, sessionId });
  return { ok: (data || []).length === 1 };
}

async function findBySession(sessionId) {
  const { data, error } = await supabase.from('observation_field_forms').select('*').eq('coaching_session_id', sessionId).maybeSingle();
  if (error) return fail('findBySession', error, { sessionId });
  return { ok: true, form: data || null };
}

async function setMoments(id, moments, levels) {
  const { error } = await supabase.from('observation_field_forms')
    .update({ rumi_moments: moments, rumi_levels: levels, moments_ready_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return fail('setMoments', error, { id });
  return { ok: true };
}

// One screen of the check at a time; later screens add to what earlier ones saved.
async function saveReview(current, patch) {
  if (!current || current.checked_at) return { ok: false, checked: Boolean(current && current.checked_at) };
  const merged = { ...(current.evidence_review || {}), ...patch };
  const { data, error } = await supabase.from('observation_field_forms')
    .update({ evidence_review: merged }).eq('id', current.id).is('checked_at', null).select('*');
  if (error) return fail('saveReview', error, { id: current.id });
  if (!(data || []).length) return { ok: false, checked: true };
  return { ok: true, form: data[0] };
}

async function markChecked(current, finalLevels, patch) {
  if (!current || current.checked_at) return { ok: false, alreadyChecked: true };
  const merged = { ...(current.evidence_review || {}), ...(patch || {}) };
  const { data, error } = await supabase.from('observation_field_forms')
    .update({ evidence_review: merged, final_levels: finalLevels, checked_at: new Date().toISOString() })
    .eq('id', current.id).is('checked_at', null).select('*');
  if (error) return fail('markChecked', error, { id: current.id });
  if (!(data || []).length) return { ok: false, alreadyChecked: true };
  return { ok: true, form: data[0] };
}

module.exports = {
  TABLE, RUBRIC_VERSION, LINK_WINDOW_HOURS, PART_KEYS, pick,
  createForm, getForm, setPeriod, markOpened, savePart, seal, setPhotos,
  findOpenFormForCapture, linkSession, findBySession, setMoments, saveReview, markChecked,
};
