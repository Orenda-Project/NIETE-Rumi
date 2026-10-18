'use strict';
/**
 * scripts/sample-ping-dry-run.js: the direct ping's plan, counts only. It calls the service's dryRun({now}) and prints
 * ONE JSON object (frame, exclusions by reason, eligible, would send, classes, max per class, the cost at the utility
 * and marketing rates, switch on/off, go token present yes/no). Never an id, a phone, a hash or a name; never send();
 * writes nothing; exit code 0.
 *
 * The service module is the boundary: in-process it is handed to main() as a stand-in; end to end the script runs as
 * its own node process with a preload that answers the service's require path with the same stand-in (no database,
 * no network, no WhatsApp).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { fixturePhone } = require('./fixture-phone');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'sample-ping-dry-run.js');
const NOW = new Date(Date.UTC(2026, 9, 15, 10, 0, 0));
const UUID = '55555555-5555-4555-8555-000000000001';

const UUID_RX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const PHONE_RX = /\+?92\d{9,}|\b03\d{9}\b|\d{10,}/;
const HEX16_RX = /[0-9a-f]{16,}/i;

/** A dry run's answer, with things in it the script must never print (an id, a phone, a hash, a name, a list). */
function plan(extra = {}) {
  return {
    term: '2026-27b', dry: true, switch_on: false, go_present: false,
    frame_n: 40, eligible_n: 12, would_send_n: 10, classes_n: 3, max_per_class: 6,
    excl_loose: 5, excl_drawn: 7, excl_teacher: 2, excl_stop: 1, excl_consent: 13, excl_done: 0,
    class_id: UUID, tomb: 'ab'.repeat(16), phone: fixturePhone(2), name: 'Sana Testwala', ids: [UUID],
    nested: { phone_norm: fixturePhone(3), n: 4 },
    ...extra,
  };
}

function stand(answer = plan()) {
  return {
    dryRun: jest.fn(async () => answer),
    send: jest.fn(async () => { throw new Error('send must never be called by the dry run'); }),
    RATE: { utility: 0.015, marketing: 0.0473 },
  };
}

function capture() {
  const out = [];
  return { write: (s) => { out.push(String(s)); return true; }, text: () => out.join('') };
}

function assertClean(text) {
  expect(text).not.toMatch(UUID_RX);
  expect(text).not.toMatch(PHONE_RX);
  expect(text).not.toMatch(HEX16_RX);
  expect(text).not.toMatch(/Testwala|"phone|"name|"tomb|"class_id"|"ids"/);
}

describe('the dry-run script in-process (main)', () => {
  const Script = () => require(SCRIPT);

  test('prints exactly one JSON object and returns exit code 0; dryRun called once with {now}; never send', async () => {
    const svc = stand();
    const out = capture();
    expect(await Script().main({ now: NOW, Service: svc, out })).toBe(0);
    const text = out.text();
    expect(text.trim().split('\n')).toHaveLength(1);
    const obj = JSON.parse(text);
    expect(obj && typeof obj === 'object' && !Array.isArray(obj)).toBe(true);
    expect(svc.dryRun).toHaveBeenCalledTimes(1);
    expect(svc.dryRun.mock.calls[0][0]).toEqual({ now: NOW });
    expect(svc.send).not.toHaveBeenCalled();
  });

  test('the counts ride through; cost at both rates; switch and go presence as booleans', async () => {
    const out = capture();
    await Script().main({ now: NOW, Service: stand(), out });
    const obj = JSON.parse(out.text());
    expect(obj).toMatchObject({
      term: '2026-27b', frame_n: 40, eligible_n: 12, would_send_n: 10, classes_n: 3, max_per_class: 6,
      excl_loose: 5, excl_drawn: 7, excl_teacher: 2, excl_stop: 1, excl_consent: 13, excl_done: 0,
      switch_on: false, go_present: false,
      cost_usd_utility: 0.15, cost_usd_marketing: 0.473,
    });
  });

  test('no uuid, phone-like or 16-hex string, no name, in what it prints', async () => {
    const out = capture();
    await Script().main({ now: NOW, Service: stand(), out });
    assertClean(out.text());
  });

  test('the dry run failing → one JSON object {error}, exit code 1, still never send', async () => {
    const svc = stand();
    svc.dryRun = jest.fn(async () => { throw new Error(`boom ${UUID}`); });
    const out = capture();
    expect(await Script().main({ now: NOW, Service: svc, out })).toBe(1);
    expect(JSON.parse(out.text())).toEqual({ error: 'dry_run_failed' });
    assertClean(out.text());
    expect(svc.send).not.toHaveBeenCalled();
  });

  test('the dry run says it failed ({error:"read_failed"}) → that word, exit code 1', async () => {
    const out = capture();
    expect(await Script().main({ now: NOW, Service: stand({ error: 'read_failed' }), out })).toBe(1);
    expect(JSON.parse(out.text())).toEqual({ error: 'read_failed' });
  });

  test('the service already priced the plan (usd_utility, usd_marketing) → its numbers, no second cost', async () => {
    const out = capture();
    await Script().main({ now: NOW, Service: stand(plan({ usd_utility: 0.15, usd_marketing: 0.473 })), out });
    const obj = JSON.parse(out.text());
    expect(obj).toMatchObject({ usd_utility: 0.15, usd_marketing: 0.473 });
    expect(obj).not.toHaveProperty('cost_usd_utility');
  });

  test('the dry run answers nothing usable (null) → {error}, exit code 1', async () => {
    const out = capture();
    expect(await Script().main({ now: NOW, Service: stand(null), out })).toBe(1);
    expect(JSON.parse(out.text())).toEqual({ error: 'dry_run_failed' });
  });
});

describe('the dry-run script as its own process', () => {
  let dir;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spdr-'));
    // A preload that answers the service's require path with a stand-in; send() leaves a mark if it is ever called.
    fs.writeFileSync(path.join(dir, 'preload.js'), `
      const Module = require('module');
      const fs = require('fs');
      const orig = Module._load;
      Module._load = function (req, parent, isMain) {
        if (/web-quiz-sample-ping$/.test(req)) {
          return {
            RATE: { utility: 0.015, marketing: 0.0473 },
            dryRun: async ({ now }) => (${JSON.stringify(plan())}),
            send: async () => { fs.writeFileSync(${JSON.stringify(path.join(dir, 'SENT'))}, 'x'); return { sent: 1 }; },
          };
        }
        return orig.apply(this, arguments);
      };
    `);
  });
  afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  test('exits 0, stdout is exactly one JSON object with no id/phone/hash, send never called', () => {
    const stdout = execFileSync(process.execPath, ['-r', path.join(dir, 'preload.js'), SCRIPT], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000,
    });
    const lines = stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    const obj = JSON.parse(lines[0]);
    expect(obj.would_send_n).toBe(10);
    assertClean(stdout);
    expect(fs.existsSync(path.join(dir, 'SENT'))).toBe(false);
  });
});
