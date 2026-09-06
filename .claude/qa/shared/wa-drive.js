/* wa-drive.js — shared WhatsApp-Web driving primitives for the NIETE Chrome-MCP E2E suite.
 *
 * WHY: every per-feature agent used to re-describe send / read / wait / tap in prose, and
 * only the grand-quiz path (grandquiz_exam_drive.js) had real code. That caused (a) blind
 * fixed sleeps → false FAILs on slow replies + wasted wall-clock on fast ones, and (b) the
 * lean-snapshot / stale-uid tricks living in only one agent. This centralizes all of it.
 *
 * ⚠️ LOAD THIS FIRST, EVERY RUN. The 2026-08-21 `all` run took 4h and never loaded this file —
 * the agent hand-rolled inline `setTimeout(…, 9000..20000)` for every read instead. Sized for
 * the worst case, that alone was ~30 minutes of dead air across ~250 send/read cycles. If you
 * are about to write a fixed sleep, use wa.waitForNew() / wa.waitFor() instead.
 *
 * HOW TO LOAD (once per session, via mcp__chrome-devtools__evaluate_script):
 *   paste this whole file's body as the function, OR read it and eval it. It attaches
 *   window.__wa.* helpers; they persist until the page reloads. Re-load after any reload.
 *
 * Every helper reads/writes only the OPEN chat (#main) so it never touches the sidebar.
 * Cross-origin Flow IFRAMEs are NOT reachable from here — use MCP take_snapshot + click(uid)
 * for those (see whatsapp-interaction-map.md); wa-drive covers chat text/buttons/lists only.
 *
 * NODE: this file is also require()-able so the pure decision logic can be unit-tested
 * (test_wa_drive.js). Nothing touches `document` at load time.
 */
(() => {
  const wa = {};

  const composer = () =>
    document.querySelector('div[contenteditable="true"][aria-label^="Type a message"]');

  // ─────────────────────────── pure core (unit-tested in node) ───────────────────────────

  /** Does `text` satisfy `needle`? needle = string (case-insensitive substring), RegExp, or
   *  an array of either (any hit wins). Never throws on null/undefined text. */
  wa.matches = (text, needle) => {
    const s = (text == null ? '' : String(text));
    const one = (n) => {
      if (n instanceof RegExp) return n.test(s);
      return s.toLowerCase().includes(String(n).toLowerCase());
    };
    return [].concat(needle).some(one);
  };

  /** Has a new BOT message landed since `base` (from wa.baseline())?
   *  rows = [{txt, mine}] oldest→newest.
   *
   *  Two signals, because WhatsApp virtualises the transcript: the row count can grow OR the
   *  tail can change while the count stays flat (old rows scrolled out of the DOM). Requiring
   *  the last row to be inbound is what stops us returning the moment OUR OWN bubble renders —
   *  the bug that would turn every adaptive wait back into a race. */
  wa.hasNewInbound = (base, rows) => {
    if (!rows || !rows.length) return false;
    const last = rows[rows.length - 1];
    if (last.mine) return false;
    return rows.length > base.n || last.txt !== base.lastTxt;
  };

  /** Who sent this row? Pure, so the classification is testable without a DOM.
   *
   *  Found live 2026-08-23: keying on the delivery-RECEIPT icon misreads a just-sent outbound row
   *  as inbound, because the checkmark renders a beat after the bubble. waitForNew() then returns
   *  on our OWN message and every adaptive wait silently becomes a race. The bubble TAIL
   *  (data-icon="tail-out"/"tail-in") is painted with the bubble, so it is the primary signal.
   *  WhatsApp draws a tail only on the FIRST message of a same-sender run, so a row with neither
   *  tail nor receipt inherits the sender of the row above it. */
  wa.mineFrom = (tailIcon, hasReceipt, prevMine) => {
    if (tailIcon) return tailIcon === 'tail-out';
    if (hasReceipt) return true;              // receipts never render on inbound rows
    return prevMine === null || prevMine === undefined ? false : prevMine;
  };

  /** Poll `predicate` until true or timeout. Clock and sleep are injectable so the timeout
   *  logic is testable without real waiting. A throwing predicate counts as not-yet (the DOM
   *  is routinely mid-render), never as a crash.
   *  → {ok:true, waitedMs} | {ok:false, timedOut:true, waitedMs} */
  wa.pollUntil = async (predicate, opts = {}) => {
    const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 120000;
    const everyMs   = opts.everyMs   != null ? opts.everyMs   : 600;
    const now       = opts.now   || (() => Date.now());
    const sleep     = opts.sleep || ((ms) => new Promise(r => setTimeout(r, ms)));
    const t0 = now();
    for (;;) {
      let hit = false;
      try { hit = !!(await predicate()); } catch (_) { hit = false; }
      if (hit) return { ok: true, waitedMs: now() - t0 };
      if (now() - t0 >= timeoutMs) return { ok: false, timedOut: true, waitedMs: now() - t0 };
      await sleep(everyMs);
    }
  };

  /** The #main{display:none} trap: leanCSS(true) hides the chat pane for lean Flow snapshots,
   *  and if it is left hidden the composer stops accepting input SILENTLY — pastes pile up
   *  ("/menu/menu") and Enter does nothing. Cost ~10 min on 2026-08-21. */
  wa.mainHidden = (displayValue) => displayValue === 'none';

  // ─────────────────────────────── DOM: state + guards ───────────────────────────────

  wa.rows = () => {
    const out = [];
    let prev = null;
    for (const r of document.querySelectorAll('#main div[role="row"]')) {
      const tail = r.querySelector('[data-icon^="tail-"]');
      const receipt = r.querySelector(
        '[data-icon^="msg-check"], [data-icon^="msg-dblcheck"], [data-icon^="msg-time"],' +
        '[aria-label*="Read "], [aria-label*="Delivered"], [aria-label*="Sent "]');
      const mine = wa.mineFrom(tail && tail.getAttribute('data-icon'), !!receipt, prev);
      prev = mine;
      out.push({ txt: (r.innerText || '').trim(), mine, el: r });
    }
    return out;
  };

  /** Snapshot the transcript tail BEFORE sending, so waitForNew() knows what "new" means. */
  wa.baseline = () => {
    const rs = wa.rows();
    return { n: rs.length, lastTxt: rs.length ? rs[rs.length - 1].txt : '' };
  };

  /** Un-hide #main. Call after any Flow snapshot taken with leanCSS(true). */
  wa.restore = () => {
    const s = document.getElementById('e2e-hide');
    if (s) s.textContent = '#side{display:none !important;}';
    return wa.isMainHidden() ? 'STILL_HIDDEN' : 'RESTORED';
  };

  wa.isMainHidden = () => {
    const m = document.querySelector('#main');
    return !!m && wa.mainHidden(getComputedStyle(m).display);
  };

  // ─────────────────────────── the wait log ───────────────────────────
  // WHY (bd-44102): the run artifacts recorded WHAT was driven but never what it COST, so
  // "the poll returned in 3s" and "a constant slept 9s" left identical traces on disk and
  // the speed contract had nothing to gate on. run_efficiency.py reads waits.jsonl and
  // treats its ABSENCE as proof of hand-rolled sleeps — so every wait records itself here.
  // Kept as a plain array on wa so it survives across evaluate_script calls (the page holds
  // window.__wa) and can be dumped in one round-trip at the end of the run.

  wa._waits = [];

  /** Log a completed wait and return the result unchanged, so it can wrap a return value.
   *  A result with no waitedMs never waited on anything and is not logged. */
  wa.record = (kind, res, marker) => {
    if (res && res.waitedMs != null) {
      const row = { kind, waitedMs: res.waitedMs, ok: !!res.ok };
      if (res.timedOut) row.timedOut = true;
      if (marker != null) row.marker = String(marker).slice(0, 60);
      wa._waits.push(row);
    }
    return res;
  };

  wa.resetLog = () => { wa._waits = []; return true; };
  wa.waitLogRows = () => wa._waits.slice();

  /** JSONL, one wait per line — dump straight into <run>/waits.jsonl. */
  wa.waitLog = () => wa._waits.map(r => JSON.stringify(r)).join('\n');

  /** Summary, so a slow surface shows up as data instead of hiding inside a constant. */
  wa.stats = () => {
    const xs = wa._waits.map(r => r.waitedMs).sort((a, b) => a - b);
    if (!xs.length) return { n: 0, totalMs: 0, meanMs: 0, medianMs: 0, maxMs: 0, timedOut: 0 };
    const sum = xs.reduce((a, b) => a + b, 0);
    const mid = xs.length >> 1;
    return {
      n: xs.length,
      totalMs: sum,
      meanMs: Math.round(sum / xs.length),
      medianMs: xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2),
      maxMs: xs[xs.length - 1],
      timedOut: wa._waits.filter(r => r.timedOut).length,
    };
  };

  // ─────────────────────────── lean snapshots ───────────────────────────
  // WhatsApp strips injected CSS on re-render, so call this again right before each snapshot.
  wa.leanCSS = (hideMain = false) => {
    let s = document.getElementById('e2e-hide') ||
            Object.assign(document.createElement('style'), { id: 'e2e-hide' });
    s.textContent = '#side{display:none !important;}' + (hideMain ? ' #main{display:none !important;}' : '');
    document.head.appendChild(s);
    return true;
  };

  // ─────────────────────────── send / read / tap ───────────────────────────

  /** Lexical-safe send (clear-then-paste; fill/execCommand append or no-op).
   *  Auto-heals the #main-hidden trap rather than failing silently.
   *  Returns {ok, baseline, healed} — pass the baseline to waitForNew().
   *  Caller still presses Enter via MCP (the Send-button uid goes stale every send). */
  wa.send = (txt) => {
    let healed = false;
    if (wa.isMainHidden()) { wa.restore(); healed = true; }   // else the paste vanishes silently
    const b = composer();
    if (!b) return { ok: false, err: 'NO_COMPOSER', healed };
    const base = wa.baseline();
    b.focus();
    const r = document.createRange(); r.selectNodeContents(b);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    document.execCommand('delete');
    const dt = new DataTransfer(); dt.setData('text/plain', txt);
    b.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return { ok: true, baseline: base, healed };
  };

  // ---- read: last n message rows (text + actionable button labels), cheap vs take_snapshot ----
  wa.readLast = (n = 4) =>
    wa.rows().slice(-n).map(r => ({
      txt: r.txt.slice(0, 500),
      mine: r.mine,
      btns: [...new Set([...r.el.querySelectorAll('button,div[role="button"]')]
        .map(x => x.getAttribute('aria-label') || x.innerText).filter(Boolean)
        .filter(t => t.length < 45 && !/reaction|Read|Delivered|Sent/i.test(t)))],
    })).filter(x => x.txt);

  /** Wait until ANY new bot message lands. This is the one you want ~90% of the time —
   *  it needs no marker words, so it replaces every "sleep 9-20s and hope" in the suite.
   *  ⚠️ MCP backgrounds an evaluate_script past ~120s; keep timeoutMs under that for a
   *  foreground result, or expect a task-notification (fine for coaching's ~9-min steps). */
  wa.waitForNew = async (baseline, timeoutMs = 110000, everyMs = 600) => {
    const base = baseline || wa.baseline();
    const r = await wa.pollUntil(() => wa.hasNewInbound(base, wa.rows()), { timeoutMs, everyMs });
    wa.record('waitForNew', r);
    return Object.assign(r, { rows: wa.readLast(2) });
  };

  /** send + submit + wait, in ONE evaluate_script round-trip.
   *
   *  The three-call dance (evaluate send → MCP press_key Enter → evaluate wait) costs three MCP
   *  round-trips per scenario. Clicking the composer's send affordance works from script, so the
   *  whole cycle collapses to one call. The button only mounts once the composer has text, hence
   *  the short poll rather than an immediate query (an immediate query loses the race).
   *  Falls back with NO_SEND_BUTTON so the caller can use the press_key route. */
  wa.sendAndWait = async (txt, timeoutMs = 90000) => {
    const s = wa.send(txt);
    if (!s.ok) return s;
    let btn = null;
    const found = await wa.pollUntil(() => {
      const f = document.querySelector('#main footer') || document.querySelector('footer');
      btn = f && f.querySelector('[data-icon="wds-ic-send-filled"], [data-icon="send"]');
      return !!btn;
    }, { timeoutMs: 4000, everyMs: 150 });
    if (!found.ok) return { ok: false, err: 'NO_SEND_BUTTON', baseline: s.baseline };
    (btn.closest('button,div[role="button"],[role="button"]') || btn).click();
    const r = await wa.pollUntil(() => wa.hasNewInbound(s.baseline, wa.rows()), { timeoutMs, everyMs: 600 });
    wa.record('sendAndWait', r, txt);
    return { ok: r.ok, timedOut: r.timedOut, waitedMs: r.waitedMs, rows: wa.readLast(3) };
  };

  /** Wait until the transcript tail matches words/RegExp (use when you know the marker). */
  wa.waitFor = async (needle, timeoutMs = 180000, everyMs = 600) => {
    const r = await wa.pollUntil(
      () => wa.matches(wa.rows().slice(-5).map(x => x.txt).join('  '), needle),
      { timeoutMs, everyMs });
    wa.record('waitFor', r, needle instanceof RegExp ? needle.source : needle);
    return Object.assign(r, { last: wa.readLast(2).map(x => x.txt) });
  };

  /** Tap a chat quick-reply / CTA by visible text. Synthetic click works for in-chat buttons —
   *  prefer this over take_snapshot+click(uid); only the cross-origin Flow iframe needs uids.
   *  Skips disabled buttons (spent CTAs keep rendering with aria-disabled="true"). */
  wa.tap = (label) => {
    if (wa.isMainHidden()) wa.restore();
    const re = label instanceof RegExp
      ? label
      : new RegExp(String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const all = [...document.querySelectorAll('#main div[role="button"], #main button')]
      .filter(x => re.test((x.innerText || '').trim()))
      .filter(x => x.getAttribute('aria-disabled') !== 'true' && !x.disabled);
    const b = all[all.length - 1];           // newest matching card, not a spent one further up
    if (!b) return { ok: false, err: 'NO_ENABLED_BUTTON:' + label };
    const base = wa.baseline();
    b.click();
    return { ok: true, baseline: base, tapped: (b.innerText || '').trim().slice(0, 40) };
  };

  // ---- interactive-list dialog: pick a [role=radio] row by text, then click the send icon ----
  wa.pickListRow = (text) => {
    const dlg = document.querySelector('div[role="dialog"]');
    if (!dlg) return 'NO_DIALOG';
    const re = text instanceof RegExp
      ? text
      : new RegExp(String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const radios = [...dlg.querySelectorAll('[role="radio"]')];
    const hit = radios.find(r => {
      let a = r; for (let k = 0; k < 6; k++) { if (a.parentElement) { a = a.parentElement; if ((a.innerText || '').trim()) break; } }
      return re.test(a.innerText || '');
    });
    if (!hit) return 'NO_ROW:' + text;
    (hit.closest('li,div[role="button"],button') || hit).click();
    hit.click();
    return 'PICKED:' + text;
  };
  wa.sendDialog = () => {
    const dlg = document.querySelector('div[role="dialog"]');
    const icon = dlg && dlg.querySelector('[data-icon="wds-ic-send-filled"], [data-icon="send"]');
    if (!icon) return 'NO_SEND_ICON';
    const base = wa.baseline();
    (icon.closest('button,div[role="button"],[role="button"]') || icon.parentElement).click();
    return { ok: true, baseline: base };
  };

  // ---- header check: which chat is open (personal-account safety) ----
  wa.header = () => {
    const h = document.querySelector('#main header');
    return h ? (h.innerText.split('\n').filter(Boolean)[0] || null) : null;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = wa;
  if (typeof window !== 'undefined') {
    window.__wa = wa;
    // legacy aliases (earlier sessions used these names inline)
    window.__waSend = wa.send; window.__waRead = wa.readLast; window.__waitFor = wa.waitFor;
  }
  return 'wa-drive ready: ' + Object.keys(wa).join(', ');
})();
