#!/usr/bin/env node
/* test_wa_drive.js — unit tests for the pure core of wa-drive.js.
 *
 * Run: node .claude/qa/shared/test_wa_drive.js
 *
 * WHY THESE AND NOT THE DOM HELPERS. send/tap/readLast need a live WhatsApp Web page, so
 * they are proven by the E2E suite itself. What CAN silently rot is the decision logic the
 * adaptive waits are built on — "has a new bot message landed?" and "have I waited long
 * enough?". Those are pure, and they are exactly where a wrong answer costs either a false
 * FAIL (gave up too early) or the dead air this file exists to remove (slept the worst case).
 */
const assert = require('assert');
const path = require('path');
const wa = require(path.join(__dirname, 'wa-drive.js'));

let passed = 0;
const it = (name, fn) => {
  try { const r = fn(); if (r && typeof r.then === 'function') return r.then(() => { passed++; console.log('  ok  ' + name); }); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
};
const ita = async (name, fn) => {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
};

(async () => {
console.log('matches()');
it('substring match is case-insensitive', () => assert.strictEqual(wa.matches('Module check — PASSED.', 'passed'), true));
it('non-match returns false', () => assert.strictEqual(wa.matches('Step 1/5', 'passed'), false));
it('accepts a RegExp', () => assert.strictEqual(wa.matches('I detected a 16-minute audio', /\d+-minute/), true));
it('accepts an array — any hit wins', () => assert.strictEqual(wa.matches('not quite', ['passed', 'not quite']), true));
it('array with no hit is false', () => assert.strictEqual(wa.matches('Step 2/5', ['passed', 'not quite']), false));
it('null/undefined text never throws', () => assert.strictEqual(wa.matches(null, 'x'), false));

console.log('hasNewInbound()');
const base = { n: 3, lastTxt: 'Step 1/5' };
it('more rows AND last row inbound => new', () =>
  assert.strictEqual(wa.hasNewInbound(base, [{ txt: 'a', mine: false }, { txt: 'b', mine: false }, { txt: 'Step 1/5', mine: false }, { txt: 'Step 2/5', mine: false }]), true));
it('more rows but last row is MINE => not a bot reply yet', () =>
  assert.strictEqual(wa.hasNewInbound(base, [{ txt: 'a', mine: false }, { txt: 'b', mine: false }, { txt: 'Step 1/5', mine: false }, { txt: '/menu', mine: true }]), false));
it('same count and same tail => nothing new', () =>
  assert.strictEqual(wa.hasNewInbound(base, [{ txt: 'a', mine: false }, { txt: 'b', mine: false }, { txt: 'Step 1/5', mine: false }]), false));
it('same count but tail CHANGED (virtualised list) => new', () =>
  assert.strictEqual(wa.hasNewInbound(base, [{ txt: 'b', mine: false }, { txt: 'Step 1/5', mine: false }, { txt: 'Step 2/5', mine: false }]), true));
it('empty transcript is not "new"', () => assert.strictEqual(wa.hasNewInbound(base, []), false));

console.log('pollUntil() — injectable clock, no real sleeping');
await ita('resolves as soon as the predicate is true', async () => {
  let t = 0, calls = 0;
  const r = await wa.pollUntil(() => { calls++; return calls >= 3; },
    { timeoutMs: 10000, everyMs: 100, now: () => t, sleep: async () => { t += 100; } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(calls, 3, 'should stop polling the moment it is true');
  assert.strictEqual(r.waitedMs, 200);
});
await ita('does not sleep at all when already true', async () => {
  let slept = 0, t = 0;
  const r = await wa.pollUntil(() => true,
    { timeoutMs: 10000, everyMs: 100, now: () => t, sleep: async () => { slept++; t += 100; } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(slept, 0, 'a ready reply must cost zero wall clock');
  assert.strictEqual(r.waitedMs, 0);
});
await ita('times out and reports it, without looping forever', async () => {
  let t = 0;
  const r = await wa.pollUntil(() => false,
    { timeoutMs: 500, everyMs: 100, now: () => t, sleep: async () => { t += 100; } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.timedOut, true);
  assert.ok(r.waitedMs >= 500, 'waitedMs should reflect the full timeout, got ' + r.waitedMs);
});
await ita('a throwing predicate is treated as not-yet, not a crash', async () => {
  let t = 0, calls = 0;
  const r = await wa.pollUntil(() => { calls++; if (calls < 2) throw new Error('DOM mid-render'); return true; },
    { timeoutMs: 10000, everyMs: 100, now: () => t, sleep: async () => { t += 100; } });
  assert.strictEqual(r.ok, true);
});

console.log('mineFrom() — who sent this row?');
// Regression, found live 2026-08-23: the receipt-icon heuristic misread a JUST-SENT outbound row
// as inbound (the checkmark has not rendered yet), so waitForNew() returned on our OWN bubble and
// every adaptive wait became a race. The bubble TAIL is present from first paint; grouped
// consecutive messages carry no tail at all and must inherit the run's sender.
it('tail-out means the row is mine', () => assert.strictEqual(wa.mineFrom('tail-out', false, null), true));
it('tail-in means the row is the bot', () => assert.strictEqual(wa.mineFrom('tail-in', false, null), false));
it('tail wins over a missing receipt on a just-sent row', () => assert.strictEqual(wa.mineFrom('tail-out', false, false), true));
it('a receipt icon alone means mine (receipts never render on inbound)', () => assert.strictEqual(wa.mineFrom(null, true, null), true));
it('no tail and no receipt inherits the previous row (grouped run, mine)', () => assert.strictEqual(wa.mineFrom(null, false, true), true));
it('no tail and no receipt inherits the previous row (grouped run, bot)', () => assert.strictEqual(wa.mineFrom(null, false, false), false));
it('no signal at all and no predecessor is treated as inbound', () => assert.strictEqual(wa.mineFrom(null, false, null), false));

console.log('mainHidden() — the #main{display:none} trap that silently kills the composer');
it('display:none is hidden', () => assert.strictEqual(wa.mainHidden('none'), true));
it('flex is not hidden', () => assert.strictEqual(wa.mainHidden('flex'), false));
it('missing value is not hidden', () => assert.strictEqual(wa.mainHidden(undefined), false));


console.log('waitLog() — the artifact that PROVES the run polled instead of sleeping');
// WHY (bd-44102): nothing on disk distinguished "the poll returned in 3s" from "a constant
// slept 9s", so run_efficiency.py had no evidence to gate on and the speed contract stayed
// unenforceable. Every wait now records itself; the run dumps waits.jsonl at the end.
it('the log starts empty and records() what it is given', () => {
  wa.resetLog();
  assert.deepStrictEqual(wa.waitLogRows(), []);
  wa.record('waitForNew', { ok: true, waitedMs: 9000 });
  wa.record('waitFor', { ok: false, timedOut: true, waitedMs: 110000 }, 'certificate');
  const rows = wa.waitLogRows();
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].kind, 'waitForNew');
  assert.strictEqual(rows[0].waitedMs, 9000);
  assert.strictEqual(rows[1].marker, 'certificate');
  assert.strictEqual(rows[1].timedOut, true);
});
it('record() passes the result straight through so it can wrap a return', () => {
  wa.resetLog();
  const r = wa.record('waitForNew', { ok: true, waitedMs: 1234 });
  assert.strictEqual(r.waitedMs, 1234);
  assert.strictEqual(r.ok, true);
});
it('a result with no waitedMs is not logged (nothing was waited on)', () => {
  wa.resetLog();
  wa.record('send', { ok: false, err: 'NO_COMPOSER' });
  assert.deepStrictEqual(wa.waitLogRows(), []);
});
it('waitLog() emits one JSON object per line, parseable by run_efficiency', () => {
  wa.resetLog();
  wa.record('waitForNew', { ok: true, waitedMs: 9000 });
  wa.record('waitForNew', { ok: true, waitedMs: 11000 });
  const lines = wa.waitLog().trim().split('\n');
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(JSON.parse(lines[0]).waitedMs, 9000);
  assert.strictEqual(JSON.parse(lines[1]).waitedMs, 11000);
});
it('waitLog() on an empty log is an empty string, not "undefined"', () => {
  wa.resetLog();
  assert.strictEqual(wa.waitLog(), '');
});
it('stats() summarises so a slow surface shows up as data, not a constant', () => {
  wa.resetLog();
  [3000, 9000, 11000, 75900].forEach(ms => wa.record('waitForNew', { ok: true, waitedMs: ms }));
  const s = wa.stats();
  assert.strictEqual(s.n, 4);
  assert.strictEqual(s.maxMs, 75900);
  assert.strictEqual(s.totalMs, 98900);
});
it('stats() counts timeouts separately — a timeout is a failed read, not a slow one', () => {
  wa.resetLog();
  wa.record('waitForNew', { ok: true, waitedMs: 9000 });
  wa.record('waitForNew', { ok: false, timedOut: true, waitedMs: 110000 });
  assert.strictEqual(wa.stats().timedOut, 1);
});

console.log('\n' + passed + ' assertions passed');
})();
