/**
 * The portal proxy for POST /assessment/generate, for the FDE board-pattern paper.
 *
 * The bot owns every rule; the proxy only carries fields and answers through. Three things change:
 *   1. `pattern` and `scope` reach the bot when the app sends them — and are ABSENT (not null) when it
 *      does not, so a plain request's payload is byte-identical to today's (golden below).
 *   2. A 400 carries the bot's `errorCode`, so the app can say which real thing went wrong.
 *   3. A 409 ALREADY_GENERATING passes through as a 409 with its body, not as "something went wrong".
 *
 * Chain under test: the real router handler → the real assessment.service → axios (the network
 * boundary, the only mock that matters here).
 */

const { setup, invoke, BOT } = require('./portal-proxy-harness');

let axios;
beforeEach(() => {
  jest.resetModules();
  ({ axios } = setup());
});

afterEach(() => jest.resetModules());

/** What today's app sends for a plain chapter paper. */
const PLAIN_BODY = {
  grade: 5, subject: 'maths', chapterNumbers: [3, 4], contentSource: 'unseen', questionCount: 20,
  questionTypes: [{ type: 'mcq', count: 10 }, { type: 'short', count: 10 }], answerLines: true, outputFormat: 'pdf',
};

/**
 * GOLDEN — the stringified payload the bot received for PLAIN_BODY on origin/sandbox before this change
 * (captured from the unchanged handler; key order is part of the contract a byte comparison checks).
 */
const PLAIN_PAYLOAD_GOLDEN = '{"userId":"teacher-1","grade":5,"subject":"maths","chapterNumber":null,"chapterNumbers":[3,4],"pageRanges":null,"contentSource":"unseen","questionCount":20,"seenCount":null,"totalMarks":null,"questionTypes":[{"type":"mcq","count":10},{"type":"short","count":10}],"answerLines":true,"outputFormat":"pdf"}';

const sentToBot = () => {
  const call = axios.post.mock.calls.find((c) => c[0] === `${BOT}/api/internal/assessment/create`);
  return call && call[1];
};

describe('the generate proxy carries the board pattern', () => {
  test('golden: a plain request reaches the bot byte-identical to today', async () => {
    axios.post.mockResolvedValueOnce({ status: 200, data: { success: true, requestId: 'r-1' } });
    const { statusCode, payload } = await invoke('post', '/assessment/generate', { body: PLAIN_BODY });
    expect(statusCode).toBe(202);
    expect(payload).toEqual({ success: true, requestId: 'r-1' });
    expect(JSON.stringify(sentToBot())).toBe(PLAIN_PAYLOAD_GOLDEN);
    expect(Object.prototype.hasOwnProperty.call(sentToBot(), 'pattern') && sentToBot().pattern !== undefined).toBe(false);
  });

  test('pattern and scope reach the bot when the app sends them', async () => {
    axios.post.mockResolvedValueOnce({ status: 200, data: { success: true, requestId: 'r-2' } });
    const body = { grade: 5, subject: 'maths', pattern: 'fde_g5_2027', scope: 'fde', questionCount: 0,
      contentSource: 'unseen', seenCount: null, questionTypes: [], answerLines: true, outputFormat: 'pdf' };
    const { statusCode } = await invoke('post', '/assessment/generate', { body });
    expect(statusCode).toBe(202);
    expect(sentToBot()).toMatchObject({ pattern: 'fde_g5_2027', scope: 'fde', userId: 'teacher-1' });
  });

  test('a chapter-scoped pattern request carries the pattern and no scope', async () => {
    axios.post.mockResolvedValueOnce({ status: 200, data: { success: true, requestId: 'r-3' } });
    await invoke('post', '/assessment/generate', { body: { ...PLAIN_BODY, pattern: 'fde_g5_2027' } });
    const sent = JSON.parse(JSON.stringify(sentToBot()));
    expect(sent.pattern).toBe('fde_g5_2027');
    expect('scope' in sent).toBe(false);
  });

  test('the user id still comes from the session, never the body', async () => {
    axios.post.mockResolvedValueOnce({ status: 200, data: { success: true, requestId: 'r-4' } });
    await invoke('post', '/assessment/generate', { body: { ...PLAIN_BODY, userId: 'someone-else', pattern: 'fde_g5_2027' } });
    expect(sentToBot().userId).toBe('teacher-1');
  });
});

describe('the bot\'s refusals pass through with their code', () => {
  test('400 with an errorCode keeps the code', async () => {
    axios.post.mockResolvedValueOnce({ status: 400, data: { success: false, errorCode: 'PATTERN_OFF',
      error: 'Board-pattern papers are off right now. Make your own paper or try later.' } });
    const { statusCode, payload } = await invoke('post', '/assessment/generate', { body: { ...PLAIN_BODY, pattern: 'fde_g5_2027' } });
    expect(statusCode).toBe(400);
    expect(payload).toEqual({ success: false, errorCode: 'PATTERN_OFF',
      error: 'Board-pattern papers are off right now. Make your own paper or try later.' });
  });

  test('golden: a 400 without an errorCode answers exactly as today', async () => {
    axios.post.mockResolvedValueOnce({ status: 400, data: { success: false, error: 'chapterNumbers or pageRanges is required' } });
    const { statusCode, payload } = await invoke('post', '/assessment/generate', { body: { grade: 5, subject: 'maths' } });
    expect(statusCode).toBe(400);
    expect(JSON.stringify(payload)).toBe('{"success":false,"error":"chapterNumbers or pageRanges is required"}');
  });

  test('409 ALREADY_GENERATING passes through as a 409 with its body', async () => {
    const body409 = { success: false, errorCode: 'ALREADY_GENERATING', error: 'A paper for this class is being made.', requestId: 'r-running' };
    axios.post.mockResolvedValueOnce({ status: 409, data: body409 });
    const { statusCode, payload } = await invoke('post', '/assessment/generate', { body: { ...PLAIN_BODY, pattern: 'fde_g5_2027' } });
    expect(statusCode).toBe(409);
    expect(payload).toEqual(body409);
  });

  test('a 409 that carries no code is not passed through (ours, 502)', async () => {
    axios.post.mockResolvedValueOnce({ status: 409, data: { success: false } });
    const { statusCode, payload } = await invoke('post', '/assessment/generate', { body: PLAIN_BODY });
    expect(statusCode).toBe(502);
    expect(payload).toEqual({ success: false, error: 'Could not start your paper' });
  });

  test('a transport failure is still ours (502), with no code', async () => {
    axios.post.mockRejectedValueOnce(new Error('ECONNRESET'));
    const { statusCode, payload } = await invoke('post', '/assessment/generate', { body: PLAIN_BODY });
    expect(statusCode).toBe(502);
    expect(payload).toEqual({ success: false, error: 'Could not start your paper' });
  });
});

describe('options pass the pattern keys through untouched', () => {
  test('patterns and patternGrades from the bot reach the app', async () => {
    const patterns = [{ id: 'fde_g5_2027', totalMarks: 100 }];
    axios.post.mockResolvedValueOnce({ status: 200, data: { success: true, grades: [5], patternGrades: [5], patterns } });
    const { payload } = await invoke('get', '/assessment/options', { query: { grade: '5', subject: 'maths' } });
    expect(payload.patternGrades).toEqual([5]);
    expect(payload.patterns).toEqual(patterns);
  });
});

describe('the edit proxy passes a board-pattern refusal through', () => {
  test('adding a question to a pattern paper: 400 EDIT_REJECTED / PATTERN_NO_ADD reaches the app as sent', async () => {
    const refusal = { success: false, code: 'EDIT_REJECTED', errorCode: 'PATTERN_NO_ADD', error: 'Board-pattern papers keep their shape.' };
    axios.post.mockResolvedValueOnce({ status: 400, data: refusal });
    const { statusCode, payload } = await invoke('post', '/assessment/edit/:paper_id/save', {
      params: { paper_id: 'p-1' }, body: { changes: { add: [{ kind: 'mcq' }] } },
    });
    expect(axios.post.mock.calls[0][0]).toBe(`${BOT}/api/internal/assessment/edit/save`);
    expect(axios.post.mock.calls[0][1].userId).toBe('teacher-1');
    expect(statusCode).toBe(400);
    expect(payload).toEqual(refusal);
  });
});
