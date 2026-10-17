'use strict';
/**
 * mustWrite (must-write.js): a write that a "done" on the teacher's screen depends on either lands or refuses, in one
 * shape — never an ignored `{ error }` behind a 200.
 */
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));

const { logToFile } = require('../../../shared/utils/logger');
const { mustWrite } = require('../../../shared/services/quiz/must-write');

beforeEach(() => logToFile.mockClear());

describe('mustWrite', () => {
  test('a write that lands answers its rows and logs nothing', async () => {
    await expect(mustWrite(Promise.resolve({ data: [{ id: 1 }], error: null }), 'x: could not write')).resolves.toEqual([{ id: 1 }]);
    expect(logToFile).not.toHaveBeenCalled();
  });

  test('a write that answers { error } is logged at error level and refused with 503 unavailable', async () => {
    const out = mustWrite(Promise.resolve({ data: null, error: { message: 'boom' } }), 'x: could not write');
    await expect(out).rejects.toMatchObject({ status: 503, body: { error: 'unavailable' } });
    expect(logToFile).toHaveBeenCalledWith('❌ x: could not write', { error: 'boom' }, 'error');
  });

  test('needRow: a write that lands no row is refused the same way', async () => {
    await expect(mustWrite(Promise.resolve({ data: null, error: null }), 'x: no row', { needRow: true }))
      .rejects.toMatchObject({ status: 503 });
    expect(logToFile).toHaveBeenCalledWith('❌ x: no row', { error: null }, 'error');
  });

  test('needRow: an update that matched no row (an empty list) is refused the same way; one row lands', async () => {
    await expect(mustWrite(Promise.resolve({ data: [], error: null }), 'x: matched nothing', { needRow: true }))
      .rejects.toMatchObject({ status: 503, body: { error: 'unavailable' } });
    expect(logToFile).toHaveBeenCalledWith('❌ x: matched nothing', { error: null }, 'error');
    await expect(mustWrite(Promise.resolve({ data: [{ id: 1 }], error: null }), 'x', { needRow: true })).resolves.toEqual([{ id: 1 }]);
  });

  test('refuse: the caller\'s own error type is what is thrown', async () => {
    class Mine extends Error { constructor() { super('mine'); this.status = 503; } }
    await expect(mustWrite(Promise.resolve({ error: { message: 'e' } }), 'x', { refuse: () => new Mine() })).rejects.toBeInstanceOf(Mine);
  });

  test('a write that throws is not swallowed: the same rejection reaches the caller', async () => {
    const boom = new Error('network');
    await expect(mustWrite(Promise.reject(boom), 'x')).rejects.toBe(boom);
    expect(logToFile).not.toHaveBeenCalled();
  });
});
