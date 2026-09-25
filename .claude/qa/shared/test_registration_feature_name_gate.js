#!/usr/bin/env node
/* registration.cjs reads "is this account registered?" from the DB lookup the same way the bot does.
 *
 * `users.first_name` is gone (migration V1.4.4); `users.name` is the only name column and the bot's
 * gate is isRegistered() — a completed run or a non-empty `name`. The driver used to look for a
 * `"first_name"` line in the lookup, which no longer exists, so R08 was always BLOCKED and R10
 * always FAILED whatever the bot did.
 *
 * The feature's own run() executes end to end here. Only its boundary — the `api` object the runner
 * hands it (WhatsApp surface + DB reach-through) — is faked. Red-first: on the base branch R08 comes
 * back BLOCKED and R10 FAIL.
 *
 * Run: node .claude/qa/shared/test_registration_feature_name_gate.js
 */
'use strict';
const assert = require('assert');
const path = require('path');
const feature = require(path.join(__dirname, 'features', 'registration.cjs'));

function lookupBlock(fields) {
  // niete_training_db.py prints `USER: <json.dumps(rows, indent=1)>`; the runner keeps that block.
  return 'USER: ' + JSON.stringify([Object.assign({ id: 'u1', phone_number: '923000000001' }, fields)], null, 1);
}

function fakeApi({ registeredName }) {
  let unregistered = false;
  const screen = 'Full Name Country Select Your Region province in Pakistan Professional Details Your Role';
  return {
    async resetFlow() {},
    async sendWait(text) {
      if (/register/i.test(text) && !unregistered && registeredName && this._completed) {
        return { txt: `You're already registered, ${registeredName}! Type /menu to see what I can help you with.`, btns: [], waitedMs: 1 };
      }
      return { txt: 'Welcome to registration', btns: ['Get started'], waitedMs: 1 };
    },
    async openFlow() { return { ok: true }; },
    async flowProbe() { return { text: screen, items: [{ text: 'Your Role' }] }; },
    async flowState(re) { return /Next/.test(re) ? { found: true, disabled: true } : { found: true, disabled: false }; },
    async flowType() {},
    async flowPick() { return true; },
    async flowClick() {},
    async flowAria() {},
    closeFlow() {},
    async fresh() { this._completed = true; return [{ txt: 'Thanks for registering, Mahnoor! portal/setup/abc' }]; },
    db(action) {
      if (action === 'unregister') { unregistered = true; return { ok: true }; }
      const name = unregistered ? null : registeredName;
      return { ok: true, user: lookupBlock({ name, role: 'coach', registration_completed: !unregistered }) };
    },
  };
}

async function runFeature(api) {
  const out = {};
  await feature.run({ api, rec: (id, _name, verdict, ev) => { out[id] = { verdict, ev }; }, sleep: async () => {} });
  return out;
}

const tests = {
  async 'R08 runs (not BLOCKED) when the lookup shows a persisted name, and passes on "already registered"'() {
    const r = await runFeature(fakeApi({ registeredName: 'Mahnoor' }));
    assert.notStrictEqual(r.R08.verdict, 'BLOCKED', 'R08 blocked: ' + JSON.stringify(r.R08.ev));
    assert.strictEqual(r.R08.verdict, 'PASS', JSON.stringify(r.R08.ev));
  },
  async 'R08 is BLOCKED when the Flow left no name behind'() {
    const r = await runFeature(fakeApi({ registeredName: null }));
    assert.strictEqual(r.R08.verdict, 'BLOCKED');
  },
  async 'R10 passes when the unregistered account has no name after an abandoned Flow'() {
    const r = await runFeature(fakeApi({ registeredName: 'Mahnoor' }));
    assert.strictEqual(r.R10.verdict, 'PASS', JSON.stringify(r.R10.ev));
  },
};

(async () => {
  let fails = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try { await fn(); console.log('ok   ' + name); } catch (e) { fails++; console.log('FAIL ' + name + ': ' + String(e.message).slice(0, 300)); }
  }
  console.log(`${Object.keys(tests).length} test(s), ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
