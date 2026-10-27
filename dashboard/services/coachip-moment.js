'use strict';
/**
 * bd-sex15q.13 — the one Moment builder (contracts/API.md §3 `Moment`, §12 "Moment.*" and "Moment.pair"), shared by
 * R3's inline moment (coachip-coach-read) and R5/R6 (coachip-listen-read). One implementation, so the S2 player and the
 * S4 player can never disagree about a clip, a step strip or a pair.
 *
 *   buildMoments(q, codes, coachUserId, momentIds, { withPair, coachScope, today }) → Moment[]
 *
 * - q            pg-shaped query(sql, params) → {rows}
 * - codes        createCoachipCodes(...): the teacher appears ONLY as Code {code_id, code} from codes.codesFor (B21)
 * - coachUserId  the caller (a coach): codes are minted in THIS coach's code space
 * - momentIds    uuids, ALREADY scope-checked by the caller (inScope / the rollup's own scope): this builder never
 *                decides "may this caller see this moment"; it only builds. Unknown ids are dropped (no throw); the
 *                answer keeps the order of momentIds.
 * - withPair     pick the pair at read time (§12): a kind 'good' moment of the same W INSIDE coachScope (its teacher
 *                key in coachScope.teacherKeys), same phase, another teacher, same subject preferred, highest credit,
 *                then newest. The nested Moment has pair = null. No good moment → null (the library carries no clip
 *                register yet, so `{library_clip}` is never produced: see the result file, contract gap).
 * - coachScope   CoachScope (teacherKeys, teacherSchool); also used for the moment's school: the teacher's CURRENT
 *                school (E7, the method sheet's rule), else the school the fact recorded.
 * - today        unused today; kept in the signature for w-listen (ISO date)
 *
 * Reads coachip_moments ⋈ coachip_session_facts, coachip_session_steps, schools (names). Never selects clip_r2_key,
 * a teacher's users.id, a name, or coaching_sessions.analysis_data. confidence 'none' → the clip spans the whole
 * recording, lesson_s null, steps' seconds null, gloss null (API.md R6 "States").
 *
 * buildMomentsWithMeta(...) is the same call returning { moments, computedAt } where computedAt is the OLDEST
 * coachip_session_facts.computed_at among the facts used (moments themselves carry no computed_at column).
 */
const S = require('./coachip-shapes');

/**
 * COPY §S4 s4.chapter.* by the plan's phase id (coachip_session_steps.phase). The grader's phase ids (prod: announce,
 * hook, warm_up, recall, explain, guided, independent, peer_review, exit, homework) each map to a COPY word; a phase this
 * map does not know reads COPY s4.step.other, never its id (fix-r5 s2 item 1, B17: `warm_up` shipped as a label).
 */
const CHAPTER = {
  warm: S.text('Warm-up', 'آغاز'),
  explain: S.text('Explain', 'وضاحت'),
  guided: S.text('Guided', 'مل کر'),
  ip: S.text('Practice', 'خود مشق'),
  peer: S.text('Peer check', 'ساتھیوں کی جانچ'),
  exit: S.text('Exit', 'جانچ'),
  homework: S.text('Homework', 'گھر کا کام'),
};
const CHAPTER_OTHER = S.text('Another step', 'کوئی اور مرحلہ');   // COPY s4.step.other
const PHASE_ALIAS = {
  warmup: 'warm', warm_up: 'warm', recall: 'warm', opening: 'warm', hook: 'warm', announce: 'warm',
  explanation: 'explain', i_do: 'explain', modelling: 'explain',
  we_do: 'guided', guided_practice: 'guided',
  independent: 'ip', you_do: 'ip', practice: 'ip', independent_practice: 'ip',
  peer_review: 'peer', peer_check: 'peer',
  closure: 'exit', exit_check: 'exit',
};
function chapterLabel(phase) {
  const key = Object.prototype.hasOwnProperty.call(CHAPTER, phase) ? phase : PHASE_ALIAS[phase];
  return key && CHAPTER[key] ? CHAPTER[key] : CHAPTER_OTHER;
}

/**
 * The debrief question per W. CONTRACT GAP: API.md §3 says "the library's one debrief question for this W", but
 * INTERVENTIONS.json v1.0 carries no such field and COPY v1 has no key. The two lines below are FIXTURES v2.2's text
 * verbatim (w_W-IP-TIME, moments); every other W gets the neutral COPY-style fallback until the library ships one.
 */
const QUESTIONS = {
  'W-IP-TIME': S.text('What did you hear at the moment the practice should have started?', 'جس لمحے مشق شروع ہونی چاہیے تھی، آپ نے وہاں کیا سنا؟'),
  'W-EXIT-NOPLAN': S.text('What did the last three minutes of the lesson sound like?', 'سبق کے آخری تین منٹ کیسے سنائی دیے؟'),
};
const QUESTION_FALLBACK = S.text('What did you hear at this moment?', 'اس لمحے آپ نے کیا سنا؟');
const questionFor = (wId) => QUESTIONS[wId] || QUESTION_FALLBACK;

function wShape(wId, row) {
  const c = S.wCopy(wId);
  if (c) return { w_id: wId, short_name: c.short_name, sentence: c.sentence };
  const short = row && row.short_name_en ? S.text(row.short_name_en, row.short_name_ur) : S.text(wId, wId);
  return { w_id: wId, short_name: short, sentence: S.text('', '') };
}

const MOMENT_SQL = `
  SELECT m.id, m.session_id, m.w_id, m.kind::text AS kind, m.phase, m.from_s, m.to_s, m.moment_s,
         m.confidence::text AS confidence, m.gloss_en, m.gloss_ur, m.gloss_status::text AS gloss_status,
         m.clip_status::text AS clip_status, m.fact_id,
         f.teacher_key, f.school_id AS fact_school_id, f.grade, f.subject, f.audio_s,
         ((f.recorded_at AT TIME ZONE 'Asia/Karachi')::date)::text AS recorded_on, f.computed_at,
         w.short_name_en, w.short_name_ur
    FROM coachip_moments m
    JOIN coachip_session_facts f ON f.id = m.fact_id
    LEFT JOIN coachip_weaknesses w ON w.w_id = m.w_id
   WHERE m.id = ANY($1::uuid[])`;

async function loadRows(q, ids) {
  if (!ids.length) return [];
  const { rows } = await q(MOMENT_SQL, [ids]);
  return rows;
}

async function loadSteps(q, factIds) {
  const out = new Map();
  if (!factIds.length) return out;
  const { rows } = await q(
    `SELECT fact_id, ordinal, phase, verdict::text AS verdict, from_s, to_s
       FROM coachip_session_steps WHERE fact_id = ANY($1::uuid[]) ORDER BY fact_id, ordinal`,
    [factIds],
  );
  for (const r of rows) {
    if (!out.has(r.fact_id)) out.set(r.fact_id, []);
    out.get(r.fact_id).push(r);
  }
  return out;
}

async function schoolNames(q, ids) {
  const out = new Map();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return out;
  const { rows } = await q(`SELECT id, name FROM schools WHERE id = ANY($1::uuid[])`, [unique]);
  for (const r of rows) out.set(r.id, r.name);
  return out;
}

/** The pair (API.md §12): a good moment of the same W inside the caller's scope; null when none. → moment id | null */
async function pickPair(q, row, coachScope) {
  const keys = coachScope && Array.isArray(coachScope.teacherKeys) ? coachScope.teacherKeys : [];
  if (!keys.length) return null;
  const { rows } = await q(
    `SELECT m.id
       FROM coachip_moments m JOIN coachip_session_facts f ON f.id = m.fact_id
      WHERE m.kind = 'good' AND m.w_id = $1 AND m.id <> $2
        AND f.teacher_key = ANY($3::text[]) AND f.teacher_key <> $4
        AND m.phase IS NOT DISTINCT FROM $5
      ORDER BY (f.subject IS NOT DISTINCT FROM $6) DESC, m.credit DESC NULLS LAST, f.recorded_at DESC, m.id
      LIMIT 1`,
    [row.w_id, row.id, keys, row.teacher_key, row.phase, row.subject],
  );
  return rows[0] ? rows[0].id : null;
}

function shape(row, { code, schoolId, schoolName, steps }) {
  const none = row.confidence === 'none';
  const durationS = row.audio_s != null
    ? row.audio_s
    : Math.max(row.to_s, ...steps.map((s) => (s.to_s == null ? 0 : s.to_s)));
  const clip = none
    ? { from_s: 0, to_s: durationS, duration_s: durationS, status: row.clip_status }
    : { from_s: row.from_s, to_s: row.to_s, duration_s: row.to_s - row.from_s, status: row.clip_status };
  return {
    moment_id: row.id,
    session: {
      session_id: row.session_id,
      grade: row.grade == null ? null : Number(row.grade),
      subject: row.subject == null ? null : row.subject,
      recorded_on: row.recorded_on,
      duration_s: durationS,
    },
    code,
    school: { school_id: schoolId, school_name: schoolName },
    w: wShape(row.w_id, row),
    kind: row.kind,
    steps: steps.map((s) => ({
      phase: s.phase,
      label: chapterLabel(s.phase),
      verdict: s.verdict,
      from_s: none || s.from_s == null ? null : s.from_s,
      to_s: none || s.to_s == null ? null : s.to_s,
    })),
    lesson_s: none || row.moment_s == null ? null : row.moment_s,
    confidence: row.confidence,
    clip,
    gloss: !none && row.gloss_status === 'ok' && row.gloss_en && row.gloss_ur ? S.text(row.gloss_en, row.gloss_ur) : null,
    gloss_status: row.gloss_status,
    question: questionFor(row.w_id),
    pair: null,
    full_recording: { duration_s: durationS },
  };
}

async function build(q, codes, coachUserId, momentIds, opts, depth) {
  const { withPair = false, coachScope = null } = opts || {};
  const ids = [...new Set((momentIds || []).filter(S.isUuid))];
  const rows = await loadRows(q, ids);
  if (!rows.length) return { moments: [], computedAt: null };
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);

  const steps = await loadSteps(q, [...new Set(ordered.map((r) => r.fact_id))]);
  const current = coachScope && coachScope.teacherSchool instanceof Map ? coachScope.teacherSchool : new Map();
  const schoolOf = (r) => current.get(r.teacher_key) || r.fact_school_id;
  const names = await schoolNames(q, ordered.map(schoolOf));
  const codeMap = await codes.codesFor(coachUserId, ordered.map((r) => r.teacher_key), q);

  let computedAt = null;
  const moments = [];
  for (const r of ordered) {
    const at = new Date(r.computed_at);
    if (!computedAt || at < computedAt) computedAt = at;
    const schoolId = schoolOf(r);
    const m = shape(r, { code: codeMap.get(r.teacher_key), schoolId, schoolName: names.get(schoolId) || '', steps: steps.get(r.fact_id) || [] });
    if (withPair && depth === 0) {
      const pairId = await pickPair(q, r, coachScope);   // eslint-disable-line no-await-in-loop
      if (pairId) {
        const nested = await build(q, codes, coachUserId, [pairId], { withPair: false, coachScope }, 1);   // eslint-disable-line no-await-in-loop
        if (nested.moments[0]) {
          m.pair = nested.moments[0];
          if (nested.computedAt && nested.computedAt < computedAt) computedAt = nested.computedAt;
        }
      }
    }
    moments.push(m);
  }
  return { moments, computedAt };
}

/** → Moment[] in the order of momentIds (unknown ids dropped). See the header for the contract. */
async function buildMoments(q, codes, coachUserId, momentIds, opts = {}) {
  return (await build(q, codes, coachUserId, momentIds, opts, 0)).moments;
}

/** → { moments: Moment[], computedAt: Date|null } (the oldest fact computed_at used). */
async function buildMomentsWithMeta(q, codes, coachUserId, momentIds, opts = {}) {
  return build(q, codes, coachUserId, momentIds, opts, 0);
}

module.exports = { buildMoments, buildMomentsWithMeta, chapterLabel, questionFor, wShape, CHAPTER };
