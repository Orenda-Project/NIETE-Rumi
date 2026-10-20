'use strict';
/**
 * bd-tbprit.10 — the card carries Rifat's "Is this a pattern?": cardFor reads her last 12 lessons up to and including
 * this one (never a later one), oldest first, with their AI score and their checked plan; her earlier disagreements;
 * and the list's "recording less" tag, so the card and the list say the same thing.
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
    users: [{ id: 't1', name: 'Sadia Bibi' }, { id: 'me', preferred_language: 'en' }],
    leader_schools: [],
    coaching_sessions: [...before, S('this', 2, 58.4, lp('partial')), S('later', 0.5, 90)],
  };
}

const report = { session: { id: 'this', created_at: D(2), analysis_data: {} }, language: 'en', firstName: 'Sadia', trend: [], quizMessage: null };
const deps = { loadReport: async () => report, presign: async () => null, now: NOW };

describe('cardFor: the pattern', () => {
  it('her last 12 lessons up to this one, oldest first; this lesson is now; a later one never shows', async () => {
    const card = await cardFor(fakeSupabase(tables()), 'me', 'a', deps);
    expect(card.pattern.count).toBe(12);
    expect(card.pattern.now).toBe(58);
    expect(card.pattern.points[0]).toEqual({ pct: 63, date: D(34) });
    expect(card.pattern.points.map((p) => p.pct)).not.toContain(90);
    expect(card.pattern.lastDate).toBe(D(2));
  });

  it("the step she missed here, counted over her last 5 checked lessons; her earlier disagreements", async () => {
    const card = await cardFor(fakeSupabase(tables()), 'me', 'a', deps);
    expect(card.pattern.missed).toEqual({ step: 'We Do', n: 3, of: 5 });
    expect(card.pattern.earlier).toBe(1);
  });

  it("recording half or less than the 4 weeks before: at risk, as the list's tag says", async () => {
    const t = tables();
    // only this lesson in the last 2 weeks against 9 in the 4 weeks before
    t.coaching_sessions = t.coaching_sessions.filter((s) => s.id === 'this' || s.created_at < D(14));
    const card = await cardFor(fakeSupabase(t), 'me', 'a', deps);
    expect(card.pattern.level).toBe('atRisk');
  });

  it('a lesson that was never scored stays off the line', async () => {
    const t = tables();
    t.coaching_sessions.find((s) => s.id === 'p13').scores = null;
    const card = await cardFor(fakeSupabase(t), 'me', 'a', deps);
    expect(card.pattern.points).toHaveLength(11);
  });
});
