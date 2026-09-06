/**
 * Every Flow's request crosses one decrypt path. That path must log the
 * client's own error report.
 *
 * When the WhatsApp client fails to render a screen it posts a data_exchange
 * back carrying `error_message`. On 5–6 Sep 2026 that string was discarded for
 * thirteen of fourteen Flow handlers (only the assessment one logged it, and
 * only on main), so every "Something went wrong" left a clean server log and
 * four fixes shipped off evidence that could not contain the fault.
 *
 * Source-level on purpose: the guarantee is that the log call on the shared
 * path names the field, whichever handler the request is bound for.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '../../bot/shared/services/flow-encryption.service.js'), 'utf8');

describe('the shared Flow decrypt path logs the client error report', () => {
  const start = SRC.indexOf("logToFile('Decrypted flow data'");
  const window = SRC.slice(Math.max(0, start - 800), start + 600);

  test('the decrypt log site exists', () => {
    expect(start).toBeGreaterThan(-1);
  });

  test('it reads error_message off the decrypted data', () => {
    expect(window).toMatch(/decryptedData\.data[\s\S]{0,80}error_message/);
  });

  test('and puts it in the log record', () => {
    expect(window).toMatch(/clientError/);
  });
});
