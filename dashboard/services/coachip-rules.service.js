'use strict';
/**
 * bd-sex15q.13 — the coaching-loop rules every COACHIP route shares (API.md §8): visits, the check-by rule, the
 * Step chip, and the Step / Note shapes read back from coachip_steps, coachip_step_checks, coachip_rm_notes and
 * coachip_rm_note_schools. One implementation, so S1's step list, S2's step card, S5's default and POST /steps
 * agree to the day.
 *
 * Visits are observation_schedules rows (V1.0.10): status 'upcoming' is booked, 'done' completed, 'cancelled' neither.
 * A row names its school by school_id or by school_ext_id ('niete:' || schools.emis); both are matched. Only the
 * COACH's own bookings count (leader_user_id): a visit another coach booked is not this coach's check. teacher_name
 * on that table is never selected.
 */
const S = require('./coachip-shapes');

/** The schools join for observation_schedules (school_id, else the niete:<emis> ext id). */
const OS_SCHOOL = `(os.school_id = s.id OR (os.school_id IS NULL AND os.school_ext_id = 'niete:' || s.emis))`;

/**
 * Next booked visit per school (on or after `fromIso`), for this coach. → Map(schoolId → Visit {date, schedule_id}).
 */
async function nextVisits(q, coachUserId, schoolIds, fromIso) {
  const out = new Map();
  if (!schoolIds.length) return out;
  const { rows } = await q(
    `SELECT DISTINCT ON (s.id) s.id AS school_id, os.id AS schedule_id, os.scheduled_for::text AS date
       FROM observation_schedules os JOIN schools s ON ${OS_SCHOOL}
      WHERE os.leader_user_id = $1 AND s.id = ANY($2::uuid[]) AND os.status = 'upcoming' AND os.scheduled_for >= $3::date
      ORDER BY s.id, os.scheduled_for ASC, os.id ASC`,
    [coachUserId, schoolIds, fromIso],
  );
  for (const r of rows) out.set(r.school_id, { date: r.date, schedule_id: r.schedule_id });
  return out;
}

/** Latest completed visit per school for this coach, not limited to any window (API.md R3). → Map(schoolId → ISO date). */
async function lastVisits(q, coachUserId, schoolIds) {
  const out = new Map();
  if (!schoolIds.length) return out;
  const { rows } = await q(
    `SELECT s.id AS school_id, MAX(os.scheduled_for)::text AS date
       FROM observation_schedules os JOIN schools s ON ${OS_SCHOOL}
      WHERE os.leader_user_id = $1 AND s.id = ANY($2::uuid[]) AND os.status = 'done'
      GROUP BY s.id`,
    [coachUserId, schoolIds],
  );
  for (const r of rows) out.set(r.school_id, r.date);
  return out;
}

/**
 * The check-by rule (SPEC v2 §0.12, API.md §8.1): the first booked visit by this coach to that school at least 7 days
 * after the set date → {date, rule: 'visit', visit}; else set date + 14 → {date, rule: '14_days', visit: null}.
 * Worked case: set 2026-10-26, the only booked visit 2026-10-28 → 2026-11-09, 14_days.
 */
async function checkByFor(q, coachUserId, schoolId, setOnIso) {
  const visits = await nextVisits(q, coachUserId, [schoolId], S.addDays(setOnIso, 7));
  const v = visits.get(schoolId);
  if (v) return { date: v.date, rule: 'visit', visit: v };
  return { date: S.addDays(setOnIso, 14), rule: '14_days', visit: null };
}

/**
 * The chip (API.md §8.2): worked at ≥ 2 true hits; not_yet when three are in with < 2 true, or the 14 days have
 * passed; else to_come with 3 − hits.length to come. A partial counts half for the chip and is never a hit.
 */
function chipFor(hits, setOnIso, todayIso) {
  const trues = hits.filter((h) => h.hit === true).length;
  const halves = hits.filter((h) => h.hit === 'partial').length;
  if (trues >= 2 || trues + halves / 2 >= 2) return { chip: 'worked', to_come: 0 };
  const expired = todayIso > S.addDays(setOnIso, 14);
  if (hits.length >= 3 || expired) return { chip: 'not_yet', to_come: 0 };
  return { chip: 'to_come', to_come: 3 - hits.length };
}

const HIT = { hit: true, partial: 'partial', miss: false };

/**
 * Coach steps as Step shapes (API.md §3), newest rules applied. `where`: { coachUserId, stepIds?, openOnly?, limit? }.
 * Only scope = 'coach' rows (a sector step is a SectorStep). Ordered check_by ascending.
 */
async function loadSteps(q, { coachUserId, stepIds = null, openOnly = false, limit = 20 }, todayIso) {
  const params = [coachUserId];
  let filter = '';
  if (stepIds) { params.push(stepIds); filter += ` AND st.id = ANY($${params.length}::uuid[])`; }
  if (openOnly) filter += " AND st.status = 'open'";
  params.push(limit);
  const { rows } = await q(
    `SELECT st.id, st.w_id, st.i_id, st.status::text AS status, st.coach_tick::text AS coach_tick,
            ((st.set_at AT TIME ZONE 'Asia/Karachi')::date)::text AS set_on, st.check_by::text AS check_by,
            st.check_by_rule, st.visit_schedule_id, os.scheduled_for::text AS visit_date, st.rm_note_id,
            st.code_id, tc.code, st.school_id, s.name AS school_name
       FROM coachip_steps st
       JOIN coachip_teacher_codes tc ON tc.id = st.code_id
       JOIN schools s ON s.id = st.school_id
       LEFT JOIN observation_schedules os ON os.id = st.visit_schedule_id
      WHERE st.coach_user_id = $1 AND st.scope = 'coach'${filter}
      ORDER BY st.check_by ASC, st.set_at ASC
      LIMIT $${params.length}`,
    params,
  );
  if (!rows.length) return [];
  const checks = await q(
    `SELECT step_id, session_id, hit::text AS hit, ((recorded_at AT TIME ZONE 'Asia/Karachi')::date)::text AS recorded_on
       FROM coachip_step_checks WHERE step_id = ANY($1::uuid[]) ORDER BY step_id, seq ASC`,
    [rows.map((r) => r.id)],
  );
  const byStep = new Map();
  for (const c of checks.rows) {
    if (!byStep.has(c.step_id)) byStep.set(c.step_id, []);
    byStep.get(c.step_id).push({ session_id: c.session_id, hit: HIT[c.hit], recorded_on: c.recorded_on });
  }
  const lib = S.library();
  return rows.map((r) => {
    const hits = byStep.get(r.id) || [];
    const i = lib.intervention(r.i_id);
    const step = i && i.teacher_action_step ? S.text(i.teacher_action_step.step_en, i.teacher_action_step.step_ur) : S.text('', '');
    return {
      id: r.id,
      scope: 'coach',
      code: { code_id: r.code_id, code: r.code },
      school: { school_id: r.school_id, school_name: r.school_name },
      w_id: r.w_id,
      i_id: r.i_id,
      step,
      set_on: r.set_on,
      check_by: r.check_by,
      check_rule: r.check_by_rule,
      visit: r.visit_schedule_id ? { date: r.visit_date, schedule_id: r.visit_schedule_id } : null,
      status: r.status,
      coach_tick: r.coach_tick,
      strip: { needed: 3, window_days: 14, hits },
      ...chipFor(hits, r.set_on, todayIso),
      rm_note_id: r.rm_note_id,
    };
  });
}

/** SectorStep shapes (API.md A9) for one RM. */
async function loadSectorSteps(q, { rmUserId, stepIds = null, limit = 20 }) {
  const params = [rmUserId];
  let filter = '';
  if (stepIds) { params.push(stepIds); filter = ` AND st.id = ANY($${params.length}::uuid[])`; }
  params.push(limit);
  const { rows } = await q(
    `SELECT st.id, st.sector, st.w_id, st.i_id, st.status::text AS status,
            ((st.set_at AT TIME ZONE 'Asia/Karachi')::date)::text AS set_on
       FROM coachip_steps st
      WHERE st.coach_user_id = $1 AND st.scope = 'sector'${filter}
      ORDER BY st.set_at DESC LIMIT $${params.length}`,
    params,
  );
  const lib = S.library();
  return rows.map((r) => {
    const i = lib.intervention(r.i_id);
    return {
      id: r.id, scope: 'sector', sector: r.sector, w_id: r.w_id, i_id: r.i_id,
      title: i ? S.text(i.title_en, i.title_ur) : S.text(r.i_id, r.i_id),
      date: r.set_on, status: r.status,
    };
  });
}

/** Note shapes (API.md §3). `where`: { coachUserId?, rmUserId?, noteIds?, statuses?, limit? } — at least one owner. */
async function loadNotes(q, { coachUserId = null, rmUserId = null, noteIds = null, statuses = null, limit = 10 }) {
  if (!coachUserId && !rmUserId) throw new Error('loadNotes needs an owner');
  const params = [];
  const where = [];
  if (coachUserId) { params.push(coachUserId); where.push(`n.coach_user_id = $${params.length}`); }
  if (rmUserId) { params.push(rmUserId); where.push(`n.rm_user_id = $${params.length}`); }
  if (noteIds) { params.push(noteIds); where.push(`n.id = ANY($${params.length}::uuid[])`); }
  if (statuses) { params.push(statuses); where.push(`n.status::text = ANY($${params.length}::text[])`); }
  params.push(limit);
  const { rows } = await q(
    `SELECT n.id, n.template_id, n.w_id, n.body_en, n.body_ur, n.due_on::text AS due_on, n.status::text AS status, n.created_at
       FROM coachip_rm_notes n WHERE ${where.join(' AND ')}
      ORDER BY n.created_at DESC LIMIT $${params.length}`,
    params,
  );
  if (!rows.length) return [];
  const schools = await q(
    `SELECT ns.rm_note_id, s.id AS school_id, s.name AS school_name
       FROM coachip_rm_note_schools ns JOIN schools s ON s.id = ns.school_id
      WHERE ns.rm_note_id = ANY($1::uuid[]) ORDER BY ns.rm_note_id, ns.position`,
    [rows.map((r) => r.id)],
  );
  const byNote = new Map();
  for (const s of schools.rows) {
    if (!byNote.has(s.rm_note_id)) byNote.set(s.rm_note_id, []);
    byNote.get(s.rm_note_id).push({ school_id: s.school_id, school_name: s.school_name });
  }
  return rows.map((r) => noteShape(r, byNote.get(r.id) || []));
}
/** The Note shape (API.md §3) from a coachip_rm_notes row and its schools in position order. */
function noteShape(r, schools) {
  return {
    id: r.id,
    label: S.text('From your RM', 'آپ کے آر ایم کی طرف سے'),
    template_id: r.template_id,
    w_id: r.w_id,
    lines: { en: splitLines(r.body_en), ur: splitLines(r.body_ur) },
    schools,
    due_on: r.due_on,
    status: r.status,
  };
}
function splitLines(body) {
  const l = String(body).split('\n');
  while (l.length < 3) l.push('');
  return l.slice(0, 3);
}

/**
 * Compose an RM note's three lines (API.md §8.5, COPY §RM-T): {w_short} the W's short name, {schools} the 1-3 names
 * joined by the list rule, {date} COPY §F's date (the one formatted date in a payload: the line is a stored artefact),
 * {i_title} the first school-level intervention of the W (its parent's when the W has none). → {en: [3], ur: [3]}.
 * {date} is COPY §F's short form ("30 Oct"): a stored line never carries a weekday. In Urdu every school name (an ASCII
 * run) sits in LRI…PDI (COPY §0 rule 3).
 */
function composeNoteLines(templateId, { wId, schoolNames, dueOn, todayIso }) {
  const copy = S.loadCopy();
  const t = copy.rm_templates[templateId];
  if (!t) throw new Error(`no template ${templateId}`);
  const w = S.wCopy(wId) || { short_name: S.text(wId, wId) };
  const iTitle = firstSchoolLevelTitle(wId);
  const date = S.formatDateShort(dueOn, todayIso);
  const join = (names, lang) => {
    if (names.length === 1) return names[0];
    const and = lang === 'en' ? ' and ' : ' اور ';
    const comma = lang === 'en' ? ', ' : '، ';
    return `${names.slice(0, -1).join(comma)}${and}${names[names.length - 1]}`;
  };
  const fill = (line, lang) => line
    .replace(/\{w_short\}/g, w.short_name[lang])
    .replace(/\{schools\}/g, join(lang === 'ur' ? schoolNames.map(S.isolate) : schoolNames, lang))
    .replace(/\{date\}/g, date[lang])
    .replace(/\{i_title\}/g, iTitle[lang]);
  return { en: t.en.map((l) => fill(l, 'en')), ur: t.ur.map((l) => fill(l, 'ur')) };
}
function firstSchoolLevelTitle(wId) {
  const lib = S.library();
  let w = lib.weakness(wId);
  while (w) {
    const i = lib.forW(w.id).find((x) => x.level === 'school') || null;
    if (i) return S.text(i.title_en, i.title_ur);
    w = w.parent_w_id ? lib.weakness(w.parent_w_id) : null;
  }
  const any = lib.forW(wId)[0];
  return any ? S.text(any.title_en, any.title_ur) : S.text(wId, wId);
}

module.exports = {
  OS_SCHOOL, nextVisits, lastVisits, checkByFor, chipFor, loadSteps, loadSectorSteps, loadNotes, noteShape,
  composeNoteLines,
};
