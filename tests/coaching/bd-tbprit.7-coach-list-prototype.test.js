'use strict';
/**
 * bd-tbprit.7 — the coach's list as Rifat's prototype has it (20 Oct): each row names the teacher, school and EMIS,
 * a blue dot until the coach opens the card, and three tags in plain words with numbers:
 *
 *   recordingLess  her last 2 weeks' recordings a week are half or less of the 4 weeks before ("2 → 0.5 a week")
 *   waiting        sent more than 48 hours ago ("Sent 4 days ago")
 *   repeat         her 2nd / 3rd … disagreement
 *
 * Order: most tags first; on a tie, the one waiting longest.
 */
const { shapeList, listFor, markOpened, recordingRate, cardFor } = require('../../dashboard/services/coach-disagreements.service');

const NOW = new Date('2026-10-26T10:00:00Z');
const H = (h) => new Date(NOW.getTime() - h * 3600000).toISOString();
const D = (d) => H(d * 24);
const ROW = (id, extra) => ({
  id, coaching_session_id: `s-${id}`, teacher_user_id: 't1', school_id: 'sch1', status: 'sent', reasons: ['score'],
  voice_note_key: null, created_at: H(1), updated_at: H(1), opened_at: null, ab_group: 'C', ...extra,
});
const LOOK = (extra = {}) => ({
  teachers: new Map([['t1', 'Sadia Bibi'], ['t2', 'Hina Tariq']]),
  schools: new Map([['sch1', 'IMSG I-8/1']]),
  emis: new Map([['sch1', '312']]),
  sessions: new Map(),
  rates: new Map(),
  ...extra,
});

describe('recordingRate', () => {
  it('recordings a week: the 4 weeks before the last 2, and the last 2', () => {
    const dates = [D(1), D(13), D(15), D(20), D(25), D(30), D(35), D(40), D(41), D(50)];
    expect(recordingRate(dates, NOW)).toEqual({ before: 1.75, now: 1 });
  });

  it('no recordings at all: zero both ways', () => {
    expect(recordingRate([], NOW)).toEqual({ before: 0, now: 0 });
  });
});

describe('shapeList, the prototype row', () => {
  it('school and EMIS; unknown EMIS stays null', () => {
    const out = shapeList([ROW('a'), ROW('b', { school_id: 'x', teacher_user_id: 't2' })], LOOK(), NOW).todo;
    expect(out.find((r) => r.id === 'a')).toMatchObject({ school: 'IMSG I-8/1', emis: '312' });
    expect(out.find((r) => r.id === 'b')).toMatchObject({ school: null, emis: null });
  });

  it('opened once the coach has opened the card', () => {
    const out = shapeList([ROW('a', { opened_at: H(1) }), ROW('b', { teacher_user_id: 't2' })], LOOK(), NOW).todo;
    expect(out.find((r) => r.id === 'a').opened).toBe(true);
    expect(out.find((r) => r.id === 'b').opened).toBe(false);
  });

  it('waiting: whole days since it was sent, only past 48 hours', () => {
    const out = shapeList([ROW('a', { created_at: D(4) }), ROW('b', { created_at: H(47), teacher_user_id: 't2' })], LOOK(), NOW).todo;
    expect(out.find((r) => r.id === 'a').tags).toEqual([{ kind: 'waiting', days: 4 }]);
    expect(out.find((r) => r.id === 'b').tags).toEqual([]);
  });

  it('repeat: her 2nd and 3rd disagreement carry their number, her first none', () => {
    const out = shapeList([
      ROW('one', { status: 'visited', created_at: H(30) }),
      ROW('two', { status: 'visited', created_at: H(20) }),
      ROW('three', { created_at: H(10) }),
    ], LOOK(), NOW);
    expect(out.todo[0].tags).toEqual([{ kind: 'repeat', nth: 3 }]);
  });

  it('recordingLess: half or less of the 4 weeks before; not when she never recorded', () => {
    const rates = new Map([['t1', { before: 2, now: 0.5 }], ['t2', { before: 0, now: 0 }], ['t3', { before: 2, now: 1.5 }]]);
    const out = shapeList([ROW('a'), ROW('b', { teacher_user_id: 't2' }), ROW('c', { teacher_user_id: 't3' })], LOOK({ rates }), NOW).todo;
    expect(out.find((r) => r.id === 'a').tags).toEqual([{ kind: 'recordingLess', before: 2, now: 0.5 }]);
    expect(out.find((r) => r.id === 'b').tags).toEqual([]);
    expect(out.find((r) => r.id === 'c').tags).toEqual([]);
  });

  it('tags in the prototype order: recording less, waiting, repeat', () => {
    const rates = new Map([['t1', { before: 2, now: 0 }]]);
    const out = shapeList([ROW('x', { status: 'visited', created_at: D(9) }), ROW('a', { created_at: D(3) })], LOOK({ rates }), NOW);
    expect(out.todo[0].tags.map((t) => t.kind)).toEqual(['recordingLess', 'waiting', 'repeat']);
  });

  it('a done row carries no tags', () => {
    const out = shapeList([ROW('a', { status: 'visited', created_at: D(5) })], LOOK({ rates: new Map([['t1', { before: 2, now: 0 }]]) }), NOW);
    expect(out.done[0].tags).toEqual([]);
  });

  it('most tags first, then the one waiting longest', () => {
    const rates = new Map([['t2', { before: 3, now: 1 }]]);
    const out = shapeList([
      ROW('new', { teacher_user_id: 'n1', created_at: H(1) }),
      ROW('old', { teacher_user_id: 'n2', created_at: H(20) }),
      ROW('two', { teacher_user_id: 't2', created_at: D(3) }),
      ROW('one', { teacher_user_id: 'n3', created_at: D(5) }),
    ], LOOK({ rates }), NOW);
    expect(out.todo.map((r) => r.id)).toEqual(['two', 'one', 'old', 'new']);
  });
});

/** supabase-js stand-in with the filters these reads use, and the writes markOpened makes. */
function fakeSupabase(tables) {
  const calls = [];
  const from = (table) => {
    const q = { table, filters: [], patch: null };
    calls.push(q);
    const keep = (r) => q.filters.every(([op, k, v]) => (
      op === 'eq' ? r[k] === v : op === 'in' ? v.includes(r[k]) : op === 'gte' ? r[k] >= v : op === 'is' ? r[k] === v : true));
    const run = () => {
      const rows = (tables[table] || []).filter(keep);
      if (q.patch) rows.forEach((r) => Object.assign(r, q.patch));
      return rows;
    };
    const chain = {
      select() { return chain; },
      update(p) { q.patch = p; return chain; },
      eq(k, v) { q.filters.push(['eq', k, v]); return chain; },
      in(k, v) { q.filters.push(['in', k, v]); return chain; },
      gte(k, v) { q.filters.push(['gte', k, v]); return chain; },
      lte() { return chain; },
      is(k, v) { q.filters.push(['is', k, v]); return chain; },
      order() { return chain; },
      limit() { return chain; },
      maybeSingle() { return Promise.resolve({ data: run()[0] || null, error: null }); },
      then(res, rej) { return Promise.resolve({ data: run(), error: null }).then(res, rej); },
    };
    return chain;
  };
  return { from, calls };
}

const TABLES = () => ({
  coach_visit_requests: [ROW('a', { coach_user_id: 'me', created_at: D(3) }), ROW('b', { coach_user_id: 'other', teacher_user_id: 't2' })],
  users: [{ id: 't1', name: 'Sadia Bibi' }],
  leader_schools: [{ school_id: 'sch1', leader_user_id: 'me', school_name: 'IMSG I-8/1', emis: '312' }],
  coaching_sessions: [
    { id: 's-a', user_id: 't1', created_at: D(3), analysis_data: { scores: { overall_percentage: 64 } } },
    ...[16, 20, 24, 28, 33, 37, 40, 41].map((d, i) => ({ id: `old${i}`, user_id: 't1', created_at: D(d) })),
  ],
});

describe('listFor', () => {
  it('EMIS from her schools, the dot, and recording less from the teacher\'s last 6 weeks', async () => {
    const out = await listFor(fakeSupabase(TABLES()), 'me', { now: NOW });
    expect(out.todo[0]).toMatchObject({ id: 'a', emis: '312', opened: false });
    expect(out.todo[0].tags).toEqual([{ kind: 'recordingLess', before: 2, now: 0.5 }, { kind: 'waiting', days: 3 }]);
  });
});

describe('markOpened', () => {
  it('her own card: stamps opened_at once, never again', async () => {
    const t = TABLES();
    const db = fakeSupabase(t);
    await markOpened(db, 'me', 'a', NOW);
    expect(t.coach_visit_requests[0].opened_at).toBe(NOW.toISOString());
    await markOpened(db, 'me', 'a', new Date('2026-10-27T10:00:00Z'));
    expect(t.coach_visit_requests[0].opened_at).toBe(NOW.toISOString());
  });

  it('someone else\'s card is never stamped', async () => {
    const t = TABLES();
    await markOpened(fakeSupabase(t), 'me', 'b', NOW);
    expect(t.coach_visit_requests[1].opened_at).toBeNull();
  });
});

describe('cardFor, the prototype header and banner', () => {
  const report = { session: { id: 's-a', created_at: D(3), analysis_data: { scores: { overall_percentage: 64 } } }, language: 'en', firstName: 'Sadia', trend: [], quizMessage: null };
  const deps = { loadReport: async () => report, presign: async () => null };

  it('her group and which disagreement this is', async () => {
    const t = TABLES();
    t.coach_visit_requests.push(ROW('z', { coach_user_id: 'me', created_at: D(9), status: 'visited' }));
    const c = await cardFor(fakeSupabase(t), 'me', 'a', deps);
    expect(c).toMatchObject({ group: 'C', nth: 2, emis: '312' });
  });

  it('her first: nth 1', async () => {
    expect(await cardFor(fakeSupabase(TABLES()), 'me', 'a', deps)).toMatchObject({ nth: 1 });
  });
});
