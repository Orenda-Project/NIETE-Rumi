#!/usr/bin/env node
/* cdp-drive.mjs — drive WhatsApp Web over CDP with no MCP browser tools.
 * open <digits> | inject | eval [file] | click <text> | upload <file> [menu] */
import { readFileSync } from 'node:fs';
const PORT = process.env.CDP_PORT || 9223;
const base = `http://127.0.0.1:${PORT}`;
async function connect() {
  const ts = await (await fetch(`${base}/json/list`)).json();
  const t = ts.find(x => x.type === 'page' && /web\.whatsapp\.com/.test(x.url || ''));
  if (!t) throw new Error('no web.whatsapp.com target on ' + PORT);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws failed')); });
  let id = 0; const pend = new Map(); let chooser = null;
  ws.onmessage = e => { const o = JSON.parse(e.data);
    if (o.method === 'Page.fileChooserOpened') { chooser = o.params; return; }
    const f = pend.get(o.id); if (f) { pend.delete(o.id); f(o); } };
  const send = (m, p) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const evalIn = async (expr, awaitPromise = true) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    const res = r.result || {};
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || 'page exception');
    return res.result?.value;
  };
  return { send, evalIn, close: () => ws.close(), chooser: () => chooser };
}
/** Trusted click. Skips our OWN bubbles — a sent Flow reply echoes the CTA label. */
async function realClick(c, text) {
  const box = await c.evalIn(`(() => {
    const re = new RegExp(${JSON.stringify(text)}.replace(/[.*+?^\${}()|[\\]\\\\]/g,'\\\\$&'), 'i');
    const scope = document.querySelector('#main') || document;
    const els = [...scope.querySelectorAll('button,div[role="button"],[role="listitem"],a')]
      .filter(e => re.test((e.innerText||e.getAttribute('aria-label')||'').trim()))
      .filter(e => e.getAttribute('aria-disabled') !== 'true' && !e.disabled)
      .filter(e => { const row = e.closest('div[role="row"]'); if (!row) return true;
        if (/Response sent/i.test(row.innerText||'')) return false;
        return !row.querySelector('[data-icon^="msg-check"],[data-icon^="msg-dblcheck"],[data-icon^="msg-time"]'); });
    const el = els[els.length-1];
    if (!el) return null;
    el.scrollIntoView({block:'center'});
    const r = el.getBoundingClientRect();
    return JSON.stringify({x:r.x+r.width/2, y:r.y+r.height/2, label:(el.innerText||'').trim().slice(0,40)});
  })()`);
  if (!box) return { ok: false, err: 'NO_MATCH:' + text };
  const { x, y, label } = JSON.parse(box);
  for (const type of ['mouseMoved','mousePressed','mouseReleased'])
    await c.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
  return { ok: true, clicked: label };
}
const [,, cmd, ...rest] = process.argv;
const c = await connect();
try {
  if (cmd === 'open') {
    await c.send('Page.navigate', { url: `https://web.whatsapp.com/send?phone=${rest[0]}` });
    await new Promise(r => setTimeout(r, 11000));
    console.log(await c.evalIn(`JSON.stringify((()=>{const comp=document.querySelector('div[contenteditable="true"][aria-label^="Type a message"]');
      return {main:!!document.getElementById('main'), composer: comp && comp.getAttribute('aria-label')};})())`));
  } else if (cmd === 'inject') {
    const src = readFileSync(new URL('./wa-drive.js', import.meta.url), 'utf8');
    console.log(await c.evalIn(`(()=>{ ${src}\n; return typeof window.__wa==='object' ? 'wa-drive ready: '+Object.keys(window.__wa).length+' helpers' : 'FAILED'; })()`, false));
  } else if (cmd === 'eval') {
    const body = rest[0] ? readFileSync(rest[0], 'utf8') : readFileSync(0, 'utf8');
    console.log(await c.evalIn(`(async()=>{ const wa = window.__wa; const r = await (async()=>{${body}})(); return JSON.stringify(r ?? null); })()`));
  } else if (cmd === 'click') {
    console.log(JSON.stringify(await realClick(c, rest.join(' '))));
  } else {
    console.log('usage: open <digits> | inject | eval [file] | click <text>');
  }
} finally { c.close(); }
