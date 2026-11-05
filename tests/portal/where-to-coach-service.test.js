/**
 * Where to coach — the read side (dashboard/services/where-to-coach.service.js) and its two routes, bd-17v39c.4.14.3.
 *
 *   GET /coach/teacher/:ext/where?period=   one teacher: Rifat's engine on her DC reports and reviewed coach
 *                                           observations, the tips, the plan, the AI coach's last advice, her DC
 *                                           sessions, the NIETE-use check-in
 *   GET /coach/school/:emis/first?period=   one school: every teacher in the group her rules put them in (ours)
 *
 * The database is the boundary (every read carries a `/* sc:<name> *\/` tag), as in coach-school-card-service.test.js;
 * the services are never mocked. Default period: This month (Rifat's review pick 1B, 5 Nov).
 */
const Where = require('../../dashboard/services/where-to-coach.service');
const { createCoachSchoolCardRouter } = require('../../dashboard/routes/coach-school-card.routes');

const TODAY = '2026-10-28'; // a Wednesday
const pk = (s) => new Date(Date.parse(`${s.replace(' ', 'T')}:00Z`) - 5 * 3600 * 1000).toISOString();
const ph = (n) => '92' + '000' + String(n).padStart(7, '0');

const KEY = { B: 'lesson_plan_fidelity', C: 'high_leverage_practices', D: 'student_engagement', F: 'teacher_subject_knowledge' };
/** FICO v3 analysis_data (1–4): section % and practice scores as given. */
function analysis(pct, sections, extra = {}) {
  const domains = {};
  const SIZE = { B: 10, C: 12, D: 7, F: 8 };
  for (const [code, s] of Object.entries(sections)) {
    const max = SIZE[code] * 4;
    domains[KEY[code]] = {
      domain_score: (s.pct / 100) * max, domain_max: max, indicators_applicable: SIZE[code],
      indicators: Object.entries(s.items).map(([id, score]) => ({ id, name: `Name of ${id}`, score })),
    };
  }
  return { scores: { overall_percentage: pct, overall_marks: pct, overall_max_marks: 100 }, framework: 'fico', grade: 4, subject: 'english', domains, ...extra };
}
const plan = (pct, moves) => ({ status: 'ok', fidelity_pct: pct, moves: moves.map(([phase, verdict], i) => ({ move_id: `m${i}`, phase, verdict })) });

/** Sana: section D low in DC (48%) and in the coach observation (50%): her test 1. */
const sana = (d3, c1, f1, lp) => analysis(60, {
  C: { pct: 61, items: { C1: c1 } }, D: { pct: 48, items: { D3: d3 } }, F: { pct: 84, items: { F1: f1 } },
}, lp ? { lp_fidelity: lp } : {});
const ok = (c1, d1) => analysis(80, { C: { pct: 80, items: { C1: c1 } }, D: { pct: 80, items: { D1: d1 } } });

function tables() {
  return {
    leaderSchools: [
      { leader_user_id: 'coach-1', school_id: 's1', school_ext_id: 'niete:901', emis: '901', school_name: 'Demo School' },
      { leader_user_id: 'coach-2', school_id: 's2', school_ext_id: 'niete:902', emis: '902', school_name: 'Other School' },
    ],
    schools: [{ id: 's1', name: 'Demo School', emis: '901' }, { id: 's2', name: 'Other School', emis: '902' }],
    users: [
      { id: 'u1', phone_number: ph(1), name: 'Sana Demo', role: 'teacher', school_id: 's1' },
      { id: 'u2', phone_number: ph(2), name: 'Rabia Demo', role: 'teacher', school_id: 's1' },
      { id: 'u3', phone_number: ph(3), name: 'Farah Demo', role: 'teacher', school_id: 's1' },
      { id: 'u4', phone_number: ph(4), name: 'Kiran Demo', role: 'teacher', school_id: 's1' },
      { id: 'u5', phone_number: ph(5), name: 'Nadia Demo', role: 'teacher', school_id: 's1' },
      { id: 'u9', phone_number: ph(9), name: 'Other Teacher', role: 'teacher', school_id: 's2' },
      { id: 'coach-1', phone_number: ph(91), name: 'Coach One', role: 'coach', school_id: null },
    ],
    lessonPlans: [
      // Rabia 4 plans, Kiran 2, Nadia 1: Sana has none
      ...[1, 2, 3, 4].map((i) => ({ id: `lr${i}`, user_id: 'u2', created_at: pk(`2026-10-${10 + i} 09:00`), surface: null, lesson_id: `grade_4_english_ch${i}_seg1` })),
      ...[1, 2].map((i) => ({ id: `lk${i}`, user_id: 'u4', created_at: pk(`2026-10-${10 + i} 09:00`), surface: null, lesson_id: `grade_4_math_ch${i}_seg1` })),
      { id: 'ln1', user_id: 'u5', created_at: pk('2026-10-12 09:00'), surface: null, lesson_id: 'grade_4_math_ch1_seg1' },
    ],
    sessions: [
      // Sana: 3 DC this month (D3 low in 3 of 3), one reviewed coach observation, one unreviewed, one field-form.
      { id: 'a1', user_id: 'u1', created_at: pk('2026-10-06 10:00'), status: 'completed', analysis_data: sana(1, 2, 4, plan(60, [['independent', 'not_done'], ['exit', 'executed']])), prioritized_action: { action: 'ACTION-a1' } },
      { id: 'a2', user_id: 'u1', created_at: pk('2026-10-15 10:00'), status: 'completed', analysis_data: sana(2, 2, 3, plan(70, [['independent', 'not_done'], ['exit', 'not_done']])), prioritized_action: { action: 'ACTION-a2' } },
      { id: 'a3', user_id: 'u1', created_at: pk('2026-10-27 10:00'), status: 'completed', analysis_data: sana(1, 3, 4), prioritized_action: { action: 'ACTION-a3 pair talk', thing_to_try: { text: 'TRY-a3 give pairs one minute' } } },
      { id: 'a4', user_id: 'u1', created_at: pk('2026-10-27 11:00'), status: 'completed', duplicate_of_session_id: 'a3', analysis_data: sana(1, 1, 1) },
      { id: 'h1', user_id: 'u1', created_at: pk('2026-10-20 12:00'), status: 'observer_review_complete', observation_type: 'leader_observation', observer_user_id: 'coach-1', analysis_data: analysis(55, { C: { pct: 70, items: { C1: 3 } }, D: { pct: 50, items: { D3: 2 } }, F: { pct: 58, items: { F1: 2 } } }) },
      { id: 'h2', user_id: 'u1', created_at: pk('2026-10-21 12:00'), status: 'awaiting_observer_review', observation_type: 'leader_observation', observer_user_id: 'coach-1', analysis_data: analysis(99, { D: { pct: 99, items: { D3: 4 } } }) },
      { id: 'h3', user_id: 'u1', created_at: pk('2026-10-22 12:00'), status: 'observer_review_complete', observation_type: 'leader_observation', observer_user_id: 'coach-1', analysis_data: analysis(99, { D: { pct: 99, items: { D3: 4 } } }, { observe2: { rubric: 'fico17' } }) },
      // Rabia: 2 DC, C1 low in both, no coach observation → low in most of her lessons
      { id: 'b1', user_id: 'u2', created_at: pk('2026-10-08 10:00'), status: 'completed', analysis_data: ok(1, 3) },
      { id: 'b2', user_id: 'u2', created_at: pk('2026-10-22 10:00'), status: 'completed', analysis_data: ok(2, 4) },
      // Farah: her last DC was 41 days ago (outside the month)
      { id: 'f0', user_id: 'u3', created_at: pk('2026-09-17 10:00'), status: 'completed', analysis_data: ok(3, 3) },
      // Kiran: one DC
      { id: 'k1', user_id: 'u4', created_at: pk('2026-10-14 10:00'), status: 'completed', analysis_data: ok(2, 3) },
      // Nadia: 3 DC, nothing low in most
      { id: 'n1', user_id: 'u5', created_at: pk('2026-10-07 10:00'), status: 'completed', analysis_data: ok(3, 2) },
      { id: 'n2', user_id: 'u5', created_at: pk('2026-10-14 10:00'), status: 'completed', analysis_data: ok(4, 3) },
      { id: 'n3', user_id: 'u5', created_at: pk('2026-10-21 10:00'), status: 'completed', analysis_data: ok(3, 3) },
      // another coach's teacher
      { id: 'x1', user_id: 'u9', created_at: pk('2026-10-21 10:00'), status: 'completed', analysis_data: ok(1, 1) },
    ],
    ab: [{ school_id: 's1', ab_group: 'C' }],
  };
}

const ms = (v) => Date.parse(v instanceof Date ? v.toISOString() : v);
const inWin = (at, lo, hi) => (!lo || ms(at) >= ms(lo)) && (!hi || ms(at) < ms(hi));
const DEAD = ['cancelled', 'abandoned', 'failed', 'test_cleanup'];

function fakeDb(t) {
  const user = (id) => t.users.find((u) => u.id === id);
  const rostered = (u) => !!u && ['teacher', 'principal'].includes(u.role);
  const coachSchoolIds = (coach) => new Set(t.leaderSchools.filter((x) => x.leader_user_id === coach).map((x) => x.school_id));
  const calls = [];
  const query = async (sql, params = []) => {
    const tag = (String(sql).match(/\/\* sc:([a-z-]+) \*\//) || [])[1];
    calls.push(tag);
    switch (tag) {
      case 'school': {
        const [coach, emis] = params;
        const rows = t.leaderSchools.filter((x) => x.leader_user_id === coach && x.emis === emis)
          .map((ls) => { const s = t.schools.find((x) => x.id === ls.school_id); return { id: s.id, name: s.name, emis: s.emis, school_name: ls.school_name }; });
        return { rows };
      }
      case 'roster': return { rows: t.users.filter((u) => params[0].includes(u.school_id) && rostered(u)) };
      case 'teacher': {
        const [coach, ext] = params;
        const u = t.users.find((x) => x.phone_number === ext && rostered(x) && coachSchoolIds(coach).has(x.school_id));
        if (!u) return { rows: [] };
        const s = t.schools.find((x) => x.id === u.school_id);
        return { rows: [{ ...u, school_name: s.name, emis: s.emis }] };
      }
      case 'lp': {
        const [ids, lo, hi] = params;
        return { rows: t.lessonPlans.filter((l) => ids.includes(l.user_id) && inWin(l.created_at, lo, hi)).map((l) => ({ ...l, at: l.created_at })) };
      }
      case 'opens': case 'training': case 'papers': case 'training-scopes': return { rows: [] };
      case 'sessions': {
        const [ids, lo, hi] = params;
        return {
          rows: t.sessions.filter((c) => ids.includes(c.user_id) && inWin(c.created_at, lo, hi)).map((c) => {
            const o = c.observer_user_id ? user(c.observer_user_id) : null;
            return {
              id: c.id, user_id: c.user_id, at: c.created_at, updated_at: c.created_at, status: c.status,
              observation_type: c.observation_type || null, duplicate_of_session_id: c.duplicate_of_session_id || null,
              observer_user_id: c.observer_user_id || null, observer_name: o ? o.name : null, observer_test: false,
            };
          }),
        };
      }
      case 'scores': {
        return {
          rows: t.sessions.filter((c) => params[0].includes(c.id)).map((c) => {
            const a = c.analysis_data || {};
            const d = a.domains || {};
            const out = { id: c.id, updated_at: c.created_at, scores: a.scores, grade: String(a.grade), subject: a.subject, rubric: (a.observe2 && a.observe2.rubric) || null };
            for (const [k, key] of Object.entries({ b: KEY.B, c: KEY.C, d: KEY.D, f: KEY.F })) {
              out[`${k}_score`] = d[key] ? String(d[key].domain_score) : null;
              out[`${k}_max`] = d[key] ? String(d[key].domain_max) : null;
              out[`${k}_assessed`] = null;
            }
            return out;
          }),
        };
      }
      case 'domains':
        return { rows: t.sessions.filter((c) => params[0].includes(c.id)).map((c) => ({ id: c.id, domains: c.analysis_data.domains, has_plan: null, lp_fidelity: c.analysis_data.lp_fidelity || null })) };
      case 'group': return { rows: t.ab.filter((g) => g.school_id === params[0]) };
      case 'actions': {
        const [ids, group] = params;
        return {
          rows: t.sessions.filter((c) => ids.includes(c.id)).map((c) => {
            const pa = c.prioritized_action || {};
            return { id: c.id, action: pa.action || null, thing_text: ['C', 'D'].includes(group) ? ((pa.thing_to_try || {}).text || null) : null, topic: null, lesson_label: null, framework: 'fico' };
          }),
        };
      }
      case 'last-dc': {
        const out = new Map();
        for (const c of t.sessions) {
          if (!params[0].includes(c.user_id) || c.observation_type || c.status !== 'completed' || c.duplicate_of_session_id) continue;
          if (!out.has(c.user_id) || ms(c.created_at) > ms(out.get(c.user_id))) out.set(c.user_id, c.created_at);
        }
        return { rows: [...out].map(([user_id, at]) => ({ user_id, at })) };
      }
      default:
        throw new Error(`unanswered read: ${tag}`);
    }
  };
  return { query, calls };
}

const month = { period: 'month', today: TODAY };

describe('GET /coach/teacher/:ext/where — one teacher', () => {
  let r;
  beforeAll(async () => { r = await Where.getWhereToCoach(fakeDb(tables()).query, 'coach-1', ph(1), month); });

  test('her engine on her DC reports and her REVIEWED, FICO-form coach observation; a re-send counts once', () => {
    expect(r.sessions).toEqual({ dc: 3, coach: 1 });
    expect(r.signal).toBe('patterns');
    expect(r.framework).toBe('fico_v3');
    expect(r.period).toMatchObject({ key: 'month' });
  });

  test('focus D3 by test 1, with its tips in both languages', () => {
    expect(r.focus).toMatchObject({ id: 'D3', section: 'D', k: 3, n: 3, why: { test: 1, reason: 'both' } });
    expect(r.focus.tips.en.tryThis).toBe('Give 2 minutes of pair talk on the question before taking answers.');
    expect(r.focus.tips.ur.tryThis).toMatch(/جوڑیوں/);
    expect(r.focus.tips.source).toBe('rifat:D2');
  });

  test('weakest and strength, each with tips', () => {
    expect(r.weakest.map((p) => p.id)).toEqual(['D3', 'C1', 'F1']);
    expect(r.weakest.every((p) => p.tips && p.tips.en.lookFor)).toBe(true);
    expect(r.strength).toMatchObject({ id: 'F1', avg: 3.7 });
  });

  test('sections: D agree low, F differ', () => {
    const by = Object.fromEntries(r.sections.map((s) => [s.code, s]));
    expect(by.D).toMatchObject({ agreeLow: true, focusHere: true });
    expect(by.F).toMatchObject({ dc: 84, coach: 58, differ: true });
  });

  test('the plan: 2 of 3 DC sessions measured, You Do skipped in 2 of 2, Check in 1 of 2, each with her step tip', () => {
    expect(r.plan).toMatchObject({ pct: 65, measured: 2, of: 3 });
    expect(r.plan.skipped.map((s) => [s.step, s.skipped, s.of])).toEqual([['You Do', 2, 2], ['Check', 1, 2]]);
    expect(r.plan.skipped[0].tips.source).toBe('rifat:B2');
  });

  test('the AI coach\'s last advice is what her latest report showed her (a C school: the thing to try)', () => {
    expect(r.lastAdvice).toEqual({ text: 'TRY-a3 give pairs one minute', date: '2026-10-27', sessionId: 'a3' });
  });

  test('an A school sees the report\'s own action, never the thing to try', async () => {
    const t = tables();
    t.ab = [{ school_id: 's1', ab_group: 'A' }];
    const out = await Where.getWhereToCoach(fakeDb(t).query, 'coach-1', ph(1), month);
    expect(out.lastAdvice.text).toBe('ACTION-a3 pair talk');
  });

  test('her DC sessions, newest first, each with its score and weakest section', () => {
    expect(r.reports.map((x) => [x.id, x.date, x.score, x.weakest])).toEqual([
      ['a3', '2026-10-27', 60, 'D'], ['a2', '2026-10-15', 60, 'D'], ['a1', '2026-10-06', 60, 'D'],
    ]);
    expect(r.moreReports).toBe(0);
  });

  test('the check-in: lesson plans and assessments not used this month; DC low (3 against her 3 a week)', () => {
    const by = Object.fromEntries(r.checkin.items.map((i) => [i.feature, i]));
    expect(by.lp).toMatchObject({ state: 'none', count: 0 });
    expect(by.papers).toMatchObject({ state: 'none', count: 0 });
    expect(by.dc).toMatchObject({ state: 'low', count: 3 });
    expect(by.dc.content.en.questions).toHaveLength(2);
    expect(by.training).toBeUndefined(); // no training assigned to her
  });

  test('lesson plans below half the school\'s median: low', async () => {
    // Nadia has 1 plan; the school's median is 1 (0, 0, 1, 2, 4: her prototype's middle value): no card…
    const n = await Where.getWhereToCoach(fakeDb(tables()).query, 'coach-1', ph(5), month);
    expect(n.checkin.items.find((i) => i.feature === 'lp')).toBeUndefined();
    // …and with Rabia at 8, Kiran and Farah at 6 the median is 6 (0, 1, 6, 6, 8): 1 is under half of it.
    const t = tables();
    for (let i = 5; i <= 8; i += 1) t.lessonPlans.push({ id: `lr${i}`, user_id: 'u2', created_at: pk(`2026-10-${10 + i} 09:00`), surface: null, lesson_id: `g4_ch${i}` });
    for (let i = 3; i <= 6; i += 1) t.lessonPlans.push({ id: `lk${i}`, user_id: 'u4', created_at: pk(`2026-10-${10 + i} 09:00`), surface: null, lesson_id: `g4m_ch${i}` });
    for (let i = 1; i <= 6; i += 1) t.lessonPlans.push({ id: `lf${i}`, user_id: 'u3', created_at: pk(`2026-10-${10 + i} 09:00`), surface: null, lesson_id: `g4f_ch${i}` });
    const n2 = await Where.getWhereToCoach(fakeDb(t).query, 'coach-1', ph(5), month);
    expect(n2.checkin.items.find((i) => i.feature === 'lp')).toMatchObject({ state: 'low', count: 1, median: 6 });
  });

  test('no transcript is read, and nothing is written', async () => {
    const db = fakeDb(tables());
    await Where.getWhereToCoach(db.query, 'coach-1', ph(1), month);
    expect(db.calls.every((c) => typeof c === 'string')).toBe(true);
  });

  test('a teacher outside her patch is null (the route\'s 404)', async () => {
    expect(await Where.getWhereToCoach(fakeDb(tables()).query, 'coach-1', ph(9), month)).toBeNull();
  });

  test('no DC and no coach observation: empty, with the check-in still there', async () => {
    const out = await Where.getWhereToCoach(fakeDb(tables()).query, 'coach-1', ph(3), month);
    expect(out).toMatchObject({ signal: 'empty', focus: null, weakest: [], lastAdvice: null, reports: [] });
    expect(out.checkin.items.find((i) => i.feature === 'dc')).toMatchObject({ state: 'none' });
  });
});

describe('GET /coach/school/:emis/first — who to coach first (ours)', () => {
  let r;
  beforeAll(async () => { r = await Where.getCoachFirst(fakeDb(tables()).query, 'coach-1', '901', month); });

  test('each teacher in the group her rules put her in, groups in order', () => {
    const where = Object.fromEntries(r.groups.flatMap((g) => g.rows.map((row) => [row.name, g.key])));
    expect(where).toEqual({ 'Sana Demo': 'agree_low', 'Rabia Demo': 'low_most', 'Farah Demo': 'no_dc', 'Kiran Demo': 'one_dc', 'Nadia Demo': 'none' });
    expect(r.groups.map((g) => g.key)).toEqual(['agree_low', 'low_most', 'no_dc', 'one_dc', 'none']);
    expect(r.teachers).toBe(5);
  });

  test('a row carries her focus (the same one Where to coach opens with) and its numbers', () => {
    const sana = r.groups[0].rows[0];
    expect(sana).toMatchObject({ teacherExtId: ph(1), focus: { id: 'D3', name: 'Name of D3', section: 'D' }, k: 3, n: 3, sessions: { dc: 3, coach: 1 } });
    expect(r.groups[1].rows[0]).toMatchObject({ name: 'Rabia Demo', focus: { id: 'C1' }, k: 2, n: 2 });
  });

  test('no DC: days since her last DC (41), or never', () => {
    expect(r.groups[2].rows[0]).toMatchObject({ name: 'Farah Demo', lastDcDaysAgo: 41, focus: null });
  });

  test('another coach\'s school is null', async () => {
    expect(await Where.getCoachFirst(fakeDb(tables()).query, 'coach-1', '902', month)).toBeNull();
  });
});

describe('the routes (inside the School card router, so behind its switch)', () => {
  const express = require('express');
  let server;
  let base;
  beforeAll(async () => {
    const db = fakeDb(tables());
    const app = express();
    app.use((req, _res, next) => { req.session = { portalUserId: 'coach-1' }; next(); });
    app.use(createCoachSchoolCardRouter({ query: db.query, now: () => new Date(`${TODAY}T07:00:00Z`) }));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));
  const call = async (path) => {
    const res = await fetch(base + path);
    return { code: res.status, body: await res.json() };
  };

  test('Where to coach opens on This month when no period is asked (her pick 1B)', async () => {
    const { code, body } = await call(`/coach/teacher/${ph(1)}/where`);
    expect(code).toBe(200);
    expect(body.period.key).toBe('month');
    expect(body.focus.id).toBe('D3');
  });

  test('the period chips still work, and a bad one is 400', async () => {
    expect((await call(`/coach/teacher/${ph(1)}/where?period=week`)).body.period.key).toBe('week');
    expect((await call(`/coach/teacher/${ph(1)}/where?period=year`)).code).toBe(400);
  });

  test('who to coach first opens on This month too; a bad EMIS or a teacher outside her patch is 404', async () => {
    const { body } = await call('/coach/school/901/first');
    expect(body.period.key).toBe('month');
    expect((await call('/coach/school/9%2001/first')).code).toBe(404);
    expect((await call(`/coach/teacher/${ph(9)}/where`)).code).toBe(404);
  });
});
