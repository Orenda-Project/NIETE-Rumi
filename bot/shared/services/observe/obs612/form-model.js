'use strict';

/**
 * bd-ra8xu.40 — the FDE (obs612) form's merge and per-screen check, and Section 1's read-only rows: ONE copy for the
 * form's two doors, the WhatsApp Flow's endpoint (routes/obs612-endpoint.js) and the portal (obs612/portal.js). Moved
 * here from the endpoint unchanged, so the portal saves and refuses exactly as the Flow does.
 *
 * Pure: no I/O and no words. A check answers with a CODE per field, and each door says it in its own words (the Flow
 * in English on the screen, the portal from its en/ur copy):
 *   item       a scored item with no valid answer
 *   choice     a list with nothing (or something not on the list) chosen
 *   text       a required text left empty
 *   number     Class Size not a whole number
 *   row_two    the development plan's second row started but not finished
 *   same_area  the second development area is the first one again
 */

const O = require('../../coaching/frameworks/obs612');
const F = require('./flow');

const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const clip = (s, max) => [...s].slice(0, max).join('');

/**
 * The saved draft with one screen's posted values on top. A field the Flow did not post keeps what was saved; a
 * pre-filled field posted blank was cleared by the coach; a field never pre-filled (Class Size) posted blank keeps
 * what was saved.
 */
function mergeDraft(saved, fields, posted) {
  const out = { ...saved };
  for (const f of fields) {
    if (!Object.prototype.hasOwnProperty.call(posted, f.name)) continue;
    let v = posted[f.name] == null ? '' : String(posted[f.name]).trim();
    if (f.input === 'number' && /^\d+(\.0+)?$/.test(v)) v = String(parseInt(v, 10));
    if (v === '') {
      if (f.prefill) delete out[f.name];
      continue;
    }
    out[f.name] = f.max ? clip(v, f.max) : v;
  }
  return out;
}

/** One screen's problems, { field: code }, from the merged draft. */
function checkScreen(screenId, draft) {
  const errors = {};
  for (const f of F.fieldsOf(screenId)) {
    const v = draft[f.name];
    if (f.answer) {
      if (O.normAnswer(f.answer, v) === null) errors[f.name] = 'item';
      continue;
    }
    if (!has(v)) {
      if (f.required) errors[f.name] = f.options ? 'choice' : 'text';
      continue;
    }
    if (f.options && !f.options.some((o) => o.id === String(v))) errors[f.name] = 'choice';
    if (f.input === 'number' && !/^\d{1,4}$/.test(String(v))) errors[f.name] = 'number';
  }
  if (screenId === 'MSCI_PLAN') {
    const row2 = ['dp_area_2', 'dp_goal_2', 'dp_action_2'];
    if (row2.some((k) => has(draft[k]))) for (const k of row2) if (!has(draft[k]) && !errors[k]) errors[k] = 'row_two';
    if (has(draft.dp_area_2) && draft.dp_area_2 === draft.dp_area && !errors.dp_area_2) errors.dp_area_2 = 'same_area';
  }
  return errors;
}

/**
 * Section 1's read-only rows of the English & Urdu tool (FDE's labels): school, observer, teacher, grade, from the
 * visit (its names first) and the people on it. A value nobody holds is null.
 * @param {object} form    the observation_field_forms row
 * @param {number|null} grade
 * @param {Array<{id, name, school_name}>} people  the coach and the teacher (store.getPeople)
 */
function contextRows(form, grade, people = []) {
  const vc = (form && form.visit_context) || {};
  const coach = people.find((p) => p.id === form.observer_user_id) || {};
  const teacher = (form.teacher_user_id && people.find((p) => p.id === form.teacher_user_id)) || {};
  const values = {
    ctx_1: vc.school_name || teacher.school_name,
    ctx_2: coach.name,
    ctx_3: vc.teacher_name || teacher.name,
    ctx_4: grade,
  };
  return ['ctx_1', 'ctx_2', 'ctx_3', 'ctx_4'].map((key) => ({
    key,
    label: O.TOOLS.enur.context.find((c) => c.key === key).label,
    value: has(values[key]) ? String(values[key]).trim() : null,
  }));
}

module.exports = { has, mergeDraft, checkScreen, contextRows };
