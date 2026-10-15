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
  // Part 2 as it is since form version 5 (the children working on their own), and as forms still on the
  // older Flow send it.
  p2: ['p2_spoke', 'p2_new', 'p2_task', 'p2_teacher', 'p2_stuck', 'p2_change', 'p2_change_how', 'p2_notes',
    'p2_picked', 'p2_groups', 'p2_listen', 'p2_listen_other', 'p2_materials'],
  plan: ['lp', 'lp_pick', 'lp_how'],
  seal: ['incident', 'detail', 'note', 'priority', 'also_1', 'also_2'],
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

// The lesson plan, before the seal. `lpRef` carries the keys the fidelity grader resolves the plan's
// moves by (lesson_id, version_stamp, content_hash), or null when no plan from the list was picked.
// Saving it again (the coach went back and changed it) replaces the earlier pick.
async function savePlan(current, answers, lpRef) {
  if (!current || current.sealed_at) return { ok: false, sealed: Boolean(current && current.sealed_at) };
  const merged = { ...(current.answers || {}), ...pick(answers, PART_KEYS.plan) };
  const given = pick(answers, ['lp_pick', 'lp_how']);
  if (!given.lp_pick) delete merged.lp_pick;
  if (given.lp_pick !== 'upload' || !given.lp_how) delete merged.lp_how;
  if (lpRef) merged.lp_ref = lpRef; else delete merged.lp_ref;
  // Whatever was added before is replaced by the next screen's, or dropped with a listed pick.
  delete merged.lp_upload;
  return writePlan(current, merged, 'savePlan');
}

// The plan added on LP_PHOTOS / LP_FILE / LP_TEXT: what was sent and where its files go. Before the seal only.
async function saveUpload(current, lpUpload) {
  if (!current || current.sealed_at) return { ok: false, sealed: Boolean(current && current.sealed_at) };
  return writePlan(current, { ...(current.answers || {}), lp_upload: lpUpload }, 'saveUpload');
}

// The photo step, before the seal: how the photos were added and how many (or none).
async function savePhotoChoice(current, choice) {
  if (!current || current.sealed_at) return { ok: false, sealed: Boolean(current && current.sealed_at) };
  const merged = { ...(current.answers || {}), photo_how: String(choice.photo_how) };
  if (choice.photo_count != null) merged.photo_count = Number(choice.photo_count); else delete merged.photo_count;
  return writePlan(current, merged, 'savePhotoChoice');
}

async function writePlan(current, merged, label) {
  const { data, error } = await supabase.from('observation_field_forms')
    .update({ answers: merged }).eq('id', current.id).is('sealed_at', null).select('*');
  if (error) return fail(label, error, { id: current.id });
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

// A form made at capture for a recording that came with no form waiting (record first, fill the
// form afterwards). It exists for that one recording only.
function isHeld(form) {
  return Boolean(form && form.visit_context && form.visit_context.recorded_first);
}

// The coach's most recent form that has no recording yet, started within the link window. It runs
// on every unarmed leader audio, so it reads only what the link and the capture need. A held form is
// never offered: one that lost its recording (refused as a duplicate) would otherwise catch the
// coach's next recording, for a teacher it does not name.
const CAPTURE_COLUMNS = 'id, observer_user_id, teacher_user_id, visit_context, sealed_at, coaching_session_id, created_at';
const CAPTURE_CANDIDATES = 5;
async function findOpenFormForCapture(observerUserId, now = Date.now()) {
  const since = new Date(now - LINK_WINDOW_HOURS * 3600 * 1000).toISOString();
  const { data, error } = await supabase.from('observation_field_forms')
    .select(CAPTURE_COLUMNS)
    .eq('observer_user_id', observerUserId)
    .is('coaching_session_id', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(CAPTURE_CANDIDATES);
  if (error) return fail('findOpenFormForCapture', error, { observerUserId });
  return { ok: true, form: (data || []).find((f) => !isHeld(f)) || null };
}

// The coach's newest form, whatever its state: half of "was the latest observation an /observe2 one?".
async function latestFormOf(observerUserId) {
  const { data, error } = await supabase.from('observation_field_forms')
    .select('id, created_at, coaching_session_id')
    .eq('observer_user_id', observerUserId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return fail('latestFormOf', error, { observerUserId });
  return { ok: true, form: (data || [])[0] || null };
}

// The teacher named after the recording ("who did you observe?"), on a form that names none yet. The
// first answer stands. A sealed form takes it too: the seal locks the answers, not who was observed.
async function nameTeacher(current, teacherUserId, visitContextPatch = {}) {
  if (!current || !teacherUserId) return { ok: false };
  const visitContext = { ...(current.visit_context || {}), ...visitContextPatch };
  const { data, error } = await supabase.from('observation_field_forms')
    .update({ teacher_user_id: teacherUserId, visit_context: visitContext })
    .eq('id', current.id).is('teacher_user_id', null).select('*');
  if (error) return fail('nameTeacher', error, { id: current.id });
  if (!(data || []).length) return { ok: false, named: true };
  return { ok: true, form: data[0] };
}

async function linkSession(id, sessionId) {
  const { data, error } = await supabase.from('observation_field_forms')
    .update({ coaching_session_id: sessionId }).eq('id', id).is('coaching_session_id', null).select('id');
  if (error) return fail('linkSession', error, { id, sessionId });
  return { ok: (data || []).length === 1 };
}

// A recording refused after it was linked (the worker's duplicate check): the form waits again. Only
// the link written for that session is undone.
async function unlinkSession(sessionId) {
  const { data, error } = await supabase.from('observation_field_forms')
    .update({ coaching_session_id: null }).eq('coaching_session_id', sessionId).select('id, created_at, visit_context');
  if (error) return fail('unlinkSession', error, { sessionId });
  const row = (data || [])[0] || {};
  return { ok: true, formId: row.id || null, createdAt: row.created_at || null, held: isHeld(row) };
}

async function findBySession(sessionId, columns = '*') {
  const { data, error } = await supabase.from('observation_field_forms').select(columns).eq('coaching_session_id', sessionId).maybeSingle();
  if (error) return fail('findBySession', error, { sessionId });
  return { ok: true, form: data || null };
}

// The forms of several sessions in one read (the worklist): only whether each is sealed, and held.
async function formsForSessions(sessionIds) {
  if (!sessionIds.length) return { ok: true, forms: [] };
  const { data, error } = await supabase.from('observation_field_forms')
    .select('id, coaching_session_id, sealed_at, visit_context').in('coaching_session_id', sessionIds);
  if (error) return fail('formsForSessions', error, { sessions: sessionIds.length });
  return { ok: true, forms: data || [] };
}

async function setMoments(id, moments, levels) {
  const { error } = await supabase.from('observation_field_forms')
    .update({ rumi_moments: moments, rumi_levels: levels, moments_ready_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return fail('setMoments', error, { id });
  return { ok: true };
}

// The moments' record rewritten whole (the plan graded at the seal for a recording that came first).
async function setRumiMoments(id, moments) {
  const { error } = await supabase.from('observation_field_forms').update({ rumi_moments: moments }).eq('id', id);
  if (error) return fail('setRumiMoments', error, { id });
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
  TABLE, RUBRIC_VERSION, LINK_WINDOW_HOURS, PART_KEYS, pick, isHeld,
  createForm, getForm, setPeriod, markOpened, savePart, savePlan, saveUpload, savePhotoChoice, seal, setPhotos,
  findOpenFormForCapture, latestFormOf, nameTeacher, linkSession, unlinkSession, findBySession, formsForSessions,
  setMoments, setRumiMoments, saveReview, markChecked,
};
