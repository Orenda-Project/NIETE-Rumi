/**
 * No real phone number ships as a default in the calls service (bd-1hae7.20).
 *
 * The 80% budget alarm fell back to one person's WhatsApp number, hardcoded in
 * calls-server.js. The repo is public and forbids internal phone numbers in
 * source; the repo's hygiene guard only matches the `+92…` form, so a bare
 * `92…` literal went unnoticed. Who receives the alarm is configuration
 * (OPERATOR_WHATSAPP), and an unset value must be logged, not silently routed to
 * whoever wrote the code.
 *
 * Comments are stripped first — otherwise this passes or fails on prose.
 */
const fs = require('fs');
const path = require('path');

function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
}

describe('calls-server carries no real phone number', () => {
  const src = codeOnly(fs.readFileSync(path.join(__dirname, '../../calls-server.js'), 'utf8'));

  test('no Pakistani mobile number literal in code', () => {
    expect(src.match(/['"`]\+?92\d{10}['"`]/g) || []).toEqual([]);
  });

  test('the alarm recipient comes from OPERATOR_WHATSAPP with no literal fallback', () => {
    expect(src).toMatch(/process\.env\.OPERATOR_WHATSAPP(?!\s*\|\|\s*['"`])/);
  });
});
