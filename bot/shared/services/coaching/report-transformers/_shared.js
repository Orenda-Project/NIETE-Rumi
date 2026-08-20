/**
 * Shared utilities for report data transformers.
 *
 * Bead: (Phase 1C-A2)
 */

const { logToFile } = require('../../../utils/logger');

/**
 * Format a date string to a readable format.
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted date (e.g., "March 4, 2026")
 */
function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Extract fidelity section from analysis if present.
 * @param {object} analysis - Enhanced analysis data
 * @returns {object|null} Fidelity section or null
 */
const FIDELITY_DONE = new Set(['executed', 'substituted_equivalent', 'substituted_better']);
const FIDELITY_PHASE_ORDER = ['warm_up', 'hook', 'recall', 'announce', 'explain', 'guided', 'independent', 'peer_review', 'exit', 'homework'];

// Map the MEASURED lp_fidelity blob (executed÷prescribed — the P3 engine, D20) to the report section:
// %, band, a phase bar (one status per phase), per-action verdicts, strengths (better substitutions) and
// gaps (not-done). Degrades safely: a partly-garbled/truncated recording shows "not assessed", never 0%.
function buildLpFidelitySection(lp) {
  const scored = (lp.moves || []).filter((m) => m.counted);
  const statusOf = (m) => (FIDELITY_DONE.has(m.verdict) ? 'done' : m.verdict === 'partial' ? 'partial' : 'missed');

  const byPhase = {};
  for (const m of scored) {
    const s = statusOf(m);
    if (!byPhase[m.phase]) byPhase[m.phase] = new Set();
    byPhase[m.phase].add(s);
  }
  const phaseBar = FIDELITY_PHASE_ORDER.filter((p) => byPhase[p]).map((p) => {
    const set = byPhase[p];
    const status = set.size === 1 ? [...set][0] : 'partial'; // mixed phase → partial
    return { phase: p, status };
  });

  const doneCount = scored.filter((m) => FIDELITY_DONE.has(m.verdict)).length;
  return {
    source: lp.source || null,
    score: lp.fidelity_pct,
    maxScore: 100,
    band: lp.band || null,
    coverage: lp.coverage != null ? lp.coverage : null,
    lowConfidence: !!lp.low_confidence,
    note: `${doneCount} of ${scored.length} prescribed actions delivered`,
    commentary: lp.narrative || '',
    phaseBar,
    perAction: scored.map((m) => ({ phase: m.phase, text: m.text, verdict: m.verdict, evidence: m.evidence || '' })),
    strengths: (lp.strengths || []).map((s) => s.text).filter(Boolean),
    gaps: scored.filter((m) => m.verdict === 'not_done').map((m) => m.text).filter(Boolean),
    notAssessed: lp.not_assessed || [],
    moderators: lp.moderators || null,
    timeOnTask: lp.time_on_task || null,
  };
}

function extractFidelity(analysis) {
  // Preferred: the measured LP-fidelity blob from the P3 engine (analysis_data.lp_fidelity).
  const lp = analysis.lp_fidelity;
  if (lp && lp.status) {
    if (lp.recording_unusable || (lp.status === 'ok' && lp.fidelity_pct == null)) {
      return { score: null, maxScore: 100, note: 'Lesson-plan fidelity was not assessed from this recording.', commentary: '', phaseBar: [], perAction: [], strengths: [], gaps: [] };
    }
    if (lp.status === 'ok') return buildLpFidelitySection(lp);
    return null; // lp_absent / fidelity_unavailable → no fidelity block
  }

  // Legacy fallback (pre-engine fidelity_analysis field).
  if (!analysis.fidelity_analysis) return null;
  return {
    score: analysis.fidelity_analysis.score || 0,
    maxScore: analysis.fidelity_analysis.max_score || 100,
    note: analysis.fidelity_analysis.note || 'Informational only',
    commentary: analysis.fidelity_analysis.overall_commentary || analysis.fidelity_analysis.note || '',
    evidence: analysis.fidelity_analysis.evidence || [],
    strengths: analysis.fidelity_analysis.strengths || [],
    gaps: analysis.fidelity_analysis.gaps || [],
  };
}

/**
 * Build partial report note from session flags.
 * @param {object} session - Session data
 * @returns {string|null} Partial note or null
 */
function buildPartialNote(session) {
  if (!session._isPartialReport) return null;

  const questionsCompleted = session._questionsAtCompletion || 0;

  if (session._isAutoCompleted) {
    return questionsCompleted > 0
      ? `Note: This report includes ${questionsCompleted}/3 reflective responses. The session was auto-completed after 12 hours of inactivity. Full insights require completing all reflection questions.`
      : `Note: This report is based on classroom audio analysis only. The reflective conversation was not completed (auto-completed after 12 hours of inactivity).`;
  }

  if (session._isUserRequestedEarly) {
    return questionsCompleted > 0
      ? `Note: This report includes ${questionsCompleted}/3 reflective responses. You requested early completion. Full insights require completing all reflection questions.`
      : `Note: This report is based on classroom audio analysis only. The reflective conversation was skipped at your request.`;
  }

  return null;
}

module.exports = { formatDate, extractFidelity, buildPartialNote };
