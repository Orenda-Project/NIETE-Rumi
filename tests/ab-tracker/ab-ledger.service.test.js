'use strict';
/**
 * The ledger step of the tracker cron (bd-9nb6s0.2): after a rollup that ran, one call to ab_ledger_advance on the
 * primary moves each test planned -> running (first assignment) -> concluded (a call written). It never throws and
 * never changes the cron's exit code: a database without V1.10.12 yet answers "not installed".
 */
const mockLogToFile = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLogToFile(...a) }));

const { advance } = require('../../bot/shared/services/ab-tracker/ab-ledger.service');

const db = (result) => ({ rpc: jest.fn(async () => result) });

describe('ab-ledger advance', () => {
  beforeEach(() => mockLogToFile.mockClear());

  it('calls ab_ledger_advance once and returns its counts', async () => {
    const d = db({ data: { running: 1, concluded: 0, counted: 2 }, error: null });
    const r = await advance({ writer: () => d });
    expect(d.rpc).toHaveBeenCalledTimes(1);
    expect(d.rpc).toHaveBeenCalledWith('ab_ledger_advance');
    expect(r).toEqual({ outcome: 'advanced', running: 1, concluded: 0, counted: 2 });
  });

  it('a database without the function answers not_installed, quietly', async () => {
    const r = await advance({ writer: () => db({ data: null, error: { code: 'PGRST202', message: 'not found' } }) });
    expect(r).toEqual({ outcome: 'not_installed' });
    expect(mockLogToFile.mock.calls[0][2]).toBe('warn');
  });

  it('any other error answers failed and logs it, never throws', async () => {
    const r = await advance({ writer: () => db({ data: null, error: { code: '57014', message: 'timeout' } }) });
    expect(r).toEqual({ outcome: 'failed', error: 'timeout' });
    expect(mockLogToFile.mock.calls[0][2]).toBe('error');
  });

  it('a writer that throws answers failed', async () => {
    const r = await advance({ writer: () => { throw new Error('no client'); } });
    expect(r).toEqual({ outcome: 'failed', error: 'no client' });
  });
});
