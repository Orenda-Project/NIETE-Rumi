'use strict';
/**
 * bd-tbprit.9 — the recording's length, as Rifat's "Where to look" needs it: the card carries it for the
 * recording bar, and a lesson recorded for less than 15 minutes gets "🎙 Short recording: n min" on the list,
 * first among its tags. No length on record: nothing is said, never guessed.
 */
const { shapeList, listFor, cardFor } = require('../../dashboard/services/coach-disagreements.service');

const NOW = new Date('2026-10-26T10:00:00Z');
const H = (h) => new Date(NOW.getTime() - h * 3600000).toISOString();
const ROW = (id, extra) => ({
  id, coaching_session_id: `s-${id}`, teacher_user_id: 't1', school_id: 'sch1', status: 'sent', reasons: ['score'],
  voice_note_key: null, created_at: H(1), updated_at: H(1), opened_at: null, ab_group: 'C', coach_user_id: 'me', ...extra,
});
const LOOK = (sessions) => ({ teachers: new Map(), schools: new Map(), emis: new Map(), rates: new Map(), sessions: new Map(sessions) });

function fakeSupabase(tables) {
  return {
    from(table) {
      const filters = [];
      const run = () => (tables[table] || []).filter((r) => filters.every(([op, k, v]) => (op === 'eq' ? r[k] === v : op === 'in' ? v.includes(r[k]) : true)));
      const chain = {
        select: () => chain, order: () => chain, limit: () => chain, gte: () => chain, is: () => chain,
        eq(k, v) { filters.push(['eq', k, v]); return chain; },
        in(k, v) { filters.push(['in', k, v]); return chain; },
        maybeSingle: () => Promise.resolve({ data: run()[0] || null, error: null }),
        then: (res, rej) => Promise.resolve({ data: run(), error: null }).then(res, rej),
      };
      return chain;
    },
  };
}

describe('shapeList: short recording', () => {
  it('under 15 minutes: the tag, in whole minutes, first', () => {
    const rows = [ROW('a', { created_at: H(80) })];
    const out = shapeList(rows, LOOK([['s-a', { durationSec: 12 * 60 + 20 }]]), NOW).todo[0];
    expect(out.tags).toEqual([{ kind: 'short', minutes: 12 }, { kind: 'waiting', days: 3 }]);
  });

  it('15 minutes or more, or no length on record: no tag', () => {
    const out = shapeList([ROW('a'), ROW('b', { teacher_user_id: 't2' })], LOOK([['s-a', { durationSec: 900 }], ['s-b', { durationSec: null }]]), NOW).todo;
    expect(out.every((r) => r.tags.length === 0)).toBe(true);
  });

  it('a done row carries none', () => {
    const out = shapeList([ROW('a', { status: 'visited' })], LOOK([['s-a', { durationSec: 300 }]]), NOW);
    expect(out.done[0].tags).toEqual([]);
  });
});

const TABLES = () => ({
  coach_visit_requests: [ROW('a')],
  users: [{ id: 't1', name: 'Sadia Bibi' }],
  leader_schools: [],
  coaching_sessions: [{ id: 's-a', user_id: 't1', created_at: H(30), audio_duration_seconds: 540 }],
});

describe('listFor and cardFor read the length', () => {
  it('the list tags a 9-minute lesson', async () => {
    const out = await listFor(fakeSupabase(TABLES()), 'me', { now: NOW });
    expect(out.todo[0].tags).toContainEqual({ kind: 'short', minutes: 9 });
  });

  it('the card carries the seconds; none on record is null', async () => {
    const report = { session: { id: 's-a', created_at: H(30), analysis_data: {} }, language: 'en', firstName: 'Sadia', trend: [], quizMessage: null };
    const deps = { loadReport: async () => report, presign: async () => null };
    expect(await cardFor(fakeSupabase(TABLES()), 'me', 'a', deps)).toMatchObject({ durationSec: 540 });
    const t = TABLES();
    delete t.coaching_sessions[0].audio_duration_seconds;
    expect(await cardFor(fakeSupabase(t), 'me', 'a', deps)).toMatchObject({ durationSec: null });
  });
});
