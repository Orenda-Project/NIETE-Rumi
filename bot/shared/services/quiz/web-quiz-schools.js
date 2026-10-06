'use strict';
/**
 * The school leaderboard on the web child quiz: every school's points this week,
 * the viewer's own school (the school of the teacher who sent the quiz) marked.
 *
 * THE STAT ("school points"). The week runs Monday 00:00 Pakistan time to now.
 * Each child's FIRST finish of each quiz is worth 10 points for taking part plus
 * a tenth of its score (0-10), so 10 to 20 points a quiz. A practice re-attempt
 * adds nothing; a child counts at most 5 quizzes a Pakistan day, and a
 * challenger's invited friends at most 5 per quiz, and one phone at most 3
 * children it created that day (typed names not on the list) per quiz
 * (countedPlays). Taking part leads on purpose: scores sit close together (most
 * finishes are 80% or more) while the number of children playing differs a
 * hundredfold between schools, and the board exists to pull in the schools
 * that are not playing yet. Ranked by points, then more children, then the
 * higher average, then the name; equal points and children share a place.
 *
 * WHO COUNTS. Finished sessions on a teacher's code, attributed to the school
 * of that code's teacher (a friend's challenge code carries the same teacher,
 * so an invited friend counts for the inviter's school). Teacher self-tests
 * (user_id set), test teachers and closed schools are left out; a probable
 * test school is seen only by its own viewers (never on anyone else's board). A
 * school with no points is not ranked: the viewer's own school appears as a
 * ghost row ("no one has played yet"), the rest are a count.
 *
 * On Monday and Tuesday the child's school card also carries last week's
 * place (`mine.last_week`), only when the school was ranked last week.
 *
 * With the child's session token the board also says how many points that
 * finish `added` (absent when it did not count), for "+14 points for <School>".
 *
 * COST. One load per minute per process (single flight), shared by every
 * viewer. The first load of a week reads its finished sessions in pages of
 * 1,000 (six short columns, ~200 B a row); every later load reads only the
 * finishes since the last one, plus codes and teachers not seen before; the
 * schools list every 10 minutes. No migration.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logEvent } = require('../../utils/structured-logger');
const WebQuiz = require('./web-quiz.service');
const T = require('./web-quiz-token');

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_MS = 60 * 1000;
const MAP_TTL_MS = 60 * 60 * 1000;
const SCHOOLS_TTL_MS = 10 * 60 * 1000;
const OVERLAP_MS = 2 * 60 * 1000;
const PAGE = 1000;
const SESSION_COLS = 'id, share_code_id, student_id, invited_by_student_id, mastery_percentage, completed_at, device_ref';
const IN_CHUNK = 200;
const DAY_CAP = 5;
const FRIEND_CAP = 5;
// One phone counts at most 3 children it created today per quiz per day (siblings still fit). On
// production WhatsApp, 99.9% of (phone, quiz, day) carry one child and none more than two.
const DEVICE_NEW_CAP = 3;

/** Monday 00:00 in Pakistan (UTC+5, no DST) of the week holding `now`, as an ISO string. Pure. */
function weekStartIso(now = Date.now()) {
  const local = new Date(now + PKT_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  const back = (local.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(local.getTime() - back * DAY_MS - PKT_OFFSET_MS).toISOString();
}

function dayStartIso(now = Date.now()) {
  const local = new Date(now + PKT_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - PKT_OFFSET_MS).toISOString();
}

/** 10 for taking part plus a tenth of the score, rounded. Pure. */
function pointsFor(pct) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return 10 + Math.round(p / 10);
}

const eligible = (s) => s && s.is_active !== false && !s.is_probable_test;

const pktDay = (at) => new Date(Date.parse(at) + PKT_OFFSET_MS).toISOString().slice(0, 10);

/**
 * The plays that earn points, in time order: a child's first finish of each
 * quiz; at most DAY_CAP of a child's quizzes per Pakistan day (the video
 * library cannot farm the board); at most FRIEND_CAP invited friends per
 * challenger per quiz. Each cap keeps the earliest. Pure.
 */
function countedPlays(plays) {
  const sorted = [...(plays || [])].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const firsts = new Set();
  const perDay = new Map();
  const perInviter = new Map();
  const perDevice = new Map(); // device|quiz|day -> the children it minted that count
  const out = [];
  out.capped = [];
  for (const p of sorted) {
    const first = `${p.kid}|${p.codeId}`;
    if (firsts.has(first)) continue;
    firsts.add(first);
    const day = `${p.kid}|${pktDay(p.at)}`;
    if ((perDay.get(day) || 0) >= DAY_CAP) continue;
    if (p.minted && p.device) {
      const dk = `${p.device}|${p.codeId}|${pktDay(p.at)}`;
      const kids = perDevice.get(dk) || new Set();
      if (!kids.has(p.kid) && kids.size >= DEVICE_NEW_CAP) {
        if (!out.capped.some((c) => `${c.device}|${c.codeId}|${c.day}` === dk)) out.capped.push({ device: p.device, codeId: p.codeId, day: pktDay(p.at) });
        continue;
      }
      kids.add(p.kid);
      perDevice.set(dk, kids);
    }
    if (p.inviter) {
      const inv = `${p.inviter}|${p.codeId}`;
      if ((perInviter.get(inv) || 0) >= FRIEND_CAP) continue;
      perInviter.set(inv, (perInviter.get(inv) || 0) + 1);
    }
    perDay.set(day, (perDay.get(day) || 0) + 1);
    out.push(p);
  }
  return out;
}

/** Ranked rows from counted plays, of the schools `shown` lets through. Pure. */
function rankFrom(counted, schoolById, shown) {
  const agg = new Map();
  for (const p of counted) {
    if (!shown(schoolById.get(p.schoolId))) continue;
    const a = agg.get(p.schoolId) || { points: 0, kids: new Set(), plays: 0, pctSum: 0 };
    a.points += pointsFor(p.pct);
    a.kids.add(p.kid);
    a.plays += 1;
    a.pctSum += Math.max(0, Math.min(100, Number(p.pct) || 0));
    agg.set(p.schoolId, a);
  }
  const rows = [...agg.entries()].map(([id, a]) => {
    const s = schoolById.get(id);
    return { id, name: s.name || '', sector: s.region || null, points: a.points, kids: a.kids.size, avg: Math.round(a.pctSum / a.plays) };
  });
  rows.sort((x, y) => (y.points - x.points) || (y.kids - x.kids) || (y.avg - x.avg) || x.name.localeCompare(y.name));
  let place = 0;
  return rows.map((r, i) => {
    const prev = rows[i - 1];
    if (!prev || prev.points !== r.points || prev.kids !== r.kids || prev.avg !== r.avg) place = i + 1;
    return { ...r, place };
  });
}

/**
 * The board: every school with points, ranked; movement against the end of the
 * previous day (none when nothing was played before `splitAt`, i.e. on a
 * Monday); my school marked, or a ghost when it has no points. Pure.
 */
function scoreSchools({ plays, schools, mySchoolId, splitAt }) {
  const schoolById = new Map((schools || []).map((s) => [s.id, s]));
  // A probable test school is seen only by itself (a tester sees their own school ranked; nobody else does).
  const shown = (x) => eligible(x) || Boolean(x && mySchoolId && x.id === mySchoolId && x.is_active !== false);
  const counted = countedPlays(plays);
  const now = rankFrom(counted, schoolById, shown);
  // The caps keep the earliest plays, so yesterday's board is the counted plays before midnight.
  const before = counted.filter((p) => String(p.at) < String(splitAt));
  const prevPlace = before.length ? new Map(rankFrom(before, schoolById, shown).map((r) => [r.id, r.place])) : null;
  const moveOf = (id, place) => {
    if (!prevPlace) return null;
    return prevPlace.has(id) ? prevPlace.get(id) - place : 'new';
  };
  let mine = null;
  const rows = now.map((r) => {
    const row = { place: r.place, name: r.name, sector: r.sector, points: r.points, kids: r.kids, move: moveOf(r.id, r.place) };
    if (mySchoolId && r.id === mySchoolId) {
      row.mine = true;
      mine = { place: row.place, name: row.name, sector: row.sector, points: row.points, kids: row.kids, move: row.move };
    }
    return row;
  });
  const me = mySchoolId && schoolById.get(mySchoolId);
  if (!mine && shown(me)) {
    mine = { place: null, name: me.name || '', sector: me.region || null, points: 0, kids: 0, move: null, ghost: true };
  }
  const ranked = new Set(now.map((r) => r.id));
  const zero = (schools || []).filter((x) => shown(x) && !ranked.has(x.id));
  const zeroNames = zero.filter((x) => x.id !== mySchoolId).map((x) => x.name || '').filter(Boolean).sort((a, b) => a.localeCompare(b));
  return { rows, mine, ranked_n: rows.length, zero_n: zero.length, zero_names: zeroNames };
}

/**
 * The crop a shared image shows: my school and up to `k` schools either side,
 * so a small school's share is about it, not a wall of bigger schools. A ghost
 * (no points yet) gets the top `k` and its own ghost row. Pure.
 */
function neighbours(out, k = 3) {
  const rows = (out && out.rows) || [];
  const mine = (out && out.mine) || null;
  const i = rows.findIndex((r) => r.mine);
  if (i < 0) return { rows: rows.slice(0, k), mine };
  return { rows: rows.slice(Math.max(0, i - k), i + k + 1), mine };
}

// ─── loading (one snapshot a minute, shared) ────────────────────────────────

let snap = null; // { at, week, promise }
let codeSchool = new Map();
let teacherSchool = new Map();
let mapsAt = 0;

function _reset() { studentInfo = new Map(); cappedLogged = new Set(); snap = null; prevSnap = null; codeSchool = new Map(); teacherSchool = new Map(); mapsAt = 0; weekRows = null; schoolsCache = null; }

/** Finished sessions from `since` on (before `until` when given), appended to `acc` (ids in `seen` are skipped); returns the new cursor. */
async function finishedSince(since, acc, seen, until = null) {
  let cursor = since;
  for (;;) {
    let query = supabase.from('quiz_sessions')
      .select(SESSION_COLS)
      .eq('status', 'completed').is('user_id', null).not('share_code_id', 'is', null)
      .gte('completed_at', cursor);
    if (until) query = query.lt('completed_at', until);
    const { data, error } = await query.order('completed_at', { ascending: true }).limit(PAGE);
    if (error) throw new WebQuiz.WqError(502, { error: 'db_unavailable' });
    const page = data || [];
    for (const r of page) if (!seen.has(r.id)) { seen.add(r.id); acc.push(r); }
    const last = page.length ? page[page.length - 1].completed_at : cursor;
    if (page.length < PAGE || String(last) === String(cursor)) return last; // a full page on one instant: never loop forever
    cursor = last;
  }
}

async function inChunks(table, cols, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await supabase.from(table).select(cols).in('id', ids.slice(i, i + IN_CHUNK));
    if (error) throw new WebQuiz.WqError(502, { error: 'db_unavailable' });
    out.push(...(data || []));
  }
  return out;
}

async function schoolsOfCodes(codeIds, now) {
  if (now - mapsAt > MAP_TTL_MS) { codeSchool = new Map(); teacherSchool = new Map(); mapsAt = now; }
  const newCodes = codeIds.filter((id) => !codeSchool.has(id));
  if (newCodes.length) {
    const codes = await inChunks('quiz_share_codes', 'id, teacher_user_id, parent_share_code_id, invited_by_student_id', newCodes);
    const teachers = [...new Set(codes.map((c) => c.teacher_user_id).filter((t) => t && !teacherSchool.has(t)))];
    if (teachers.length) {
      for (const u of await inChunks('users', 'id, school_id, is_test_user', teachers)) teacherSchool.set(u.id, (!u.is_test_user && u.school_id) || null);
    }
    // A friend's challenge code plays its parent's quiz: one quiz for "first finish" and the friend cap.
    for (const c of codes) {
      const root = c.invited_by_student_id && c.parent_share_code_id ? c.parent_share_code_id : c.id;
      codeSchool.set(c.id, { schoolId: teacherSchool.get(c.teacher_user_id) || null, root, inviter: c.invited_by_student_id || null });
    }
    for (const id of newCodes) if (!codeSchool.has(id)) codeSchool.set(id, { schoolId: null, root: id, inviter: null });
  }
  return codeSchool;
}

function playOf(s, code, student) {
  if (!code || !code.schoolId) return null;
  // A child "minted" by this finish: a student row with no class list, created the same Pakistan day.
  const minted = Boolean(student && !student.list_id && student.created_at && pktDay(student.created_at) === pktDay(s.completed_at));
  return {
    sessionId: s.id, schoolId: code.schoolId, kid: s.student_id || `s:${s.id}`, codeId: code.root,
    inviter: s.invited_by_student_id || code.inviter || null, pct: s.mastery_percentage, at: s.completed_at,
    device: s.device_ref || null, minted,
  };
}

// student id -> { list_id, created_at }, looked up once per student.
let studentInfo = new Map();
async function studentsOf(ids) {
  const want = [...new Set(ids.filter((id) => id && !studentInfo.has(id)))];
  if (want.length) {
    for (const r of await inChunks('students', 'id, list_id, created_at', want)) studentInfo.set(r.id, r);
    for (const id of want) if (!studentInfo.has(id)) studentInfo.set(id, null);
  }
  return studentInfo;
}

let cappedLogged = new Set();
function logCapped(capped) {
  for (const c of capped || []) {
    const key = `${c.device}|${c.codeId}|${c.day}`;
    if (cappedLogged.has(key)) continue;
    cappedLogged.add(key);
    logEvent('web_quiz.league_provisional_capped', { code: c.codeId, device: crypto.createHash('sha256').update(String(c.device)).digest('hex').slice(0, 12) });
  }
}

// The week so far, kept between loads: each load reads only the finishes since the last one.
let weekRows = null; // { week, sessions, seen, cursor }
let schoolsCache = null; // { at, rows }

async function load(week, now) {
  const t0 = Date.now();
  if (!weekRows || weekRows.week !== week) weekRows = { week, sessions: [], seen: new Set(), cursor: week };
  const before = weekRows.sessions.length;
  // Re-read a short overlap: two replicas can commit finishes out of timestamp order. Ids dedupe.
  const from = weekRows.cursor === week ? week : new Date(Math.max(Date.parse(week), Date.parse(weekRows.cursor) - OVERLAP_MS)).toISOString();
  weekRows.cursor = await finishedSince(from, weekRows.sessions, weekRows.seen);
  const sessions = weekRows.sessions;
  const map = await schoolsOfCodes([...new Set(sessions.map((s) => s.share_code_id))], now);
  if (!schoolsCache || now - schoolsCache.at >= SCHOOLS_TTL_MS) {
    const { data, error } = await supabase.from('schools').select('id, name, region, is_active, is_probable_test');
    if (error) throw new WebQuiz.WqError(502, { error: 'db_unavailable' });
    schoolsCache = { at: now, rows: data || [] };
  }
  const schools = schoolsCache.rows;
  const info = await studentsOf(sessions.map((s) => s.student_id));
  const plays = sessions.map((s) => playOf(s, map.get(s.share_code_id), info.get(s.student_id))).filter(Boolean);
  logCapped(countedPlays(plays).capped);
  const placed = new Set(plays.map((p) => p.schoolId));
  logEvent('web_quiz.school_board_loaded', { sessions: sessions.length, fresh: sessions.length - before, plays: plays.length, schools: placed.size, ms: Date.now() - t0 });
  return { plays, schools };
}

// Last week's final board, read once an hour and only on Monday and Tuesday (the days a reset hides a win).
let prevSnap = null; // { week, at, promise }
const LAST_WEEK_DAYS = 2;
const PREV_TTL_MS = 60 * 60 * 1000;

function showsLastWeek(now) {
  return now - Date.parse(weekStartIso(now)) < LAST_WEEK_DAYS * DAY_MS;
}

async function loadPrev(prevWeek, week, now) {
  const sessions = [];
  await finishedSince(prevWeek, sessions, new Set(), week);
  const map = await schoolsOfCodes([...new Set(sessions.map((s) => s.share_code_id))], now);
  const info = await studentsOf(sessions.map((s) => s.student_id));
  const { schools } = await snapshot(now);
  logEvent('web_quiz.school_board_last_week_loaded', { sessions: sessions.length });
  return { plays: sessions.map((s) => playOf(s, map.get(s.share_code_id), info.get(s.student_id))).filter(Boolean), schools };
}

function lastWeekData(now) {
  const week = weekStartIso(now);
  const prevWeek = new Date(Date.parse(week) - 7 * DAY_MS).toISOString();
  if (!prevSnap || prevSnap.week !== week || now - prevSnap.at >= PREV_TTL_MS) {
    const promise = loadPrev(prevWeek, week, now);
    prevSnap = { at: now, week, promise };
    promise.catch(() => { if (prevSnap && prevSnap.promise === promise) prevSnap = null; });
  }
  return prevSnap.promise;
}

function snapshot(now, { force = false } = {}) {
  const week = weekStartIso(now);
  if (!snap || snap.week !== week || now - snap.at >= CACHE_MS || (force && snap.done)) {
    const promise = load(week, now);
    const entry = { at: now, week, promise, done: false };
    snap = entry;
    promise.then(() => { entry.done = true; }, () => { if (snap === entry) snap = null; });
  }
  return snap.promise;
}

/**
 * The points one finished session added to its school (`added`, present only
 * when it counted: a first finish, under both caps), and the plays to score
 * this response with. A session that finished after the minute's load is read
 * on its own and added for THIS response only, so the child who just finished
 * sees their own finish at once (never "no one has played yet"); the shared
 * snapshot is untouched and picks it up at the next load.
 */
async function addedBy(st, data, week, now) {
  const none = { added: undefined, plays: data.plays };
  const tok = T.verify(st, 's');
  if (!tok || !tok.sid) return none;
  let plays = data.plays;
  if (!plays.some((p) => p.sessionId === tok.sid)) {
    // Newer than the minute's snapshot: read everything since it (incremental), so the caps see every
    // finish that came before this one — a friend inside one cache minute is capped like any other.
    const { data: s } = await supabase.from('quiz_sessions').select('id, status, user_id, completed_at').eq('id', tok.sid).maybeSingle();
    if (!s || s.status !== 'completed' || s.user_id || !s.completed_at || String(s.completed_at) < week) return none;
    plays = (await snapshot(now, { force: true })).plays;
  }
  const counted = countedPlays(plays).find((p) => p.sessionId === tok.sid);
  return counted ? { added: pointsFor(counted.pct), plays } : { added: undefined, plays };
}

/** GET /schools/:code — the board the page shows, the viewer's school from the quiz code. */
async function board(code, { now = Date.now(), st } = {}) {
  // The same on/off switch as every web quiz route: off, nothing is read.
  if (!T.secret()) throw new WebQuiz.WqError(503, { error: 'web_quiz_off' });
  const ctx = await WebQuiz.resolveCode(code);
  const data = await snapshot(now);
  let mySchoolId = null;
  if (ctx.teacherUserId) {
    if (teacherSchool.has(ctx.teacherUserId)) mySchoolId = teacherSchool.get(ctx.teacherUserId);
    else {
      const { data: u } = await supabase.from('users').select('id, school_id, is_test_user').eq('id', ctx.teacherUserId).maybeSingle();
      mySchoolId = (u && !u.is_test_user && u.school_id) || null;
    }
  }
  const fresh = st ? await addedBy(st, data, weekStartIso(now), now) : { added: undefined, plays: data.plays };
  const out = scoreSchools({ plays: fresh.plays, schools: data.schools, mySchoolId, splitAt: dayStartIso(now) });
  // Monday and Tuesday: last week's place, only for a school that was ranked (never "not ranked").
  if (out.mine && showsLastWeek(now)) {
    const prev = await lastWeekData(now);
    const last = scoreSchools({ plays: prev.plays, schools: prev.schools, mySchoolId, splitAt: weekStartIso(now) });
    if (last.mine && last.mine.place) out.mine.last_week = { place: last.mine.place, of: last.ranked_n };
  }
  const week = new Date(Date.parse(weekStartIso(now)) + PKT_OFFSET_MS).toISOString().slice(0, 10);
  return { week_start: week, ...out, ...(fresh.added ? { added: fresh.added } : {}) };
}

module.exports = { board, scoreSchools, countedPlays, neighbours, pointsFor, weekStartIso, dayStartIso, CACHE_MS, _reset };
