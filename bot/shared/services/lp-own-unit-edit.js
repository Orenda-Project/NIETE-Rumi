'use strict';
/**
 * bd-snkn32.59 (queue #165) — her changes to a unit's outline, before any plan is made (mockup option A: the ⋯ menu
 * on each day). Pure (no I/O); days are lp-own-unit-outline days.
 *
 *   startEditing(days)          → { days, past: [] }
 *   edit(state, { op, at, dir }) → { ok: true, state } | { ok: false, error }
 *        op: move (dir −1 | +1) · join (with the next day) · split · undo
 *   checkOutline(days, built)   → { ok: true } | { ok: false, error } — the server's check on an outline sent back,
 *        against the outline built from her book (same unit, same book days, same review/test days).
 *
 * Rules: a test day stays where the book puts it (it closes its chapter) and nothing moves across it; a review or
 * test day is never joined or split; a day holds at most two book days; the two parts of a split day join back whole.
 */

const KINDS = ['lesson', 'practice', 'review', 'test'];
const MAX_UNDO = 20;
const MAX_DAYS = 80;

const fail = (error) => ({ ok: false, error });
const done = (state, days) => ({ ok: true, state: { days, past: [...state.past, state.days].slice(-MAX_UNDO) } });

function startEditing(days) {
  return { days: [...days], past: [] };
}

function move(state, at, dir) {
  const to = at + dir;
  const ds = state.days;
  if (![1, -1].includes(dir) || !ds[at] || !ds[to]) return fail('out_of_range');
  if (ds[at].kind === 'test' || ds[to].kind === 'test') return fail('test_day_fixed');
  const out = [...ds];
  [out[at], out[to]] = [out[to], out[at]];
  return done(state, out);
}

function join(state, at) {
  const [a, b] = [state.days[at], state.days[at + 1]];
  if (!a || !b) return fail('out_of_range');
  if (a.kind !== 'lesson' || b.kind !== 'lesson') return fail('not_joinable');
  let whole;
  if (a.part === 1 && b.part === 2 && a.lesson_ids[0] === b.lesson_ids[0]) {
    const { part: _p, ...rest } = a;
    whole = rest;
  } else if (a.part || b.part) return fail('not_joinable');
  else if (a.lesson_ids.length + b.lesson_ids.length > 2) return fail('too_big');
  else whole = { ...a, lesson_ids: [...a.lesson_ids, ...b.lesson_ids], topic: `${a.topic} + ${b.topic}` };
  const out = [...state.days];
  out.splice(at, 2, whole);
  return done(state, out);
}

function split(state, at) {
  const d = state.days[at];
  if (!d) return fail('out_of_range');
  if (d.kind !== 'lesson' || d.part) return fail('not_splittable');
  let two;
  if (d.lesson_ids.length === 2) {
    const topics = String(d.topic || '').split(' + ');
    two = d.lesson_ids.map((id, i) => ({ ...d, lesson_ids: [id], topic: topics.length === 2 ? topics[i] : d.topic }));
  } else two = [{ ...d, part: 1 }, { ...d, part: 2 }];
  const out = [...state.days];
  out.splice(at, 1, ...two);
  return done(state, out);
}

function edit(state, { op, at, dir } = {}) {
  if (op === 'undo') {
    if (!state.past.length) return fail('nothing_to_undo');
    return { ok: true, state: { days: state.past[state.past.length - 1], past: state.past.slice(0, -1) } };
  }
  if (!Number.isInteger(at)) return fail('out_of_range');
  if (op === 'move') return move(state, at, dir);
  if (op === 'join') return join(state, at);
  if (op === 'split') return split(state, at);
  return fail('bad_op');
}

/** The built outline's book days: id → { kind, chapter }, and the ids every outline must teach. */
function bookDays(built) {
  const kindOf = new Map();
  for (const d of built) {
    if (d.kind === 'practice') continue;
    for (const id of d.lesson_ids) kindOf.set(id, { kind: d.kind, chapter: d.chapter });
  }
  return kindOf;
}

function dayProblem(d, known) {
  if (!d || typeof d !== 'object' || !KINDS.includes(d.kind)) return 'bad_day';
  const ids = d.lesson_ids;
  if (!Array.isArray(ids) || !ids.length || !ids.every((id) => known.has(id))) return 'unknown_day';
  if (d.kind === 'practice') return ids.every((id) => known.get(id).kind === 'lesson') ? null : 'bad_day';
  if (!ids.every((id) => known.get(id).kind === d.kind)) return 'bad_day';
  if (d.kind !== 'lesson') return ids.length === 1 && !d.part ? null : 'bad_day';
  if (ids.length > 2) return 'too_big';
  if (d.part !== undefined && (![1, 2].includes(d.part) || ids.length !== 1)) return 'bad_day';
  return null;
}

function checkOutline(days, built) {
  if (!Array.isArray(days) || !days.length || days.length > MAX_DAYS) return fail('bad_outline');
  const known = bookDays(built);
  for (const d of days) {
    const p = dayProblem(d, known);
    if (p) return fail(p);
  }
  // Every book day taught (practice days do not count), each review/test exactly once.
  const taught = new Map();
  days.filter((d) => d.kind !== 'practice').forEach((d) => d.lesson_ids.forEach((id) => taught.set(id, (taught.get(id) || 0) + 1)));
  for (const [id, b] of known) {
    if (!taught.has(id)) return fail('missing_day');
    if (b.kind !== 'lesson' && taught.get(id) !== 1) return fail('bad_outline');
  }
  // A test day closes its chapter: nothing of its chapter after it, nothing of a later chapter before it.
  for (let i = 0; i < days.length; i += 1) {
    if (days[i].kind !== 'test') continue;
    const ch = known.get(days[i].lesson_ids[0]).chapter;
    const chapterOf = (d) => known.get(d.lesson_ids[0]).chapter;
    if (days.slice(i + 1).some((d) => chapterOf(d) === ch) || days.slice(0, i).some((d) => chapterOf(d) > ch)) return fail('test_day_fixed');
  }
  // A part 1 is followed by its part 2.
  for (let i = 0; i < days.length; i += 1) {
    const d = days[i];
    if (d.part === 1 && !(days[i + 1] && days[i + 1].part === 2 && days[i + 1].lesson_ids[0] === d.lesson_ids[0])) return fail('bad_outline');
    if (d.part === 2 && !(days[i - 1] && days[i - 1].part === 1 && days[i - 1].lesson_ids[0] === d.lesson_ids[0])) return fail('bad_outline');
  }
  return { ok: true };
}

module.exports = { startEditing, edit, checkOutline, MAX_UNDO, MAX_DAYS };
