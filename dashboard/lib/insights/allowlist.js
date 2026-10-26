'use strict';
/**
 * The one reader of coaching_sessions.analysis_data (NIGHTLY_JOB §3; B1). It reads the allow-listed keys by name and
 * nothing else: no spread, no JSON.stringify, no iteration over a move's or the root's keys. `evidence` passes only
 * through EVIDENCE_STAMP and the string is dropped in the same expression. Never read: executive_summary,
 * report_narrative, voice_debrief_script, teacher_delivery, notable_moments, focus_area, strengths,
 * growth_opportunities, recommendations, observer_debrief, uptake, scores, indicators[].evidence(_summary).
 *
 * Output: { lp, fico, gloss }. `lp` and `fico` are structural (stored, hashed); `gloss` holds the text inputs the
 * gloss prompt may use (plan step text, translation, rationale, narrative): in memory only, never stored or logged.
 */

const EVIDENCE_STAMP = /^\[(\d{1,3}):([0-5]\d)\]/;
const CLOCK = /^(\d{1,3}):([0-5]\d)$/;

const has = (o, k) => o != null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const str = (v) => (typeof v === 'string' ? v : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v) => (v === true ? true : v === false ? false : null);

/** Seconds from the `[MM:SS]` prefix of a move's evidence (minutes may pass 59), else null. */
function stampOf(evidence) {
  const m = typeof evidence === 'string' ? EVIDENCE_STAMP.exec(evidence) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Seconds from an `MM:SS` clock (recording.ends_at, an indicator timestamp), else null. */
function clockToSeconds(v) {
  const m = typeof v === 'string' ? CLOCK.exec(v.trim()) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function readMove(mv) {
  const tot = mv.time_on_task;
  return {
    moveId: str(mv.move_id),
    phase: str(mv.phase),
    bucket: str(mv.bucket),
    verdict: str(mv.verdict),
    counted: mv.counted === true,
    credit: num(mv.credit),
    stampS: stampOf(mv.evidence),
    tot: tot && typeof tot === 'object'
      ? { assigned: bool(tot.assigned), workedMinutes: num(tot.worked_minutes), prescribedMinutes: num(tot.prescribed_minutes) }
      : null,
  };
}

function readLp(f) {
  if (!f || typeof f !== 'object') return null;
  const rec = f.recording && typeof f.recording === 'object' ? f.recording : null;
  const meta = f.meta && typeof f.meta === 'object' ? f.meta : null;
  const moves = Array.isArray(f.moves) ? f.moves : [];
  const out = [];
  for (let i = 0; i < moves.length; i += 1) {
    const mv = moves[i];
    if (mv && typeof mv === 'object') out.push(readMove(mv));
  }
  return {
    status: str(f.status),
    model: str(f.model),
    moderatorNote: f.moderators && typeof f.moderators === 'object' ? str(f.moderators.note) : null,
    // A missing key is false (NIGHTLY_JOB §4 stage 1), unlike the governed SQL's != 'true'.
    isUnusable: f.recording_unusable === true || f.recording_unusable === 'true',
    recording: rec ? {
      audioS: num(rec.audio_s),
      endsAtS: clockToSeconds(rec.ends_at),
      lastStampS: num(rec.last_stamp_s),
      noTimestamps: rec.no_timestamps === true,
      shortOfAudio: has(rec, 'transcript_short_of_audio') ? rec.transcript_short_of_audio === true : null,
    } : null,
    grade: meta ? str(meta.grade) || (num(meta.grade) != null ? String(meta.grade) : null) : null,
    subject: meta ? str(meta.subject) : null,
    moves: out,
  };
}

function readGloss(f) {
  const gloss = { narrative: null, moves: {} };
  if (!f || typeof f !== 'object') return gloss;
  gloss.narrative = str(f.narrative);
  const moves = Array.isArray(f.moves) ? f.moves : [];
  for (let i = 0; i < moves.length; i += 1) {
    const mv = moves[i];
    if (!mv || typeof mv !== 'object' || typeof mv.move_id !== 'string') continue;
    gloss.moves[mv.move_id] = { text: str(mv.text), evidenceTranslation: str(mv.evidence_translation), rationale: str(mv.rationale) };
  }
  return gloss;
}

function readIndicator(ind) {
  return {
    id: str(ind.id),
    score: num(ind.score),
    applicable: has(ind, 'applicable') ? bool(ind.applicable) : undefined,
    timestampS: clockToSeconds(ind.timestamp),
  };
}

function readFico(ad) {
  const domains = ad.domains && typeof ad.domains === 'object' ? ad.domains : null;
  const observe2 = ad.observe2 && typeof ad.observe2 === 'object' ? ad.observe2 : null;
  const out = {};
  if (domains) {
    for (const key of Object.keys(domains)) {
      const d = domains[key];
      if (!d || typeof d !== 'object') continue;
      const inds = Array.isArray(d.indicators) ? d.indicators : [];
      const list = [];
      for (let i = 0; i < inds.length; i += 1) if (inds[i] && typeof inds[i] === 'object') list.push(readIndicator(inds[i]));
      out[key] = { domainMax: num(d.domain_max), hasApplicableCount: has(d, 'indicators_applicable'), indicators: list };
    }
  }
  if (!domains && !observe2) return null;
  return {
    framework: str(ad.framework),
    subject: str(ad.subject),
    rubric: observe2 ? str(observe2.rubric) : null,
    domains: out,
  };
}

function readAllowed(analysisData) {
  if (!analysisData || typeof analysisData !== 'object') return { lp: null, fico: null, gloss: { narrative: null, moves: {} } };
  const f = analysisData.lp_fidelity;
  return { lp: readLp(f), fico: readFico(analysisData), gloss: readGloss(f) };
}

module.exports = { readAllowed, stampOf, clockToSeconds, EVIDENCE_STAMP };
