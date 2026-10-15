'use strict';
/**
 * The once-a-term class round in a locked mode on the teacher's phone (app_settings web_quiz_class_round, effective
 * only with web_quiz_challenge_v2 and web_quiz_challenge on). Server state only: the round's order, each position's
 * status and the open turn live in class_round_draws.state; nothing is kept on the teacher's browser.
 *
 *   state = { order: [{ id, s: 'todo'|'absent'|'done', g?: [games stored], run?, h?: 1 (first name shared) }],
 *             cur: index of the child called last | null, turn: 'child' | null }
 *
 *   start(teacherId)              fixes a server-random order (crypto, or an injected generator in tests) of the
 *                                 class's active roster, once; class_round_started{round, cls, present_k}
 *   absent(teacherId, pos)        marks a position absent (it stays on the list); class_round_absent{round, cls, pos}
 *   next(teacherId, body)         the long-press only (act=hold, hold ≥ 600 ms): calls the next child still to play
 *   toTeacher(teacherId, body)    the long-press only: closes the child's turn, back to the teacher's screen; the
 *                                 round closes here (or at the last absent) when no position is left to play
 *   childFinished(round, id, run) the child's round games are stored: done (ticked), class_round_child_done + kid,
 *                                 child_identity.confirmed_at / confirmed_by = 'class_round'
 *   entryOf / runColumns          the Challenge's side: a round turn token plays as the called child only while the
 *                                 switch is on, the round open and THIS child's turn open
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const T = require('./web-quiz-token');
const Flags = require('./web-quiz-class-round-flags');
const Events = require('./web-quiz-class-round-events');
const { termCode, termBounds, shuffle, cryptoRng, K_COUNTED } = require('./web-quiz-class-round-sampler');
const Page = require('../../templates/class-round.page');

const HOLD_MS = Page.HOLD_MS;
const TURN_TTL_S = 2 * 3600;
const ROUND_RX = /^[0-9a-f]{16}$/;
const DRAW_COLS = 'id, round, term_code, class_id, stratum, roster_k, k_counted, window_start, window_end, drawn_at, accepted_at, declined_at, started_at, ran_at, finished_at, children_present, children_played, state';
// The round's games: the two tap games (no microphone on the teacher's phone, no read-aloud).
const GAMES = Object.freeze(['bigger', 'missing']);

const clone = (s) => JSON.parse(JSON.stringify(s));
const held = (body) => !!body && body.act === 'hold' && Number(body.hold) >= HOLD_MS;

/** The teacher's open draw this term (drawn, not finished), or null. */
async function openDrawFor(teacherId, { now = Date.now() } = {}) {
  if (!teacherId) return null;
  const { data: links, error } = await supabase.from('class_teachers').select('id, class_id, is_active')
    .eq('teacher_user_id', teacherId).eq('is_active', true);
  if (error) throw new Error(`class_teachers: ${error.message}`);
  const classIds = [...new Set((links || []).map((l) => l.class_id).filter(Boolean))];
  if (!classIds.length) return null;
  const { data: draws, error: dErr } = await supabase.from('class_round_draws').select(DRAW_COLS)
    .in('class_id', classIds).eq('term_code', termCode(now)).is('finished_at', null).order('drawn_at', { ascending: true });
  if (dErr) throw new Error(`class_round_draws: ${dErr.message}`);
  for (const d of draws || []) {
    if (await live(d, now)) return d;
  }
  return null;
}

const msOf = (t) => (t ? Date.parse(t) : NaN);
/**
 * A draw is live inside [window_start, window_end), not declined, not finished. A started round found after its
 * window's end is closed there, as it stands (the positions not reached are nonresponse; never carried over).
 */
async function live(d, now = Date.now()) {
  if (!d || d.finished_at || d.declined_at) return false;
  const ws = msOf(d.window_start);
  const we = msOf(d.window_end);
  if (!Number.isFinite(ws) || !Number.isFinite(we)) return false;
  if (now >= we) {
    if (d.started_at && d.state) await closeRound(d, { now: we });
    return false;
  }
  return now >= ws;
}

async function drawByRound(round) {
  if (!ROUND_RX.test(String(round || ''))) return null;
  const { data, error } = await supabase.from('class_round_draws').select(DRAW_COLS).eq('round', round).maybeSingle();
  if (error) throw new Error(`class_round_draws: ${error.message}`);
  return data || null;
}

/** Positions 1..k (index < k) are counted; later ones play as practice. The server decides; nothing shows it. */
const modeAt = (draw, i) => (i < (Number(draw.k_counted) || K_COUNTED) ? 'class_round' : 'practice');

async function save(draw, patch) {
  const { error } = await supabase.from('class_round_draws').update(patch).eq('id', draw.id);
  if (error) throw new Error(`class_round_draws: ${error.message}`);
  Object.assign(draw, patch);
  return draw;
}

const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';

/** id → the name the screens show: the first name, with the next word's initial when two children share it. */
async function namesOf(ids) {
  if (!ids.length) return new Map();
  const { data, error } = await supabase.from('students').select('id, student_name').in('id', ids);
  if (error) throw new Error(`students: ${error.message}`);
  const full = new Map((data || []).map((s) => [s.id, String(s.student_name || '').trim()]));
  const seen = new Map();
  ids.forEach((id) => { const f = firstName(full.get(id)).toLowerCase(); seen.set(f, (seen.get(f) || 0) + 1); });
  return new Map(ids.map((id) => {
    const words = String(full.get(id) || '').split(/\s+/).filter(Boolean);
    const f = words[0] || '';
    const shared = seen.get(f.toLowerCase()) > 1;
    return [id, { name: shared && words[1] ? `${f} ${words[1][0]}.` : f, shared }];
  }));
}

/** Start: the order is fixed once (a second Start changes nothing). Off / no open draw → null. */
async function start(teacherId, { rng = cryptoRng, now = Date.now() } = {}) {
  if (!(await Flags.roundOn())) return null;
  const draw = await openDrawFor(teacherId, { now });
  if (!draw) return null;
  if (draw.started_at && draw.state) return draw;
  const { data: enr, error } = await supabase.from('class_enrollments').select('id, student_id, is_active')
    .eq('class_id', draw.class_id).eq('is_active', true);
  if (error) throw new Error(`class_enrollments: ${error.message}`);
  const ids = [...new Set((enr || []).map((e) => e.student_id).filter(Boolean))].sort();
  const names = await namesOf(ids);
  const order = shuffle(ids, rng).map((id) => ({ id, s: 'todo', ...(names.get(id) && names.get(id).shared ? { h: 1 } : {}) }));
  const patch = { started_at: new Date(now).toISOString(), accepted_at: new Date(now).toISOString(), state: { order, cur: null, turn: null, paused: false } };
  // Only the first Start writes: a race between two presses keeps one order.
  const { data: won, error: uErr } = await supabase.from('class_round_draws').update(patch).eq('id', draw.id).is('started_at', null).select('id');
  if (uErr) throw new Error(`class_round_draws: ${uErr.message}`);
  if (!won || !won.length) return drawByRound(draw.round);
  Object.assign(draw, patch);
  await Events.emit('class_round_started', { round: draw.round, present_k: order.length }, { classId: draw.class_id });
  return draw;
}

/**
 * Close the round: on the teacher's long-press with nobody left to call, or at the window's end. Never by itself when
 * the last child finishes. Writes ran_at / children_present / children_played; class_round_finished once.
 */
async function closeRound(draw, { now = Date.now() } = {}) {
  const st = draw.state;
  if (!st || draw.finished_at) return false;
  const k = Number(draw.k_counted) || K_COUNTED;
  const doneK = st.order.filter((p) => p.s === 'done').length;
  const absentK = st.order.filter((p) => p.s === 'absent').length;
  const declinedK = st.order.filter((p) => p.s === 'declined').length;
  const countedK = st.order.filter((p, i) => p.s === 'done' && i < k).length;
  const presentK = st.order.length - absentK;
  const startedMs = Date.parse(draw.started_at) || now;
  const { data: won, error } = await supabase.from('class_round_draws')
    .update({ finished_at: new Date(now).toISOString(), ran_at: draw.started_at, children_present: presentK, children_played: doneK })
    .eq('id', draw.id).is('finished_at', null).select('id');
  if (error) throw new Error(`class_round_draws: ${error.message}`);
  if (!won || !won.length) return false;
  draw.finished_at = new Date(now).toISOString();
  await Events.emit('class_round_finished', {
    round: draw.round, roster_k: Number(draw.roster_k) || st.order.length, present_k: presentK, done_k: doneK, absent_k: absentK,
    declined_k: declinedK, counted_k: countedK, mins: Math.max(0, Math.round((now - startedMs) / 60000)),
  }, { classId: draw.class_id });
  return true;
}

async function openStarted(teacherId) {
  if (!(await Flags.roundOn())) return null;
  const draw = await openDrawFor(teacherId);
  return draw && draw.started_at && draw.state ? draw : null;
}

/** Mark a position still to play absent or declined (teacher's screen only; never asked twice). */
async function mark(teacherId, pos, status) {
  const draw = await openStarted(teacherId);
  if (!draw || draw.state.turn) return { ok: false, draw };
  const i = Number(pos);
  const st = clone(draw.state);
  if (!Number.isInteger(i) || i < 0 || i >= st.order.length || st.order[i].s !== 'todo') return { ok: false, draw };
  st.order[i].s = status;
  await save(draw, { state: st });
  await Events.emit(status === 'absent' ? 'class_round_absent' : 'class_round_declined', { round: draw.round, pos: i }, { classId: draw.class_id });
  return { ok: true, draw };
}
const absent = (teacherId, pos) => mark(teacherId, pos, 'absent');
/** A child's "not today": equal weight to absent, nonresponse, on the teacher's screen only. */
const declined = (teacherId, pos) => mark(teacherId, pos, 'declined');

/** Pause for today / resume: the order and every mark are kept; "next" is refused while paused. */
async function pause(teacherId, on) {
  const draw = await openStarted(teacherId);
  if (!draw || draw.state.turn || !!draw.state.paused === on) return { ok: false, draw };
  const st = clone(draw.state);
  st.paused = on;
  await save(draw, { state: st });
  if (on) await Events.emit('class_round_paused', { round: draw.round, done_k: st.order.filter((p) => p.s === 'done').length }, { classId: draw.class_id });
  return { ok: true, draw };
}

/** "Not this term": one tap on the card, before the round starts; no message is sent. */
async function notThisTerm(teacherId) {
  if (!(await Flags.roundOn())) return { ok: false, draw: null };
  const draw = await openDrawFor(teacherId);
  if (!draw || draw.started_at) return { ok: false, draw };
  const { data: won, error } = await supabase.from('class_round_draws').update({ declined_at: new Date().toISOString() })
    .eq('id', draw.id).is('started_at', null).is('declined_at', null).select('id');
  if (error) throw new Error(`class_round_draws: ${error.message}`);
  if (!won || !won.length) return { ok: false, draw };
  await Events.emit('class_round_class_declined', { round: draw.round }, { classId: draw.class_id });
  return { ok: true, draw };
}

/** "Next child": the long-press only, from the teacher's screen; the first position still to play in the order. */
async function next(teacherId, body) {
  const draw = await openStarted(teacherId);
  if (!draw || draw.state.turn || draw.state.paused || !held(body)) return { ok: false, draw };
  const st = clone(draw.state);
  const i = st.order.findIndex((p) => p.s === 'todo');
  // nobody left to call: the long-press closes the round
  if (i < 0) return { ok: true, draw, closed: await closeRound(draw) };
  st.cur = i;
  st.turn = 'child';
  await save(draw, { state: st });
  return { ok: true, draw };
}

/** Back to the teacher's screen: the long-press only. Closes the round when nothing is left to play. */
async function toTeacher(teacherId, body) {
  const draw = await openStarted(teacherId);
  if (!draw || !draw.state.turn || !held(body)) return { ok: false, draw };
  const st = clone(draw.state);
  st.turn = null;
  await save(draw, { state: st });
  return { ok: true, draw };
}

/** The open turn's position when it is this child's and still to play (switch on, round started, not finished). */
async function openTurn(round, studentId) {
  if (!(await Flags.roundOn())) return null;
  const draw = await drawByRound(round);
  if (!draw || !(await live(draw)) || !draw.started_at || !draw.state || draw.state.turn !== 'child') return null;
  const p = draw.state.order[draw.state.cur];
  if (!p || p.id !== studentId || p.s !== 'todo') return null;
  return { draw, p, mode: modeAt(draw, draw.state.cur) };
}

/** The called child is done: ticked, the event with the hashed key, the identity promotion. */
async function childFinished(round, studentId, runId, { now = Date.now() } = {}) {
  const t = await openTurn(round, studentId);
  if (!t) return false;
  const { draw } = t;
  const st = clone(draw.state);
  Object.assign(st.order[st.cur], { s: 'done', run: runId || null });
  await save(draw, { state: st });
  await Events.emit('class_round_child_done', { round: draw.round, run: runId || null }, { classId: draw.class_id, childId: studentId });
  try {
    const { error } = await supabase.from('child_identity').update({ confirmed_at: new Date(now).toISOString(), confirmed_by: 'class_round' }).eq('canonical_id', studentId);
    if (error) logToFile('class round: child_identity not promoted', { round: draw.round, error: error.message });
  } catch (err) {
    logToFile('class round: child_identity not promoted', { round: draw.round, error: err.message });
  }
  return true;
}

/** A round game stored for the open turn: the child is done once every round game on today is stored. */
async function gameStored(round, studentId, ex, runId, { games = ['bigger'] } = {}) {
  const t = await openTurn(round, studentId);
  if (!t) return false;
  const st = clone(t.draw.state);
  const p = st.order[st.cur];
  p.g = [...new Set([...(p.g || []), ex])];
  if (games.every((g) => p.g.includes(g))) return childFinished(round, studentId, runId);
  await save(t.draw, { state: st });
  return false;
}

/** The link into the Challenge for the open turn: { k:'r', rd, sid, exp }. */
function turnToken(round, studentId) {
  if (!ROUND_RX.test(String(round || '')) || !studentId) return null;
  return T.sign({ k: 'r', rd: round, sid: studentId, exp: Math.floor(Date.now() / 1000) + TURN_TTL_S });
}

/** The Challenge's entry for a round turn token's claims, or null (refused). */
async function entryOf(claims) {
  const t = claims && (await openTurn(claims.rd, claims.sid));
  if (!t) return null;
  return { studentId: claims.sid, via: 'class_round', round: t.draw.round, classId: t.draw.class_id, roundMode: t.mode };
}

/** The run row's round columns for a challenge token's round claim, or null (refused: nothing is stored). */
async function runColumns(round, studentId, ex = null) {
  const t = await openTurn(round, studentId);
  if (!t) return null;
  // One round run per child per game per term (NC4): an earlier one, in any round of this term, refuses this one.
  if (ex) {
    if ((t.p.g || []).includes(ex)) return null;
    const b = termBounds(t.draw.term_code);
    const { data: prior, error } = await supabase.from('web_quiz_challenge_runs').select('id, student_id, exercise, via, created_at')
      .eq('student_id', studentId).eq('via', 'class_round').eq('exercise', ex).gte('created_at', new Date(b ? b.start : 0).toISOString()).limit(1);
    if (error) throw new Error(`web_quiz_challenge_runs: ${error.message}`);
    if (prior && prior.length) return null;
  }
  return { mode: t.mode, via: 'class_round', id_src: 'class_round', id_confidence: 'high', class_id: t.draw.class_id,
    canonical_id: studentId, homonym_in_list: !!t.p.h };
}

/** The card on the teacher's class tab: '' unless the switch is on and the teacher's class has an open draw. */
async function cardFor(teacherId, { lang, token } = {}) {
  try {
    if (!(await Flags.roundOn())) return '';
    const draw = await openDrawFor(teacherId);
    return draw && !draw.started_at ? Page.renderCard({ lang, token }) : (draw ? Page.renderCard({ lang, token, started: true }) : '');
  } catch (err) {
    logToFile('⚠️ class round: card not shown', { error: err.message }, 'warn');
    return '';
  }
}

/** The round page for the teacher's phone, or null (404). During an open turn only the child's screens render. */
async function screen(teacherId, { lang, token } = {}) {
  if (!(await Flags.roundOn())) return null;
  const draw = await openDrawFor(teacherId);
  if (!draw) return null;
  if (!draw.started_at || !draw.state) return Page.renderRound({ mode: 'start', rows: [] }, { lang, token });
  const st = draw.state;
  const names = await namesOf(st.order.map((p) => p.id));
  const rows = st.order.map((p, i) => ({ pos: i, name: (names.get(p.id) || {}).name || '', s: p.s, now: i === st.cur }));
  if (st.turn === 'child') {
    const cur = st.order[st.cur];
    const mode = cur.s === 'done' ? 'handback' : 'child';
    const l = lang === 'ur' ? 'ur' : 'en';
    const tt = mode === 'child' ? turnToken(draw.round, cur.id) : null;
    return Page.renderRound({ mode, rows, current: { name: rows[st.cur].name } }, { lang, token, turnHref: tt ? `/c/${tt}?lang=${l}` : null });
  }
  return Page.renderRound({ mode: 'teacher', rows, paused: !!st.paused }, { lang, token });
}

module.exports = {
  start, absent, declined, pause, notThisTerm, closeRound, next, toTeacher, childFinished, gameStored, turnToken, entryOf, runColumns, cardFor, screen, openDrawFor,
  shuffle, held, GAMES, HOLD_MS, TURN_TTL_S,
};
