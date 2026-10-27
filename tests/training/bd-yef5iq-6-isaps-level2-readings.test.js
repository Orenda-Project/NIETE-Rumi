/**
 * bd-yef5iq.6 + bd-gbf8ix — I-SAPS reading lists reach the teacher, for both levels.
 *
 * 1. Level 2 (Intermediate) went live on 2026-10-26 with no reading list. I-SAPS sent
 *    "Level 2 Reading List Final.docx" the same day: 13 MANDATORY readings across the
 *    nine modules, each with what to read, a rationale and the outcome.
 *
 * 2. The teacher portal's /training/modules matched the list by vendor NAME, and the
 *    I-SAPS vendor was renamed "Teacher Development Programme, 9-12" on 2026-10-13
 *    (bd-2gia5l). From then on every I-SAPS module page returned `readings: null` —
 *    Level 1's list had silently disappeared. The vendor KEY never changes, so the
 *    match is on the key.
 */
const { EventEmitter } = require('events'); // eslint-disable-line no-unused-vars

const RULES = '../../bot/shared/services/training/isaps-readings.rules';
const RENAMED = 'Teacher Development Programme, 9-12';

describe('readingsForCourse — Level 2 (bd-yef5iq.6)', () => {
  const { readingsForCourse } = require(RULES);
  const l2 = (m) => readingsForCourse({ vendorKey: 'ISAPS', levelOrderIndex: 1, courseTitle: `Module ${m} - X` });

  test('13 mandatory readings across the nine modules, every one linked', () => {
    const perModule = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => (l2(m) ? l2(m).available.length : 0));
    expect(perModule).toEqual([1, 3, 1, 1, 2, 1, 1, 2, 1]);
    for (let m = 1; m <= 9; m += 1) {
      expect(l2(m).unavailable).toHaveLength(0);
      for (const it of l2(m).available) {
        expect(it.url).toMatch(/^https?:\/\//);
        expect(it.rationale.trim()).not.toBe('');
        expect(it.outcome.trim()).not.toBe('');
        expect(it.section.trim()).not.toBe('');
      }
    }
  });

  test('Module 1 is Dewey, pages 17–33; Module 8 ends with Rosenshine on aft.org', () => {
    const [dewey] = l2(1).available;
    expect(dewey).toMatchObject({ title: 'Experience and Education (1938/1997)', author: 'Dewey, J.', section: 'Pages 17–33' });
    const [biggs, rosenshine] = l2(8).available;
    expect(biggs.title).toBe('Enhancing Teaching Through Constructive Alignment (1996)');
    expect(rosenshine.url).toBe('https://www.aft.org/sites/default/files/Rosenshine.pdf');
  });

  test('Module 2 opens with Immordino-Yang & Damasio, one author not two', () => {
    const [first] = l2(2).available;
    expect(first.title).toMatch(/^We Feel, Therefore We Learn/);
    expect(first.author).toBe('Immordino-Yang, M. H., & Damasio, A.');
  });

  test('Level 1 is unchanged by adding Level 2', () => {
    const l1 = (m) => readingsForCourse({ vendorKey: 'ISAPS', levelOrderIndex: 0, courseTitle: `Module ${m} - X` });
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => l1(m).available.length)).toEqual([2, 2, 2, 1, 2, 1, 1, 1, 1]);
    expect(l1(1).available[0].author).toBe('Sir Ken Robinson');
  });

  test('a level with no list (Level 3) is still null', () => {
    expect(readingsForCourse({ vendorKey: 'ISAPS', levelOrderIndex: 2, courseTitle: 'Module 1 - X' })).toBeNull();
  });
});

describe('readingsForCourse — matched on the vendor KEY (bd-gbf8ix)', () => {
  const { readingsForCourse } = require(RULES);

  test('the renamed I-SAPS vendor still gets its readings', () => {
    const r = readingsForCourse({ vendorKey: 'ISAPS', vendorName: RENAMED, levelOrderIndex: 0, courseTitle: 'Module 1 - X' });
    expect(r).not.toBeNull();
    expect(r.available[0].author).toBe('Sir Ken Robinson');
  });

  test('another vendor never gets I-SAPS readings, whatever it is called', () => {
    expect(readingsForCourse({ vendorKey: 'BEACONHOUSE', vendorName: 'I-SAPS', levelOrderIndex: 0, courseTitle: 'Module 1 - X' })).toBeNull();
    expect(readingsForCourse({ vendorKey: null, vendorName: RENAMED, levelOrderIndex: 0, courseTitle: 'Module 1 - X' })).toBeNull();
  });
});

// ── the portal route itself: GET /training/modules ─────────────────────────────────
let tableStates;
let supabaseFrom;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { filters: {} };
  const chain = {};
  const rows = () => (state.rows || []).filter((r) => Object.entries(record.filters).every(([c, v]) =>
    (typeof v === 'object' && v !== null) || !(c in r) || String(r[c]) === String(v)));
  chain.select = jest.fn(() => chain);
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is', 'not', 'like', 'ilike'].forEach((m) => {
    chain[m] = jest.fn((col, val) => { if (m === 'eq') record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => ({ data: rows()[0] || null, error: null }));
  chain.single = chain.maybeSingle;
  chain.then = (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej);
  return chain;
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) return layer.route.stack.map((s) => s.handle);
  }
  return null;
}

async function getModules(courseId) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'get', '/training/modules');
  const req = { session: { portalUserId: 'user-1', id: 's' }, params: {}, query: { course_id: String(courseId) }, body: {}, headers: {}, get: () => undefined, ip: '127.0.0.1', method: 'GET', path: '/training/modules' };
  let payload = null; let statusCode = 200;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  for (const h of stack) {
    let next = false;
    // eslint-disable-next-line no-await-in-loop
    await h(req, res, () => { next = true; });
    if (!next) break;
  }
  return { statusCode, payload };
}

describe('GET /training/modules — readings for a renamed vendor (bd-gbf8ix)', () => {
  beforeEach(() => {
    jest.resetModules();
    tableStates = {
      training_courses: { rows: [{ id: 67, level_id: 27, title: 'Module 1 - Philosophical Foundations', is_active: true }] },
      training_levels: { rows: [{ id: 27, vendor_id: 'v-isaps', order_index: 0, name: 'Level 1: Novice', is_active: true }] },
      training_vendors: { rows: [{ id: 'v-isaps', key: 'ISAPS', name: RENAMED }] },
      training_modules: { rows: [{ id: 439, course_id: 67, title: 'Unit 101', order_index: 1, is_active: true }] },
      teacher_training_progress: { rows: [] },
      training_questions: { rows: [] },
      training_grand_quizzes: { rows: [] },
      training_assessment_attempts: { rows: [] },
    };
    supabaseFrom = jest.fn((t) => makeChain(t));
    jest.doMock('../../dashboard/config/supabase', () => ({ from: supabaseFrom, rpc: jest.fn().mockResolvedValue({ error: null }) }));
    const { installTrainingDelegation, seedProgramScope } = require('../fixtures/delegate-training-to-bot');
    installTrainingDelegation(() => supabaseFrom);
    seedProgramScope(tableStates);
    jest.doMock('../../dashboard/services/r2.service', () => ({
      isValidR2Url: jest.fn(() => false), generatePresignedUrl: jest.fn(async () => null), generatePresignedUrls: jest.fn().mockResolvedValue([]),
    }));
    jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
    jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
    jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  });
  afterEach(() => jest.resetModules());

  test('a Level 1 module page still carries its reading list after the vendor rename', async () => {
    const { statusCode, payload } = await getModules(67);
    expect(statusCode).toBe(200);
    expect(payload.readings).not.toBeNull();
    expect(payload.readings.available[0].author).toBe('Sir Ken Robinson');
  });
});
