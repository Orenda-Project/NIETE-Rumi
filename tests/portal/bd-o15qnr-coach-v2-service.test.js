/**
 * bd-o15qnr.3 — the coach app v2's read side. Every number is computed from
 * tables that already exist (observation_schedules, coaching_sessions,
 * teacher_training_progress, leader_schools, the patch resolver); nothing new
 * is stored. A HITL visit is a coaching_sessions row with
 * observation_type='leader_observation'; a DC session is one the teacher
 * recorded herself (observation_type null).
 */

const SVC = require('../../dashboard/services/coach-v2.service');
const { PATCH_TEACHERS_SQL } = require('../../dashboard/services/leader-patch.service');

const ME = 'coach-me';
const TODAY = '2026-10-06'; // a Tuesday

const pct = (n) => ({ scores: { percentage: n } });

/** Patch rows exactly as PATCH_TEACHERS_SQL returns them. */
const PATCH = [
  {
    teacher_ext_id: '923001110001', name: 'Ayesha Bibi', phone: '923001110001', school_ext_id: 'niete:110',
    role: 'teacher', rumi_user_id: 'u-ayesha', coaching_sessions: 7, observations: 3, training_modules: 4,
    last_analysis_data: pct(61), school_name: 'IMSG I-10/1',
  },
  {
    teacher_ext_id: '923001110002', name: 'Mehwish Khan', phone: '923001110002', school_ext_id: 'niete:110',
    role: 'teacher', rumi_user_id: 'u-mehwish', coaching_sessions: 11, observations: 4, training_modules: 6,
    last_analysis_data: pct(72), school_name: 'IMSG I-10/1',
  },
  {
    teacher_ext_id: '923001110003', name: 'Farah Naz', phone: '923001110003', school_ext_id: 'niete:620',
    role: 'teacher', rumi_user_id: 'u-farah', coaching_sessions: 2, observations: 0, training_modules: 0,
    last_analysis_data: null, school_name: 'IMSG G-6/2',
  },
  {
    teacher_ext_id: '923001110004', name: 'Not On Rumi', phone: '923001110004', school_ext_id: 'niete:620',
    role: 'teacher', rumi_user_id: null, coaching_sessions: 0, observations: 0, training_modules: 0,
    last_analysis_data: null, school_name: 'IMSG G-6/2',
  },
];

const LEADER_SCHOOLS = [
  { school_ext_id: 'niete:110', school_name: 'IMSG I-10/1', emis: '110' },
  { school_ext_id: 'niete:620', school_name: 'IMSG G-6/2', emis: '620' },
  { school_ext_id: 'niete:999', school_name: 'IMSB Empty', emis: '999' },
];

/** HITL visits of the patch teachers (any observer). */
const FACTS = [
  { user_id: 'u-ayesha', created_at: '2026-09-14T09:00:00Z', status: 'observer_review_complete', analysis_data: pct(61) },
  { user_id: 'u-ayesha', created_at: '2026-08-20T09:00:00Z', status: 'completed', analysis_data: pct(64) },
  { user_id: 'u-ayesha', created_at: '2026-07-12T09:00:00Z', status: 'completed', analysis_data: pct(58) },
  // in flight: counts as a visit, never as a score
  { user_id: 'u-mehwish', created_at: '2026-10-06T04:00:00Z', status: 'awaiting_observer_review', analysis_data: pct(10) },
  { user_id: 'u-mehwish', created_at: '2026-09-01T09:00:00Z', status: 'completed', analysis_data: pct(72) },
];

const TRAINING = [
  { user_id: 'u-ayesha', last_training_at: '2026-09-24T10:00:00Z' },
];

/** This coach's observations, for school visits and reports. */
const COACH_SESSIONS = [
  { id: 's-waiting-draft', user_id: 'u-mehwish', created_at: '2026-10-06T04:00:00Z', status: 'awaiting_observer_review', debrief_status: 'pending', analysis_data: null, audio_url: 'https://r2/classroom_audio/coach-me/2026-10/portal_ab12.webm', teacher_name: 'Mehwish Khan', teacher_phone: '923001110002', sched_teacher_name: 'Mehwish Khan', sched_school_name: 'IMSG I-10/1', sched_school_ext_id: 'niete:110', sched_teacher_ext_id: '923001110002' },
  { id: 's-waiting-talk', user_id: 'u-ayesha', created_at: '2026-10-05T09:00:00Z', status: 'observer_review_complete', debrief_status: 'pending', analysis_data: pct(66), audio_url: 'https://r2/classroom_audio/coach-me/2026-10/wa_123.ogg', teacher_name: 'Ayesha Bibi', teacher_phone: '923001110001', sched_teacher_name: null, sched_school_name: null, sched_school_ext_id: null, sched_teacher_ext_id: null },
  { id: 's-analysing', user_id: 'u-ayesha', created_at: '2026-10-05T08:00:00Z', status: 'transcribing', debrief_status: 'pending', analysis_data: null, audio_url: null, teacher_name: 'Ayesha Bibi', teacher_phone: '923001110001', sched_teacher_name: null, sched_school_name: 'IMSG I-10/1', sched_school_ext_id: 'niete:110', sched_teacher_ext_id: null },
  { id: 's-sent', user_id: 'u-ayesha', created_at: '2026-09-14T09:00:00Z', status: 'observer_review_complete', debrief_status: 'done', analysis_data: pct(61), audio_url: null, teacher_name: 'Ayesha Bibi', teacher_phone: '923001110001', sched_teacher_name: 'Ayesha Bibi', sched_school_name: 'IMSG I-10/1', sched_school_ext_id: 'niete:110', sched_teacher_ext_id: '923001110001' },
  { id: 's-old', user_id: 'u-ayesha', created_at: '2026-05-01T09:00:00Z', status: 'completed', debrief_status: null, analysis_data: pct(50), audio_url: null, teacher_name: 'Ayesha Bibi', teacher_phone: '923001110001', sched_teacher_name: null, sched_school_name: null, sched_school_ext_id: null, sched_teacher_ext_id: null },
  { id: 's-failed', user_id: 'u-farah', created_at: '2026-10-04T09:00:00Z', status: 'failed', debrief_status: 'pending', analysis_data: null, audio_url: null, teacher_name: 'Farah Naz', teacher_phone: '923001110003', sched_teacher_name: null, sched_school_name: null, sched_school_ext_id: null, sched_teacher_ext_id: null },
];

const MY_SCHEDULES = [
  { id: 'v-overdue', leader_user_id: ME, teacher_name: 'Sadia Noor', school_name: 'IMCB G-9/4', school_ext_id: 'niete:494', teacher_ext_id: '923009990001', scheduled_for: '2026-10-02', scheduled_slot: '09:00', status: 'upcoming', session_id: null },
  { id: 'v-done', leader_user_id: ME, teacher_name: 'Mehwish Khan', school_name: 'IMSG I-10/1', school_ext_id: 'niete:110', teacher_ext_id: '923001110002', scheduled_for: TODAY, scheduled_slot: '09:00', status: 'done', session_id: 's-waiting-draft' },
  { id: 'v-late', leader_user_id: ME, teacher_name: 'Rabia Saleem', school_name: 'IMCG F-7/2', school_ext_id: 'niete:72', teacher_ext_id: '923001110009', scheduled_for: TODAY, scheduled_slot: '14:00', status: 'upcoming', session_id: null },
  { id: 'v-next', leader_user_id: ME, teacher_name: 'Ayesha Bibi', school_name: 'IMSG I-10/1', school_ext_id: 'niete:110', teacher_ext_id: '923001110001', scheduled_for: TODAY, scheduled_slot: '11:30', status: 'upcoming', session_id: null },
  { id: 'v-wed', leader_user_id: ME, teacher_name: 'Nadia Parveen', school_name: 'IMS Tarnol', school_ext_id: 'niete:801', teacher_ext_id: '923001110010', scheduled_for: '2026-10-07', scheduled_slot: null, status: 'upcoming', session_id: null },
];

function fakeQuery(overrides = {}) {
  const calls = [];
  const q = async (sql, params) => {
    calls.push({ sql, params });
    const S = SVC.SQL;
    if (sql === PATCH_TEACHERS_SQL) return { rows: overrides.patch || PATCH };
    if (sql === S.LEADER_SCHOOLS) return { rows: LEADER_SCHOOLS };
    if (sql === S.TEACHER_FACTS) return { rows: FACTS.filter((f) => params[0].includes(f.user_id)) };
    if (sql === S.TEACHER_TRAINING) return { rows: TRAINING.filter((t) => params[0].includes(t.user_id)) };
    if (sql === S.COACH_SESSIONS) return { rows: COACH_SESSIONS };
    if (sql === S.MY_SCHEDULES) return { rows: MY_SCHEDULES };
    if (sql === S.SCHEDULE_BY_ID) return { rows: MY_SCHEDULES.filter((r) => r.id === params[0]) };
    if (sql === S.TEACHER_HISTORY) return { rows: overrides.history || [] };
    if (sql === S.TEAM_TOTALS) return { rows: [{ today: 46, week: 212, month: 840 }] };
    if (sql === S.TEAM_DAYS) return { rows: [{ day: '2026-10-05', n: 41 }, { day: '2026-10-06', n: 46 }] };
    if (sql === S.TEAM_VISITS) return { rows: overrides.team || [] };
    if (sql === S.COACHES) return { rows: [{ id: ME, name: 'Hataf Atif' }, { id: 'coach-2', name: 'Imran S' }] };
    throw new Error(`unexpected SQL: ${sql.slice(0, 60)}`);
  };
  q.calls = calls;
  return q;
}

describe('getCoachPeople — the Teachers and Schools tabs', () => {
  test('teachers carry the five numbers, computed from existing tables', async () => {
    const { teachers } = await SVC.getCoachPeople(fakeQuery(), ME, { today: TODAY });
    const ayesha = teachers.find((t) => t.name === 'Ayesha Bibi');
    expect(ayesha).toMatchObject({
      teacherExtId: '923001110001', phone: '923001110001', schoolName: 'IMSG I-10/1', schoolExtId: 'niete:110',
      hitl: 3, dc: 7, avgHitl: 61, daysSinceVisit: 22, daysSinceTraining: 12,
    });
  });

  test('an in-flight observation counts as a visit but never as a score', async () => {
    const { teachers } = await SVC.getCoachPeople(fakeQuery(), ME, { today: TODAY });
    const mehwish = teachers.find((t) => t.name === 'Mehwish Khan');
    expect(mehwish.daysSinceVisit).toBe(0);
    expect(mehwish.avgHitl).toBe(72);
  });

  test('never visited, never trained, or not on Rumi: null, so the screen shows a dash', async () => {
    const { teachers } = await SVC.getCoachPeople(fakeQuery(), ME, { today: TODAY });
    const farah = teachers.find((t) => t.name === 'Farah Naz');
    expect(farah).toMatchObject({ daysSinceVisit: null, avgHitl: null, daysSinceTraining: null, hitl: 0, dc: 2 });
    const off = teachers.find((t) => t.phone === '923001110004');
    expect(off).toMatchObject({ daysSinceVisit: null, avgHitl: null });
  });

  test('facts and training are read once for every on-Rumi teacher, never per row', async () => {
    const q = fakeQuery();
    await SVC.getCoachPeople(q, ME, { today: TODAY });
    const facts = q.calls.filter((c) => c.sql === SVC.SQL.TEACHER_FACTS);
    expect(facts).toHaveLength(1);
    expect(facts[0].params[0].sort()).toEqual(['u-ayesha', 'u-farah', 'u-mehwish']);
  });

  test('schools: every assigned school, even one with no teachers yet', async () => {
    const { schools } = await SVC.getCoachPeople(fakeQuery(), ME, { today: TODAY });
    expect(schools.map((s) => s.name).sort()).toEqual(['IMSB Empty', 'IMSG G-6/2', 'IMSG I-10/1']);
    const empty = schools.find((s) => s.name === 'IMSB Empty');
    expect(empty).toMatchObject({ emis: '999', teachers: 0, visits: 0, daysSinceVisit: null, avgHitl: null });
  });

  test('a school counts THIS coach\'s visits in the last 90 days, and days since her last one', async () => {
    const { schools } = await SVC.getCoachPeople(fakeQuery(), ME, { today: TODAY });
    const i10 = schools.find((s) => s.emis === '110');
    // s-waiting-draft, s-waiting-talk, s-analysing, s-sent are inside 90 days; s-old is not; failed never counts
    expect(i10).toMatchObject({ teachers: 2, visits: 4, daysSinceVisit: 0 });
    // average of the scored HITL visits of its teachers: 61, 64, 58, 72
    expect(i10.avgHitl).toBe(63.8);
  });
});

describe('getCoachSchool — one school and its teachers', () => {
  test('returns the school numbers and only its teachers', async () => {
    const out = await SVC.getCoachSchool(fakeQuery(), ME, '110', { today: TODAY });
    expect(out.school).toMatchObject({ name: 'IMSG I-10/1', teachers: 2 });
    expect(out.teachers.map((t) => t.name).sort()).toEqual(['Ayesha Bibi', 'Mehwish Khan']);
  });

  test('a school that is not hers: null', async () => {
    expect(await SVC.getCoachSchool(fakeQuery(), ME, '494', { today: TODAY })).toBeNull();
  });
});

describe('getCoachTeacher — one teacher, her history', () => {
  test('HITL and DC rows, each with its score, newest first', async () => {
    const history = [
      { id: 'h1', created_at: '2026-09-28T09:00:00Z', status: 'completed', observation_type: null, analysis_data: pct(63) },
      { id: 'h2', created_at: '2026-09-14T09:00:00Z', status: 'observer_review_complete', observation_type: 'leader_observation', analysis_data: pct(61) },
      { id: 'h3', created_at: '2026-09-10T09:00:00Z', status: 'transcribing', observation_type: null, analysis_data: null },
    ];
    const out = await SVC.getCoachTeacher(fakeQuery({ history }), ME, '923001110001', { today: TODAY });
    expect(out.teacher).toMatchObject({ name: 'Ayesha Bibi', avgHitl: 61 });
    expect(out.history).toEqual([
      { id: 'h1', date: '2026-09-28T09:00:00Z', kind: 'DC', score: 63 },
      { id: 'h2', date: '2026-09-14T09:00:00Z', kind: 'HITL', score: 61 },
      { id: 'h3', date: '2026-09-10T09:00:00Z', kind: 'DC', score: null },
    ]);
    expect(out.nextVisit).toMatchObject({ id: 'v-next', scheduledFor: TODAY, scheduledSlot: '11:30' });
  });

  test('a teacher outside her patch: null, and her history is never read', async () => {
    const q = fakeQuery();
    expect(await SVC.getCoachTeacher(q, ME, '923000000000', { today: TODAY })).toBeNull();
    expect(q.calls.some((c) => c.sql === SVC.SQL.TEACHER_HISTORY)).toBe(false);
  });
});

describe('getCoachSchedule — My schedule', () => {
  test('the week\'s visits, and overdue ones on their own', async () => {
    const out = await SVC.getCoachSchedule(fakeQuery(), ME, { today: TODAY, from: '2026-10-05', to: '2026-10-11' });
    expect(out.overdue.map((v) => v.id)).toEqual(['v-overdue']);
    expect(out.visits.map((v) => v.id)).toEqual(['v-done', 'v-next', 'v-late', 'v-wed']);
    expect(out.visits[0]).toMatchObject({ teacherName: 'Mehwish Khan', scheduledSlot: '09:00', status: 'done', overdue: false });
  });

  test('passes the coach, the range and today to the query', async () => {
    const q = fakeQuery();
    await SVC.getCoachSchedule(q, ME, { today: TODAY, from: '2026-10-05', to: '2026-10-11' });
    const call = q.calls.find((c) => c.sql === SVC.SQL.MY_SCHEDULES);
    expect(call.params).toEqual([ME, '2026-10-05', '2026-10-11', TODAY]);
  });
});

describe('getCoachHome — today\'s visits and the tile numbers', () => {
  test('today in time order, the next upcoming one marked current', async () => {
    const out = await SVC.getCoachHome(fakeQuery(), ME, { today: TODAY });
    expect(out.today.map((v) => [v.id, v.current])).toEqual([['v-done', false], ['v-next', true], ['v-late', false]]);
  });

  test('tile numbers', async () => {
    const out = await SVC.getCoachHome(fakeQuery(), ME, { today: TODAY });
    expect(out.counts).toMatchObject({ week: 4, overdue: 1, waiting: 2, inProgress: 1, teachers: 4, schools: 3 });
  });
});

describe('getCoachVisit — one schedule entry', () => {
  test('her own visit, with the teacher\'s numbers', async () => {
    const out = await SVC.getCoachVisit(fakeQuery(), ME, 'v-next', { today: TODAY });
    expect(out.visit).toMatchObject({ id: 'v-next', teacherExtId: '923001110001', schoolExtId: 'niete:110', scheduledSlot: '11:30', status: 'upcoming' });
    expect(out.teacher).toMatchObject({ hitl: 3, dc: 7, avgHitl: 61, daysSinceTraining: 12 });
    expect(out.lastVisit).toMatchObject({ date: '2026-09-14T09:00:00Z', score: 61 });
  });

  test('another coach\'s visit: null', async () => {
    const q = fakeQuery();
    MY_SCHEDULES.push({ id: 'v-theirs', leader_user_id: 'coach-2', teacher_ext_id: 'x', scheduled_for: TODAY, status: 'upcoming' });
    try {
      expect(await SVC.getCoachVisit(q, ME, 'v-theirs', { today: TODAY })).toBeNull();
    } finally {
      MY_SCHEDULES.pop();
    }
  });
});

describe('getTeamSchedule — every coach', () => {
  const TEAM = [
    { id: 't1', leader_user_id: 'coach-2', coach_name: 'Imran S', teacher_name: 'Huma', school_name: 'IMSB F-6/2', scheduled_slot: '09:00', status: 'done' },
    { id: 't2', leader_user_id: ME, coach_name: 'Hataf Atif', teacher_name: 'Mehwish Khan', school_name: 'IMSG I-10/1', scheduled_slot: '09:00', status: 'done' },
    { id: 't3', leader_user_id: 'coach-2', coach_name: 'Imran S', teacher_name: 'Sana', school_name: 'IMCG I-8/3', scheduled_slot: '14:00', status: 'upcoming' },
    { id: 't4', leader_user_id: ME, coach_name: 'Hataf Atif', teacher_name: 'Ayesha Bibi', school_name: 'IMSG I-10/1', scheduled_slot: '11:30', status: 'upcoming' },
    { id: 't5', leader_user_id: 'coach-2', coach_name: 'Imran S', teacher_name: 'No time', school_name: 'X', scheduled_slot: null, status: 'upcoming' },
  ];

  test('totals today / this week / this month, and a count for each day of the week', async () => {
    const out = await SVC.getTeamSchedule(fakeQuery({ team: TEAM }), { today: TODAY, date: TODAY, me: ME });
    expect(out.totals).toEqual({ today: 46, week: 212, month: 840 });
    expect(out.days).toHaveLength(7);
    expect(out.days[0]).toEqual({ date: '2026-10-05', count: 41 });
    expect(out.days[1]).toEqual({ date: '2026-10-06', count: 46 });
    expect(out.days[6]).toEqual({ date: '2026-10-11', count: 0 });
  });

  test('visits grouped by time in time order, no-time last, hers marked', async () => {
    const out = await SVC.getTeamSchedule(fakeQuery({ team: TEAM }), { today: TODAY, date: TODAY, me: ME });
    expect(out.groups.map((g) => [g.slot, g.visits.length])).toEqual([['09:00', 2], ['11:30', 1], ['14:00', 1], [null, 1]]);
    expect(out.groups[0].visits.find((v) => v.id === 't2')).toMatchObject({ mine: true, done: true, coachName: 'Hataf Atif' });
  });

  test('a single coach: every query is narrowed to her', async () => {
    const q = fakeQuery({ team: [] });
    await SVC.getTeamSchedule(q, { today: TODAY, date: TODAY, me: ME, coachId: 'coach-2' });
    for (const s of [SVC.SQL.TEAM_TOTALS, SVC.SQL.TEAM_DAYS, SVC.SQL.TEAM_VISITS]) {
      const call = q.calls.find((c) => c.sql === s);
      expect(call.params[call.params.length - 1]).toBe('coach-2');
    }
  });

  test('the coach list for the filter', async () => {
    const out = await SVC.getTeamSchedule(fakeQuery({ team: [] }), { today: TODAY, date: TODAY, me: ME });
    expect(out.coaches).toEqual([{ id: ME, name: 'Hataf Atif', me: true }, { id: 'coach-2', name: 'Imran S', me: false }]);
  });
});

describe('getCoachReports — waiting, in progress, then all by day', () => {
  test('waiting for her: the draft to check and the talk to have', async () => {
    const out = await SVC.getCoachReports(fakeQuery(), ME, {});
    expect(out.waiting.map((r) => [r.id, r.step])).toEqual([['s-waiting-draft', 'draft'], ['s-waiting-talk', 'talk']]);
  });

  test('in progress: still being analysed', async () => {
    const out = await SVC.getCoachReports(fakeQuery(), ME, {});
    expect(out.inProgress.map((r) => [r.id, r.step])).toEqual([['s-analysing', 'analysing']]);
  });

  test('all observations: newest first, failed ones left out, each with its score', async () => {
    const out = await SVC.getCoachReports(fakeQuery(), ME, {});
    expect(out.all.total).toBe(5);
    expect(out.all.items.map((r) => r.id)).toEqual(['s-waiting-draft', 's-waiting-talk', 's-analysing', 's-sent', 's-old']);
    expect(out.all.items.find((r) => r.id === 's-sent')).toMatchObject({ teacherName: 'Ayesha Bibi', schoolName: 'IMSG I-10/1', score: 61, step: 'sent' });
  });

  test('a portal-started observation opens in the portal; a WhatsApp one does not', async () => {
    const out = await SVC.getCoachReports(fakeQuery(), ME, {});
    expect(out.waiting.find((r) => r.id === 's-waiting-draft').portal).toBe(true);
    expect(out.waiting.find((r) => r.id === 's-waiting-talk').portal).toBe(false);
  });

  test('search by teacher name or phone', async () => {
    expect((await SVC.getCoachReports(fakeQuery(), ME, { q: 'mehwish' })).all.items.map((r) => r.id)).toEqual(['s-waiting-draft']);
    expect((await SVC.getCoachReports(fakeQuery(), ME, { q: '0300 1110001' })).all.total).toBe(4);
  });

  test('pages of a fixed size', async () => {
    const out = await SVC.getCoachReports(fakeQuery(), ME, { page: 2, pageSize: 2 });
    expect(out.all).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    expect(out.all.items.map((r) => r.id)).toEqual(['s-analysing', 's-sent']);
  });

  test('the portal-session rule is the bot\'s own (kept in step)', () => {
    const botSrc = require('fs').readFileSync(require.resolve('../../bot/shared/services/coaching/portal-coaching.service.js'), 'utf8');
    const m = /const PORTAL_KEY_RX = (\/.*\/);/.exec(botSrc);
    expect(String(SVC.PORTAL_KEY_RX)).toBe(m[1]);
  });
});

describe('date helpers', () => {
  test('a week runs Monday to Sunday', () => {
    expect(SVC.weekBounds('2026-10-06')).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(SVC.weekBounds('2026-10-11')).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(SVC.weekBounds('2026-10-05')).toEqual({ from: '2026-10-05', to: '2026-10-11' });
  });

  test('a month is the calendar month', () => {
    expect(SVC.monthBounds('2026-10-06')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(SVC.monthBounds('2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});

describe('dates come back as text, never as a JS Date', () => {
  // node-pg turns a DATE into a Date at LOCAL midnight; toISOString() then moves
  // it a day back on any server east of UTC (found live: two 2026-10-05 visits
  // counted on 2026-10-04 on a PKT machine, so the week strip read 0).
  test.each(['MY_SCHEDULES', 'SCHEDULE_BY_ID'])('%s returns scheduled_for as text', (key) => {
    expect(SVC.SQL[key]).toMatch(/scheduled_for::text AS scheduled_for/);
  });

  test('TEAM_DAYS returns the day as text', () => {
    expect(SVC.SQL.TEAM_DAYS).toMatch(/scheduled_for::text AS day/);
  });
});

describe('Class R — no bare analysis_data: only the slices the numbers need', () => {
  // analysis_data is the big per-session JSONB (the 24/25-Aug NIETE wedge was
  // full analysis_data pulls). Scores come from analysis_data->'scores' and a
  // report's name from ->'teacher_delivery'; nothing else is read.
  test.each(['TEACHER_FACTS', 'COACH_SESSIONS', 'TEACHER_HISTORY'])('%s selects slices only', (key) => {
    const sql = SVC.SQL[key];
    expect(sql).toMatch(/analysis_data->'scores'/);
    const bare = sql.replace(/analysis_data->'[a-z_]+'/g, '').replace(/AS analysis_data/g, '');
    expect(bare).not.toMatch(/analysis_data/);
  });
});
