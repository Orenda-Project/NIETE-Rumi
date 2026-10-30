/**
 * bd-s42dye.1 — the coach-only, read-only Training Library API.
 *
 *   GET /api/portal/training/library                              the whole catalogue, unscoped
 *   GET /api/portal/training/library/module/:id                   one part: body + presigned media
 *   GET /api/portal/training/library/course/:id/readings          the ISAPS reading list
 *   GET /api/portal/training/library/questions?module_id|level_id|course_id&kind=module_exam
 *                                                                 a whole question bank, NO answer keys
 *
 * What these tests hold the routes to (the acceptance criteria):
 *   - 401 with no session; 403 {error:'coach_only'} for a teacher, a principal, an unregistered user (and an
 *     unknown user, and a role lookup that fails); the role is RE-READ from `users` on every request.
 *   - locked and unassigned content is still returned; no gate (scope, level chain, module order, exam,
 *     certificate) is consulted.
 *   - the question payload carries no key, rubric, explanation or anything that reveals either (deep scan).
 *   - ZERO write calls (insert / update / upsert / delete) on any table, across all four endpoints.
 */

// Not a suite about the sign-in account check: every session user reads as live (tests/fixtures/portal-auth-live.js).
require('../fixtures/portal-auth-live').installLivePortalAccounts();

const { createFakePostgrest } = require('./helpers/fake-postgrest');

const COACH = 'coach-user-1';
const TEACHER = 'teacher-user-1';
const PRINCIPAL = 'principal-user-1';
const UNREGISTERED = 'unregistered-user-1';
const GHOST = 'no-such-user';

const R2 = 'https://abc123.r2.cloudflarestorage.com/niete/media';

const SECRET_RUBRIC = 'RUBRIC-SECRET-do-not-leak';
const SECRET_EXPLAIN = 'EXPLANATION-SECRET-do-not-leak';

function tables() {
  return {
    users: [
      { id: COACH, role: 'coach' },
      { id: TEACHER, role: 'teacher' },
      { id: PRINCIPAL, role: 'principal' },
      { id: UNREGISTERED, role: 'unregistered' },
    ],
    // Deliberately scrambled: the route, not the fixture, decides the order.
    training_vendors: [
      { id: 'v-lg', key: 'TALEEMABAD_LEGACY', name: 'Taleemabad', is_active: true },
      { id: 'v-ox', key: 'OXBRIDGE', name: 'Game-Based Teaching', is_active: true },
      { id: 'v-dead', key: 'AAA_DEAD', name: 'Retired provider', is_active: false },
      { id: 'v-bh', key: 'BEACONHOUSE', name: 'AI-Powered Subject Pedagogy', is_active: true },
      { id: 'v-is', key: 'ISAPS', name: 'Teacher Development Programme, 9-12', is_active: true },
      { id: 'v-ni', key: 'TALEEMABAD', name: 'NIETE', is_active: true },
    ],
    training_levels: [
      { id: 27, vendor_id: 'v-is', name: 'Level 1: Novice', order_index: 0, is_active: true },
      { id: 2, vendor_id: 'v-ni', name: 'Emerging Practitioner', order_index: 1, is_active: true },
      { id: 1, vendor_id: 'v-ni', name: 'Aspiring Teacher', order_index: 0, is_active: true },
      { id: 3, vendor_id: 'v-ni', name: 'Retired level', order_index: 2, is_active: false },
      { id: 18, vendor_id: 'v-bh', name: 'English', order_index: 1, is_active: true },
      { id: 17, vendor_id: 'v-ox', name: 'GBTLA', order_index: 4, is_active: true },
      { id: 90, vendor_id: 'v-lg', name: 'Aspiring Teacher (legacy)', order_index: 0, is_active: true },
      { id: 91, vendor_id: 'v-dead', name: 'Level of a dead vendor', order_index: 0, is_active: true },
    ],
    training_courses: [
      { id: 2, level_id: 1, title: 'Lesson Planning', course_type: 'LESSON_PLANNING', order_index: 2, is_active: true },
      { id: 1, level_id: 1, title: 'Classroom Management', course_type: 'CLASSROOM_MANAGEMENT', order_index: 1, is_active: true },
      { id: 5, level_id: 1, title: 'Retired course', course_type: 'X', order_index: 3, is_active: false },
      { id: 6, level_id: 2, title: 'Assessment', course_type: 'ASSESSMENT', order_index: 1, is_active: true },
      { id: 67, level_id: 27, title: 'Module 1 - Philosophical Foundations', course_type: 'ISAPS', order_index: 1, is_active: true },
      { id: 68, level_id: 27, title: 'Module 2 - Affective Development', course_type: 'ISAPS', order_index: 2, is_active: true },
      { id: 80, level_id: 18, title: 'Reading Pedagogy', course_type: 'BH', order_index: 1, is_active: true },
      { id: 95, level_id: 90, title: 'Legacy course', course_type: 'LEGACY', order_index: 1, is_active: true },
      { id: 96, level_id: 91, title: 'Course of a dead vendor', course_type: 'X', order_index: 1, is_active: true },
    ],
    training_modules: [
      { id: 11, course_id: 1, title: 'Quiet signal (PDF)', content_html: '', video_url: null, audio_url: null, source_media_url: 'https://docs.example.org/guide.pdf?v=2', duration_seconds: 0, order_index: 1, is_active: true },
      { id: 10, course_id: 1, title: 'Noise and rules', content_html: '<p>Agree a quiet signal.</p>', video_url: `${R2}/noise.mp4`, audio_url: 'https://cdn.example.org/noise.mp3', source_media_url: null, duration_seconds: 240, order_index: 2, is_active: true },
      { id: 12, course_id: 1, title: 'Retired part', content_html: '<p>old</p>', video_url: null, audio_url: null, source_media_url: null, duration_seconds: 0, order_index: 3, is_active: false },
      { id: 20, course_id: 2, title: 'Objectives', content_html: '', video_url: null, audio_url: `${R2}/obj.mp3`, source_media_url: null, duration_seconds: 90, order_index: 1, is_active: true },
      { id: 30, course_id: 67, title: 'Unit 101', content_html: '<p>Unit</p>', video_url: null, audio_url: null, source_media_url: null, duration_seconds: 0, order_index: 1, is_active: true },
      { id: 31, course_id: 68, title: 'Unit 201', content_html: null, video_url: null, audio_url: null, source_media_url: null, duration_seconds: 0, order_index: 1, is_active: true },
      { id: 40, course_id: 95, title: 'Legacy part', content_html: '<p>Legacy</p>', video_url: `${R2}/legacy.mp4`, audio_url: null, source_media_url: null, duration_seconds: 60, order_index: 1, is_active: true },
      { id: 41, course_id: 6, title: 'Rubrics', content_html: '<p>Rubrics</p>', video_url: null, audio_url: null, source_media_url: null, duration_seconds: 0, order_index: 1, is_active: true },
    ],
    training_grand_quizzes: [
      { id: 1, level_id: 2, source_quiz_id: 6, quiz_type: 'diagnostic', is_active: true },
      { id: 2, level_id: 2, source_quiz_id: 2, quiz_type: 'grand_quiz', is_active: false },
      { id: 3, level_id: 1, source_quiz_id: 1, quiz_type: 'grand_quiz', is_active: true },
      { id: 29, level_id: 18, source_quiz_id: 8, quiz_type: 'capstone', is_active: true },
      { id: 36, level_id: 27, source_quiz_id: 901, quiz_type: 'capstone', is_active: false },
      { id: 37, level_id: 27, source_quiz_id: 901, quiz_type: 'grand_quiz', is_active: true },
      { id: 38, level_id: 27, source_quiz_id: 902, quiz_type: 'grand_quiz', is_active: true }, // no active questions
      { id: 54, level_id: 27, source_quiz_id: null, quiz_type: 'capstone', is_active: false },
    ],
    training_questions: [
      // module quiz bank (module 10): an MCQ, an MSQ, and one hidden by is_active
      { id: 501, training_module_id: 10, grand_quiz_id: null, question_text: 'Best first step?', question_urdu: null, options: ['Send them out', 'Quietly redirect', 'Ignore'], correct_option: '2', option_images: null, rubric: null, order_index: 1, is_active: true, explanation: SECRET_EXPLAIN },
      { id: 502, training_module_id: 10, grand_quiz_id: null, question_text: 'Which signals work?', question_urdu: null, options: ['Bell', 'Hand up', 'Shouting'], correct_option: '1,2', option_images: null, rubric: null, order_index: 2, is_active: true },
      { id: 503, training_module_id: 10, grand_quiz_id: null, question_text: 'Hidden', question_urdu: null, options: ['a', 'b'], correct_option: '1', option_images: null, rubric: null, order_index: 3, is_active: false },
      // level exam bank (level 1, quiz 3)
      { id: 601, training_module_id: null, grand_quiz_id: 3, question_text: 'Level exam Q2', question_urdu: null, options: ['A', 'B'], correct_option: '1', option_images: null, rubric: null, order_index: 2, is_active: true },
      { id: 600, training_module_id: null, grand_quiz_id: 3, question_text: 'Level exam Q1', question_urdu: null, options: ['A', 'B', 'C'], correct_option: '3', option_images: null, rubric: null, order_index: 1, is_active: true },
      // capstone (level 18, quiz 29): written questions, with a rubric that must never leave
      { id: 700, training_module_id: null, grand_quiz_id: 29, question_text: 'Describe a reading lesson.', question_urdu: null, options: [], correct_option: '', option_images: null, rubric: SECRET_RUBRIC, order_index: 1, is_active: true },
      { id: 701, training_module_id: null, grand_quiz_id: 29, question_text: 'Describe a phonics routine.', question_urdu: null, options: [], correct_option: '', option_images: null, rubric: SECRET_RUBRIC, order_index: 2, is_active: true },
      // ISAPS module-1 exam (quiz 37): MCQs, one with picture options, and CRQs
      { id: 800, training_module_id: null, grand_quiz_id: 37, question_text: 'Scenario 1', question_urdu: null, options: ['One', 'Two', 'Three', 'Four'], correct_option: '2', option_images: null, rubric: null, order_index: 1, is_active: true },
      { id: 801, training_module_id: null, grand_quiz_id: 37, question_text: 'Compare the drafts', question_urdu: null, options: ['Option 1', 'Option 2'], correct_option: '2', option_images: [`${R2}/opt1.png`, `${R2}/opt2.png`], rubric: null, order_index: 6, is_active: true },
      { id: 802, training_module_id: null, grand_quiz_id: 37, question_text: 'Write about your class.', question_urdu: null, options: [], correct_option: '', option_images: null, rubric: SECRET_RUBRIC, order_index: 7, is_active: true },
      { id: 803, training_module_id: null, grand_quiz_id: 37, question_text: 'Write about another class.', question_urdu: null, options: [], correct_option: '', option_images: null, rubric: SECRET_RUBRIC, order_index: 8, is_active: true },
      { id: 804, training_module_id: null, grand_quiz_id: 37, question_text: 'Retired scenario', question_urdu: null, options: ['x'], correct_option: '1', option_images: null, rubric: null, order_index: 9, is_active: false },
    ],
    // Content the coach does NOT hold: the library must ignore all of it.
    teacher_training_assignments: [],
    teacher_training_progress: [],
    training_assessment_attempts: [],
    training_assessment_answers: [],
    training_certificates: [],
  };
}

const WRITE_METHODS = ['insert', 'update', 'upsert', 'delete'];

let fake; let writes; let gateCalls; let usersReads;

function makeSupabase() {
  return {
    from(table) {
      if (table === 'users') usersReads.push(table);
      const builder = fake.from(table);
      return new Proxy(builder, {
        get(target, prop) {
          if (WRITE_METHODS.includes(prop)) {
            return (...args) => { writes.push({ table, op: prop, args }); throw new Error(`WRITE on ${table}.${prop}`); };
          }
          return target[prop];
        },
      });
    },
  };
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function invoke(path, { userId = COACH, query = {}, params = {} } = {}) {
  const router = require('../../dashboard/routes/training-library.routes');
  const stack = findRoute(router, 'get', path);
  if (!stack) throw new Error(`Route GET ${path} not found`);
  const req = { session: userId ? { portalUserId: userId } : null, query, params, body: {}, method: 'GET', path, headers: {}, get: () => undefined };
  let statusCode = 200; let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (advanced === false) resolve();
    });
  }
  return { statusCode, payload };
}

const LIB = '/training/library';
const MODULE = '/training/library/module/:id';
const READINGS = '/training/library/course/:id/readings';
const QUESTIONS = '/training/library/questions';

beforeEach(() => {
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  writes = []; gateCalls = []; usersReads = [];
  fake = createFakePostgrest({ tables: tables() });
  jest.doMock('../../dashboard/config/supabase', () => makeSupabase());
  // The Cloudflare presigner: a URL is "signed" by tagging it, so a test can tell signed from raw.
  jest.doMock('../../dashboard/services/r2.service', () => ({
    isValidR2Url: (u) => typeof u === 'string' && /r2\.cloudflarestorage\.com/.test(u),
    generatePresignedUrl: jest.fn(async (u) => `${u}?X-Amz-Signature=signed`),
    generatePresignedUrls: jest.fn(),
  }));
  // Every gate lives behind this module. The library must never ask it anything.
  const spy = (name) => jest.fn(async () => { gateCalls.push(name); return { ok: false, status: 403 }; });
  jest.doMock('../../dashboard/services/training-rules.service', () => new Proxy({}, {
    get: (_t, name) => spy(String(name)),
  }));
});
afterEach(() => { jest.restoreAllMocks(); });

const ALL_CALLS = [
  [LIB, {}],
  [MODULE, { params: { id: '10' } }],
  [READINGS, { params: { id: '67' } }],
  [QUESTIONS, { query: { module_id: '10' } }],
  [QUESTIONS, { query: { level_id: '1' } }],
  [QUESTIONS, { query: { course_id: '67', kind: 'module_exam' } }],
];

describe('who may call it', () => {
  test.each(ALL_CALLS)('%s signed out: 401, nothing read', async (path, args) => {
    const r = await invoke(path, { ...args, userId: null });
    expect(r.statusCode).toBe(401);
    expect(fake.queries).toHaveLength(0);
  });

  test.each([
    ['teacher', TEACHER], ['principal', PRINCIPAL], ['unregistered', UNREGISTERED], ['unknown user', GHOST],
  ])('%s gets 403 coach_only on every endpoint and sees no catalogue', async (_label, userId) => {
    for (const [path, args] of ALL_CALLS) {
      // eslint-disable-next-line no-await-in-loop
      const r = await invoke(path, { ...args, userId });
      expect(r.statusCode).toBe(403);
      expect(r.payload).toEqual({ error: 'coach_only' });
    }
    // Only the role was read: no training table was touched.
    expect(new Set(fake.queries.map((q) => q.table))).toEqual(new Set(['users']));
  });

  test('a role like "Coach " or "coach_lead" is not "coach"', async () => {
    fake.db.users.push({ id: 'odd-1', role: 'Coach ' }, { id: 'odd-2', role: 'coach_lead' }, { id: 'odd-3', role: null });
    for (const id of ['odd-1', 'odd-2', 'odd-3']) {
      // eslint-disable-next-line no-await-in-loop
      const r = await invoke(LIB, { userId: id });
      expect(r.statusCode).toBe(403);
    }
  });

  test('the role is re-read on EVERY request (a demoted coach is out on the next call)', async () => {
    expect((await invoke(LIB)).statusCode).toBe(200);
    fake.db.users.find((u) => u.id === COACH).role = 'teacher';
    expect((await invoke(LIB)).statusCode).toBe(403);
    fake.db.users.find((u) => u.id === COACH).role = 'coach';
    expect((await invoke(LIB)).statusCode).toBe(200);
    expect(fake.queries.filter((q) => q.table === 'users')).toHaveLength(3);
  });

  test('a failed role lookup fails closed: 500, no catalogue', async () => {
    jest.resetModules();
    jest.doMock('../../dashboard/config/supabase', () => ({
      from() { throw new Error('connection reset'); },
    }));
    const r = await invoke(LIB);
    expect(r.statusCode).toBe(500);
    expect(JSON.stringify(r.payload)).not.toMatch(/vendors/);
  });
});

describe('GET /training/library', () => {
  test('the whole catalogue, in vendor-rank order, active rows only', async () => {
    const r = await invoke(LIB);
    expect(r.statusCode).toBe(200);
    expect(r.payload.vendors.map((v) => v.vendor_key)).toEqual([
      'TALEEMABAD', 'ISAPS', 'BEACONHOUSE', 'OXBRIDGE', 'TALEEMABAD_LEGACY',
    ]);
    expect(r.payload.vendors[0].vendor_name).toBe('NIETE');
    // an inactive vendor, an inactive level, an inactive course, an inactive part: none of them appear
    const text = JSON.stringify(r.payload);
    expect(text).not.toMatch(/Retired|dead vendor/);
  });

  test('levels, courses and modules carry exactly the contract fields, ordered by order_index then id', async () => {
    const { payload } = await invoke(LIB);
    const niete = payload.vendors[0];
    expect(niete.levels.map((l) => l.id)).toEqual([1, 2]);
    expect(niete.levels[0]).toEqual({
      id: 1, name: 'Aspiring Teacher', order_index: 0, has_level_exam: true, exam_kind: 'grand_quiz',
      courses: expect.any(Array),
    });
    const courses = niete.levels[0].courses;
    expect(courses.map((c) => c.id)).toEqual([1, 2]);
    expect(courses[0]).toEqual({
      id: 1, title: 'Classroom Management', course_type: 'CLASSROOM_MANAGEMENT', order_index: 1,
      has_readings: false, has_module_exam: false, modules: expect.any(Array),
    });
    expect(courses[0].modules).toEqual([
      { id: 11, title: 'Quiet signal (PDF)', order_index: 1, duration_seconds: 0, has_video: false, has_audio: false, has_pdf: true, has_questions: false },
      { id: 10, title: 'Noise and rules', order_index: 2, duration_seconds: 240, has_video: true, has_audio: true, has_pdf: false, has_questions: true },
    ]);
  });

  test('exam_kind: grand_quiz, capstone, or null (a diagnostic or an inactive exam is not a level exam)', async () => {
    const { payload } = await invoke(LIB);
    const level = (vendor, id) => payload.vendors.find((v) => v.vendor_key === vendor).levels.find((l) => l.id === id);
    expect(level('TALEEMABAD', 1)).toMatchObject({ has_level_exam: true, exam_kind: 'grand_quiz' });
    expect(level('TALEEMABAD', 2)).toMatchObject({ has_level_exam: false, exam_kind: null });
    expect(level('BEACONHOUSE', 18)).toMatchObject({ has_level_exam: true, exam_kind: 'capstone' });
    expect(level('ISAPS', 27)).toMatchObject({ has_level_exam: false, exam_kind: null });
    expect(level('OXBRIDGE', 17)).toMatchObject({ has_level_exam: false, exam_kind: null });
  });

  test('has_module_exam and has_readings: ISAPS Module 1 has both; a module with no questions has no exam', async () => {
    const { payload } = await invoke(LIB);
    const isaps = payload.vendors.find((v) => v.vendor_key === 'ISAPS');
    const [m1, m2] = isaps.levels[0].courses;
    expect(m1).toMatchObject({ id: 67, has_module_exam: true, has_readings: true });
    expect(m2).toMatchObject({ id: 68, has_module_exam: false, has_readings: true });
    // nobody else has readings
    const others = payload.vendors.filter((v) => v.vendor_key !== 'ISAPS')
      .flatMap((v) => v.levels.flatMap((l) => l.courses));
    expect(others.every((c) => c.has_readings === false && c.has_module_exam === false)).toBe(true);
  });

  test('the legacy vendor lands after the named four, and its parts are listed', async () => {
    const { payload } = await invoke(LIB);
    const legacy = payload.vendors[payload.vendors.length - 1];
    expect(legacy.vendor_key).toBe('TALEEMABAD_LEGACY');
    expect(legacy.levels[0].courses[0].modules.map((m) => m.id)).toEqual([40]);
  });

  test('locked and unassigned content is still returned, and no gate is consulted', async () => {
    // No assignment, no progress, no attempt: a teacher with this state would be shown nothing.
    expect(fake.db.teacher_training_assignments).toHaveLength(0);
    const { statusCode, payload } = await invoke(LIB);
    expect(statusCode).toBe(200);
    const modules = payload.vendors.flatMap((v) => v.levels.flatMap((l) => l.courses.flatMap((c) => c.modules)));
    expect(modules.map((m) => m.id).sort((a, b) => a - b)).toEqual([10, 11, 20, 30, 31, 40, 41]);
    expect(gateCalls).toEqual([]);
  });

  test('one read per table: the catalogue is not an N+1', async () => {
    await invoke(LIB);
    const perTable = {};
    fake.queries.filter((q) => q.table !== 'users').forEach((q) => { perTable[q.table] = (perTable[q.table] || 0) + 1; });
    expect(Object.values(perTable).every((n) => n === 1)).toBe(true);
    expect(Object.keys(perTable).sort()).toEqual([
      'training_courses', 'training_grand_quizzes', 'training_levels', 'training_modules', 'training_questions', 'training_vendors',
    ]);
  });
});

describe('GET /training/library/module/:id', () => {
  test('the part: body, presigned R2 media, passthrough for external URLs', async () => {
    const r = await invoke(MODULE, { params: { id: '10' } });
    expect(r.statusCode).toBe(200);
    expect(r.payload).toEqual({
      id: 10, title: 'Noise and rules', course_id: 1, level_id: 1, vendor_key: 'TALEEMABAD',
      body_html: '<p>Agree a quiet signal.</p>',
      video_url: `${R2}/noise.mp4?X-Amz-Signature=signed`,
      audio_url: 'https://cdn.example.org/noise.mp3',
      pdf_url: null,
      duration_seconds: 240,
      has_questions: true,
    });
  });

  test('a PDF part surfaces pdf_url; an empty body is null', async () => {
    const r = await invoke(MODULE, { params: { id: '11' } });
    expect(r.payload).toMatchObject({
      body_html: null, video_url: null, audio_url: null,
      pdf_url: 'https://docs.example.org/guide.pdf?v=2', has_questions: false,
    });
  });

  test('a module whose course and level are in a locked chain is still opened (no gate asked)', async () => {
    const r = await invoke(MODULE, { params: { id: '20' } });
    expect(r.statusCode).toBe(200);
    expect(r.payload.audio_url).toBe(`${R2}/obj.mp3?X-Amz-Signature=signed`);
    expect(gateCalls).toEqual([]);
  });

  test.each([['unknown', '9999'], ['inactive', '12'], ['not a number', 'abc'], ['of a dead vendor', '96']])(
    '%s id: 404 not_found', async (_l, id) => {
      const r = await invoke(MODULE, { params: { id } });
      expect(r.statusCode).toBe(404);
      expect(r.payload).toEqual({ error: 'not_found' });
    },
  );
});

describe('GET /training/library/course/:id/readings', () => {
  test('ISAPS Module 1: the reading list, in the shape /training/modules returns', async () => {
    const r = await invoke(READINGS, { params: { id: '67' } });
    expect(r.statusCode).toBe(200);
    expect(Object.keys(r.payload).sort()).toEqual(['available', 'unavailable']);
    expect(r.payload.available.length + r.payload.unavailable.length).toBeGreaterThan(0);
    const item = [...r.payload.available, ...r.payload.unavailable][0];
    expect(Object.keys(item).sort()).toEqual(
      ['author', 'description', 'outcome', 'rationale', 'section', 'title', 'type', 'url'],
    );
  });

  test('a course with no list: empty arrays, not an error', async () => {
    const r = await invoke(READINGS, { params: { id: '1' } });
    expect(r.statusCode).toBe(200);
    expect(r.payload).toEqual({ available: [], unavailable: [] });
  });

  test.each([['unknown', '9999'], ['inactive', '5'], ['not a number', 'x']])('%s course: 404', async (_l, id) => {
    const r = await invoke(READINGS, { params: { id } });
    expect(r.statusCode).toBe(404);
    expect(r.payload).toEqual({ error: 'not_found' });
  });
});

const KEY_FIELDS = ['correct_option', 'correct_options', 'answers', 'answer', 'is_correct', 'rubric', 'explanation', 'correct', 'key', 'multi'];

function deepKeys(value, into = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => deepKeys(v, into));
  else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([k, v]) => { into.add(k); deepKeys(v, into); });
  }
  return into;
}

describe('GET /training/library/questions', () => {
  test('?module_id: the module quiz bank, whole, in stored order, active only', async () => {
    const r = await invoke(QUESTIONS, { query: { module_id: '10' } });
    expect(r.statusCode).toBe(200);
    expect(r.payload).toEqual({
      scope: 'module', title: 'Noise and rules',
      questions: [
        { id: 501, type: 'mcq', text: 'Best first step?', options: ['Send them out', 'Quietly redirect', 'Ignore'], image_url: null, option_image_urls: [null, null, null] },
        { id: 502, type: 'msq', text: 'Which signals work?', options: ['Bell', 'Hand up', 'Shouting'], image_url: null, option_image_urls: [null, null, null] },
      ],
    });
  });

  test('?module_id for a module with no quiz: an empty bank, not a 404', async () => {
    const r = await invoke(QUESTIONS, { query: { module_id: '20' } });
    expect(r.statusCode).toBe(200);
    expect(r.payload).toEqual({ scope: 'module', title: 'Objectives', questions: [] });
  });

  test('?level_id: the level exam bank in order_index order (grand quiz)', async () => {
    const r = await invoke(QUESTIONS, { query: { level_id: '1' } });
    expect(r.statusCode).toBe(200);
    expect(r.payload.scope).toBe('level');
    expect(r.payload.title).toBe('Aspiring Teacher');
    expect(r.payload.questions.map((q) => q.id)).toEqual([600, 601]);
    expect(r.payload.questions.every((q) => q.type === 'mcq')).toBe(true);
  });

  test('?level_id on a capstone level: the written questions, type "open", no options', async () => {
    const r = await invoke(QUESTIONS, { query: { level_id: '18' } });
    expect(r.statusCode).toBe(200);
    expect(r.payload.questions).toEqual([
      { id: 700, type: 'open', text: 'Describe a reading lesson.', options: [], image_url: null, option_image_urls: [] },
      { id: 701, type: 'open', text: 'Describe a phonics routine.', options: [], image_url: null, option_image_urls: [] },
    ]);
  });

  test('?course_id&kind=module_exam: the whole ISAPS bank, MCQs plus every CRQ prompt, nothing sampled', async () => {
    const r = await invoke(QUESTIONS, { query: { course_id: '67', kind: 'module_exam' } });
    expect(r.statusCode).toBe(200);
    expect(r.payload.scope).toBe('module_exam');
    expect(r.payload.title).toBe('Module 1 - Philosophical Foundations');
    expect(r.payload.questions.map((q) => [q.id, q.type])).toEqual([
      [800, 'mcq'], [801, 'mcq'], [802, 'crq'], [803, 'crq'],
    ]);
    // a picture-option question: presigned images, parallel to the options
    const pic = r.payload.questions.find((q) => q.id === 801);
    expect(pic.options).toEqual(['Option 1', 'Option 2']);
    expect(pic.option_image_urls).toEqual([
      `${R2}/opt1.png?X-Amz-Signature=signed`, `${R2}/opt2.png?X-Amz-Signature=signed`,
    ]);
    // stored order, every time: no per-attempt shuffle
    const again = await invoke(QUESTIONS, { query: { course_id: '67', kind: 'module_exam' } });
    expect(again.payload).toEqual(r.payload);
  });

  test('NO answer key, rubric or explanation anywhere in any question payload (deep scan)', async () => {
    const calls = [
      { module_id: '10' }, { level_id: '1' }, { level_id: '18' }, { course_id: '67', kind: 'module_exam' },
    ];
    for (const query of calls) {
      // eslint-disable-next-line no-await-in-loop
      const { payload } = await invoke(QUESTIONS, { query });
      const keys = deepKeys(payload);
      KEY_FIELDS.forEach((f) => expect(keys.has(f)).toBe(false));
      const text = JSON.stringify(payload);
      expect(text).not.toContain(SECRET_RUBRIC);
      expect(text).not.toContain(SECRET_EXPLAIN);
      // exactly the contract's keys on each question
      payload.questions.forEach((q) => {
        expect(Object.keys(q).sort()).toEqual(['id', 'image_url', 'option_image_urls', 'options', 'text', 'type']);
      });
    }
  });

  test('exactly one query form is required: none, two, or a stray course_id is 400', async () => {
    const bad = [
      {},
      { module_id: '10', level_id: '1' },
      { module_id: '10', course_id: '67', kind: 'module_exam' },
      { course_id: '67' },
      { course_id: '67', kind: 'something_else' },
      { kind: 'module_exam' },
      { module_id: 'abc' },
      { level_id: '1.5' },
    ];
    for (const query of bad) {
      // eslint-disable-next-line no-await-in-loop
      const r = await invoke(QUESTIONS, { query });
      expect(r.statusCode).toBe(400);
      expect(r.payload).toEqual({ error: 'bad_request' });
    }
  });

  test.each([
    ['unknown module', { module_id: '9999' }],
    ['inactive module', { module_id: '12' }],
    ['unknown level', { level_id: '9999' }],
    ['inactive level', { level_id: '3' }],
    ['a level with no level exam', { level_id: '2' }],
    ['unknown course', { course_id: '9999', kind: 'module_exam' }],
    ['a course with no module exam', { course_id: '68', kind: 'module_exam' }],
    ['a non-ISAPS course', { course_id: '1', kind: 'module_exam' }],
  ])('%s: 404 not_found', async (_label, query) => {
    const r = await invoke(QUESTIONS, { query });
    expect(r.statusCode).toBe(404);
    expect(r.payload).toEqual({ error: 'not_found' });
  });
});

describe('it never writes', () => {
  const FORBIDDEN_TABLES = [
    'training_assessment_attempts', 'training_assessment_answers', 'teacher_training_progress',
    'teacher_training_assignments', 'training_certificates', 'users',
  ];

  test('zero insert / update / upsert / delete across all four endpoints, success and failure paths alike', async () => {
    const everything = [
      ...ALL_CALLS,
      [LIB, { userId: TEACHER }],
      [MODULE, { params: { id: '9999' } }],
      [QUESTIONS, {}],
      [QUESTIONS, { level_id: '2' }],
    ];
    for (const [path, args] of everything) {
      // eslint-disable-next-line no-await-in-loop
      await invoke(path, args);
    }
    expect(writes).toEqual([]);
    expect(fake.queries.filter((q) => q.op !== 'select')).toEqual([]);
    FORBIDDEN_TABLES.forEach((t) => {
      expect(fake.queries.filter((q) => q.table === t && q.op !== 'select')).toEqual([]);
    });
  });

  test('the source holds no write call and reaches none of the gate modules', () => {
    const fs = require('fs');
    const path = require('path');
    const sources = ['routes/training-library.routes.js', 'services/training-library.service.js']
      .map((f) => fs.readFileSync(path.join(__dirname, '../../dashboard', f), 'utf8'));
    sources.forEach((src) => {
      expect(src).not.toMatch(/\.(insert|update|upsert|delete)\s*\(/);
      expect(src).not.toMatch(/training-rules\.service|TrainingRules|_filterLevelsByScopes|_assertLevelUnlocked|_assertModuleUnlocked|checkExamGateByLevel|servePaper|startModuleExam|openModuleExamAttempt/);
    });
  });
});

test('the router is mounted once, beside the other portal modules', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../dashboard/index.js'), 'utf8');
  expect(src.match(/training-library\.routes/g)).toHaveLength(1);
  expect(src).toMatch(/app\.use\('\/api\/portal',[^\n]*training-library\.routes/);
});
