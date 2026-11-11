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
 *   2. A FICO17 v6 analysis (framework or rubric 'fico17_v6'), with its prompt_version.
 *   3. framework 'fico': V3 or V4 by shape (no version is stored; V4 has F9/F10 or a four-row Section C on 0-2).
 *   4. Any other framework by name. A self-recording scored in the background on v6 (analysis_data.shadow) is still
 *      labelled by what the teacher was scored and shown with.
 * The ids are technical names, the same in every language: they are not translated.
 */

const NAMES = { oecd: 'OECD', hots: 'HOTS', teach: 'TEACH', mewaka: 'MEWAKA' };
const V5_FORM_RUBRIC = 'fico-ict-17-2026-09';

function v6Label(promptVersion) {
  return { id: 'fico17_v6', label: promptVersion ? `FICO17 v6 · ${promptVersion}` : 'FICO17 v6' };
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

  // 1. /observe2: the visit's own stamp.
  const o2rubric = (o2 && o2.rubric) || null;
  const formRubric = (form && form.rubric_version) || (o2 && o2.rubric_version) || null;
  if (o2rubric === 'fico17_v6' || formRubric === 'fico17_v6') return v6Label((o2 && o2.prompt_version) || null);
  if (o2rubric === 'fico17' || formRubric === V5_FORM_RUBRIC) return { id: 'fico17', label: 'FICO17 v5' };

  const framework = String((a && a.framework) || (session && session.framework) || '').toLowerCase();

  // 2. FICO17 v6 (an /observe v6 visit, or a DC v6 report once the DC is switched).
  if (framework === 'fico17_v6' || (a && a.rubric === 'fico17_v6')) return v6Label((a && a.prompt_version) || null);

  // 3. FICO V3 / V4.
  if (framework === 'fico') return ficoVersion(a);

  // 4. Everything else by name; an unknown framework is printed as stored rather than hidden.
  if (NAMES[framework]) return { id: framework, label: NAMES[framework] };
  if (framework) return { id: framework, label: framework.toUpperCase() };
  return null;
}

/** The label alone, or '' — what a caption prints. */
function rubricLabelText(input) {
  const r = rubricLabelOf(input);
  return r ? r.label : '';
}

module.exports = { rubricLabelOf, rubricLabelText };
