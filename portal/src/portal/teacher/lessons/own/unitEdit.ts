/**
 * bd-snkn32.59.1 (queue #165) — her changes to a unit's days before any plan is made (mockup option A: the ⋯ menu on
 * each day): move, join with the next day, split, undo. Pure. The same rules as the server's
 * bot/shared/services/lp-own-unit-edit.js, which checks the outline again when she saves (this copy only decides what
 * the menu offers and shows the change at once).
 *
 * A test day stays where the book puts it and nothing moves across it; a review or test day is never joined or split;
 * a day holds at most two book days; the two parts of a split day join back whole.
 */

export type UnitKind = 'lesson' | 'practice' | 'review' | 'test';
export type UnitDay = { kind: UnitKind; chapter: number; lesson_ids: string[]; topic: string; part?: 1 | 2 };
export type EditState = { days: UnitDay[]; past: UnitDay[][] };
export type EditOp = { op: 'move'; at: number; dir: 1 | -1 } | { op: 'join'; at: number } | { op: 'split'; at: number } | { op: 'undo' };
export type EditResult = { ok: true; state: EditState } | { ok: false; error: string };

const MAX_UNDO = 20;
const fail = (error: string): EditResult => ({ ok: false, error });
const done = (s: EditState, days: UnitDay[]): EditResult => ({ ok: true, state: { days, past: [...s.past, s.days].slice(-MAX_UNDO) } });

export const startEditing = (days: readonly UnitDay[]): EditState => ({ days: [...days], past: [] });

function move(s: EditState, at: number, dir: 1 | -1): EditResult {
  const to = at + dir;
  const ds = s.days;
  if (!ds[at] || !ds[to]) return fail('out_of_range');
  if (ds[at].kind === 'test' || ds[to].kind === 'test') return fail('test_day_fixed');
  const out = [...ds];
  [out[at], out[to]] = [out[to], out[at]];
  return done(s, out);
}

function joined(a: UnitDay | undefined, b: UnitDay | undefined): UnitDay | string {
  if (!a || !b) return 'out_of_range';
  if (a.kind !== 'lesson' || b.kind !== 'lesson') return 'not_joinable';
  if (a.part === 1 && b.part === 2 && a.lesson_ids[0] === b.lesson_ids[0]) {
    const { part: _p, ...whole } = a;
    return whole;
  }
  if (a.part || b.part) return 'not_joinable';
  if (a.lesson_ids.length + b.lesson_ids.length > 2) return 'too_big';
  return { ...a, lesson_ids: [...a.lesson_ids, ...b.lesson_ids], topic: `${a.topic} + ${b.topic}` };
}

function halves(d: UnitDay | undefined): UnitDay[] | string {
  if (!d) return 'out_of_range';
  if (d.kind !== 'lesson' || d.part) return 'not_splittable';
  if (d.lesson_ids.length === 2) {
    const topics = d.topic.split(' + ');
    return d.lesson_ids.map((id, i) => ({ ...d, lesson_ids: [id], topic: topics.length === 2 ? topics[i] : d.topic }));
  }
  return [{ ...d, part: 1 }, { ...d, part: 2 }];
}

export function edit(s: EditState, e: EditOp): EditResult {
  if (e.op === 'undo') {
    if (!s.past.length) return fail('nothing_to_undo');
    return { ok: true, state: { days: s.past[s.past.length - 1], past: s.past.slice(0, -1) } };
  }
  if (!Number.isInteger(e.at)) return fail('out_of_range');
  if (e.op === 'move') return move(s, e.at, e.dir);
  const out = [...s.days];
  if (e.op === 'join') {
    const j = joined(s.days[e.at], s.days[e.at + 1]);
    if (typeof j === 'string') return fail(j);
    out.splice(e.at, 2, j);
    return done(s, out);
  }
  const h = halves(s.days[e.at]);
  if (typeof h === 'string') return fail(h);
  out.splice(e.at, 1, ...h);
  return done(s, out);
}

/** What the ⋯ menu offers on day `at`. */
export function canEdit(days: readonly UnitDay[], at: number) {
  const s = startEditing(days);
  return {
    up: move(s, at, -1).ok,
    down: move(s, at, 1).ok,
    join: typeof joined(days[at], days[at + 1]) !== 'string',
    split: typeof halves(days[at]) !== 'string',
  };
}
