#!/usr/bin/env node
/* cdp-eval.cjs — evaluate one JS expression in the live WhatsApp Web tab over CDP and print the JSON value.
 * Used by run-suite.sh for its "is the target chat open?" precondition; handy for a one-off read.
 *   node cdp-eval.cjs '<expression>' [--port 9223]           (a returned Promise is awaited) */
'use strict';
const argv = process.argv.slice(2);
const pi = argv.indexOf('--port'); const port = pi >= 0 ? Number(argv[pi + 1]) : Number(process.env.CDP_PORT || 9223);
const expr = argv.filter((a, i) => a !== '--port' && (pi < 0 || i !== pi + 1))[0];
if (!expr) { console.error('usage: cdp-eval.cjs <expression> [--port N]'); process.exit(2); }
(async () => {
  const ts = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const t = ts.find(x => x.type === 'page' && /web\.whatsapp\.com/.test(x.url || '') && x.webSocketDebuggerUrl);
  if (!t) { console.error('no web.whatsapp.com page on port ' + port); process.exit(1); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; setTimeout(() => rej(new Error('ws open timeout')), 5000); });
  const done = new Promise(res => { ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id === 1) res(m); }; });
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true, timeout: 20000 } }));
  const m = await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error('evaluate timeout')), 25000))]);
  ws.close();
  if (m.error || (m.result && m.result.exceptionDetails)) { console.error(JSON.stringify(m.error || m.result.exceptionDetails).slice(0, 300)); process.exit(1); }
  const v = m.result && m.result.result ? m.result.result.value : undefined;
  console.log(typeof v === 'string' ? v : JSON.stringify(v));
})().catch(e => { console.error(String(e.message || e)); process.exit(1); });
