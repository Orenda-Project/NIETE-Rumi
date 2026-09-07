/* mock-api.cjs — the `method: mock` driver behind feature-runner.cjs.
 *
 * Same primitive surface as the CDP api in feature-runner.cjs (sendWait / tapAndWait / openList /
 * pickRowAndWait / closeDialog / upload / openFlow… / db / waitStats / waitLog), so menu.cjs,
 * language.cjs and status.cjs run UNCHANGED against a locally started bot. Instead of driving
 * WhatsApp Web it talks to bot/scripts/e2e/mock-graph-api.js: `POST /inject` forges the teacher's
 * message to the bot, `GET /outbox` returns what the bot sent back, already normalized to the
 * {txt, btns, list} shape the CDP reader produces.
 *
 * What it will NOT do, on purpose: render a WhatsApp Flow. Every flow* primitive answers
 * {ok:false, err:'MOCK_NO_FLOW_RENDER'} so a Flow scenario records BLOCKED/SKIP through the
 * feature script's own branches — never a PASS the mock did not earn. `upload` is Phase 2.
 *
 * Reply detection mirrors the CDP runner's rule: count outbox items that arrive AFTER my own
 * injection (never "the last message", which can be the previous send's late reply). A
 * quiesce before each send waits for the outbox to stop changing, for the same reason.
 */
const path = require('path');
const { execFileSync } = require('child_process');

function makeMockApi(opts) {
  const base = String(opts.baseUrl || process.env.E2E_MOCK_URL || 'http://127.0.0.1:4010').replace(/\/+$/, '');
  const driver = opts.driver || process.env.E2E_DRIVER;
  const env = opts.env || process.env.E2E_ENV || 'sandbox';
  const repo = opts.repo || path.resolve(__dirname, '..', '..', '..');
  const pollMs = opts.pollMs || 500;
  const quiesceMs = opts.quiesceMs || 1500;
  const settleMs = opts.settleMs != null ? opts.settleMs : 300;
  const trace = opts.trace || (() => {});
  if (!driver) throw new Error('HARNESS mock-api: a driver phone is required (E2E_DRIVER)');

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waits = [];
  let cursor = 0;        // last outbox seq we have consumed
  let lastReply = null;  // newest normalized item the driver saw

  async function outbox(after) {
    const r = await fetch(`${base}/outbox?after=${after}&to=${encodeURIComponent(driver)}`);
    if (!r.ok) throw new Error('HARNESS mock-api: outbox ' + r.status);
    return r.json();
  }
  async function inject(kind, body) {
    const r = await fetch(`${base}/inject`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, from: driver, ...body }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error('HARNESS mock-api: inject failed: ' + JSON.stringify(j).slice(0, 200));
    return j;
  }
  /** Wait until nothing new has landed for `quiesceMs` (a late reply to the PREVIOUS send would
   *  otherwise be counted as this one's). Returns the outbox seq to count fresh items from. */
  async function quiesce() {
    let last = (await outbox(0)).last, stableSince = Date.now();
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      await sleep(Math.min(pollMs, quiesceMs));
      const now = (await outbox(0)).last;
      if (now !== last) { last = now; stableSince = Date.now(); }
      else if (Date.now() - stableSince >= quiesceMs) break;
    }
    cursor = last;
    return last;
  }
  /** Poll for items after `since`; return the newest as the reply, or the NO REPLY sentinel. */
  async function waitReply(since, timeoutMs, label) {
    const s0 = Date.now();
    let items = [];
    while (Date.now() - s0 < timeoutMs) {
      ({ items } = await outbox(since));
      if (items.length) break;
      await sleep(pollMs);
    }
    if (items.length && settleMs) { await sleep(settleMs); ({ items } = await outbox(since)); }
    const waitedMs = Date.now() - s0;
    waits.push({ label, waitedMs, timedOut: !items.length });
    if (!items.length) return { ok: false, waitedMs, freshIds: 0, txt: '', btns: [], mineOnly: true };
    const last = items[items.length - 1];
    cursor = last.seq; lastReply = last;
    return { ok: true, waitedMs, freshIds: items.length, txt: last.txt || '', btns: last.btns || [] };
  }
  const noFlow = () => ({ ok: false, err: 'MOCK_NO_FLOW_RENDER' });

  return {
    caps: { method: 'mock', flows: false, upload: false, render: false },
    ev() { throw new Error('HARNESS mock-api: ev() is a browser primitive; the mock driver has no page'); },
    async inject() { return true; },

    async sendWait(text, timeoutMs = 90000) {
      trace('send START ' + JSON.stringify(text).slice(0, 40));
      const t0 = Date.now();
      const since = await quiesce();
      await inject('text', { text });
      const r = await waitReply(since, timeoutMs, 'send:' + String(text).slice(0, 20));
      r.wallMs = Date.now() - t0;
      trace('send ok    ' + JSON.stringify(text).slice(0, 30) + ' waited=' + r.waitedMs);
      return r;
    },
    async tapAndWait(label, timeoutMs = 90000) {
      const raw = lastReply && lastReply.raw && lastReply.raw.interactive;
      const btn = raw && raw.type === 'button' && (raw.action.buttons || []).find((b) => b.reply && b.reply.title === label);
      if (!btn) throw new Error(`HARNESS mock-api: no reply button titled ${JSON.stringify(label)} on the last reply (btns=${JSON.stringify(lastReply && lastReply.btns)})`);
      const since = cursor;
      await inject('button', { id: btn.reply.id, title: btn.reply.title });
      const r = await waitReply(since, timeoutMs, 'tap:' + label);
      return { ok: r.ok, waitedMs: r.waitedMs, tapped: label, newIds: r.freshIds, txt: r.txt, btns: r.btns };
    },
    async openList(opener) {
      const l = lastReply && lastReply.list;
      if (!l) return { ok: false, err: 'NO_DIALOG', tap: { ok: false, opener } };
      const rows = l.rows.map((r) => r.title);
      return { ok: true, rows, all: [lastReply.txt, ...rows].join('\n') };
    },
    async pickRowAndWait(row, timeoutMs = 90000) {
      const l = lastReply && lastReply.list;
      const hit = l && l.rows.find((r) => r.title === row);
      if (!hit) throw new Error(`HARNESS mock-api: no list row titled ${JSON.stringify(row)} on the last reply (rows=${JSON.stringify(l && l.rows.map((r) => r.title))})`);
      const since = cursor;
      await inject('list', { id: hit.id, title: hit.title });
      const r = await waitReply(since, timeoutMs, 'pick:' + row);
      return { ok: r.ok, waitedMs: r.waitedMs, picked: row, newIds: r.freshIds, txt: r.txt, btns: r.btns };
    },
    async closeDialog() { return true; },

    // ---- native Flow: NOT rendered by the mock, and it says so ------------------------
    async openFlow() { return noFlow(); },
    flow() { return null; },
    async resetFlow() { return { ok: true, note: 'mock driver: nothing to reset', attempts: 0 }; },
    async flowProbe() { return { text: '', items: [] }; },
    async flowClick() { return noFlow(); },
    async flowPick() { return noFlow(); },
    async flowAria() { return noFlow(); },
    async flowType() { return noFlow(); },
    async flowState() { return { found: false }; },
    closeFlow() {},

    /** DB reach-through — identical to the CDP api: the DB is real (sandbox), so persisted-state
     *  assertions (LANG02/03 language + lock) are verified the same way. */
    db(action, extra) {
      trace('db ' + action);
      const script = action === 'lookup'
        ? path.join(repo, '.claude/qa/shared/niete_training_db.py')
        : path.join(repo, '.claude/qa/shared/niete_registration_db.py');
      const args = [script, action, '--env', env, '--phone', driver];
      if (action !== 'lookup' && action !== 'snapshot') args.push('--yes-write');
      if (extra) args.push(...extra);
      try {
        const out = execFileSync('python3', args, { cwd: repo, encoding: 'utf8', timeout: 60000 });
        const user = (out.match(/USER:\s*\[[\s\S]*?\n\]/) || [''])[0];
        return { ok: true, out, user };
      } catch (e) { return { ok: false, err: String(e.message).slice(0, 200) }; }
    },
    async upload(file, menuItem) {
      throw new Error(`HARNESS mock-api: upload(${path.basename(String(file))}, ${menuItem}) is not supported by the mock driver in Phase 1 — media is a Phase 2 item`);
    },
    async waitStats() {
      const ms = waits.map((w) => w.waitedMs).sort((a, b) => a - b);
      const total = ms.reduce((a, b) => a + b, 0);
      return { n: ms.length, totalMs: total, meanMs: ms.length ? Math.round(total / ms.length) : 0,
        medianMs: ms.length ? ms[Math.floor(ms.length / 2)] : 0, maxMs: ms.length ? ms[ms.length - 1] : 0,
        timedOut: waits.filter((w) => w.timedOut).length };
    },
    async waitLog() { return waits.map((w) => JSON.stringify(w)).join('\n'); },
  };
}

module.exports = { makeMockApi };
