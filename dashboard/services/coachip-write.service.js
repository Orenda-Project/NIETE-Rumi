'use strict';
/**
 * bd-sex15q.13 (worker w-write) — COACHIP's seven write routes (contracts/API.md v1.4 §7 R10-R13, R16; §9 R19, R21;
 * §8.1 check-by, §8.5 note lines, §11 audit). Each export is a router handler: async (ctx) => ({ status, body }).
 *
 * Why it is shaped this way:
 *   - Scope before content (API §4, B3). Every handler first proves the resource is the caller's — keyFor for a
 *     code_id, coach_user_id = uid for a step or a note, the RM's sector for a coach and a school — and answers the ONE
 *     404 body for "not yours" and "does not exist" alike. Nothing about the resource is read before that check.
 *   - The router has already answered 400 for the grammar (exact keys, typed values, dates in range); these handlers
 *     check meaning only. The one 400 here is R21's date ≠ today, a request-only rule decided before any read.
 *   - Every write runs in ctx.deps.tx (one transaction): a step and the note it answers, a note and its schools.
 *   - A teacher is never named, keyed or id'd in a payload: a step carries Code {code_id, code} only. R16 is the one
 *     route that returns a name, and only after its 'decode' audit row is written (no row, no name).
 *   - Shapes come back through coachip-rules (loadSteps / loadSectorSteps / loadNotes), so a write answers in exactly
 *     the shape S1's lists read.
 */
const S = require('./coachip-shapes');
const R = require('./coachip-rules.service');

const OPEN_STEP_INDEX = 'uq_coachip_steps_open';
const CLOSED = new Set(['completed', 'cancelled']);
/** API §7 R12: open → completed | deferred | cancelled; deferred → completed | cancelled (no way back to open in v1). */
const NEXT_STATUS = { open: new Set(['completed', 'deferred', 'cancelled']), deferred: new Set(['completed', 'cancelled']) };

const notFound = () => new S.HttpAnswer(S.NOT_FOUND());
const stamp = (ctx) => S.isoTime(ctx.now);
const sameId = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const isUniqueOpenStep = (err) => err && err.code === '23505' && err.constraint === OPEN_STEP_INDEX;

// ── shared checks ────────────────────────────────────────────────────────────────────────────────────────────────

/** The W is in the catalogue (coachip_weaknesses) → { w_id, parent_w_id }, else the one 404. */
async function weaknessOr404(q, wId) {
  const { rows } = await q('SELECT w_id, parent_w_id FROM coachip_weaknesses WHERE w_id = $1', [wId]);
  if (!rows[0]) throw notFound();
  return rows[0];
}

/** The I is in the catalogue and belongs to one of `wIds` → { i_id, w_id, level }, else the one 404. */
async function interventionOr404(q, iId, wIds) {
  const { rows } = await q(
    'SELECT i_id, w_id, level::text AS level FROM coachip_interventions WHERE i_id = $1 AND w_id = ANY($2::text[])',
    [iId, wIds.filter(Boolean)],
  );
  if (!rows[0]) throw notFound();
  return rows[0];
}

/** The open step of this coach for (code_id, w_id), or null (the 409 pre-check and the race's answer). */
async function openStepId(q, coachUserId, codeId, wId) {
  const { rows } = await q(
    `SELECT id FROM coachip_steps
      WHERE coach_user_id = $1 AND code_id = $2 AND w_id = $3 AND status = 'open' AND scope = 'coach'
      ORDER BY set_at ASC LIMIT 1`,
    [coachUserId, codeId, wId],
  );
  return rows[0] ? rows[0].id : null;
}

/**
 * The source session is in the coach's scope (inScope: its teacher's CURRENT school) AND is this teacher's: the
 * session's own teacher keys to `key`, or the nightly facts recorded it under `key`. Reads coaching_sessions.user_id
 * only (API §1), and the id never leaves this function.
 */
async function sessionIsTeachers(ctx, sessionId, key) {
  if (!(await ctx.deps.scope.inScope(ctx.coach, sessionId))) return false;
  const q = ctx.deps.query;
  const { rows } = await q('SELECT user_id FROM coaching_sessions WHERE id = $1', [sessionId]);
  if (rows[0] && rows[0].user_id && ctx.deps.codes.teacherKey(rows[0].user_id) === key) return true;
  const facts = await q('SELECT 1 FROM coachip_session_facts WHERE session_id = $1 AND teacher_key = $2 LIMIT 1', [sessionId, key]);
  return facts.rows.length > 0;
}

/** One coach step as a Step (API §3), read back through the shared loader. */
async function stepAnswer(q, ctx, stepId, status) {
  const [step] = await R.loadSteps(q, { coachUserId: ctx.uid, stepIds: [stepId], limit: 1 }, ctx.today);
  if (!step) throw new Error('step not readable after write');
  return S.reply(status, { step, computed_at: stamp(ctx) });
}

/** The caller's own coach step, locked for the change → row, else the one 404 (another coach's, a sector step, none). */
async function ownStepForUpdate(q, ctx) {
  const { rows } = await q(
    `SELECT id, status::text AS status FROM coachip_steps
      WHERE id = $1 AND coach_user_id = $2 AND scope = 'coach' FOR UPDATE`,
    [ctx.params.stepId, ctx.uid],
  );
  if (!rows[0]) throw notFound();
  return rows[0];
}

// ── R10 POST /coachip/steps ──────────────────────────────────────────────────────────────────────────────────────
/**
 * Checks in API §7 order, each failure the one 404: keyFor → school in scope AND the teacher's current school → W in
 * the catalogue → I of W or its parent → source session in scope and this teacher's → rm_note_id a note to this coach.
 * Then 409 when an open step exists for (uid, code_id, w_id): a pre-check, and the uq_coachip_steps_open violation
 * mapped to the same body for two requests that pass the pre-check together.
 */
async function createStep(ctx) {
  const { code_id: codeId, school_id: schoolId, w_id: wId, i_id: iId, source_session_id: sessionId, rm_note_id: noteId } = ctx.body;
  const q = ctx.deps.query;
  const key = await ctx.deps.codes.keyFor(ctx.uid, codeId);
  if (!key) return S.NOT_FOUND();
  const scope = ctx.coach;
  const inSchools = scope.schoolIds.some((id) => sameId(id, schoolId));
  const teacherSchool = scope.teacherSchool && scope.teacherSchool.get(key);
  if (!inSchools || !sameId(teacherSchool, schoolId)) return S.NOT_FOUND();
  const w = await weaknessOr404(q, wId);
  await interventionOr404(q, iId, [w.w_id, w.parent_w_id]);
  if (sessionId !== null && !(await sessionIsTeachers(ctx, sessionId, key))) return S.NOT_FOUND();
  if (noteId !== null) {
    const { rows } = await q('SELECT 1 FROM coachip_rm_notes WHERE id = $1 AND coach_user_id = $2', [noteId, ctx.uid]);
    if (!rows[0]) return S.NOT_FOUND();
  }

  const existing = await openStepId(q, ctx.uid, codeId, wId);
  if (existing) return S.STEP_EXISTS(existing);

  try {
    return await ctx.deps.tx(async (t) => {
      const checkBy = await R.checkByFor(t, ctx.uid, schoolId, ctx.today);
      const { rows } = await t(
        `INSERT INTO coachip_steps (coach_user_id, scope, code_id, school_id, w_id, i_id, source_session_id, rm_note_id,
                                    set_at, check_by, check_by_rule, visit_schedule_id)
         VALUES ($1, 'coach', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [ctx.uid, codeId, schoolId, wId, iId, sessionId, noteId, ctx.now, checkBy.date, checkBy.rule,
          checkBy.visit ? checkBy.visit.schedule_id : null],
      );
      if (noteId !== null) {
        await t("UPDATE coachip_rm_notes SET status = 'set' WHERE id = $1 AND coach_user_id = $2", [noteId, ctx.uid]);
      }
      return stepAnswer(t, ctx, rows[0].id, 201);
    });
  } catch (err) {
    if (!isUniqueOpenStep(err)) throw err;
    const winner = await openStepId(q, ctx.uid, codeId, wId);
    if (!winner) throw err;
    return S.STEP_EXISTS(winner);
  }
}

// ── R11 POST /coachip/steps/:stepId/tick ─────────────────────────────────────────────────────────────────────────
/** Allowed on open and deferred; completed/cancelled → 409 step_closed. Sets coach_tick and checked_at (= now). */
async function tickStep(ctx) {
  return ctx.deps.tx(async (t) => {
    const step = await ownStepForUpdate(t, ctx);
    if (CLOSED.has(step.status)) return S.STEP_CLOSED();
    await t('UPDATE coachip_steps SET coach_tick = $2, checked_at = $3 WHERE id = $1', [step.id, ctx.body.coach_tick, ctx.now]);
    return stepAnswer(t, ctx, step.id, 200);
  });
}

// ── R12 POST /coachip/steps/:stepId/status ───────────────────────────────────────────────────────────────────────
/**
 * open → completed | deferred | cancelled; deferred → completed | cancelled. A closed step answers 409 step_closed to
 * any request. deferred → deferred is not a change: 200 with the step as it is.
 */
async function stepStatus(ctx) {
  const to = ctx.body.status;
  return ctx.deps.tx(async (t) => {
    const step = await ownStepForUpdate(t, ctx);
    if (CLOSED.has(step.status)) return S.STEP_CLOSED();
    if (step.status !== to && NEXT_STATUS[step.status] && NEXT_STATUS[step.status].has(to)) {
      await t('UPDATE coachip_steps SET status = $2 WHERE id = $1', [step.id, to]);
    }
    return stepAnswer(t, ctx, step.id, 200);
  });
}

// ── R13 POST /coachip/notes/:noteId/status (A8) ──────────────────────────────────────────────────────────────────
/** sent → seen; sent | seen | set → dismissed; anything else (seen on set/dismissed, dismissed again) is a no-op 200. */
async function noteStatus(ctx) {
  const to = ctx.body.status;
  return ctx.deps.tx(async (t) => {
    const { rows } = await t(
      'SELECT id, status::text AS status FROM coachip_rm_notes WHERE id = $1 AND coach_user_id = $2 FOR UPDATE',
      [ctx.params.noteId, ctx.uid],
    );
    const n = rows[0];
    if (!n) return S.NOT_FOUND();
    const moves = (to === 'seen' && n.status === 'sent') || (to === 'dismissed' && n.status !== 'dismissed');
    if (moves) await t('UPDATE coachip_rm_notes SET status = $2 WHERE id = $1', [n.id, to]);
    const [note] = await R.loadNotes(t, { coachUserId: ctx.uid, noteIds: [n.id], limit: 1 });
    return S.reply(200, { note, computed_at: stamp(ctx) });
  });
}

// ── R16 POST /coachip/teacher-name ───────────────────────────────────────────────────────────────────────────────
/**
 * The decode switch AND the caller's own code_id, else the one 404 (a switch read that throws is off). The name is
 * found by recomputing teacherKey over the coach's CURRENT scope teachers — never stored, so a teacher who left the
 * scope is a 404. The 'decode' audit row is written before the name leaves; a failed insert throws → 500, no name.
 */
async function teacherName(ctx) {
  let on = false;
  try { on = (await ctx.deps.flags.decodeOn(ctx.uid)) === true; } catch (_) { on = false; }
  if (!on) return S.NOT_FOUND();
  const codeId = ctx.body.code_id;
  const key = await ctx.deps.codes.keyFor(ctx.uid, codeId);
  if (!key || !ctx.coach.teacherKeys.includes(key)) return S.NOT_FOUND();
  const { rows } = await ctx.deps.query(
    `SELECT id, name FROM users
      WHERE role = 'teacher' AND deleted_at IS NULL AND NOT COALESCE(is_test_user, false) AND school_id = ANY($1::uuid[])`,
    [ctx.coach.schoolIds],
  );
  const teacher = rows.find((u) => ctx.deps.codes.teacherKey(u.id) === key);
  if (!teacher || typeof teacher.name !== 'string' || !teacher.name.trim()) return S.NOT_FOUND();
  await ctx.deps.codes.audit(ctx.uid, 'decode', codeId);
  return S.reply(200, { name: teacher.name, computed_at: stamp(ctx) });
}

// ── R19 POST /coachip/rm/notes ───────────────────────────────────────────────────────────────────────────────────
/**
 * The coach is on this RM's sector roster (and is not the RM); every school is that coach's (coachScope) and in the
 * sector; the W is in the catalogue — else the one 404. Lines from COPY §RM-T via composeNoteLines, stored as
 * body_en/body_ur joined by "\n"; schools at positions 1..3 in the order given; all in one transaction. The
 * 'note_sent' audit is logged on failure and the note stands (API §11).
 */
async function rmNote(ctx) {
  const { coach_user_id: coachId, template_id: templateId, w_id: wId, school_ids: schoolIds, due_on: dueOn } = ctx.body;
  const rm = ctx.rm;
  if (sameId(coachId, ctx.uid) || !rm.coachUserIds.some((id) => sameId(id, coachId))) return S.NOT_FOUND();
  const coachScope = await ctx.deps.scope.coachScope(coachId);
  if (!coachScope) return S.NOT_FOUND();
  const ok = schoolIds.every((sid) => coachScope.schoolIds.some((id) => sameId(id, sid)) && rm.schoolIds.some((id) => sameId(id, sid)));
  if (!ok) return S.NOT_FOUND();
  const q = ctx.deps.query;
  await weaknessOr404(q, wId);
  const { rows: named } = await q(`SELECT id, name FROM schools WHERE id = ANY($1::uuid[])`, [schoolIds]);
  const nameOf = new Map(named.map((s) => [s.id.toLowerCase(), s.name]));
  if (schoolIds.some((sid) => !nameOf.has(sid.toLowerCase()))) return S.NOT_FOUND();
  const lines = R.composeNoteLines(templateId, {
    wId, schoolNames: schoolIds.map((sid) => nameOf.get(sid.toLowerCase())), dueOn, todayIso: ctx.today,
  });

  const noteId = await ctx.deps.tx(async (t) => {
    const { rows } = await t(
      `INSERT INTO coachip_rm_notes (rm_user_id, coach_user_id, sector, w_id, template_id, body_en, body_ur, due_on)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [ctx.uid, coachId, rm.sector, wId, templateId, lines.en.join('\n'), lines.ur.join('\n'), dueOn],
    );
    for (let i = 0; i < schoolIds.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await t('INSERT INTO coachip_rm_note_schools (rm_note_id, school_id, position) VALUES ($1, $2, $3)', [rows[0].id, schoolIds[i], i + 1]);
    }
    return rows[0].id;
  });
  try {
    await ctx.deps.codes.audit(ctx.uid, 'note_sent', noteId);
  } catch (err) {
    console.error('[coachip] rmNote audit failed:', err.message);
  }
  const [note] = await R.loadNotes(q, { rmUserId: ctx.uid, noteIds: [noteId], limit: 1 });
  return S.reply(201, { note, computed_at: stamp(ctx) });
}

// ── R21 POST /coachip/rm/steps ───────────────────────────────────────────────────────────────────────────────────
/**
 * Conservative reading (board m-api question, 26 Oct 11:48Z): coachip_steps holds no planned date and its CHECK ties a
 * 14-day check_by to the SET date, so `date` is accepted only when it is today (Karachi), else 400; check_by = today +
 * 14, rule 14_days; the answer's `date` is the set date. The I belongs to the W (exactly) at level sector or school.
 */
async function rmStep(ctx) {
  const { i_id: iId, w_id: wId, date } = ctx.body;
  if (date !== ctx.today) return S.BAD();
  const q = ctx.deps.query;
  await weaknessOr404(q, wId);
  const i = await interventionOr404(q, iId, [wId]);
  if (i.level !== 'sector' && i.level !== 'school') return S.NOT_FOUND();
  return ctx.deps.tx(async (t) => {
    const { rows } = await t(
      `INSERT INTO coachip_steps (coach_user_id, scope, sector, w_id, i_id, set_at, check_by, check_by_rule)
       VALUES ($1, 'sector', $2, $3, $4, $5, $6, '14_days') RETURNING id`,
      [ctx.uid, ctx.rm.sector, wId, iId, ctx.now, S.addDays(ctx.today, 14)],
    );
    const [step] = await R.loadSectorSteps(t, { rmUserId: ctx.uid, stepIds: [rows[0].id], limit: 1 });
    return S.reply(201, { step, computed_at: stamp(ctx) });
  });
}

module.exports = { createStep, tickStep, stepStatus, noteStatus, teacherName, rmNote, rmStep };
