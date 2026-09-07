#!/usr/bin/env node
/* feature-runner.cjs — run an ENTIRE feature's @e2e scenarios in ONE process.
 *
 * WHY. The 2026-08-26 `all` run took 213 min, of which only 26 min (12%) was waiting on the
 * bot. The rest was agent<->tool round trips: ~400 of them, each costing ~25-30s of agent
 * latency regardless of what it did. Driving step-by-step from the agent is the cost.
 * Here the unit of work is a FEATURE: connect once, drive every scenario, emit JSON.
 *
 *   node feature-runner.cjs <feature> [--port 9223]
 *
 * Each scenario is timed, so the output doubles as the cost ledger the efficiency gate needs.
 */
const path = require('path');
const PORT = Number((process.argv.find(a => a.startsWith('--port=')) || '').split('=')[1] || process.env.CDP_PORT || 9223);
const FEATURE = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { readFileSync, appendFileSync, mkdirSync, writeFileSync } = require('fs');
const { execFileSync } = require('child_process');
const REPO = path.resolve(__dirname, '..', '..', '..');
const ENV = process.env.E2E_ENV || 'staging';
const PROGRESS = process.env.E2E_PROGRESS || `/tmp/e2e-progress-${FEATURE}.log`;
const trace = (msg) => { try { appendFileSync(PROGRESS, `${new Date().toISOString().slice(11,23)} ${msg}\n`); } catch (_) {} };

async function connect() {
  const ts = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const t = ts.find(x => x.type === 'page' && /web\.whatsapp\.com/.test(x.url || ''));
  if (!t) throw new Error('no web.whatsapp.com target on ' + PORT);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map();
  let chooser = null;
  // If Chrome drops the socket mid-feature every pending evaluate hangs forever, the event loop
  // drains, and node exits 0 with NOTHING written — a zero-byte result that looks like a crash-free
  // run (coaching verify4, 2026-09-02 09:13Z). Reject the pending calls so the runner's finally
  // block records RUNNER ERROR with the reason instead.
  ws.onclose = () => { for (const [, f] of pend) f({ error: { message: 'CDP socket closed' } }); pend.clear(); };
  ws.onerror = () => { for (const [, f] of pend) f({ error: { message: 'CDP socket error' } }); pend.clear(); };
  ws.onmessage = e => { const o = JSON.parse(e.data);
    if (o.method === 'Page.fileChooserOpened') { chooser = o.params; return; }
    const f = pend.get(o.id); if (f) { pend.delete(o.id); f(o); } };
  const send = (m, p) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });

  const ev = async (expr, awaitPromise = true) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    // A CDP-level failure comes back as {error}, NOT {result} — returning undefined here made
    // every caller fail later with an opaque "cannot set property of undefined".
    if (r.error) throw new Error('CDP error: ' + JSON.stringify(r.error).slice(0, 200));
    const res = r.result || {};
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error('page threw: ' + String(d.exception && d.exception.description || d.text).slice(0, 300));
    }
    if (!res.result || res.result.type === 'undefined')
      throw new Error('evaluate returned undefined for: ' + expr.slice(0, 120).replace(/\s+/g, ' '));
    return res.result.value;
  };
  await send('Page.enable', {}); await send('DOM.enable', {});
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  return { send, ev, close: () => ws.close(), chooser: () => chooser, clearChooser: () => { chooser = null; } };
}


/** Page-side snippet: the ids of every message row currently in the DOM.
 *  Row COUNT is unusable (WhatsApp virtualises, so it stays flat) and reply TEXT is unusable
 *  (an identical card repeating re-matches the previous reply). Both produced 90s timeouts on
 *  replies that had already landed. data-id is unique and stable, so "2 new ids since I started"
 *  = my own message + the bot's reply, regardless of either problem. */
const IDS = `[...document.querySelectorAll('#main div[role="row"] [data-id]')].map(e=>e.getAttribute('data-id'))`;

/** Pick the bot's reply out of the rows that appeared since `before`.
 *  readLast(1) was returning OUR OWN message whenever the bot had not replied, which
 *  turned "no answer" into a passing verdict (COA11, 2026-09-01). Never use it. */
const PICK_REPLY = (beforeVar, excludeExpr, mode = 'line') => `(()=>{
const fresh = ${IDS}.filter(id=>!${beforeVar}.has(id));
const ex = ${excludeExpr}, exMode = ${JSON.stringify(mode)};
const rows = [...document.querySelectorAll('#main div[role="row"]')]
  .map(r=>{const e=r.querySelector('[data-id]');
           return {id:e&&e.getAttribute('data-id'), el:r, txt:(r.innerText||'').trim()};})
  .filter(x=>x.id && fresh.includes(x.id))
  .filter(x=>!x.el.querySelector('[data-icon^="msg-check"],[data-icon^="msg-dblcheck"],[data-icon^="msg-time"]'))
  .filter(x=>{
    if(!ex) return true;
    // 'line'     — my own row for a tap/pick: its FIRST LINE is exactly the label.
    // 'contains' — my own row for an upload: the file card carries the filename.
    // Excluding every row that merely CONTAINS the label threw the real reply away:
    // tapping "No" hid "No problem! If you'd like to analyze…". (2026-09-01.)
    if(exMode === 'contains') return x.txt.indexOf(ex) === -1;
    return x.txt.split(String.fromCharCode(10))[0].trim() !== String(ex).trim();
  });
const r = rows[rows.length-1];
if(!r) return {txt:'', btns:[], mineOnly:true};
return { txt:r.txt,
         btns:[...new Set([...r.el.querySelectorAll('button,div[role="button"]')]
                .map(b=>(b.getAttribute('aria-label')||b.innerText||'').trim())
                .filter(x=>x&&x.length<40&&!/reaction/i.test(x)))],
         img:!!r.el.querySelector('img[src^="blob:"]'),
         audio:!!r.el.querySelector('audio,[data-icon*="audio"],[aria-label*="voice"i],[data-icon="ptt"]'),
         doc:/\\.pdf|\\.m4a|\\.txt|\\.docx/i.test(r.txt) };
})()`;
/** NOT used for reply detection — receipts render a beat AFTER the bubble, so a just-sent
 *  row briefly looks inbound and the wait returns instantly. (wa-drive's own header warns
 *  about exactly this; I re-made the mistake.) Kept only for diagnostics.
 *  Ids of INBOUND rows only. "2 new ids since I started" was satisfied by (my message) +
 *  (a late reply to the PREVIOUS send), so a rapid sequence of sends marched on before each
 *  card arrived and four scenarios asserted against the wrong message. A delivery receipt
 *  renders only on OUR rows, so its absence identifies the bot's. */
const IN_IDS = `[...document.querySelectorAll('#main div[role="row"]')]
  .filter(r=>!r.querySelector('[data-icon^="msg-check"],[data-icon^="msg-dblcheck"],[data-icon^="msg-time"]'))
  .map(r=>{const e=r.querySelector('[data-id]');return e&&e.getAttribute('data-id');})
  .filter(Boolean)`;
const WAIT_REPLY = (timeoutMs) => `(async()=>{
  const wa=window.__wa;
  const before = new Set(${'${IDS}'});
  const t0 = Date.now();
  while (Date.now()-t0 < ${'${timeoutMs}'}) {
    const now = ${'${IDS}'};
    const fresh = now.filter(id => !before.has(id));
    if (fresh.length >= 2) return JSON.stringify({ok:true, waitedMs:Date.now()-t0, fresh:fresh.length});
    await new Promise(r=>setTimeout(r,500));
  }
  return JSON.stringify({ok:false, waitedMs:Date.now()-t0, fresh:${'${IDS}'}.filter(id=>!before.has(id)).length});
})()`;

/** The page-side API each feature script gets. */
function makeApi(c) {
  const J = v => (typeof v === 'string' ? JSON.parse(v) : v);
  const FL = require(path.join(__dirname, 'flow-lib.cjs'));
  let flow = null;

  /** Every Flow op goes through this. flow-drive's evaluate has no timeout, so if a screen
   *  transition swaps the iframe target the held connection waits FOREVER on a target that no
   *  longer exists — a 20-minute silent hang, indistinguishable from "the Flow is slow".
   *  Race each call; on timeout, drop the stale connection, re-attach, retry once. */
  const FLOW_OP_MS = 20000;
  async function withFlow(fn, label) {
    trace('flow-op START ' + label);
    // A Flow screen transition REPLACES the iframe's execution context, and a socket held from the
    // previous screen answers every later op instantly with nothing — no timeout, no error. Pass 3 of
    // 2026-09-02: pick Pakistan (2.7s, real) → Next (2.0s, real) → every op after that "ok" in 1ms
    // and the probe still showed the previous screen. flow-drive's own step() re-attaches per step
    // for exactly this reason (and the Flow does NOT close when a CDP session detaches — proven by
    // driving the same Flow with per-action attach/close all day). So: attach fresh for every op.
    let fresh = null;
    for (let i = 0; i < 4 && !fresh; i++) {           // and PROVE it answers — a stale target attaches fine and says nothing
      const cand = await FL.FD.attach(PORT);
      if (!cand) { await sleep(600); continue; }
      const alive = await Promise.race([cand.evaluate('1').then(() => true).catch(() => false),
                                        new Promise(res => setTimeout(() => res(false), 2500))]);
      if (alive) fresh = cand; else { try { cand.close(); } catch (_) {} await sleep(600); }
    }
    if (fresh) { try { if (flow && flow !== fresh) flow.close(); } catch (_) {} flow = fresh; }
    if (!flow) return { ok: false, err: 'NO_FLOW_OPEN:' + label };
    const race = () => Promise.race([
      fn(flow),
      new Promise((_, rej) => setTimeout(() => rej(new Error('FLOW_OP_TIMEOUT:' + label)), FLOW_OP_MS)),
    ]);
    // For a click/pick, wait for the SCREEN TO CHANGE before returning: a probe 8ms after
    // "Open level" read the program ladder again, and the training driver then reasoned about
    // module state from the wrong screen (T-state/T01 mis-blocked on every pass, 2026-09-02).
    const navigates = /^(click|pick|aria):/.test(label);
    let preText = null;
    if (navigates) { try { preText = (await Promise.race([flow.probe(), new Promise(res => setTimeout(() => res(null), 3000))]) || {}).text || null; } catch (_) {} }
    try {
      const v = await race();
      if (navigates && preText != null) {
        const t1 = Date.now();
        while (Date.now() - t1 < 8000) {
          await sleep(400);
          let cur = null;
          try { const c2 = await FL.FD.attach(PORT); if (!c2) break; cur = await Promise.race([c2.probe(), new Promise(res => setTimeout(() => res(null), 2500))]); c2.close(); } catch (_) { break; }
          if (!cur) break;
          if (cur.text !== preText) break;
        }
      }
      trace('flow-op ok    ' + label); return v;
    }
    catch (e) {
      trace('flow-op TIMEOUT ' + label);
      if (!/FLOW_OP_TIMEOUT/.test(String(e.message))) throw e;
      try { flow.close(); } catch (_) {}
      flow = null;
      for (let i = 0; i < 15 && !flow; i++) { await sleep(1000); flow = await FL.FD.attach(PORT); }
      if (!flow) return { ok: false, err: 'FLOW_GONE:' + label };
      try { const v2 = await race(); trace('flow-op ok(retry) ' + label); return v2; }
      catch (e2) { trace('flow-op FAILED ' + label); return { ok: false, err: String(e2.message).slice(0, 80) }; }
    }
  }

  return {
    ev: c.ev,
    async inject() {
      const src = readFileSync(path.join(__dirname, 'wa-drive.js'), 'utf8');
      return c.ev(`(()=>{ ${src}\n; window.__wa.leanCSS(false); return typeof window.__wa==='object'; })()`, false);
    },
    /** Count-based wait. Matching on reply TEXT re-matches the PREVIOUS reply when the same
     *  card repeats, which is how 7 waits "timed out" on a reply that had already arrived. */
    async sendWait(text, timeoutMs = 90000) {
      trace('send START ' + JSON.stringify(text).slice(0,40));
      const t0 = Date.now();
      const r = await c.ev(`(async()=>{
        const wa=window.__wa; wa.restore();
        // Quiesce first: with a reply still in flight from the PREVIOUS send, "2 new ids"
        // is satisfied by my message + that stale reply, and the run marches on before this
        // card arrives. Wait until the transcript stops changing, THEN send.
        let q = ${IDS}.length, qStable = 0;
        for (let i = 0; i < 40 && qStable < 4; i++) {
          await new Promise(r=>setTimeout(r,500));
          const n = ${IDS}.length;
          qStable = (n === q) ? qStable + 1 : 0;
          q = n;
        }
        const before = new Set(${IDS});
        wa.send(${JSON.stringify(text)});
        await new Promise(r=>setTimeout(r,350));
        const f=document.querySelector('#main footer');
        const b=f&&f.querySelector('[data-icon="wds-ic-send-filled"],[data-icon="send"]');
        if(b)(b.closest('button,div[role="button"],[role="button"]')||b).click();
        const s0=Date.now();
        while (Date.now()-s0 < ${timeoutMs}) {
          if (${IDS}.filter(id=>!before.has(id)).length >= 2) break;
          await new Promise(r=>setTimeout(r,500));
        }
        const waitedMs = Date.now()-s0;
        const fresh = ${IDS}.filter(id=>!before.has(id));
        // Pick the REPLY deterministically. readLast(1) can hand back my own row, and every
        // mine/not-mine heuristic here is unreliable (receipts lag the bubble, tails only render
        // on the first message of a run). I know exactly which ids are new, and which text I
        // sent — the reply is the new row that is not the one carrying my text.
        const sent = ${JSON.stringify(text)}.trim();
        const freshRows = [...document.querySelectorAll('#main div[role="row"]')]
          .map(r=>{const e=r.querySelector('[data-id]');
                   return {id:e&&e.getAttribute('data-id'), txt:(r.innerText||'').trim(), el:r};})
          .filter(x=>x.id && fresh.includes(x.id));
        const replyRow = freshRows.filter(x=>!(sent && x.txt.startsWith(sent))).pop();
        const last = replyRow
          ? {txt: replyRow.txt,
             btns: [...new Set([...replyRow.el.querySelectorAll('button,div[role="button"]')]
                     .map(b=>b.getAttribute('aria-label')||b.innerText).filter(Boolean)
                     .filter(t=>t.length<45 && !/reaction|Read|Delivered|Sent/i.test(t)))]}
          : {txt:'', btns:[], mineOnly:true};   // no reply is NO REPLY — never fall back to my own row
        return JSON.stringify({ok:fresh.length>=2 && !last.mineOnly, waitedMs, freshIds:fresh.length,
          txt:(last.txt||''), btns:(last.btns||[]).filter(x=>x!=='React')});
      })()`);
      const o = J(r); o.wallMs = Date.now() - t0; trace('send ok    ' + JSON.stringify(text).slice(0,30) + ' waited=' + o.waitedMs); return o;
    },
    async tapAndWait(label, timeoutMs = 90000) {
      const r = await c.ev(`(async()=>{
        const wa=window.__wa; wa.restore();
        const before = new Set(${IDS});
        const t = wa.tap(${JSON.stringify(label)});
        if(!t.ok) return JSON.stringify({ok:false,err:t.err});
        const s0=Date.now();
        while (Date.now()-s0 < ${timeoutMs}) {
          if (${IDS}.filter(id=>!before.has(id)).length >= 2) break;
          await new Promise(r=>setTimeout(r,500));
        }
        await new Promise(r=>setTimeout(r,1200));
        const last = ${PICK_REPLY("before", JSON.stringify(String(label)))};
        return JSON.stringify({ok:!last.mineOnly, waitedMs:Date.now()-s0, tapped:t.tapped,
          newIds:${IDS}.filter(id=>!before.has(id)).length,
          txt:(last.txt||''), btns:(last.btns||[])});
      })()`);
      return J(r);
    },
    /** Open an interactive-list dialog and read its rows without leaving the process. */
    async openList(opener) {
      const r = await c.ev(`(async()=>{
        const wa=window.__wa; wa.restore();
        const t = wa.tap(${JSON.stringify(opener)});
        let dlg=null;
        for (let i=0;i<40 && !dlg;i++){ await new Promise(r=>setTimeout(r,250));
          const d=document.querySelector('div[role="dialog"]');
          if (d && d.querySelectorAll('[role="radio"]').length) dlg=d; }
        if(!dlg) return JSON.stringify({ok:false,err:'NO_DIALOG',tap:t});
        const rows=[...dlg.querySelectorAll('[role="radio"]')].map(r=>{
          let a=r; for(let k=0;k<6;k++){if(a.parentElement){a=a.parentElement;if((a.innerText||'').trim())break;}}
          return (a.innerText||'').trim().split('\\n')[0];});
        return JSON.stringify({ok:true, rows, all:(dlg.innerText||'')});
      })()`);
      return J(r);
    },
    async pickRowAndWait(row, timeoutMs = 90000) {
      const r = await c.ev(`(async()=>{
        const wa=window.__wa;
        const picked = wa.pickListRow(${JSON.stringify(row)});
        await new Promise(r=>setTimeout(r,700));
        const before = new Set(${IDS});
        const s = wa.sendDialog();
        if(!s.ok) return JSON.stringify({ok:false,err:'NO_SEND_ICON',picked});
        const s0=Date.now();
        while (Date.now()-s0 < ${timeoutMs}) {
          if (${IDS}.filter(id=>!before.has(id)).length >= 2) break;
          await new Promise(r=>setTimeout(r,500));
        }
        await new Promise(r=>setTimeout(r,1200));
        const last = ${PICK_REPLY("before", JSON.stringify(String(row)))};
        return JSON.stringify({ok:!last.mineOnly, waitedMs:Date.now()-s0, picked,
          newIds:${IDS}.filter(id=>!before.has(id)).length,
          txt:(last.txt||''), btns:(last.btns||[])});
      })()`);
      return J(r);
    },
    async closeDialog() {
      return c.ev(`(()=>{const d=document.querySelector('div[role="dialog"]');
        if(!d) return false; const x=d.querySelector('[aria-label="Close"],[data-icon="x"]');
        if(x)(x.closest('button,div[role="button"]')||x).click(); return true;})()`);
    },

    // ---- native Flow ----------------------------------------------------------------
    // The Flow iframe is a SEPARATE CDP target. It also dies when its CDP session detaches,
    // so the connection is opened here and held for the whole feature — never per-step.
    /** Real-click the CTA on the NEWEST INBOUND card, then attach to the Flow. A sent Flow
     *  reply echoes the CTA label inside an outgoing row, and clicking that echo does nothing;
     *  a CTA on a stale card opens a Flow that closes again within seconds. */
    async openFlow(ctaPattern, opts) {
      trace('openFlow START ' + ctaPattern);
      opts = opts || {};
      const box = await c.ev(`(()=>{
        const re = new RegExp(${JSON.stringify(String(ctaPattern))}, 'i');
        const rows=[...document.querySelectorAll('#main div[role="row"]')];
        for(let i=rows.length-1;i>=0;i--){ const r=rows[i];
          if(/Response sent/i.test(r.innerText||'')) continue;
          if(r.querySelector('[data-icon^="msg-check"],[data-icon^="msg-dblcheck"],[data-icon^="msg-time"]')) continue;
          const b=[...r.querySelectorAll('button,div[role="button"]')]
            .find(x=>re.test((x.innerText||'').trim()));
          if(b){ b.scrollIntoView({block:'center'});
            const q=b.getBoundingClientRect();
            return JSON.stringify({x:q.x+q.width/2,y:q.y+q.height/2,label:(b.innerText||'').trim().slice(0,30)}); } }
        return null;})()`).catch(() => null);
      if (!box) return { ok: false, err: 'NO_FRESH_CTA:' + ctaPattern };
      const B = JSON.parse(typeof box === 'string' ? box : JSON.stringify(box));
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
        await c.send('Input.dispatchMouseEvent', { type, x: B.x, y: B.y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
      // Whole-open deadline. waitReady used to loop unbounded: one L10 open burned 523s
      // (2026-08-31) before reporting HALF-RENDERED. Cap it and say so.
      const OPEN_MS = 75000, t0 = Date.now();
      let fc = null;
      while (!fc && Date.now() - t0 < 30000) {
        await sleep(1200);
        const cand = await FL.FD.attach(PORT);
        if (!cand) continue;
        // A CLOSED Flow's iframe target lingers in /json/list. Attaching to it "works" and its dead
        // document even probes as stable text, so openFlow reported ok for a Flow that never opened
        // (L03 2026-09-02: no INIT on the bot side, yet "openFlow ok" 2.8s after clicking a spent
        // card). Only a target that answers is a Flow.
        const alive = await Promise.race([cand.evaluate('1').then(() => true).catch(() => false),
                                          new Promise(res => setTimeout(() => res(false), 2500))]);
        if (alive) fc = cand; else { try { cand.close(); } catch (_) {} }
      }
      if (!fc) return { ok: false, err: 'FLOW_NEVER_OPENED', clicked: B.label, waitedMs: Date.now() - t0 };
      let p = null;
      try {
        p = await Promise.race([FL.waitReady(fc, 40, PORT),
          new Promise((_, rej) => setTimeout(() => rej(new Error('READY_TIMEOUT')),
                                             Math.max(5000, OPEN_MS - (Date.now() - t0))))]);
      } catch (e) {
        trace('openFlow READY_TIMEOUT after ' + Math.round((Date.now() - t0) / 1000) + 's');
        flow = fc;
        return { ok: false, err: 'FLOW_READY_TIMEOUT', clicked: B.label, waitedMs: Date.now() - t0 };
      }
      // waitReady re-attaches per poll and hands back the connection it last probed with. A socket
      // that waitReady closed answers every later op instantly with nothing (pass 2 of 2026-09-02:
      // pick/click/type all "ok" in 1ms, none happened). Prove the connection is live before use.
      flow = (p && p.__conn) || fc;
      for (let i = 0; i < 5; i++) {
        const alive = await Promise.race([flow.evaluate('1').then(() => true).catch(() => false),
                                          new Promise(res => setTimeout(() => res(false), 3000))]);
        if (alive) break;
        try { flow.close(); } catch (_) {}
        await sleep(800);
        flow = (await FL.FD.attach(PORT)) || flow;
      }
      if (p) delete p.__conn;
      if (!p || !p.items || p.items.length < 2) {   // half-rendered: refuse rather than assert on it
        trace('openFlow HALF-RENDERED');
        return { ok: false, err: 'FLOW_NOT_RENDERED', clicked: B.label,
                 waitedMs: Date.now() - t0, screen: (p && p.text || '').slice(0, 90) };
      }
      trace('openFlow ok');
      return { ok: true, clicked: B.label, screen: p.text.slice(0, 110), items: p.items.length };
    },
    flow: () => flow,
    /** A native Flow REMEMBERS its screen across opens — reopening after a previous run resumed
     *  on Professional Info instead of the first screen, so every early assertion compared
     *  against the wrong page. Cancel any open Flow before a feature starts. */
    async resetFlow() {
      // A Flow left open (e.g. /status at its "Stop this? / Yes, stop it" confirm) blocks list dialogs
      // and the Attach menu in the chat, so every later pick/upload fails SILENTLY and nothing reaches
      // the bot (coaching verify3, 2026-09-02 08:37–09:00Z: 0 messages delivered for 20 min). One Cancel
      // click on a stale target is not enough — verify the iframe is GONE, retry, and as a last resort
      // take the confirm button the screen offers.
      let attempts = 0, note = 'no flow open';
      while (attempts < 4) {
        const f = await FL.FD.attach(PORT);
        if (!f) return { ok: true, note, attempts };
        note = 'cancelled an open flow';
        try {
          const alive = await Promise.race([f.evaluate('1').then(() => true).catch(() => false), new Promise(res => setTimeout(() => res(false), 2500))]);
          if (alive) {
            const r = await FL.clickAria(f, 'Cancel', 1500);
            if (!r || !r.ok) { try { await FL.clickText(f, 'Yes, stop it', { settleMs: 1500 }); } catch (_) {} try { await FL.clickAria(f, 'Close', 1000); } catch (_) {} }
          }
        } catch (_) {}
        try { f.close(); } catch (_) {}
        flow = null;
        await sleep(1500);
        attempts++;
      }
      const still = await FL.FD.attach(PORT);
      if (still) { try { still.close(); } catch (_) {} trace('resetFlow: a Flow is STILL open after 4 attempts'); return { ok: false, err: 'FLOW_STILL_OPEN', attempts }; }
      return { ok: true, note, attempts };
    },
    async flowProbe() { const p = await withFlow(async f => { try { return await f.probe(); } catch (_) { return { text:'', items:[] }; } }, 'probe'); return { text: (p && p.text) || '', items: (p && p.items) || [] }; },
    async flowClick(text, o) { return withFlow(f => FL.clickText(f, text, o), 'click:' + text); },
    async flowPick(want, o) { return withFlow(f => FL.pickOption(f, want, o), 'pick:' + want); },
    async flowAria(label, ms) { return withFlow(f => FL.clickAria(f, label, ms), 'aria:' + label); },
    async flowType(text) {
      return withFlow(async f => {
      const p = await f.probe();
      const inp = p.items.find(i => i.tag === 'INPUT' && !i.text);
      if (!inp) return { ok: false, err: 'NO_EMPTY_INPUT' };
      await f.clickAt(inp.cx, inp.cy); await sleep(250);
      await f.typeText(text); await sleep(500);
      return { ok: true, typed: text };
      }, 'type');
    },
    /** Read a control's disabled state back — a selection you did not read back is not a selection. */
    async flowState(labelRe) {
      const p = await withFlow(f => f.probe(), 'state') || { items: [] };
      const it = p.items.find(i => new RegExp(labelRe, 'i').test(i.text));
      return it ? { found: true, text: it.text, disabled: it.disabled } : { found: false };
    },
    closeFlow() { try { if (flow) flow.close(); } catch (_) {} flow = null; },
    /** DB reach-through, so scenarios that assert on PERSISTED state (role written? account
     *  really unregistered?) can be verified in the same run instead of deferred to a human. */
    db(action, extra) {
      trace('db ' + action);
      const script = action === 'lookup'
        ? path.join(REPO, '.claude/qa/shared/niete_training_db.py')
        : path.join(REPO, '.claude/qa/shared/niete_registration_db.py');
      const args = [script, action, '--env', ENV, '--phone', process.env.E2E_DRIVER || '923028931858'];
      if (action !== 'lookup' && action !== 'snapshot') args.push('--yes-write');
      if (extra) args.push(...extra);
      try {
        const out = execFileSync('python3', args, { cwd: REPO, encoding: 'utf8', timeout: 60000 });
        // NOT out.slice(-1500): the USER block is at the TOP of a long lookup, so tailing the
        // output returned the ASSIGNMENTS section and every field parse came back "(not found)".
        const user = (out.match(/USER:\s*\[[\s\S]*?\n\]/) || [''])[0];
        return { ok: true, out, user };
      } catch (e) { return { ok: false, err: String(e.message).slice(0, 200) }; }
    },
    /** Attach a file via Attach -> <menu item>. The Document input does not EXIST until the
     *  menu item is clicked, so DOM.setFileInputFiles has nothing to target beforehand — an
     *  earlier version silently uploaded nothing by grabbing the page's image input instead.
     *  Intercept the chooser the click opens. */
    async upload(file, menuItem, timeoutMs = 90000) {
      trace('upload START ' + menuItem + ' ' + file.split('/').pop());
      // Quiesce exactly as sendWait does. Without this the bot's unsolicited post-plan
      // feedback prompt lands mid-wait and gets attributed to this upload. (2026-08-31.)
      await c.ev(`(async()=>{ let q=${IDS}.length, st=0;
        for(let i=0;i<40&&st<4;i++){ await new Promise(r=>setTimeout(r,500));
          const n=${IDS}.length; st=(n===q)?st+1:0; q=n; }
        return 'q';})()`);
      c.clearChooser();
      // Poll for the menu instead of a fixed sleep: a just-closed Flow iframe swallows the
      // Attach click for a beat, and the old 1800ms sleep turned that into a bogus product FAIL.
      let box = null;
      for (let attempt = 0; attempt < 4 && !box; attempt++) {
        await c.ev(`(()=>{const a=[...document.querySelectorAll('button,[role="button"]')]
          .find(b=>(b.getAttribute('aria-label')||'')==='Attach'); if(a)a.click(); return !!a;})()`);
        for (let i = 0; i < 12 && !box; i++) {
          await sleep(400);
          box = await c.ev(`(()=>{const el=[...document.querySelectorAll('[role="menu"] [role="menuitem"],[role="application"] [role="menuitem"],[role="menuitem"]')]
            .find(x=>(x.innerText||'').trim()===${JSON.stringify(String(menuItem))});
            if(!el) return null; const r=el.getBoundingClientRect();
            if(!r.width||!r.height) return null;
            return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});})()`).catch(() => null);
        }
      }
      // A harness failure must NEVER be scored as a product verdict — throw so the runner
      // records it as ERROR, not as "the bot didn't reply". (L09, 2026-08-31.)
      if (!box) throw new Error('HARNESS upload: attach menu never offered "' + menuItem + '"');
      const B = JSON.parse(typeof box === 'string' ? box : JSON.stringify(box));
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
        await c.send('Input.dispatchMouseEvent', { type, x: B.x, y: B.y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
      let ch = null;
      for (let i = 0; i < 40 && !ch; i++) { await sleep(250); ch = c.chooser(); }
      if (!ch) throw new Error('HARNESS upload: file chooser never opened for ' + file.split('/').pop());
      await c.send('DOM.setFileInputFiles', { files: [file], backendNodeId: ch.backendNodeId });
      await sleep(3000);
      // send it and wait for the bot's reply, same id-based signal as sendWait
      const r = await c.ev(`(async()=>{
        const wa=window.__wa;
        const before = new Set(${IDS});
        const s=document.querySelector('[data-icon="wds-ic-send-filled"],[data-icon="send"]');
        if(!s) return JSON.stringify({ok:false,err:'NO_SEND_BUTTON'});
        ((s.closest('button,div[role="button"]'))||s.parentElement).click();
        const s0=Date.now();
        while (Date.now()-s0 < ${timeoutMs}) {
          if (${IDS}.filter(id=>!before.has(id)).length >= 2) break;
          await new Promise(r=>setTimeout(r,600));
        }
        await new Promise(r=>setTimeout(r,1200));   // let receipts render before classifying
        const last = ${PICK_REPLY("before", JSON.stringify(file.split("/").pop()), "contains")};
        const kind = last.mineOnly ? 'none' : last.audio ? 'audio' : last.doc ? 'document'
          : (last.txt||'').trim() ? 'text' : 'unknown';
        return JSON.stringify({ok:!last.mineOnly, waitedMs:Date.now()-s0,
          newIds:${IDS}.filter(id=>!before.has(id)).length,
          kind, txt:(last.txt||''), btns:(last.btns||[])});
      })()`);
      const o = J(r);
      if (o.err) throw new Error('HARNESS upload: ' + o.err);
      trace('upload ok ' + menuItem); return o;
    },
    async waitStats() { return J(await c.ev(`JSON.stringify(window.__wa.stats())`)); },
    async waitLog() { return c.ev(`window.__wa.waitLog()`); },
  };
}

(async () => {
  const started = Date.now();
  // E2E_METHOD=mock: no browser. The bot runs locally from a pinned commit behind
  // bot/scripts/e2e/mock-graph-api.js, and mock-api.cjs exposes the SAME primitives this file's
  // makeApi() does, so the feature scripts below run unchanged. Default (chrome) is untouched.
  const MOCK = (process.env.E2E_METHOD || 'chrome') === 'mock';
  const c = MOCK ? { close() {} } : await connect();
  const api = MOCK
    ? require(path.join(__dirname, 'mock-api.cjs')).makeMockApi({ baseUrl: process.env.E2E_MOCK_URL, driver: process.env.E2E_DRIVER, env: ENV, repo: REPO, trace })
    : makeApi(c);
  const results = [];
  const rec = (id, name, verdict, evidence, ms) => { trace(`REC ${id} ${verdict} ${Math.round((ms||0)/1000)}s`); results.push({ id, name, verdict, evidence, ms }); };
  try {
    const ok = await api.inject();
    if (!ok) throw new Error('wa-drive failed to inject');
    const mod = require(path.join(__dirname, 'features', FEATURE + '.cjs'));
    await mod.run({ api, rec, sleep });
  } catch (e) {
    results.push({ id: 'RUNNER', verdict: 'ERROR', evidence: String(e && e.message || e) });
  } finally {
    try { api.closeFlow(); } catch (_) {}
    // waitStats is a CDP evaluate with no timeout of its own, and a catch cannot catch a
    // HANG. On 2026-09-01 registration finished every scenario and then sat here for 66
    // minutes, blocking the rest of the suite. Bound it, and never let it be fatal.
    let stats = null;
    try {
      stats = await Promise.race([
        api.waitStats(),
        new Promise(res => setTimeout(() => res({ note: 'waitStats timed out after 15s' }), 15000)),
      ]);
    } catch (_) {}
    try { c.close(); } catch (_) {}
    const wallMs = Date.now() - started;
    const pass = results.filter(r => r.verdict === 'PASS').length;
    const payload = {
      feature: FEATURE, wallMs, wallMin: +(wallMs / 60000).toFixed(2),
      scenarios: results.length, pass,
      fail: results.filter(r => r.verdict === 'FAIL').length,
      other: results.filter(r => !['PASS', 'FAIL'].includes(r.verdict)).length,
      perScenarioSec: results.length ? +(wallMs / 1000 / results.length).toFixed(1) : null,
      botWaitStats: stats, results
    };
    const outDir = process.env.RUN_DIR
      || path.join(__dirname, '..', 'results', 'whatsapp', 'niete', '2026-08-31-feature-runner');
    try {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(path.join(outDir, FEATURE + '.json'), JSON.stringify(payload, null, 1));
    } catch (e) { console.error('could not write result file: ' + e.message); }
    console.log(JSON.stringify(payload, null, 1));
    // An open CDP socket or page handle has kept this process alive past its work before.
    // The payload is written and printed by here, so leaving is always safe.
    setTimeout(() => process.exit(0), 250).unref();
  }
})();
