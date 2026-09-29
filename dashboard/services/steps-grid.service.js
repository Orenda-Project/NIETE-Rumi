/**
 * The principal's landing view, organised by STEPS — a row per teacher, a
 * column per letter.
 *
 * STEPS is NIETE's own teacher-evaluation framework (design spec, 2026-07-16),
 * and it feeds each teacher's ACR:
 *   S  Subject knowledge   observation, FICO section F
 *   T  Teaching skills     observation, FICO sections B + C
 *   E  Engagement          observation, FICO section D
 *   P  Presence            the teacher's OWN attendance
 *   S  Supervisor remark   the principal's quarterly remark
 *
 * Pure: every row it needs is passed in, so the route owns the queries and
 * this owns the rules.
 *
 * Why each rule is the way it is:
 *   · S/T/E come from her LATEST lesson that carries the domain. An older
 *     rubric (lesson_structure / classroom_climate / …) still sits on 15 of 200
 *     live sessions; a session without the domain is skipped, never read as 0.
 *   · T pools B and C by POINTS. The sections differ in size (10 and 12
 *     indicators), so averaging two percentages would overweight the smaller.
 *   · P is counts, not a band. NIETE has deliberately not defined a single P
 *     score (the teacher:student weighting was left open — see
 *     steps-presence.service), and the observation scale would call 80%
 *     attendance "Excellent". Leave is not absence and is counted apart.
 *   · The remark S is the principal's to-do: done / todo / no_cycle. Only a
 *     SUBMITTED remark in the OPEN cycle counts as done.
 *   · Principals are not rows: she evaluates the teachers.
 *   · The percentage may travel; the UI renders only the band.
 */

const { scoreBandFor } = require('../../bot/shared/config/score-bands');

// FICO section → domain key, as the analysis writes them.
const S_DOMAINS = ['teacher_subject_knowledge'];                         // F
const T_DOMAINS = ['lesson_plan_fidelity', 'high_leverage_practices'];   // B + C
const E_DOMAINS = ['student_engagement'];                                // D

function round1(n) {
  return Math.round(n * 10) / 10;
}

/** Points-pooled percentage over whichever of `keys` this session scored. */
function pooledPct(domains, keys) {
  if (!domains || typeof domains !== 'object') return null;
  let score = 0;
  let max = 0;
  for (const k of keys) {
    const d = domains[k];
    const m = Number(d && d.domain_max);
    const s = Number(d && d.domain_score);
    if (!Number.isFinite(m) || m <= 0 || !Number.isFinite(s)) continue;
    score += s;
    max += m;
  }
  return max > 0 ? round1((score / max) * 100) : null;
}

/** Her latest lesson that scored this letter at all. */
function latestLetter(sessionsNewestFirst, keys) {
  for (const s of sessionsNewestFirst) {
    const pct = pooledPct(s.analysis_data && s.analysis_data.domains, keys);
    if (pct !== null) return { pct, band: scoreBandFor(pct) };
  }
  return null;
}

function presenceOf(records) {
  const present = records.filter((r) => r.status === 'present').length;
  const absent = records.filter((r) => r.status === 'absent').length;
  const leave = records.filter((r) => r.status === 'leave').length;
  return { present, absent, leave, markedDays: present + absent };
}

function remarkOf(remarks, cycle) {
  if (!cycle) return 'no_cycle';
  return remarks.some((r) => r.cycle_id === cycle.id && r.submitted_at) ? 'done' : 'todo';
}

function summariseLetter(rows, letter) {
  const scored = rows.filter((r) => r[letter]);
  if (!scored.length) return { pct: null, band: null, teachers: 0, of: rows.length };
  const pct = round1(scored.reduce((sum, r) => sum + r[letter].pct, 0) / scored.length);
  return { pct, band: scoreBandFor(pct), teachers: scored.length, of: rows.length };
}

/**
 * @param {object}   input
 * @param {object[]} input.teachers    getPatchTeachers output
 * @param {object[]} input.sessions    {user_id, created_at, analysis_data}
 * @param {object[]} input.attendance  teacher_attendance_records {teacher_id, status}
 * @param {object[]} input.remarks     supervisor_remarks {teacher_id, cycle_id, submitted_at}
 * @param {object|null} input.cycle    the OPEN evaluation cycle, or null
 */
function buildStepsGrid({ teachers = [], sessions = [], attendance = [], remarks = [], cycle = null } = {}) {
  const staff = teachers
    .filter((t) => t && t.rumiUserId && !t.isPrincipal)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const byUser = (rows, key) => {
    const m = new Map();
    for (const r of rows || []) {
      if (!r) continue;
      const id = r[key];
      if (!m.has(id)) m.set(id, []);
      m.get(id).push(r);
    }
    return m;
  };
  const sessionsBy = byUser(sessions, 'user_id');
  const attendanceBy = byUser(attendance, 'teacher_id');
  const remarksBy = byUser(remarks, 'teacher_id');

  const rows = staff.map((t) => {
    const mine = (sessionsBy.get(t.rumiUserId) || [])
      .slice()
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const observed = mine.find((s) => s.analysis_data && s.analysis_data.domains);
    return {
      id: t.rumiUserId,
      name: t.name,
      lastObservedAt: observed ? observed.created_at : null,
      s: latestLetter(mine, S_DOMAINS),
      t: latestLetter(mine, T_DOMAINS),
      e: latestLetter(mine, E_DOMAINS),
      presence: presenceOf(attendanceBy.get(t.rumiUserId) || []),
      remark: remarkOf(remarksBy.get(t.rumiUserId) || [], cycle),
    };
  });

  const presenceTotals = rows.reduce(
    (acc, r) => ({
      present: acc.present + r.presence.present,
      absent: acc.absent + r.presence.absent,
      leave: acc.leave + r.presence.leave,
      teachersMarked: acc.teachersMarked + (r.presence.markedDays > 0 ? 1 : 0),
    }),
    { present: 0, absent: 0, leave: 0, teachersMarked: 0 },
  );

  return {
    cycle: cycle ? { name: cycle.name, endsAt: cycle.ends_at } : null,
    teachers: rows,
    summary: {
      s: summariseLetter(rows, 's'),
      t: summariseLetter(rows, 't'),
      e: summariseLetter(rows, 'e'),
      presence: { ...presenceTotals, of: rows.length },
      remark: {
        done: rows.filter((r) => r.remark === 'done').length,
        todo: rows.filter((r) => r.remark === 'todo').length,
      },
    },
  };
}

module.exports = { buildStepsGrid, S_DOMAINS, T_DOMAINS, E_DOMAINS };
