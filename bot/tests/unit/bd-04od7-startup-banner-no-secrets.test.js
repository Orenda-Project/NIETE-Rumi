'use strict';
/**
 * bd-04od7 — the boot banner must never carry a secret.
 *
 * The banner is console output, and console output is shipped to Axiom on every
 * tier. It used to interpolate WEBHOOK_VERIFY_TOKEN (and NGROK_AUTHTOKEN) so a
 * local developer could paste them; on a deployed service that is leakage.
 * Only a set / not-set indicator is allowed — never the value, a prefix or a mask.
 */

const fs = require('fs');
const path = require('path');

const { buildStartupMessage } = require('../../shared/utils/startup-banner');

const VERIFY = 'Xq7Zk9wP3mJvSENTINEL';
const NGROK = 'ngrok-SENTINEL-7d1e88';

const build = (env) => buildStartupMessage({ version: '9.9.9', port: 3000, logsDir: '/tmp/logs', env });

describe('bd-04od7 startup banner', () => {
  test('never contains the verify token, or any 4+ char slice of it', () => {
    const msg = build({ WEBHOOK_VERIFY_TOKEN: VERIFY, NGROK_AUTHTOKEN: NGROK });
    for (let i = 0; i + 4 <= VERIFY.length; i += 1) {
      expect(msg).not.toContain(VERIFY.slice(i, i + 4));
    }
    expect(msg).not.toContain('SENTINEL');
  });

  test('never contains the ngrok auth token', () => {
    const msg = build({ WEBHOOK_VERIFY_TOKEN: VERIFY, NGROK_AUTHTOKEN: NGROK });
    expect(msg).not.toContain(NGROK);
    expect(msg).not.toContain('--authtoken');
  });

  test('says whether the verify token is set, without the value', () => {
    expect(build({ WEBHOOK_VERIFY_TOKEN: VERIFY })).toMatch(/Verify Token: set \(WEBHOOK_VERIFY_TOKEN/);
    expect(build({})).toMatch(/Verify Token: NOT SET/);
  });

  test('keeps the useful local-setup lines', () => {
    const msg = build({});
    expect(msg).toContain('Rumi v9.9.9');
    expect(msg).toContain('http://localhost:3000');
    expect(msg).toContain('npx ngrok http 3000');
    expect(msg).toContain('/tmp/logs');
  });

  test('whatsapp-bot.js no longer interpolates either token into its banner', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../whatsapp-bot.js'), 'utf8');
    expect(src).not.toMatch(/Verify Token: \$\{constants\.WEBHOOK_VERIFY_TOKEN\}/);
    expect(src).not.toMatch(/--authtoken \$\{process\.env\.NGROK_AUTHTOKEN\}/);
    expect(src).toMatch(/buildStartupMessage\(/);
  });

  // Second site (bead comment 2026-09-23): GET /webhook logged the presented
  // hub.verify_token, which on a genuine Meta check IS the real token.
  test('GET /webhook never logs the presented verify token', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../whatsapp-bot.js'), 'utf8');
    const start = src.indexOf("app.get('/webhook'");
    expect(start).toBeGreaterThan(-1);
    const handler = src.slice(start, src.indexOf('\n});', start));
    // The `token` variable passed as an argument, or interpolated into a template.
    expect(handler).not.toMatch(/console\.\w+\([^)]*(,\s*token\s*[,)]|\$\{token\})/);
    expect(handler).not.toMatch(/console\.\w+\([^)]*hub\.verify_token'\]/);
  });
});
