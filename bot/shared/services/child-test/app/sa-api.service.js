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
 * Then the engine's sink, for one SA_MARK session of this coach's:
 *   saBattery     the battery for the session's grade and form (form A until a B exists), ur or en
 *   saBatch       events and per-task results, numbered per session; idempotent; the end completes it
 *   saPresign     a direct-to-R2 PUT for one task's recording
 *   saRegister    the recording arrived: kept on the task result, and — only with
 *                 CHILD_TEST_SA_SCORE_LATER=true — put on the task's block for the existing scorer
 *   saStatus      what the server holds, for the coach's visit bar
 *
 * IDENTITY. The school must be one of the coach's (leader_schools) or the school of their own
 * observe visit; anything else is `not_found`, before the draw runs.
 * PRIVACY. What reaches the page is name · class · teacher: never a roll number or a student id,
 * and a father's name only when it is the way to tell two same-named children apart.
 * NEVER THROWS — the same status vocabulary as app-api.service.js.
 */

const { visitKeyFor } = require('../draw/visit-key');
const { BLOCK_NAMES } = require('../tasks');
const { MEDIA, envSegment, __internals: { guarded, rows, ownVisit, ownSession, gradeOf } } = require('./app-api.service');

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

const listSchools = guarded('sa_list_schools', async ({ userId }, d) => {
  const linked = await linkedSchools(d, userId);
  const visitOf = new Map();
  for (const f of await todaysVisits(d, userId)) {
    // eslint-disable-next-line no-await-in-loop
    const s = await d.draw.resolveVisitSchool({ coachUserId: userId, visitId: f.id });
    if (s && s.ok && !visitOf.has(s.schoolId)) {
      visitOf.set(s.schoolId, { visitId: f.id, observedGrade: gradeOf(f.answers && f.answers.lp_ref && f.answers.lp_ref.grade) });
    }
  }
  const ids = [...new Set([...visitOf.keys(), ...linked.keys()])];
  const named = ids.length ? await rows(d.supabase.from('schools').select('id, name').in('id', ids)) : [];
  const nameOf = new Map(named.map((s) => [s.id, s.name]));
  const schools = ids.map((id) => {
    const v = visitOf.get(id);
    return {
      schoolId: id,
      name: nameOf.get(id) || linked.get(id) || null,
      visitId: v ? v.visitId : null,
      observedGrade: v ? v.observedGrade : null,
      visitToday: !!v,
    };
  });
  schools.sort((a, b) => (b.visitToday - a.visitToday) || String(a.name || '').localeCompare(String(b.name || '')));
  return { status: 'ok', schools };
});

/** Which visit the list belongs to: the coach's own observe visit at this school, else today's day key. */
async function visitFor(d, userId, { schoolId, visitId }) {
  if (visitId) {
    const visit = await ownVisit(d, userId, visitId);
    if (!visit) return null;
    const s = await d.draw.resolveVisitSchool({ coachUserId: userId, visitId });
    if (!s || !s.ok || (schoolId && s.schoolId !== schoolId)) return null;
    return {
      schoolId: s.schoolId, visitId, visitKey: null,
      observedGrade: gradeOf(visit.answers && visit.answers.lp_ref && visit.answers.lp_ref.grade),
    };
  }
  if (!schoolId || !(await linkedSchools(d, userId)).has(schoolId)) return null;
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

const dayList = guarded('sa_day_list', async ({ userId, schoolId, visitId }, d) => {
  const visit = await visitFor(d, userId, { schoolId, visitId });
  if (!visit) return { status: 'not_found' };
  const list = await d.draw.todaysList({
    coachUserId: userId, schoolId: visit.schoolId, observedGrade: visit.observedGrade, ...visitArgs(visit),
  });
  if (!list || !list.ok) {
    if (list && list.reason) return { status: 'invalid', reason: list.reason };
    throw new Error((list && list.error) || 'todaysList failed');
  }
  d.log('child_test.sa.list_opened', { userId, schoolId: visit.schoolId, reused: !!list.reused });
  return { status: 'ok', list: shapeList(list, visit, await sessionsOf(d, visit)) };
});

const dayOutcome = guarded('sa_day_outcome', async ({ userId, schoolId, visitId, drawId, outcome, note }, d) => {
  if (!OUTCOMES.includes(outcome)) return { status: 'invalid', reason: 'bad_outcome' };
  if (!drawId) return { status: 'invalid', reason: 'no_draw' };
  const visit = await visitFor(d, userId, { schoolId, visitId });
  if (!visit) return { status: 'not_found' };

  const res = await d.draw.markOutcome({ drawId, outcome, note, ...visitArgs(visit) });
  if (!res || !res.ok) {
    if (res && res.reason === 'already_marked' && outcome === 'present') {
      const existing = await d.store.getSessionByDraw(drawId);
      const s = existing && existing.ok ? existing.session : null;
      if (s && s.coach_user_id === userId) return { status: 'ok', sessionId: s.id, list: null };
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
  return { status: 'ok', sessionId: created.session.id, list };
});

// ─── the engine's sink ─────────────────────────────────────────────────────

const LANGS = ['ur', 'en'];
const TASK_RE = /^[a-z]{2}\.[a-z0-9_]{1,40}$/;
const MAX_EVENTS = 500; // the bot parses JSON bodies up to 100 kB
const MAX_RESULTS = 40;
const PRESIGN_TTL_SECONDS = 15 * 60;

function loadBattery(grade, form, lang) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(`../../../data/child-test/sa/sa.coach.G${grade}.${form}.${lang}.json`);
  } catch (_) {
    return null;
  }
}

/** A sink handler: guarded like the rest, on this coach's own self-administered session. */
function onSession(name, fn) {
  return (args = {}, deps = {}) => guarded(name, async (a, d) => {
    const session = await ownSession(d, a.userId, a.sessionId);
    if (!session || session.item_bank_version !== SA_MARK) return { status: 'not_found' };
    const sa = {
      store: deps.saStore || require('../sa-store'), // eslint-disable-line global-require
      loadBattery: deps.loadBattery || loadBattery,
      scoreLater: deps.scoreLater !== undefined ? deps.scoreLater : process.env.CHILD_TEST_SA_SCORE_LATER === 'true',
      env: deps.env || envSegment(),
    };
    return fn(a, d, session, sa);
  })(args, deps);
}

const saBattery = onSession('sa_battery', async ({ lang }, d, session, sa) => {
  const l = LANGS.includes(lang) ? lang : 'ur';
  const battery = sa.loadBattery(session.grade, session.form, l) || (session.form !== 'A' ? sa.loadBattery(session.grade, 'A', l) : null);
  if (!battery) return { status: 'not_ready', reason: 'no_battery' };
  return { status: 'ok', battery };
});

const isInt = (n) => Number.isInteger(n) && n >= 0;

function cleanEvent(e) {
  if (!e || typeof e !== 'object' || !isInt(e.seq) || typeof e.type !== 'string' || !e.type) return null;
  return {
    seq: e.seq,
    t_ms: Number.isFinite(e.t_ms) ? Math.round(e.t_ms) : null,
    at: typeof e.at === 'string' ? e.at : null,
    type: e.type.slice(0, 40),
    task_id: typeof e.task_id === 'string' ? e.task_id.slice(0, 60) : null,
    item_id: typeof e.item_id === 'string' ? e.item_id.slice(0, 60) : null,
    value: e.value === undefined ? null : e.value,
  };
}

const saBatch = onSession('sa_batch', async ({ sessionId, seqTo, events, results }, d, session, sa) => {
  if (!Array.isArray(events) || !Array.isArray(results) || events.length > MAX_EVENTS || results.length > MAX_RESULTS || !isInt(seqTo)) {
    return { status: 'invalid', reason: 'bad_batch' };
  }
  const clean = events.map(cleanEvent);
  const taskResults = results.map((r) => (r && typeof r === 'object' && typeof r.task_id === 'string' && TASK_RE.test(r.task_id)
    ? { task_id: r.task_id, result: r } : null));
  if (clean.includes(null) || taskResults.includes(null)) return { status: 'invalid', reason: 'bad_batch' };

  for (const [what, put, list] of [['events', sa.store.putEvents, clean], ['results', sa.store.putResults, taskResults]]) {
    if (!list.length) continue;
    // eslint-disable-next-line no-await-in-loop
    const out = await put(sessionId, list);
    if (!out || !out.ok) throw new Error(`sa ${what}: ${(out && out.error) || 'failed'}`);
  }
  if (clean.some((e) => e.type === 'battery_end') && session.status !== 'completed') {
    await d.store.setSessionStatus(sessionId, 'completed');
    await d.store.recordTiming(sessionId, 'sa.finished', d.now());
  }
  return { status: 'ok', ackedTo: seqTo };
});

const audioKey = (env, session, taskId, ext) => `child-test/${env}/${session.school_id}/${session.id}/sa/${taskId}${ext}`;

const saPresign = onSession('sa_presign', async ({ taskId, mime, bytes }, d, session, sa) => {
  if (!TASK_RE.test(String(taskId || ''))) return { status: 'invalid', reason: 'bad_task' };
  const type = String(mime || '').split(';')[0].trim().toLowerCase();
  const ext = MEDIA.audio.types[type];
  if (!ext) return { status: 'invalid', reason: 'wrong_type' };
  if (Number.isFinite(Number(bytes)) && Number(bytes) > MEDIA.audio.maxBytes) return { status: 'invalid', reason: 'too_large' };
  const key = audioKey(sa.env, session, taskId, ext);
  const url = await d.r2.getPresignedUploadUrl(key, type, PRESIGN_TTL_SECONDS);
  return { status: 'ok', key, url, contentType: type, expiresIn: PRESIGN_TTL_SECONDS, maxBytes: MEDIA.audio.maxBytes };
});

const saRegister = onSession('sa_register', async ({ sessionId, taskId, key }, d, session, sa) => {
  if (!TASK_RE.test(String(taskId || ''))) return { status: 'invalid', reason: 'bad_task' };
  const minted = Object.values(MEDIA.audio.types).some((ext) => audioKey(sa.env, session, taskId, ext) === key);
  if (!minted) return { status: 'invalid', reason: 'not_your_upload' };
  const head = await d.r2.headObject(key);
  if (!head || !head.exists) return { status: 'invalid', reason: 'upload_missing' };
  const kept = await sa.store.setResultAudio(sessionId, taskId, key);
  if (!kept || !kept.ok) throw new Error((kept && kept.error) || 'setResultAudio failed');
  if (!sa.scoreLater || !BLOCK_NAMES.includes(taskId)) return { status: 'ok', scoring: 'later' };
  const attached = await d.store.attachBlockMedia({ sessionId, block: taskId, audioR2Key: key });
  if (!attached || !attached.ok) d.logError('child_test.sa.attach_failed', { sessionId, taskId, error: attached && attached.error });
  return { status: 'ok', scoring: 'queued' };
});

const saStatus = onSession('sa_status', async ({ sessionId }, d, session, sa) => {
  const sum = await sa.store.summary(sessionId);
  if (!sum || !sum.ok) throw new Error((sum && sum.error) || 'summary failed');
  return {
    status: 'ok',
    session: { id: session.id, status: session.status, grade: session.grade, form: session.form },
    lastSeq: sum.lastSeq,
    tasksDone: sum.tasksDone,
    audio: sum.audio,
  };
});

module.exports = { SA_MARK, listSchools, dayList, dayOutcome, saBattery, saBatch, saPresign, saRegister, saStatus };
