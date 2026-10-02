/**
 * replies-axiom — the reply source for sandbox mode: what the deployed sandbox bot SENT to the
 * synthetic coach, read back from its own logs.
 *
 * The bot logs `whatsapp.outbound_echo` (bot/shared/services/outbound-echo.js) with the full
 * /messages payload, for recipients on its WA_OUTBOUND_ECHO_TO only. This module queries the Axiom
 * dataset for those lines, strictly on ONE phone and the run window, and rebuilds each into the mock
 * outbox shape the coach player reads: { seq, type, txt, btns, list?, flow?, raw, sent_ms, send_ok }.
 * `sent_ms` is the bot's own send time, so a round trip is measured to the send, not to Axiom's
 * ingest (a few seconds later).
 *
 * sandbox.json:  "replies": { "module": "<path to this file>", "dataset": "rumi-sandbox",
 *                             "tokenEnv": "AXIOM_API_TOKEN", "orgEnv": "AXIOM_ORG_ID" }
 * Token and org id are read from the env vars it names — never from the file, never printed.
 */
'use strict';
const { normalize } = require('../mock-graph-api');

const EVENT = 'whatsapp.outbound_echo';
const API = 'https://api.axiom.co/v1/datasets/_apl?format=legacy';
// Production datasets. The echo never runs in production, and a simulation never reads its logs.
const PRODUCTION_DATASETS = new Set(['niete-logs', 'digital-coach-logs']);
const OVERLAP_MS = 60000;   // re-read a minute behind the newest row seen: Axiom ingest is not ordered

function buildApl({ dataset, phone, fromIso, take = 1000 }) {
  if (!/^\d{8,15}$/.test(String(phone || ''))) throw new Error('replies-axiom: phone must be digits only');
  if (!/^[A-Za-z0-9_-]+$/.test(String(dataset || ''))) throw new Error('replies-axiom: bad dataset name');
  if (!/^[0-9T:.\-Z]+$/.test(String(fromIso || ''))) throw new Error('replies-axiom: bad window start');
  return `["${dataset}"] | where _time >= datetime("${fromIso}") | where event == "${EVENT}" | where phone == "${phone}"`
    + ` | project _time, data_json | order by _time asc | take ${take}`;
}

/** One echo line's data → the mock outbox item shape (mock-graph-api normalize), plus the bot's send facts. */
function toItem(echo, seq) {
  const raw = echo.payload || {};
  let norm; let capError = null;
  try {
    norm = normalize(raw);
  } catch (e) {
    // The bot sent something over a WhatsApp cap: Meta would refuse it. Still deliver it, flagged,
    // so the run shows what the coach would (not) have seen instead of timing out.
    capError = e.code === 'E2E_CAP' ? `${e.field} ${e.actual} > ${e.limit}` : e.message;
    const it = raw.interactive || {};
    norm = { type: raw.type === 'interactive' ? `interactive.${it.type}` : raw.type, txt: (it.body && it.body.text) || '', btns: [] };
  }
  return {
    seq, ts: echo.sent_at, to: echo.to, ...norm, raw,
    sent_ms: Date.parse(echo.sent_at), send_ok: echo.ok !== false, status: echo.status, message_id: echo.message_id,
    ...(capError ? { cap_error: capError } : {}),
  };
}

function create(cfg) {
  const rc = (cfg && cfg.replies) || {};
  const dataset = rc.dataset || 'rumi-sandbox';
  if (PRODUCTION_DATASETS.has(dataset)) throw new Error(`replies-axiom: refusing ${dataset}, a production dataset`);
  const phone = String(rc.phone || cfg.driver || '');
  const tokenEnv = rc.tokenEnv || 'AXIOM_API_TOKEN';
  const orgEnv = rc.orgEnv || 'AXIOM_ORG_ID';
  const token = process.env[tokenEnv];
  if (!token) throw new Error(`replies-axiom: ${tokenEnv} is not set`);
  const org = process.env[orgEnv];
  buildApl({ dataset, phone, fromIso: new Date().toISOString() });   // validates phone + dataset up front
  const sinceMs = Number(rc.sinceMs || (Date.now() - 5000));         // the run window opens when the source does
  const fetchImpl = rc.fetch || ((...a) => globalThis.fetch(...a));

  const seen = new Set(); const items = []; let newestIngest = 0;

  async function query() {
    const fromMs = Math.max(sinceMs, newestIngest - OVERLAP_MS);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    if (org) headers['X-Axiom-Org-Id'] = org;
    const r = await fetchImpl(API, { method: 'POST', headers, body: JSON.stringify({ apl: buildApl({ dataset, phone, fromIso: new Date(fromMs).toISOString() }) }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`replies-axiom: axiom ${r.status} ${String(j.message || '').slice(0, 120)}`);
    return j.matches || [];
  }

  async function poll(after = 0) {
    const fresh = [];
    for (const m of await query()) {
      const ingest = Date.parse(m._time); if (ingest > newestIngest) newestIngest = ingest;
      let echo; try { echo = JSON.parse((m.data && m.data.data_json) || 'null'); } catch (_) { echo = null; }
      if (!echo || !echo.echo_id || seen.has(echo.echo_id)) continue;
      if (String(echo.to) !== phone) continue;                         // strictly this phone, whatever the query returned
      if (!(Date.parse(echo.sent_at) >= sinceMs)) continue;            // strictly this run
      seen.add(echo.echo_id); fresh.push(echo);
    }
    fresh.sort((a, b) => Date.parse(a.sent_at) - Date.parse(b.sent_at) || (a.echo_seq || 0) - (b.echo_seq || 0));
    for (const e of fresh) items.push(toItem(e, items.length + 1));
    return items.filter((i) => i.seq > after);
  }

  return { poll };
}

module.exports = { create, toItem, buildApl, EVENT };
