'use strict';
/**
 * bd-pni007 — an FDE (obs612) coach visit in the portal: every read that lists or opens a leader_observation carries
 * the FDE result (`obs612`, from observe/obs612/view.js portalSummary / shortResult) and never a FICO number for it.
 *
 *   GET /coach/reports            (coach-v2 getCoachReports)    a row: { label 'FDE v1', toolName, result }, score null
 *   GET /coach/observation/:id    (coach-v2 getCoachObservation) the FDE block, no score, no DC score
 *   GET /coach/session/:id        (coach-school-card getSession) the FDE block; no FICO overall, sections, practices,
 *                                                               plan steps
 *   GET /coaching-session/:id     (portal.routes, the teacher)   the FDE block; the FICO breakdown is never asked for
 *                                                               (the bot's adapter knows no obs612 id and answers 0%)
 * A FICO row is unchanged: obs612 null.
 */

const F = require('../fixtures/obs612-visits');

const FDE_ENUR = F.enur();
const FDE_MSCI = F.msci();
const FDE_GEN = F.gen();
const FICO = { framework: 'fico', scores: { overall_percentage: 64, overall_marks: 27, overall_max_marks: 42 } };

// ── coach-v2: the Reports list and the observation page ─────────────────────────────────────────────────────────

describe('coach-v2 (GET /coach/reports, GET /coach/observation/:id)', () => {
  const SVC = require('../../dashboard/services/coach-v2.service');
  const { PATCH_TEACHERS_SQL } = require('../../dashboard/services/leader-patch.service');
  const ME = 'coach-me';
  const PATCH = [{
    teacher_ext_id: '923001110001', name: 'Ayesha Bibi', phone: '923001110001', school_ext_id: 'niete:110', role: 'teacher',
    rumi_user_id: 'u-ayesha', coaching_sessions: 7, observations: 3, training_modules: 4, school_name: 'IMSG I-10/1',
  }];
  // What COACH_SESSIONS hands back: analysis_data rebuilt from its slices.
  const listRow = (id, analysis, over = {}) => ({
    id, user_id: 'u-ayesha', created_at: '2026-11-11T09:31:00Z', status: 'observer_review_complete', debrief_status: 'done',
    audio_url: null, teacher_name: 'Ayesha Bibi', teacher_phone: '923001110001', sched_teacher_name: null,
    sched_school_name: 'IMSG I-10/1', sched_school_ext_id: 'niete:110', sched_teacher_ext_id: '923001110001',
    analysis_data: {
      scores: analysis.scores || null,
      teacher_delivery: { status: 'sent' },
      obs612: analysis.obs612 ? { rubric_id: analysis.obs612.rubric_id, result: analysis.obs612.result } : null,
    },
    ...over,
  });
  const LIST = [
    listRow('fde-enur', FDE_ENUR),
    listRow('fde-msci', FDE_MSCI),
    listRow('fde-gen', FDE_GEN, { debrief_status: 'pending' }),
    listRow('fico-1', FICO),
  ];
  // What OBSERVATION_BY_ID hands back: the obs612 block and the framework as their own columns.
  const obsRow = (id, analysis) => ({
    id, created_at: '2026-11-11T09:31:00Z', status: 'observer_review_complete', debrief_status: 'pending',
    observation_type: 'leader_observation', user_id: 'u-ayesha', observer_user_id: ME, audio_url: null,
    scores: analysis.scores || null, summary: null, delivery: {},
    framework: analysis.framework || null, obs612: analysis.obs612 || null,
  });
  const BY_ID = { 'fde-enur': obsRow('fde-enur', FDE_ENUR), 'fde-msci': obsRow('fde-msci', FDE_MSCI), 'fico-1': obsRow('fico-1', FICO) };

  const fakeQuery = () => async (sql, params) => {
    const S = SVC.SQL;
    if (sql === PATCH_TEACHERS_SQL) return { rows: PATCH };
    if (sql === S.COACH_SESSIONS) return { rows: LIST };
    if (sql === S.OBSERVATION_BY_ID) return { rows: BY_ID[params[0]] ? [BY_ID[params[0]]] : [] };
    if (sql === S.USER_NAME) return { rows: [{ name: 'Hataf Atif' }] };
    return { rows: [] };
  };

  test('COACH_SESSIONS and OBSERVATION_BY_ID read the obs612 block as a slice, never analysis_data whole', () => {
    expect(SVC.SQL.COACH_SESSIONS).toMatch(/analysis_data->'obs612'/);
    expect(SVC.SQL.OBSERVATION_BY_ID).toMatch(/analysis_data->'obs612'/);
    for (const name of ['COACH_SESSIONS', 'OBSERVATION_BY_ID']) {
      expect([name, /analysis_data(?!\s*->)/.test(SVC.SQL[name].replace(/AS analysis_data/g, ''))]).toEqual([name, false]);
    }
  });

  test('a Reports row of an FDE visit carries the tool, its result and the label; no FICO score', async () => {
    const out = await SVC.getCoachReports(fakeQuery(), ME, {});
    const byId = Object.fromEntries(out.all.items.map((r) => [r.id, r]));
    expect(byId['fde-enur']).toMatchObject({ score: null, obs612: { label: 'FDE v1', toolName: 'English & Urdu tool', result: '73.6% · Proficient' } });
    expect(byId['fde-msci'].obs612).toEqual({ label: 'FDE v1', toolName: 'Maths & Science tool', result: '11 levels' });
    expect(byId['fde-gen'].obs612).toEqual({ label: 'FDE v1', toolName: 'General form', result: '29/35 Yes' });
    expect(byId['fde-gen'].score).toBeNull();
    // A FICO row is unchanged.
    expect(byId['fico-1']).toMatchObject({ score: 64, obs612: null });
  });

  test('the observation page of an FDE visit: the FDE block, no score and no DC score', async () => {
    const out = await SVC.getCoachObservation(fakeQuery(), ME, 'fde-enur', { today: '2026-11-11' });
    expect(out).toMatchObject({ score: null, dcScore: null });
    expect(out.obs612).toMatchObject({
      label: 'FDE v1', tool: 'enur', toolName: 'English & Urdu tool', result: '73.6% · Proficient',
      headline: '109 / 148 · 79.5 / 108 · Proficient',
    });
    expect(out.obs612.rows.find((r) => r.name === 'D. Interest & Motivation')).toMatchObject({ value: '8/8', pct: 100 });
    expect(out.obs612.feedback.map((f) => f.label)).toEqual(['Strengths', 'Areas for Improvement', 'Recommendations', 'Timeline']);
    const m = await SVC.getCoachObservation(fakeQuery(), ME, 'fde-msci', { today: '2026-11-11' });
    expect(m.obs612).toMatchObject({ tool: 'msci', noTotal: true, headline: 'FDE gives no total for this tool.' });
    expect(m.obs612.rows[0]).toMatchObject({ name: '1 · Written work checked', value: 'Level 2', pct: null });
  });

  test('a FICO observation page is unchanged: obs612 null', async () => {
    const out = await SVC.getCoachObservation(fakeQuery(), ME, 'fico-1', { today: '2026-11-11' });
    expect(out).toMatchObject({ score: 64, dcScore: 64, obs612: null });
  });
});

// ── coach-school-card: one report as the coach sees it ─────────────────────────────────────────────────────────

describe('coach-school-card getSession (GET /coach/session/:id)', () => {
  const Card = require('../../dashboard/services/coach-school-card.service');
  const SID = '11111111-2222-4333-8444-555555555555';
  const row = (analysis) => ({
    id: SID, user_id: 'u-ayesha', created_at: '2026-11-11T09:31:00Z', status: 'observer_review_complete',
    observation_type: 'leader_observation', duplicate_of_session_id: null, analysis_data: analysis,
    prioritized_action: null, conversation_state: null, observer_user_id: 'coach-1', observer_name: 'Sana Malik', observer_test: false,
  });
  const db = (analysis) => async (sql) => {
    if (/\/\* sc:session \*\//.test(sql)) return { rows: [row(analysis)] };
    if (/\/\* sc:teacher-by-id \*\//.test(sql)) {
      return { rows: [{ id: 'u-ayesha', phone_number: '923001110001', name: 'Ayesha Bibi', role: 'teacher', school_id: 's1', preferred_language: 'en', teacher_level: null, school_name: 'IMSG I-10/1', emis: '110' }] };
    }
    throw new Error(`unexpected read: ${String(sql).slice(0, 60)}`);
  };

  test('an FDE visit: the FDE block, and no FICO overall, sections, practices or plan steps', async () => {
    const out = await Card.getSession(db(FDE_GEN), 'coach-1', SID, {});
    expect(out.obs612).toMatchObject({ label: 'FDE v1', tool: 'gen', result: '29/35 Yes', headline: 'Yes on 29 of 35' });
    expect(out.obs612.rows.find((r) => r.name === 'STUDENT ASSESSMENT PROCESS')).toMatchObject({ value: '0 of 2 Yes', pct: 0 });
    expect(out.obs612.feedback).toEqual([{ label: 'Feedback', text: 'A good start: add pair work, and check answers at the end.' }]);
    expect(out).toMatchObject({ overall: null, sections: [], practices: [], lpSteps: null });
  });

  test('a FICO visit carries obs612 null', async () => {
    const out = await Card.getSession(db({ ...FICO, domains: {} }), 'coach-1', SID, {});
    expect(out.obs612).toBeNull();
  });
});

// ── portal.routes: the teacher opens the report her coach sent ─────────────────────────────────────────────────

describe('GET /coaching-session/:id (the teacher)', () => {
  let tableRows;
  let breakdown;

  function makeChain(table) {
    const tests = [];
    const run = () => (tableRows[table] || []).filter((r) => tests.every((t) => t(r))).map((r) => ({ ...r }));
    const chain = {
      select: () => chain,
      eq: (c, v) => { tests.push((r) => r[c] === v); return chain; },
      in: (c, vs) => { tests.push((r) => vs.includes(r[c])); return chain; },
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: run()[0] || null, error: null }),
      single: async () => { const r = run()[0] || null; return { data: r, error: r ? null : { code: 'PGRST116', message: 'no rows' } }; },
      then: (res, rej) => Promise.resolve({ data: run(), error: null }).then(res, rej),
    };
    return chain;
  }

  async function open(id) {
    const routes = require('../../dashboard/routes/portal.routes');
    const layer = routes.stack.find((l) => l.route && l.route.path === '/coaching-session/:id' && l.route.methods.get);
    const stack = layer.route.stack.map((s) => s.handle);
    const req = { session: { portalUserId: F.TEACHER_ID, id: 's' }, params: { id }, body: {}, query: {}, method: 'GET', headers: {}, get: () => undefined };
    let statusCode = 200;
    let payload = null;
    const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
    for (const handler of stack) {
      let next = false;
      // eslint-disable-next-line no-await-in-loop
      await handler(req, res, () => { next = true; });
      if (!next) break;
    }
    return { statusCode, payload };
  }

  const SENT = { status: 'sent', sent_at: '2026-11-11T10:00:00Z', report_key: 'observe-reports/sess-fde-1.png', caption: 'Your FDE report' };

  beforeEach(() => {
    jest.resetModules();
    require('../fixtures/portal-auth-live').installLivePortalAccounts();
    process.env.R2_ENDPOINT = 'https://acct.r2.cloudflarestorage.com';
    process.env.R2_BUCKET_NAME = 'digital-coach-audio';
    breakdown = jest.fn().mockResolvedValue({ framework: null, overall: 0, marks: null, max: null, groups: [] });
    tableRows = {
      users: [{ id: F.COACH_ID, name: 'Sana Malik' }, { id: F.TEACHER_ID, name: 'Ayesha Bibi' }],
      coaching_sessions: [
        { ...F.sessionRow({ ...FDE_ENUR, teacher_delivery: SENT }), id: 'fde-1' },
        { ...F.sessionRow({ ...FICO, teacher_delivery: SENT }), id: 'fico-1' },
      ],
    };
    jest.doMock('../../dashboard/services/portal-coaching.client', () => ({}));
    jest.doMock('../../dashboard/config/supabase', () => ({ from: (t) => makeChain(t), rpc: jest.fn() }));
    jest.doMock('../../dashboard/services/r2.service', () => ({
      generatePresignedUrl: jest.fn(async (u) => `${u}?signed=1`),
      generatePresignedUrls: jest.fn().mockResolvedValue([]),
      isValidR2Url: jest.fn((u) => /r2\.cloudflarestorage\.com|r2\.example/.test(String(u || ''))),
    }));
    jest.doMock('../../dashboard/services/coaching-breakdown.service', () => ({ breakdown }));
    jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
    jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
    jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  });
  afterEach(() => jest.resetModules());

  test('an FDE visit: the FDE block and the report image; no FICO breakdown asked for, no score', async () => {
    const { statusCode, payload } = await open('fde-1');
    expect(statusCode).toBe(200);
    const s = payload.session;
    expect(s.obs612).toMatchObject({ label: 'FDE v1', tool: 'enur', headline: '109 / 148 · 79.5 / 108 · Proficient' }); // Section 7 on FDE's 108 scale (bd-ra8xu.50)
    expect(s.breakdown).toBeNull();
    expect(breakdown).not.toHaveBeenCalled();
    expect(s.percentage).toBeNull();
    expect(s.observation.reportImageUrl).toMatch(/sess-fde-1\.png/);
  });

  test('a FICO visit is unchanged: its breakdown is asked for, obs612 null', async () => {
    const { payload } = await open('fico-1');
    expect(payload.session.obs612).toBeNull();
    expect(breakdown).toHaveBeenCalledTimes(1);
  });
});
