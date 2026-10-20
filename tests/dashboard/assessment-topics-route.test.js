/**
 * Task 5 — GET /api/portal/assessment/topics?grade&subject&chapter: the topic picker's list.
 *
 * Chain: the REAL portal router handler -> the REAL assessment.service -> axios (the only mock),
 * which stands in for the bot's POST /api/internal/assessment/topics.
 */

const { setup, invoke, BOT } = require('./portal-proxy-harness');

const TOPICS = [
  { topicId: '1-maths-3-m-01-as-01', name: 'How many more?', heading: null, headingOrder: null, sortOrder: 1 },
  { topicId: '1-maths-3-m-01-as-07', name: 'Subtraction', heading: null, headingOrder: null, sortOrder: 6 },
];
const Q = { grade: '1', subject: 'maths', chapter: '3' };

let edges;
beforeEach(() => {
  jest.resetModules();
  edges = setup();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); jest.resetModules(); });

describe('GET /assessment/topics', () => {
  test('needs portal auth: no session, 401, the bot is never asked', async () => {
    const { statusCode } = await invoke('get', '/assessment/topics', { userId: null, query: Q });
    expect(statusCode).toBe(401);
    expect(edges.axios.post).not.toHaveBeenCalled();
  });

  test('asks the bot\'s /assessment/topics with grade, subject and chapterNumber as numbers', async () => {
    edges.axios.post.mockResolvedValueOnce({ status: 200, data: { success: true, topics: TOPICS } });
    const { statusCode, payload } = await invoke('get', '/assessment/topics', { query: Q });
    expect(edges.axios.post.mock.calls[0][0]).toBe(`${BOT}/api/internal/assessment/topics`);
    expect(edges.axios.post.mock.calls[0][1]).toEqual({ grade: 1, subject: 'maths', chapterNumber: 3 });
    expect(statusCode).toBe(200);
    expect(payload).toEqual({ success: true, topics: TOPICS });
  });

  test('an unloaded chapter gives topics: []', async () => {
    edges.axios.post.mockResolvedValueOnce({ status: 200, data: { success: true, topics: [] } });
    const { statusCode, payload } = await invoke('get', '/assessment/topics', { query: { ...Q, chapter: '9' } });
    expect(statusCode).toBe(200);
    expect(payload).toEqual({ success: true, topics: [] });
  });

  test('grade and chapter must be plain digits: 3abc, 1.5, -1 and blanks are 400s', async () => {
    for (const query of [{ ...Q, chapter: '3abc' }, { ...Q, grade: '1x' }, { ...Q, chapter: '1.5' }, { ...Q, grade: '-1' }, { ...Q, chapter: ' 3' }]) {
      // eslint-disable-next-line no-await-in-loop
      const { statusCode, payload } = await invoke('get', '/assessment/topics', { query });
      expect(statusCode).toBe(400);
      expect(payload).toEqual({ success: false, error: 'grade + subject + chapter required' });
    }
    expect(edges.axios.post).not.toHaveBeenCalled();
  });

  test('grade, subject and chapter are required', async () => {
    for (const query of [{ subject: 'maths', chapter: '3' }, { grade: '1', chapter: '3' }, { grade: '1', subject: 'maths' }]) {
      // eslint-disable-next-line no-await-in-loop
      const { statusCode, payload } = await invoke('get', '/assessment/topics', { query });
      expect(statusCode).toBe(400);
      expect(payload).toEqual({ success: false, error: 'grade + subject + chapter required' });
    }
    expect(edges.axios.post).not.toHaveBeenCalled();
  });

  test('a bot failure is a failure, never an empty list', async () => {
    edges.axios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const { statusCode, payload } = await invoke('get', '/assessment/topics', { query: Q });
    expect(statusCode).toBeGreaterThanOrEqual(500);
    expect(payload.success).toBe(false);
    expect(payload.topics).toBeUndefined();
  });
});
