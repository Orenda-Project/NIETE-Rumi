/**
 * logToFile severity routing, and the logError/logWarn wrappers.
 *
 * `logToFile(message, data, level)` defaults `level` to `'info'`. That default
 * is the right one for the common case, but it means the severity of a FAILURE
 * log depends on the author remembering to type a third positional argument.
 * When they don't, the failure lands at Pino level `info` and is invisible to
 * any monitor filtering on `@level:error` — the operation failed, nobody was
 * told, and the log looks fine to a human reading it because the message text
 * still says ❌.
 *
 * `logError()` / `logWarn()` make the severity part of the function name, so
 * the correct choice is the path of least resistance instead of a rule to
 * remember. These tests pin the routing both wrappers depend on: severity is
 * expressed by WHICH console method fires, because `structured-logger.js`
 * overrides console.log/warn/error and maps them to Pino info/warn/error.
 */

const path = require('path');

const LOGGER_PATH = path.resolve(__dirname, '../../bot/shared/utils/logger.js');

describe('logToFile severity routing', () => {
  let logToFile;
  let logError;
  let logWarn;
  let spies;

  beforeEach(() => {
    jest.resetModules();
    // eslint-disable-next-line global-require, import/no-dynamic-require
    ({ logToFile, logError, logWarn } = require(LOGGER_PATH));
    spies = {
      log: jest.spyOn(console, 'log').mockImplementation(() => {}),
      warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
      error: jest.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('defaults to console.log (Pino info) when no level is given', () => {
    logToFile('routine progress', { step: 1 });
    expect(spies.log).toHaveBeenCalledTimes(1);
    expect(spies.error).not.toHaveBeenCalled();
    expect(spies.warn).not.toHaveBeenCalled();
  });

  it("routes level='error' to console.error, never console.log", () => {
    logToFile('❌ terminal failure', { error: 'boom' }, 'error');
    expect(spies.error).toHaveBeenCalledTimes(1);
    expect(spies.log).not.toHaveBeenCalled();
  });

  it("routes level='warn' to console.warn, never console.log", () => {
    logToFile('degraded, fell back', { reason: 'timeout' }, 'warn');
    expect(spies.warn).toHaveBeenCalledTimes(1);
    expect(spies.log).not.toHaveBeenCalled();
  });

  it('falls back to console.log for an unrecognised level rather than throwing', () => {
    expect(() => logToFile('odd level', { a: 1 }, 'trace')).not.toThrow();
    expect(spies.log).toHaveBeenCalledTimes(1);
  });

  describe('logError / logWarn wrappers', () => {
    it('logError() routes through console.error', () => {
      logError('❌ Gamma client failed', { error: 'boom' });
      expect(spies.error).toHaveBeenCalledTimes(1);
      expect(spies.log).not.toHaveBeenCalled();
    });

    it('logWarn() routes through console.warn', () => {
      logWarn('falling back to text summary', { reason: 'pdf failed' });
      expect(spies.warn).toHaveBeenCalledTimes(1);
      expect(spies.log).not.toHaveBeenCalled();
    });

    it("logError() is exactly logToFile(msg, data, 'error')", () => {
      logError('via wrapper', { a: 1 });
      const viaWrapper = spies.error.mock.calls[0];
      spies.error.mockClear();
      logToFile('via wrapper', { a: 1 }, 'error');
      expect(spies.error.mock.calls[0]).toEqual(viaWrapper);
    });

    it('logError() with no data still calls console.error with a single argument', () => {
      logError('bare failure');
      expect(spies.error).toHaveBeenCalledTimes(1);
      expect(spies.error.mock.calls[0]).toHaveLength(1);
      expect(spies.error.mock.calls[0][0]).toBe('bare failure');
    });

    it('passes the data object through to the console call', () => {
      logError('❌ with context', { userId: 'u1', coachingSessionId: 's1' });
      const [, data] = spies.error.mock.calls[0];
      expect(data).toMatchObject({ userId: 'u1', coachingSessionId: 's1' });
    });
  });
});

describe('the manual mock keeps parity with the real module', () => {
  // A mock missing an export does not fail loudly — the consumer just gets
  // `undefined` and throws "x is not a function" somewhere unrelated. Pin it.
  it('__mocks__/logger.js exposes every function the real logger exports', () => {
    jest.resetModules();
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const real = require(LOGGER_PATH);
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const mock = require(path.resolve(__dirname, '../../bot/shared/utils/__mocks__/logger.js'));

    const realFns = Object.keys(real).filter((k) => typeof real[k] === 'function').sort();
    const mockFns = Object.keys(mock).filter((k) => typeof mock[k] === 'function').sort();

    expect(realFns.length).toBeGreaterThan(0);
    expect(mockFns).toEqual(realFns);
  });
});
