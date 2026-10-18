'use strict';
/**
 * bd-t7zk3t.12 — every reader of lesson-plan opens survives an FLN open, BEFORE anything writes one.
 *
 * When lesson-plan reading moved into the app on 12 Oct, a dozen features that read plan usage went
 * blind or broke in turn. Reading Hour + Numeracy (FLN) adds a third plan kind to niete_lp_opens
 * (`fln`, plan_ref = the taleemabad_core lesson id), so the readers land first (SPEC_v2 §5 ship order):
 *
 *   POST /api/internal/lp/describe   names `fln` plans from the sidecar index (fln-index.service) —
 *                                    before this, kind `fln` was a 400, and the portal turns that into
 *                                    a 502 on Recent, Home and "All lesson plans" for the teacher
 *   lp-activity namePlans            Recent / Home / Coaching recent: `open` = { lane: 'fln', planId }
 *   lp-history itemsOf               "All lesson plans": the same `open`
 *
 * k5 and g612 answers are pinned field for field (the parent commit's shapes), so nothing else moves.
 * Only the network is faked: the bot's Supabase (the version row) and fetch (the index).
 */

const KEY = 'shared-secret-key';
const VER = 'v1-20261018-abcd1234';
const INDEX = {
  version: VER,
  plans: {
    11156: { title: "Sounds of 'c/k, e, h, r, m, d' (Fluency)", subject: 'rh-en', level: 1, lang: 'en', minutes: 30, labels: ['c', 'e'], pos: 7, count: 48 },
    11133: { title: 'ایکو ریڈنگ', subject: 'rh-ur', level: 2, lang: 'ur', minutes: 35, labels: ['ب'], pos: 3, count: 58 },
    10230: { title: 'Place value to 999', subject: 13, level: 2, lang: 'en', minutes: 40, labels: [], pos: 24, count: 30 },
  },
};

let router;
let fetchCalls;
let fetchImpl;
let versionRow;

function findRoute(r, method, path) {
  for (const layer of r.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function describeViaRoute(plans) {
  const stack = findRoute(router, 'post', '/lp/describe');
  const req = { headers: { 'x-api-key': KEY }, body: { plans }, ip: '127.0.0.1', method: 'POST', path: '/lp/describe' };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  for (const handler of stack) {
    let advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (!advanced) resolve();
    });
    if (!advanced) break;
  }
  return { statusCode, payload };
}

beforeEach(() => {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = KEY;
  process.env.FLN_CORPUS_BASE = 'https://content.example/fln/corpus';
  delete process.env.FLN_CORPUS_VERSION;
  versionRow = { value: JSON.stringify(VER) };
  fetchCalls = [];
  fetchImpl = async (url) => {
    fetchCalls.push(url);
    return { ok: true, json: async () => INDEX };
  };
  global.fetch = jest.fn((...a) => fetchImpl(...a));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../bot/shared/storage/r2', () => ({
    buildR2PublicUrl: (k) => `https://r2.example/${k}`,
    getPresignedUrl: async (u) => `${u}?sig=1`,
  }));
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: jest.fn((table) => {
      const f = {};
      const chain = {
        select: () => chain,
        eq: (c, v) => { f[c] = v; return chain; },
        in: (c, v) => { f[c] = v; return chain; },
        maybeSingle: async () => ({
          data: table === 'app_settings' && f.key === 'fln_corpus_version' ? versionRow : null,
          error: null,
        }),
        then: (resolve, reject) => Promise.resolve({
          data: table === 'niete_lp612_segments' && (f.segment_id || []).includes('grade_9_physics.c02.p010')
            ? [{
              segment_id: 'grade_9_physics.c02.p010', grade: 9, subject: 'Physics', chapter_number: 2,
              chapter_title: 'Kinematics', subtopic_title: 'Speed and velocity', menu_title: 'Speed',
              printed_page_start: 10, printed_page_end: 12,
            }]
            : [],
          error: null,
        }).then(resolve, reject),
      };
      return chain;
    }),
  }));
  router = require('../../bot/shared/routes/internal-api.routes');
});

afterEach(() => {
  delete process.env.INTERNAL_API_KEY;
  delete process.env.FLN_CORPUS_BASE;
  delete global.fetch;
  jest.resetModules();
});

describe('describe — fln', () => {
  test('an FLN open is named from the sidecar index, never a 400', async () => {
    const { statusCode, payload } = await describeViaRoute([{ kind: 'fln', ref: '11156', lang: 'en' }]);
    expect(statusCode).toBe(200);
    expect(payload.plans).toEqual([expect.objectContaining({
      kind: 'fln', ref: '11156', lang: 'en', found: true,
      title: "Sounds of 'c/k, e, h, r, m, d' (Fluency)",
      grade: null, subject: 'Reading Hour · English', subjectKey: 'rh-en',
      chapterTitle: 'Level 1 · Grade 1', dayLabel: 'Lesson 7/48', level: 1, minutes: 30,
      open: { lane: 'fln', planId: '11156' },
    })]);
    expect(fetchCalls).toEqual([`https://content.example/fln/corpus/${VER}/index.json`]);
  });

  test('the asked language is echoed, so the portal can match the answer to its row', async () => {
    const { payload } = await describeViaRoute([{ kind: 'fln', ref: '11133', lang: 'ur' }]);
    expect(payload.plans[0]).toMatchObject({ lang: 'ur', found: true, subjectKey: 'rh-ur', subject: 'Reading Hour · Urdu', planLang: 'ur' });
  });

  test('a subject given as the taleemabad_core id is still named', async () => {
    const { payload } = await describeViaRoute([{ kind: 'fln', ref: '10230', lang: 'en' }]);
    expect(payload.plans[0]).toMatchObject({ subject: 'Numeracy', subjectKey: 'num', chapterTitle: 'Level 2 · Grades 2–3' });
  });

  test('a plan the index no longer serves is answered found:false, not dropped', async () => {
    const { payload } = await describeViaRoute([{ kind: 'fln', ref: '999', lang: 'en' }]);
    expect(payload.plans[0]).toMatchObject({ kind: 'fln', ref: '999', found: false });
  });

  test('no index (fetch fails): found under a generic title, never a 500', async () => {
    fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const { statusCode, payload } = await describeViaRoute([{ kind: 'fln', ref: '11156', lang: 'en' }]);
    expect(statusCode).toBe(200);
    expect(payload.plans[0]).toMatchObject({ found: true, title: 'Reading Hour lesson', grade: null });
  });

  test('no version configured anywhere: no fetch at all, generic title', async () => {
    versionRow = null;
    const { payload } = await describeViaRoute([{ kind: 'fln', ref: '11156', lang: 'en' }]);
    expect(fetchCalls).toHaveLength(0);
    expect(payload.plans[0]).toMatchObject({ found: true, title: 'Reading Hour lesson' });
  });

  test('an index for another version is refused', async () => {
    fetchImpl = async () => ({ ok: true, json: async () => ({ ...INDEX, version: 'v0-old' }) });
    const { payload } = await describeViaRoute([{ kind: 'fln', ref: '11156', lang: 'en' }]);
    expect(payload.plans[0]).toMatchObject({ title: 'Reading Hour lesson' });
  });

  test('a batch with no FLN plan never fetches the index', async () => {
    await describeViaRoute([{ kind: 'g612', ref: 'grade_9_physics.c02.p010', lang: 'en' }]);
    expect(fetchCalls).toHaveLength(0);
  });

  test('the index is fetched once for a whole batch and cached', async () => {
    await describeViaRoute([{ kind: 'fln', ref: '11156', lang: 'en' }, { kind: 'fln', ref: '11133', lang: 'ur' }]);
    await describeViaRoute([{ kind: 'fln', ref: '10230', lang: 'en' }]);
    expect(fetchCalls).toHaveLength(1);
  });

  test('a non-numeric fln ref is not found (never fetched by id)', async () => {
    const { payload } = await describeViaRoute([{ kind: 'fln', ref: '../corpus', lang: 'en' }]);
    expect(payload.plans[0]).toMatchObject({ found: false });
  });
});

describe('describe — k5 and g612 unchanged (parent-commit shapes)', () => {
  test('g612 answer is field for field what it was', async () => {
    const { payload } = await describeViaRoute([{ kind: 'g612', ref: 'grade_9_physics.c02.p010', lang: 'ur' }]);
    expect(payload.plans[0]).toEqual({
      kind: 'g612', ref: 'grade_9_physics.c02.p010', lang: 'ur', found: true,
      title: 'Speed and velocity', grade: 9, subject: 'Physics', chapterNumber: 2,
      chapterTitle: 'Kinematics', dayLabel: null, pagesLabel: 'p.10-12', current: true,
    });
  });

  test('an unknown kind is still a 400', async () => {
    const { statusCode } = await describeViaRoute([{ kind: 'k6', ref: 'x' }]);
    expect(statusCode).toBe(400);
  });

  test('k5 still carries no language', async () => {
    const Describe = require('../../bot/shared/services/lp-describe.service');
    expect(Describe.parsePlans([{ kind: 'k5', ref: 'a', lang: 'ur' }])).toEqual([{ kind: 'k5', ref: 'a', lang: null }]);
    expect(Describe.parsePlans([{ kind: 'fln', ref: '1', lang: 'ur' }])).toEqual([{ kind: 'fln', ref: '1', lang: 'ur' }]);
  });
});

describe('lp-activity — Recent / Home / Coaching recent', () => {
  const ROWS = [
    { kind: 'fln', ref: '11156', lang: 'en', last_used_at: '2026-10-18T05:00:00Z', last_opened_at: '2026-10-18T05:00:00Z', last_received_at: null },
    { kind: 'k5', ref: 'g4sci1', lang: null, last_used_at: '2026-10-17T05:00:00Z', last_opened_at: null, last_received_at: '2026-10-17T05:00:00Z' },
    { kind: 'g612', ref: 'g9phy', lang: 'ur', last_used_at: '2026-10-16T05:00:00Z', last_opened_at: '2026-10-16T05:00:00Z', last_received_at: null },
  ];
  const describe5 = async (plans) => plans.map((p) => ({ ...p, found: true, title: `T ${p.ref}`, grade: p.kind === 'fln' ? null : 4, subject: 'S' }));

  test('an FLN row opens as fln, and k5/g612 rows are unchanged', async () => {
    const LpActivity = require('../../dashboard/services/lp-activity.service');
    const query = jest.fn(async () => ({ rows: ROWS }));
    const plans = await LpActivity.recentPlans(query, '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10', { limit: 10, describe: describe5 });
    expect(plans[0]).toMatchObject({
      planKey: 'fln:11156', kind: 'fln', planId: '11156', lang: 'en', found: true, title: 'T 11156',
      open: { lane: 'fln', planId: '11156' },
    });
    expect(plans[0]).not.toHaveProperty('segmentId');
    expect(plans[1]).toMatchObject({ planKey: 'k5:g4sci1', lessonId: 'g4sci1', open: { lane: 'k5', lessonId: 'g4sci1' } });
    expect(plans[2]).toMatchObject({ planKey: 'g612:g9phy', segmentId: 'g9phy', lang: 'ur', open: { lane: 'g612', segmentId: 'g9phy', lang: 'ur' } });
  });
});

describe('lp-history — "All lesson plans"', () => {
  test('an FLN use opens as fln and counts as a plan, not as a class', async () => {
    const H = require('../../dashboard/services/lp-history.service');
    const rows = [
      { kind: 'fln', ref: '11156', lang: 'en', at: '2026-10-08T04:00:00Z', via: 'portal' },
      { kind: 'k5', ref: 'g4sci1', lang: null, at: '2026-10-07T04:00:00Z', via: 'portal' },
    ];
    const query = jest.fn(async (sql) => ({ rows: /FROM lp_activity/.test(sql) ? rows : [] }));
    const describe = async (plans) => plans.map((p) => (p.kind === 'fln'
      ? { ...p, found: true, title: 'Sounds', grade: null, subject: 'Reading Hour · English' }
      : { ...p, found: true, title: 'Parts of a plant', grade: 4, subject: 'General Science' }));
    const out = await H.lpHistory(query, '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10', {
      range: { key: 'all_time', from: null, to: null }, previous: null, describe,
    });
    const fln = out.items.find((i) => i.kind === 'fln');
    expect(fln).toMatchObject({ planKey: 'fln:11156', open: { lane: 'fln', planId: '11156' } });
    const k5 = out.items.find((i) => i.kind === 'k5');
    expect(k5.open).toEqual({ lane: 'k5', lessonId: 'g4sci1' });
    expect(out.kpis.lessonPlans.value).toBe(2);
    expect(out.kpis.classesCovered.value).toBe(1);
  });
});
