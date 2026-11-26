#!/usr/bin/env node
/* test_registration_itu.js — the pure parts of registration-itu.cjs, the R24–R29 "Is this you?" drivers (bd-apnnh2.6.8).
 *
 * Run: node .claude/qa/shared/test_registration_itu.js
 *
 * What the mock-lane run cannot show cheaply: that the signature the emulator's requests carry is Meta's
 * (HMAC-SHA256 of the exact body, keyed with the app secret, as webhook-signature.js checks it), that only Flow
 * endpoint requests are signed, that a scenario never touches the shared driver's number, and that off the mock
 * lane the six report BLOCKED with a reason instead of failing.
 */
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const M = require(path.join(__dirname, 'registration-itu.cjs'));

let n = 0, failed = 0;
async function t(name, fn) {
  n++;
  try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

(async () => {
  await t('phonesFor: twelve digits, never the driver, the other account ends in 47, distinct per scenario', () => {
    const a = M.phonesFor('923001234567', 1), b = M.phonesFor('923001234567', 2);
    for (const p of [a.me, a.other, b.me, b.other]) assert.match(p, /^\d{12}$/);
    assert.notStrictEqual(a.me, '923001234567');
    assert.ok(a.other.endsWith('47') && b.other.endsWith('47'));
    assert.strictEqual(new Set([a.me, a.other, b.me, b.other]).size, 4);
  });

  await t('envValue reads one key and strips quotes', () => {
    assert.strictEqual(M.envValue('A=1\nWHATSAPP_APP_SECRET="s3"\n', 'WHATSAPP_APP_SECRET'), 's3');
    assert.strictEqual(M.envValue('A=1\n', 'WHATSAPP_APP_SECRET'), '');
  });

  await t('signedFetch signs a Flow endpoint request the way webhook-signature.js verifies it', async () => {
    const seen = [];
    const f = M.signedFetch('sek', async (url, init) => { seen.push({ url, init }); return { ok: true }; });
    const body = JSON.stringify({ encrypted_flow_data: 'x' });
    await f('http://127.0.0.1:3100/api/flows/registration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const sig = seen[0].init.headers['X-Hub-Signature-256'];
    assert.strictEqual(sig, 'sha256=' + crypto.createHmac('sha256', 'sek').update(body).digest('hex'));
    assert.strictEqual(seen[0].init.headers['Content-Type'], 'application/json');
  });

  await t('signedFetch leaves every other request alone, and signs nothing without a secret', async () => {
    const seen = [];
    const base = async (url, init) => { seen.push(init); return { ok: true }; };
    await M.signedFetch('sek', base)('http://127.0.0.1:4010/outbox', { body: '{}' });
    await M.signedFetch('', base)('http://127.0.0.1:3100/api/flows/registration', { body: '{}' });
    assert.ok(seen.every((i) => !(i.headers && i.headers['X-Hub-Signature-256'])));
  });

  await t('cardOn swaps only the flow id, on a copy', () => {
    const card = { btns: ['Get started'], raw: { interactive: { type: 'flow', action: { parameters: { flow_id: '1', flow_token: 'tok' } } } } };
    const c = M.cardOn(card, M.V6_FLOW_ID);
    assert.strictEqual(c.raw.interactive.action.parameters.flow_id, M.V6_FLOW_ID);
    assert.strictEqual(c.raw.interactive.action.parameters.flow_token, 'tok');
    assert.strictEqual(card.raw.interactive.action.parameters.flow_id, '1');
  });

  await t('leaks finds more of the other account than its last two digits', () => {
    const other = { phone: '923961234147', id: 'uuid-1' };
    assert.deepStrictEqual(M.leaks('made with a number ending in 47', other), []);
    assert.strictEqual(M.leaks('number 4147', other).length, 1);
    assert.strictEqual(M.leaks('id uuid-1', other).length, 1);
  });

  await t('off the mock lane the six are BLOCKED with a reason, R23 DEFERRED, and nothing is driven', async () => {
    const recs = [];
    const api = { caps: { method: 'chrome' }, as() { throw new Error('drove a number'); }, db() { throw new Error('touched the db'); } };
    const r = await M.drive({ api, rec: (...a) => recs.push(a), sleep: async () => {}, want: () => true });
    for (const id of ['R23', 'R24', 'R25', 'R26', 'R27', 'R28', 'R29']) r(id);
    const v = Object.fromEntries(recs.map((a) => [a[0], a[2]]));
    assert.strictEqual(v.R23, 'DEFERRED');
    for (const id of ['R24', 'R25', 'R26', 'R27', 'R28', 'R29']) assert.strictEqual(v[id], 'BLOCKED', id);
    assert.match(recs.find((a) => a[0] === 'R24')[3].reason, /mock lane only/);
  });

  await t('a scenario not selected is not recorded', async () => {
    const recs = [];
    const api = { caps: { method: 'chrome' } };
    const r = await M.drive({ api, rec: (...a) => recs.push(a), sleep: async () => {}, want: (id) => id === 'R25' });
    for (const id of ['R23', 'R24', 'R25']) r(id);
    assert.deepStrictEqual(recs.map((a) => a[0]), ['R25']);
  });

  await t('deferChromeLane defers R01–R22 on the mock lane, honouring the selection', () => {
    const recs = [];
    M.deferChromeLane((...a) => recs.push(a), (id) => id !== 'R05');
    assert.ok(recs.every((a) => a[2] === 'DEFERRED'));
    assert.ok(recs.some((a) => a[0] === 'R01') && recs.some((a) => a[0] === 'R22') && !recs.some((a) => a[0] === 'R05'));
  });

  // Data E2E (bd-5b3u70.8): the two rules every data-checked scenario gets. dataVerdict turns api.dataRules' answer into
  // the scenario's data part: a violation fails it; NOT CHECKED (not the run's own database) never passes or fails it.
  await t('dataVerdict: no write to someone else and no duplicates is ok', () => {
    assert.deepStrictEqual(M.dataVerdict({ ok: true, owner: [], duplicates: [], changes: { users: { added: [], changed: [{ key: 'me', cols: ['name'] }], removed: [] } } }),
      { ok: true, data: 'checked', owner: [], duplicates: [] });
  });
  await t('dataVerdict: a write to another teacher fails, naming the row', () => {
    const v = M.dataVerdict({ ok: true, owner: [{ table: 'users', key: 'x', owner: 'x', change: 'changed', cols: ['school_id'] }], duplicates: [], changes: {} });
    assert.strictEqual(v.ok, false);
    assert.deepStrictEqual(v.owner.map((o) => o.key), ['x']);
  });
  await t('dataVerdict: two accounts for one number fail', () => {
    const v = M.dataVerdict({ ok: true, owner: [], duplicates: [{ table: 'users', same: ['phone_number'], keys: ['a', 'b'] }], changes: {} });
    assert.strictEqual(v.ok, false);
  });
  await t('dataVerdict: not the run\'s own database is NOT CHECKED, never a failure', () => {
    assert.deepStrictEqual(M.dataVerdict({ ok: false, notChecked: 'shared database' }), { ok: true, data: 'NOT CHECKED: shared database' });
  });

  console.log(`${n} test(s), ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
