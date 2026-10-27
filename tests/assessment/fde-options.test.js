/**
 * POST /assessment/options tells the app a board pattern exists — and only when it should.
 *
 * Two keys are new: `patternGrades` (any call, flag on: lets the hub show the door from anywhere)
 * and `patterns` (only for a grade + subject the pattern holds). With the flag off, or for a pair
 * the pattern does not hold, both keys are ABSENT, so the JSON deep-equals what the form reads
 * today (the golden). A second setting, `assessment_fde_pattern_subjects`, narrows which subjects
 * may be offered without switching the whole pattern off.
 *
 * Driven through the real route stack with the settings table and the book catalogue mocked.
 */

const fs = require('fs');
const path = require('path');

const KEY = 'fde-options-key';
const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
let router;
let settings;

function findRoute(r, method, p) {
  for (const layer of r.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === p) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function invoke(p, body) {
  const stack = findRoute(router, 'post', p);
  const req = { headers: { 'x-api-key': KEY }, body, ip: '127.0.0.1', method: 'POST', path: p };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (!advanced) resolve();
    });
  }
  return { statusCode, payload };
}

/** app_settings answers from `settings` (key → value, or an Error to throw); every other read is empty. */
function query(table) {
  const filters = {};
  const b = {};
  ['select', 'neq', 'in', 'is', 'order', 'limit', 'gt', 'gte', 'lt', 'lte', 'filter', 'match'].forEach((m) => { b[m] = () => b; });
  b.eq = (col, val) => { filters[col] = val; return b; };
  b.maybeSingle = async () => {
    if (table !== 'app_settings') return { data: null, error: null };
    const v = settings[filters.key];
    if (v instanceof Error) throw v;
    return { data: v === undefined ? null : { key: filters.key, value: v }, error: null };
  };
  b.single = b.maybeSingle;
  b.then = (ok, ko) => Promise.resolve({ data: [], error: null }).then(ok, ko);
  return b;
}

beforeEach(() => {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = KEY;
  settings = {};
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => query(t)) }));
  const Real = jest.requireActual('../../bot/shared/services/assessment/assessment-browse.service');
  // The same catalogue the golden captured options against.
  jest.doMock('../../bot/shared/services/assessment/assessment-browse.service', () => ({
    ...Real,
    listGrades: jest.fn(async () => [1, 2, 3, 4, 5].map((g) => ({ grade: g, label: `Grade ${g}` }))),
    listSubjects: jest.fn(async (grade) => [
      { subject: 'english', label: 'English' }, { subject: 'urdu', label: 'Urdu' },
      { subject: 'maths', label: 'Mathematics' }, { subject: 'science', label: 'Science' },
      { subject: 'social_studies', label: 'Social Studies' }, { subject: 'islamiat', label: 'Islamiat' },
      { subject: 'general_knowledge', label: 'General Knowledge' },
    ].map((s) => ({ ...s, grade }))),
  }));
  router = require('../../bot/shared/routes/internal-api.routes');
});

afterEach(() => {
  delete process.env.INTERNAL_API_KEY;
  jest.resetModules();
});

const today = (name) => JSON.parse(fs.readFileSync(path.join(GOLDEN, name), 'utf8')).payload;
const FLAG = 'assessment_fde_pattern_enabled';
const SUBJECTS = 'assessment_fde_pattern_subjects';

describe('POST /assessment/options — the board pattern', () => {
  test('flag off → no patterns, no patternGrades (deep-equal today)', async () => {
    for (const [body, file] of [
      [{}, 'options.none.json'],
      [{ grade: 5, subject: 'maths' }, 'options.5.maths.json'],
      [{ grade: 5, subject: 'urdu' }, 'options.5.urdu.json'],
      [{ grade: 4, subject: 'maths' }, 'options.4.maths.json'],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const { statusCode, payload } = await invoke('/assessment/options', body);
      expect(statusCode).toBe(200);
      expect(payload).toEqual(today(file));
      expect(payload).not.toHaveProperty('patterns');
      expect(payload).not.toHaveProperty('patternGrades');
    }
  });

  test('a flag read that throws is off', async () => {
    settings[FLAG] = new Error('connection reset');
    const { payload } = await invoke('/assessment/options', { grade: 5, subject: 'maths' });
    expect(payload).toEqual(today('options.5.maths.json'));
  });

  test('flag on + G5 maths → patterns[0].id', async () => {
    settings[FLAG] = true;
    const { statusCode, payload } = await invoke('/assessment/options', { grade: 5, subject: 'maths' });
    expect(statusCode).toBe(200);
    expect(payload.patterns).toHaveLength(1);
    expect(payload.patterns[0].id).toBe('fde_g5_2027');
    expect(payload.patterns[0].generateTotal).toBe(48);
    expect(payload.patterns[0].totalMarks).toBe(100);
    expect(payload.patterns[0].scope.chapters).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 11, 12]);
    expect(payload.patternGrades).toEqual([1, 2, 5]);
    // Everything today's form reads is still there, unchanged.
    const { patterns, patternGrades, ...rest } = payload;
    expect(rest).toEqual(today('options.5.maths.json'));
  });

  test('flag on + G4 → absent', async () => {
    settings[FLAG] = 'true';
    const { payload } = await invoke('/assessment/options', { grade: 4, subject: 'maths' });
    expect(payload).not.toHaveProperty('patterns');
    expect(payload.patternGrades).toEqual([1, 2, 5]);
  });

  test('islamiat → absent', async () => {
    settings[FLAG] = true;
    const { payload } = await invoke('/assessment/options', { grade: 5, subject: 'islamiat' });
    expect(payload).not.toHaveProperty('patterns');
  });

  test('grade-level → patternGrades [1, 2, 5]', async () => {
    settings[FLAG] = true;
    for (const body of [{}, { grade: 5 }, { grade: 2 }]) {
      // eslint-disable-next-line no-await-in-loop
      const { payload } = await invoke('/assessment/options', body);
      expect(payload.patternGrades).toEqual([1, 2, 5]);
      expect(payload).not.toHaveProperty('patterns');
    }
  });

  test('list absent → all five eligible', async () => {
    settings[FLAG] = true;
    for (const subject of ['maths', 'science', 'english', 'urdu', 'social_studies']) {
      // eslint-disable-next-line no-await-in-loop
      const { payload } = await invoke('/assessment/options', { grade: 5, subject });
      expect(payload.patterns.map((p) => p.id)).toEqual(['fde_g5_2027']);
    }
  });

  test('subjects list excludes urdu → options has no patterns for urdu', async () => {
    settings[FLAG] = true;
    settings[SUBJECTS] = ['maths', 'science', 'english'];
    const urdu = await invoke('/assessment/options', { grade: 5, subject: 'urdu' });
    expect(urdu.payload).not.toHaveProperty('patterns');
    expect(urdu.payload.patternGrades).toEqual([1, 2, 5]);
    const maths = await invoke('/assessment/options', { grade: 5, subject: 'math' });
    expect(maths.payload.patterns[0].id).toBe('fde_g5_2027');
  });

  test('the subjects list may arrive as a JSON string; an unreadable one means all subjects', async () => {
    settings[FLAG] = true;
    settings[SUBJECTS] = '["science"]';
    expect((await invoke('/assessment/options', { grade: 5, subject: 'maths' })).payload).not.toHaveProperty('patterns');
    expect((await invoke('/assessment/options', { grade: 5, subject: 'science' })).payload.patterns).toHaveLength(1);
    settings[SUBJECTS] = 'not json';
    expect((await invoke('/assessment/options', { grade: 5, subject: 'maths' })).payload.patterns).toHaveLength(1);
  });

  test('an empty subjects list offers nothing — not even the door', async () => {
    settings[FLAG] = true;
    settings[SUBJECTS] = [];
    const { payload } = await invoke('/assessment/options', { grade: 5, subject: 'maths' });
    expect(payload).not.toHaveProperty('patterns');
    expect(payload).not.toHaveProperty('patternGrades');
  });
});
