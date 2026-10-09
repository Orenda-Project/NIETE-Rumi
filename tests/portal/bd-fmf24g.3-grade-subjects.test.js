/**
 * bd-fmf24g.3 — GET /api/portal/me/grade-subjects: her grade·subject pairs, for the picker every
 * teacher v2 feature opens with (Lesson Plans, Digital Coaching, Assessment, Attendance).
 *
 *   → { success, combos: [{ grade, gradeCode, subject, subjectKey, source: 'class'|'history' }] }
 *   ?feature=lessons|assessment adds, per pair, that catalogue's own key: { featureKey, available }
 *
 * What the tests hold it to:
 *   - her CLASSES first (class_teachers.grade_code × class_teacher_subjects.subject_code, read
 *     through the bot's /classes/list — the same read the My Classes page uses), in their order;
 *   - only when her classes give no pair: her HISTORY — lesson plans she used, DC lessons whose
 *     subject and grade were resolved, papers she made — newest first, one pair once;
 *   - one key per subject whatever the source spelled (math / Mathematics / maths);
 *   - the name in HER language (preferred_language; flat en/ur);
 *   - a class read that fails is a 502, never an empty list (that would read "you have no classes");
 *     one history source failing loses only that source, and is logged at error level;
 *   - the teacher is the SESSION's user; there is no id parameter.
 */

const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';

const S = () => require('../../dashboard/services/grade-subjects.service');

function deps(over = {}) {
  return {
    listClasses: jest.fn(async () => []),
    lpHistory: jest.fn(async () => []),
    coachingHistory: jest.fn(async () => []),
    assessmentHistory: jest.fn(async () => []),
    language: jest.fn(async () => 'en'),
    ...over,
  };
}

const CLASS_4A = {
  classId: 'c1', gradeCode: 'grade_4', section: 'A',
  subjects: [{ code: 'science', label: 'General Science' }, { code: 'maths', label: 'Mathematics' }],
};
const CLASS_5B = { classId: 'c2', gradeCode: 'grade_5', section: 'B', subjects: [{ code: 'maths', label: 'Mathematics' }] };

beforeEach(() => {
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
// A doMock outlives resetModules: every module any test below stubs is un-stubbed after each test,
// so the seam tests at the end run the REAL modules.
const STUBBED = ['lp-activity', 'lp-catalogue', 'lp612', 'assessment', 'grade-subjects']
  .map((m) => `../../dashboard/services/${m}.service`).concat('../../dashboard/config/database');
afterEach(() => {
  jest.restoreAllMocks();
  STUBBED.forEach((m) => jest.dontMock(m));
});

describe('from her classes', () => {
  test('each class × each of its subjects, in her class order, source class', async () => {
    const d = deps({ listClasses: jest.fn(async () => [CLASS_4A, CLASS_5B]) });
    const { combos } = await S().gradeSubjects(TEACHER, d);
    expect(combos).toEqual([
      { grade: 4, gradeCode: 'grade_4', subject: 'General Science', subjectKey: 'science', source: 'class' },
      { grade: 4, gradeCode: 'grade_4', subject: 'Mathematics', subjectKey: 'maths', source: 'class' },
      { grade: 5, gradeCode: 'grade_5', subject: 'Mathematics', subjectKey: 'maths', source: 'class' },
    ]);
    expect(d.listClasses).toHaveBeenCalledWith(TEACHER);
  });

  test('two sections of one grade and subject are ONE pair', async () => {
    const d = deps({ listClasses: jest.fn(async () => [CLASS_5B, { ...CLASS_5B, classId: 'c3', section: 'C' }]) });
    const { combos } = await S().gradeSubjects(TEACHER, d);
    expect(combos).toHaveLength(1);
  });

  test('history is NOT read when her classes give pairs', async () => {
    const d = deps({ listClasses: jest.fn(async () => [CLASS_4A]) });
    await S().gradeSubjects(TEACHER, d);
    expect(d.lpHistory).not.toHaveBeenCalled();
    expect(d.coachingHistory).not.toHaveBeenCalled();
    expect(d.assessmentHistory).not.toHaveBeenCalled();
  });

  test('her language: an Urdu teacher reads Urdu names', async () => {
    const d = deps({ listClasses: jest.fn(async () => [CLASS_4A]), language: jest.fn(async () => 'ur') });
    const { combos } = await S().gradeSubjects(TEACHER, d);
    expect(combos.map((c) => c.subject)).toEqual(['سائنس', 'ریاضی']);
    expect(combos.map((c) => c.subjectKey)).toEqual(['science', 'maths']);
  });

  test('early years and an unlisted subject are kept, never dropped', async () => {
    const d = deps({ listClasses: jest.fn(async () => [
      { classId: 'k', gradeCode: 'early_years', subjects: [{ code: 'english', label: 'English' }] },
      { classId: 'c', gradeCode: 'grade_3', subjects: [{ code: 'drawing', label: 'drawing' }] },
    ]) });
    const { combos } = await S().gradeSubjects(TEACHER, d);
    expect(combos).toEqual([
      { grade: null, gradeCode: 'early_years', subject: 'English', subjectKey: 'english', source: 'class' },
      { grade: 3, gradeCode: 'grade_3', subject: 'Drawing', subjectKey: 'drawing', source: 'class' },
    ]);
  });

  test('a failed class read THROWS — "no classes" is not an answer we know', async () => {
    const d = deps({ listClasses: jest.fn(async () => { throw new Error('bot down'); }) });
    await expect(S().gradeSubjects(TEACHER, d)).rejects.toThrow('bot down');
  });
});

describe('from her history, when her classes give no pair', () => {
  test('lesson plans, DC lessons and papers, newest first, one pair once, source history', async () => {
    const d = deps({
      listClasses: jest.fn(async () => [{ classId: 'c', gradeCode: 'grade_4', subjects: [] }]),
      lpHistory: jest.fn(async () => [
        { grade: 4, subject: 'General Science', at: '2026-10-07T05:00:00Z' },
        { grade: 9, subject: 'Mathematics', at: '2026-10-01T05:00:00Z' },
      ]),
      coachingHistory: jest.fn(async () => [
        { grade: '4', subject: 'science', at: '2026-10-08T05:00:00Z' },
        { grade: '3', subject: 'english', at: '2026-09-20T05:00:00Z' },
      ]),
      assessmentHistory: jest.fn(async () => [
        { grade: 9, subject: 'maths', at: '2026-10-05T05:00:00Z' },
      ]),
    });
    const { combos } = await S().gradeSubjects(TEACHER, d);
    expect(combos).toEqual([
      { grade: 4, gradeCode: 'grade_4', subject: 'General Science', subjectKey: 'science', source: 'history' },
      { grade: 9, gradeCode: 'grade_9', subject: 'Mathematics', subjectKey: 'maths', source: 'history' },
      { grade: 3, gradeCode: 'grade_3', subject: 'English', subjectKey: 'english', source: 'history' },
    ]);
  });

  test('a row with no usable grade or subject is skipped', async () => {
    const d = deps({
      lpHistory: jest.fn(async () => [
        { grade: null, subject: 'Math', at: '2026-10-07T05:00:00Z' },
        { grade: 4, subject: null, at: '2026-10-06T05:00:00Z' },
        { grade: 5, subject: 'Math', at: '2026-10-05T05:00:00Z' },
      ]),
    });
    const { combos } = await S().gradeSubjects(TEACHER, d);
    expect(combos.map((c) => `${c.grade}:${c.subjectKey}`)).toEqual(['5:maths']);
  });

  test('one source failing loses only that source, logged at error level', async () => {
    const d = deps({
      lpHistory: jest.fn(async () => { throw new Error('describe down'); }),
      assessmentHistory: jest.fn(async () => [{ grade: 4, subject: 'maths', at: '2026-10-05T05:00:00Z' }]),
    });
    const { combos } = await S().gradeSubjects(TEACHER, d);
    expect(combos.map((c) => `${c.grade}:${c.subjectKey}`)).toEqual(['4:maths']);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('grade-subjects'), expect.objectContaining({ source: 'lessons' }));
  });

  test('no classes and no history: an empty list', async () => {
    const { combos } = await S().gradeSubjects(TEACHER, deps());
    expect(combos).toEqual([]);
  });
});

describe('?feature= — that catalogue\'s own key per pair', () => {
  const COMBOS = [
    { grade: 4, gradeCode: 'grade_4', subject: 'Mathematics', subjectKey: 'maths', source: 'class' },
    { grade: 4, gradeCode: 'grade_4', subject: 'Social Studies', subjectKey: 'social_studies', source: 'class' },
    { grade: 9, gradeCode: 'grade_9', subject: 'Mathematics', subjectKey: 'maths', source: 'class' },
    { grade: null, gradeCode: 'early_years', subject: 'English', subjectKey: 'english', source: 'class' },
  ];

  test('lessons: K-5 subject_key and 6-12 corpus name; a subject with no plans is not available', async () => {
    const catalogue = jest.fn(async (grade) => (grade === 4
      ? [{ key: 'math', name: 'Math' }, { key: 'english', name: 'English' }]
      : [{ key: 'Mathematics', name: 'Mathematics' }]));
    const out = await S().withFeatureKeys(COMBOS, catalogue);
    expect(out.map((c) => [c.featureKey, c.available])).toEqual([
      ['math', true], [null, false], ['Mathematics', true], [null, false],
    ]);
    // one catalogue read per grade, none for early years
    expect(catalogue.mock.calls.map((c) => c[0]).sort()).toEqual([4, 9]);
  });

  test('a catalogue read that fails throws (the picker cannot open anything without the keys)', async () => {
    const catalogue = jest.fn(async () => { throw new Error('catalogue down'); });
    await expect(S().withFeatureKeys(COMBOS, catalogue)).rejects.toThrow('catalogue down');
  });
});

/* ── the route ─────────────────────────────────────────────────────────── */

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function invoke(path, { userId = TEACHER, query = {} } = {}) {
  const router = require('../../dashboard/routes/portal-teacher-lessons.routes');
  const stack = findRoute(router, 'get', path);
  if (!stack) throw new Error(`Route GET ${path} not found`);
  const req = { session: userId ? { portalUserId: userId } : null, query, params: {}, method: 'GET', path, headers: {}, get: () => undefined };
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

describe('GET /me/grade-subjects', () => {
  let svc;
  beforeEach(() => {
    svc = {
      gradeSubjects: jest.fn(async () => ({ combos: [{ grade: 4, gradeCode: 'grade_4', subject: 'Mathematics', subjectKey: 'maths', source: 'class' }] })),
      withFeatureKeys: jest.fn(async (combos) => combos.map((c) => ({ ...c, featureKey: 'math', available: true }))),
      catalogueFor: jest.fn(() => jest.fn()),
      defaultDeps: jest.fn(() => ({})),
      FEATURES: ['lessons', 'assessment'],
    };
    jest.doMock('../../dashboard/services/grade-subjects.service', () => svc);
    jest.doMock('../../dashboard/config/database', () => ({ query: jest.fn() }));
  });

  test('signed out: 401, nothing read', async () => {
    const { statusCode } = await invoke('/me/grade-subjects', { userId: null });
    expect(statusCode).toBe(401);
    expect(svc.gradeSubjects).not.toHaveBeenCalled();
  });

  test('the SESSION\'s teacher; no feature → pairs only', async () => {
    const { statusCode, payload } = await invoke('/me/grade-subjects');
    expect(statusCode).toBe(200);
    expect(svc.gradeSubjects).toHaveBeenCalledWith(TEACHER, expect.anything());
    expect(svc.withFeatureKeys).not.toHaveBeenCalled();
    expect(payload).toEqual({ success: true, combos: [expect.objectContaining({ subjectKey: 'maths', source: 'class' })] });
  });

  test('?feature=lessons adds the lesson-plan keys', async () => {
    const { payload } = await invoke('/me/grade-subjects', { query: { feature: 'lessons' } });
    expect(svc.catalogueFor).toHaveBeenCalledWith('lessons');
    expect(payload.combos[0]).toEqual(expect.objectContaining({ featureKey: 'math', available: true }));
  });

  test('an unknown feature is a 400 she (the client) can fix', async () => {
    const { statusCode } = await invoke('/me/grade-subjects', { query: { feature: 'cooking' } });
    expect(statusCode).toBe(400);
  });

  test('her classes unreadable: 502, never an empty list', async () => {
    svc.gradeSubjects.mockRejectedValueOnce(new Error('bot down'));
    const { statusCode, payload } = await invoke('/me/grade-subjects');
    expect(statusCode).toBe(502);
    expect(payload.success).toBe(false);
  });
});

/* ── the real sources: field names and calls ──────────────────────────────── */

describe('defaultDeps — what each source is asked and which fields are read', () => {
  let plansUsed; let describePlans; let listPapers; let query;
  beforeEach(() => {
    plansUsed = jest.fn(async () => [{ grade: 4, subject: 'Science', lastUsedAt: '2026-10-07T05:00:00.000Z', title: 'x' }]);
    describePlans = jest.fn();
    listPapers = jest.fn(async () => ({ papers: [{ grade: 5, subject_key: 'maths', subject: 'Maths', ready_at: '2026-10-02T05:00:00Z' }] }));
    jest.doMock('../../dashboard/services/lp-activity.service', () => ({ plansUsed }));
    jest.doMock('../../dashboard/services/lp-catalogue.service', () => ({ describePlans }));
    jest.doMock('../../dashboard/services/assessment.service', () => ({ listPapers }));
    query = jest.fn(async () => ({ rows: [] }));
  });

  test('lesson plans: her plans used, all time, at most 50, named by the bot', async () => {
    const out = await S().defaultDeps(query).lpHistory(TEACHER);
    expect(plansUsed).toHaveBeenCalledWith(query, TEACHER, { limit: 50, describe: describePlans });
    expect(out).toEqual([{ grade: 4, subject: 'Science', at: '2026-10-07T05:00:00.000Z' }]);
  });

  test('Digital Coaching: resolved grade + code only, hers, newest first', async () => {
    query.mockResolvedValueOnce({ rows: [{ at: '2026-10-01T00:00:00Z', grade: '1', subject: 'english' }] });
    const out = await S().defaultDeps(query).coachingHistory(TEACHER);
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual([TEACHER, 50]);
    expect(sql).toMatch(/FROM coaching_sessions/);
    expect(sql).toMatch(/user_id = \$1::uuid/);
    expect(sql).toMatch(/subject_resolution'->>'code' IS NOT NULL/);
    expect(sql).toMatch(/subject_resolution'->>'grade' IS NOT NULL/);
    expect(sql).toMatch(/ORDER BY created_at DESC/);
    expect(out).toEqual([{ at: '2026-10-01T00:00:00Z', grade: '1', subject: 'english' }]);
  });

  test('papers: her ready papers, subject_key (not the printed label), ready_at', async () => {
    const out = await S().defaultDeps(query).assessmentHistory(TEACHER);
    expect(listPapers).toHaveBeenCalledWith(TEACHER, { pageSize: 50 });
    expect(out).toEqual([{ grade: 5, subject: 'maths', at: '2026-10-02T05:00:00Z' }]);
  });

  test.each([['ur', 'ur'], ['en', 'en'], [null, 'en'], ['sw', 'en']])('language %j → %s', async (stored, lang) => {
    query.mockResolvedValueOnce({ rows: [{ preferred_language: stored }] });
    expect(await S().defaultDeps(query).language(TEACHER)).toBe(lang);
    expect(query.mock.calls[0][0]).toMatch(/SELECT preferred_language FROM users WHERE id = \$1::uuid/);
  });

  test('language unreadable → the English floor, logged', async () => {
    query.mockRejectedValueOnce(new Error('pool'));
    expect(await S().defaultDeps(query).language(TEACHER)).toBe('en');
    expect(console.error).toHaveBeenCalled();
  });

  describe('her classes, from the bot', () => {
    let axios;
    const env = { ...process.env };
    beforeEach(() => {
      // After the top-level resetModules, so the service's lazy require gets this same instance.
      axios = require('axios');
      process.env.MAIN_BOT_URL = 'https://bot.test/';
      process.env.INTERNAL_API_KEY = 'k';
      axios.post.mockReset();
    });
    afterAll(() => { process.env = env; });

    test('POSTs /api/internal/classes/list with her id and the internal key', async () => {
      axios.post.mockResolvedValueOnce({ status: 200, data: { success: true, classes: [CLASS_4A] } });
      const out = await S().defaultDeps(query).listClasses(TEACHER);
      expect(axios.post).toHaveBeenCalledWith('https://bot.test/api/internal/classes/list', { userId: TEACHER },
        expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'k' }) }));
      expect(out).toEqual([CLASS_4A]);
    });

    test('a bot failure throws', async () => {
      axios.post.mockResolvedValueOnce({ status: 500, data: { success: false } });
      await expect(S().defaultDeps(query).listClasses(TEACHER)).rejects.toThrow();
    });

    test('not configured throws', async () => {
      delete process.env.MAIN_BOT_URL;
      await expect(S().defaultDeps(query).listClasses(TEACHER)).rejects.toThrow(/not configured/);
    });
  });
});

describe('catalogueFor — each feature\'s catalogue as grade → [{ key, name }]', () => {
  test('lessons: the grade lists pick the service; K-5 gives subject_key, 6-12 the corpus name', async () => {
    const LpCatalogue = {
      listGrades: jest.fn(async () => [{ grade: 4, subject_count: 4 }]),
      listSubjects: jest.fn(async () => [{ subject_key: 'math', subject: 'Math', rtl: false, lesson_count: 80 }]),
    };
    const Lp612 = {
      listGrades: jest.fn(async () => [{ grade: 9 }]),
      listSubjects: jest.fn(async () => [{ subject: 'Mathematics', lesson_count: 40 }]),
    };
    jest.doMock('../../dashboard/services/lp-catalogue.service', () => LpCatalogue);
    jest.doMock('../../dashboard/services/lp612.service', () => Lp612);
    const cat = S().catalogueFor('lessons');
    expect(await cat(4)).toEqual([{ key: 'math', name: 'Math' }]);
    expect(await cat(9)).toEqual([{ key: 'Mathematics', name: 'Mathematics' }]);
    expect(await cat(2)).toEqual([]);
    expect(LpCatalogue.listGrades).toHaveBeenCalledTimes(1);
    expect(Lp612.listGrades).toHaveBeenCalledTimes(1);
    expect(LpCatalogue.listSubjects).toHaveBeenCalledWith(4);
    expect(Lp612.listSubjects).toHaveBeenCalledWith(9);
  });

  test('lessons: one grade list down still answers from the other; both down throws', async () => {
    jest.doMock('../../dashboard/services/lp-catalogue.service', () => ({
      listGrades: jest.fn(async () => { throw new Error('k5 down'); }), listSubjects: jest.fn(),
    }));
    jest.doMock('../../dashboard/services/lp612.service', () => ({
      listGrades: jest.fn(async () => [{ grade: 9 }]), listSubjects: jest.fn(async () => [{ subject: 'Physics' }]),
    }));
    expect(await S().catalogueFor('lessons')(9)).toEqual([{ key: 'Physics', name: 'Physics' }]);

    jest.resetModules();
    jest.doMock('../../dashboard/services/lp-catalogue.service', () => ({ listGrades: jest.fn(async () => { throw new Error('a'); }) }));
    jest.doMock('../../dashboard/services/lp612.service', () => ({ listGrades: jest.fn(async () => { throw new Error('b'); }) }));
    await expect(S().catalogueFor('lessons')(9)).rejects.toThrow('a');
  });

  test('assessment: the options call\'s subjects, by subject_key', async () => {
    const options = jest.fn(async () => ({ subjects: [{ subject_key: 'maths', subject: 'Maths' }] }));
    jest.doMock('../../dashboard/services/assessment.service', () => ({ options }));
    expect(await S().catalogueFor('assessment')(4)).toEqual([{ key: 'maths', name: 'Maths' }]);
    expect(options).toHaveBeenCalledWith({ grade: 4 });
  });
});

/* ── Class O: the seams, with the REAL collaborators (mocked only at the network / pool) ── */

describe('seams — field names as the real modules return them', () => {
  test('lesson plans: real lp-activity, real namePlans shape', async () => {
    const query = jest.fn(async () => ({ rows: [{
      kind: 'k5', ref: 'grade_4_general_science_ch1_seg2', lang: null,
      last_used_at: '2026-10-07T05:00:00.000Z', last_opened_at: '2026-10-07T05:00:00.000Z', last_received_at: null,
    }] }));
    const describe = jest.fn(async () => [{ kind: 'k5', ref: 'grade_4_general_science_ch1_seg2', lang: null, found: true,
      title: 'Plants', grade: 4, subject: 'General Science', chapterNumber: 1 }]);
    jest.doMock('../../dashboard/services/lp-catalogue.service', () => ({ describePlans: describe }));
    const out = await S().defaultDeps(query).lpHistory(TEACHER);
    expect(out).toEqual([{ grade: 4, subject: 'General Science', at: '2026-10-07T05:00:00.000Z' }]);
  });

  test('papers: real assessment.service over the bot\'s papers shape', async () => {
    process.env.MAIN_BOT_URL = 'https://bot.test';
    process.env.INTERNAL_API_KEY = 'k';
    const axios = require('axios');
    axios.post.mockReset();
    axios.post.mockResolvedValueOnce({ status: 200, data: { success: true, total: 1, papers: [
      { paper_id: 'p1', grade: 5, subject_key: 'maths', subject: 'Maths', chapter_number: 3, ready_at: '2026-10-02T05:00:00Z' },
    ] } });
    const out = await S().defaultDeps(jest.fn()).assessmentHistory(TEACHER);
    expect(axios.post.mock.calls[0][0]).toBe('https://bot.test/api/internal/assessment/papers');
    expect(out).toEqual([{ grade: 5, subject: 'maths', at: '2026-10-02T05:00:00Z' }]);
  });
});
