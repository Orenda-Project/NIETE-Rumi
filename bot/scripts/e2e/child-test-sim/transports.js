/**
 * transports — how the simulated coach reaches a bot.
 *
 *   mockTransport     dry mode: a local bot behind bot/scripts/e2e/mock-graph-api.js. Sends go through the
 *                     mock's POST /inject (it registers the media and forges the webhook with the bot's own
 *                     phone_number_id); replies come from GET /outbox.
 *   sandboxTransport  phase 2: a deployed SANDBOX bot. The fixture is uploaded as real WhatsApp media with the
 *                     sandbox WABA token (so the bot's downloadMedia() fetches it from Meta like any voice note),
 *                     then the webhook Meta would send is POSTed to the bot, signed with the app secret.
 *                     Replies come from a pluggable `replies.poll(afterCursor)` — the bot's sends go to the
 *                     driver's synthetic phone, which no device reads, so phase 2 supplies the reader (sandbox
 *                     message log / Axiom) once the chief of staff names it in GO_PHASE2.
 *
 * Both return the same surface: sendText, tapButton, pickRow, sendMedia, submitFlow, poll, reset.
 * Every inbound item is normalized to the mock outbox shape { seq, type, txt, btns, list?, flow?, raw }.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sim = require('../../simulate');

const MIME = { '.ogg': 'audio/ogg; codecs=opus', '.opus': 'audio/ogg; codecs=opus', '.m4a': 'audio/mp4', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
const mimeFor = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

// Production NIETE surfaces. A simulated coach must never reach them, whatever the allowlist says.
const PRODUCTION_HOSTS = [/(^|\.)portal\.niete\.edu\.pk$/i, /^niete-rumi-production/i, /^bot-production/i, /(^|\.)graph\.facebook\.com$/i];

function assertSafeTarget(url, allowHosts) {
  const host = new URL(url).hostname;
  if (PRODUCTION_HOSTS.some((re) => re.test(host))) throw new Error(`refusing ${host}: a production host`);
  if (!(allowHosts || []).includes(host)) throw new Error(`refusing ${host}: not on the sandbox allowlist (SIM_ALLOWED_BOT_HOSTS)`);
}

function mockTransport({ baseUrl, driver, pollMs = 300 }) {
  const base = String(baseUrl).replace(/\/+$/, '');
  const post = async (p, body) => {
    const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(`mock ${p} failed: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    return j;
  };
  return {
    name: 'mock',
    pollMs,
    sendText: (text) => post('/inject', { kind: 'text', from: driver, text }),
    tapButton: (id, title) => post('/inject', { kind: 'button', from: driver, id, title }),
    pickRow: (id, title) => post('/inject', { kind: 'list', from: driver, id, title }),
    sendMedia: (kind, file, caption) => post('/inject', { kind, from: driver, path: file, ...(caption ? { caption } : {}) }),
    submitFlow: (flowId, response) => post('/inject', { kind: 'flow', from: driver, flowId, response_json: response }),
    async poll(after) {
      const r = await fetch(`${base}/outbox?after=${after}&to=${driver}`);
      return (await r.json()).items || [];
    },
    reset: () => post('/reset', {}),
  };
}

function multipart(file, mime) {
  const boundary = '----l8sim' + crypto.randomBytes(8).toString('hex');
  const head = (name, value) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  const pre = Buffer.from(head('messaging_product', 'whatsapp') + head('type', mime) +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${path.basename(file)}"\r\nContent-Type: ${mime}\r\n\r\n`);
  return { body: Buffer.concat([pre, fs.readFileSync(file), Buffer.from(`\r\n--${boundary}--\r\n`)]), type: `multipart/form-data; boundary=${boundary}` };
}

function sandboxTransport(cfg) {
  const { botUrl, phoneNumberId, wabaToken, appSecret, driver, allowHosts, replies } = cfg;
  const graphBase = (cfg.graphBase || 'https://graph.facebook.com').replace(/\/+$/, '');
  const version = cfg.graphVersion || 'v21.0';
  assertSafeTarget(botUrl, allowHosts);
  if (!replies || typeof replies.poll !== 'function') throw new Error('sandboxTransport needs replies.poll (named in GO_PHASE2)');
  if (!phoneNumberId || !wabaToken) throw new Error('sandboxTransport needs the SANDBOX phone_number_id and WABA token');

  async function webhook(payload) {
    payload.entry[0].changes[0].value.metadata.phone_number_id = phoneNumberId;
    const body = JSON.stringify(payload);
    const headers = { 'Content-Type': 'application/json' };
    if (appSecret) headers['X-Hub-Signature-256'] = 'sha256=' + crypto.createHmac('sha256', appSecret).update(body).digest('hex');
    const r = await fetch(botUrl, { method: 'POST', headers, body });
    if (!r.ok) throw new Error(`bot webhook answered ${r.status}`);
    return { ok: true, status: r.status, messageId: payload.entry[0].changes[0].value.messages[0].id };
  }
  async function upload(file) {
    const mime = mimeFor(file); const mp = multipart(file, mime);
    const r = await fetch(`${graphBase}/${version}/${phoneNumberId}/media`, { method: 'POST', headers: { Authorization: 'Bearer ' + wabaToken, 'Content-Type': mp.type }, body: mp.body });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id) throw new Error(`media upload failed: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    return { id: j.id, mime, size: fs.statSync(file).size };
  }
  return {
    name: 'sandbox',
    pollMs: cfg.pollMs || 1000,
    sendText: (text) => webhook(sim.simulateMessage(text, { from: driver })),
    tapButton: (id, title) => webhook(sim.buttonReply(id, title, { from: driver })),
    pickRow: (id, title) => webhook(sim.listReply(id, title, { from: driver })),
    async sendMedia(kind, file, caption) {
      const m = await upload(file);
      const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      const r = await webhook(sim.mediaMessage(kind, m.id, { mime: m.mime, size: m.size, caption, sha256: sha, filename: path.basename(file) }, { from: driver }));
      return { ...r, mediaId: m.id };
    },
    submitFlow: (flowId, response) => webhook(sim.flowReply(flowId, response, { from: driver })),
    poll: (after) => replies.poll(after),
    // what the reader saw but did not deliver as replies (the bot's reactions, by outcome)
    signals: () => (typeof replies.signals === 'function' ? replies.signals() : null),
    reset: async () => ({ ok: true }),
  };
}

module.exports = { mockTransport, sandboxTransport, assertSafeTarget, PRODUCTION_HOSTS };
