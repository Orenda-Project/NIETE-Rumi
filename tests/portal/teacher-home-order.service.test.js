/**
 * Teacher Home card — dashboard/services/teacher-home-order.service.js: the per-teacher tile order (distinct days in 28, a
 * 14-day half-life, ≥ 2 days to move above lessons, < 2 days in all → the fixed order) and the card's ladder
 * (the design rule R5: class → coach report → lesson → observation → first plan → none).
 */
const Order = require('../../dashboard/services/teacher-home-order.service');

const NOW = '2026-10-20T12:00:00.000Z';
const DAY = 86400000;
/** n days before NOW, at 10:00 UTC. */
const ago = (n, hour = 10) => new Date(Date.parse('2026-10-20T00:00:00.000Z') - n * DAY + hour * 3600000).toISOString();
const days = (...ns) => ns.map((n) => ago(n));
const FIXED = ['lessons', 'coaching', 'observations', 'training', 'assessment', 'attendance', 'classes', 'analytics'];

describe('rankFeatures', () => {
  test('the fixed order is Home.tsx TILES', () => {
    expect(Order.FIXED_ORDER).toEqual(FIXED);
  });

  test.each([
    ['all zero → fixed', {}, FIXED],
    ['one feature, one day → fixed', { training: days(1) }, FIXED],
    ['one feature, many rows on ONE day → fixed (days, not rows)', { attendance: [ago(1, 8), ago(1, 9), ago(1, 11)] }, FIXED],
    ['one feature with 2 days and LP with 0 → it leads', { attendance: days(1, 3) },
      ['attendance', 'lessons', 'coaching', 'observations', 'training', 'assessment', 'classes', 'analytics']],
    ['two days total but each feature one day → no one passes lessons', { coaching: days(1), training: days(2) },
      ['lessons', 'coaching', 'training', 'observations', 'assessment', 'attendance', 'classes', 'analytics']],
    ['rows older than 28 days do not count', { training: days(28, 30, 40) }, FIXED],
    ['a tie with lessons stays with lessons (fixed order breaks ties)', { lessons: days(1, 2), training: days(1, 2) },
      ['lessons', 'training', 'coaching', 'observations', 'assessment', 'attendance', 'classes', 'analytics']],
    ['recent beats old at equal days', { assessment: days(20, 21), training: days(1, 2) },
      ['training', 'assessment', 'lessons', 'coaching', 'observations', 'attendance', 'classes', 'analytics']],
  ])('%s', (_l, input, expected) => {
    expect(Order.rankFeatures(input, NOW)).toEqual(expected);
  });

  /*
   * the usage study, T1–T8, as fixtures: the active-day counts are the doc's; the days are spread so the
   * doc's scores hold roughly. Expected orders are derived from the contract rule, not copied from the doc's column:
   * Quiz and Videos are not tiles (no row is read for them), and the ≥ 2-days rule keeps a one-day feature below LP.
   */
  test.each([
    // T1: LP 1 day → under 2 days in all → fixed.
    ['T1', { lessons: days(25) }, FIXED],
    // T2: Training 8 days → LP 5 days.
    ['T2', { training: days(0, 1, 2, 3, 4, 5, 6, 7), lessons: days(8, 10, 12, 14, 16) },
      ['training', 'lessons', 'coaching', 'observations', 'assessment', 'attendance', 'classes', 'analytics']],
    // T3: AI coach 1 day (0.28) vs LP 1 day (0.26). The doc ranks AI coach first; the contract rule (≥ 2 days to pass LP)
    // keeps LP first, so T3 is the fixed order. NOTE: the doc's sample disagrees here; the SPEC wins.
    ['T3', { coaching: days(26), lessons: days(27) }, FIXED],
    // T4: Papers 5 days → LP 2 days.
    ['T4', { assessment: days(5, 8, 10, 12, 14), lessons: days(20, 22) },
      ['assessment', 'lessons', 'coaching', 'observations', 'training', 'attendance', 'classes', 'analytics']],
    // T5: Attendance 15 → LP 9 → AI coach 5 → papers 2 → observation 1 (quiz is not a tile).
    ['T5', {
      attendance: days(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14),
      lessons: days(1, 3, 5, 7, 9, 11, 13, 15, 17),
      coaching: days(4, 8, 12, 16, 20),
      assessment: days(22, 26),
      observations: days(16),
    }, ['attendance', 'lessons', 'coaching', 'assessment', 'observations', 'training', 'classes', 'analytics']],
    // T6: Quiz 1 day → LP 1 day. Quiz is not a tile; LP alone → fixed.
    ['T6', { lessons: days(26) }, FIXED],
    // T7: Videos 3 days → LP 1 day. Videos is not a tile; one day in all → fixed. NOTE: the doc puts Videos first.
    ['T7', { lessons: days(17) }, FIXED],
    // T8: LP 4 → training 2 → AI coach 1 (quiz is not a tile).
    ['T8', { lessons: days(10, 12, 14, 16), training: days(18, 22), coaching: days(26) },
      ['lessons', 'training', 'coaching', 'observations', 'assessment', 'attendance', 'classes', 'analytics']],
  ])('%s', (_l, input, expected) => {
    expect(Order.rankFeatures(input, NOW)).toEqual(expected);
  });

  test('lesson_plans.created_at has no offset (timestamp without time zone): read as UTC, not local', () => {
    // 23:30 UTC on day -1 with no offset must be day -1 in UTC whatever the machine's zone.
    const set = Order.activeDays(['2026-10-19T23:30:00', '2026-10-19 23:45:00'], NOW);
    expect(set.size).toBe(1);
  });

  test('always the 8 keys, each once', () => {
    const out = Order.rankFeatures({ coaching: days(1, 2, 3), observations: days(1, 5) }, NOW);
    expect([...out].sort()).toEqual([...FIXED].sort());
  });
});

describe('scoreOf (the report page rule: marks/max, never a stand-in zero)', () => {
  test('FICO marks → { marks, max, at, id }', () => {
    const s = Order.scoreOf({ id: 's1', created_at: ago(1), analysis_data: { scores: { overall_marks: 96, overall_max_marks: 148 } } });
    expect(s).toEqual({ marks: 96, max: 148, at: ago(1), id: 's1' });
  });
  test('legacy grand_total + max_marks', () => {
    expect(Order.scoreOf({ id: 's2', created_at: ago(1), analysis_data: { scores: { grand_total: 70, max_marks: 117 } } }))
      .toMatchObject({ marks: 70, max: 117 });
  });
  test.each([
    ['no analysis_data', { id: 'x', created_at: ago(1) }],
    ['no scores', { id: 'x', created_at: ago(1), analysis_data: {} }],
    ['no marks', { id: 'x', created_at: ago(1), analysis_data: { scores: { overall_max_marks: 148 } } }],
    ['marks not a number', { id: 'x', created_at: ago(1), analysis_data: { scores: { overall_marks: 'n/a' } } }],
  ])('%s → null', (_l, row) => {
    expect(Order.scoreOf(row)).toBeNull();
  });
});

describe('pickCard — the design rule R5 ladder', () => {
  const QH = '/quiz/teacher/tok';
  const bot = (primary) => ({ path: QH, primary, facts: {} });
  const coach = { id: 'c1', created_at: ago(2), analysis_data: { topic: 'Fractions', scores: { overall_marks: 96, overall_max_marks: 148 } } };
  const observation = { id: 'o1', created_at: ago(5), analysis_data: { scores: { overall_marks: 80, overall_max_marks: 148 } } };

  test('1 class: the bot\'s class card wins over everything, → quizHome', () => {
    const card = Order.pickCard({ bot: bot({ kind: 'class', title: 'Plants', played: 3 }), coach, observation, lpCount: 0, now: NOW });
    expect(card).toEqual({ kind: 'class', title: 'Plants', played: 3, href: QH });
  });

  test('2 coach report: own session of 7 days beats the lesson rung', () => {
    const card = Order.pickCard({ bot: bot({ kind: 'lesson', id: 'lp1', title: 'Water', from: 'lp' }), coach, observation, lpCount: 3, now: NOW });
    expect(card).toEqual({ kind: 'coach_report', title: 'Fractions', score: 96, max: 148, at: ago(2), href: '/portal/teacher/coaching/c1', id: 'c1' });
  });

  test('2 coach report with no usable score: score null, never 0', () => {
    const card = Order.pickCard({ bot: null, coach: { id: 'c2', created_at: ago(1), analysis_data: {} }, lpCount: 1, now: NOW });
    expect(card).toMatchObject({ kind: 'coach_report', score: null, max: null });
  });

  test('2 a report older than 7 days does not fire', () => {
    const card = Order.pickCard({ bot: null, coach: { ...coach, created_at: ago(8) }, lpCount: 1, now: NOW });
    expect(card).toBeNull();
  });

  test('3 lesson: the bot\'s un-quizzed lesson → quizHome, from lp|coach', () => {
    expect(Order.pickCard({ bot: bot({ kind: 'lesson', id: 'k1', make: 'coaching', title: 'Shapes', from: 'coach' }), lpCount: 3, now: NOW }))
      .toEqual({ kind: 'lesson', title: 'Shapes', from: 'coach', href: QH, id: 'k1' });
  });

  test('3 lesson fallback: the bot answered with none → the newest un-quizzed plan of 7 days', () => {
    const lastPlan = { id: 'lp9', topic: 'Seasons', created_at: '2026-10-18T09:00:00' };
    expect(Order.pickCard({ bot: bot({ kind: 'none' }), lastPlan, lpCount: 4, now: NOW }))
      .toEqual({ kind: 'lesson', title: 'Seasons', from: 'lp', href: QH, id: 'lp9' });
    // the bot chose another job (a story): no fallback
    expect(Order.pickCard({ bot: bot({ kind: 'story', id: 'b1' }), lastPlan, lpCount: 4, now: NOW })).toBeNull();
    // the bot did not answer: no quiz home, no fallback
    expect(Order.pickCard({ bot: null, lastPlan, lpCount: 4, now: NOW })).toBeNull();
  });

  test('4 observation: sent to the teacher in 14 days → observations page', () => {
    expect(Order.pickCard({ bot: null, observation, lpCount: 2, now: NOW })).toEqual({
      kind: 'observation', title: ago(5).slice(0, 10), score: 80, max: 148, at: ago(5), href: '/portal/teacher/observations', id: 'o1',
    });
    expect(Order.pickCard({ bot: null, observation: { ...observation, created_at: ago(15) }, lpCount: 2, now: NOW })).toBeNull();
  });

  test('5 first plan: zero lesson plans ever; a failed count (null) is not zero', () => {
    expect(Order.pickCard({ bot: null, lpCount: 0, now: NOW })).toEqual({ kind: 'first_plan', title: '', href: '/portal/teacher/lessons' });
    expect(Order.pickCard({ bot: null, lpCount: null, now: NOW })).toBeNull();
  });

  test('none: nothing qualifies → null', () => {
    expect(Order.pickCard({ bot: bot({ kind: 'none' }), lpCount: 5, now: NOW })).toBeNull();
    expect(Order.pickCard({ now: NOW })).toBeNull();
  });

  test('no quizHome: rungs 1 and 3 cannot fire', () => {
    const b = { path: null, primary: { kind: 'class', title: 'x', played: 1 } };
    expect(Order.pickCard({ bot: b, lpCount: 3, now: NOW })).toBeNull();
    expect(Order.pickCard({ bot: { path: '', primary: { kind: 'lesson', id: 'l', title: 't', from: 'lp' } }, lpCount: 3, now: NOW })).toBeNull();
  });

  test('a coach role never gets rungs 1 and 3; rungs 2, 4, 5 still do', () => {
    expect(Order.pickCard({ bot: bot({ kind: 'class', title: 'x', played: 1 }), isCoach: true, lpCount: 3, now: NOW })).toBeNull();
    expect(Order.pickCard({ bot: bot({ kind: 'lesson', id: 'l', title: 't', from: 'lp' }), isCoach: true, observation, lpCount: 3, now: NOW }))
      .toMatchObject({ kind: 'observation' });
    expect(Order.isCoachRole('Principal')).toBe(true);
    expect(Order.isCoachRole('teacher')).toBe(false);
  });
});

describe('countsFor — six reads, a failed one is no days', () => {
  function fakeSupabase(byTable, calls) {
    return {
      from(table) {
        const q = { table, filters: [] };
        calls.push(q);
        const chain = {
          select(col) { q.select = col; return chain; },
          eq(c, v) { q.filters.push(['eq', c, v]); return chain; },
          is(c, v) { q.filters.push(['is', c, v]); return chain; },
          in(c, v) { q.filters.push(['in', c, v]); return chain; },
          gte(c, v) { q.filters.push(['gte', c, v]); return chain; },
          then(res, rej) {
            const f = byTable[table];
            return Promise.resolve(typeof f === 'function' ? f(q) : f).then(res, rej);
          },
        };
        return chain;
      },
    };
  }

  test('reads by user_id with the SPEC filters, only the date column; a failure leaves that feature empty', async () => {
    const calls = [];
    const sb = fakeSupabase({
      lesson_plans: { data: [{ created_at: '2026-10-19T08:00:00' }], error: null },
      coaching_sessions: (q) => (q.filters.some((f) => f[0] === 'is')
        ? { data: [{ created_at: ago(2) }], error: null }
        : { data: null, error: { message: 'boom' } }),
      assessment_requests: () => { throw new Error('down'); },
      attendance_sessions: { data: [{ created_at: ago(1) }, { created_at: ago(1) }], error: null },
      teacher_training_progress: { data: [{ completed_at: ago(3) }], error: null },
    }, calls);
    const out = await Order.countsFor(sb, 'u1', NOW);
    expect(out).toEqual({
      lessons: ['2026-10-19T08:00:00'], coaching: [ago(2)], observations: [], assessment: [],
      attendance: [ago(1), ago(1)], training: [ago(3)],
    });
    const own = calls.find((c) => c.table === 'coaching_sessions' && c.filters.some((f) => f[0] === 'is'));
    expect(own.filters).toEqual(expect.arrayContaining([['eq', 'user_id', 'u1'], ['is', 'observation_type', null], ['eq', 'status', 'completed']]));
    const recv = calls.find((c) => c.table === 'coaching_sessions' && !c.filters.some((f) => f[0] === 'is'));
    expect(recv.filters).toEqual(expect.arrayContaining([
      ['eq', 'observation_type', 'leader_observation'],
      ['in', 'analysis_data->teacher_delivery->>status', ['sent', 'awaiting_teacher_tap']],
    ]));
    expect(calls.find((c) => c.table === 'teacher_training_progress').select).toBe('completed_at');
    expect(calls.filter((c) => c.table !== 'teacher_training_progress').every((c) => c.select === 'created_at')).toBe(true);
    expect(calls.every((c) => c.filters.some((f) => f[0] === 'gte'))).toBe(true);
  });
});
