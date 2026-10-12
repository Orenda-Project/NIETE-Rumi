#!/usr/bin/env node
/* test_app_redirect_case.js — the shared step every app-redirect scenario takes (bd-z3ze4).
 *
 * Run: node .claude/qa/shared/test_app_redirect_case.js
 *
 * M20 / L11 / COA62 / T92 / T93 each need ONE global switch (app_settings.app_redirect_<feature>) on for
 * their own run. withRedirect(): flips it (refused off the local lane → the scenario reports BLOCKED),
 * clears the driver's quiet-hour marker FIRST (the notice is sent once per teacher per hour ACROSS every
 * switch, so an earlier redirect scenario on the same driver would otherwise silence this one), runs the
 * scenario, and ALWAYS puts the switch back — even when the scenario throws.
 *
 * Red-first: fails before app-redirect-case.cjs exists.
 */
const assert = require('assert');
const path = require('path');
const { withRedirect, isStoreNotice } = require(path.join(__dirname, 'app-redirect-case.cjs'));

const fakeApi = ({ flipOk = true } = {}) => {
  const calls = [];
  return {
    calls,
    async setAppSetting(key, value) { calls.push(['set', key, value]); return flipOk ? { ok: true } : { ok: false, err: 'GLOBAL_SWITCH' }; },
    async resetRedirectNotice() { calls.push(['reset']); return { ok: true }; },
    async restoreAppSettings() { calls.push(['restore']); return { ok: true }; },
  };
};
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('  ok  ' + name); };

(async () => {
  await t('local lane: flip → clear the quiet hour → run → restore, in that order', async () => {
    const api = fakeApi();
    const out = await withRedirect(api, 'app_redirect_quiz', async () => { api.calls.push(['run']); return 'result'; });
    assert.deepStrictEqual(out, { ran: true, value: 'result' });
    assert.deepStrictEqual(api.calls.map((c) => c[0]), ['set', 'reset', 'run', 'restore']);
    assert.deepStrictEqual(api.calls[0], ['set', 'app_redirect_quiz', true]);
  });
  await t('off the local lane: nothing runs, the reason comes back for a BLOCKED record', async () => {
    const api = fakeApi({ flipOk: false });
    const out = await withRedirect(api, 'app_redirect_quiz', async () => { throw new Error('must not run'); });
    assert.deepStrictEqual(out, { ran: false, reason: 'GLOBAL_SWITCH' });
    assert.deepStrictEqual(api.calls.map((c) => c[0]), ['set']);
  });
  await t('the chrome lane (no setAppSetting at all) is BLOCKED too, not a crash', async () => {
    const out = await withRedirect({}, 'app_redirect_quiz', async () => 'x');
    assert.strictEqual(out.ran, false);
  });
  await t('the switch is restored even when the scenario throws', async () => {
    const api = fakeApi();
    await assert.rejects(withRedirect(api, 'app_redirect_quiz', async () => { throw new Error('boom'); }), /boom/);
    assert.strictEqual(api.calls[api.calls.length - 1][0], 'restore');
  });
  await t('isStoreNotice: the NIETE Play Store link, in either language', async () => {
    assert.strictEqual(isStoreNotice('Use the app: https://play.google.com/store/apps/details?id=pk.edu.niete'), true);
    assert.strictEqual(isStoreNotice('یہ سہولت اب NIETE ایپ میں ہے https://play.google.com/store/apps/details?id=pk.edu.niete'), true);
    assert.strictEqual(isStoreNotice('Pick your class'), false);
    assert.strictEqual(isStoreNotice(''), false);
  });
  console.log(`\napp-redirect-case: ${n} passed`);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
