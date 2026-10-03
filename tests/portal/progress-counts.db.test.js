/**
 * bd-5rz1v.17 + bd-5rz1v.15 — the RULES behind each Home count, run as real SQL on a real
 * database, inside one transaction that is rolled back.
 *
 * The route tests mock the pool, so they can say the right SQL is SENT but not that it COUNTS the
 * right rows. This suite seeds one teacher's activity on either side of every rule and every
 * Pakistan-time boundary, runs the same service functions the routes run, and checks the numbers.
 *
 * It needs a database, so it runs only when NIETE_PROGRESS_DB_URL points at the SANDBOX project
 * (olvritwoqujtjvwfulbh) and the real `pg` is installed under dashboard/. Anywhere else — CI
 * included — it skips. It never commits: everything happens inside BEGIN … ROLLBACK.
 *
 *   NIETE_PROGRESS_DB_URL="$(grep ^DATABASE_URL= .env.sandbox | cut -d= -f2-)" \
 *     npm run test:raw -- tests/portal/progress-counts.db.test.js --forceExit
 *
 * The window for every count below is 1–3 October 2026, Pakistan time:
 *   from 2026-09-30T19:00:00Z  (00:00 on 1 Oct in Pakistan)
 *   to   2026-10-03T18:59:59Z  (23:59 on 3 Oct in Pakistan)
 */

const fs = require('fs');
const path = require('path');

const SANDBOX_REF = 'olvritwoqujtjvwfulbh';
const URL = process.env.NIETE_PROGRESS_DB_URL || '';
const PG_PATH = path.join(__dirname, '..', '..', 'dashboard', 'node_modules', 'pg');
const runnable = URL.includes(SANDBOX_REF) && fs.existsSync(PG_PATH);
const maybe = runnable ? describe : describe.skip;

const OCT = { key: 'custom', from: '2026-10-01', to: '2026-10-03', timezone: 'Asia/Karachi' };

maybe('Home counts against a real database (sandbox, rolled back)', () => {
  let client;
  let query;
  let Progress;
  let LpActivity;
  const ids = {};

  const one = async (sql, params) => (await query(sql, params)).rows[0];
  const phone = () => `9200${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

  beforeAll(async () => {
    jest.resetModules();
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const { Client } = require(PG_PATH);
    client = new Client({ connectionString: URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    await client.query('BEGIN');
    query = (sql, params) => client.query(sql, params);
    jest.doMock('../../dashboard/config/database', () => ({ query: (sql, params) => client.query(sql, params) }));
    Progress = require('../../dashboard/services/progress.service');
    LpActivity = require('../../dashboard/services/lp-activity.service');

    // ── people ──
    ids.teacher = (await one(`INSERT INTO users (phone_number, name, role, is_test_user) VALUES ($1, 'Progress Test Teacher', 'teacher', true) RETURNING id`, [phone()])).id;
    ids.coach = (await one(`INSERT INTO users (phone_number, name, role, is_test_user) VALUES ($1, 'Progress Test Coach', 'coach', true) RETURNING id`, [phone()])).id;
    ids.principal = (await one(`INSERT INTO users (phone_number, name, role, is_test_user) VALUES ($1, 'Progress Test Principal', 'principal', true) RETURNING id`, [phone()])).id;
    const T = ids.teacher;

    // ── coaching ──
    const scored = { scores: { overall_marks: 30, overall_max_marks: 42, overall_percentage: 71.4 }, topic: 'Leaves' };
    const sent = (status) => ({ ...scored, teacher_delivery: { status } });
    const cs = async (label, { at, status = 'completed', type = null, observer = null, analysis = scored }) => {
      ids[label] = (await one(
        `INSERT INTO coaching_sessions (user_id, status, observation_type, observer_user_id, analysis_data, created_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [T, status, type, observer, analysis === null ? null : JSON.stringify(analysis), at],
      )).id;
    };
    await cs('dcOct', { at: '2026-10-02T06:00:00Z' });
    await cs('dcMidnightIn', { at: '2026-09-30T19:30:00Z' }); // 00:30 on 1 Oct in Pakistan → IN
    await cs('dcMidnightOut', { at: '2026-09-30T18:30:00Z' }); // 23:30 on 30 Sep in Pakistan → OUT
    await cs('dcFailed', { at: '2026-10-02T06:00:00Z', status: 'failed' });
    await cs('dcNoAnalysis', { at: '2026-10-02T06:00:00Z', analysis: null });
    await cs('obsSent', { at: '2026-10-01T05:00:00Z', status: 'observer_review_complete', type: 'leader_observation', observer: ids.coach, analysis: sent('sent') });
    await cs('obsTapPending', { at: '2026-10-02T05:00:00Z', status: 'awaiting_observer_review', type: 'leader_observation', observer: ids.principal, analysis: sent('awaiting_teacher_tap') });
    await cs('obsDraft', { at: '2026-10-02T05:00:00Z', type: 'leader_observation', observer: ids.coach, analysis: sent('awaiting_confirm') });
    await cs('obsReview', { at: '2026-10-02T05:00:00Z', type: 'leader_observation', observer: ids.coach, analysis: sent('operator_review') });
    await cs('obsNoDelivery', { at: '2026-10-02T05:00:00Z', type: 'leader_observation', observer: ids.coach });

    // ── training ──
    const mods = (await query(`SELECT id FROM training_modules WHERE is_active ORDER BY id LIMIT 3`)).rows.map((r) => r.id);
    ids.modules = mods;
    await query(`UPDATE training_modules SET is_active = false WHERE id = $1`, [mods[2]]);
    await query(
      `INSERT INTO teacher_training_progress (user_id, module_id, completed_at) VALUES
         ($1, $2, '2026-10-02T06:00:00Z'), ($1, $3, '2026-09-15T06:00:00Z'), ($1, $4, '2026-10-02T06:00:00Z')`,
      [T, mods[0], mods[1], mods[2]],
    );

    // ── assessments ──
    const textbook = (await one(`SELECT id FROM textbooks LIMIT 1`)).id;
    const req = async (at) => (await one(
      `INSERT INTO assessment_requests (user_id, grade_code, subject_code, textbook_id, chapter_number, question_count, created_at)
       VALUES ($1, 'grade_4', 'science', $2, 3, 10, $3) RETURNING id`, [T, textbook, at],
    )).id;
    const paper = async (request, at, status, editedFrom = null) => (await one(
      `INSERT INTO assessment_papers (request_id, attempt, status, created_at, edited_from) VALUES ($1, 1, $2, $3, $4) RETURNING id`,
      [request, status, at, editedFrom],
    )).id;
    const r1 = await req('2026-10-02T06:00:00Z');
    ids.paperOct = await paper(r1, '2026-10-02T06:00:00Z', 'ready');
    await paper(r1, '2026-10-02T07:00:00Z', 'ready', ids.paperOct); // an EDIT of it — not a new paper
    const r2 = await req('2026-10-02T06:00:00Z');
    await paper(r2, '2026-10-02T06:00:00Z', 'failed');
    const r3 = await req('2026-09-20T06:00:00Z');
    await paper(r3, '2026-09-20T06:00:00Z', 'ready');

    // ── attendance (registers she MARKED) ──
    await query(
      `INSERT INTO attendance_sessions (user_id, session_date, total_students, present_count) VALUES
         ($1, '2026-10-01', 30, 28), ($1, '2026-10-01', 25, 25), ($1, '2026-10-02', 30, 27), ($1, '2026-09-30', 30, 30)`,
      [T],
    );

    // ── lesson plans ──
    const seg = (await one(`SELECT segment_id FROM niete_lp612_segments WHERE is_current LIMIT 1`)).segment_id;
    ids.segment = seg;
    await query(
      `INSERT INTO niete_lp_downloads (user_id, lesson_id, status, created_at) VALUES
         ($1, 'grade_4_science_ch2_seg1', 'sent',   '2026-10-01T05:00:00Z'),
         ($1, 'grade_4_science_ch2_seg1', 'sent',   '2026-10-02T05:00:00Z'),
         ($1, 'grade_4_science_ch2_seg2', 'failed', '2026-10-02T05:00:00Z'),
         ($1, 'grade_4_science_ch2_seg3', 'sent',   '2026-09-29T05:00:00Z')`,
      [T],
    );
    await query(
      `INSERT INTO niete_lp612_deliveries (user_id, segment_id, lang, template_version, delivered_at)
       VALUES ($1, $2, 'en', 'v-test', '2026-10-02T09:00:00Z')`,
      [T, seg],
    );
    // bd-5rz1v.21 — a PORTAL delivery (a ready 6-12 lesson she asked for in the portal: her claim on
    // the render). It is not a WhatsApp receipt, and an open is counted from niete_lp_opens when the
    // PDF actually goes out, so this row must change no count and no list below.
    const seg2 = (await one(`SELECT segment_id FROM niete_lp612_segments WHERE is_current AND segment_id <> $1 LIMIT 1`, [seg])).segment_id;
    await query(
      `INSERT INTO niete_lp612_deliveries (user_id, segment_id, lang, template_version, surface, delivered_at)
       VALUES ($1, $2, 'en', 'v-test', 'portal', '2026-10-02T10:00:00Z')`,
      [T, seg2],
    );
    await query(
      `INSERT INTO niete_lp_opens (user_id, plan_kind, plan_ref, lang, source, opened_at) VALUES
         ($1, 'k5', 'grade_4_science_ch2_seg1', NULL, 'viewer',   '2026-10-02T08:00:00Z'),
         ($1, 'k5', 'grade_4_math_ch1_seg4',    NULL, 'external', '2026-10-02T19:10:00Z'),
         ($1, 'k5', 'grade_4_math_ch1_seg5',    NULL, 'viewer',   '2026-09-30T18:50:00Z')`,
      [T],
    );
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end().catch(() => {});
    }
    jest.resetModules();
  });

  test('coaching: her own completed analysed sessions, plus observations SENT to her — split', async () => {
    const c = await Progress.progressCounts(query, ids.teacher, OCT);
    // dcOct + dcMidnightIn; never the 23:30-on-30-Sep one, a failed one, or one with no analysis.
    expect(c.coaching.digitalCoach).toBe(2);
    // sent + awaiting_teacher_tap (she sees it whatever its status); never a draft, a review copy
    // or one with no delivery.
    expect(c.coaching.observations).toBe(2);
    expect(c.coaching.total).toBe(4);
  });

  test('coaching list: the same rows the count counted, newest first', async () => {
    const out = await Progress.progressList(query, ids.teacher, 'coaching', OCT, {});
    expect(out.total).toBe(4);
    expect(out.items.map((i) => i.id).sort()).toEqual([ids.dcOct, ids.dcMidnightIn, ids.obsSent, ids.obsTapPending].sort());
    const byId = Object.fromEntries(out.items.map((i) => [i.id, i]));
    expect(byId[ids.obsSent]).toMatchObject({ kind: 'observation', observerRole: 'coach', observerName: 'Progress Test Coach', band: 'good' });
    expect(byId[ids.obsTapPending]).toMatchObject({ kind: 'observation', observerRole: 'principal' });
    expect(byId[ids.dcOct]).toMatchObject({ kind: 'digital_coach', observerRole: null, band: 'good' });
  });

  test('training: completions in the window, on modules that are still active', async () => {
    const c = await Progress.progressCounts(query, ids.teacher, OCT);
    expect(c.training.completed).toBe(1);
    const out = await Progress.progressList(query, ids.teacher, 'training', OCT, {});
    expect(out.items.map((i) => i.moduleId)).toEqual([String(ids.modules[0])]);
    expect(out.total).toBe(1);
  });

  test('assessments: generated papers that finished — an edit is a version, not a new paper', async () => {
    const c = await Progress.progressCounts(query, ids.teacher, OCT);
    expect(c.assessments.made).toBe(1);
    const out = await Progress.progressList(query, ids.teacher, 'assessments', OCT, {});
    expect(out.items.map((i) => i.paperId)).toEqual([ids.paperOct]);
  });

  test('attendance: the days she marked a register (two classes on one day is one day)', async () => {
    const c = await Progress.progressCounts(query, ids.teacher, OCT);
    expect(c.attendance).toEqual({ days: 2, registers: 3, unit: 'days' });
    const out = await Progress.progressList(query, ids.teacher, 'attendance', OCT, {});
    expect(out.items.map((i) => [i.date, i.registers])).toEqual([['2026-10-02', 1], ['2026-10-01', 2]]);
  });

  test('lesson plans: distinct plans opened in the portal OR received on WhatsApp, in Pakistan days', async () => {
    const c = await Progress.progressCounts(query, ids.teacher, OCT);
    // k5 seg1 (WhatsApp twice + portal once — one plan), k5 math seg4 (portal, 00:10 on 3 Oct in
    // Pakistan), g612 segment (WhatsApp). Not the failed send, the 29 Sep send, or the open at
    // 23:50 on 30 Sep.
    expect(c.lessonPlans).toEqual({ used: 3, opened: 2, received: 2, days: 3 });
  });

  test('lesson plans list: one row per plan, last use in the window, both sources dated', async () => {
    const describe = jest.fn(async (plans) => plans.map((p) => ({ ...p, found: true, title: p.ref })));
    const out = await Progress.progressList(query, ids.teacher, 'lesson-plans', OCT, { describe });
    expect(out.total).toBe(3);
    expect(out.items.map((i) => i.planKey)).toEqual([
      'k5:grade_4_math_ch1_seg4', `g612:${ids.segment}`, 'k5:grade_4_science_ch2_seg1',
    ]);
    const seg1 = out.items.find((i) => i.planKey === 'k5:grade_4_science_ch2_seg1');
    expect(new Date(seg1.lastOpenedAt).toISOString()).toBe('2026-10-02T08:00:00.000Z');
    expect(new Date(seg1.lastReceivedAt).toISOString()).toBe('2026-10-02T05:00:00.000Z');
    expect(new Date(seg1.lastUsedAt).toISOString()).toBe('2026-10-02T08:00:00.000Z');
    expect(out.items.find((i) => i.kind === 'g612')).toMatchObject({ segmentId: ids.segment, lang: 'en' });
  });

  test('recent: all time, so the 29 Sep send and the 30 Sep open are there too', async () => {
    const describe = jest.fn(async (plans) => plans.map((p) => ({ ...p, found: true, title: p.ref })));
    const plans = await LpActivity.recentPlans(query, ids.teacher, { limit: 10, describe });
    expect(plans.map((p) => p.planKey)).toEqual(expect.arrayContaining([
      'k5:grade_4_science_ch2_seg3', 'k5:grade_4_math_ch1_seg5',
    ]));
    expect(plans).toHaveLength(5);
  });

  test('de-dupe: the same plan within 5 minutes is stored once; another language or a later open is not', async () => {
    const T = ids.teacher;
    const seg = ids.segment;
    const count = async () => Number((await one(
      `SELECT count(*) AS n FROM niete_lp_opens WHERE user_id = $1 AND plan_ref = $2`, [T, seg],
    )).n);
    const open = (lang, source = 'viewer') => LpActivity.recordOpen(query, { userId: T, kind: 'g612', ref: seg, lang, source });

    expect(await open('en')).toEqual({ recorded: true });
    expect(await open('en', 'external')).toEqual({ recorded: false });
    expect(await count()).toBe(1);
    expect(await open('ur')).toEqual({ recorded: true });
    expect(await count()).toBe(2);

    // Six minutes later it is a new open.
    await query(`UPDATE niete_lp_opens SET opened_at = opened_at - interval '6 minutes' WHERE user_id = $1 AND plan_ref = $2`, [T, seg]);
    expect(await open('en')).toEqual({ recorded: true });
    expect(await count()).toBe(3);
  });

  test('an open for a user that does not exist fails inside the log, never outside it', async () => {
    // A failed statement poisons the transaction; the savepoint keeps the rest of the suite usable.
    await query('SAVEPOINT bad_user');
    const out = await LpActivity.logOpen(query, {
      userId: '00000000-0000-4000-8000-000000000000', kind: 'k5', ref: 'grade_1_english_ch1_seg1', source: 'viewer',
    });
    await query('ROLLBACK TO SAVEPOINT bad_user');
    expect(out).toEqual({ recorded: false, reason: 'error' });
  });
});
