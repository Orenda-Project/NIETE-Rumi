/**
 * bd-5jmnfj.38.29 — the portal's exam reads forward the session user to the bot.
 *
 * The bot's 6-12 grade gate admits by users.id (grade-gate.js isSixTwelveAdmitted), read off
 * body.userId. Without it every G6-12 grade, subject and chapter is hidden on the portal even for
 * a teacher app_settings `assessment_grades_6_12` admits. Create already sent it; options, chapters
 * and topics did not.
 *
 * Chain: the REAL portal router handler -> the REAL assessment.service -> axios (the only mock).
 */

// Not a suite about the sign-in account check: every session user reads as live (tests/fixtures/portal-auth-live.js).
require('../fixtures/portal-auth-live').installLivePortalAccounts();

const { setup, invoke, BOT } = require('./portal-proxy-harness');

const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';

let edges;
beforeEach(() => {
  jest.resetModules();
  edges = setup();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); jest.resetModules(); });

const sent = () => edges.axios.post.mock.calls[0][1];

describe('the session user reaches the bot on every exam read', () => {
  test('options (a 6-12 grade) sends userId from the session', async () => {
    edges.axios.post.mockResolvedValueOnce({ status: 200, data: { success: true, grades: [9] } });
    await invoke('get', '/assessment/options', { userId: TEACHER, query: { grade: '9', subject: 'physics' } });
    expect(edges.axios.post.mock.calls[0][0]).toBe(`${BOT}/api/internal/assessment/options`);
    expect(sent()).toEqual({ grade: 9, subject: 'physics', userId: TEACHER });
  });

  test('options with no grade picked yet still sends userId (the grade list is gated too)', async () => {
    edges.axios.post.mockResolvedValueOnce({ status: 200, data: { success: true, grades: [1, 2, 9] } });
    await invoke('get', '/assessment/options', { userId: TEACHER });
    expect(sent()).toEqual({ grade: null, subject: null, userId: TEACHER });
  });

  test('chapters sends userId from the session', async () => {
    edges.axios.post.mockResolvedValueOnce({ status: 200, data: { success: true, chapters: [] } });
    await invoke('get', '/assessment/chapters', { userId: TEACHER, query: { grade: '9', subject: 'physics' } });
    expect(edges.axios.post.mock.calls[0][0]).toBe(`${BOT}/api/internal/assessment/chapters`);
    expect(sent()).toEqual({ grade: 9, subject: 'physics', userId: TEACHER });
  });

  test('topics sends userId from the session', async () => {
    edges.axios.post.mockResolvedValueOnce({ status: 200, data: { success: true, topics: [] } });
    await invoke('get', '/assessment/topics', { userId: TEACHER, query: { grade: '9', subject: 'physics', chapter: '2' } });
    expect(edges.axios.post.mock.calls[0][0]).toBe(`${BOT}/api/internal/assessment/topics`);
    expect(sent()).toEqual({ grade: 9, subject: 'physics', chapterNumber: 2, userId: TEACHER });
  });

  test('a userId in the query is ignored: only the session says who she is', async () => {
    edges.axios.post.mockResolvedValueOnce({ status: 200, data: { success: true, chapters: [] } });
    await invoke('get', '/assessment/chapters', { userId: TEACHER, query: { grade: '9', subject: 'physics', userId: 'someone-else' } });
    expect(sent().userId).toBe(TEACHER);
  });
});

describe('Grades 1-5 are unchanged', () => {
  test('a G1-5 options read asks for the same grade and subject and answers the bot\'s reply as-is', async () => {
    const reply = { success: true, grades: [1, 2, 3, 4, 5], subjects: [{ subject_key: 'maths', subject: 'Maths' }], maxQuestions: 25 };
    edges.axios.post.mockResolvedValueOnce({ status: 200, data: reply });
    const { statusCode, payload } = await invoke('get', '/assessment/options', { userId: TEACHER, query: { grade: '4', subject: 'maths' } });
    expect(sent()).toMatchObject({ grade: 4, subject: 'maths' });
    expect(statusCode).toBe(200);
    expect(payload).toEqual(reply);
  });

  test('a caller with no user (grade-subjects catalogue) sends no userId key at all', async () => {
    edges.axios.post.mockResolvedValueOnce({ status: 200, data: { success: true, subjects: [] } });
    await require('../../dashboard/services/assessment.service').options({ grade: 4 });
    expect(JSON.parse(JSON.stringify(sent()))).toEqual({ grade: 4, subject: null });
  });
});
