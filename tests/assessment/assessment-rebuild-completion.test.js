/**
 * "Making your paper again — a few seconds", then nothing. (Staging, 6 Sep.)
 *
 * PICK_DONE is terminal, so its Footer CLOSES the review Flow rather than
 * calling the endpoint. `rebuildAndClose()` inside the endpoint is therefore
 * unreachable from the live path, and the completion handler only ever sent the
 * message — the paper was never rebuilt. The teacher waits for a document that
 * nothing is making.
 *
 * This is bd-60030 exactly, one screen along: that fix moved the NEW-paper
 * submit into the completion because CONFIRM is terminal too, and the same
 * reasoning was never carried to the rebuild.
 *
 * The test asserts the WORK happens, not that a string was sent — a message
 * asserting a rebuild is precisely what shipped broken.
 */
const path = require('path');

const ENDPOINT = path.join(__dirname, '../../bot/shared/routes/assessment-gen-endpoint');
const HANDLER = path.join(__dirname, '../../bot/shared/handlers/flow-response.handler');

const TOKEN = 'user-1:assessment-review:paper-9';

describe('a closed review Flow still rebuilds the paper', () => {
  let rerenderCalls;

  beforeEach(() => {
    jest.resetModules();
    rerenderCalls = [];
    jest.doMock(path.join(__dirname, '../../bot/shared/services/assessment/assessment-revision.service'), () => ({
      rerender: (args) => { rerenderCalls.push(args); return Promise.resolve({ status: 'ready', questionCount: 3, marks: 7 }); },
      listQuestions: () => Promise.resolve({ items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }),
      saveEdit: () => Promise.resolve({}),
      fileName: () => 'x.pdf',
      TEACHER_MESSAGE: {},
    }), { virtual: false });
  });

  afterEach(() => jest.resetModules());

  test('rebuildFromCompletion actually calls the renderer', async () => {
    const { rebuildFromCompletion } = require(ENDPOINT);
    const res = await rebuildFromCompletion({ flowToken: TOKEN, userId: 'user-1' });
    expect(rerenderCalls).toHaveLength(1);
    expect(rerenderCalls[0].paperId).toBe('paper-9');
    expect(res.status).toBe('rebuilt');
    expect(res.summary).toContain('3 questions');
  });

  test('a token with no paper id is refused rather than half-run', async () => {
    const { rebuildFromCompletion } = require(ENDPOINT);
    const res = await rebuildFromCompletion({ flowToken: 'user-1:assessment-gen:123', userId: 'user-1' });
    expect(res.status).toBe('failed');
    expect(rerenderCalls).toHaveLength(0);
  });

  test('the completion handler wires the rebuild in, not just the message', () => {
    // Source-level: the handler must REACH the rebuild on the 'rebuilt' branch.
    // Asserted here because the message alone is what shipped broken.
    const src = require('fs').readFileSync(`${HANDLER}.js`, 'utf8');
    const branch = src.slice(src.indexOf("if (action === 'rebuilt')"));
    expect(branch).toContain('rebuildFromCompletion');
    expect(branch.indexOf('rebuildFromCompletion'))
      .toBeLessThan(branch.indexOf('const MESSAGES'));
  });
});
