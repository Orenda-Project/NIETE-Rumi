#!/usr/bin/env node
/* test_flow_drive.js — unit tests for the pure core of flow-drive.js.
 *
 * Run: node .claude/qa/shared/test_flow_drive.js
 *
 * WHY (bd-44106). The skill and the interaction map both state that a WhatsApp Flow iframe
 * is unreachable from script and must be driven with take_snapshot + click(uid). Measured
 * 2026-08-26 on the training Flow, that is false: the iframe is a SEPARATE CDP target, and
 * attaching to it gives Runtime.evaluate + Input.dispatchMouseEvent inside the Flow.
 *
 *     documented (snapshot + click)   37-86 s per step, 16-24 KB payload
 *     CDP on the iframe target        1.62 s per step, ZERO snapshots   (23-53x)
 *
 * That matters because Flow driving is training's largest single expense — 37.4 of its
 * 93.5 min — and the `t01 took 17 snapshots` hotspot.
 *
 * These tests pin the pure decisions. The live proof that CDP really drives a real Flow is
 * test_flow_drive.integration.js, because mocking CDP would only test the mock.
 */
const assert = require('assert');
const path = require('path');
const fd = require(path.join(__dirname, 'flow-drive.js'));

let passed = 0;
(async () => {
const it = (name, fn) => {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
};

console.log('pickFlowTarget() — find the Flow iframe among Chrome\'s targets');
// A real Chrome served the flow as {type:"iframe", url:"https://flows.whatsapp.net/flows-v2/wa-web/"}
// alongside the page, browser_ui and extension targets.
const TARGETS = [
  { type: 'page',   url: 'https://web.whatsapp.com/',                    webSocketDebuggerUrl: 'ws://x/page' },
  { type: 'iframe', url: 'https://flows.whatsapp.net/flows-v2/wa-web/',  webSocketDebuggerUrl: 'ws://x/flow' },
  { type: 'browser_ui', url: 'chrome://omnibox/',                        webSocketDebuggerUrl: 'ws://x/ui' },
];
it('finds the flows.whatsapp.net iframe', () =>
  assert.strictEqual(fd.pickFlowTarget(TARGETS).webSocketDebuggerUrl, 'ws://x/flow'));
it('does NOT return the WhatsApp page itself — that context cannot see into the Flow', () =>
  assert.notStrictEqual(fd.pickFlowTarget(TARGETS).url, 'https://web.whatsapp.com/'));
it('returns null when no Flow is open, rather than falling back to the page', () =>
  assert.strictEqual(fd.pickFlowTarget([TARGETS[0], TARGETS[2]]), null));
it('skips a Flow target with no websocket (not attachable)', () =>
  assert.strictEqual(fd.pickFlowTarget([{ type: 'iframe', url: 'https://flows.whatsapp.net/x' }]), null));
it('tolerates junk in the target list', () => {
  assert.strictEqual(fd.pickFlowTarget(null), null);
  assert.strictEqual(fd.pickFlowTarget([null, undefined, {}]), null);
});

console.log('chooseControl() — which control to click, and refusing the wrong one');
// Real probe output from the training Flow: the same row appears as UL[listbox], LI and BUTTON,
// and the submit is present but disabled until a selection lands.
const ITEMS = [
  { tag: 'UL',     role: 'listbox', disabled: false, cx: 328, cy: 300, text: 'NIETE 4 levels · 25% · 9/36 courses' },
  { tag: 'LI',     role: null,      disabled: false, cx: 328, cy: 300, text: 'NIETE 4 levels · 25% · 9/36 courses' },
  { tag: 'BUTTON', role: null,      disabled: true,  cx: 328, cy: 796, text: 'Open program' },
  { tag: 'BUTTON', role: null,      disabled: false, cx: 620, cy: 32,  text: '' },
];
it('matches a control by its visible text', () =>
  assert.strictEqual(fd.chooseControl(ITEMS, /NIETE/).cy, 300));
it('NEVER returns a disabled control — clicking one is a silent no-op that reads as a hang', () =>
  assert.strictEqual(fd.chooseControl(ITEMS, /Open program/), null));
it('ignores controls with no text so a blank icon button is never picked by accident', () =>
  assert.strictEqual(fd.chooseControl(ITEMS, /^$/), null));
it('prefers the innermost clickable when a row is reported as UL+LI+BUTTON', () => {
  // The listbox wrapper spans every row; clicking its centre can land on the wrong row.
  const c = fd.chooseControl(ITEMS, /NIETE/);
  assert.notStrictEqual(c.tag, 'UL', 'must not pick the listbox wrapper');
});
it('returns null rather than guessing when nothing matches', () =>
  assert.strictEqual(fd.chooseControl(ITEMS, /Nonexistent/), null));

console.log('isSubmitEnabled() — the readback that proves a selection registered');
// A synthetic .click() inside the iframe selects visually but React ignores it, leaving the
// submit disabled. That readback is the ONLY thing separating "driven" from "looked driven".
it('reports enabled once the submit is no longer disabled', () =>
  assert.strictEqual(fd.isSubmitEnabled([{ text: 'Open program', disabled: false }], /Open program/), true));
it('reports NOT enabled while the submit is still disabled', () =>
  assert.strictEqual(fd.isSubmitEnabled([{ text: 'Open program', disabled: true }], /Open program/), false));
it('an absent submit is not enabled — never optimistic', () =>
  assert.strictEqual(fd.isSubmitEnabled([], /Open program/), false));

console.log('classifyScreen() — which Flow screen am I on?');
it('names the training program picker', () =>
  assert.strictEqual(fd.classifyScreen('Choose a program ... Pick a program to open its levels'), 'program-picker'));
it('names a level list from its locked markers', () =>
  assert.strictEqual(fd.classifyScreen('Level 0 · Aspiring Teacher — Take exam Level 1 — 🔒 Locked'), 'level-list'));
it('names the LP class picker from the CHAT card wording', () =>
  assert.strictEqual(fd.classifyScreen('Pick your class, subject and chapter'), 'lp-class-picker'));
it('names the LP class picker from the FLOW\'s own text (read live 2026-08-26)', () =>
  // First contact returned 'unknown': the classifier had been written from the chat card's
  // copy, but the Flow itself says "📘 Lesson Plans / Grade 1 Tap to open".
  assert.strictEqual(fd.classifyScreen('📘 Lesson Plans 📘 Lesson Plans Grade 1 Tap to open Grade 2 Tap to open'), 'lp-class-picker'));
it('names a registration screen', () =>
  assert.strictEqual(fd.classifyScreen('Full Name Country Next'), 'registration'));
it('falls back to unknown rather than mislabelling', () =>
  assert.strictEqual(fd.classifyScreen('something else entirely'), 'unknown'));
it('never throws on empty input', () =>
  assert.strictEqual(fd.classifyScreen(''), 'unknown'));

console.log('attach() must never hang OR throw — both were real, both were found live');
// Two separate faults, 2026-08-26:
//   1. a closed Flow's iframe target LINGERS in /json/list with a socket that never opens.
//      attach() awaited onopen unconditionally and HUNG the run. A hang reports nothing and
//      cannot be retried, so it is strictly worse than an error.
//   2. with Chrome shut down entirely, fetch threw ECONNREFUSED straight out of attach() and
//      took the caller with it. A closed Chrome is as ordinary as a closed Flow.
// Both now resolve to null. DEAD_PORT makes this deterministic — the first version of this
// test passed only because a Chrome happened to be running, which is no test at all.
const DEAD_PORT = 9;
const asyncIt = async (name, fn) => {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
};
await asyncIt('returns null (not a throw) when nothing is listening at all', async () => {
  const r = await fd.attach(DEAD_PORT, { attachTimeoutMs: 300 });
  assert.strictEqual(r, null);
});
await asyncIt('returns promptly rather than blocking', async () => {
  const t0 = Date.now();
  await fd.attach(DEAD_PORT, { attachTimeoutMs: 300 });
  assert.ok(Date.now() - t0 < 8000, 'attach must not block; took ' + (Date.now() - t0) + 'ms');
});
await asyncIt('step() surfaces NO_FLOW_OPEN instead of exploding', async () => {
  const r = await fd.step(/anything/, { port: DEAD_PORT });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.err, 'NO_FLOW_OPEN');
});


// ── PROBE_JS must not cut a control's text short of its marker (bd-u0d0x) ──────────────
//
// The training module picker labels each row "<module> <course> · ▶ Next up" / "· ✓ Passed" /
// "· 🔒 Locked". A 60-char cap on item text turned "Establishing classroom routines Classroom
// Management · ▶ Next up" into "…Management · ▶ Nex", so training.cjs's /▶\s*Next up/ never
// matched and the whole module-check cluster reported BLOCKED "every module finished" — on an
// account whose Level 0 progress had just been verified at 0/46 rows (2026-09-08). The probe
// runs in the browser, so it is executed here against a minimal fake document: the real
// PROBE_JS code path, not a grep of its source.
it('PROBE_JS keeps a long picker row\'s trailing "▶ Next up" marker', () => {
  const label = 'Establishing classroom routines Classroom Management · ▶ Next up';   // 66 chars
  assert.ok(label.length > 60, 'fixture must exceed the old cap');
  const el = { tagName: 'BUTTON', innerText: label, value: '', disabled: false,
               getAttribute: () => null, getBoundingClientRect: () => ({ x: 10, y: 20, width: 300, height: 40 }) };
  const fakeDocument = { body: { innerText: 'Pick a module to watch ' + label },
                         querySelectorAll: () => [el] };
  const out = JSON.parse(new Function('document', 'return ' + fd.PROBE_JS)(fakeDocument));
  assert.strictEqual(out.items.length, 1);
  assert.ok(/▶\s*Next up$/.test(out.items[0].text),
    'item text lost its marker: ' + JSON.stringify(out.items[0].text));
});

console.log('\n' + passed + ' assertions passed');
})();
