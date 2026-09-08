/**
 * bd-oak77.11 — THE DRAIN MUST BE ABLE TO SAY THAT IT FINISHED.
 *
 * Measured on staging 2026-09-06, on the very first drain this lane produced. The worker received
 * SIGTERM at 17:31:23, stayed alive, and finished the lesson: `lp612 author finished` at 17:37:58,
 * the render row written `ready` at 17:38:00.4 with its PDF in R2, and `waiters` emptied by the
 * atomic claim that runs immediately before the delivery loop. All of that is in the database.
 *
 * NONE OF THE LOG LINES AFTER 17:37:58 EXIST. Not the delivery confirmation, not
 * `✅ Long-running jobs drained to completion before exit`, not `stopped gracefully`. The cause is
 * `process.exit(0)` on the line after `await worker.shutdown()`: `console.log` to a pipe is
 * asynchronous, and `process.exit` discards whatever has not yet been handed to the OS.
 *
 * That is rule 24 in miniature — the drain's own success is unobservable, so "did the deploy keep
 * the lesson?" cannot be answered from logs, only inferred from a row. It also means the historical
 * 30-day count of zero completion lines could not, on its own, distinguish "SIGKILLed early" from
 * "finished but the line was lost"; the `⏳ Waiting for N active jobs` line at t+2 ms is what made
 * that call, and future evidence should not have to lean on a coincidence like that.
 */

let SqsWorkerModule;

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers();
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
  jest.doMock('../../bot/shared/services/queue/sqs-queue.service', () => ({
    releaseInFlightMessage: jest.fn(), receiveJobs: jest.fn(() => Promise.resolve([])),
    deleteJob: jest.fn(), extendJobTimeout: jest.fn(),
  }));
  process.env.SQS_QUEUE_URL = 'https://sqs/main';
  SqsWorkerModule = require('../../bot/workers/sqs-worker');
});
afterEach(() => { jest.useRealTimers(); });

describe('exitAfterFlush', () => {
  it('does not exit until the stream has flushed', async () => {
    const { exitAfterFlush } = SqsWorkerModule;
    const exit = jest.fn();
    let cb;
    const stream = { write: (_chunk, c) => { cb = c; return false; } };

    exitAfterFlush(0, { exit, stream });
    expect(exit).not.toHaveBeenCalled();     // the buffered lines have not left the process yet

    cb();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('exits anyway if the flush never completes — a stuck pipe must not hang a shutdown', async () => {
    const { exitAfterFlush } = SqsWorkerModule;
    const exit = jest.fn();
    const stream = { write: () => false };   // callback never fires

    exitAfterFlush(0, { exit, stream, timeoutMs: 2000 });
    expect(exit).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2001);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('exits exactly once even if the flush lands after the backstop', () => {
    const { exitAfterFlush } = SqsWorkerModule;
    const exit = jest.fn();
    let cb;
    const stream = { write: (_c, c) => { cb = c; return false; } };

    exitAfterFlush(1, { exit, stream, timeoutMs: 100 });
    jest.advanceTimersByTime(101);
    cb();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('survives a stream that throws on write', () => {
    const { exitAfterFlush } = SqsWorkerModule;
    const exit = jest.fn();
    const stream = { write: () => { throw new Error('EPIPE'); } };
    exitAfterFlush(0, { exit, stream });
    expect(exit).toHaveBeenCalledWith(0);
  });
});
