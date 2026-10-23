/**
 * Task 5 — POST /api/internal/assessment/topics: one chapter's topics for the portal's topic picker.
 * Body { grade, subject, chapterNumber } -> { success, topics: [{topicId, name, heading, headingOrder, sortOrder}] }.
 * The repo is mocked; no database is touched.
 */
const KEY = 'shared-secret-key';
let router;
let listChapterTopics;
let topicsOn;

function findRoute(r, method, p) {
  for (const layer of r.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === p) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function invoke(p, body, key = KEY) {
  const stack = findRoute(router, 'post', p);
  const req = { headers: { 'x-api-key': key }, body, ip: '127.0.0.1', method: 'POST', path: p };
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

const TOPIC = {
  topicId: '1-maths-3-m-01-as-01', grade: 1, subject: 'maths', chapterNumber: 3, chapterTitle: 'Addition',
  name: 'How many more?', heading: 'Comparing', headingOrder: 1, sortOrder: 1, pages: [58, 59],
  sloCodes: ['M-01-AS-01'], sloDescriptions: ['I can compare numbers.'], days: [31], isCurrent: true,
};

beforeEach(() => {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = KEY;
  listChapterTopics = jest.fn(async () => [TOPIC]);
  topicsOn = jest.fn(async () => true);
  jest.doMock('../../../bot/shared/config/feature-flags', () => ({
    ...jest.requireActual('../../../bot/shared/config/feature-flags'),
    isAssessmentTopicCtaEnabled: topicsOn,
  }));
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
  jest.doMock('../../../bot/shared/services/assessment/topics/topics.repo', () => ({
    ...jest.requireActual('../../../bot/shared/services/assessment/topics/topics.repo'),
    listChapterTopics,
  }));
  router = require('../../../bot/shared/routes/internal-api.routes');
});

afterEach(() => {
  delete process.env.INTERNAL_API_KEY;
  jest.resetModules();
});

describe('POST /api/internal/assessment/topics', () => {
  test('is mounted', () => {
    expect(findRoute(router, 'post', '/assessment/topics')).not.toBeNull();
  });

  test('returns the chapter\'s topics: the five picker fields, no SLO codes or pages', async () => {
    const { statusCode, payload } = await invoke('/assessment/topics', { grade: '1', subject: 'maths', chapterNumber: '3' });
    expect(statusCode).toBe(200);
    expect(listChapterTopics).toHaveBeenCalledWith(1, 'maths', 3);
    expect(payload).toEqual({
      success: true,
      topics: [{ topicId: '1-maths-3-m-01-as-01', name: 'How many more?', heading: 'Comparing', headingOrder: 1, sortOrder: 1 }],
    });
  });

  test('a chapter with no topics loaded gives []', async () => {
    listChapterTopics.mockResolvedValueOnce([]);
    const { statusCode, payload } = await invoke('/assessment/topics', { grade: 5, subject: 'science', chapterNumber: 9 });
    expect(statusCode).toBe(200);
    expect(payload).toEqual({ success: true, topics: [] });
  });

  test('grade, subject and chapterNumber are each required', async () => {
    expect((await invoke('/assessment/topics', { subject: 'maths', chapterNumber: 3 })).payload)
      .toEqual({ success: false, error: 'grade is required' });
    expect((await invoke('/assessment/topics', { grade: 1, chapterNumber: 3 })).payload)
      .toEqual({ success: false, error: 'subject is required' });
    const r = await invoke('/assessment/topics', { grade: 1, subject: 'maths' });
    expect(r.statusCode).toBe(400);
    expect(r.payload).toEqual({ success: false, error: 'chapterNumber is required' });
    expect(listChapterTopics).not.toHaveBeenCalled();
  });

  test('a fractional grade or chapterNumber is a 400, not a rounded lookup', async () => {
    const frac = await invoke('/assessment/topics', { grade: 1, subject: 'maths', chapterNumber: 1.5 });
    expect(frac.statusCode).toBe(400);
    expect(frac.payload).toEqual({ success: false, error: 'chapterNumber is required' });
    const g = await invoke('/assessment/topics', { grade: 2.5, subject: 'maths', chapterNumber: 3 });
    expect(g.statusCode).toBe(400);
    expect(g.payload).toEqual({ success: false, error: 'grade is required' });
    expect(listChapterTopics).not.toHaveBeenCalled();
  });

  test('needs the internal key', async () => {
    const { statusCode } = await invoke('/assessment/topics', { grade: 1, subject: 'maths', chapterNumber: 3 }, 'wrong');
    expect(statusCode).toBe(401);
    expect(listChapterTopics).not.toHaveBeenCalled();
  });

  test('a read failure is the usual 500, not an empty list', async () => {
    listChapterTopics.mockRejectedValueOnce(new Error('relation does not exist'));
    const { statusCode, payload } = await invoke('/assessment/topics', { grade: 1, subject: 'maths', chapterNumber: 3 });
    expect(statusCode).toBe(500);
    expect(payload).toEqual({ success: false, error: 'Assessment lookup failed' });
  });
});

// bd-6clakk.9 — the same switch as the WhatsApp button hides the portal's Topics step: no topics → the step steps aside.
describe('the topics switch (assessment_topic_cta_enabled)', () => {
  test('off: [] for a chapter that has topics, and the table is never read', async () => {
    topicsOn.mockResolvedValueOnce(false);
    const { statusCode, payload } = await invoke('/assessment/topics', { grade: 1, subject: 'maths', chapterNumber: 3 });
    expect(statusCode).toBe(200);
    expect(payload).toEqual({ success: true, topics: [] });
    expect(listChapterTopics).not.toHaveBeenCalled();
  });

  test('a switch that cannot be read counts as off', async () => {
    topicsOn.mockRejectedValueOnce(new Error('app_settings down'));
    const { statusCode, payload } = await invoke('/assessment/topics', { grade: 1, subject: 'maths', chapterNumber: 3 });
    expect(statusCode).toBe(200);
    expect(payload).toEqual({ success: true, topics: [] });
    expect(listChapterTopics).not.toHaveBeenCalled();
  });

  test('a bad request is still a 400 with the switch off', async () => {
    topicsOn.mockResolvedValue(false);
    const r = await invoke('/assessment/topics', { grade: 1, subject: 'maths' });
    expect(r.statusCode).toBe(400);
  });
});
