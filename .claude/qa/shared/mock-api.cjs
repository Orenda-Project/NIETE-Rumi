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
const fs = require('fs');
const { execFileSync } = require('child_process');

/** Endpoint path for a Flow: the registry (flow-configs.js) first; else the env var's stem when the
 *  bot's flow-endpoint.routes.js mounts router.post('/<stem>') — hand-published Flows like Teacher
 *  Training are not in the registry but ARE mounted. Anything unmounted stays null (NO_ENDPOINT_PATH). */
function endpointPathFor(envVar, registry, routesSource) {
  if (registry && registry[envVar]) return registry[envVar];
  const stem = String(envVar || '').replace(/_FLOW_ID$/, '').toLowerCase().replace(/_/g, '-');
  if (stem && routesSource && new RegExp("router\\.post\\(\\s*'/" + stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'").test(routesSource)) return '/api/flows/' + stem;
  return null;
}

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
  let lastBatch = [];    // ALL items from the last reply group (a list + a trailing text arrive together)

  async function outbox(after) {
    const r = await fetch(`${base}/outbox?after=${after}&to=${encodeURIComponent(driver)}`);
    if (!r.ok) throw new Error('HARNESS mock-api: outbox ' + r.status);
    return r.json();
  }
  /** The most recent interactive list still on screen. A text can land AFTER a list card, so relying
   *  on lastReply alone loses it — scan the recent outbox newest-first, as a tap in WhatsApp would. */
  function latestListItem() {
    if (lastReply && lastReply.list) return lastReply;
    return lastBatch.slice().reverse().find((it) => it.list) || null;   // within THIS reply group only
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
    cursor = last.seq; lastReply = last; lastBatch = items;
    // `kind` mirrors upload()'s classification on the CDP side: what the reply row IS.
    const kind = last.audio ? 'audio' : last.doc ? 'document' : last.img ? 'image' : (last.txt ? 'text' : 'unknown');
    return { ok: true, waitedMs, freshIds: items.length, txt: last.txt || '', btns: last.btns || [], kind };
  }
  // The fresh-inbound reader the pipeline walkers (coaching, lesson-plan) use: everything that
  // arrived since the LAST call, with the media flags the CDP page-side reader computes.
  let freshCursor = 0;
  const flagsOf = (i) => ({ txt: String(i.txt || '').slice(0, 600), img: !!i.img, audio: !!i.audio, doc: !!i.doc,
    pdf: !!i.pdf || /\.pdf/i.test(i.txt || ''), btns: i.btns || [], media: i.media,
    // interactive list rows, when this reply is one — the training module check is answered off these
    list: i.list || null });
  const MEDIA_KIND_BY_MENU = { 'document': 'document', 'photos & videos': 'image', 'photo': 'image', 'audio': 'audio', 'video': 'video' };
  const MIME_BY_EXT = { '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.ogg': 'audio/ogg; codecs=opus', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf', '.txt': 'text/plain' };
  // ── Flows: EMULATED from the stored FLOW_JSON (phase 4). Not rendered — `caps.render` stays false and
  // every result carries via:'flow-emulator'. opts.flows = { dir, botUrl, publicKeyPem, endpoints{envVar:path} }.
  const FL = opts.flows || null;
  const { createEmulator, FlowTransport } = require(path.join(repo, 'bot', 'scripts', 'e2e', 'flow-emulator.js'));
  let flowManifest = null;
  const manifest = () => {
    if (flowManifest || !FL) return flowManifest;
    try { flowManifest = JSON.parse(fs.readFileSync(path.join(FL.dir, 'manifest.json'), 'utf8')); } catch (_) { flowManifest = { flows: [] }; }
    return flowManifest;
  };
  const flowEntryById = (id) => (manifest().flows || []).find((f) => String(f.flowId) === String(id));
  let endpointsByEnv = null, routesSource = null;
  const endpointFor = (envVar) => {
    if (FL && FL.endpoints && FL.endpoints[envVar]) return FL.endpoints[envVar];
    if (!endpointsByEnv) {   // the bot's own registry: flow-configs.js (envVar → endpointPath)
      endpointsByEnv = {};
      try { const cfg = require(path.join(repo, 'bot', 'scripts', 'setup', 'flow-configs.js')); const list = Array.isArray(cfg) ? cfg : (cfg.FLOW_CONFIGS || cfg.flows || Object.values(cfg).find(Array.isArray) || []);
        for (const f of list) if (f && f.envVar && f.endpointPath) endpointsByEnv[f.envVar] = f.endpointPath; } catch (_) { /* no registry */ }
      try { routesSource = fs.readFileSync(path.join(repo, 'bot', 'shared', 'routes', 'flow-endpoint.routes.js'), 'utf8'); } catch (_) { routesSource = ''; }
    }
    return endpointPathFor(envVar, endpointsByEnv, routesSource);
  };
  let flow = null;              // the open emulator, or null
  let flowCompletionSince = 0;  // outbox seq when the completion was injected
  const flowStats = { opened: 0, completed: 0, refused: 0, flows: [] };
  const noFlow = () => ({ ok: false, err: FL ? 'NO_FLOW_OPEN' : 'MOCK_NO_FLOW_RENDER' });

  return {
    caps: { method: 'mock', flows: FL ? 'emulated' : false, upload: true, render: false, rawInject: true },
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
      // The button may sit on an earlier card than the very last reply (a text can land after the
      // card) — it is still on screen, so search the recent outbox newest-first, as a tap in WhatsApp would.
      const findBtn = (item) => { const raw = item && item.raw && item.raw.interactive; return raw && raw.type === 'button' && (raw.action.buttons || []).find((b) => b.reply && b.reply.title === label); };
      let btn = findBtn(lastReply);
      if (!btn) { const recent = (await outbox(0)).items.slice(-30).reverse(); for (const it of recent) { btn = findBtn(it); if (btn) break; } }
      if (!btn) throw new Error(`HARNESS mock-api: no reply button titled ${JSON.stringify(label)} on any recent reply (last btns=${JSON.stringify(lastReply && lastReply.btns)})`);
      // Count the reply from the outbox tip NOW, not from `cursor` — a fresh()/Flow-driven step leaves
      // cursor behind, and a card already sitting quiet would otherwise be mistaken for the tap's reply
      // (the training module card, with the real answer 6s away: bd tap→quiz).
      const since = (await outbox(0)).last;
      await inject('button', { id: btn.reply.id, title: btn.reply.title });
      const r = await waitReply(since, timeoutMs, 'tap:' + label);
      return { ok: r.ok, waitedMs: r.waitedMs, tapped: label, newIds: r.freshIds, txt: r.txt, btns: r.btns };
    },
    async openList(opener) {
      const item = latestListItem();
      const l = item && item.list;
      if (!l) return { ok: false, err: 'NO_DIALOG', tap: { ok: false, opener } };
      const rows = l.rows.map((r) => r.title), descs = l.rows.map((r) => r.description || '');
      return { ok: true, rows, descs, all: [item.txt, ...l.rows.map((r) => [r.title, r.description].filter(Boolean).join('\n'))].join('\n') };
    },
    async pickRowAndWait(row, timeoutMs = 90000) {
      const item = latestListItem();
      const l = item && item.list;
      const hit = l && l.rows.find((r) => r.title === row);
      if (!hit) throw new Error(`HARNESS mock-api: no list row titled ${JSON.stringify(row)} on any recent reply (rows=${JSON.stringify(l && l.rows.map((r) => r.title))})`);
      const since = (await outbox(0)).last;
      await inject('list', { id: hit.id, title: hit.title });
      const r = await waitReply(since, timeoutMs, 'pick:' + row);
      return { ok: r.ok, waitedMs: r.waitedMs, picked: row, newIds: r.freshIds, txt: r.txt, btns: r.btns };
    },
    async closeDialog() { return true; },
    /** Inject a raw list-row / button reply by id (the module-check driver answers questions this way,
     *  reading the rows off fresh()). Returns after the inject; the caller polls fresh() for what follows. */
    async tapId(kind, id, title) { await inject(kind, { id, title: title || id }); return { ok: true }; },

    // ---- Flows: emulated from the stored JSON, never rendered ------------------------
    /** Open the Flow behind the last reply's card whose CTA matches `ctaPattern`. Loads the stored
     *  FLOW_JSON by the card's flow_id, INITs endpoint Flows through the encrypted transport. */
    async openFlow(ctaPattern) {
      if (!FL) return { ok: false, err: 'MOCK_NO_FLOW_RENDER' };
      const raw = lastReply && lastReply.raw && lastReply.raw.interactive;
      const params = raw && raw.type === 'flow' && raw.action && raw.action.parameters;
      const re = new RegExp(ctaPattern, 'i');
      if (!params || !(lastReply.btns || []).some((b) => re.test(b))) { flowStats.refused++; return { ok: false, err: 'NO_FRESH_CTA:' + ctaPattern }; }
      const entry = flowEntryById(params.flow_id);
      if (!entry) return { ok: false, err: 'NO_STORED_FLOW:' + params.flow_id + ' (run flow-inventory.js fetch)' };
      let json; try { json = JSON.parse(fs.readFileSync(path.join(FL.dir, entry.envVar + '.json'), 'utf8')); } catch (e) { return { ok: false, err: 'FLOW_JSON_UNREADABLE:' + entry.envVar }; }
      const isExchange = params.flow_action === 'data_exchange';
      const endpointPath = isExchange ? endpointFor(entry.envVar) : null;
      if (isExchange && !endpointPath) return { ok: false, err: 'NO_ENDPOINT_PATH:' + entry.envVar };
      const em = createEmulator(json, {
        flowId: params.flow_id, flowToken: params.flow_token, action: isExchange ? 'data_exchange' : 'navigate',
        screen: params.flow_action_payload && params.flow_action_payload.screen, data: params.flow_action_payload && params.flow_action_payload.data,
        transport: isExchange ? new FlowTransport({ publicKeyPem: FL.publicKeyPem }) : null,
        endpointUrl: isExchange ? String(FL.botUrl || base).replace(/\/+$/, '') + endpointPath : null,
        onComplete: async (done) => {
          flowCompletionSince = (await outbox(0)).last;
          await inject('flow', { flowId: done.flowId, response_json: done.response_json });
          flowStats.completed++;
        },
      });
      try { await em.open(); } catch (e) { flowStats.refused++; return { ok: false, err: String(e.message).slice(0, 160) }; }
      flow = em; flowStats.opened++; flowStats.flows.push(entry.envVar);
      const p = em.probe();
      trace('flow open ' + entry.envVar + ' screen=' + p.screen);
      return { ok: true, clicked: (lastReply.btns || []).find((b) => re.test(b)), screen: p.screen, items: p.items.length, via: 'flow-emulator', flow: entry.envVar };
    },
    flow() { return flow; },
    async resetFlow() { const had = !!flow; flow = null; return { ok: true, note: had ? 'emulated Flow closed' : 'nothing open', attempts: 0 }; },
    async flowProbe() { if (!flow || !flow.isOpen()) return { text: '', items: [] }; const p = flow.probe(); return { text: p.text, items: p.items.map((i) => ({ text: i.text, disabled: i.disabled, kind: i.kind })) }; },
    async flowClick(text, o2) { if (!flow || !flow.isOpen()) return noFlow(); const r = await flow.click(text, o2 || {}); if (!flow.isOpen()) flow = null; return r; },
    async flowPick(want, o2) {
      if (!flow || !flow.isOpen()) return noFlow();
      const r = flow.pick(want, o2 || {});
      if (r.ok) { const a = await flow.settle(); if (!a.ok) return a; }   // a picker whose selection submits
      if (!flow.isOpen()) flow = null;
      return r;
    },
    /** A RAW list reply — what a stale or tampered client could replay (language LANG05). The
     *  browser lane cannot forge this, so scripts gate it on caps.rawInject. */
    async injectList(id, title, timeoutMs = 60000) {
      const since = cursor;
      await inject('list', { id, title: title || id });
      const r = await waitReply(since, timeoutMs, 'inject:list:' + id);
      return { ok: r.ok, waitedMs: r.waitedMs, txt: r.txt, btns: r.btns };
    },
    async flowAria(labelText) { if (!flow || !flow.isOpen()) return noFlow(); const r = await flow.click(labelText, {}); return r.ok ? { ok: true, label: labelText } : { ok: false, err: 'NO_ARIA:' + labelText }; },
    async flowType(text, o2) { if (!flow || !flow.isOpen()) return noFlow(); return flow.type(text, o2 || {}); },
    async flowState(labelRe) { if (!flow || !flow.isOpen()) return { found: false }; return flow.state(labelRe); },
    closeFlow() { if (flow) flow.close(); flow = null; },
    /** After a completion: wait for the bot's reaction to the nfm_reply (its next message). */
    async flowComplete(timeoutMs = 90000) { return waitReply(flowCompletionSince, timeoutMs, 'flow:complete'); },
    async flowStats() { return { ...flowStats, flows: [...new Set(flowStats.flows)] }; },

    /** DB reach-through — identical to the CDP api: the DB is real (sandbox), so persisted-state
     *  assertions (LANG02/03 language + lock) are verified the same way. */
    db(action, extra) {
      trace('db ' + action);
      const script = /^(lookup|answer-key|module-answer-key)$/.test(action)
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

module.exports = { makeMockApi, endpointPathFor };
