'use strict';
/**
 * The school leaderboard on the web child quiz: every school's points this week,
 * the viewer's own school (the school of the teacher who sent the quiz) marked.
 *
 * THE STAT ("school points"). The week runs Monday 00:00 Pakistan time to now.
 * Each child's FIRST finish of each quiz is worth 10 points for taking part plus
 * a tenth of its score (0-10), so 10 to 20 points a quiz. A practice re-attempt
 * adds nothing; a child counts at most 5 quizzes a Pakistan day, and a
 * challenger's invited friends at most 5 per quiz (countedPlays). Taking part leads on purpose: scores sit close together (most
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
 * With the child's session token the board also says how many points that
 * finish `added` (absent when it did not count), for "+14 points for <School>".
 *
 * COST. One load per minute per process (single flight), shared by every
 * viewer. The first load of a week reads its finished sessions in pages of
 * 1,000 (six short columns, ~200 B a row); every later load reads only the
 * finishes since the last one, plus codes and teachers not seen before; the
 * schools list every 10 minutes. No migration.
 */
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
const SESSION_COLS = 'id, share_code_id, student_id, invited_by_student_id, mastery_percentage, completed_at';
const IN_CHUNK = 200;
const DAY_CAP = 5;
const FRIEND_CAP = 5;

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
  const out = [];
  for (const p of sorted) {
    const first = `${p.kid}|${p.codeId}`;
    if (firsts.has(first)) continue;
    firsts.add(first);
    const day = `${p.kid}|${pktDay(p.at)}`;
    if ((perDay.get(day) || 0) >= DAY_CAP) continue;
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

function _reset() { snap = null; codeSchool = new Map(); teacherSchool = new Map(); mapsAt = 0; weekRows = null; schoolsCache = null; }

/** Finished sessions from `since` on, appended to `acc` (ids in `seen` are skipped); returns the new cursor. */
async function finishedSince(since, acc, seen) {
  let cursor = since;
  for (;;) {
    const { data, error } = await supabase.from('quiz_sessions')
      .select(SESSION_COLS)
      .eq('status', 'completed').is('user_id', null).not('share_code_id', 'is', null)
      .gte('completed_at', cursor).order('completed_at', { ascending: true }).limit(PAGE);
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

function playOf(s, code) {
  if (!code || !code.schoolId) return null;
  return {
    sessionId: s.id, schoolId: code.schoolId, kid: s.student_id || `s:${s.id}`, codeId: code.root,
    inviter: s.invited_by_student_id || code.inviter || null, pct: s.mastery_percentage, at: s.completed_at,
  };
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
  const plays = sessions.map((s) => playOf(s, map.get(s.share_code_id))).filter(Boolean);
  const placed = new Set(plays.map((p) => p.schoolId));
  logEvent('web_quiz.school_board_loaded', { sessions: sessions.length, fresh: sessions.length - before, plays: plays.length, schools: placed.size, ms: Date.now() - t0 });
  return { plays, schools };
}

function snapshot(now) {
  const week = weekStartIso(now);
  if (!snap || snap.week !== week || now - snap.at >= CACHE_MS) {
    const promise = load(week, now);
    snap = { at: now, week, promise };
    promise.catch(() => { if (snap && snap.promise === promise) snap = null; });
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
  let mine = plays.find((p) => p.sessionId === tok.sid);
  if (!mine) {
    const { data: s } = await supabase.from('quiz_sessions').select(`${SESSION_COLS}, status, user_id`).eq('id', tok.sid).maybeSingle();
    if (!s || s.status !== 'completed' || s.user_id || !s.completed_at || String(s.completed_at) < week) return none;
    const map = await schoolsOfCodes([s.share_code_id], now);
    mine = playOf(s, map.get(s.share_code_id));
    if (!mine) return none;
    plays = [...plays, mine];
  }
  const counted = countedPlays(plays).find((p) => p.sessionId === tok.sid);
  return counted ? { added: pointsFor(counted.pct), plays } : none;
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
  const week = new Date(Date.parse(weekStartIso(now)) + PKT_OFFSET_MS).toISOString().slice(0, 10);
  return { week_start: week, ...out, ...(fresh.added ? { added: fresh.added } : {}) };
}

module.exports = { board, scoreSchools, countedPlays, neighbours, pointsFor, weekStartIso, dayStartIso, CACHE_MS, _reset };
