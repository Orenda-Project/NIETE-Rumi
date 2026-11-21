'use strict';
/**
 * bd-ra8xu.43 — the rubric an observation was SCORED with, as a short id for debugging (operator, 11 Nov ~18:15: "in
 * very small font for every observation, show its rubric id aka FICO v6 or whatever for ease of debugging").
 *
 * Read from what was stored with the visit or session — never from the live switch, which may have changed since.
 * Pure and dependency-free, so the bot, the portal API and the Flow endpoints all print the same words.
 *
 * Order matters:
 *   1. /observe2 first: its sessions keep framework 'fico' with V3 domain keys, so their rubric is the observe2 stamp
 *      (analysis_data.observe2.rubric, or the visit's observation_field_forms.rubric_version).
 *   2. A FICO17 v6 analysis (framework or rubric 'fico17_v6').
 *   3. framework 'fico': V3 or V4 by shape (no version is stored; V4 has F9/F10 or a four-row Section C on 0-2).
 *   4. Any other framework by name. A self-recording scored in the background on v6 (analysis_data.shadow) is still
 *      labelled by what the teacher was scored and shown with.
 * The ids are technical names, the same in every language: they are not translated.
 */

const NAMES = { oecd: 'OECD', hots: 'HOTS', teach: 'TEACH', mewaka: 'MEWAKA' };
const V5_FORM_RUBRIC = 'fico-ict-17-2026-09';

// What is shown is the framework and its version only (operator 11 Nov ~18:45): no prompt version, hash, grade,
// subject or form name. The prompt version stays in the stored record for whoever needs it.
// FICO17 v6.1 (queue #218): the key stays 'fico17_v6'; a new observation is stamped rubric_version '6.1' (on its analysis,
// its coach review or its scores) and reads 'FICO17 v6.1'. One stored before has no version and keeps 'FICO17 v6'.
function v6VersionOf(a) {
  if (!a || typeof a !== 'object') return null;
  const review = a.fico17_v6_review && typeof a.fico17_v6_review === 'object' ? a.fico17_v6_review : null;
  const v = [a.rubric_version, review && review.rubric_version, a.scores && a.scores.rubric_version]
    .find((x) => typeof x === 'string' && /^6\.[1-9]\d*$/.test(x));
  return v || null;
}
function v6Label(a = null) {
  const v = v6VersionOf(a);
  return { id: 'fico17_v6', label: v ? `FICO17 v${v}` : 'FICO17 v6' };
}

// bd-pni007 — FDE's grade 6-12 observation tools: 'obs612-<tool>-v<n>' (msci, enur, gen), shown as 'FDE v<n>'. The id
// (which tool) stays in the result for debugging; the label is framework + version only, like FICO's.
const OBS612_RX = /^obs612-(gen|msci|enur)-v(\d+)$/;
// bd-31ziu8 — FICO-S ('fico_s_v<major>_<minor>', code name FICO-S v1.1), ICT's grade 6-12 rubric from 18 Nov, shown as
// 'FICO 6-12' (operator 18 Nov ~17:00: the name people see). Queue #218: v1.2 on, the version is shown ('FICO 6-12 v1.2'),
// so a v1.1 visit and a v1.2 one can be told apart; v1.1 keeps the name it always had.
const FICO_S_RX = /^fico_s_v(\d+)_(\d+)$/;
function obs612Label(id) {
  const s = FICO_S_RX.exec(String(id || ''));
  if (s) return { id, label: s[1] === '1' && s[2] === '1' ? 'FICO 6-12' : `FICO 6-12 v${s[1]}.${s[2]}` };
  const m = OBS612_RX.exec(String(id || ''));
  return m ? { id, label: `FDE v${m[2]}` } : null;
}

/** V3 or V4 under framework 'fico', by the shape the dashboard's instrument detector uses. */
function ficoVersion(a) {
  const domains = (a && a.domains) || {};
  const ids = new Set();
  let maxScore = null;
  for (const d of Object.values(domains)) {
    for (const ind of (d && Array.isArray(d.indicators) ? d.indicators : [])) {
      if (ind && ind.id) ids.add(ind.id);
      if (ind && typeof ind.score === 'number') maxScore = maxScore == null ? ind.score : Math.max(maxScore, ind.score);
    }
  }
  const hlp = domains.high_leverage_practices;
  const v4Shape = ids.has('F9') || ids.has('F10') || (hlp && Array.isArray(hlp.indicators) && hlp.indicators.length === 4);
  if (v4Shape && (maxScore == null || maxScore <= 2)) return { id: 'fico_v4', label: 'FICO V4' };
  return { id: 'fico_v3', label: 'FICO V3' };
}

/**
 * @param {{session?: object, analysis?: object, form?: object}} input
 *   session  a coaching_sessions row (framework, analysis_data)
 *   analysis its analysis_data, when the caller already has it
 *   form     an /observe2 visit (observation_field_forms row: rubric_version)
 * @returns {{id: string, label: string}|null}  null when nothing says which rubric
 */
function rubricLabelOf({ session = null, analysis = null, form = null } = {}) {
  const a = analysis || (session && session.analysis_data) || {};
  const o2 = (a && a.observe2) || null;

  // 0. An FDE (obs612) visit, by its form, its analysis or its session stamp (an /observe visit's session carries the
  //    stamp from the moment the recording lands, before the coach submits the form).
  const fde = obs612Label(form && form.rubric_version) || obs612Label(a && a.framework) || obs612Label(a && a.rubric)
    || obs612Label(session && session.framework);
  if (fde) return fde;

  // 1. /observe2: the visit's own stamp.
  const o2rubric = (o2 && o2.rubric) || null;
  const formRubric = (form && form.rubric_version) || (o2 && o2.rubric_version) || null;
  if (o2rubric === 'fico17_v6' || formRubric === 'fico17_v6') return v6Label();
  if (o2rubric === 'fico17' || formRubric === V5_FORM_RUBRIC) return { id: 'fico17', label: 'FICO17 v5' };

  const framework = String((a && a.framework) || (session && session.framework) || '').toLowerCase();

  // 2. FICO17 v6 (an /observe v6 visit, or a DC v6 report once the DC is switched).
  if (framework === 'fico17_v6' || (a && a.rubric === 'fico17_v6')) return v6Label(a);

  // 3. FICO V3 / V4.
  if (framework === 'fico') return ficoVersion(a);

  // 4. Everything else by name; an unknown framework is printed as stored rather than hidden.
  if (NAMES[framework]) return { id: framework, label: NAMES[framework] };
  // A framework this helper does not know yet is printed as stored, never hidden.
  if (framework) return { id: framework, label: framework.toUpperCase() };
  return null;
}

/** The label alone, or '' — what a caption prints. */
function rubricLabelText(input) {
  const r = rubricLabelOf(input);
  return r ? r.label : '';
}

module.exports = { rubricLabelOf, rubricLabelText };
