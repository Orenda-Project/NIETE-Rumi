/**
 * Golden fixtures: what the generator produces TODAY for a paper that asks for no board pattern.
 *
 * Board-pattern papers are being built on top of this generator, behind a flag, and the promise
 * to every teacher already using it is that their paper does not change. These tests are that
 * promise in executable form. Each one pins an output a teacher's paper depends on, byte for byte:
 *
 *   system prompt     buildSystemPrompt for all seven subjects
 *   user prompt       buildUserPrompt for unseen / seen / both / a marks budget
 *   paper + key HTML  renderPaper / renderAnswerKey for a Maths, a Science and an Urdu paper
 *   request payload   the request row and the queued job createAndQueue writes
 *   options JSON      POST /assessment/options for every grade and subject, and with no subject
 *
 * The inputs are fictional (fixtures/golden/exam.*.json) and cover every question shape the
 * renderer knows: options, columns, word lists, passages with sub-questions, a passage answered
 * on the passage, a nested Long Question, a bare string, a removed question, a missing answer and
 * text that must be escaped.
 *
 * The fonts are embedded in the HTML as base64 (several MB). The stored HTML replaces each font
 * payload with its SHA-256, so the files stay readable while the comparison stays exact: a changed
 * font changes the digest, and every other byte is compared as it is.
 *
 * Re-capturing is a decision, not a fix for a red test. A change that alters one of these outputs
 * on purpose re-captures with UPDATE_GOLDEN=1 in the same commit and shows the diff in its PR.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: jest.fn() } } }),
}));

const DIR = path.join(__dirname, 'fixtures', 'golden');
const UPDATE = process.env.UPDATE_GOLDEN === '1';

/** Each embedded font payload replaced by its digest; every other byte untouched. */
function withFontDigests(html) {
  return html.replace(/base64,([A-Za-z0-9+/=]+)/g,
    (_, data) => `base64,<sha256:${crypto.createHash('sha256').update(data).digest('hex')}>`);
}

/** The first line that differs, with its neighbours, so a red golden says where. */
function firstDifference(actual, expected) {
  const a = actual.split('\n');
  const e = expected.split('\n');
  for (let i = 0; i < Math.max(a.length, e.length); i += 1) {
    if (a[i] !== e[i]) {
      return `line ${i + 1}\n  expected: ${JSON.stringify(e[i])}\n  actual:   ${JSON.stringify(a[i])}`;
    }
  }
  return null;
}

function golden(name, actual) {
  const file = path.join(DIR, name);
  if (UPDATE) fs.writeFileSync(file, actual);
  if (!fs.existsSync(file)) throw new Error(`no golden ${name}: capture it with UPDATE_GOLDEN=1`);
  const expected = fs.readFileSync(file, 'utf8');
  if (actual !== expected) {
    throw new Error(`${name} differs from its golden at ${firstDifference(actual, expected)}`);
  }
}

const json = (v) => `${JSON.stringify(v, null, 2)}\n`;
const exam = (subject) => JSON.parse(fs.readFileSync(path.join(DIR, `exam.${subject}.json`), 'utf8'));

describe('golden: prompts', () => {
  const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');

  const SUBJECTS = ['english', 'urdu', 'maths', 'science', 'social_studies', 'islamiat', 'general_knowledge'];
  test.each(SUBJECTS)('system prompt for %s', (subject) => {
    golden(`system-prompt.${subject}.txt`, Gen.buildSystemPrompt({ subject, includeAnswerKey: true }));
  });

  const PAGE = '=== Page 12 ===\nFractions\nA fraction names a part of a whole.\n=== Page 13 ===\nEquivalent fractions name the same part.';
  // None of these asks for Mind Map, Flow Chart or Graphs & Geometric Problems: those three get a
  // drawing instruction of their own, and every other prompt must stay as it is.
  const CASES = {
    unseen: {
      grade: 5, subject: 'maths', pageContent: PAGE, pageReference: '12-13', contentSource: 'unseen', questionCount: 10,
      questionTypes: [
        { id: 'MCQs', count: 5, category: 'objective' },
        { id: 'Short Questions', count: 3, category: 'subjective' },
        { id: 'Word Problems', count: 2, category: 'subjective' },
      ],
    },
    seen: {
      grade: 4, subject: 'english', pageContent: PAGE, pageReference: '12-13', contentSource: 'seen', questionCount: 8,
      questionTypes: [],
    },
    both: {
      grade: 5, subject: 'science', pageContent: PAGE, pageReference: '12-13', contentSource: 'both', questionCount: 10,
      seenCount: 4,
      questionTypes: [
        { id: 'MCQs', count: 4, category: 'objective' },
        { id: 'Brief Answers', count: 2, category: 'subjective' },
      ],
    },
    budget: {
      grade: 5, subject: 'urdu', pageContent: PAGE, pageReference: '12-13', contentSource: 'unseen', questionCount: 7,
      totalMarks: 40,
      questionTypes: [
        { id: 'MCQs', count: 6, category: 'objective' },
        { id: 'Essay Writing', count: 1, category: 'subjective' },
      ],
    },
  };
  test.each(Object.keys(CASES))('user prompt: %s', (name) => {
    golden(`user-prompt.${name}.txt`, Gen.buildUserPrompt(CASES[name]));
  });
});

describe('golden: the printed paper and its key', () => {
  const Renderer = require('../../bot/shared/services/assessment/assessment-paper.renderer');

  const PAPERS = {
    maths: { grade: 5, subject: 'maths', schoolName: 'Model School Example', pageReference: '12-40', chapterTitle: 'Fractions' },
    science: { grade: 5, subject: 'science', schoolName: null, pageReference: '5-30', chapterTitle: null },
    urdu: { grade: 5, subject: 'urdu', schoolName: 'Model School Example', pageReference: '28-60', chapterTitle: 'Our Garden' },
  };

  test.each(Object.keys(PAPERS))('paper: %s', (subject) => {
    const html = Renderer.renderPaper({ examJson: exam(subject), ...PAPERS[subject], answerLines: true });
    golden(`paper.${subject}.html`, withFontDigests(html));
  });

  test.each(Object.keys(PAPERS))('answer key: %s', (subject) => {
    const html = Renderer.renderAnswerKey({ examJson: exam(subject), ...PAPERS[subject] });
    golden(`key.${subject}.html`, withFontDigests(html));
  });
});

describe('golden: the request a paper makes', () => {
  test('createAndQueue writes this row and queues this job', async () => {
    jest.resetModules();
    const writes = [];
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../bot/shared/config/supabase', () => ({
      from: (table) => {
        const b = {
          insert: (row) => { writes.push({ table, row }); return b; },
          select: () => b,
          single: async () => ({ data: { id: 'request-golden-1' }, error: null }),
        };
        return b;
      },
    }));
    const queued = [];
    jest.doMock('../../bot/shared/services/queue', () => ({
      queueJob: jest.fn(async (...args) => { queued.push(args); return { messageId: 'm-1' }; }),
    }));
    const AssessmentRequest = require('../../bot/shared/services/assessment/assessment-request.service');

    const out = await AssessmentRequest.createAndQueue({
      userId: 'teacher-golden-1', surface: 'portal', grade: 5, subject: 'maths', textbookId: 'book-golden-1',
      chapterNumber: null, chapterNumbers: [2, 3], pageRanges: '12-40', contentSource: 'unseen',
      questionCount: 10, totalMarks: null, seenCount: null,
      questionTypes: [{ id: 'MCQs', count: 6, category: 'objective' }, { id: 'Short Questions', count: 4, category: 'subjective' }],
      answerLines: true, outputFormat: 'pdf',
    });

    golden('request-payload.json', json({ returned: out, writes, queued }));
  });
});

describe('golden: POST /assessment/options', () => {
  const KEY = 'golden-internal-key';
  let router;

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

  // Every settings read answers "no such row", which is how an absent flag reads on every tier.
  const emptyQuery = () => {
    const b = {};
    ['select', 'eq', 'neq', 'in', 'is', 'order', 'limit', 'gt', 'gte', 'lt', 'lte', 'filter', 'match'].forEach((m) => { b[m] = () => b; });
    b.maybeSingle = async () => ({ data: null, error: null });
    b.single = async () => ({ data: null, error: null });
    b.then = (ok, ko) => Promise.resolve({ data: [], error: null }).then(ok, ko);
    return b;
  };

  beforeAll(() => {
    jest.resetModules();
    process.env.INTERNAL_API_KEY = KEY;
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn(() => emptyQuery()) }));
    const Real = jest.requireActual('../../bot/shared/services/assessment/assessment-browse.service');
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

  afterAll(() => {
    delete process.env.INTERNAL_API_KEY;
    jest.resetModules();
  });

  test('with no grade', async () => {
    const { statusCode, payload } = await invoke('/assessment/options', {});
    golden('options.none.json', json({ statusCode, payload }));
  });

  const GRID = [];
  [1, 2, 3, 4, 5].forEach((grade) => ['english', 'urdu', 'maths', 'science', 'social_studies', 'islamiat', 'general_knowledge']
    .forEach((subject) => GRID.push([grade, subject])));
  test.each(GRID)('grade %i %s', async (grade, subject) => {
    const { statusCode, payload } = await invoke('/assessment/options', { grade, subject });
    golden(`options.${grade}.${subject}.json`, json({ statusCode, payload }));
  });
});
