/**
 * GET /api/portal/training/module/:id — media URL resolution.
 *
 * Training media lives on two different hosts:
 *   - the private R2 bucket (needs a presigned URL)
 *   - a public external object store (must be passed through UNCHANGED —
 *     presigning a non-R2 URL fails validation and returns null, which used
 *     to make every externally-hosted video render nothing on the portal)
 *
 * PDF modules carry their document in source_media_url (video_url/audio_url
 * NULL) — the endpoint must surface it as pdf_url so the portal can render an
 * open/download control. The endpoint also reports has_questions so the
 * frontend can decide between quiz-driven completion and the explicit
 * "Mark complete" control for quiz-less modules.
 *
 * Same mock harness as tests/training/portal-quiz-submit.test.js, with a
 * REALISTIC r2.service mock: isValidR2Url does the actual host check and
 * generatePresignedUrl returns a tagged URL only for valid R2 inputs.
 */

let supabaseFrom;
let tableStates;

const R2_HOST = 'https://mock-account-id.r2.cloudflarestorage.com';

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, orderCol: null, orderDir: null, selectOpts: null };
  const chain = {};

  const computeRows = () => {
    let rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    if (Array.isArray(state.filterCols)) {
      for (const col of state.filterCols) {
        if (col in record.filters && typeof record.filters[col] !== 'object') {
          // String-coerced equality — Postgres coerces a text param against a
          // bigint column, so the mock must too (:id params arrive as strings).
          rows = rows.filter((r) => String(r[col]) === String(record.filters[col]));
        }
      }
    }
    return rows;
  };

  const finalize = () => {
    if (state.error) return { data: null, error: state.error };
    const rows = computeRows();
    return { data: rows[0] || null, error: null };
  };
  const finalizeMany = () => {
    if (state.error) return { data: null, count: null, error: state.error };
    let rows = computeRows();
    if (record.orderCol) {
      const dir = record.orderDir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const av = a[record.orderCol], bv = b[record.orderCol];
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av < bv ? -1 * dir : 1 * dir;
      });
    }
    if (record.selectOpts && record.selectOpts.head) {
      return { data: null, count: rows.length, error: null };
    }
    return { data: rows, count: rows.length, error: null };
  };

  chain.select = jest.fn((_cols, opts) => { record.selectOpts = opts || null; return chain; });
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'not'].forEach((m) => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.order = jest.fn((col, opts) => {
    record.orderCol = col;
    record.orderDir = opts && opts.ascending ? 'asc' : 'desc';
    return chain;
  });
  chain.limit = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.single = jest.fn(async () => finalize());
  chain.insert = jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    single: jest.fn(async () => ({ data: { id: 'x' }, error: null })),
    then: (resolve, reject) => Promise.resolve({ data: null, error: null }).then(resolve, reject),
  }));
  chain.upsert = jest.fn(() => ({
    then: (resolve, reject) => Promise.resolve({ data: null, error: null }).then(resolve, reject),
  }));
  chain.then = (resolve, reject) => Promise.resolve(finalizeMany()).then(resolve, reject);
  return chain;
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const p = layer.route.path;
    const methods = layer.route.methods || {};
    if (methods[method] && p === path) return layer.route.stack.map(s => s.handle);
  }
  return null;
}

async function invoke({ userId, params = {}, routePath = '/training/module/:id', method = 'get' }) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, routePath);
  if (!stack) throw new Error(`Route ${method.toUpperCase()} ${routePath} not found`);

  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params, body: {}, query: params.query || {},
    method: method.toUpperCase(),
    path: routePath,
    ip: '127.0.0.1',
    headers: {},
    get: () => undefined,
  };

  let statusCode = 200;
  let payload = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(b) { payload = b; return this; },
  };

  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') {
        maybe.then(() => resolve(), () => resolve());
      } else if (advanced === false) {
        resolve();
      }
    });
  }
  return { statusCode, payload };
}

function seedModule(moduleRow, { questions = [] } = {}) {
  tableStates.training_modules = {
    rows: [{ id: 42, course_id: 7, title: 'M', is_active: true, ...moduleRow }],
  };
  tableStates.training_courses = {
    rows: [{ id: 7, level_id: 1, title: 'C' }],
  };
  tableStates.training_levels = {
    rows: [{ id: 1, name: 'L1', order_index: 0, is_active: true }],
  };
  tableStates.training_questions = { rows: questions, filterCols: ['training_module_id'] };
  tableStates.teacher_training_progress = { rows: [] };
  tableStates.training_assessment_attempts = { rows: [] };
  tableStates.training_grand_quizzes = { rows: [] };
}

beforeEach(() => {
  jest.resetModules();
  tableStates = {};

  supabaseFrom = jest.fn((tbl) => makeChain(tbl));
  jest.doMock('../../dashboard/config/supabase', () => ({
    from: supabaseFrom,
    rpc: jest.fn().mockResolvedValue({ error: null }),
  }));
  // Realistic R2 mock: only R2-hosted URLs validate + presign. Mirrors the
  // real isValidR2Url host check so pass-through behaviour is actually
  // exercised (a blanket `true` mock would hide the bug this guards).
  jest.doMock('../../dashboard/services/r2.service', () => ({
    isValidR2Url: jest.fn((url) => !!url && url.includes('r2.cloudflarestorage.com')),
    generatePresignedUrl: jest.fn(async (url) =>
      url && url.includes('r2.cloudflarestorage.com') ? `presigned:${url}` : null
    ),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});

afterEach(() => jest.resetModules());

describe('GET /api/portal/training/module/:id — media resolution', () => {
  it('presigns R2-hosted video and audio URLs', async () => {
    const video = `${R2_HOST}/mock-bucket/training/videos/m42.mp4`;
    const audio = `${R2_HOST}/mock-bucket/training/audio/m42.ogg`;
    seedModule({ video_url: video, audio_url: audio, source_media_url: null });

    const { statusCode, payload } = await invoke({ userId: 'user-1', params: { id: '42' } });
    expect(statusCode).toBe(200);
    expect(payload.module.video_url).toBe(`presigned:${video}`);
    expect(payload.module.audio_url).toBe(`presigned:${audio}`);
    expect(payload.module.pdf_url).toBeNull();
  });

  it('passes externally-hosted public video URLs through unchanged (regression: presign returned null)', async () => {
    const video = 'https://public-assets.example-cdn.example/objects/abc123.mp4';
    seedModule({ video_url: video, audio_url: null, source_media_url: video });

    const { statusCode, payload } = await invoke({ userId: 'user-1', params: { id: '42' } });
    expect(statusCode).toBe(200);
    expect(payload.module.video_url).toBe(video);
    // .mp4 source_media_url is NOT a PDF — no pdf_url
    expect(payload.module.pdf_url).toBeNull();
  });

  it('surfaces a PDF source_media_url as pdf_url (document modules had no render path)', async () => {
    const pdf = 'https://public-assets.example-cdn.example/objects/doc456.pdf';
    seedModule({ video_url: null, audio_url: null, source_media_url: pdf });

    const { statusCode, payload } = await invoke({ userId: 'user-1', params: { id: '42' } });
    expect(statusCode).toBe(200);
    expect(payload.module.video_url).toBeNull();
    expect(payload.module.audio_url).toBeNull();
    expect(payload.module.pdf_url).toBe(pdf);
  });

  it('presigns an R2-hosted PDF source_media_url', async () => {
    const pdf = `${R2_HOST}/mock-bucket/training/docs/m42.pdf`;
    seedModule({ video_url: null, audio_url: null, source_media_url: pdf });

    const { payload } = await invoke({ userId: 'user-1', params: { id: '42' } });
    expect(payload.module.pdf_url).toBe(`presigned:${pdf}`);
  });

  it('reports has_questions=false for quiz-less modules and true when an active quiz exists', async () => {
    seedModule({ video_url: null, audio_url: null, source_media_url: null }, { questions: [] });
    let { payload } = await invoke({ userId: 'user-1', params: { id: '42' } });
    expect(payload.module.has_questions).toBe(false);

    seedModule(
      { video_url: null, audio_url: null, source_media_url: null },
      { questions: [{ id: 101, training_module_id: 42, correct_option: '1', order_index: 0, is_active: true }] }
    );
    ({ payload } = await invoke({ userId: 'user-1', params: { id: '42' } }));
    expect(payload.module.has_questions).toBe(true);
  });
});

describe('GET /api/portal/training/modules — has_pdf flag', () => {
  it('marks document modules with has_pdf so the list can badge them', async () => {
    seedModule({});
    tableStates.training_modules = {
      rows: [
        { id: 42, course_id: 7, title: 'Video module', order_index: 0, duration_seconds: 60, video_url: 'https://x.example/v.mp4', audio_url: null, source_media_url: null, is_active: true },
        { id: 43, course_id: 7, title: 'Doc module', order_index: 1, duration_seconds: 0, video_url: null, audio_url: null, source_media_url: 'https://x.example/d.pdf', is_active: true },
      ],
    };

    const { statusCode, payload } = await invoke({
      userId: 'user-1',
      params: { query: { course_id: '7' } },
      routePath: '/training/modules',
    });
    expect(statusCode).toBe(200);
    const byId = Object.fromEntries(payload.modules.map(m => [m.id, m]));
    expect(byId[42].has_pdf).toBe(false);
    expect(byId[42].has_video).toBe(true);
    expect(byId[43].has_pdf).toBe(true);
    expect(byId[43].has_video).toBe(false);
  });
});
