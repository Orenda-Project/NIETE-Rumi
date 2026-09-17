#!/usr/bin/env node
/* test_inject_wa_drive.js — unit tests for the pure core of inject-wa-drive.js.
 *
 * Run: node .claude/qa/shared/test_inject_wa_drive.js
 *
 * WHY THIS EXISTS (bd-44105). Step 6 of all NINE per-feature agents already says "load
 * wa-drive FIRST, before any send". It is still skipped:
 *
 *     2026-08-21  never loaded -> a hand-rolled setTimeout per read -> 4h23m run
 *     2026-08-25  run.json records "wa_drive_loaded": false
 *
 * Nine instructions did not work; a tenth will not either. So the scheduler now injects
 * wa-drive over CDP BEFORE `claude` starts, and `wa.*` exists whether the agent cooperates
 * or not. These tests cover the decisions that make that injection land on the RIGHT tab
 * and fail LOUDLY rather than silently — a silent miss just returns us to 4h runs.
 */
const assert = require('assert');
const path = require('path');
const inj = require(path.join(__dirname, 'inject-wa-drive.js'));

let passed = 0;
const it = (name, fn) => {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
};

console.log('pickTarget() — which of Chrome\'s targets is the WhatsApp tab?');
// A real Chrome answered /json/list with SIX targets, only some of them pages:
// browser_ui x2, background_page, ... Injecting into the wrong one silently succeeds
// and leaves the WhatsApp tab without wa.*, which is the exact failure being fixed.
const TARGETS = [
  { type: 'browser_ui',      url: 'chrome://omnibox-popup.top-chrome/', webSocketDebuggerUrl: 'ws://x/1' },
  { type: 'background_page', url: 'chrome-extension://abc/bg.html',     webSocketDebuggerUrl: 'ws://x/2' },
  { type: 'page',            url: 'https://mail.google.com/',           webSocketDebuggerUrl: 'ws://x/3' },
  { type: 'page',            url: 'https://web.whatsapp.com/',          webSocketDebuggerUrl: 'ws://x/4' },
];

it('picks the whatsapp PAGE, not a browser_ui or extension target', () => {
  assert.strictEqual(inj.pickTarget(TARGETS).webSocketDebuggerUrl, 'ws://x/4');
});
it('ignores an unrelated page even when it sorts first', () => {
  assert.strictEqual(inj.pickTarget(TARGETS).url, 'https://web.whatsapp.com/');
});
it('returns null when no whatsapp tab is open — never a wrong tab', () => {
  assert.strictEqual(inj.pickTarget(TARGETS.slice(0, 3)), null);
});
it('returns null on an empty target list', () => {
  assert.strictEqual(inj.pickTarget([]), null);
  assert.strictEqual(inj.pickTarget(null), null);
});
it('skips a whatsapp target that has no webSocketDebuggerUrl (not attachable)', () => {
  assert.strictEqual(inj.pickTarget([{ type: 'page', url: 'https://web.whatsapp.com/' }]), null);
});
it('honours a custom matcher so the same injector serves another surface', () => {
  assert.strictEqual(inj.pickTarget(TARGETS, /mail\.google/).webSocketDebuggerUrl, 'ws://x/3');
});

console.log('classify() — did the injection actually take?');
// wa-drive returns 'wa-drive ready: <keys>'. Anything else is a miss, and a miss MUST be
// loud: the whole point is that nobody has to trust the agent's word for it.
it('the ready string is a success, and the key list is carried through', () => {
  const r = inj.classify({ result: { result: { type: 'string', value: 'wa-drive ready: matches, send, tap' } } });
  assert.strictEqual(r.ok, true);
  assert.ok(r.detail.includes('send'));
});
it('a thrown exception in the page is a failure with its text', () => {
  const r = inj.classify({ result: { exceptionDetails: { text: 'Uncaught', exception: { description: 'ReferenceError: x' } } } });
  assert.strictEqual(r.ok, false);
  assert.ok(/ReferenceError/.test(r.detail), r.detail);
});
it('a CDP protocol error is a failure, not a silent pass', () => {
  const r = inj.classify({ error: { message: 'Cannot find context with specified id' } });
  assert.strictEqual(r.ok, false);
  assert.ok(/context/.test(r.detail));
});
it('an unexpected return value is a failure — wrong file, or a stale build', () => {
  const r = inj.classify({ result: { result: { type: 'undefined' } } });
  assert.strictEqual(r.ok, false);
});
it('a truthy-but-wrong string does not pass', () => {
  assert.strictEqual(inj.classify({ result: { result: { type: 'string', value: 'true' } } }).ok, false);
});
it('classify never throws on a malformed frame', () => {
  for (const f of [null, {}, { result: {} }, { result: { result: {} } }]) {
    assert.strictEqual(inj.classify(f).ok, false);
  }
});

console.log('wrap() — what actually gets evaluated in the page');
it('the payload is an expression, not a bare IIFE-less file', () => {
  // Runtime.evaluate takes an EXPRESSION. wa-drive.js is already a parenthesised IIFE that
  // returns the ready string, so it must be passed through unchanged, not re-wrapped in a
  // function declaration (which evaluates to undefined and classify() would then reject).
  const src = '(() => { return "wa-drive ready: a, b"; })();';
  assert.strictEqual(eval(inj.wrap(src)), 'wa-drive ready: a, b');
});
it('wrap is idempotent for a file with a trailing newline / semicolon', () => {
  assert.strictEqual(eval(inj.wrap('(() => "wa-drive ready: x")();\n')), 'wa-drive ready: x');
});

console.log('\n' + passed + ' assertions passed');
