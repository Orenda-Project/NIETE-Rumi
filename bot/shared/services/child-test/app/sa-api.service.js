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
 *                 coach asks for `full`; fixed on the session at the first fetch
 *   saBatch       per-task results (one block row each) and the device's sync state; the subtask and
 *                 hand-over events become session timings; idempotent; the battery's end completes it
 *   saPresign     a direct-to-R2 PUT for one task's recording (or one spoken answer of it)
 *   saRegister    the recording arrived: on the task's row, scored later — by the existing scorer only
 *                 with CHILD_TEST_SA_SCORE_LATER=true, otherwise parked so nothing is scored or paid for
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const saStoreOf = (deps) => (deps && deps.saStore) || require('../sa-store'); // eslint-disable-line global-require

/**
 * present / absent / refused. The phone may name the child's session itself (clientSessionId, a uuid it
 * minted while offline) and say which part of the battery the child takes (block); a present re-sent with
 * the same client id answers the session it already made.
 */
const dayOutcome = (args = {}, deps = {}) => guarded('sa_day_outcome', async ({ userId, schoolId, visitId, drawId, outcome, note, clientSessionId, block }, d) => {
  if (!OUTCOMES.includes(outcome)) return { status: 'invalid', reason: 'bad_outcome' };
  if (!drawId) return { status: 'invalid', reason: 'no_draw' };
  if (clientSessionId != null && !UUID_RE.test(String(clientSessionId))) return { status: 'invalid', reason: 'bad_client_id' };
  if (block != null && !BLOCK_IDS.includes(block) && block !== FULL) return { status: 'invalid', reason: 'bad_block' };
  const visit = await visitFor(d, userId, { schoolId, visitId });
  if (!visit) return { status: 'not_found' };
  const sa = clientSessionId && outcome === 'present' ? saStoreOf(deps) : null;
  if (sa) {
    const known = await sa.findByClient(clientSessionId);
    if (known && known.ok && known.sessionId && (await ownSession(d, userId, known.sessionId))) {
      return { status: 'ok', sessionId: known.sessionId, list: null };
    }
  }

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
  if (clientSessionId || block) {
    // The child is present either way; a phone that cannot be matched later re-sends the outcome.
    const kept = await saStoreOf(deps).setClient(created.session.id, { clientSessionId: clientSessionId || null, block: block || null });
    if (!kept || !kept.ok) d.logError('child_test.sa.client_not_kept', { sessionId: created.session.id, error: kept && kept.error });
  }
  return { status: 'ok', sessionId: created.session.id, list };
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
// the session timings an event leaves: when each subtask and each hand-over happened (device clock)
const TIMED = ['session_start', 'audio_check', 'task_start', 'task_end', 'handover_in', 'handover_out', 'coach_unlock', 'reload_resume', 'battery_end'];

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
    if (!session || session.item_bank_version !== SA_MARK) return { status: 'not_found' };
    const sa = {
      store,
      bank: deps.bank !== undefined ? deps.bank : loadBank(),
      scoreLater: deps.scoreLater !== undefined ? deps.scoreLater : process.env.CHILD_TEST_SA_SCORE_LATER === 'true',
      env: deps.env || envSegment(),
    };
    return fn({ ...a, sessionId: session.id }, d, session, sa);
  })(args, deps);
}

/** The first block, from today's place in the rotation, that no other child of this visit holds. */
async function pickBlock(d, session) {
  const visit = session.visit_id || session.visit_key;
  const got = visit ? await d.store.listSessionsForVisit(visit) : null;
  const taken = new Set(((got && got.ok && got.sessions) || [])
    .filter((s) => s.id !== session.id && s.device && s.device.block).map((s) => s.device.block));
  const day = Math.floor((d.now().getTime() + PKT_OFFSET_MS) / DAY_MS);
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
    block = full === true || full === 'true' ? FULL : await pickBlock(d, session);
    const saved = await sa.store.markSynced(sessionId, { block });
    if (!saved || !saved.ok) throw new Error((saved && saved.error) || 'markSynced failed');
    block = saved.device.block;
  }
  const order = block === FULL ? form.full : (form.blocks || {})[block];
  if (!Array.isArray(order) || !order.length) return { status: 'not_ready', reason: 'no_battery' };
  const tasks = {};
  for (const t of order) if (bank.tasks[`${formId}/${t}`]) tasks[`${formId}/${t}`] = bank.tasks[`${formId}/${t}`];
  return {
    status: 'ok',
    battery: {
      version: bank.version,
      formId,
      block,
      blockName: block === FULL ? { en: 'Full battery', ur: 'مکمل جائزہ' } : (form.block_names || {})[block] || null,
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
  const synced = await sa.store.markSynced(sessionId, {
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
  };
});

module.exports = { SA_MARK, listSchools, dayList, dayOutcome, saBattery, saBatch, saPresign, saRegister, saStatus };
