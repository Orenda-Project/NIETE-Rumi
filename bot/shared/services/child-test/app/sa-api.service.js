/**
 * The coach's Learning assessment — the self-administered battery, from the coach app.
 *
 * The coach picks the school they are visiting, gets today's children from the draw, marks each
 * one present / absent / refused, and hands the phone to the child, who takes the battery alone
 * (headphones on). This service is the bot side of that page, next to app-api.service.js (the
 * coach-recorded test) and reusing its gate, identity checks and the same draw and store:
 *
 *   listSchools   the coach's schools, today's observe visit first
 *   dayList       draw.todaysList for one school — on today's observe visit when there is one, else
 *                 on the day key day:<coach>:<school>:<PKT date> (draw/visit-key.js)
 *   dayOutcome    present / absent / refused; present opens an app-channel session marked SA_MARK
 *
 * Then the engine's sink, for one SA_MARK session of this coach's (rows: sa-store.js):
 *   saBattery     the child's part of the battery: one of the form's five blocks — the five children of a
 *                 visit get five different blocks, rotating with the day — or the whole form when the
 *                 coach asks for `full`; fixed on the session at the first fetch. With sa_block_by_history ON
 *                 (default OFF, block-history.js) the child's own earlier blocks at this school are skipped too, and a
 *                 present whose phone block the child already took gets the server's block (answered as `block`)
 *   saBatch       per-task results (one block row each) and the device's sync state; the subtask and
 *                 hand-over events become session timings; idempotent; the battery's end completes it
 *   saPresign     a direct-to-R2 PUT for one task's recording (or one spoken answer of it)
 *   saRegister    the recording arrived: on the task's row, scored later — by the existing scorer only
 *                 with CHILD_TEST_SA_SCORE_LATER=true, otherwise parked so nothing is scored or paid for
 *   saStatus      what the server holds, for the coach's visit bar
 *   saLastWordHint  the passage word where the child stopped, from the recording (sa_coach_last_word, default OFF):
 *                 the coach's tap on the last word then confirms it or picks another
 *   saResults     the session's results page: per task the SA scale, or the recording's state (read only);
 *                 an admin (asAdmin, set by the portal from sa_results_admins) reads any coach's SA session
 *   saSessions    the results dashboard: every SA session of this coach (an admin: every coach's) in saResults' shape,
 *                 with its school and sub-region; never a name
 *
 * Another phone (a teacher's, with no coach sign-in) can run one child's battery:
 *   saLink        the coach mints a signed link for one of their children's sessions (1 h)
 *   saViaLink     the sink calls from that phone, made as the coach for that session only (one phone per link
 *                 with CHILD_TEST_SA_LINK_ONE_PHONE=true)
 *
 * IDENTITY. The school must be one of the coach's (leader_schools) or the school of their own
 * observe visit; anything else is `not_found`, before the draw runs. With sa_any_school ON for the user
 * (any-school-switch.js), any live programme school (active, not a probable test school) passes too, and the list
 * holds every one of them; each school carries its EMIS and sector for the page's search.
 * PRACTICE. With child_test_practice_only ON, a coach off the pilot list passes only as practice-only
 * (app-api.service guarded's `practice`): every handler here then sees and serves their practice
 * (is_probable_test) schools only; a list, a child or a session anywhere else is `not_found`.
 * PRIVACY. What reaches the page is name · class · teacher: never a roll number or a student id,
 * and a father's name only when it is the way to tell two same-named children apart.
 * NEVER THROWS — the same status vocabulary as app-api.service.js.
 */

const crypto = require('crypto');
const { visitKeyFor } = require('../draw/visit-key');
const { BLOCK_NAMES } = require('../tasks');
const blockHistory = require('./block-history');
const rdfSwitch = require('./rdf-switch');
const rdfW3Switch = require('./rdf-w3-switch');
const resumeRepick = require('./resume-repick-switch');
const allGradesSwitch = require('./all-grades-switch');
const stopRulesSwitch = require('./stop-rules-switch');
const addChildSwitch = require('./add-child-switch');
const coachLastWord = require('./coach-last-word-switch');
const practiceOnly = require('./practice-only-switch');
const anySchool = require('./any-school-switch');
const endTestRestart = require('./end-test-restart-switch');
const dashFilters = require('./dash-filters-switch');
const { lastWordIndex } = require('../sa/last-word-hint');
const { MEDIA, envSegment, __internals: { guarded: gate, rows, ownVisit, ownSession, gradeOf } } = require('./app-api.service');

/** Every handler of the coach app's Learning assessment may run for a practice-only coach (d.practiceSchools). */
const guarded = (name, fn) => gate(name, fn, { practice: true });
/** A school this handler may use: any, or for a practice-only coach, one of their practice schools. */
const allowedSchool = (d, schoolId) => !d.practiceSchools || d.practiceSchools.has(schoolId);

const OUTCOMES = ['present', 'absent', 'refused'];
// child_test_sessions.item_bank_version of a self-administered session: the battery, not the coach's card
const SA_MARK = 'sa-battery';

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfTodayPkt(now) {
  const local = now.getTime() + PKT_OFFSET_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - PKT_OFFSET_MS);
}

async function linkedSchools(d, userId) {
  const links = await rows(d.supabase.from('leader_schools').select('school_id, school_name').eq('leader_user_id', userId));
  const out = new Map();
  for (const l of links) if (l.school_id && !out.has(l.school_id)) out.set(l.school_id, l.school_name || null);
  return out;
}

async function todaysVisits(d, userId) {
  return rows(d.supabase.from('observation_field_forms')
    .select('id, observer_user_id, created_at, visit_context, answers')
    .eq('observer_user_id', userId)
    .gte('created_at', startOfTodayPkt(d.now()).toISOString())
    .order('created_at', { ascending: false })
    .limit(5));
}

/** Every live programme school: active, not a probable test school (the filter runs here too, whatever the query did). */
async function liveSchools(d) {
  const all = await rows(d.supabase.from('schools').select('id, name, emis, region, is_active, is_probable_test').eq('is_active', true));
  return all.filter((s) => s && s.id && s.is_active !== false && s.is_probable_test !== true);
}

async function isLiveSchool(d, schoolId) {
  const found = await rows(d.supabase.from('schools').select('id, is_active, is_probable_test').eq('id', schoolId).limit(1));
  return found.some((s) => s && s.id === schoolId && s.is_active !== false && s.is_probable_test !== true);
}

const listSchools = (args = {}, deps = {}) => guarded('sa_list_schools', async ({ userId }, d) => {
  const any = await anySchool.enabledFor(userId, deps);
  const linked = await linkedSchools(d, userId);
  const visitOf = new Map();
  for (const f of await todaysVisits(d, userId)) {
    // eslint-disable-next-line no-await-in-loop
    const s = await d.draw.resolveVisitSchool({ coachUserId: userId, visitId: f.id });
    if (s && s.ok && !visitOf.has(s.schoolId)) {
      visitOf.set(s.schoolId, { visitId: f.id, observedGrade: gradeOf(f.answers && f.answers.lp_ref && f.answers.lp_ref.grade) });
    }
  }
  const live = any ? await liveSchools(d) : null;
  const ids = [...new Set([...visitOf.keys(), ...linked.keys(), ...(live || []).map((s) => s.id)])].filter((id) => allowedSchool(d, id));
  const named = live || (ids.length ? await rows(d.supabase.from('schools').select('id, name, emis, region').in('id', ids)) : []);
  const schoolOf = new Map(named.map((s) => [s.id, s]));
  const schools = ids.map((id) => {
    const v = visitOf.get(id);
    const s = schoolOf.get(id);
    return {
      schoolId: id,
      name: (s && s.name) || linked.get(id) || null,
      emis: (s && s.emis) || null,
      region: (s && s.region) || null,
      visitId: v ? v.visitId : null,
      observedGrade: v ? v.observedGrade : null,
      visitToday: !!v,
    };
  });
  schools.sort((a, b) => (b.visitToday - a.visitToday) || String(a.name || '').localeCompare(String(b.name || '')));
  return { status: 'ok', schools };
})(args, deps);

/**
 * The grade the coach named, with sa_all_grades ON: { grade } 1–5, { grade: null } when none is named or the switch
 * is off (today's list), { bad: true } for anything else.
 */
async function namedGrade(grade, deps) {
  if (grade == null || grade === '' || !(await allGradesSwitch.enabled(deps))) return { grade: null };
  const n = Number(grade);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? { grade: n } : { bad: true };
}

/**
 * Today's day key for this coach and school, for the named grade (sa_all_grades). Today's un-graded day list (drawn
 * with no grade named, or before the switch) is that grade's list when it is of that grade (RULING G-18), so a coach
 * who picks the grade they were sent never gets a second list of it.
 */
async function gradedDay(d, userId, schoolId, grade) {
  const today = visitKeyFor({ coachUserId: userId, schoolId, now: d.now() });
  if (today && (await visitListGrade(d, today)) === grade) return { schoolId, visitId: null, visitKey: today, observedGrade: null };
  const visitKey = visitKeyFor({ coachUserId: userId, schoolId, now: d.now(), grade });
  return visitKey ? { schoolId, visitId: null, visitKey, observedGrade: null } : null;
}

/** The grade of the list already drawn on an observe visit or a day key (its main rows), null when none is drawn. */
async function visitListGrade(d, visitId) {
  const got = await d.store.listVisitDraws(visitId);
  if (!got || !got.ok) throw new Error((got && got.error) || 'listVisitDraws failed');
  const rows = got.draws.filter((x) => x.list_slot);
  const main = rows.find((x) => x.list_slot === 'main') || rows[0];
  return main ? Number(main.grade) || null : null;
}

/**
 * Which visit the list belongs to: the coach's own observe visit at this school, else today's day key (per grade, if
 * named). A named grade (sa_all_grades) keeps the observe visit's list only when that list is already of that grade;
 * any other grade, or a visit with no list yet, takes the graded day key, so the visit keeps its own list.
 */
async function visitFor(d, userId, args, any = false) {
  const visit = await anyVisitFor(d, userId, args, any);
  return visit && allowedSchool(d, visit.schoolId) ? visit : null;
}

/** A school this user may open a day list at: one of theirs, or (sa_any_school ON) any live programme school. */
async function mayUseSchool(d, userId, schoolId, any) {
  if ((await linkedSchools(d, userId)).has(schoolId)) return true;
  return any === true && isLiveSchool(d, schoolId);
}

async function anyVisitFor(d, userId, { schoolId, visitId, grade = null }, any = false) {
  if (visitId) {
    const visit = await ownVisit(d, userId, visitId);
    if (!visit) return null;
    const s = await d.draw.resolveVisitSchool({ coachUserId: userId, visitId });
    if (!s || !s.ok || (schoolId && s.schoolId !== schoolId)) return null;
    if (grade && (await visitListGrade(d, visitId)) !== grade) return gradedDay(d, userId, s.schoolId, grade);
    return {
      schoolId: s.schoolId, visitId, visitKey: null,
      observedGrade: gradeOf(visit.answers && visit.answers.lp_ref && visit.answers.lp_ref.grade),
    };
  }
  if (!schoolId || !(await mayUseSchool(d, userId, schoolId, any))) return null;
  if (grade) return gradedDay(d, userId, schoolId, grade);
  const visitKey = visitKeyFor({ coachUserId: userId, schoolId, now: d.now() });
  return visitKey ? { schoolId, visitId: null, visitKey, observedGrade: null } : null;
}

const firstWord = (s) => (s ? String(s).trim().split(/\s+/)[0] || null : null);

function shapeChild(c, byDraw) {
  const namesake = c.namesakes > 1;
  const s = byDraw.get(c.drawId);
  return {
    drawId: c.drawId,
    name: c.displayName || null,
    nameUr: c.displayNameUrdu || null,
    firstName: firstWord(c.displayName),
    firstNameUr: firstWord(c.displayNameUrdu),
    grade: c.grade,
    section: c.section,
    classLabel: c.classLabel || null,
    classLabelUr: c.classLabelUr || null,
    teacherName: c.teacherName || null,
    status: c.status,
    childNo: c.childNo,
    role: c.role,
    namesake,
    ...(namesake ? { fatherName: c.fatherName || null, fatherNameUr: c.fatherNameUrdu || null } : {}),
    ...(s ? { sessionId: s.id, sessionStatus: s.status } : {}),
    // a phone that reloads mid-visit rebuilds the block rotation and the visit clock from these
    ...(s && s.device && s.device.block ? { sessionBlock: s.device.block } : {}),
    ...(s && s.started_at ? { sessionStartedAt: s.started_at } : {}),
  };
}

function shapeList(list, visit, sessions) {
  const byDraw = new Map((sessions || []).map((s) => [s.draw_id, s]));
  return {
    visit: { visitId: visit.visitId, visitKey: visit.visitKey },
    cycleId: list.cycleId,
    grade: list.grade,
    gradeFallback: !!list.gradeFallback,
    reused: !!list.reused,
    children: (list.children || []).map((c) => shapeChild(c, byDraw)),
    alternates: (list.alternates || []).map((c) => shapeChild(c, byDraw)),
  };
}

const visitArgs = (v) => (v.visitId ? { visitId: v.visitId } : { visitKey: v.visitKey });

async function sessionsOf(d, visit) {
  const got = await d.store.listSessionsForVisit(visit.visitId || visit.visitKey);
  return got && got.ok ? got.sessions : [];
}

const dayList = (args = {}, deps = {}) => guarded('sa_day_list', async ({ userId, schoolId, visitId, grade }, d) => {
  const named = await namedGrade(grade, deps);
  if (named.bad) return { status: 'invalid', reason: 'bad_grade' };
  let visit = await visitFor(d, userId, { schoolId, visitId, grade: named.grade }, await anySchool.enabledFor(userId, deps));
  if (!visit) return { status: 'not_found' };
  const draw = (v) => d.draw.todaysList({
    coachUserId: userId, schoolId: v.schoolId, observedGrade: v.observedGrade, ...visitArgs(v),
    ...(named.grade ? { grade: named.grade, allGrades: true } : {}),
  });
  let list = await draw(visit);
  // a named grade is never answered with another grade's list: the visit's list of another grade → the graded day key
  if (named.grade && visit.visitId && list && list.ok && Number(list.grade) !== named.grade) {
    visit = await gradedDay(d, userId, visit.schoolId, named.grade);
    if (!visit) return { status: 'not_found' };
    list = await draw(visit);
  }
  if (!list || !list.ok) {
    if (list && list.reason) return { status: 'invalid', reason: list.reason };
    throw new Error((list && list.error) || 'todaysList failed');
  }
  d.log('child_test.sa.list_opened', { userId, schoolId: visit.schoolId, reused: !!list.reused });
  return { status: 'ok', list: shapeList(list, visit, await sessionsOf(d, visit)) };
})(args, deps);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const saStoreOf = (deps) => (deps && deps.saStore) || require('../sa-store'); // eslint-disable-line global-require

/**
 * A present re-sent for a child who already has a session answers that session. With sa_resume_repick ON and
 * `repick`, the coach chose the part again on the card: an unfinished session moves to that block, and a phone that
 * does not know it yet (another host, a cleared phone: `known` false) takes it over under its own id, so the
 * engine's sink calls on that id reach the session.
 */
async function resumed(d, session, { block, repick, clientSessionId, known }, deps) {
  const same = { status: 'ok', sessionId: session.id, list: null };
  if (repick !== true || session.status === 'completed' || !(await resumeRepick.enabled(deps))) return same;
  if (clientSessionId && !known) {
    const kept = await saStoreOf(deps).setClient(session.id, { clientSessionId });
    if (!kept || !kept.ok) throw new Error((kept && kept.error) || 'setClient failed');
    d.log('child_test.sa.resume_claimed', { sessionId: session.id });
  }
  if (!block) return same;
  const moved = await saStoreOf(deps).setBlock(session.id, block);
  if (!moved || !moved.ok) throw new Error((moved && moved.error) || 'setBlock failed');
  d.log('child_test.sa.repick', { sessionId: session.id, block });
  return { ...same, block };
}

/**
 * Round 7b (sa_end_test_restart): Restart test for a child the coach ended early. One session per drawn child, so the
 * restart is a new attempt on it (sa-store restartAttempt): the phone's new id and block, a `restart` event. A finished
 * child, another coach's, or no phone id is refused; a re-sent restart with the same new id answers the same.
 */
async function restartChild(d, { userId, drawId, clientSessionId, block }, deps) {
  if (!(await endTestRestart.enabled(deps))) return { status: 'invalid', reason: 'restart_off' };
  if (!clientSessionId) return { status: 'invalid', reason: 'bad_client_id' };
  const got = await d.store.getSessionByDraw(drawId);
  const s = got && got.ok ? got.session : null;
  if (!s || s.coach_user_id !== userId || s.item_bank_version !== SA_MARK || !allowedSchool(d, s.school_id)) return { status: 'not_found' };
  if (s.status === 'completed') return { status: 'invalid', reason: 'completed' };
  const same = { status: 'ok', sessionId: s.id, list: null, restarted: true, ...(block ? { block } : {}) };
  if (s.client_session_id === clientSessionId) return same;
  const out = await saStoreOf(deps).restartAttempt(s.id, { clientSessionId, block: block || null, at: d.now().toISOString() });
  if (!out || !out.ok) throw new Error((out && (out.error || out.reason)) || 'restartAttempt failed');
  await d.store.recordTiming(s.id, 'sa.restarted', d.now());
  d.log('child_test.sa.restart', { userId, sessionId: s.id, attempt: out.attempt });
  return same;
}

/**
 * present / absent / refused. The phone may name the child's session itself (clientSessionId, a uuid it
 * minted while offline) and say which part of the battery the child takes (block); a present re-sent with
 * the same client id answers the session it already made.
 */
const dayOutcome = (args = {}, deps = {}) => guarded('sa_day_outcome', async ({ userId, schoolId, visitId, drawId, outcome, note, clientSessionId, block, repick, grade, restart }, d) => {
  if (!OUTCOMES.includes(outcome)) return { status: 'invalid', reason: 'bad_outcome' };
  if (!drawId) return { status: 'invalid', reason: 'no_draw' };
  if (clientSessionId != null && !UUID_RE.test(String(clientSessionId))) return { status: 'invalid', reason: 'bad_client_id' };
  if (block != null && !BLOCK_IDS.includes(block) && block !== FULL && !(block === RDF && (await rdfSwitch.enabled(deps)))
    && !(RDF_W3.includes(block) && (await rdfW3Switch.enabled(deps)))) return { status: 'invalid', reason: 'bad_block' };
  const named = await namedGrade(grade, deps);
  if (named.bad) return { status: 'invalid', reason: 'bad_grade' };
  const visit = await visitFor(d, userId, { schoolId, visitId, grade: named.grade }, await anySchool.enabledFor(userId, deps));
  if (!visit) return { status: 'not_found' };
  if (restart === true && outcome === 'present') return restartChild(d, { userId, drawId, clientSessionId, block }, deps);
  const sa = clientSessionId && outcome === 'present' ? saStoreOf(deps) : null;
  if (sa) {
    const known = await sa.findByClient(clientSessionId);
    const mine = known && known.ok && known.sessionId ? await ownSession(d, userId, known.sessionId) : null;
    if (mine) return resumed(d, mine, { block, repick, clientSessionId, known: true }, deps);
  }

  // sa_all_grades: a top-up never takes a child another of today's lists holds (RULING G-18)
  const res = await d.draw.markOutcome({ drawId, outcome, note, ...visitArgs(visit), ...(named.grade ? { allGrades: true } : {}) });
  if (!res || !res.ok) {
    if (res && res.reason === 'already_marked' && outcome === 'present') {
      const existing = await d.store.getSessionByDraw(drawId);
      const s = existing && existing.ok ? existing.session : null;
      if (s && s.coach_user_id === userId) return resumed(d, s, { block, repick, clientSessionId, known: false }, deps);
    }
    if (res && res.reason) return { status: 'invalid', reason: res.reason };
    throw new Error((res && res.error) || 'markOutcome failed');
  }
  d.log('child_test.sa.outcome', { userId, drawId, outcome });
  const list = res.list && res.list.ok ? shapeList(res.list, visit, await sessionsOf(d, visit)) : null;
  if (outcome !== 'present') return { status: 'ok', list };

  const created = await d.store.createSession({
    drawId, coachUserId: userId, channel: 'app', itemBankVersion: SA_MARK, ...visitArgs(visit),
  });
  if (!created || !created.ok || !created.session) throw new Error((created && created.error) || 'createSession failed');
  await d.store.recordTiming(created.session.id, 'sa.started', d.now());
  const byHistory = block != null && (await blockHistory.enabled(deps));
  let past;
  if (byHistory && BLOCK_IDS.includes(block)) {
    past = await historyOf(d, created.session, deps);
    if (past.has(block)) block = await pickBlock(d, created.session, past);
  }
  // the server owns the visit's rotation: a phone that lost its memory may ask for a block a visit-mate holds
  let moved = false;
  if (BLOCK_IDS.includes(block) && (await takenBlocks(d, created.session)).has(block)) {
    block = await pickBlock(d, created.session, past);
    moved = true;
  }
  if (clientSessionId || block) {
    // The child is present either way; a phone that cannot be matched later re-sends the outcome.
    const kept = await saStoreOf(deps).setClient(created.session.id, { clientSessionId: clientSessionId || null, block: block || null });
    if (!kept || !kept.ok) d.logError('child_test.sa.client_not_kept', { sessionId: created.session.id, error: kept && kept.error });
  }
  return { status: 'ok', sessionId: created.session.id, list, ...(byHistory || moved ? { block } : {}) };
})(args, deps);

// ─── a child added on the spot (sa_add_child) ─────────────────────────────

// a first name as a coach types it: letters (any script), spaces, an apostrophe, a dot or a hyphen
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'-]{0,39}$/u;
const SECTION_RE = /^[A-Za-z]{1,2}$/;

/**
 * Seat a child who is not on the roster on the coach's open list today: first name, grade, section (optional), and
 * the phone's own id for the child (a double tap is one child). With sa_all_grades the list's grade (listGrade) names
 * the day key and the child may be Grade 1–5; without it, Grade 3 or 5. The name is never logged.
 */
const addChild = (args = {}, deps = {}) => guarded('sa_add_child', async ({ userId, schoolId, visitId, grade, listGrade, firstName, section, clientChildId }, d) => {
  if (!(await addChildSwitch.enabled(deps))) return { status: 'not_found' };
  if (!UUID_RE.test(String(clientChildId || ''))) return { status: 'invalid', reason: 'bad_client_id' };
  const name = String(firstName == null ? '' : firstName).trim();
  if (!NAME_RE.test(name)) return { status: 'invalid', reason: 'bad_name' };
  const sec = section == null || String(section).trim() === '' ? null : String(section).trim();
  if (sec && !SECTION_RE.test(sec)) return { status: 'invalid', reason: 'bad_section' };
  const all = await allGradesSwitch.enabled(deps);
  const g = Number(grade);
  if (!Number.isInteger(g) || !(all ? [1, 2, 3, 4, 5] : [3, 5]).includes(g)) return { status: 'invalid', reason: 'bad_grade' };
  const named = await namedGrade(listGrade, deps);
  if (named.bad) return { status: 'invalid', reason: 'bad_grade' };
  const visit = await visitFor(d, userId, { schoolId, visitId, grade: named.grade }, await anySchool.enabledFor(userId, deps));
  if (!visit) return { status: 'not_found' };
  const out = await d.draw.addChild({
    schoolId: visit.schoolId, ...visitArgs(visit), grade: g, firstName: name, section: sec ? sec.toUpperCase() : null, clientChildId, now: d.now(),
  });
  if (!out || !out.ok) {
    if (out && out.reason) return { status: 'invalid', reason: out.reason };
    throw new Error((out && out.error) || 'addChild failed');
  }
  d.log('child_test.sa.child_added', { userId, schoolId: visit.schoolId });
  return { status: 'ok', list: shapeList(out, visit, await sessionsOf(d, visit)) };
})(args, deps);

// ─── the engine's sink ─────────────────────────────────────────────────────

const LANGS = ['ur', 'en'];
const TASK_RE = /^[a-z]{2}\.[a-z0-9_]{1,40}$/;
const ITEM_RE = /^[A-Za-z0-9_.-]{1,40}$/;
const MAX_EVENTS = 500; // the bot parses JSON bodies up to 100 kB
const MAX_RESULTS = 40;
const PRESIGN_TTL_SECONDS = 15 * 60;
const BLOCK_IDS = ['B1', 'B2', 'B3', 'B4', 'B5'];
const FULL = 'full';
// The RDF short form (switch sa_rdf_form): the form's rdf[] list, chosen on the hand-over card.
const RDF = 'rdf';
// W3 (switch sa_rdf_w3_forms): RDF auto and RDF manual, the same list (form.rdf_auto); manual = the coach instructs.
const RDF_W3 = ['rdf_auto', 'rdf_manual'];
// the session timings an event leaves: when each subtask and each hand-over happened (device clock)
const TIMED = ['session_start', 'audio_check', 'task_start', 'task_end', 'handover_in', 'handover_out', 'coach_unlock', 'reload_resume', 'battery_end'];
// the events the session keeps as they are (device.events): what the timings cannot say
// Round 7b: every skip and stop, one record each (the session, child and coach are the session row's; task_id the subtask).
const STOP_TYPES = ['back', 'end_section', 'end_test', 'restart', 'silence_repeat', 'under20_move_on'];
const KEPT = ['visibility_lost', 'resumed', 'mercy', 'early_stop_silence', 'mic_unavailable', 'voice', 'back_blocked', 'handover_in', 'handover_out', 'warmup_result', ...STOP_TYPES];
const MAX_EVENT_DATA = 300; // characters of JSON

function loadBank() {
  try {
    // eslint-disable-next-line global-require
    return require('../../../data/child-test/item-bank.sa.v1.json');
  } catch (_) {
    return null;
  }
}

/** A sink handler: guarded like the rest, on this coach's own self-administered session. */
function onSession(name, fn) {
  return (args = {}, deps = {}) => guarded(name, async (a, d) => {
    const store = saStoreOf(deps);
    let session = await ownSession(d, a.userId, a.sessionId);
    if (!session && UUID_RE.test(String(a.sessionId || ''))) {
      // the phone's own id for the child (minted offline); the server's once the outcome has synced
      const known = await store.findByClient(a.sessionId);
      if (known && known.ok && known.sessionId) session = await ownSession(d, a.userId, known.sessionId);
    }
    if (!session || session.item_bank_version !== SA_MARK || !allowedSchool(d, session.school_id)) return { status: 'not_found' };
    const sa = {
      store,
      bank: deps.bank !== undefined ? deps.bank : loadBank(),
      scoreLater: deps.scoreLater !== undefined ? deps.scoreLater : process.env.CHILD_TEST_SA_SCORE_LATER === 'true',
      env: deps.env || envSegment(),
      deps,
    };
    return fn({ ...a, sessionId: session.id }, d, session, sa);
  })(args, deps);
}

/** The form of a session's battery: the session's own form, else Form A. */
function formOf(bank, session) {
  const forms = (bank && bank.forms) || {};
  const formId = [`coach.G${session.grade}.${session.form}`, `coach.G${session.grade}.A`].find((f) => forms[f]);
  return formId ? { formId, form: forms[formId] } : null;
}

/** The blocks this child already took at this school, any cycle (block-history.js); read only with the switch on. */
async function historyOf(d, session, deps) {
  const f = formOf(deps.bank !== undefined ? deps.bank : loadBank(), session);
  if (!f) return new Set();
  return blockHistory.taken(d.store, { drawId: session.draw_id, sessionId: session.id, mark: SA_MARK, blocks: f.form.blocks });
}

/** The blocks the other sessions of this session's visit hold. */
async function takenBlocks(d, session) {
  const visit = session.visit_id || session.visit_key;
  const got = visit ? await d.store.listSessionsForVisit(visit) : null;
  return new Set(((got && got.ok && got.sessions) || [])
    .filter((s) => s.id !== session.id && s.device && s.device.block).map((s) => s.device.block));
}

/**
 * The first block, from today's place in the rotation, that no other child of this visit holds — and, given the
 * child's own `past` blocks at this school, that the child has not taken; with none left, the visit's rule alone.
 */
async function pickBlock(d, session, past = new Set()) {
  const taken = await takenBlocks(d, session);
  const day = Math.floor((d.now().getTime() + PKT_OFFSET_MS) / DAY_MS);
  for (let k = 0; past.size && k < BLOCK_IDS.length; k += 1) {
    const b = BLOCK_IDS[(day + k) % BLOCK_IDS.length];
    if (!taken.has(b) && !past.has(b)) return b;
  }
  for (let k = 0; k < BLOCK_IDS.length; k += 1) {
    const b = BLOCK_IDS[(day + k) % BLOCK_IDS.length];
    if (!taken.has(b)) return b;
  }
  return BLOCK_IDS[day % BLOCK_IDS.length];
}

const saBattery = onSession('sa_battery', async ({ sessionId, lang, full }, d, session, sa) => {
  const bank = sa.bank;
  const forms = (bank && bank.forms) || {};
  const formId = [`coach.G${session.grade}.${session.form}`, `coach.G${session.grade}.A`].find((f) => forms[f]);
  if (!formId) return { status: 'not_ready', reason: 'no_battery' };
  const form = forms[formId];

  const held = await sa.store.summary(sessionId);
  if (!held || !held.ok) throw new Error((held && held.error) || 'summary failed');
  let block = held.block;
  if (!block) {
    const whole = full === true || full === 'true';
    const past = !whole && (await blockHistory.enabled(sa.deps)) ? await historyOf(d, session, sa.deps) : undefined;
    block = whole ? FULL : await pickBlock(d, session, past);
    const saved = await sa.store.markSynced(sessionId, { block });
    if (!saved || !saved.ok) throw new Error((saved && saved.error) || 'markSynced failed');
    block = saved.device.block;
  }
  if (block === RDF && !Array.isArray(form.rdf)) return { status: 'not_ready', reason: 'rdf_unavailable', error: 'rdf_unavailable' };
  const w3 = RDF_W3.includes(block);
  if (w3 && (!Array.isArray(form[block]) || !(await rdfW3Switch.enabled(sa.deps)))) return { status: 'not_ready', reason: 'rdf_w3_unavailable', error: 'rdf_w3_unavailable' };
  const order = block === FULL ? form.full : block === RDF ? form.rdf : w3 ? form[block] : (form.blocks || {})[block];
  if (!Array.isArray(order) || !order.length) return { status: 'not_ready', reason: 'no_battery' };
  const tasks = {};
  for (const t of order) if (bank.tasks[`${formId}/${t}`]) tasks[`${formId}/${t}`] = bank.tasks[`${formId}/${t}`];
  return {
    status: 'ok',
    battery: {
      version: bank.version,
      formId,
      block,
      blockName: block === FULL ? { en: 'Full battery', ur: 'مکمل جائزہ' } : block === RDF ? form.rdf_name || { en: 'RDF', ur: 'آر ڈی ایف' }
        : w3 ? form.rdf_variants[block].name : (form.block_names || {})[block] || null,
      ...(w3 ? { manual: form.rdf_variants[block].manual === true } : {}),
      lang: LANGS.includes(lang) ? lang : 'ur',
      lines: bank.lines,
      conventions: bank.conventions,
      forms: { [formId]: { ...form, order } },
      tasks,
    },
  };
});

const isInt = (n) => Number.isInteger(n) && n >= 0;

function cleanEvent(e) {
  if (!e || typeof e !== 'object' || !isInt(e.seq) || typeof e.type !== 'string' || !e.type) return null;
  return { seq: e.seq, type: e.type, at: typeof e.at === 'string' ? e.at : null, task_id: typeof e.task_id === 'string' ? e.task_id : null };
}

function keptEvent(e) {
  let data = e.value !== undefined ? e.value : (e.data !== undefined ? e.data : null);
  try {
    if (data !== null && JSON.stringify(data).length > MAX_EVENT_DATA) data = null;
  } catch (_) {
    data = null;
  }
  return { seq: e.seq, type: e.type, task_id: typeof e.task_id === 'string' ? e.task_id : null, at: typeof e.at === 'string' ? e.at : null, data };
}

const whenOf = (e, d) => {
  const t = e.at ? Date.parse(e.at) : NaN;
  return Number.isFinite(t) ? new Date(t) : d.now();
};

const saBatch = onSession('sa_batch', async ({ sessionId, seqTo, events, results, lang, device }, d, session, sa) => {
  if (!Array.isArray(events) || !Array.isArray(results) || events.length > MAX_EVENTS || results.length > MAX_RESULTS || !isInt(seqTo)) {
    return { status: 'invalid', reason: 'bad_batch' };
  }
  const clean = events.map(cleanEvent);
  const okResult = (r) => r && typeof r === 'object' && typeof r.task_id === 'string' && TASK_RE.test(r.task_id);
  if (clean.includes(null) || !results.every(okResult)) return { status: 'invalid', reason: 'bad_batch' };

  if (results.length) {
    const put = await sa.store.putResults(sessionId, results, LANGS.includes(lang) ? lang : null);
    if (!put || !put.ok) throw new Error(`sa results: ${(put && put.error) || 'failed'}`);
  }
  for (const e of clean.filter((x) => TIMED.includes(x.type))) {
    const key = e.task_id && TASK_RE.test(e.task_id) ? `sa.${e.task_id}.${e.type}` : `sa.${e.type}`;
    // eslint-disable-next-line no-await-in-loop
    await d.store.recordTiming(sessionId, key, whenOf(e, d));
  }
  const start = clean.find((e) => e.type === 'session_start');
  const end = clean.find((e) => e.type === 'battery_end');
  const kept = events.filter((e) => KEPT.includes(e.type)).map(keptEvent);
  const synced = await sa.store.markSynced(sessionId, {
    ...(kept.length ? { events: kept } : {}),
    lastSeq: seqTo,
    device: device && typeof device === 'object' ? device : null,
    clientStartedAt: start ? whenOf(start, d).toISOString() : null,
    clientFinishedAt: end ? whenOf(end, d).toISOString() : null,
  });
  if (!synced || !synced.ok) throw new Error(`sa sync: ${(synced && synced.error) || 'failed'}`);
  if (end && session.status !== 'completed') {
    await d.store.setSessionStatus(sessionId, 'completed');
    await d.store.recordTiming(sessionId, 'sa.finished', d.now());
  }
  return { status: 'ok', ackedTo: seqTo };
});

const audioKey = (env, session, taskId, itemId, ext) => `child-test/${env}/${session.school_id}/${session.id}/sa/${taskId}${itemId ? `__${itemId}` : ''}${ext}`;

function badRecording(taskId, itemId) {
  if (!TASK_RE.test(String(taskId || ''))) return 'bad_task';
  if (itemId !== undefined && itemId !== null && !ITEM_RE.test(String(itemId))) return 'bad_item';
  return null;
}

const saPresign = onSession('sa_presign', async ({ taskId, itemId, mime, bytes }, d, session, sa) => {
  const bad = badRecording(taskId, itemId);
  if (bad) return { status: 'invalid', reason: bad };
  const type = String(mime || '').split(';')[0].trim().toLowerCase();
  const ext = MEDIA.audio.types[type];
  if (!ext) return { status: 'invalid', reason: 'wrong_type' };
  if (Number.isFinite(Number(bytes)) && Number(bytes) > MEDIA.audio.maxBytes) return { status: 'invalid', reason: 'too_large' };
  const key = audioKey(sa.env, session, taskId, itemId, ext);
  const url = await d.r2.getPresignedUploadUrl(key, type, PRESIGN_TTL_SECONDS);
  return { status: 'ok', key, url, contentType: type, expiresIn: PRESIGN_TTL_SECONDS, maxBytes: MEDIA.audio.maxBytes };
});

const saRegister = onSession('sa_register', async ({ sessionId, taskId, itemId, key }, d, session, sa) => {
  const bad = badRecording(taskId, itemId);
  if (bad) return { status: 'invalid', reason: bad };
  const minted = Object.values(MEDIA.audio.types).some((ext) => audioKey(sa.env, session, taskId, itemId, ext) === key);
  if (!minted) return { status: 'invalid', reason: 'not_your_upload' };
  const head = await d.r2.headObject(key);
  if (!head || !head.exists) return { status: 'invalid', reason: 'upload_missing' };
  // The existing scorer knows the v3 blocks' whole-task recordings, nothing else.
  const scoreLater = sa.scoreLater && !itemId && BLOCK_NAMES.includes(taskId);
  const kept = await sa.store.setAudio(sessionId, taskId, itemId || null, key, { scoreLater });
  if (!kept || !kept.ok) {
    if (kept && kept.reason === 'frozen') return { status: 'invalid', reason: 'already_scored' };
    throw new Error((kept && kept.error) || 'setAudio failed');
  }
  // CHILD_TEST_SA_SCORER=on: the SA scorer takes this session's parked recordings now (a no-op when off)
  if (!scoreLater) (sa.deps.saScorer || require('../sa/score')).kick(sessionId); // eslint-disable-line global-require
  return { status: 'ok', scoring: scoreLater ? 'queued' : 'later' };
});

const saStatus = onSession('sa_status', async ({ sessionId }, d, session, sa) => {
  const sum = await sa.store.summary(sessionId);
  if (!sum || !sum.ok) throw new Error((sum && sum.error) || 'summary failed');
  return {
    status: 'ok',
    session: { id: session.id, status: session.status, grade: session.grade, form: session.form },
    block: sum.block,
    lastSeq: sum.lastSeq,
    tasksDone: sum.tasksDone,
    audio: sum.audio,
    audioWaiting: sum.audioWaiting || [],
  };
});

// ─── the last word read, from the recording ────────────────────────────────

const HINT_TIMEOUT_MS = 25 * 1000;

/** The passage as the phone showed it: its words, and each rotation variant's (the phone's pick is not known yet). */
function passageCandidates(session, taskId, load) {
  const lang = taskId.slice(0, 2) === 'en' ? 'en' : 'ur';
  const b = load(session.grade, session.form, lang) || load(session.grade, 'A', lang);
  const t = b && Array.isArray(b.tasks) ? b.tasks.find((x) => x && x.id === taskId) : null;
  if (!t || t.kind !== 'passage') return null;
  const words = (items) => (items || []).map((x) => String(x.target != null ? x.target : x.text || ''));
  return [{ id: null, tokens: words(t.items) }, ...(t.variants || []).map((v) => ({ id: v.id || null, tokens: words(v.items) }))]
    .filter((c) => c.tokens.length);
}

function phoneBatteryFile(grade, form, lang) {
  try { return require(`../../../data/child-test/sa/sa.coach.G${grade}.${form}.${lang}.json`); } catch (_) { return null; } // eslint-disable-line global-require
}

/** The words heard on the clip (Soniox once), bounded by `signal`. */
async function hintWordsOf(key, lang, signal) {
  /* eslint-disable global-require */
  const media = require('../scoring/media');
  const stt = require('../scoring/stt');
  /* eslint-enable global-require */
  const file = await media.downloadToTemp(key, 'webm', signal);
  try {
    const dur = await media.probeDuration(file);
    return (await stt.transcribe(file, lang, dur, { signal })).words || [];
  } finally { media.cleanup(file); }
}

function bounded(ms, run) {
  const signal = AbortSignal.timeout(ms);
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error('hint_timeout'));
    signal.addEventListener('abort', fail, { once: true });
    Promise.resolve().then(() => run(signal)).then(resolve, reject).finally(() => signal.removeEventListener('abort', fail));
  });
}

const saLastWordHint = onSession('sa_last_word_hint', async ({ userId, sessionId, taskId }, d, session, sa) => {
  if (!(await coachLastWord.enabled(sa.deps, userId))) return { status: 'ok', off: true };
  if (!TASK_RE.test(String(taskId || ''))) return { status: 'invalid', reason: 'bad_task' };
  const cands = passageCandidates(session, String(taskId), sa.deps.phoneBattery || phoneBatteryFile);
  if (!cands || !cands.length) return { status: 'invalid', reason: 'not_a_passage' };
  const got = await d.store.listBlocks(sessionId);
  if (!got || !got.ok) throw new Error((got && got.error) || 'listBlocks failed');
  const row = (got.blocks || []).find((b) => b.block === taskId);
  if (!row || !row.audio_r2_key) return { status: 'ok', pending: true };
  const lang = taskId.slice(0, 2) === 'en' ? 'en' : 'ur';
  const t0 = Date.now();
  let heard;
  try {
    heard = await bounded(HINT_TIMEOUT_MS, (signal) => (sa.deps.hintWords || hintWordsOf)(row.audio_r2_key, lang, signal));
  } catch (err) {
    d.log('child_test.sa_last_word_hint', { session: String(sessionId).slice(0, 8), task: taskId, index: null, reason: 'stt_failed', error: err.message, ms: Date.now() - t0 });
    return { status: 'ok', index: null, reason: 'stt_failed' };
  }
  // the phone's rotation is not known here: the variant the words heard fit best
  const best = cands.map((c) => ({ c, r: lastWordIndex(c.tokens, heard, lang) }))
    .reduce((a, b) => (b.r.matched > a.r.matched ? b : a));
  const out = { status: 'ok', index: best.r.index, heard: heard.length, matched: best.r.matched, variant: best.c.id };
  d.log('child_test.sa_last_word_hint', { session: String(sessionId).slice(0, 8), task: taskId, index: out.index, heard: out.heard, matched: out.matched, ms: Date.now() - t0 });
  return out;
});

// ─── the coach's results page ──────────────────────────────────────────────

const numOrNull = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
const hasRecording = (r) => Boolean(r.audio_r2_key || (Array.isArray(r.audio_r2_keys) && r.audio_r2_keys.length));
const resultOf = (r) => (Array.isArray(r.responses) && r.responses.find((x) => x && x.kind === 'result')) || {};

/** A scored recording's marks: the numbers only (never a transcript, a name or a key). */
function numbersOf(marks) {
  const out = {};
  for (const [k, v] of Object.entries(marks || {})) if (numOrNull(v) !== null) out[k] = v;
  return out;
}

/**
 * sa_stop_rules: the reason a scored task names on Results (panel G-12 §5): questions not asked after the passage (or,
 * when they were asked and recorded, voided because the recording shows the reading stopped early), × not asked after
 * no right + / −, else stopped early by EGRA's (reading) or EGMA's (maths) rule; null when none.
 */
function ruleStop(r, m) {
  const d = (m && m.detail) || {};
  const block = r.block;
  if (d.stop_detail === 'comprehension') return hasRecording(r) ? 'comprehension_voided' : 'comprehension_not_asked';
  if (d.stop_detail === 'multiplication') return 'multiplication_not_asked';
  if (d.stopped_by_rule !== true) return null;
  return String(block || '').startsWith('ma.') ? 'stopped_by_rule_egma' : 'stopped_by_rule';
}

/** Why a reading task stopped early: its first row (a grid) or its first line (a passage). */
function whyOf(m) {
  const d = (m && m.detail) || {};
  if (d.stopped_by_rule !== true || d.stop_detail) return null;
  return d.kind === 'grid' ? 'first_row' : d.kind === 'passage' ? 'first_line' : null;
}

/**
 * One task's row as the coach reads it: the SA scale for tap / keypad, the recording's state for a spoken task.
 * With sa_stop_rules (`stops`), a task the scorer stopped by EGRA's rule says so in place of the phone's reason.
 */
function shapeTask(r, stops = false) {
  const m = r.ai_marks || null;
  const res = resultOf(r);
  const mode = r.response_mode || (typeof res.mode === 'string' ? res.mode : null);
  const spoken = mode === 'record' || mode === 'oral';
  const keypad = mode === 'keypad' || mode === 'keyboard';
  const tap = mode === 'tap';
  const pick = (markKey, resultKey) => numOrNull(m && m[markKey]) ?? numOrNull(res[resultKey]);
  // A spoken task without a score is "kept, scored later" — never a 0: no scorer for that task yet, or
  // CHILD_TEST_SA_SCORE_LATER off. Only a task that cannot have a recording (skipped, no microphone) is 'none'.
  const stop = (m && typeof m.stop_reason === 'string' && m.stop_reason) || (typeof res.stop_reason === 'string' ? res.stop_reason : '');
  const noRecording = !hasRecording(r) && (stop.startsWith('skipped_') || stop === 'mic_unavailable' || res.audio === 'not_kept');
  const scored = spoken && m && r.ai_status === 'scored' && Object.keys(numbersOf(m)).length > 0;
  let recording = 'none';
  if (scored) recording = 'scored';
  else if (spoken && !noRecording) recording = 'scored_later';
  return {
    taskId: r.block,
    mode,
    attempted: tap ? pick('tap_attempted', 'attempted') : keypad ? pick('keypad_attempted', 'attempted') : numOrNull(res.attempted),
    correct: tap ? pick('tap_correct', 'correct') : keypad ? pick('keypad_correct', 'correct') : (spoken ? null : numOrNull(res.correct)),
    optionsN: tap ? pick('options_n', 'options_n') : null,
    chanceCorrected: tap ? numOrNull(m && m.chance_corrected) : null,
    itemsPerMin: spoken ? null : pick('items_per_min', 'per_minute'),
    stopReason: (stops && ruleStop(r, m)) || stop || null,
    ...(stops && whyOf(m) ? { stopWhy: whyOf(m) } : {}),
    recording,
    score: recording === 'scored' ? numbersOf(m) : null,
    // the scorer heard another person in the recording (CHILD_TEST_SA_SECOND_VOICE): Results caveats the score
    ...(recording === 'scored' && m.detail && m.detail.second_voice === true ? { secondVoice: true } : {}),
  };
}

const byWhen = (a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.block).localeCompare(String(b.block));

/**
 * Read only. The header (grade, form, block, status, times, language) and one entry per task, in the order the child
 * took them. Never the child's name, roll number, student id or draw, and never a recording's key.
 */
async function resultsOf(sessionId, d, session, bank, stops = false) {
  const got = await d.store.listBlocks(sessionId);
  if (!got || !got.ok) throw new Error((got && got.error) || 'listBlocks failed');
  return shapeResults(session, got.blocks, bank, stops);
}

/** resultsOf on rows already read (the dashboard reads every session's rows at once). */
function shapeResults(session, rowsIn, bank, stops = false) {
  const blocks = (rowsIn || []).filter((r) => TASK_RE.test(String(r.block || ''))).sort(byWhen);
  const lang = (blocks.find((r) => LANGS.includes(r.lang)) || {}).lang || null;
  // each task's own name from the battery ({ en, ur }), so the page never heads a card with a code
  const f = formOf(bank, session);
  const titleOf = (taskId) => {
    const t = f && bank.tasks && bank.tasks[`${f.formId}/${taskId}`];
    return t && t.title && typeof t.title === 'object' ? { en: t.title.en || null, ur: t.title.ur || null } : null;
  };
  return {
    status: 'ok',
    session: {
      id: session.id,
      grade: session.grade,
      form: session.form,
      block: (session.device && session.device.block) || null,
      status: session.status,
      startedAt: session.started_at || null,
      endedAt: session.finished_at || session.client_finished_at || null,
      lang,
    },
    tasks: blocks.map((r) => ({ ...shapeTask(r, stops), title: titleOf(r.block) })),
  };
}

const ownResults = onSession('sa_results', async ({ sessionId }, d, session, sa) => resultsOf(sessionId, d, session, sa.bank, await stopRulesSwitch.enabled(sa.deps)));

/**
 * An admin (sa_results_admins, checked by the portal for ITS session user and sent as asAdmin: true — never taken
 * from the browser) reads any coach's self-administered session; everyone else, their own (onSession).
 */
function saResults(args = {}, deps = {}) {
  const { asAdmin, ...rest } = args;
  if (asAdmin !== true) return ownResults(rest, deps);
  return gate('sa_results_admin', async ({ userId, sessionId }, d) => {
    if (!UUID_RE.test(String(sessionId || ''))) return { status: 'not_found' };
    const got = await d.store.getSession(sessionId);
    if (!got || !got.ok) throw new Error((got && got.error) || 'getSession failed');
    const session = got.session;
    if (!session || session.item_bank_version !== SA_MARK) return { status: 'not_found' };
    d.log('child_test.sa.results_admin', { userId, sessionId });
    return resultsOf(session.id, d, session, deps.bank !== undefined ? deps.bank : loadBank(), await stopRulesSwitch.enabled(deps));
  })(rest, deps);
}

/**
 * sa_dash_filters (round 7b): what the dashboard filters and audits by, for one session. Mode: coach-led for RDF manual
 * (the coach gives the instructions), auto for every other block. Stops: the session's kept skip/stop events (STOP_TYPES),
 * in the order they happened; `by` is who did it (child, coach, app). Never a child's name, student id or draw.
 */
// the stops the dashboard shows: today's STOP_TYPES, the completion rule's (Amendment 1) and the under-20% rule's it
// replaced, so an event of either name is never dropped from the audit
const DASH_STOPS = new Set([...STOP_TYPES, 'incomplete_move_on', 'under20_move_on']);
// a child added on the spot (draw/index.js addChild) — every other draw is the random draw's
const ADDED_ALGO = 'ctd-added-on-spot-v1';
const originOf = (draw) => (!draw ? null : draw.algo_version === ADDED_ALGO || draw.seed_digest === 'added' ? 'added' : 'drawn');

function dashFieldsOf(s, coachNames, draws) {
  const device = s.device || {};
  const block = typeof device.block === 'string' ? device.block : null;
  const stops = (Array.isArray(device.events) ? device.events : [])
    .filter((e) => e && DASH_STOPS.has(e.type))
    .map((e) => {
      const data = e.data && typeof e.data === 'object' && !Array.isArray(e.data) ? e.data : null;
      return { type: e.type, taskId: typeof e.task_id === 'string' ? e.task_id : null, at: typeof e.at === 'string' ? e.at : null, by: data && typeof data.by === 'string' ? data.by : null, data };
    });
  return {
    mode: block === 'rdf_manual' ? 'coach_led' : 'auto',
    block,
    coachId: s.coach_user_id || null,
    coachName: (coachNames && coachNames.get(s.coach_user_id)) || null,
    startedAt: s.started_at || s.created_at || null,
    stops,
    origin: draws ? originOf(draws.get(s.id)) : null,
  };
}

/**
 * The results dashboard: every self-administered session of this coach (an admin, asAdmin: true as the portal sets it
 * from sa_results_admins: every coach's), each in saResults' shape with its school and sub-region (schools.region).
 * Sessions with no task rows yet are left out. Blocks and schools are read once for all sessions. Never a name.
 */
function saSessions(args = {}, deps = {}) {
  return guarded('sa_sessions', async ({ userId, asAdmin }, d) => {
    const admin = asAdmin === true;
    if (!admin && !userId) return { status: 'invalid', reason: 'no_user' };
    const got = await d.store.listSaSessions(admin ? { mark: SA_MARK, coachUserId: null, allCoaches: true } : { mark: SA_MARK, coachUserId: userId });
    if (!got || !got.ok) throw new Error((got && got.error) || 'listSaSessions failed');
    const sessions = got.sessions || [];
    if (!sessions.length) return { status: 'ok', sessions: [] };
    const blocks = await d.store.listBlocksForSessions(sessions.map((s) => s.id));
    if (!blocks || !blocks.ok) throw new Error((blocks && blocks.error) || 'listBlocksForSessions failed');
    const schoolIds = [...new Set(sessions.map((s) => s.school_id).filter(Boolean))];
    const schools = await d.store.getSchoolsByIds(schoolIds);
    if (!schools || !schools.ok) throw new Error((schools && schools.error) || 'getSchoolsByIds failed');
    const schoolOf = new Map((schools.schools || []).map((s) => [s.id, s]));
    // child_test_practice_only ON: each row says whether its school is a practice (test) school, so views can leave them out
    const practiceIds = (await practiceOnly.enabled(deps))
      ? new Set((await rows(d.supabase.from('schools').select('id').in('id', schoolIds).eq('is_probable_test', true))).map((x) => x.id))
      : null;
    const rowsOf = new Map();
    for (const r of blocks.blocks || []) {
      if (!rowsOf.has(r.session_id)) rowsOf.set(r.session_id, []);
      rowsOf.get(r.session_id).push(r);
    }
    const bank = deps.bank !== undefined ? deps.bank : loadBank();
    const stops = await stopRulesSwitch.enabled(deps);
    // sa_dash_filters (round 7b): the coaches' names, read once for every session (staff; never a child's)
    const dash = await dashFilters.enabled(deps);
    let coachNames = null;
    let draws = null;
    if (dash) {
      const named = await d.store.getUserNamesByIds([...new Set(sessions.map((s) => s.coach_user_id).filter(Boolean))]);
      if (!named || !named.ok) throw new Error((named && named.error) || 'getUserNamesByIds failed');
      coachNames = new Map((named.users || []).map((u) => [u.id, u.name || null]));
      // item 15: how each child's draw was made (added on the spot vs the random draw), read once
      const made = await d.store.getSessionDrawOrigins(sessions.map((s) => s.id));
      if (!made || !made.ok) throw new Error((made && made.error) || 'getSessionDrawOrigins failed');
      draws = new Map((made.origins || []).map((x) => [x.sessionId, x]));
    }
    const out = [];
    const stopOnly = [];
    for (const s of sessions) {
      const results = shapeResults(s, rowsOf.get(s.id), bank, stops);
      const extra = dash ? dashFieldsOf(s, coachNames, draws) : null;
      if (!results.tasks.length && !(extra && extra.stops.length)) continue;
      const school = schoolOf.get(s.school_id) || {};
      const row = { schoolId: s.school_id || null, schoolName: school.name || null, sector: school.region || null, grade: s.grade, results };
      if (practiceIds) row.practice = practiceIds.has(s.school_id);
      if (extra) Object.assign(row, extra);
      (results.tasks.length ? out : stopOnly).push(row);
    }
    d.log('child_test.sa.sessions_read', { userId, admin, n: out.length, ...(dash ? { stopOnly: stopOnly.length } : {}) });
    return dash ? { status: 'ok', sessions: out, stopSessions: stopOnly } : { status: 'ok', sessions: out };
  })(args, deps);
}

// ─── another phone ─────────────────────────────────────────────────────────

const LINK_KIND = 'sa-link';
const LINK_TTL_S = 60 * 60;
const tokens = () => require('../../quiz/web-quiz-token'); // eslint-disable-line global-require

const saLink = onSession('sa_link', async (a, d, session) => {
  const exp = Math.floor(Date.now() / 1000) + LINK_TTL_S;
  // the web quiz's signer: one secret, one HMAC rule; the kind keeps it from opening anything else
  const token = tokens().sign({ k: LINK_KIND, s: session.id, c: session.coach_user_id, exp });
  if (!token) return { status: 'error', reason: 'no_secret' };
  return { status: 'ok', token, expiresAt: new Date(exp * 1000).toISOString() };
});

const LINK_OPS = { batch: saBatch, presign: saPresign, register: saRegister, status: saStatus, 'last-word-hint': saLastWordHint };

// One phone per link (CHILD_TEST_SA_LINK_ONE_PHONE=true; off by default): the first phone to use a link keeps it for
// the link's hour. The phone's id is its own random one (sink-coach.js), never a device fingerprint. The claim is a
// Redis key named by a hash of the token; a claim store that is down lets the link work as before.
const PHONE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const linkClaims = () => require('../../cache/railway-redis.service'); // eslint-disable-line global-require

async function linkHeldByOther(token, p, phone, deps) {
  if (!PHONE_RE.test(String(phone || ''))) return true;
  const store = deps.linkClaims || linkClaims();
  const key = `ct:sa-link:${crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 32)}`;
  try {
    const ttl = Math.max(1, Math.ceil(p.exp - Date.now() / 1000));
    if (await store.setNX(key, { p: phone }, ttl)) return false;
    const held = await store.get(key);
    return !!(held && held.p) && held.p !== phone;
  } catch (_) {
    return false;
  }
}

/** A sink call from the linked phone: the token names the session and its coach; nothing else is taken from the caller. */
async function saViaLink(args = {}, deps = {}) {
  const p = tokens().verify(args.token, LINK_KIND);
  if (!p || !p.s || !p.c || (args.sessionId && args.sessionId !== p.s)) return { status: 'not_found' };
  const onePhone = deps.linkOnePhone !== undefined ? deps.linkOnePhone : process.env.CHILD_TEST_SA_LINK_ONE_PHONE === 'true';
  if (onePhone && (await linkHeldByOther(args.token, p, args.phone, deps))) return { status: 'not_found' };
  if (args.op === 'whois') return { status: 'ok', coachUserId: p.c, sessionId: p.s };
  const fn = LINK_OPS[args.op];
  if (!fn) return { status: 'invalid', reason: 'bad_op' };
  const { token, op, userId, phone, ...rest } = args; // eslint-disable-line no-unused-vars
  return fn({ ...rest, userId: p.c, sessionId: p.s }, deps);
}

module.exports = { SA_MARK, STOP_TYPES, listSchools, dayList, dayOutcome, addChild, saBattery, saBatch, saPresign, saRegister, saStatus, saLastWordHint, saResults, saSessions, saLink, saViaLink };
