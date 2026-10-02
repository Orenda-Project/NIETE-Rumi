/**
 * CONTRACT §17 (CR-L17-4): the app channel scores through recovery.runScoring — the same DB claim the
 * WhatsApp path and the sweep use — not an unclaimed in-memory scoreBlock that could race the sweep.
 * Runs the service's real default dependency loader; only the recovery module is mocked.
 */
jest.mock('../../../bot/shared/services/child-test/conversation/recovery', () => ({
  runScoring: jest.fn(async () => ({ outcome: 'scored' })),
}));
const recovery = require('../../../bot/shared/services/child-test/conversation/recovery');
const Svc = require('../../../bot/shared/services/child-test/app/app-api.service');

describe('app startScoring goes through the claimed scorer', () => {
  beforeEach(() => recovery.runScoring.mockClear());

  test('a reading block is scored by recovery.runScoring with the session ref', async () => {
    const session = { id: 'sess-1', grade: 3, form: 'A', channel: 'app' };
    const scoring = { scoreBlock: jest.fn() };
    Svc.__internals.startScoring(Svc.__internals.withDefaults({ defer: (fn) => fn(), scoring, logError: jest.fn() }), session, 'urdu');
    await new Promise((r) => setImmediate(r));
    expect(recovery.runScoring).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess-1', grade: 3, form: 'A', session }), 'urdu', expect.objectContaining({ force: false }));
    expect(scoring.scoreBlock).not.toHaveBeenCalled();
  });

  test('maths without a strip is forced, and a failed outcome is logged, never thrown', async () => {
    recovery.runScoring.mockResolvedValueOnce({ outcome: 'failed', reason: 'audio_download_failed' });
    const logError = jest.fn();
    const session = { id: 'sess-2', grade: 5, form: 'B', channel: 'app' };
    Svc.__internals.startScoring(Svc.__internals.withDefaults({ defer: (fn) => fn(), logError }), session, 'maths', { force: true });
    await new Promise((r) => setImmediate(r));
    expect(recovery.runScoring).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess-2' }), 'maths', expect.objectContaining({ force: true }));
    expect(logError).toHaveBeenCalledWith('child_test.app.score_not_ok', expect.objectContaining({ sessionId: 'sess-2', block: 'maths', outcome: 'failed' }));
  });
});

describe('the coach never sees the recovery bookkeeping in ai_reason (CR-L17-2)', () => {
  test('final: is stripped, attempt:N is hidden, a plain reason passes through', () => {
    const { coachReason } = Svc.__internals;
    expect(coachReason('final:audio_download_failed')).toBe('audio_download_failed');
    expect(coachReason('attempt:2')).toBeNull();
    expect(coachReason('no_media')).toBe('no_media');
    expect(coachReason(null)).toBeNull();
  });
});
