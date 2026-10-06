'use strict';
/**
 * The school leaderboard (web-quiz-schools.js): the weekly school points stat,
 * pure, then the board as the page reads it — loaded through the in-memory
 * Supabase (the network boundary), every first-party module running for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const express = require('express');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logEvent } = require('../../../shared/utils/structured-logger');
const S = require('../../../shared/services/quiz/web-quiz-schools');

// Wed 7 Oct 2026 10:00 PKT = 05:00Z. The week began Mon 5 Oct 00:00 PKT = Sun 4 Oct 19:00Z.
const NOW = Date.parse('2026-10-07T05:00:00Z');
const MON = '2026-10-04T19:00:00.000Z';
const TODAY = '2026-10-06T19:00:00.000Z';

describe('the stat (pure)', () => {
  test('the week starts Monday 00:00 in Pakistan, whatever the UTC day', () => {
    expect(S.weekStartIso(NOW)).toBe(MON);
    // Sunday 23:30 PKT is still last week; Monday 00:10 PKT is the new one.
    expect(S.weekStartIso(Date.parse('2026-10-04T18:30:00Z'))).toBe('2026-09-27T19:00:00.000Z');
    expect(S.weekStartIso(Date.parse('2026-10-04T19:10:00Z'))).toBe(MON);
  });

  test('a play is worth 10 for taking part plus a tenth of its score', () => {
    expect(S.pointsFor(0)).toBe(10);
    expect(S.pointsFor(100)).toBe(20);
    expect(S.pointsFor(84)).toBe(18);
    expect(S.pointsFor(null)).toBe(10);
    expect(S.pointsFor(250)).toBe(20);
  });

  const schools = [
    { id: 'A', name: 'School Alpha', region: 'Sector One', is_active: true, is_probable_test: false },
    { id: 'B', name: 'School Bravo', region: 'Sector Two', is_active: true, is_probable_test: false },
    { id: 'C', name: 'School Charlie', region: 'Sector One', is_active: true, is_probable_test: false },
    { id: 'D', name: 'School Delta', region: null, is_active: true, is_probable_test: false },
    { id: 'T', name: 'Test School', region: null, is_active: true, is_probable_test: true },
    { id: 'X', name: 'Closed School', region: null, is_active: false, is_probable_test: false },
  ];
  const p = (schoolId, kid, codeId, pct, at) => ({ schoolId, kid, codeId, pct, at });

  test('participation leads: three kids at 50% beat one kid at 100%; only a first finish per kid per quiz counts', () => {
    const plays = [
      p('A', 'k1', 'c1', 100, '2026-10-05T05:00:00Z'),
      p('A', 'k1', 'c1', 100, '2026-10-05T06:00:00Z'), // a practice re-attempt: nothing
      p('B', 'k2', 'c2', 50, '2026-10-05T05:00:00Z'),
      p('B', 'k3', 'c2', 50, '2026-10-05T05:00:00Z'),
      p('B', 'k4', 'c2', 50, '2026-10-05T05:00:00Z'),
      p('B', 'k2', 'c3', 0, '2026-10-05T07:00:00Z'), // the same kid, another quiz: counts
    ];
    const out = S.scoreSchools({ plays, schools, mySchoolId: 'A', splitAt: TODAY });
    expect(out.rows.map((r) => [r.place, r.name, r.points, r.kids])).toEqual([
      [1, 'School Bravo', 55, 3],
      [2, 'School Alpha', 20, 1],
    ]);
    expect(out.rows[1].mine).toBe(true);
    expect(out.rows[0].mine).toBeUndefined();
    expect(out.mine).toEqual(expect.objectContaining({ place: 2, name: 'School Alpha', points: 20, kids: 1 }));
    expect(out.zero_n).toBe(2); // Charlie, Delta; the test and closed schools are not on the board
    expect(out.ranked_n).toBe(2);
  });

  test('ties: more kids, then a higher average, then the name; equal points and kids share a place', () => {
    const plays = [
      p('A', 'a1', 'c', 100, MON), // A: 20 points, 1 kid
      p('B', 'b1', 'c', 0, MON), p('B', 'b2', 'c', 0, MON), // B: 20 points, 2 kids -> above A
      p('C', 'c1', 'c', 100, MON), // C: 20 points, 1 kid, same average as A -> shares A's place
    ];
    const out = S.scoreSchools({ plays, schools, mySchoolId: null, splitAt: TODAY });
    expect(out.rows.map((r) => [r.place, r.name])).toEqual([[1, 'School Bravo'], [2, 'School Alpha'], [2, 'School Charlie']]);
    expect(out.mine).toBeNull();
  });

  test('my school with nothing yet: a ghost, never a bottom rank', () => {
    const out = S.scoreSchools({ plays: [p('A', 'k', 'c', 80, MON)], schools, mySchoolId: 'D', splitAt: TODAY });
    expect(out.rows).toHaveLength(1);
    expect(out.mine).toEqual({ place: null, name: 'School Delta', sector: null, points: 0, kids: 0, move: null, ghost: true });
  });

  test('a test school is seen only by itself: ranked in its own view, never in anyone else\'s; a closed school never', () => {
    const plays = [p('T', 'k', 'c', 80, MON), p('X', 'k2', 'c', 80, MON), p('A', 'k3', 'c', 100, MON)];
    const other = S.scoreSchools({ plays, schools, mySchoolId: 'A', splitAt: TODAY });
    expect(other.rows.map((r) => r.name)).toEqual(['School Alpha']);
    expect(other.zero_names).not.toContain('Test School');
    const own = S.scoreSchools({ plays, schools, mySchoolId: 'T', splitAt: TODAY });
    expect(own.rows.map((r) => [r.place, r.name, !!r.mine])).toEqual([[1, 'School Alpha', false], [2, 'Test School', true]]);
    expect(own.mine).toEqual(expect.objectContaining({ place: 2, points: 18 }));
    expect(own.zero_n).toBe(3); // Bravo, Charlie, Delta: the test school is counted only as itself
    const ownEmpty = S.scoreSchools({ plays: [], schools, mySchoolId: 'T', splitAt: TODAY });
    expect(ownEmpty.mine).toEqual(expect.objectContaining({ ghost: true, name: 'Test School' }));
    const closed = S.scoreSchools({ plays, schools, mySchoolId: 'X', splitAt: TODAY });
    expect(closed.mine).toBeNull();
    expect(closed.rows.map((r) => r.name)).toEqual(['School Alpha']);
  });

  test('rank movement against the end of yesterday: up, down, new; none on the first day of the week', () => {
    const plays = [
      p('A', 'a1', 'c', 100, '2026-10-05T05:00:00Z'), p('A', 'a2', 'c', 100, '2026-10-05T05:00:00Z'),
      p('B', 'b1', 'c', 100, '2026-10-05T05:00:00Z'),
      // today B gets two more kids and passes A; C appears.
      p('B', 'b2', 'c', 100, '2026-10-07T03:00:00Z'), p('B', 'b3', 'c', 100, '2026-10-07T03:00:00Z'),
      p('C', 'c1', 'c', 50, '2026-10-07T03:00:00Z'),
    ];
    const out = S.scoreSchools({ plays, schools, mySchoolId: null, splitAt: TODAY });
    expect(out.rows.map((r) => [r.name, r.move])).toEqual([['School Bravo', 1], ['School Alpha', -1], ['School Charlie', 'new']]);
    const monday = S.scoreSchools({ plays, schools, mySchoolId: null, splitAt: MON });
    expect(monday.rows.every((r) => r.move === null)).toBe(true);
  });

  test("the share crop: my school and up to 3 schools either side; a ghost gets the top 3 and itself", () => {
    const row = (place, name, mine) => ({ place, name, points: 100 - place, kids: 1, move: null, ...(mine ? { mine: true } : {}) });
    const rows = Array.from({ length: 10 }, (_, i) => row(i + 1, `S${i + 1}`, i === 5));
    const mid = S.neighbours({ rows, mine: { place: 6, name: 'S6' } }, 3);
    expect(mid.rows.map((r) => r.name)).toEqual(['S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9']);
    const top = S.neighbours({ rows: rows.map((r) => ({ ...r, mine: r.place === 1 || undefined })), mine: { place: 1 } }, 3);
    expect(top.rows.map((r) => r.name)).toEqual(['S1', 'S2', 'S3', 'S4']);
    const ghost = { place: null, name: 'G', points: 0, kids: 0, ghost: true };
    const g = S.neighbours({ rows: rows.map(({ mine, ...r }) => r), mine: ghost }, 3);
    expect(g.rows.map((r) => r.name)).toEqual(['S1', 'S2', 'S3']);
    expect(g.mine).toBe(ghost);
    expect(S.neighbours({ rows: [], mine: null }, 3)).toEqual({ rows: [], mine: null });
  });

  test('a child counts at most 5 quizzes a Pakistan day; the 6th that day adds nothing, the next day counts again', () => {
    const plays = [];
    for (let q = 1; q <= 7; q += 1) plays.push(p('A', 'k1', `c${q}`, 100, `2026-10-05T0${q}:00:00Z`)); // Mon PKT, 7 quizzes
    plays.push(p('A', 'k1', 'c8', 100, '2026-10-05T20:00:00Z')); // Tue 01:00 PKT
    const out = S.scoreSchools({ plays, schools, mySchoolId: null, splitAt: TODAY });
    expect(out.rows[0].points).toBe(6 * 20);
  });

  test("a challenger's invited friends count at most 5 per quiz", () => {
    const plays = [];
    for (let f = 1; f <= 7; f += 1) plays.push({ ...p('A', `f${f}`, 'c1', 100, `2026-10-05T0${f}:00:00Z`), inviter: 'k1' });
    plays.push({ ...p('A', 'g1', 'c2', 100, '2026-10-05T09:00:00Z'), inviter: 'k1' }); // another quiz: its own 5
    const out = S.scoreSchools({ plays, schools, mySchoolId: null, splitAt: TODAY });
    expect(out.rows[0]).toEqual(expect.objectContaining({ points: 6 * 20, kids: 6 }));
  });

  test('one phone counts at most 3 children it created today per quiz per day; roster children and other phones are not capped', () => {
    const at = (h) => `2026-10-05T0${h}:00:00Z`;
    const plays = [];
    for (let k = 1; k <= 5; k += 1) plays.push({ ...p('A', `new${k}`, 'c1', 100, at(k)), device: 'phone1', minted: true });
    for (let k = 1; k <= 4; k += 1) plays.push({ ...p('A', `roster${k}`, 'c1', 100, at(k)), device: 'phone1', minted: false });
    plays.push({ ...p('A', 'other1', 'c1', 100, at(6)), device: 'phone2', minted: true });
    plays.push({ ...p('A', 'next', 'c1', 100, '2026-10-05T20:00:00Z'), device: 'phone1', minted: true }); // Tue PKT
    const counted = S.countedPlays(plays);
    expect(counted.map((x) => x.kid).sort()).toEqual(['new1', 'new2', 'new3', 'next', 'other1', 'roster1', 'roster2', 'roster3', 'roster4'].sort());
    expect(counted.capped).toEqual([{ device: 'phone1', codeId: 'c1', day: '2026-10-05' }]);
  });

  test('the schools still to start are named, alphabetically, without numbers; mine is not among them', () => {
    const out = S.scoreSchools({ plays: [p('A', 'k', 'c', 80, MON)], schools, mySchoolId: 'D', splitAt: TODAY });
    expect(out.zero_names).toEqual(['School Bravo', 'School Charlie']);
  });

  test('500 schools: the board ranks every one with points and stays fast', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ id: `s${i}`, name: `School ${i}`, region: null, is_active: true, is_probable_test: false }));
    const plays = [];
    for (let i = 0; i < 500; i += 1) for (let k = 0; k <= i % 40; k += 1) plays.push(p(`s${i}`, `k${i}-${k}`, 'c', (i * 7) % 101, MON));
    const t0 = Date.now();
    const out = S.scoreSchools({ plays, schools: many, mySchoolId: 's499', splitAt: TODAY });
    expect(Date.now() - t0).toBeLessThan(2000); // catches a quadratic blow-up, not CPU contention
    expect(out.ranked_n).toBe(500);
    expect(out.rows).toHaveLength(500);
    expect(out.mine.name).toBe('School 499');
  });
});

describe('the board (loaded through Supabase)', () => {
  const T1 = '11111111-1111-4111-8111-111111111111';
  const T2 = '11111111-1111-4111-8111-222222222222';
  const T3 = '11111111-1111-4111-8111-333333333333';
  const future = new Date(NOW + 10 * 86400000).toISOString();
  let fake;
  const sess = (id, sc, kid, pct, at, extra = {}) => ({
    id, share_code_id: sc, student_id: kid, mastery_percentage: pct, completed_at: at, status: 'completed', user_id: null, ...extra,
  });
  beforeEach(() => {
    S._reset();
    process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'route-key';
    fake = makeFake({
      schools: [
        { id: 'SA', name: 'School Alpha', region: 'Sector One', is_active: true, is_probable_test: false },
        { id: 'SB', name: 'School Bravo', region: 'Sector Two', is_active: true, is_probable_test: false },
        { id: 'SC', name: 'School Charlie', region: null, is_active: true, is_probable_test: false },
      ],
      users: [{ id: T1, school_id: 'SA' }, { id: T2, school_id: 'SB' }, { id: T3, school_id: 'SC' }],
      quiz_share_codes: [
        { id: 'c1', code: 'ALPHA1', quiz_id: 'q', teacher_user_id: T1, language: 'en', active: true, expires_at: future },
        { id: 'c2', code: 'BRAVO1', quiz_id: 'q', teacher_user_id: T2, language: 'ur', active: true, expires_at: future },
        { id: 'c3', code: 'CHARL1', quiz_id: 'q', teacher_user_id: T3, language: 'en', active: true, expires_at: future },
        // a friend's challenge code: collapses to the teacher's code, counts for that school
        { id: 'c2f', code: 'BRAVOF', quiz_id: 'q', teacher_user_id: T2, language: 'ur', active: true, expires_at: future, parent_share_code_id: 'c2', invited_by_student_id: 'kb1' },
      ],
      quiz_sessions: [
        sess('s1', 'c1', 'ka1', 100, '2026-10-05T05:00:00Z'),
        sess('s2', 'c2', 'kb1', 50, '2026-10-05T05:00:00Z'),
        sess('s3', 'c2', 'kb2', 50, '2026-10-05T05:00:00Z'),
        sess('s4', 'c2f', 'kf1', 80, '2026-10-05T06:00:00Z'), // the invited friend
        sess('s5', 'c1', null, 90, '2026-10-05T07:00:00Z', { user_id: T1 }), // teacher self-test: out
        sess('s6', 'c1', 'ka2', 90, '2026-09-30T07:00:00Z'), // last week: out
        sess('s7', 'c1', 'ka3', 90, '2026-10-05T07:00:00Z', { status: 'in_progress', completed_at: null }), // unfinished: out
      ],
    });
    Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  });

  test("the viewer's school comes from the quiz code; invited friends count; self-tests, last week and unfinished do not", async () => {
    const b = await S.board('alpha1', { now: NOW });
    expect(b.rows.map((r) => [r.place, r.name, r.sector, r.points, r.kids, !!r.mine])).toEqual([
      [1, 'School Bravo', 'Sector Two', 15 + 15 + 18, 3, false],
      [2, 'School Alpha', 'Sector One', 20, 1, true],
    ]);
    expect(b.mine).toEqual(expect.objectContaining({ place: 2, name: 'School Alpha' }));
    expect(b.zero_n).toBe(1);
    expect(b.week_start).toBe('2026-10-05');
    expect(JSON.stringify(b)).not.toMatch(/SA|SB|ka1|kb1|teacher/i); // no ids, no teacher on the wire
  });

  test("a test teacher's quizzes do not count", async () => {
    fake.db.users.find((u) => u.id === T2).is_test_user = true;
    const b = await S.board('ALPHA1', { now: NOW });
    expect(b.rows.map((r) => r.name)).toEqual(['School Alpha']);
  });

  test('with the session token: the points this finish added, also when it finished after the last load', async () => {
    process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'route-key';
    const T = require('../../../shared/services/quiz/web-quiz-token');
    await S.board('ALPHA1', { now: NOW }); // loads the minute's snapshot
    const kept = T.signSession({ sessionId: 's2', deviceRef: 'd', shareCodeId: 'c2' });
    expect((await S.board('BRAVO1', { now: NOW + 1000, st: kept })).added).toBe(15);
    fake.db.quiz_sessions.push(sess('s9', 'c1', 'ka9', 70, '2026-10-07T04:59:59Z'));
    const fresh = T.signSession({ sessionId: 's9', deviceRef: 'd', shareCodeId: 'c1' });
    expect((await S.board('ALPHA1', { now: NOW + 2000, st: fresh })).added).toBe(17);
    fake.db.quiz_sessions.push(sess('s10', 'c1', 'ka1', 100, '2026-10-07T05:00:00Z')); // ka1 already finished c1: practice
    const practice = T.signSession({ sessionId: 's10', deviceRef: 'd', shareCodeId: 'c1' });
    expect((await S.board('ALPHA1', { now: NOW + 3000, st: practice })).added).toBeUndefined();
    expect((await S.board('ALPHA1', { now: NOW + 3000, st: 'forged.token' })).added).toBeUndefined();
  });

  test("the child who just finished sees their own finish on the league at once, not a minute later", async () => {
    process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'route-key';
    const T = require('../../../shared/services/quiz/web-quiz-token');
    await S.board('CHARL1', { now: NOW }); // the minute's snapshot: Charlie has nothing
    fake.db.quiz_sessions.push(sess('s30', 'c3', 'kc30', 80, '2026-10-07T05:00:10Z'));
    const st = T.signSession({ sessionId: 's30', deviceRef: 'd', shareCodeId: 'c3' });
    const b = await S.board('CHARL1', { now: NOW + 20000, st });
    expect(b.added).toBe(18);
    expect(b.mine).toEqual(expect.objectContaining({ points: 18, kids: 1 }));
    expect(b.mine.ghost).toBeUndefined();
    expect(b.rows.find((r) => r.name === 'School Charlie')).toEqual(expect.objectContaining({ points: 18, mine: true }));
    // the finish refreshed the shared snapshot (one incremental read): the next viewer sees it too
    const other = await S.board('ALPHA1', { now: NOW + 21000 });
    expect(other.rows.find((r) => r.name === 'School Charlie')).toEqual(expect.objectContaining({ points: 18, kids: 1 }));
  });

  test("a capped friend is never told it added points, even when the friends finished inside one cache minute", async () => {
    process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'route-key';
    const T = require('../../../shared/services/quiz/web-quiz-token');
    await S.board('BRAVO1', { now: NOW }); // the minute's snapshot
    // six friends of kb1 on the challenge code, all after the snapshot (kf1 already counts from the fixture: 5 more fit? no: 4 more)
    for (let f = 2; f <= 6; f += 1) fake.db.quiz_sessions.push(sess(`fr${f}`, 'c2f', `kf${f}`, 100, `2026-10-07T05:00:0${f}Z`));
    const tok = (sid) => T.signSession({ sessionId: sid, deviceRef: 'd', shareCodeId: 'c2' });
    const fifth = await S.board('BRAVO1', { now: NOW + 10000, st: tok('fr5') });
    expect(fifth.added).toBe(20); // kf1 + kf2..kf5 = 5 friends
    const sixth = await S.board('BRAVO1', { now: NOW + 11000, st: tok('fr6') });
    expect(sixth.added).toBeUndefined();
    expect(sixth.rows.find((r) => r.name === 'School Bravo').kids).toBe(2 + 5);
  });

  test('a phone minting children: the 4th child it created today on this quiz adds nothing, and the cap is logged with ids only', async () => {
    fake.db.students = [];
    const today = '2026-10-07T04:00:00Z';
    for (let k = 1; k <= 4; k += 1) {
      fake.db.students.push({ id: `mint${k}`, list_id: null, created_at: today });
      fake.db.quiz_sessions.push(sess(`m${k}`, 'c3', `mint${k}`, 100, `2026-10-07T04:0${k}:00Z`, { device_ref: 'dev-farm' }));
    }
    fake.db.students.push({ id: 'kc-roster', list_id: 'list-1', created_at: '2026-09-01T00:00:00Z' });
    fake.db.quiz_sessions.push(sess('m5', 'c3', 'kc-roster', 100, '2026-10-07T04:05:00Z', { device_ref: 'dev-farm' }));
    const b = await S.board('CHARL1', { now: NOW });
    expect(b.mine).toEqual(expect.objectContaining({ kids: 4, points: 80 })); // 3 minted + 1 roster child
    expect(logEvent).toHaveBeenCalledWith('web_quiz.league_provisional_capped', { code: 'c3', device: expect.stringMatching(/^[0-9a-f]{12}$/) });
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain('dev-farm');
  });

  test('a school with nothing yet sees its own ghost row', async () => {
    const b = await S.board('CHARL1', { now: NOW });
    expect(b.mine).toEqual(expect.objectContaining({ ghost: true, name: 'School Charlie', points: 0 }));
  });

  test('one load serves a minute of requests; the next minute reloads', async () => {
    await S.board('ALPHA1', { now: NOW });
    const n1 = fake.calls.filter((c) => c.table === 'quiz_sessions').length;
    await S.board('BRAVO1', { now: NOW + 30000 });
    expect(fake.calls.filter((c) => c.table === 'quiz_sessions').length).toBe(n1);
    await S.board('BRAVO1', { now: NOW + 61000 });
    expect(fake.calls.filter((c) => c.table === 'quiz_sessions').length).toBeGreaterThan(n1);
  });

  test('after the first load each minute reads only the finishes since the last one, and the schools every 10 minutes', async () => {
    const seen = [];
    const from = fake.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t === 'quiz_sessions') { const gte = b.gte; b.gte = (c, v) => { seen.push(v); return gte(c, v); }; }
      return b;
    };
    await S.board('ALPHA1', { now: NOW });
    expect(seen[0]).toBe(MON);
    fake.db.quiz_sessions.push(sess('s20', 'c3', 'kc20', 100, '2026-10-07T04:59:00Z'));
    fake.db.quiz_sessions.push(sess('s21', 'c3', 'kc21', 100, '2026-10-05T05:59:00Z')); // committed late, stamped before the cursor
    const schoolsCalls = () => fake.calls.filter((c) => c.table === 'schools').length;
    const before = schoolsCalls();
    const b = await S.board('ALPHA1', { now: NOW + 61000 });
    expect(seen[seen.length - 1]).toBe('2026-10-05T05:58:00.000Z'); // the last finish loaded, less a 2-minute overlap
    expect(b.rows.find((r) => r.name === 'School Charlie')).toEqual(expect.objectContaining({ points: 40, kids: 2 }));
    expect(b.rows.find((r) => r.name === 'School Bravo').points).toBe(48); // nothing counted twice
    expect(schoolsCalls()).toBe(before);
    await S.board('ALPHA1', { now: NOW + 11 * 60000 });
    expect(schoolsCalls()).toBe(before + 1);
    // a new week starts from Monday again
    await S.board('ALPHA1', { now: Date.parse('2026-10-12T05:00:00Z') });
    expect(seen[seen.length - 1]).toBe('2026-10-11T19:00:00.000Z');
  });

  test('more finished sessions than one page: every page is read', async () => {
    const rows = fake.db.quiz_sessions;
    for (let i = 0; i < 2300; i += 1) {
      const at = new Date(Date.parse('2026-10-05T08:00:00Z') + i * 1000).toISOString();
      rows.push(sess(`bulk${i}`, 'c3', `kc${i}`, 100, at));
    }
    const b = await S.board('ALPHA1', { now: NOW });
    expect(b.rows[0]).toEqual(expect.objectContaining({ name: 'School Charlie', kids: 2300, points: 2300 * 20 }));
  });

  test('with the web quiz off (no token secret): 503 web_quiz_off and not one database read', async () => {
    const saved = { own: process.env.WEB_QUIZ_TOKEN_SECRET, key: process.env.INTERNAL_API_KEY };
    delete process.env.WEB_QUIZ_TOKEN_SECRET;
    delete process.env.INTERNAL_API_KEY;
    const n = fake.calls.length;
    try {
      await expect(S.board('ALPHA1', { now: NOW })).rejects.toMatchObject({ status: 503, body: { error: 'web_quiz_off' } });
      expect(fake.calls.length).toBe(n);
    } finally {
      if (saved.own !== undefined) process.env.WEB_QUIZ_TOKEN_SECRET = saved.own;
      if (saved.key !== undefined) process.env.INTERNAL_API_KEY = saved.key;
    }
  });

  test('an unknown code is a 404 and a served board is logged with counts only', async () => {
    await expect(S.board('NOPE99', { now: NOW })).rejects.toMatchObject({ status: 404 });
    await S.board('ALPHA1', { now: NOW });
    expect(logEvent).toHaveBeenCalledWith('web_quiz.school_board_loaded', expect.objectContaining({ plays: 4, schools: 2 }));
  });
});

describe('GET /api/internal/wq/schools/:code', () => {
  let server; let base; let routeFake;
  beforeAll(async () => {
    process.env.INTERNAL_API_KEY = 'route-key';
    S._reset();
    const fake = makeFake({
      schools: [{ id: 'SA', name: 'School Alpha', region: null, is_active: true, is_probable_test: false }],
      users: [{ id: 't', school_id: 'SA' }],
      quiz_share_codes: [
        { id: 'sc', code: 'LIVE01', quiz_id: 'q', teacher_user_id: 't', language: 'en', active: true, expires_at: new Date(Date.now() + 864e5).toISOString() },
      ],
      quiz_sessions: [],
    });
    routeFake = fake;
    Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
    const app = express();
    app.use(express.json());
    app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  test('behind the key; answers the board; an unknown code is 404', async () => {
    expect((await fetch(`${base}/schools/LIVE01`)).status).toBe(401);
    const ok = await fetch(`${base}/schools/LIVE01`, { headers: { 'x-api-key': 'route-key' } });
    expect(ok.status).toBe(200);
    const b = await ok.json();
    expect(b.mine).toEqual(expect.objectContaining({ ghost: true, name: 'School Alpha' }));
    expect(b.rows).toEqual([]);
    expect((await fetch(`${base}/schools/NOPE99`, { headers: { 'x-api-key': 'route-key' } })).status).toBe(404);
    // the session token reaches the service: a finish that counted reports what it added
    const T = require('../../../shared/services/quiz/web-quiz-token');
    routeFake.db.quiz_sessions.push({ id: 'r1', share_code_id: 'sc', student_id: 'k1', mastery_percentage: 60, completed_at: new Date(Date.now() - 1000).toISOString(), status: 'completed', user_id: null });
    const st = T.signSession({ sessionId: 'r1', deviceRef: 'd', shareCodeId: 'sc' });
    const withSt = await fetch(`${base}/schools/LIVE01?st=${encodeURIComponent(st)}`, { headers: { 'x-api-key': 'route-key' } });
    expect(withSt.status).toBe(200);
    expect((await withSt.json()).added).toBe(16);
  });
});
