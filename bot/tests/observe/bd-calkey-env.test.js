/**
 * The last thing between "configured" and "an invite arrives".
 *
 * google-calendar.client.js read the service-account key from
 * GOOGLE_SERVICE_ACCOUNT_PATH — a FILE PATH. Railway containers have no such
 * file and the variable was not set on prod, so isConfigured() returned false,
 * the gate skipped every schedule, and no invite was ever attempted. Silent,
 * because the whole calendar path is deliberately non-blocking.
 *
 * This project already has the convention (google-workspace skill, coos-088):
 * prefer GOOGLE_SERVICE_ACCOUNT_JSON — the cloud/Railway variable — and fall
 * back to the local file for workstation runs.
 */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const fs = require('fs');
const path = require('path');
const CLIENT = path.join(__dirname, '../../shared/services/observe/google-calendar.client.js');
const FAKE = JSON.stringify({ client_email: 'x@y.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nAA\n-----END PRIVATE KEY-----\n' });

const load = (env) => {
  jest.resetModules();
  for (const k of ['GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_SERVICE_ACCOUNT_PATH', 'GOOGLE_CALENDAR_SUBJECT', 'GOOGLE_CALENDAR_ID']) delete process.env[k];
  Object.assign(process.env, env);
  return require('../../shared/services/observe/google-calendar.client');
};

describe('calendar key · the cloud has no key FILE', () => {
  const base = { GOOGLE_CALENDAR_SUBJECT: 'rumi@hellorumi.ai', GOOGLE_CALENDAR_ID: 'primary' };

  it('is configured from the JSON env var alone — the Railway case', () => {
    expect(load({ ...base, GOOGLE_SERVICE_ACCOUNT_JSON: FAKE }).isConfigured()).toBe(true);
  });

  it('is still configured from a file path — the workstation case', () => {
    const p = path.join(require('os').tmpdir(), `sa-${Date.now()}.json`);
    fs.writeFileSync(p, FAKE);
    expect(load({ ...base, GOOGLE_SERVICE_ACCOUNT_PATH: p }).isConfigured()).toBe(true);
    fs.unlinkSync(p);
  });

  it('is NOT configured with neither — the state prod was actually in', () => {
    expect(load({ ...base }).isConfigured()).toBe(false);
  });

  it('is NOT configured without a subject — DWD needs someone to impersonate', () => {
    expect(load({ GOOGLE_CALENDAR_ID: 'primary', GOOGLE_SERVICE_ACCOUNT_JSON: FAKE }).isConfigured()).toBe(false);
  });

  it('prefers the env var when both are present', () => {
    // Scope to the function that DECIDES. Whole-file position is brittle — the
    // path is named in the doc comment long before either is read.
    const src = fs.readFileSync(CLIENT, 'utf8');
    const i = src.indexOf('function loadKey(');
    const body = src.slice(i, src.indexOf('\n}', i));
    expect(body).toMatch(/if \(keyJson\) return/);
    expect(body.indexOf('keyJson')).toBeLessThan(body.indexOf('keyPath'));
  });

  it('a bad path does not break a working env var', () => {
    const c = load({ GOOGLE_CALENDAR_SUBJECT: 'rumi@hellorumi.ai', GOOGLE_CALENDAR_ID: 'primary',
      GOOGLE_SERVICE_ACCOUNT_JSON: FAKE, GOOGLE_SERVICE_ACCOUNT_PATH: '/nonexistent/key.json' });
    expect(c.isConfigured()).toBe(true);
  });
});
