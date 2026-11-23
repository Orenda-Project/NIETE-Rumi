'use strict';
/**
 * bd-4dkwaf — a web finish names the quiz stream, so the funnel watcher counts it.
 * Prod 21–23 Nov: 971 web finishes logged with no source; the alert summary said 0 finished.
 */
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { emitFinished } = require('../../bot/shared/services/quiz/web-quiz-finish-event');
const { streamOf } = require('../../bot/shared/services/quiz/quiz-funnel');

const QID = '11111111-1111-4111-8111-111111111111';
const SID = '22222222-2222-4222-8222-222222222222';
const CID = '33333333-3333-4333-8333-333333333333';
const SESSION = { id: SID, quiz_id: QID, share_code_id: CID, user_id: null };
const finished = () => logEvent.mock.calls.filter(([msg]) => msg === 'quiz_funnel.child_completed').map(([, d]) => d);

beforeEach(() => logEvent.mockClear());

test('a child finishing a lesson-plan quiz on the web is child_completed on the lp stream', async () => {
  await emitFinished(SESSION, 80, async (id) => (id === QID ? 'lp_v8' : null));
  const [d] = finished();
  expect(d).toEqual(expect.objectContaining({ quiz_id: QID, session_id: SID, source: 'lp_v8', channel: 'web', pct: 80 }));
  expect(streamOf(d.source)).toBe('lp');
  expect(d.kind).toBeUndefined();
});

test('the teacher\'s own run finishing is kind:self_test, still on its stream', async () => {
  await emitFinished({ ...SESSION, user_id: 'teacher-1' }, 100, async () => 'transcript');
  expect(finished()).toEqual([expect.objectContaining({ source: 'transcript', kind: 'self_test' })]);
});

test('a quiz row that cannot be read still logs the finish, with no stream, and never throws', async () => {
  await expect(emitFinished(SESSION, 50, async () => { throw new Error('db down'); })).resolves.toBeUndefined();
  expect(finished()).toEqual([expect.objectContaining({ quiz_id: QID, pct: 50 })]);
});
