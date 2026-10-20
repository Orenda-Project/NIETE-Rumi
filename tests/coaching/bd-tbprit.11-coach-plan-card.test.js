'use strict';
/**
 * bd-tbprit.11 — the card carries what the coaching box needs: the coach's saved choices (publicPlan — no AI cache,
 * no timestamps) and the teacher's WhatsApp number for the wa.me link, as digits only, null when the server has none.
 */
const { cardFor } = require('../../dashboard/services/coach-disagreements.service');

const NOW = new Date('2026-10-20T10:00:00Z');
const D = (d) => new Date(NOW.getTime() - d * 86400000).toISOString();
const S = (id, d, pct, lp = null) => ({ id, user_id: 't1', created_at: D(d), audio_duration_seconds: 1500, scores: pct == null ? null : { overall_percentage: pct }, lp_fidelity: lp });
const REQ = (id, d, extra = {}) => ({
  id, coaching_session_id: 'this', teacher_user_id: 't1', coach_user_id: 'me', school_id: null, status: 'sent', reasons: ['missed'],
  voice_note_key: null, created_at: D(d), updated_at: D(d), opened_at: null, ab_group: 'C', ...extra,
});

function fakeSupabase(tables) {
  return {
    from(table) {
      const f = [];
      let order = null;
      let lim = Infinity;
      const keep = (r) => f.every(([op, k, v]) => (op === 'eq' ? r[k] === v : op === 'in' ? v.includes(r[k])
        : op === 'lte' ? r[k] <= v : op === 'gte' ? r[k] >= v : true));
      const run = () => {
        const rows = (tables[table] || []).filter(keep);
        if (order) rows.sort((a, b) => (a[order.k] < b[order.k] ? -1 : 1) * (order.asc ? 1 : -1));
        return rows.slice(0, lim);
      };
      const chain = {
        select: () => chain, is: () => chain,
        order(k, o) { order = { k, asc: !(o && o.ascending === false) }; return chain; },
        limit(n) { lim = n; return chain; },
        eq(k, v) { f.push(['eq', k, v]); return chain; },
        in(k, v) { f.push(['in', k, v]); return chain; },
        lte(k, v) { f.push(['lte', k, v]); return chain; },
        gte(k, v) { f.push(['gte', k, v]); return chain; },
        maybeSingle: () => Promise.resolve({ data: run()[0] || null, error: null }),
        then: (res, rej) => Promise.resolve({ data: run(), error: null }).then(res, rej),
      };
      return chain;
    },
  };
}

const lp = (verdict) => ({ status: 'ok', moves: [{ move_id: 'm1', phase: 'We Do', verdict }] });

function tables() {
  // 14 lessons before this one, every 3 days; this lesson 1 day ago; one later lesson that must not show
  const before = Array.from({ length: 14 }, (_, i) => S(`p${i}`, 43 - i * 3, 60 + i, i % 2 ? lp('not_done') : lp('executed')));
  return {
    coach_visit_requests: [REQ('a', 1), REQ('old', 20, { coaching_session_id: 'p5', status: 'visited' })],
    users: [{ id: 't1', name: 'Sadia Bibi', phone_number: '+92 300 1234567' }, { id: 'me', preferred_language: 'en' }],
    leader_schools: [],
    coaching_sessions: [...before, S('this', 2, 58.4, lp('partial')), S('later', 0.5, 90)],
  };
}

const report = { session: { id: 'this', created_at: D(2), analysis_data: {} }, language: 'en', firstName: 'Sadia', trend: [], quizMessage: null };
const deps = { loadReport: async () => report, presign: async () => null, now: NOW };

describe('cardFor: plan and phone', () => {
  it('no choices yet: plan null; her number as digits', async () => {
    const card = await cardFor(fakeSupabase(tables()), 'me', 'a', deps);
    expect(card.plan).toBeNull();
    expect(card.phone).toBe('923001234567');
  });

  it('saved choices come back without the AI cache or timestamps', async () => {
    const t = tables();
    t.coach_visit_requests[0].coach_plan = { found: 0, mode: 'msg', flagged: true, flaggedAt: D(0), ai: { en0: { msg: 'x' } } };
    const card = await cardFor(fakeSupabase(t), 'me', 'a', deps);
    expect(card.plan).toEqual({ found: 0, mode: 'msg', flagged: true, addedToVisit: false, sent: false });
  });

  it('no number on file: phone null, never a made-up one', async () => {
    const t = tables();
    t.users[0].phone_number = null;
    expect((await cardFor(fakeSupabase(t), 'me', 'a', deps)).phone).toBeNull();
  });
});
