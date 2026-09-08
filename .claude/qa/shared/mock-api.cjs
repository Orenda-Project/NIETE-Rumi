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
  const settleMs = opts.settleMs != null ? opts.settleMs : 1200;   // the CDP runner settles 1200ms too
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
    // Settle like the CDP runner: the bot often answers in two or three messages (a text, then the
    // card). Keep polling until the outbox has been QUIET for settleMs, then take the last item —
    // a fixed pause stops at whichever part happened to land inside it. Bounded so a chatty bot
    // cannot hold a scenario forever.
    if (items.length && settleMs) {
      let n = items.length, quietSince = Date.now();
      const cap = Date.now() + Math.max(settleMs * 10, 15000);
      while (Date.now() < cap) {
        await sleep(Math.min(pollMs, settleMs));
        ({ items } = await outbox(since));
        if (items.length !== n) { n = items.length; quietSince = Date.now(); }
        else if (Date.now() - quietSince >= settleMs) break;
      }
    }
    const waitedMs = Date.now() - s0;
    waits.push({ label, waitedMs, timedOut: !items.length });
    if (!items.length) return { ok: false, waitedMs, freshIds: 0, txt: '', btns: [], mineOnly: true };
    const last = items[items.length - 1];
    cursor = last.seq; lastReply = last;
    // `kind` mirrors upload()'s classification on the CDP side: what the reply row IS.
    const kind = last.audio ? 'audio' : last.doc ? 'document' : last.img ? 'image' : (last.txt ? 'text' : 'unknown');
    return { ok: true, waitedMs, freshIds: items.length, txt: last.txt || '', btns: last.btns || [], kind };
  }
  // The fresh-inbound reader the pipeline walkers (coaching, lesson-plan) use: everything that
  // arrived since the LAST call, with the media flags the CDP page-side reader computes.
  let freshCursor = 0;
  const flagsOf = (i) => ({ txt: String(i.txt || '').slice(0, 600), img: !!i.img, audio: !!i.audio, doc: !!i.doc,
    pdf: !!i.pdf || /\.pdf/i.test(i.txt || ''), btns: i.btns || [], media: i.media });
  const MEDIA_KIND_BY_MENU = { 'document': 'document', 'photos & videos': 'image', 'photo': 'image', 'audio': 'audio', 'video': 'video' };
  const MIME_BY_EXT = { '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.ogg': 'audio/ogg; codecs=opus', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf', '.txt': 'text/plain' };
  const noFlow = () => ({ ok: false, err: 'MOCK_NO_FLOW_RENDER' });

  return {
    caps: { method: 'mock', flows: false, upload: true, render: false },
    /** A page-side evaluate has no page here. Resolve to a JSON failure (the shape every caller
     *  parses) rather than throw: the callers are Flow-gated scenarios that are BLOCKED anyway, and a
     *  throw would abort the whole feature run instead of one scenario. */
    async ev() { return JSON.stringify({ ok: false, err: 'MOCK_NO_PAGE' }); },
    async inject() { return true; },

    async sendWait(text, timeoutMs = 90000) {
      trace('send START ' + JSON.stringify(text).slice(0, 40));
      const t0 = Date.now();
      const since = await quiesce();
      // The WhatsApp client trims what the teacher types before it leaves the phone (menu M05 is
      // written against that: "client trims"). Deliver what the bot would actually receive.
      await inject('text', { text: String(text).trim() });
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
    /** Attach a file the way the CDP driver does via Attach → <menu item>. The menu item picks the
     *  WhatsApp kind (Document / Photos & videos / Audio); the mock registers the bytes so the bot's
     *  downloadMedia() fetches them back through the Graph API, exactly as with Meta. */
    async upload(file, menuItem, timeoutMs = 90000) {
      const kind = MEDIA_KIND_BY_MENU[String(menuItem || '').toLowerCase()];
      if (!kind) throw new Error(`HARNESS mock-api: upload menu item ${JSON.stringify(menuItem)} has no media kind (Document | Photos & videos | Audio)`);
      if (!require('fs').existsSync(file)) throw new Error(`HARNESS mock-api: upload fixture missing: ${file}`);
      trace('upload START ' + kind + ' ' + path.basename(String(file)));
      const since = await quiesce();
      const j = await inject(kind, { path: file, mime: MIME_BY_EXT[path.extname(String(file)).toLowerCase()] });
      const r = await waitReply(since, timeoutMs, 'upload:' + path.basename(String(file)));
      trace('upload ok    ' + kind + ' waited=' + r.waitedMs + ' media=' + j.mediaId);
      return { ok: r.ok, waitedMs: r.waitedMs, newIds: r.freshIds, kind: r.ok ? r.kind : 'none', txt: r.txt, btns: r.btns, mediaId: j.mediaId };
    },
    /** Seed the fresh-inbound reader: everything in the outbox so far is "already seen". */
    async freshReset() { freshCursor = (await outbox(0)).last; return 1; },
    /** Items that arrived since the last fresh()/freshReset(), oldest first, with media flags. */
    async fresh() {
      const { items, last } = await outbox(freshCursor);
      if (items.length) freshCursor = items[items.length - 1].seq; else freshCursor = Math.max(freshCursor, last);
      return items.map(flagsOf);
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
