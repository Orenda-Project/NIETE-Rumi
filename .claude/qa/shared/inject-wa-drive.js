#!/usr/bin/env node
/* inject-wa-drive.js — load wa-drive.js into the live WhatsApp tab over CDP, before the run.
 *
 * WHY (bd-44105). Step 6 of ALL NINE per-feature agents already says, before any send:
 * "Load the driving helpers FIRST … Use wa.sendAndWait(text) … Never write a fixed sleep."
 * It is still skipped:
 *
 *     2026-08-21  never loaded -> hand-rolled setTimeout(9000..20000) per read -> 4h23m
 *     2026-08-25  run.json records "wa_drive_loaded": false
 *
 * Nine instructions did not produce compliance and a tenth will not either. So this removes
 * the agent from the loop: preflight.py injects wa-drive over the same DevTools endpoint the
 * suite already probes, so window.__wa exists whether the agent cooperates or not. Any
 * unattended runner can call this too — it is a standalone CLI on purpose.
 *
 * Mechanism: Node's global WebSocket (built in since Node 21; this repo runs v25) speaks CDP
 * directly — no dependency to install, which matters because neither `websockets` nor
 * `websocket-client` is present for python3 here.
 *
 * Usage:
 *   node inject-wa-drive.js [--port 9223] [--run-dir <dir>] [--match <regex>] [--quiet]
 * Exit 0 on a confirmed load, 1 otherwise. With --run-dir it records wa_drive_loaded in
 * run.json from FIRST-HAND knowledge, rather than taking anyone's word for it.
 *
 * ⚠️ A page reload drops window.__wa (wa-drive says so itself). This covers run start; if the
 * tab reloads mid-run, re-run this. run_efficiency.py catches the after-effect either way,
 * because waits.jsonl goes short or empty.
 *
 * Tests: node test_inject_wa_drive.js   (pure core)
 *        node test_inject_wa_drive.integration.js   (real headless Chrome)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULT_PORTS = [9223, 9222, 9229];
const WA = /web\.whatsapp\.com/i;
const READY = /^wa-drive ready:/;

// ── pure core ────────────────────────────────────────────────────────────────

/** The WhatsApp PAGE target, or null. Never a guess.
 *  A real Chrome answered /json/list with six targets — browser_ui, background_page,
 *  extension pages — and injecting into the wrong one succeeds silently while leaving the
 *  WhatsApp tab without wa.*, which is precisely the failure this file exists to end. */
function pickTarget(targets, match) {
  const re = match || WA;
  if (!Array.isArray(targets)) return null;
  return targets.find(t =>
    t && t.type === 'page' && re.test(t.url || '') && t.webSocketDebuggerUrl) || null;
}

/** wa-drive.js is already a parenthesised IIFE returning the ready string, and
 *  Runtime.evaluate takes an EXPRESSION — so it is passed through unchanged. Re-wrapping it
 *  in a function declaration would evaluate to undefined and classify() would reject it. */
function wrap(src) {
  return String(src);
}

/** Did the injection take? Anything that is not the ready string is a miss, and a miss must
 *  be loud — the whole point is that nobody has to trust the agent's word for it. */
function classify(frame) {
  try {
    if (!frame) return { ok: false, detail: 'no response from the page' };
    if (frame.error) return { ok: false, detail: 'CDP error: ' + (frame.error.message || 'unknown') };
    const r = frame.result || {};
    if (r.exceptionDetails) {
      const e = r.exceptionDetails;
      return { ok: false, detail: 'page threw: ' +
        ((e.exception && e.exception.description) || e.text || 'unknown') };
    }
    const v = r.result || {};
    if (v.type === 'string' && READY.test(v.value)) return { ok: true, detail: v.value };
    return { ok: false, detail: 'unexpected return value: ' + JSON.stringify(v).slice(0, 200) };
  } catch (e) {
    return { ok: false, detail: 'malformed frame: ' + e.message };
  }
}

// ── CDP over the built-in WebSocket ──────────────────────────────────────────

async function httpJSON(url, timeoutMs = 3000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    return await res.json();
  } finally { clearTimeout(t); }
}

async function findPort(ports) {
  for (const p of ports) {
    try { await httpJSON(`http://127.0.0.1:${p}/json/version`); return p; } catch (_) {}
  }
  return null;
}

function evaluateInPage(wsUrl, expression, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (frame) => { if (!done) { done = true; try { ws.close(); } catch (_) {} resolve(frame); } };
    const timer = setTimeout(() => finish({ error: { message: 'timed out after ' + timeoutMs + 'ms' } }), timeoutMs);
    let ws;
    try { ws = new WebSocket(wsUrl); }
    catch (e) { clearTimeout(timer); return resolve({ error: { message: 'cannot open websocket: ' + e.message } }); }
    ws.onopen = () => ws.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: false, userGesture: true },
    }));
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.id === 1) { clearTimeout(timer); finish(msg); }
    };
    ws.onerror = (e) => { clearTimeout(timer); finish({ error: { message: 'websocket error: ' + (e && e.message || 'unknown') } }); };
    ws.onclose = () => { clearTimeout(timer); finish({ error: { message: 'websocket closed before a reply' } }); };
  });
}

/** Record what we know FIRST-HAND. preflight.py writes the flag false on purpose; only an
 *  actual confirmed load may flip it true. */
function recordRunJson(runDir, ok, detail) {
  const p = path.join(runDir, 'run.json');
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(p, 'utf8')) || {}; } catch (_) {}
  meta.wa_drive_loaded = !!ok;
  meta.wa_drive_injected_by = 'inject-wa-drive.js';
  if (detail) meta.wa_drive_detail = String(detail).slice(0, 200);
  try {
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(meta, null, 2) + '\n');
    return true;
  } catch (_) { return false; }
}

async function main(argv) {
  const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const quiet = argv.includes('--quiet');
  const say = (...a) => { if (!quiet) console.log(...a); };

  const ports = arg('--port') ? [Number(arg('--port'))] : DEFAULT_PORTS;
  const match = arg('--match') ? new RegExp(arg('--match'), 'i') : WA;
  const runDir = arg('--run-dir');
  const srcPath = arg('--file', path.join(__dirname, 'wa-drive.js'));

  const port = await findPort(ports);
  if (!port) {
    console.error('inject-wa-drive: no Chrome DevTools endpoint on ' + ports.join(', ') +
                  '. Start Chrome with --remote-debugging-port.');
    if (runDir) recordRunJson(runDir, false, 'no DevTools endpoint');
    return 1;
  }

  let targets;
  try { targets = await httpJSON(`http://127.0.0.1:${port}/json/list`); }
  catch (e) {
    console.error('inject-wa-drive: could not list targets on ' + port + ': ' + e.message);
    if (runDir) recordRunJson(runDir, false, 'target list failed');
    return 1;
  }

  const target = pickTarget(targets, match);
  if (!target) {
    console.error('inject-wa-drive: no attachable ' + match + ' page target on port ' + port +
                  ' (saw ' + (targets || []).length + ' targets). Open web.whatsapp.com and keep it linked.');
    if (runDir) recordRunJson(runDir, false, 'no whatsapp page target');
    return 1;
  }

  let src;
  try { src = fs.readFileSync(srcPath, 'utf8'); }
  catch (e) {
    console.error('inject-wa-drive: cannot read ' + srcPath + ': ' + e.message);
    if (runDir) recordRunJson(runDir, false, 'source unreadable');
    return 1;
  }

  const verdict = classify(await evaluateInPage(target.webSocketDebuggerUrl, wrap(src)));
  if (runDir) recordRunJson(runDir, verdict.ok, verdict.detail);
  if (!verdict.ok) {
    console.error('inject-wa-drive: FAILED — ' + verdict.detail);
    return 1;
  }
  say('inject-wa-drive: ok on port ' + port + ' -> ' + target.url);
  say('  ' + verdict.detail);
  return 0;
}

module.exports = { pickTarget, wrap, classify, recordRunJson, WA, READY };

if (require.main === module) {
  main(process.argv.slice(2)).then(c => { process.exit(c); },
    e => { console.error('inject-wa-drive: ' + (e && e.stack || e)); process.exit(1); });
}
