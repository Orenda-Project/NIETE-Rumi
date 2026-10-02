/**
 * Child test draw — todaysList and markOutcome against an in-memory database (only the Supabase
 * client is replaced). The rules (PLAN §5): one seeded order per class per cycle, saved before any
 * name is shown; 4 new + 1 returning per visit (5 new while nobody is eligible to return); 2
 * alternates; an absent or refused child is coded and re-queued at their rank, absent_final after
 * two tries; no redraws; the same list every time a visit's list is reopened.
 */
const { createFakeSupabase, CHILD_TEST_UNIQUE } = require('./helpers/fake-supabase');
const { buildRoster } = require('./helpers/roster');

let mockFake;
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
const { logToFile } = require('../../../bot/shared/utils/logger');
const draw = require('../../../bot/shared/services/child-test/draw');
const { seedFor, seedDigest, shuffle, ALGO_VERSION } = require('../../../bot/shared/services/child-test/draw/shuffle');

const NOW = new Date('2026-10-05T06:00:00Z');
const days = (n) => new Date(NOW.getTime() + n * 86400000);

function setup(opts) {
  mockFake = createFakeSupabase(buildRoster(opts), { unique: CHILD_TEST_UNIQUE });
  return mockFake;
}
const T = () => mockFake.__tables;
const list = (visit, extra = {}) => draw.todaysList({ coachUserId: 'coach-1', schoolId: 'school-1', visitId: visit, observedGrade: 3, now: NOW, ...extra });
const ids = (kids) => kids.map((k) => k.studentId);

beforeEach(() => { process.env.CHILD_TEST_DRAW_SECRET = 'test-secret'; jest.clearAllMocks(); });
afterAll(() => { delete process.env.CHILD_TEST_DRAW_SECRET; });

describe('the first list of a visit', () => {
  test('5 new children and 2 alternates, Form A, from the observed grade; every rank saved first', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }, { id: 'g5a', grade: 5, section: 'A', size: 25 }] });
    const r = await list('visit-1');
    expect(r.ok).toBe(true);
    expect(r.cycleId).toBe('ICT-2026-Q4');
    expect(r.grade).toBe(3);
    expect(r.children).toHaveLength(5);
    expect(r.alternates).toHaveLength(2);
    for (const k of [...r.children, ...r.alternates]) {
      expect(k).toMatchObject({ role: 'new', form: 'A', classId: 'g3a' });
      expect(k.displayName).toMatch(/^Child 3A-\d\d$/);
      expect(typeof k.rollNumber).toBe('number');
    }
    const frame = T().child_test_draws.filter((d) => d.class_id === 'g3a');
    expect(frame).toHaveLength(25);
    expect(frame.map((d) => d.draw_rank).sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(new Set(frame.map((d) => d.frame_size))).toEqual(new Set([25]));
    expect(frame.every((d) => d.algo_version === ALGO_VERSION && /^[0-9a-f]{64}$/.test(d.seed_digest))).toBe(true);
    // Grade 5 is not drawn until a visit needs it.
    expect(T().child_test_draws.some((d) => d.class_id === 'g5a')).toBe(false);
    // The children listed are ranks 1-5, the alternates 6-7.
    const rankOf = (sid) => frame.find((d) => d.student_id === sid).draw_rank;
    expect(r.children.map((k) => rankOf(k.studentId)).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(r.alternates.map((k) => rankOf(k.studentId)).sort()).toEqual([6, 7]);
  });

  test('the ranks are the seeded shuffle of the class, replayable from the secret', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }] });
    await list('visit-1');
    const frame = T().child_test_draws.filter((d) => d.class_id === 'g3a').sort((a, b) => a.draw_rank - b.draw_rank);
    const canonical = T().class_enrollments.map((e) => e.student_id).sort();
    const seed = seedFor('test-secret', 'ICT-2026-Q4', 'g3a');
    expect(frame.map((d) => d.student_id)).toEqual(shuffle(canonical, seed));
    expect(frame[0].seed_digest).toBe(seedDigest(seed));
  });

  test('the same school drawn twice from scratch gives the same children', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }] });
    const a = await list('visit-1');
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }] });
    const b = await list('visit-1');
    expect(ids(b.children)).toEqual(ids(a.children));
    expect(ids(b.alternates)).toEqual(ids(a.alternates));
  });

  test('two sections: the list is spread across both', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }, { id: 'g3b', grade: 3, section: 'B', size: 25 }] });
    const r = await list('visit-1');
    const byClass = (c) => r.children.filter((k) => k.classId === c).length;
    expect(byClass('g3a')).toBeGreaterThanOrEqual(2);
    expect(byClass('g3b')).toBeGreaterThanOrEqual(2);
    expect(r.classIds.sort()).toEqual(['g3a', 'g3b']);
  });
});

describe('reopening: the same list, no redraw', () => {
  test('a second call for the visit returns the same children and writes no new frame', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }] });
    const a = await list('visit-1');
    const inserts = mockFake.__calls.filter((c) => c.action === 'insert').length;
    const b = await list('visit-1');
    expect(b.reused).toBe(true);
    expect(ids(b.children)).toEqual(ids(a.children));
    expect(ids(b.alternates)).toEqual(ids(a.alternates));
    expect(mockFake.__calls.filter((c) => c.action === 'insert').length).toBe(inserts);
  });
  test('even with another observed grade, the visit keeps its list', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }, { id: 'g5a', grade: 5, section: 'A', size: 25 }] });
    const a = await list('visit-1');
    const b = await list('visit-1', { observedGrade: 5 });
    expect(b.grade).toBe(3);
    expect(ids(b.children)).toEqual(ids(a.children));
  });
  test('the module offers no way to reshuffle, redraw or release a list', () => {
    expect(Object.keys(draw).sort()).toEqual(['cycleFor', 'markOutcome', 'resolveVisitSchool', 'todaysList']);
  });
});

describe('across visits in a cycle', () => {
  test('no child is tested twice as new: five visits, everyone present → 25 different children', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }] });
    const tested = [];
    for (let v = 1; v <= 5; v++) {
      const r = await list(`visit-${v}`);
      for (const k of r.children) {
        const m = await draw.markOutcome({ drawId: k.drawId, outcome: 'present', now: NOW });
        expect(m.ok).toBe(true);
        tested.push(k.studentId);
      }
    }
    expect(tested).toHaveLength(25);
    expect(new Set(tested).size).toBe(25);
    const sixth = await list('visit-6');
    expect(sixth).toMatchObject({ ok: false, reason: 'frame_exhausted', grade: 3 });
  });
  test('a child listed but never reached comes back first at the next visit', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }] });
    const a = await list('visit-1');
    await draw.markOutcome({ drawId: a.children[0].drawId, outcome: 'present', now: NOW });
    const b = await list('visit-2');
    expect(ids(b.children)).toEqual(expect.arrayContaining(ids(a.children).slice(1)));
    expect(ids(b.children)).not.toContain(a.children[0].studentId);
  });
  test('two visits drawing at once at the same school: one frame, and no child on both lists', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }] });
    const [a, b] = await Promise.all([list('visit-1'), list('visit-2')]);
    expect(a.ok && b.ok).toBe(true);
    expect(T().child_test_draws.filter((d) => d.sample_role === 'new')).toHaveLength(25);
    const all = [...ids(a.children), ...ids(a.alternates), ...ids(b.children), ...ids(b.alternates)];
    expect(new Set(all).size).toBe(all.length);
    expect(a.children).toHaveLength(5);
    expect(b.children).toHaveLength(5);
    // Reopened, each visit still has its own five.
    expect(ids((await list('visit-1')).children).sort()).toEqual(ids(a.children).sort());
  });
  test('a child who joins the class after the first draw is not in this cycle\'s frame', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 5 }] });
    await list('visit-1');
    T().students.push({ id: 'late', school_id: 'school-1', roll_number: 6, student_name: 'Child 3A-06', status: 'active', is_active: true, merged_into: null });
    T().class_enrollments.push({ id: 'late-e', class_id: 'g3a', student_id: 'late', roll_number: 6, is_active: true, left_on: null });
    await list('visit-2');
    expect(T().child_test_draws.some((d) => d.student_id === 'late')).toBe(false);
  });
  test('an inactive child is not in the frame', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 6 }] });
    T().students.find((s) => s.id === 'g3a-st03').is_active = false;
    await list('visit-1');
    expect(T().child_test_draws.map((d) => d.student_id)).not.toContain('g3a-st03');
    expect(T().child_test_draws).toHaveLength(5);
  });
  test('a child who has left the class since the draw is skipped, not listed', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }] });
    const a = await list('visit-1');
    for (const k of a.children.slice(1)) await draw.markOutcome({ drawId: k.drawId, outcome: 'present', now: NOW });
    const left = a.children[0].studentId;
    T().class_enrollments.find((e) => e.student_id === left).is_active = false;
    const b = await list('visit-2');
    expect(ids([...b.children, ...b.alternates])).not.toContain(left);
  });
});

describe('the returning child (4 new + 1 returning)', () => {
  async function testWholeFirstList(v = 'visit-1') {
    const r = await list(v);
    for (const k of r.children) await draw.markOutcome({ drawId: k.drawId, outcome: 'present', now: NOW });
    return r;
  }
  test('nobody tested 6 weeks ago yet → a fifth new child takes the slot', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }] });
    await testWholeFirstList();
    const r = await list('visit-2', { now: days(30) });
    expect(r.children).toHaveLength(5);
    expect(r.children.every((k) => k.role === 'new' && k.form === 'A')).toBe(true);
  });
  test('after 42 days: the earliest-tested child returns, reads Form B, and is marked', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }] });
    const first = await list('visit-1');
    const order = [];
    for (const [i, k] of first.children.entries()) {
      await draw.markOutcome({ drawId: k.drawId, outcome: 'present', now: new Date(NOW.getTime() + i * 60000) });
      order.push(k.studentId);
    }
    const r = await list('visit-2', { now: days(43) });
    const ret = r.children.filter((k) => k.role === 'returning');
    expect(ret).toHaveLength(1);
    expect(ret[0]).toMatchObject({ studentId: order[0], form: 'B' });
    expect(r.children.filter((k) => k.role === 'new')).toHaveLength(4);
    expect(r.alternates.every((k) => k.role === 'new')).toBe(true);
    const row = T().child_test_draws.find((d) => d.id === ret[0].drawId);
    expect(row).toMatchObject({ sample_role: 'returning', form: 'B', source_draw_id: first.children[0].drawId, cycle_id: 'ICT-2026-Q4' });
  });
  test('41 days is not enough', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }] });
    await testWholeFirstList();
    const r = await list('visit-2', { now: days(41) });
    expect(r.children.some((k) => k.role === 'returning')).toBe(false);
  });
  test('a child already retested this cycle does not return again; the next earliest does', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }] });
    const first = await list('visit-1');
    for (const [i, k] of first.children.entries()) await draw.markOutcome({ drawId: k.drawId, outcome: 'present', now: new Date(NOW.getTime() + i * 60000) });
    const v2 = await list('visit-2', { now: days(43) });
    const ret2 = v2.children.find((k) => k.role === 'returning');
    await draw.markOutcome({ drawId: ret2.drawId, outcome: 'present', now: days(43) });
    const v3 = await list('visit-3', { now: days(44) });
    const ret3 = v3.children.find((k) => k.role === 'returning');
    expect(ret3.studentId).not.toBe(ret2.studentId);
    expect(ret3.studentId).toBe(first.children[1].studentId);
  });
  test('next cycle: children tested last cycle are not drawn as new again', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 6 }] });
    const first = await testWholeFirstList();
    const q1 = new Date('2027-01-10T06:00:00Z');
    const r = await list('visit-2', { now: q1 });
    expect(r.cycleId).toBe('ICT-2027-Q1');
    const newIds = ids([...r.children, ...r.alternates].filter((k) => k.role === 'new'));
    for (const sid of ids(first.children)) expect(newIds).not.toContain(sid);
    expect(r.children.filter((k) => k.role === 'returning')).toHaveLength(1);
  });
});

describe('absent and refused children', () => {
  test('absent: the reason is saved, the first alternate moves up, alternates are topped up', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }] });
    const r = await list('visit-1');
    const gone = r.children[2];
    const m = await draw.markOutcome({ drawId: gone.drawId, outcome: 'absent', note: 'not in school today', now: NOW });
    expect(m.ok).toBe(true);
    const row = T().child_test_draws.find((d) => d.id === gone.drawId);
    expect(row).toMatchObject({ status: 'absent', attempts: 1, outcome_note: 'not in school today' });
    expect(row.outcome_at).toBeTruthy();
    const active = m.list.children.filter((k) => k.status === 'listed');
    expect(active).toHaveLength(5);
    expect(ids(active)).toContain(r.alternates[0].studentId);
    expect(m.list.children.find((k) => k.drawId === gone.drawId).status).toBe('absent');
    expect(m.list.alternates).toHaveLength(2);
    expect(ids(m.list.alternates)).toContain(r.alternates[1].studentId);
    // Reopening shows the same thing.
    const again = await list('visit-1');
    expect(ids(again.children).sort()).toEqual(ids(m.list.children).sort());
  });
  test('refused is coded the same way and keeps its own reason', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }] });
    const r = await list('visit-1');
    await draw.markOutcome({ drawId: r.children[0].drawId, outcome: 'refused', note: 'did not want to', now: NOW });
    expect(T().child_test_draws.find((d) => d.id === r.children[0].drawId)).toMatchObject({ status: 'refused', attempts: 1 });
  });
  test('an absent child is tried again at the next visit, then absent_final after the second try', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }] });
    const v1 = await list('visit-1');
    const kid = v1.children[0];
    await draw.markOutcome({ drawId: kid.drawId, outcome: 'absent', now: NOW });
    const v2 = await list('visit-2', { now: days(1) });
    expect(ids(v2.children)).toContain(kid.studentId);
    await draw.markOutcome({ drawId: kid.drawId, outcome: 'absent', now: days(1) });
    expect(T().child_test_draws.find((d) => d.id === kid.drawId)).toMatchObject({ status: 'absent_final', attempts: 2 });
    const v3 = await list('visit-3', { now: days(2) });
    expect(ids([...v3.children, ...v3.alternates])).not.toContain(kid.studentId);
    const hist = T().child_test_draws.find((d) => d.id === kid.drawId).history;
    expect(hist.filter((h) => h.event === 'outcome').map((h) => h.visit_id)).toEqual(['visit-1', 'visit-2']);
  });
  test('an alternate cannot be marked until promoted; an outcome is given once; an unknown outcome is refused', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }] });
    const r = await list('visit-1');
    expect(await draw.markOutcome({ drawId: r.alternates[0].drawId, outcome: 'present', now: NOW })).toMatchObject({ ok: false, reason: 'not_on_list' });
    expect((await draw.markOutcome({ drawId: r.children[0].drawId, outcome: 'present', now: NOW })).ok).toBe(true);
    expect(await draw.markOutcome({ drawId: r.children[0].drawId, outcome: 'absent', now: NOW })).toMatchObject({ ok: false, reason: 'already_marked' });
    expect(await draw.markOutcome({ drawId: r.children[1].drawId, outcome: 'skip', now: NOW })).toMatchObject({ ok: false, reason: 'bad_outcome' });
  });
  test('present marks the child tested with the time', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }] });
    const r = await list('visit-1');
    const m = await draw.markOutcome({ drawId: r.children[0].drawId, outcome: 'present', now: NOW });
    expect(T().child_test_draws.find((d) => d.id === r.children[0].drawId)).toMatchObject({ status: 'tested', tested_at: NOW.toISOString() });
    expect(m.list.children.find((k) => k.drawId === r.children[0].drawId).status).toBe('tested');
  });
});

describe('which grade', () => {
  const both = { classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }, { id: 'g5a', grade: 5, section: 'A', size: 25 }] };
  test('observed Grade 5 → Grade 5', async () => {
    setup(both);
    expect((await list('visit-1', { observedGrade: 5 })).grade).toBe(5);
  });
  test('the roster code grade_5 is accepted as well', async () => {
    setup(both);
    expect((await list('visit-1', { observedGrade: 'grade_5' })).grade).toBe(5);
  });
  test('observed another grade → Grade 3 and Grade 5 alternate by the school\'s visits this cycle', async () => {
    setup(both);
    const g = [];
    for (let v = 1; v <= 4; v++) g.push((await list(`visit-${v}`, { observedGrade: 4 })).grade);
    expect(g).toEqual([3, 5, 3, 5]);
  });
  test('observed grade has no class list → the other grade, flagged', async () => {
    setup({ classes: [{ id: 'g5a', grade: 5, section: 'A', size: 25 }] });
    const r = await list('visit-1', { observedGrade: 3 });
    expect(r).toMatchObject({ ok: true, grade: 5, gradeFallback: true });
  });
});

describe('small and missing class lists', () => {
  test('no Grade 3 or Grade 5 class with children → no_class_list', async () => {
    setup({ classes: [{ id: 'g4a', grade: 4, section: 'A', size: 25 }, { id: 'g3e', grade: 3, section: 'A', size: 0 }] });
    expect(await list('visit-1')).toMatchObject({ ok: false, reason: 'no_class_list' });
  });
  test('a class from last year or an inactive class does not count', async () => {
    setup({ classes: [{ id: 'old', grade: 3, section: 'A', size: 25, sessionCode: '2025-2026' }, { id: 'off', grade: 5, section: 'A', size: 25, isActive: false }] });
    expect(await list('visit-1')).toMatchObject({ ok: false, reason: 'no_class_list' });
  });
  test('a class of 3 is taken in full, with no alternates', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 3 }] });
    const r = await list('visit-1');
    expect(r.children).toHaveLength(3);
    expect(r.alternates).toHaveLength(0);
  });
  test('a class of 6: five listed, one alternate', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 6 }] });
    const r = await list('visit-1');
    expect(r.children).toHaveLength(5);
    expect(r.alternates).toHaveLength(1);
  });
});

describe('failing closed', () => {
  test('no secret → draw_secret_missing, logged at error, nothing written', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }] });
    delete process.env.CHILD_TEST_DRAW_SECRET;
    expect(await list('visit-1')).toMatchObject({ ok: false, reason: 'draw_secret_missing' });
    expect(T().child_test_draws).toHaveLength(0);
    expect(logToFile).toHaveBeenCalledWith(expect.stringMatching(/secret/i), expect.any(Object), 'error');
  });
  test('no visit id → refused (the visit is the idempotency key)', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }] });
    expect(await list(null)).toMatchObject({ ok: false, reason: 'missing_visit' });
  });
  test('a database error is reported and logged, never read as an empty roster', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }] });
    mockFake.__failNext({ message: 'connection reset' }, 'classes');
    const r = await list('visit-1');
    expect(r.ok).toBe(false);
    expect(r.reason).toBeUndefined();
    expect(r.error).toMatch(/connection reset/);
    expect(logToFile).toHaveBeenCalledWith(expect.stringMatching(/failed/), expect.any(Object), 'error');
  });
  test('no child name reaches a log line', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }] });
    const r = await list('visit-1');
    await draw.markOutcome({ drawId: r.children[0].drawId, outcome: 'absent', now: NOW });
    const logged = JSON.stringify(logToFile.mock.calls);
    expect(logged).not.toMatch(/Child 3A/);
  });
});

describe('resolveVisitSchool', () => {
  test('the visit\'s school_ext_id → the coach\'s leader_schools row', async () => {
    setup({ classes: [] });
    expect(await draw.resolveVisitSchool({ coachUserId: 'coach-1', visitId: 'visit-1' })).toEqual({ ok: true, schoolId: 'school-1' });
  });
  test('the observe2 form niete:<emis> with no leader_schools row → schools.emis', async () => {
    setup({ classes: [] });
    T().leader_schools.length = 0;
    T().schools[0].emis = '411';
    T().schools[0].source_school_id = null;
    T().observation_field_forms[0].visit_context = { school_ext_id: 'niete:411' };
    expect(await draw.resolveVisitSchool({ coachUserId: 'coach-1', visitId: 'visit-1' })).toEqual({ ok: true, schoolId: 'school-1' });
  });
  test('no leader_schools row → schools.source_school_id', async () => {
    setup({ classes: [] });
    T().leader_schools.length = 0;
    expect(await draw.resolveVisitSchool({ coachUserId: 'coach-1', visitId: 'visit-1' })).toEqual({ ok: true, schoolId: 'school-1' });
  });
  test('no school on the visit → no_school', async () => {
    setup({ classes: [] });
    T().observation_field_forms[0].visit_context = {};
    expect(await draw.resolveVisitSchool({ coachUserId: 'coach-1', visitId: 'visit-1' })).toMatchObject({ ok: false, reason: 'no_school' });
  });
});
