'use strict';
/**
 * Stage 1, facts (NIGHTLY_JOB §4 stage 1; FICO_CROSSWALK §1). Pure functions over allow-list output
 * (allowlist.readAllowed): instrument detection by shape, population flags, the cause split, de-duplication,
 * lesson type, the input hash. No I/O.
 */
const crypto = require('crypto');
const C = require('./constants');
const { phaseOutcome } = require('./predicates');

// ── instrument detection (FICO_CROSSWALK rule 4, §1). fico17 first, then v4, v3, v2, v1; none → null.
// v4 is told by its ids (F9/F10, or four C indicators): prod v3 rows also carry `indicators_applicable`, and v4's
// teacher_subject_knowledge domain_max (applicable × 2, up to 20) overlaps v3's 20/24/28 (probe 26 Oct, m-insights).
function detectFicoInstrument(fico) {
  if (!fico) return null;
  if (fico.rubric === 'fico17') return 'fico17';
  const d = fico.domains || {};
  const ids = new Set();
  let maxScore = null;
  for (const key of Object.keys(d)) {
    for (const ind of d[key].indicators) {
      if (ind.id) ids.add(ind.id);
      if (ind.score != null) maxScore = maxScore == null ? ind.score : Math.max(maxScore, ind.score);
    }
  }
  const hlp = d.high_leverage_practices;
  const tsk = d.teacher_subject_knowledge;
  const v4Ids = ids.has('F9') || ids.has('F10') || (hlp && hlp.indicators.length === 4);
  if (v4Ids && (maxScore == null || maxScore <= 2)) return 'fico_v4';
  if (hlp && hlp.domainMax === 16) return 'fico_v1';
  if (tsk && [20, 24, 28].includes(tsk.domainMax)) return 'fico_v3';
  if (tsk) {
    const gated = tsk.indicators.filter((i) => ['F5', 'F6', 'F7'].includes(i.id));
    if (gated.some((i) => i.applicable !== undefined)) return 'fico_v3';
    if (tsk.domainMax === 32) return 'fico_v2';
  }
  return null;
}

// ── lesson type (S11). Literacy = Urdu or English; phonics through grade 3. Assumption recorded in REPORT.
const LITERACY = /^(urdu|english)(_|$)/;
function lessonType(subject, grade) {
  if (!subject) return null;
  const s = subject.toLowerCase();
  if (LITERACY.test(s)) return grade != null && grade <= 3 ? 'literacy_phonics' : 'literacy_text';
  if (/^math/.test(s)) return 'maths';
  return 'other';
}

function parseGrade(g) {
  const n = g != null && /^\d{1,2}$/.test(String(g).trim()) ? Number(g) : null;
  return n != null && n >= 1 && n <= 12 ? n : null;
}

// ── the cause split (WEAKNESS_MAP §A; NIGHTLY_JOB §4 stage 1).
const DONE_LIKE = ['executed', 'substituted_equivalent', 'substituted_better', 'partial'];

function prescribedIndependentMinutes(moves) {
  let total = null;
  for (const m of moves) {
    if (m.phase !== 'independent' || !m.counted || !m.tot || m.tot.prescribedMinutes == null) continue;
    total = (total || 0) + m.tot.prescribedMinutes;
  }
  return total;
}

function causeSplit(lp) {
  const empty = { last_done_s: null, last_stamp_s: null, is_short_of_audio: null, is_ran_out_of_time: null,
    is_time_remained: null, is_sent_home: null, practice_s: null };
  if (!lp) return empty;
  const moves = lp.moves || [];
  const rec = lp.recording || {};
  let lastDone = null;
  for (const m of moves) if (DONE_LIKE.includes(m.verdict) && m.stampS != null) lastDone = lastDone == null ? m.stampS : Math.max(lastDone, m.stampS);
  const prescribed = prescribedIndependentMinutes(moves);
  const practiceS = prescribed != null ? C.PRACTICE_SECONDS_PER_PRESCRIBED_MINUTE * prescribed : null;
  const audio = rec.audioS != null ? rec.audioS : null;
  const lastStamp = rec.lastStampS != null ? rec.lastStampS : null;

  const legs = [];
  if (rec.shortOfAudio != null) legs.push(rec.shortOfAudio === true);
  if (audio != null && lastStamp != null) legs.push(audio - lastStamp <= C.MARGIN_TAIL_S);
  if (audio != null && lastDone != null && practiceS != null) legs.push(audio - lastDone < practiceS);

  const exit = phaseOutcome(moves, 'exit');
  let ran = null; let remained = null;
  if (legs.length) {
    ran = exit.skipped && legs.some(Boolean);
    remained = !ran;
  }

  const ip = phaseOutcome(moves, 'independent');
  const hw = phaseOutcome(moves, 'homework');
  let sentHome = false;
  if (ip.skipped && hw.done) {
    const hwStamp = moves.filter((m) => m.phase === 'homework' && m.counted && ['executed', 'substituted_equivalent', 'substituted_better'].includes(m.verdict) && m.stampS != null)
      .map((m) => m.stampS).sort((a, b) => a - b)[0];
    sentHome = practiceS == null || rec.endsAtS == null || hwStamp == null ? null : hwStamp <= rec.endsAtS - practiceS;
  }
  return {
    last_done_s: lastDone, last_stamp_s: lastStamp, is_short_of_audio: rec.shortOfAudio != null ? rec.shortOfAudio : null,
    is_ran_out_of_time: ran, is_time_remained: remained, is_sent_home: sentHome, practice_s: practiceS,
  };
}

// ── the input hash (NIGHTLY_JOB §8): sha256 of the canonical JSON of the allow-listed inputs + the pipeline version.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}
function inputHash(obj, pipelineVersion = C.PIPELINE_VERSION) {
  return crypto.createHash('sha256').update(`${pipelineVersion}|${canonical(obj)}`).digest('hex');
}

/**
 * The lp_fidelity fact for one session, or null when the session has no graded plan (lp_absent, missing, …).
 * Scope fields (teacher_key, school_id, sector, recorded_at, is_observed, job_run_id) are added by the job.
 */
function buildLpFact(session, allowed) {
  const lp = allowed && allowed.lp;
  if (!lp || lp.status !== 'ok') return null;
  const grade = parseGrade(lp.grade);
  const split = causeSplit(lp);
  const isMismatch = lp.moderatorNote === 'lesson_mismatch';
  let status = 'ok'; let failureClass = null;
  if (!lp.model) { status = 'failed'; failureClass = 'input_missing'; } else if (isMismatch) status = 'mismatch';
  const rec = lp.recording || {};
  return {
    session_id: session.id,
    grader_model: lp.model || 'unknown',
    framework_version: 'lp_fidelity',
    pipeline_version: C.PIPELINE_VERSION,
    input_hash: inputHash({ lp }),
    status,
    failure_class: failureClass,
    is_mismatch: isMismatch,
    is_unusable: lp.isUnusable === true,
    is_lp_linked: true,
    subject: lp.subject ? lp.subject.slice(0, 40) : null,
    grade,
    lesson_type: lessonType(lp.subject, grade),
    audio_s: rec.audioS != null ? Math.round(rec.audioS) : null,
    ends_at_s: rec.endsAtS,
    last_stamp_s: split.last_stamp_s,
    last_done_s: split.last_done_s,
    is_short_of_audio: split.is_short_of_audio,
    is_ran_out_of_time: split.is_ran_out_of_time,
    is_time_remained: split.is_time_remained,
    is_sent_home: split.is_sent_home,
    is_stamped: !rec.noTimestamps && lp.moves.some((m) => m.stampS != null),
  };
}

/** The FICO fact (one per session with a FICO analysis). A shape that matches no instrument is failed, input_missing. */
function buildFicoFact(session, allowed) {
  const fico = allowed && allowed.fico;
  if (!fico || !fico.domains || !Object.keys(fico.domains).length) {
    if (fico && fico.rubric === 'fico17') { /* a form with no domains: detected below as failed */ } else return null;
  }
  const inst = detectFicoInstrument(fico);
  return {
    session_id: session.id,
    grader_model: 'analysis-processor',
    framework_version: inst || 'fico_v3:unknown',
    pipeline_version: C.PIPELINE_VERSION,
    input_hash: inputHash({ fico }),
    status: inst ? 'ok' : 'failed',
    failure_class: inst ? null : 'input_missing',
    instrument: inst,
    is_mismatch: false,
    is_unusable: false,
    is_lp_linked: false,
    subject: fico.subject ? fico.subject.slice(0, 40) : null,
    grade: null,
    lesson_type: null,
    is_stamped: true,
  };
}

// ── de-duplication (NIGHTLY_JOB §4 stage 1; Q8): group by audio_hash, keep the coach visit first, then the earliest.
// With no hash: same teacher, same Karachi day, durations within 1 s. Returns Map(dupId → keptId).
const karachiDay = (iso) => new Date(new Date(iso).getTime() + 5 * 3600 * 1000).toISOString().slice(0, 10);
const order = (a, b) => {
  const ka = a.observation_type === 'leader_observation' ? 0 : 1;
  const kb = b.observation_type === 'leader_observation' ? 0 : 1;
  if (ka !== kb) return ka - kb;
  return new Date(a.created_at) - new Date(b.created_at);
};

function dedupe(sessions) {
  const dup = new Map();
  const byHash = new Map();
  const noHash = [];
  for (const s of sessions) {
    if (s.audio_hash) { if (!byHash.has(s.audio_hash)) byHash.set(s.audio_hash, []); byHash.get(s.audio_hash).push(s); } else noHash.push(s);
  }
  for (const group of byHash.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort(order);
    for (const s of sorted.slice(1)) dup.set(s.id, sorted[0].id);
  }
  const byDay = new Map();
  for (const s of noHash) {
    const k = `${s.user_id}|${karachiDay(s.created_at)}`;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(s);
  }
  for (const group of byDay.values()) {
    const sorted = [...group].sort(order);
    const kept = [];
    for (const s of sorted) {
      const twin = kept.find((k) => k.audio_duration_seconds != null && s.audio_duration_seconds != null
        && Math.abs(k.audio_duration_seconds - s.audio_duration_seconds) <= 1);
      if (twin) dup.set(s.id, twin.id); else kept.push(s);
    }
  }
  return dup;
}

module.exports = { detectFicoInstrument, lessonType, parseGrade, causeSplit, inputHash, canonical, buildLpFact, buildFicoFact, dedupe, karachiDay };
