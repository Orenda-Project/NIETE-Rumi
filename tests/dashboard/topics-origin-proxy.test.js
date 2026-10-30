/**
 * bd-6clakk.10 / bd-pw1ccr.1 — the portal proxy for POST /assessment/generate carries a topic paper's
 * `topicIds` and the report button's `origin` to the bot. Without topicIds the bot builds the whole chapter.
 * Absent (not null) when the app does not send them, so a plain request's payload is unchanged (fde-proxy golden).
 */

// Not a suite about the sign-in account check: every session user reads as live (tests/fixtures/portal-auth-live.js).
require('../fixtures/portal-auth-live').installLivePortalAccounts();

const { setup, invoke, BOT } = require('./portal-proxy-harness');

let axios;
beforeEach(() => {
  jest.resetModules();
  ({ axios } = setup());
  axios.post.mockResolvedValue({ status: 200, data: { success: true, requestId: 'r-1' } });
});
afterEach(() => jest.resetModules());

const BODY = {
  grade: 3, subject: 'english', chapterNumbers: [4], contentSource: 'unseen', questionCount: 6,
  questionTypes: [{ id: 'mcq', count: 6 }], answerLines: true, outputFormat: 'pdf',
};
const sent = () => JSON.parse(JSON.stringify(axios.post.mock.calls.find((c) => c[0] === `${BOT}/api/internal/assessment/create`)[1]));

test('topicIds reach the bot', async () => {
  const { statusCode } = await invoke('post', '/assessment/generate', { body: { ...BODY, topicIds: ['3-english-4-t1'] } });
  expect(statusCode).toBe(202);
  expect(sent().topicIds).toEqual(['3-english-4-t1']);
});

test("origin 'report' reaches the bot", async () => {
  await invoke('post', '/assessment/generate', { body: { ...BODY, origin: 'report' } });
  expect(sent().origin).toBe('report');
});

test('neither key is sent when the app sends neither', async () => {
  await invoke('post', '/assessment/generate', { body: BODY });
  expect('topicIds' in sent()).toBe(false);
  expect('origin' in sent()).toBe(false);
});
