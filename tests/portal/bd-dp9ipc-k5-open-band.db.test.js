/**
 * bd-dp9ipc — a grades 1-5 plan opened through the app's 6-12 routes is a grades 1-5 open.
 *
 * Live since 16 Nov 2026: a teacher's own or shelf grades 1-5 plan (Make my own) is polled and
 * downloaded through /lp612/status and /lp612/file, which recorded every open as plan_kind 'g612'
 * with the catalogue lesson id (bd-n2yvip). Her recent list then offered it as a 6-12 plan, and
 * tapping it asked the 6-12 catalogue for a grades 1-5 id: 404 "That lesson is not in the
 * catalogue" (122x, 16-22 Nov). The same mislabel sent the 6-12 survey and lost 121 answers on
 * lp_feedback_lp612_segment_id_fkey (fixed on the survey side by bd-h7nsmx).
 *
 * The rule, in one place (lp-activity.service): a 'g612' ref that niete_lp612_segments does not
 * know is a 'k5' plan — when the open is stored, and when an open already stored is read back.
 *
 * Real SQL on a real database inside BEGIN … ROLLBACK. Runs only when NIETE_TEST_DB_URL points at
 * the sandbox or staging project and `pg` is installed under dashboard/; skips anywhere else.
 */

const fs = require('fs');
const path = require('path');

const TEST_REFS = ['olvritwoqujtjvwfulbh', 'rpqkekcfvumypldbejhp']; // sandbox, staging — never prod
const URL = process.env.NIETE_TEST_DB_URL || '';
const PG_PATH = path.join(__dirname, '..', '..', 'dashboard', 'node_modules', 'pg');
const runnable = TEST_REFS.some((r) => URL.includes(r)) && fs.existsSync(PG_PATH);
const maybe = runnable ? describe : describe.skip;

const K5_ID = 'grade_3_urdu_ch12_seg4'; // one of the live 404s

maybe('bd-dp9ipc: grades 1-5 opens through the 6-12 routes (real database, rolled back)', () => {
  let client;
  let LpActivity;
  let teacher;
  let seg;
  const one = async (sql, params) => (await client.query(sql, params)).rows[0];
  const describeAll = async (plans) => plans.map((p) => ({ ...p, found: true, title: p.ref }));

  beforeAll(async () => {
    jest.resetModules();
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const { Client } = require(PG_PATH);
    client = new Client({ connectionString: URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    await client.query('BEGIN');
    LpActivity = require('../../dashboard/services/lp-activity.service');
    const phone = `9200${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    teacher = (await one(`INSERT INTO users (phone_number, name, role, is_test_user) VALUES ($1, 'dp9ipc Test Teacher', 'teacher', true) RETURNING id`, [phone])).id;
    seg = (await one('SELECT segment_id FROM niete_lp612_segments WHERE is_current LIMIT 1')).segment_id;
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK');
      await client.end();
    }
  });

  const query = (sql, params) => client.query(sql, params);
  const stored = (id) => one('SELECT plan_kind, plan_ref, lang FROM niete_lp_opens WHERE id = $1', [id]);

  test('a grades 1-5 lesson id recorded as g612 is stored as k5, with no document language', async () => {
    const out = await LpActivity.recordOpen(query, { userId: teacher, kind: 'g612', ref: K5_ID, lang: 'ur', source: 'viewer' });
    expect(out.recorded).toBe(true);
    expect(await stored(out.id)).toEqual({ plan_kind: 'k5', plan_ref: K5_ID, lang: null });
    expect(out.open.kind).toBe('k5'); // the survey continues from this
  });

  test('a real 6-12 segment stays g612', async () => {
    const out = await LpActivity.recordOpen(query, { userId: teacher, kind: 'g612', ref: seg, lang: 'en', source: 'viewer' });
    expect(out.recorded).toBe(true);
    expect(await stored(out.id)).toEqual({ plan_kind: 'g612', plan_ref: seg, lang: 'en' });
    expect(out.open.kind).toBe('g612');
  });

  test('an open already stored as g612 with a grades 1-5 id comes back as a k5 plan that opens as k5', async () => {
    const old = `grade_2_math_ch1_seg1`;
    await client.query(
      `INSERT INTO niete_lp_opens (user_id, plan_kind, plan_ref, lang, source, opened_at)
       VALUES ($1, 'g612', $2, 'en', 'viewer', now() - interval '1 day')`, [teacher, old],
    );
    const plans = await LpActivity.recentPlans(query, teacher, { limit: 10, describe: describeAll });
    const p = plans.find((x) => x.planKey.endsWith(old));
    expect(p).toBeDefined();
    expect(p.kind).toBe('k5');
    expect(p.open).toEqual({ lane: 'k5', lessonId: old });
    expect(plans.some((x) => x.open.lane === 'g612' && /^grade_[1-5]_/.test(x.open.segmentId))).toBe(false);
  });
});
