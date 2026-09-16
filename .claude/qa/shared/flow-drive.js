#!/usr/bin/env node
/* flow-drive.js — drive a native WhatsApp Flow over CDP, with ZERO snapshots.
 *
 * WHY (bd-44106). The chrome-mcp-whatsapp-e2e SKILL and whatsapp-interaction-map.md both say:
 *
 *     "The Flow is a cross-origin iframe (flows.whatsapp.net/flows-v2/wa-web/).
 *      evaluate_script CANNOT reach into it, BUT take_snapshot does expose the iframe's
 *      controls with uids"
 *
 * Measured on the live training Flow 2026-08-26, that is false. The iframe is a SEPARATE CDP
 * TARGET (type:"iframe", with its own webSocketDebuggerUrl). Attach to that target and both
 * Runtime.evaluate and Input.dispatchMouseEvent work INSIDE the Flow. The documented claim is
 * true only of the MCP's evaluate_script, which runs in the top-page context.
 *
 *     documented (take_snapshot + click(uid))   37-86 s per step, 16-24 KB payload
 *     this file (CDP on the iframe target)      1.62 s per step, ZERO snapshots   -> 23-53x
 *
 * That is training's largest single expense: 37.4 min of its 93.5 min, and the
 * "t01 took 17 snapshots" hotspot (14.2 min -> 27.5 s).
 *
 * THE ONE RULE THAT MATTERS: a synthetic .click() inside the iframe selects a row visually but
 * React ignores the untrusted event, so the submit stays DISABLED and the step silently does
 * nothing. Proven live. Every click here is a real Input.dispatchMouseEvent, and every
 * selection is confirmed by reading the submit back — a readback is the only thing separating
 * "driven" from "looked driven".
 *
 * Scope: this owns the IFRAME. wa-drive.js owns chat text/buttons/lists and explicitly does
 * not cover Flows. Use both.
 *
 * CLI:  node flow-drive.js probe|click|screen [--match <re>] [--port 9223]
 * Tests: node test_flow_drive.js  ·  node test_flow_drive.integration.js (real Chrome)
 */
'use strict';

const FLOW_URL = /flows\.whatsapp\.net/i;
const DEFAULT_PORT = 9223;

// ── pure core ────────────────────────────────────────────────────────────────

/** The Flow iframe's own CDP target, or null. Never the page: that context genuinely
 *  cannot see into the cross-origin iframe, which is what the docs were describing. */
function pickFlowTarget(targets) {
  if (!Array.isArray(targets)) return null;
  // NEWEST match, not the first: a stale iframe target lingers in /json/list after its Flow closed
  // (2026-09-02: L01's closed Flow was picked over L03's live one — the Grade 6 click "succeeded"
  // in 3ms against a dead document and the drill-down never reached the bot).
  const hits = targets.filter(t => t && FLOW_URL.test(t.url || '') && t.webSocketDebuggerUrl);
  return hits.length ? hits[hits.length - 1] : null;
}

/** Which control to click for `match`, or null.
 *
 *  Two refusals, both load-bearing:
 *  - a DISABLED control is never returned. Clicking one is a silent no-op that presents as a
 *    product hang (same trap as wa.tap and spent chat CTAs).
 *  - the listbox WRAPPER is never preferred. A real probe reported one row as UL[listbox] +
 *    LI + BUTTON sharing a centre; the UL spans every row, so its centre can land on a
 *    different row than the one matched.
 */
function chooseControl(items, match) {
  if (!Array.isArray(items)) return null;
  const re = match instanceof RegExp ? match : new RegExp(String(match), 'i');
  const hits = items.filter(i => i && i.text && re.test(i.text) && !i.disabled);
  if (!hits.length) return null;
  const rank = c => (c.tag === 'UL' || c.role === 'listbox' ? 2 : c.tag === 'LI' ? 1 : 0);
  return hits.slice().sort((a, b) => rank(a) - rank(b))[0];
}

/** Did the selection actually register? Absent submit counts as NOT enabled — never optimistic. */
function isSubmitEnabled(items, match) {
  if (!Array.isArray(items)) return false;
  const re = match instanceof RegExp ? match : new RegExp(String(match), 'i');
  const s = items.find(i => i && i.text && re.test(i.text));
  return !!s && !s.disabled;
}

/** Which Flow screen is on show. Used to assert a step landed where it should, and to keep the
 *  per-Flow control styles straight (the LP picker is dropdowns, training is a radio listbox,
 *  registration is text inputs). Falls back to 'unknown' rather than mislabelling. */
function classifyScreen(text) {
  const t = String(text || '');
  // Real Flow text, read live 2026-08-26: "📘 Lesson Plans ... Grade 1 Tap to open".
  // The "Pick your class, subject and chapter" wording is the CHAT CARD's, not the Flow's —
  // writing the classifier from the card is why this returned 'unknown' on first contact.
  if (/Lesson Plans[\s\S]*Grade \d|Pick your class|class, subject and chapter/i.test(t)) return 'lp-class-picker';
  if (/Full Name|Organization|Grades you teach:.*Next|Country\s*Next/i.test(t)) return 'registration';
  if (/Choose a program|Pick a program/i.test(t)) return 'program-picker';
  if (/Level \d|🔒 *Locked/i.test(t)) return 'level-list';
  return 'unknown';
}

// ── CDP plumbing ─────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

const PROBE_JS = `(() => {
  const es = [...document.querySelectorAll('button,li,input,select,[role="radio"],[role="option"],[role="button"],[role="listbox"]')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  return JSON.stringify({
    text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 400),
    items: es.map(e => { const r = e.getBoundingClientRect(); return {
      tag: e.tagName, role: e.getAttribute('role'),
      disabled: !!(e.disabled || e.getAttribute('aria-disabled') === 'true'),
      cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2),
      // 200, not 60: the training picker labels a row "<module> <course> · ▶ Next up", and a
      // 60-char cap cut the marker to "▶ Nex" so nothing downstream could see it (bd-u0d0x).
      text: (e.innerText || e.value || '').replace(/\\s+/g, ' ').trim().slice(0, 200) }; })
  });
})()`;

async function targets(port = DEFAULT_PORT) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return await res.json();
}

/** Attach to the Flow iframe. Returns null when no Flow is open — a closed Flow is an ordinary
 *  outcome (the Flow hands back to chat mid-journey), not an error. */
async function attach(port = DEFAULT_PORT, opts = {}) {
  // A closed Chrome is an ORDINARY condition, exactly like a closed Flow — fetch throws
  // ECONNREFUSED and that used to propagate out of attach(), taking the caller with it
  // (caught 2026-08-26 when the suite was verified with the e2e Chrome shut down). Callers
  // already handle null as "no Flow"; give them null here too rather than an exception they
  // have no way to distinguish from a real fault.
  let list;
  try { list = await targets(port); } catch (_) { return null; }
  const t = pickFlowTarget(list);
  if (!t) return null;
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  // TIMEOUT IS LOAD-BEARING (found live 2026-08-26): a stale iframe target still appears in
  // /json/list after its Flow closed, and its websocket never opens. Awaiting onopen with no
  // timeout hung the whole run — strictly worse than an error, because a hang tells the caller
  // nothing and cannot be retried. Resolve to null instead so callers treat it as "no Flow".
  const opened = await new Promise((res) => {
    const timer = setTimeout(() => res(false), opts.attachTimeoutMs != null ? opts.attachTimeoutMs : 5000);
    ws.onopen = () => { clearTimeout(timer); res(true); };
    ws.onerror = () => { clearTimeout(timer); res(false); };
  });
  if (!opened) { try { ws.close(); } catch (_) {} return null; }
  ws.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch (_) { return; }
    if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise(res => {
    const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.result && r.result.exceptionDetails) {
      throw new Error('flow eval threw: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 200));
    }
    return r && r.result && r.result.result ? r.result.result.value : undefined;
  };
  return {
    url: t.url,
    probe: async () => { const v = await evaluate(PROBE_JS); return v ? JSON.parse(v) : { text: '', items: [] }; },
    /** REAL input, not a synthetic click — see the header. */
    clickAt: async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    },
    typeText: async (text) => {
      for (const ch of String(text)) await send('Input.dispatchKeyEvent', { type: 'char', text: ch });
    },
    evaluate,
    close: () => { try { ws.close(); } catch (_) {} },
  };
}

/** Wait until the Flow's own text CHANGES from `beforeText`, or give up.
 *
 *  This replaces a fixed settle. The first version of step() slept a flat 1600 ms and then
 *  re-probed — and on the LP grade picker that returned the OLD screen every time, because the
 *  transition took longer. Reporting the previous screen as the result is worse than slow: it
 *  reads as "the Flow did not advance" when it did. Which is the same fixed-sleep mistake this
 *  whole harness exists to remove, reintroduced one layer down. Adaptive, with the elapsed
 *  time returned so a slow Flow shows up as data. */
async function settle(beforeText, opts = {}) {
  const port = opts.port || DEFAULT_PORT;
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 12000;
  const everyMs = opts.everyMs != null ? opts.everyMs : 400;
  const t0 = Date.now();
  for (;;) {
    await sleep(everyMs);
    let c = null;
    try { c = await attach(port); } catch (_) { c = null; }
    if (!c) {                                   // the Flow handed back to chat mid-journey
      if (Date.now() - t0 >= timeoutMs) return { changed: false, closed: true, waitedMs: Date.now() - t0 };
      continue;
    }
    let p;
    try { p = await c.probe(); } finally { c.close(); }
    if (p && p.text && p.text !== beforeText) return { changed: true, probe: p, waitedMs: Date.now() - t0 };
    if (Date.now() - t0 >= timeoutMs) return { changed: false, probe: p, waitedMs: Date.now() - t0 };
  }
}

/** One Flow step: probe, click the match with real input, then wait for the screen to actually
 *  change. Reconnects each time because navigating replaces the iframe's execution context. */
async function step(match, opts = {}) {
  const port = opts.port || DEFAULT_PORT;
  const t0 = Date.now();
  const c = await attach(port);
  if (!c) return { ok: false, err: 'NO_FLOW_OPEN', ms: Date.now() - t0 };
  let before;
  try { before = await c.probe(); } catch (e) { c.close(); return { ok: false, err: e.message, ms: Date.now() - t0 }; }
  const target = chooseControl(before.items, match);
  if (!target) {
    c.close();
    return { ok: false, err: 'NO_ENABLED_CONTROL', match: String(match),
             screen: classifyScreen(before.text), options: before.items.map(i => i.text).filter(Boolean),
             ms: Date.now() - t0 };
  }
  await c.clickAt(target.cx, target.cy);
  c.close();
  const st = await settle(before.text, { port, timeoutMs: opts.timeoutMs });
  const after = st.probe || { text: st.closed ? '(flow handed back to chat)' : '', items: [] };
  return {
    ok: true, clicked: target.text, ms: Date.now() - t0,
    settleMs: st.waitedMs, advanced: st.changed, closed: !!st.closed,
    screen: classifyScreen(after.text),
    submitEnabled: opts.submit ? isSubmitEnabled(after.items, opts.submit) : undefined,
    options: [...new Set((after.items || []).map(i => i.text).filter(Boolean))],
  };
}

module.exports = { pickFlowTarget, chooseControl, isSubmitEnabled, classifyScreen,
                   attach, step, settle, targets, sleep, FLOW_URL, PROBE_JS };

if (require.main === module) {
  (async () => {
    const argv = process.argv.slice(2);
    const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
    const port = Number(arg('--port', DEFAULT_PORT));
    const cmd = argv[0] || 'probe';
    if (cmd === 'click') {
      console.log(JSON.stringify(await step(new RegExp(arg('--match', '.'), 'i'),
        { port, submit: arg('--submit') }), null, 1));
      return;
    }
    const c = await attach(port);
    if (!c) { console.error('flow-drive: no Flow iframe open on port ' + port); process.exit(1); }
    const p = await c.probe(); c.close();
    if (cmd === 'screen') return console.log(classifyScreen(p.text));
    console.log(JSON.stringify({ screen: classifyScreen(p.text), text: p.text.slice(0, 200),
      items: p.items.filter(i => i.text) }, null, 1));
  })().catch(e => { console.error('flow-drive: ' + (e && e.message || e)); process.exit(1); });
}
