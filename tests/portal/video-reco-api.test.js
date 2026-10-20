'use strict';
/**
 * bd-gzfdu9 (VIDREC, SPEC §4.7) — GET /api/portal/coaching-session/:id carries the session's recommended training clip
 * as `video_recommendation`, for the card under "Try one thing" on the portal report.
 *
 *   VIDEO_RECO_ENABLED off (or flags.js not deployed)  → no key, no read: the payload is today's, byte for byte
 *   on, no 'shown' row                                  → video_recommendation: null
 *   on, a 'shown' row                                   → {title, levelLabel: null, durationS, language, reason, thumbUrl, href}
 *   on, the read fails / the token cannot be signed     → null, and the report still answers 200
 *
 * flags.js, link-token.js and catalog.js are the other two VIDREC PRs (eng-engine, eng-surfaces): mocked here
 * (virtual, so this file runs before they land).
 */
let tableRows;
let tableErrors;
let selects;

const VR = '../../bot/shared/services/coaching/video-reco';

function makeChain(table) {
  const tests = [];
  const run = () => (tableRows[table] || []).filter((r) => tests.every((t) => t(r))).map((r) => ({ ...r }));
  const result = () => (tableErrors[table] ? { data: null, error: { message: tableErrors[table] } } : { data: run()[0] || null, error: null });
  const chain = {
    select: (c) => { (selects[table] = selects[table] || []).push(c || ''); return chain; },
    eq: (c, v) => { tests.push((r) => r[c] === v); return chain; },
    in: (c, vs) => { tests.push((r) => vs.includes(r[c])); return chain; },
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => result(),
    then: (res, rej) => Promise.resolve({ data: run(), error: null }).then(res, rej),
  };
  chain.single = chain.maybeSingle;
  return chain;
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) return layer.route.stack.map((s) => s.handle);
  }
  throw new Error(`no ${method.toUpperCase()} ${path}`);
}

async function getSession(userId, id) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'get', '/coaching-session/:id');
  const req = { session: { portalUserId: userId, id: 'sess-1' }, params: { id }, body: {}, query: {}, method: 'GET', headers: {}, get: () => undefined };
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

const UID = '0b9c3f1e-1111-4222-8333-444444444444';
const SID = '7a1d2c3b-2222-4333-8444-555555555555';
const RID = '9e8d7c6b-3333-4444-8555-666666666666';

let enabled;
let linkFor;

function mockVideoReco({ flags = true, linkToken = true, catalog = true } = {}) {
  const missing = () => { throw new Error("Cannot find module"); };
  jest.doMock(`${VR}/flags`, flags ? () => ({ videoRecoEnabled: () => enabled }) : missing, { virtual: true });
  jest.doMock(`${VR}/link-token`, linkToken ? () => ({ signVideoLink: (ids) => linkFor(ids), VIDEO_PATH: '/v' }) : missing, { virtual: true });
  jest.doMock(`${VR}/catalog`, catalog ? () => ({
    segment: (id) => (id === '3-s2' ? {
      module: { module_id: 3, cpd_level: 1, title: 'Asking why-questions (full module)', duration_s: 600, language: 'ur' },
      segment: { seg_id: '3-s2', start_s: 95, end_s: 215, title_en: 'Asking why-questions', title_ur: 'کیوں والے سوال پوچھنا' },
    } : null),
  }) : missing, { virtual: true });
}

beforeEach(() => {
  jest.resetModules();
  enabled = false;
  linkFor = (ids) => `tok-${ids.recommendationId}-${ids.surface}`;
  tableRows = {
    app_settings: [],
    coaching_sessions: [{ id: SID, user_id: UID, status: 'completed', created_at: '2026-10-20T09:00:00Z', analysis_data: null, report_pdf_url: 'https://r2.example/r.png' }],
    video_recommendations: [],
    training_modules: [{ id: 3, title: 'Module three' }],
  };
  tableErrors = {};
  selects = {};
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: jest.fn(), flush: jest.fn(), isEnabled: () => false }));
  jest.doMock('../../dashboard/services/portal-coaching.client', () => ({}));
  jest.doMock('../../dashboard/config/supabase', () => ({ from: (t) => makeChain(t), rpc: jest.fn() }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('../../dashboard/services/coaching-breakdown.service', () => ({ breakdown: jest.fn().mockResolvedValue(null) }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});
afterEach(() => jest.resetModules());

const shownRow = (extra) => ({
  id: RID, coaching_session_id: SID, user_id: UID, status: 'shown', module_id: 3, seg_id: '3-s2', start_s: 95, end_s: 215,
  reason_en: 'At 12:40 a question was answered at once; this clip shows the wait.', reason_ur: 'اس کلپ میں سوال کے بعد انتظار دکھایا گیا ہے۔', ...extra,
});

describe('flag off: the payload is today\'s', () => {
  test('VIDEO_RECO_ENABLED off → no key and no video_recommendations read', async () => {
    mockVideoReco();
    tableRows.video_recommendations = [shownRow()];
    const { statusCode, payload } = await getSession(UID, SID);
    expect(statusCode).toBe(200);
    expect('video_recommendation' in payload.session).toBe(false);
    expect(selects.video_recommendations).toBeUndefined();
  });

  test('flags.js not deployed (eng-engine not landed) → identical to flag off, even with the env set', async () => {
    process.env.VIDEO_RECO_ENABLED = 'true';
    try {
      mockVideoReco({ flags: false });
      tableRows.video_recommendations = [shownRow()];
      const absent = JSON.stringify((await getSession(UID, SID)).payload);
      jest.resetModules();
      mockVideoReco();
      enabled = false;
      const off = JSON.stringify((await getSession(UID, SID)).payload);
      expect(absent).toBe(off);
      expect(selects.video_recommendations).toBeUndefined();
    } finally {
      delete process.env.VIDEO_RECO_ENABLED;
    }
  });
});

describe('flag on', () => {
  beforeEach(() => { enabled = true; });

  test('no shown row → video_recommendation: null', async () => {
    mockVideoReco();
    tableRows.video_recommendations = [shownRow({ status: 'none' })];
    const { statusCode, payload } = await getSession(UID, SID);
    expect(statusCode).toBe(200);
    expect(payload.session.video_recommendation).toBeNull();
  });

  test('a shown row → the card, linked for surface portal', async () => {
    mockVideoReco();
    tableRows.video_recommendations = [shownRow()];
    const { payload } = await getSession(UID, SID);
    expect(payload.session.video_recommendation).toEqual({
      title: 'Asking why-questions',
      levelLabel: null,
      durationS: 120,
      language: 'ur',
      reason: 'At 12:40 a question was answered at once; this clip shows the wait.',
      thumbUrl: '/v/thumb/3.jpg',
      href: `/v/tok-${RID}-portal?s=portal`,
    });
  });

  test('another teacher\'s row for the session is never served', async () => {
    mockVideoReco();
    tableRows.video_recommendations = [shownRow({ user_id: 'someone-else' })];
    const { payload } = await getSession(UID, SID);
    expect(payload.session.video_recommendation).toBeNull();
  });

  test('an Urdu report gets the Urdu title and reason', async () => {
    mockVideoReco();
    tableRows.coaching_sessions[0].analysis_data = { report_narrative: { _language: 'ur' } };
    tableRows.video_recommendations = [shownRow()];
    const { payload } = await getSession(UID, SID);
    expect(payload.session.video_recommendation.title).toBe('کیوں والے سوال پوچھنا');
    expect(payload.session.video_recommendation.reason).toBe('اس کلپ میں سوال کے بعد انتظار دکھایا گیا ہے۔');
  });

  test('no catalogue entry → the module title from training_modules, the row\'s own clip length', async () => {
    mockVideoReco({ catalog: false });
    tableRows.video_recommendations = [shownRow()];
    const { payload } = await getSession(UID, SID);
    expect(payload.session.video_recommendation).toMatchObject({ title: 'Module three', levelLabel: null, durationS: 120, language: null });
  });

  test('the read fails (table not on this DB) → null, report still 200', async () => {
    mockVideoReco();
    tableErrors.video_recommendations = 'relation "video_recommendations" does not exist';
    const { statusCode, payload } = await getSession(UID, SID);
    expect(statusCode).toBe(200);
    expect(payload.session.video_recommendation).toBeNull();
    expect(payload.session.id).toBe(SID);
  });

  test('link-token.js not deployed, or the link cannot be signed → null', async () => {
    mockVideoReco({ linkToken: false });
    tableRows.video_recommendations = [shownRow()];
    expect((await getSession(UID, SID)).payload.session.video_recommendation).toBeNull();
    jest.resetModules();
    mockVideoReco();
    linkFor = () => null;
    expect((await getSession(UID, SID)).payload.session.video_recommendation).toBeNull();
  });
});
