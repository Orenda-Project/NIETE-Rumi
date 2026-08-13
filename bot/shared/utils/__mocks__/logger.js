/**
 * Mock Logger for Testing
 *
 * Must expose every FUNCTION the real `logger.js` exports. When it doesn't,
 * code under test that reaches for a missing one gets `undefined` and dies with
 * `TypeError: logError is not a function` — a failure that reads like a bug in
 * the code rather than a gap in this file. `tests/config/logger-severity.test.js`
 * asserts this parity so the two cannot drift apart again.
 */

const logToFile = jest.fn();
const logError = jest.fn();
const logWarn = jest.fn();

module.exports = {
  logToFile,
  logError,
  logWarn
};
