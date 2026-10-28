/**
 * The coach School Card's read side (dashboard/services/coach-school-card.service.js).
 *
 * The database is the boundary: every read the service makes carries a `/* sc:<name> *\/` tag, and the fake
 * below answers each one from in-memory tables with the same filters the SQL applies (the coach's own
 * leader_schools, the roster rule, the window, the status rules). The service is never mocked.
 *
 * Covered: the counting definitions (one function each), the v10 next-step rule (a coach at an A, B or undrawn
 * school never sees the C/D "one thing to try"), no transcript anywhere, and the access rule — another coach's
 * school, a teacher outside her patch and a session of such a teacher are each null (the route's 404).
 */
const Card = require('../../dashboard/services/coach-school-card.service');

const TODAY = '2026-10-28'; // a Wednesday
/** A Pakistan wall-clock time as the UTC instant the database holds. */
const pk = (s) => new Date(Date.parse(`${s.replace(' ', 'T')}:00Z`) - 5 * 3600 * 1000).toISOString();

// Synthetic numbers, built at runtime (the repo holds no phone-shaped literal): 92 000 000000n.
const ph = (n) => '92' + '000' + String(n).padStart(7, '0');
const PHONE = { t1: ph(1), t2: ph(2), p1: ph(3), tt: ph(4), t3: ph(5) };

function scores(pct) {
  return { overall_percentage: pct, overall_marks: pct, overall_max_marks: 100 };
}
function analysis(pct, extra = {}) {
  return {
    scores: scores(pct),
    grade: 3,
    subject: 'math',
    domains: {
      lesson_plan_fidelity: { domain_score: 6, domain_max: 20, indicators_applicable: 10, assessed: false, indicators: [{ id: 'B1', name: 'Plan B1', score: 1 }] },
      high_leverage_practices: {
        domain_score: 30, domain_max: 48, indicators_applicable: 12,
        indicators: [{ id: 'C2', name: 'Practice C2', score: 2 }, { id: 'C1', name: 'Practice C1', score: 3 }, { id: 'C10', name: 'Practice C10', score: 1 }],
      },
      student_engagement: { domain_score: 21, domain_max: 28, indicators_applicable: 7, indicators: [{ id: 'D1', name: 'Practice D1', score: 3 }] },
      teacher_subject_knowledge: {
        domain_score: 15, domain_max: 20, indicators_applicable: 5,
        indicators: [{ id: 'F1', name: 'Practice F1', score: 3 }, { id: 'F5', name: 'Practice F5', score: null, applicable: false }],
      },
    },
    strengths: [{ title: 'Clear learning goal' }, 'Good examples'],
    lp_fidelity: {
      status: 'ok',
      moves: [
        { move_id: 'm1', phase: 'warm_up', bucket: 'must_happen', verdict: 'executed', text: 'Warm up' },
        { move_id: 'm2', phase: 'exit', bucket: 'must_happen', verdict: 'not_done', text: 'Exit ticket' },
      ],
    },
    ...extra,
  };
}

function baseTables() {
  return {
    leaderSchools: [
      { leader_user_id: 'coach-1', school_id: 's1', school_ext_id: 'niete:901', emis: '901', school_name: 'School One' },
      { leader_user_id: 'coach-2', school_id: 's2', school_ext_id: 'niete:902', emis: '902', school_name: 'School Two' },
    ],
    schools: [
      { id: 's1', name: 'School One (register)', emis: '901' },
      { id: 's2', name: 'School Two (register)', emis: '902' },
    ],
    users: [
      { id: 'u1', phone_number: PHONE.t1, name: 'Teacher One', role: 'teacher', school_id: 's1', is_test_user: false, deleted_at: null, preferred_language: 'en' },
      { id: 'u2', phone_number: PHONE.t2, name: 'Teacher Two', role: 'teacher', school_id: 's1', is_test_user: false, deleted_at: null },
      { id: 'up', phone_number: PHONE.p1, name: 'Principal One', role: 'principal', school_id: 's1', is_test_user: false, deleted_at: null },
      { id: 'ut', phone_number: PHONE.tt, name: 'Test Account', role: 'teacher', school_id: 's1', is_test_user: true, deleted_at: null },
      { id: 'u3', phone_number: PHONE.t3, name: 'Teacher Three', role: 'teacher', school_id: 's2', is_test_user: false, deleted_at: null },
      { id: 'coach-1', phone_number: ph(91), name: 'Coach One', role: 'coach', school_id: null, is_test_user: false },
      { id: 'coach-2', phone_number: ph(92), name: 'Coach Two', role: 'coach', school_id: null, is_test_user: false },
    ],
    lessonPlans: [
      // Mon: lesson X twice (a same-day repeat counts once) and lesson Y; an app open that day adds nothing.
      { id: 'l1', user_id: 'u1', created_at: pk('2026-10-26 09:00'), grade: '3', subject: 'math', topic: 'Lesson X', surface: null, lesson_id: 'grade_3_math_ch1_seg1' },
      { id: 'l2', user_id: 'u1', created_at: pk('2026-10-26 09:05'), grade: '3', subject: 'math', topic: 'Lesson X', surface: null, lesson_id: 'grade_3_math_ch1_seg1' },
      { id: 'l3', user_id: 'u1', created_at: pk('2026-10-26 10:00'), grade: '3', subject: 'english', topic: 'Lesson Y', surface: null, lesson_id: 'grade_3_english_ch2_seg1' },
      // Tue: an app-surface row and the open of the same plan are one plan; Tue 23:59:59 PKT is still Tuesday.
      { id: 'l4', user_id: 'u1', created_at: pk('2026-10-27 08:00'), grade: '3', subject: 'math', topic: 'Lesson Z', surface: 'app', lesson_id: 'grade_3_math_ch1_seg3' },
      // Wed 00:00 PKT is Wednesday: lesson X again, a different day, counts again.
      { id: 'l5', user_id: 'u1', created_at: '2026-10-27T19:00:00.000Z', grade: '3', subject: 'math', topic: 'Lesson X', surface: null, lesson_id: 'grade_3_math_ch1_seg1' },
      // Sunday before the week: outside it.
      { id: 'l6', user_id: 'u1', created_at: pk('2026-10-25 22:00'), grade: '3', subject: 'math', topic: 'Old', surface: null, lesson_id: 'grade_3_math_ch1_seg9' },
      // A typed plan (no lesson id) is its own plan.
      { id: 'l7', user_id: 'u2', created_at: pk('2026-10-27 11:00'), grade: null, subject: null, topic: 'Typed topic', surface: null, lesson_id: null },
      // the test account's plan never counts
      { id: 'l8', user_id: 'ut', created_at: pk('2026-10-27 11:00'), grade: '3', subject: 'math', topic: 'T', surface: null, lesson_id: 'grade_3_math_ch1_seg1' },
    ],
    opens: [
      { id: 'o0', user_id: 'u1', opened_at: pk('2026-10-26 11:00'), plan_kind: 'k5', source: 'viewer', plan_ref: 'grade_3_math_ch4_seg1' },
      { id: 'o1', user_id: 'u1', opened_at: pk('2026-10-27 08:01'), plan_kind: 'k5', source: 'viewer', plan_ref: 'grade_3_math_ch1_seg3' },
      { id: 'o2', user_id: 'u1', opened_at: '2026-10-27T18:59:59.000Z', plan_kind: 'k5', source: 'viewer', plan_ref: 'grade_2_urdu_ch5_seg2' },
      { id: 'o3', user_id: 'u1', opened_at: pk('2026-10-27 12:00'), plan_kind: 'k5', source: 'external', plan_ref: 'grade_3_math_ch7_seg1' },
      { id: 'o4', user_id: 'u1', opened_at: pk('2026-10-27 12:00'), plan_kind: 'g612', source: 'viewer', plan_ref: 'grade_8_geo.c04' },
    ],
    sessions: [
      // DC
      { id: 'd1', user_id: 'u1', created_at: pk('2026-10-26 10:00'), status: 'completed', observation_type: null, analysis_data: analysis(60), prioritized_action: { action: 'ACTION-d1 next class', thing_to_try: { text: 'TRY-d1 the exit ticket', move_id: 'm2' } }, conversation_state: { questions: [{ question: 'What went well?', answer: 'The pairs talked.' }, { question: 'Q2', answer: '' }] }, transcript_text: 'TRANSCRIPT child Ali said' },
      { id: 'd2', user_id: 'u1', created_at: pk('2026-10-27 10:00'), status: 'completed', observation_type: null, duplicate_of_session_id: 'd1', analysis_data: analysis(60) },
      { id: 'd3', user_id: 'u1', created_at: pk('2026-10-27 11:00'), status: 'processing', observation_type: null, analysis_data: analysis(55) },
      { id: 'd4', user_id: 'u1', created_at: pk('2026-10-28 09:00'), status: 'completed', observation_type: null, analysis_data: { grade: 3 } },
      { id: 'd5', user_id: 'u1', created_at: pk('2026-10-28 10:00'), status: 'completed', observation_type: null, analysis_data: analysis(70), prioritized_action: { action: 'ACTION-d5', thing_to_try: { text: '   ' } } },
      { id: 'd0', user_id: 'u1', created_at: pk('2026-10-20 10:00'), status: 'completed', observation_type: null, analysis_data: analysis(50) },
      // coach observations
      { id: 'h1', user_id: 'u1', created_at: pk('2026-10-26 12:00'), status: 'observer_review_complete', observation_type: 'leader_observation', observer_user_id: 'coach-1', analysis_data: analysis(50), prioritized_action: { action: 'STEP-h1 agreed' } },
      { id: 'h2', user_id: 'u1', created_at: pk('2026-10-28 12:00'), status: 'awaiting_observer_review', observation_type: 'leader_observation', observer_user_id: 'coach-2', analysis_data: analysis(65) },
      { id: 'h3', user_id: 'u1', created_at: pk('2026-10-27 12:00'), status: 'failed', observation_type: 'leader_observation', observer_user_id: 'coach-1', analysis_data: analysis(40) },
      { id: 'h4', user_id: 'u1', created_at: pk('2026-10-27 13:00'), status: 'observer_review_complete', observation_type: 'leader_observation', observer_user_id: 'coach-1', analysis_data: analysis(80, { observe2: { rubric: 'fico17' } }) },
      { id: 'h5', user_id: 'u1', created_at: pk('2026-10-13 12:00'), status: 'observer_review_complete', observation_type: 'leader_observation', observer_user_id: 'coach-1', analysis_data: analysis(40) },
      // another coach's teacher
      { id: 'x1', user_id: 'u3', created_at: pk('2026-10-26 10:00'), status: 'completed', observation_type: null, analysis_data: analysis(90), prioritized_action: { action: 'ACTION-x1' } },
    ],
    training: [
      { user_id: 'u1', module_id: 11, completed_at: pk('2026-10-26 15:00') },
      { user_id: 'u1', module_id: 11, completed_at: pk('2026-10-27 15:00') },
      { user_id: 'u1', module_id: 12, completed_at: pk('2026-10-28 15:00') },
      { user_id: 'u1', module_id: 10, completed_at: pk('2026-09-01 15:00') },
    ],
    modules: [
      { id: 10, course_id: 100, title: 'Part 1', order_index: 1, is_active: true },
      { id: 11, course_id: 100, title: 'Part 2', order_index: 2, is_active: true },
      { id: 12, course_id: 100, title: 'Part 3', order_index: 3, is_active: true },
      { id: 13, course_id: 101, title: 'Other part', order_index: 1, is_active: true },
    ],
    courses: [{ id: 100, title: 'Course A', order_index: 1 }, { id: 101, title: 'Course B', order_index: 2 }],
    requests: [
      { id: 'r1', user_id: 'u1', created_at: pk('2026-10-26 16:00'), grade_code: 'grade_3', subject_code: 'math' },
      { id: 'r2', user_id: 'u1', created_at: pk('2026-10-27 16:00'), grade_code: 'grade_3', subject_code: 'math' },
      { id: 'r3', user_id: 'u1', created_at: pk('2026-10-27 17:00'), grade_code: 'grade_3', subject_code: 'math' },
      { id: 'r4', user_id: 'u1', created_at: pk('2026-10-28 16:00'), grade_code: 'grade_3', subject_code: 'english' },
    ],
    papers: [
      { id: 'p1', request_id: 'r1', attempt: 1, status: 'ready', edited_from: null, question_count: 10, total_marks: 20 },
      { id: 'p2', request_id: 'r2', attempt: 1, status: 'failed', edited_from: null },
      { id: 'p3', request_id: 'r3', attempt: 1, status: 'failed', edited_from: null },
      { id: 'p3e', request_id: 'r3', attempt: 1, status: 'ready', edited_from: 'p3' },
      { id: 'p4', request_id: 'r4', attempt: 1, status: 'failed', edited_from: null },
      { id: 'p4b', request_id: 'r4', attempt: 2, status: 'ready', edited_from: null, question_count: 8, total_marks: 16 },
    ],
    ab: [],
  };
}

// ── the fake database ─────────────────────────────────────────────────────────

const ms = (v) => Date.parse(v instanceof Date ? v.toISOString() : v);
const inWin = (at, lo, hi) => (!lo || ms(at) >= ms(lo)) && (!hi || ms(at) < ms(hi));
const rostered = (u) => !!u && ['teacher', 'principal'].includes(u.role) && u.is_test_user !== true && !u.deleted_at;
const DEAD = ['cancelled', 'abandoned', 'failed', 'test_cleanup'];

function fakeDb(t) {
  const user = (id) => t.users.find((u) => u.id === id);
  const coachSchoolIds = (coach) => {
    const ids = new Set();
    for (const ls of t.leaderSchools.filter((x) => x.leader_user_id === coach)) {
      for (const s of t.schools) if (ls.school_id === s.id || ls.school_ext_id === `niete:${s.emis}`) ids.add(s.id);
    }
    return ids;
  };
  const calls = [];
  const query = async (sql, params = []) => {
    const tag = (String(sql).match(/\/\* sc:([a-z-]+) \*\//) || [])[1];
    calls.push({ tag, sql, params });
    switch (tag) {
      case 'school': {
        const [coach, emis] = params;
        const rows = [];
        for (const ls of t.leaderSchools.filter((x) => x.leader_user_id === coach && (x.emis === emis || (!x.emis && x.school_ext_id === `niete:${emis}`)))) {
          for (const s of t.schools) if (ls.school_id === s.id || ls.school_ext_id === `niete:${s.emis}`) rows.push({ id: s.id, name: s.name, emis: s.emis, school_name: ls.school_name });
        }
        return { rows };
      }
      case 'roster':
        return { rows: t.users.filter((u) => params[0].includes(u.school_id) && rostered(u)) };
      case 'teacher': {
        const [coach, ext] = params;
        const ids = coachSchoolIds(coach);
        const u = t.users.find((x) => x.phone_number === ext && rostered(x) && ids.has(x.school_id));
        if (!u) return { rows: [] };
        const s = t.schools.find((x) => x.id === u.school_id);
        return { rows: [{ ...u, school_name: s.name, emis: s.emis }] };
      }
      case 'teacher-by-id': {
        const [coach, id] = params;
        const ids = coachSchoolIds(coach);
        const u = t.users.find((x) => x.id === id && rostered(x) && ids.has(x.school_id));
        if (!u) return { rows: [] };
        const s = t.schools.find((x) => x.id === u.school_id);
        return { rows: [{ ...u, school_name: s.name, emis: s.emis }] };
      }
      case 'lp': {
        const [ids, lo, hi] = params;
        return { rows: t.lessonPlans.filter((l) => ids.includes(l.user_id) && inWin(l.created_at, lo, hi)).map((l) => ({ ...l, at: l.created_at })) };
      }
      case 'opens': {
        const [ids, lo, hi] = params;
        return { rows: t.opens.filter((o) => ids.includes(o.user_id) && o.plan_kind === 'k5' && o.source === 'viewer' && inWin(o.opened_at, lo, hi)).map((o) => ({ ...o, at: o.opened_at })) };
      }
      case 'sessions': {
        const [ids, lo, hi] = params;
        return {
          rows: t.sessions.filter((c) => ids.includes(c.user_id) && inWin(c.created_at, lo, hi)
            && (c.observation_type == null || c.observation_type === 'leader_observation')).map((c) => {
            const o = c.observer_user_id ? user(c.observer_user_id) : null;
            return {
              id: c.id, user_id: c.user_id, at: c.created_at, updated_at: c.updated_at || c.created_at, status: c.status,
              observation_type: c.observation_type || null, duplicate_of_session_id: c.duplicate_of_session_id || null,
              observer_user_id: c.observer_user_id || null, observer_name: o ? o.name : null, observer_test: !!(o && o.is_test_user),
            };
          }),
        };
      }
      case 'scores': {
        const rows = t.sessions.filter((c) => params[0].includes(c.id)).map((c) => {
          const a = c.analysis_data || {};
          const d = a.domains || {};
          const col = (k, f) => (d[k] && d[k][f] != null ? String(d[k][f]) : null);
          const out = { id: c.id, updated_at: c.updated_at || c.created_at, scores: a.scores || null, grade: a.grade == null ? null : String(a.grade), subject: a.subject || null, rubric: (a.observe2 && a.observe2.rubric) || null };
          for (const [k, key] of Object.entries({ b: 'lesson_plan_fidelity', c: 'high_leverage_practices', d: 'student_engagement', f: 'teacher_subject_knowledge' })) {
            out[`${k}_score`] = col(key, 'domain_score');
            out[`${k}_max`] = col(key, 'domain_max');
            out[`${k}_assessed`] = col(key, 'assessed');
          }
          return out;
        });
        return { rows };
      }
      case 'last-visit': {
        const out = new Map();
        for (const c of t.sessions) {
          if (!params[0].includes(c.user_id) || c.observation_type !== 'leader_observation' || DEAD.includes(c.status)) continue;
          if (c.observer_user_id === c.user_id) continue;
          if (!out.has(c.user_id) || ms(c.created_at) > ms(out.get(c.user_id))) out.set(c.user_id, c.created_at);
        }
        return { rows: [...out].map(([user_id, at]) => ({ user_id, at })) };
      }
      case 'training': {
        const [ids, lo, hi] = params;
        const first = new Map();
        for (const r of t.training) {
          if (!ids.includes(r.user_id) || !inWin(r.completed_at, lo, hi)) continue;
          const k = `${r.user_id}|${r.module_id}`;
          if (!first.has(k) || ms(r.completed_at) < ms(first.get(k).at)) first.set(k, { user_id: r.user_id, module_id: r.module_id, at: r.completed_at });
        }
        return { rows: [...first.values()] };
      }
      case 'courses': {
        const [moduleIds, uid] = params;
        const courseIds = new Set(t.modules.filter((m) => moduleIds.map(Number).includes(m.id)).map((m) => m.course_id));
        return {
          rows: t.modules.filter((m) => courseIds.has(m.course_id) && m.is_active).map((m) => {
            const c = t.courses.find((x) => x.id === m.course_id);
            const done = t.training.filter((r) => r.user_id === uid && r.module_id === m.id).map((r) => r.completed_at).sort()[0] || null;
            return { module_id: m.id, module_title: m.title, module_order: m.order_index, course_id: c.id, course_title: c.title, course_order: c.order_index, done_at: done };
          }),
        };
      }
      case 'papers': {
        const [ids, lo, hi] = params;
        const rows = [];
        for (const r of t.requests) {
          if (!ids.includes(r.user_id) || !inWin(r.created_at, lo, hi)) continue;
          const roots = t.papers.filter((p) => p.request_id === r.id && p.edited_from == null && p.status === 'ready').sort((a, b) => b.attempt - a.attempt);
          if (!roots.length) continue;
          rows.push({ id: r.id, user_id: r.user_id, at: r.created_at, grade_code: r.grade_code, subject_code: r.subject_code, questions: roots[0].question_count, marks: roots[0].total_marks });
        }
        return { rows };
      }
      case 'group': {
        const row = t.ab.find((x) => x.school_id === params[0]);
        return { rows: row ? [{ ab_group: row.ab_group }] : [] };
      }
      case 'actions':
        return {
          rows: t.sessions.filter((c) => params[0].includes(c.id)).map((c) => {
            const pa = c.prioritized_action || {};
            return { id: c.id, action: pa.action == null ? null : pa.action, thing_text: pa.thing_to_try ? pa.thing_to_try.text : null };
          }),
        };
      case 'strengths':
        return {
          rows: t.sessions.filter((c) => params[0].includes(c.id)).map((c) => {
            const a = c.analysis_data || {};
            return { id: c.id, strengths: a.strengths || null, lp_strengths: (a.lp_fidelity && a.lp_fidelity.strengths) || null, narrative: a.report_narrative || null };
          }),
        };
      case 'session': {
        // Deliberately the whole row, transcript included: the service must not pass it on.
        const c = t.sessions.find((x) => x.id === params[0]);
        return { rows: c ? [{ ...c }] : [] };
      }
      default:
        throw new Error(`untagged or unknown read: ${String(sql).slice(0, 80)}`);
    }
  };
  query.calls = calls;
  return query;
}

let tables;
let db;
const opts = (period = 'week') => ({ period, today: TODAY, memo: Card.createMemo() });
beforeEach(() => {
  tables = baseTables();
  db = fakeDb(tables);
});

// ── the counting definitions ─────────────────────────────────────────────────

describe('lesson plans: the RDF lp_use, a same-day repeat of one plan counted once', () => {
  test('per teacher-day: WhatsApp plans deduped by plan; an app plan only on a day with no WhatsApp row', () => {
    const rows = [
      { id: 'a', user_id: 'u', at: pk('2026-10-26 09:00'), surface: null, lesson_id: 'X' },
      { id: 'b', user_id: 'u', at: pk('2026-10-26 09:05'), surface: null, lesson_id: 'X' },
      { id: 'c', user_id: 'u', at: pk('2026-10-26 10:00'), surface: null, lesson_id: null },
      { id: 'd', user_id: 'u', at: pk('2026-10-26 10:00'), surface: null, lesson_id: null },
      { id: 'e', user_id: 'u', at: pk('2026-10-27 08:00'), surface: 'app', lesson_id: 'Z' },
    ];
    const opens = [
      { id: 'o1', user_id: 'u', at: pk('2026-10-26 11:00'), plan_ref: 'W' },
      { id: 'o2', user_id: 'u', at: pk('2026-10-27 08:01'), plan_ref: 'Z' },
      { id: 'o3', user_id: 'u', at: pk('2026-10-27 09:00'), plan_ref: 'Y' },
    ];
    const plans = Card.lessonPlansOf(rows, opens);
    const byDay = plans.reduce((m, p) => ({ ...m, [p.day]: (m[p.day] || 0) + 1 }), {});
    expect(byDay).toEqual({ '2026-10-26': 3, '2026-10-27': 2 });
    expect(plans.find((p) => p.day === '2026-10-27' && p.ref === 'Z').id).toBe('e');
  });

  test('the school card counts 6: five for her (2 Mon, 2 Tue, 1 Wed), one typed plan for another; test accounts out', async () => {
    const out = await Card.getSchoolCard(db, 'coach-1', '901', opts());
    const lp = out.tiles.find((t) => t.feature === 'lp');
    expect(lp).toMatchObject({ total: 6, makers: 2, perDay: 2, series: [2, 3, 1, 0, 0] });
    const t1 = out.teachers.find((t) => t.teacherExtId === PHONE.t1);
    expect(t1.counts.lp).toBe(5);
  });
});

describe('DC observations: completed, scored, not a repeat send', () => {
  test('isDcObservation', () => {
    expect(Card.isDcObservation({ observation_type: null, status: 'completed', duplicate_of_session_id: null }, 60)).toBe(true);
    expect(Card.isDcObservation({ observation_type: null, status: 'completed', duplicate_of_session_id: 'x' }, 60)).toBe(false);
    expect(Card.isDcObservation({ observation_type: null, status: 'processing' }, 60)).toBe(false);
    expect(Card.isDcObservation({ observation_type: null, status: 'completed' }, null)).toBe(false);
    expect(Card.isDcObservation({ observation_type: 'leader_observation', status: 'completed' }, 60)).toBe(false);
  });

  test('her week: d1 (Mon) and d5 (Wed); the repeat, the unfinished and the unscored are out', async () => {
    const out = await Card.getSchoolCard(db, 'coach-1', '901', opts());
    expect(out.tiles.find((t) => t.feature === 'dc')).toMatchObject({ total: 2, makers: 1, series: [1, 0, 1, 0, 0] });
  });
});

describe('coach observations: a recorded visit, any coach, not failed or cancelled', () => {
  test('isCoachObservation', () => {
    const v = { observation_type: 'leader_observation', status: 'awaiting_observer_review', user_id: 'u', observer_user_id: 'c' };
    expect(Card.isCoachObservation(v)).toBe(true);
    for (const status of ['failed', 'cancelled', 'abandoned', 'test_cleanup']) expect(Card.isCoachObservation({ ...v, status })).toBe(false);
    expect(Card.isCoachObservation({ ...v, observer_user_id: 'u' })).toBe(false);
    expect(Card.isCoachObservation({ ...v, observer_test: true })).toBe(false);
    expect(Card.isCoachObservation({ ...v, observation_type: null })).toBe(false);
  });

  test('3 visits for her; the trend uses only reviewed field-form-free (FICO) visits', async () => {
    const out = await Card.getSchoolCard(db, 'coach-1', '901', opts());
    expect(out.coachObservations.count).toBe(3);
    expect(out.coachObservations.teachers).toEqual([
      { teacherExtId: PHONE.t1, name: 'Teacher One', count: 3, points: [{ date: '2026-10-26', score: 50 }], latest: 50, change: null },
    ]);
  });

  test('change is latest minus first over the period', async () => {
    const out = await Card.getSchoolCard(db, 'coach-1', '901', opts('month'));
    const t1 = out.coachObservations.teachers[0];
    expect(t1.points.map((p) => p.score)).toEqual([40, 50]);
    expect(t1).toMatchObject({ latest: 50, change: 10, count: 4 });
  });
});

describe('training parts: distinct modules finished in the period', () => {
  test('module 11 twice is one part, on its first day', async () => {
    const out = await Card.getSchoolCard(db, 'coach-1', '901', opts());
    expect(out.tiles.find((t) => t.feature === 'training')).toMatchObject({ total: 2, makers: 1, series: [1, 0, 1, 0, 0] });
  });
});

describe('papers: requests that reached a ready root paper, a retry once', () => {
  test('r1 and r4 count; a failed request and one whose only ready paper is an edit do not', async () => {
    const out = await Card.getSchoolCard(db, 'coach-1', '901', opts());
    expect(out.tiles.find((t) => t.feature === 'papers')).toMatchObject({ total: 2, makers: 1, series: [1, 0, 1, 0, 0] });
  });
});

describe('contribution % and the star', () => {
  test('her four counts over the school total, rounded; null when she has none', () => {
    expect(Card.contributionPct(11, 12)).toBe(92);
    expect(Card.contributionPct(1, 12)).toBe(8);
    expect(Card.contributionPct(0, 12)).toBeNull();
    expect(Card.contributionPct(0, 0)).toBeNull();
  });

  test('the top two totals above 0 are starred; a tie for second place shares it', () => {
    const t = (total) => ({ total });
    expect(Card.starsOf([t(10), t(8), t(8), t(5), t(0)])).toEqual([true, true, true, false, false]);
    expect(Card.starsOf([t(3), t(0), t(0)])).toEqual([true, false, false]);
    expect(Card.starsOf([t(0), t(0)])).toEqual([false, false]);
  });

  test('on the card: sorted by total, the principal with nothing last, no percentage for her', async () => {
    const out = await Card.getSchoolCard(db, 'coach-1', '901', opts());
    expect(out.teachers.map((t) => [t.name, t.total, t.contributionPct, t.star])).toEqual([
      ['Teacher One', 11, 92, true],
      ['Teacher Two', 1, 8, true],
      ['Principal One', 0, null, false],
    ]);
    expect(out.teachers[0]).toMatchObject({ counts: { lp: 5, dc: 2, training: 2, papers: 2 }, lastVisitDaysAgo: 0 });
    expect(out.teachers[1].lastVisitDaysAgo).toBeNull();
  });
});

describe('the school card', () => {
  test('one school, its roster (test accounts out), last visit and the period', async () => {
    const out = await Card.getSchoolCard(db, 'coach-1', '901', opts());
    expect(out.school).toEqual({ emis: '901', name: 'School One', teachers: 3, lastVisitDaysAgo: 0 });
    expect(out.period).toMatchObject({ key: 'week', from: '2026-10-26', to: '2026-10-28', schoolDaysSoFar: 3 });
    expect(out.tiles.map((t) => t.feature)).toEqual(['lp', 'dc', 'training', 'papers']);
  });

  test('ONE school is read: every per-teacher read names only that school\'s roster', async () => {
    await Card.getSchoolCard(db, 'coach-1', '901', opts());
    for (const c of db.calls.filter((x) => ['lp', 'opens', 'sessions', 'training', 'papers', 'last-visit'].includes(x.tag))) {
      expect([...c.params[0]].sort()).toEqual(['u1', 'u2', 'up']);
    }
  });

  test('today: totals and makers only, no rate', async () => {
    const out = await Card.getSchoolCard(db, 'coach-1', '901', opts('today'));
    expect(out.period.buckets).toEqual([]);
    const lp = out.tiles.find((t) => t.feature === 'lp');
    expect(lp).toMatchObject({ total: 1, makers: 1, perDay: null, series: [] });
  });

  test('another coach\'s school is null (the route answers 404)', async () => {
    expect(await Card.getSchoolCard(db, 'coach-1', '902', opts())).toBeNull();
    expect(await Card.getSchoolCard(db, 'coach-1', 'nope', opts())).toBeNull();
  });
});

describe('the feature grid', () => {
  test('one row per teacher, a School row, sorted by total; zero rows last', async () => {
    const out = await Card.getSchoolFeature(db, 'coach-1', '901', 'lp', opts());
    expect(out.feature).toBe('lp');
    expect(out.rows).toEqual([
      { teacherExtId: PHONE.t1, name: 'Teacher One', cells: [2, 2, 1, 0, 0], total: 5 },
      { teacherExtId: PHONE.t2, name: 'Teacher Two', cells: [0, 1, 0, 0, 0], total: 1 },
      { teacherExtId: PHONE.p1, name: 'Principal One', cells: [0, 0, 0, 0, 0], total: 0 },
    ]);
    expect(out.school).toEqual([2, 3, 1, 0, 0]);
    expect(out.total).toBe(6);
  });

  test('an unknown feature or another coach\'s school is null', async () => {
    expect(await Card.getSchoolFeature(db, 'coach-1', '901', 'coach', opts())).toBeNull();
    expect(await Card.getSchoolFeature(db, 'coach-1', '902', 'lp', opts())).toBeNull();
  });
});

describe('the teacher card', () => {
  test('her tiles, scores against the week before, days with use', async () => {
    const out = await Card.getTeacherCard(db, 'coach-1', PHONE.t1, opts());
    expect(out.teacher).toEqual({ teacherExtId: PHONE.t1, name: 'Teacher One', school: 'School One (register)', emis: '901' });
    expect(out.tiles.lp).toEqual({ count: 5, series: [2, 2, 1, 0, 0] });
    expect(out.tiles.dc).toEqual({ count: 2, series: [1, 0, 1, 0, 0] });
    expect(out.tiles.papers).toEqual({ count: 2, series: [1, 0, 1, 0, 0] });
    expect(out.tiles.coach).toMatchObject({ count: 3 });
    expect(out.tiles.training).toMatchObject({ parts: 2, courses: 1, series: [1, 0, 1, 0, 0] });
    expect(out.tiles.aiScore).toEqual({ avg: 65, prevAvg: 50 });
    expect(out.tiles.coachScore).toEqual({ avg: 50, prevAvg: null });
    expect(out.tiles.days).toEqual({ withUse: 3, schoolDays: 3 });
    expect(out.chart).toEqual([
      { kind: 'dc', id: 'd1', date: '2026-10-26', score: 60 },
      { kind: 'coach', id: 'h1', date: '2026-10-26', score: 50 },
      { kind: 'dc', id: 'd5', date: '2026-10-28', score: 70 },
    ]);
  });

  test('a teacher outside her patch, a test account and an unknown number are null', async () => {
    expect(await Card.getTeacherCard(db, 'coach-1', PHONE.t3, opts())).toBeNull();
    expect(await Card.getTeacherCard(db, 'coach-1', PHONE.tt, opts())).toBeNull();
    expect(await Card.getTeacherCard(db, 'coach-1', ph(9999), opts())).toBeNull();
  });
});

describe('her lists', () => {
  test('dc: newest first, with class and AI score', async () => {
    const out = await Card.getTeacherItems(db, 'coach-1', PHONE.t1, 'dc', opts());
    expect(out.items).toEqual([
      { sessionId: 'd5', date: '2026-10-28', grade: '3', subject: 'math', aiScore: 70 },
      { sessionId: 'd1', date: '2026-10-26', grade: '3', subject: 'math', aiScore: 60 },
    ]);
  });

  test('coach: every recorded visit, its coach, its form; a score only once reviewed', async () => {
    const out = await Card.getTeacherItems(db, 'coach-1', PHONE.t1, 'coach', opts());
    expect(out.items).toEqual([
      { id: 'h2', date: '2026-10-28', coachName: 'Coach Two', score: null, form: 'v3' },
      { id: 'h4', date: '2026-10-27', coachName: 'Coach One', score: 80, form: 'observe2' },
      { id: 'h1', date: '2026-10-26', coachName: 'Coach One', score: 50, form: 'v3' },
    ]);
  });

  test('lp: one row per counted plan, newest first', async () => {
    const out = await Card.getTeacherItems(db, 'coach-1', PHONE.t1, 'lp', opts());
    expect(out.items).toHaveLength(5);
    expect(out.items[0]).toEqual({ id: 'l5', date: '2026-10-28', grade: '3', subject: 'math', title: 'Lesson X' });
    expect(out.items.map((i) => i.id)).toContain('open:o2');
    expect(out.items.find((i) => i.id === 'open:o2')).toMatchObject({ grade: '2', subject: 'urdu', title: null, date: '2026-10-27' });
  });

  test('papers: questions and marks of the ready root paper', async () => {
    const out = await Card.getTeacherItems(db, 'coach-1', PHONE.t1, 'papers', opts());
    expect(out.items).toEqual([
      { id: 'r4', date: '2026-10-28', grade: 'grade_3', subject: 'english', questions: 8, marks: 16 },
      { id: 'r1', date: '2026-10-26', grade: 'grade_3', subject: 'math', questions: 10, marks: 20 },
    ]);
  });

  test('training: the courses she worked in, every part with its done date', async () => {
    const out = await Card.getTeacherItems(db, 'coach-1', PHONE.t1, 'training', opts());
    expect(out.courses).toEqual([{
      name: 'Course A',
      done: true,
      parts: [
        { name: 'Part 1', doneAt: '2026-09-01' },
        { name: 'Part 2', doneAt: '2026-10-26' },
        { name: 'Part 3', doneAt: '2026-10-28' },
      ],
    }]);
  });

  test('an unknown feature, or a teacher outside her patch, is null', async () => {
    expect(await Card.getTeacherItems(db, 'coach-1', PHONE.t1, 'transcript', opts())).toBeNull();
    expect(await Card.getTeacherItems(db, 'coach-1', PHONE.t3, 'dc', opts())).toBeNull();
  });
});

// ── the v10 rule ─────────────────────────────────────────────────────────────

describe('the next step she was shown (v10 A/B)', () => {
  test('C and D: the one thing to try when it has words; otherwise, and for A, B and undrawn, the report action', () => {
    const pa = { action: 'Do the action', thing_to_try: { text: 'Try the move' } };
    expect(Card.nextStepShown(pa, 'C')).toBe('Try the move');
    expect(Card.nextStepShown(pa, 'D')).toBe('Try the move');
    expect(Card.nextStepShown(pa, 'A')).toBe('Do the action');
    expect(Card.nextStepShown(pa, 'B')).toBe('Do the action');
    expect(Card.nextStepShown(pa, null)).toBe('Do the action');
    expect(Card.nextStepShown({ action: 'Do the action', thing_to_try: { text: '  ' } }, 'C')).toBe('Do the action');
    expect(Card.nextStepShown({ action: 'Do the action', thing_to_try: { text: null } }, 'D')).toBe('Do the action');
    expect(Card.nextStepShown({ thing_to_try: { text: 'Try' } }, 'A')).toBeNull();
    expect(Card.nextStepShown(null, 'C')).toBeNull();
  });

  test.each([['A'], ['B'], [null]])('a group %s school: her reports and the session report never carry the thing to try', async (group) => {
    if (group) tables.ab.push({ school_id: 's1', ab_group: group });
    const reports = await Card.getTeacherReports(db, 'coach-1', PHONE.t1, opts());
    expect(reports.nextSteps.map((s) => s.text)).toEqual(['ACTION-d5', 'ACTION-d1 next class']);
    const session = await Card.getSession(db, 'coach-1', 'd1', opts());
    expect(session.nextStep).toBe('ACTION-d1 next class');
    expect(JSON.stringify([reports, session])).not.toMatch(/TRY-/);
  });

  test('a group C school: the thing to try where it has words, the action where it has none', async () => {
    tables.ab.push({ school_id: 's1', ab_group: 'C' });
    const reports = await Card.getTeacherReports(db, 'coach-1', PHONE.t1, opts());
    expect(reports.nextSteps).toEqual([
      { sessionId: 'd5', date: '2026-10-28', grade: '3', subject: 'math', text: 'ACTION-d5' },
      { sessionId: 'd1', date: '2026-10-26', grade: '3', subject: 'math', text: 'TRY-d1 the exit ticket' },
    ]);
    expect((await Card.getSession(db, 'coach-1', 'd1', opts())).nextStep).toBe('TRY-d1 the exit ticket');
  });

  test('the group is read for HER school', async () => {
    tables.ab.push({ school_id: 's2', ab_group: 'D' });
    await Card.getTeacherReports(db, 'coach-1', PHONE.t1, opts());
    const g = db.calls.find((c) => c.tag === 'group');
    expect(g.params).toEqual(['s1']);
  });
});

describe('her coaching reports', () => {
  test('strengths of her last 3 reports, scores by report (DC and coach), coach visits with the step agreed', async () => {
    const out = await Card.getTeacherReports(db, 'coach-1', PHONE.t1, opts());
    expect(out.strengths).toEqual([
      { sessionId: 'd5', date: '2026-10-28', grade: '3', subject: 'math', text: 'Clear learning goal', texts: ['Clear learning goal', 'Good examples'] },
      { sessionId: 'd1', date: '2026-10-26', grade: '3', subject: 'math', text: 'Clear learning goal', texts: ['Clear learning goal', 'Good examples'] },
    ]);
    expect(out.scores[0]).toEqual({ kind: 'coach', id: 'h2', date: '2026-10-28', overall: null, sections: { B: null, C: null, D: null, F: null }, form: 'v3' });
    expect(out.scores.find((s) => s.id === 'd1')).toEqual({ kind: 'dc', id: 'd1', date: '2026-10-26', overall: 60, sections: { B: null, C: 63, D: 75, F: 75 }, form: null });
    expect(out.coachVisits).toEqual([
      { id: 'h2', date: '2026-10-28', score: null, step: null, form: 'v3' },
      { id: 'h4', date: '2026-10-27', score: 80, step: null, form: 'observe2' },
      { id: 'h1', date: '2026-10-26', score: 50, step: 'STEP-h1 agreed', form: 'v3' },
    ]);
  });

  test('a teacher outside her patch is null', async () => {
    expect(await Card.getTeacherReports(db, 'coach-1', PHONE.t3, opts())).toBeNull();
  });
});

// ── the DC report ────────────────────────────────────────────────────────────

describe('the DC report, coach view', () => {
  test('stored scores, every practice in framework order with the session\'s own scale, plan steps, her reflection', async () => {
    const out = await Card.getSession(db, 'coach-1', 'd1', opts());
    expect(out).toMatchObject({
      teacher: { teacherExtId: PHONE.t1, name: 'Teacher One' },
      date: '2026-10-26', grade: '3', subject: 'math', overall: 60,
      whatWentWell: ['Clear learning goal', 'Good examples'],
      reflection: [{ question: 'What went well?', answer: 'The pairs talked.' }],
    });
    expect(out.sections).toEqual([
      { code: 'B', name: 'Lesson Plan Fidelity', pct: null },
      { code: 'C', name: 'High-Leverage Practices', pct: 63 },
      { code: 'D', name: 'Student Engagement', pct: 75 },
      { code: 'F', name: 'Teacher Subject Knowledge', pct: 75 },
    ]);
    expect(out.practices.map((p) => p.id)).toEqual(['B1', 'C1', 'C2', 'C10', 'D1', 'F1', 'F5']);
    expect(out.practices.find((p) => p.id === 'C2')).toEqual({ id: 'C2', name: 'Practice C2', section: 'C', score: 2, scaleMax: 4 });
    expect(out.practices.find((p) => p.id === 'B1').scaleMax).toBe(2);
    expect(out.practices.find((p) => p.id === 'F5').score).toBeNull();
    expect(out.lpSteps).toEqual([
      { step: 'Opening', verdict: 'executed', text: 'Warm up', mustHappen: true },
      { step: 'Check', verdict: 'not_done', text: 'Exit ticket', mustHappen: true },
    ]);
  });

  test('no plan checked: lpSteps is null', async () => {
    tables.sessions.find((s) => s.id === 'd1').analysis_data.lp_fidelity = { status: 'lp_absent' };
    expect((await Card.getSession(db, 'coach-1', 'd1', opts())).lpSteps).toBeNull();
  });

  test('no transcript: the row carries one, the answer never does', async () => {
    const out = await Card.getSession(db, 'coach-1', 'd1', opts());
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/TRANSCRIPT/);
    expect(json).not.toMatch(/transcript/i);
  });

  test('a session of a teacher outside her patch, a coach visit, and an unknown id are null', async () => {
    expect(await Card.getSession(db, 'coach-1', 'x1', opts())).toBeNull();
    expect(await Card.getSession(db, 'coach-1', 'h1', opts())).toBeNull();
    expect(await Card.getSession(db, 'coach-1', '00000000-0000-4000-8000-000000000000', opts())).toBeNull();
  });

  test('a repeat send opens the report it repeats', async () => {
    const out = await Card.getSession(db, 'coach-1', 'd2', opts());
    expect(out).toMatchObject({ sessionId: 'd1', overall: 60 });
  });
});

describe('no read selects the transcript', () => {
  test('across every endpoint', async () => {
    await Card.getSchoolCard(db, 'coach-1', '901', opts());
    await Card.getTeacherCard(db, 'coach-1', PHONE.t1, opts());
    await Card.getTeacherReports(db, 'coach-1', PHONE.t1, opts());
    await Card.getSession(db, 'coach-1', 'd1', opts());
    for (const c of db.calls) expect(c.sql).not.toMatch(/transcript|diarization|SELECT \*/i);
  });
});
