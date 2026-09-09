#!/usr/bin/env node
/**
 * mock-graph-api — a local stand-in for Meta's WhatsApp Cloud API, for the E2E mock lane.
 *
 * The bot is pointed here with WHATSAPP_API_BASE (whatsapp.service.js). It serves the same
 * `/<version>/<phone_number_id>/messages` path Meta does, answers with a Meta-shaped body, and
 * keeps every outbound payload in an ordered OUTBOX, normalized to the shape the CDP-based E2E
 * runner reads off WhatsApp Web:
 *
 *     { seq, ts, to, type, txt, btns, list?, raw }
 *
 *   txt   header + body + footer lines, in the order WhatsApp Web renders them
 *   btns  reply-button titles, or the list opener label, or the Flow CTA
 *   list  { button, rows:[{id,title,description?}] } for an interactive list
 *
 * It also VALIDATES the Meta field caps the way Meta would — in CODE POINTS, and rejecting the
 * send — so a copy change that would fail on the real API fails here, at commit time.
 *
 * It forges inbound webhooks on request (POST /inject) using bot/scripts/simulate.js, so the
 * runner never builds a payload the bot's own guards would drop.
 *
 * Phase 1 scope: text + interactive (button / list / flow-card) sends. No media, no templates
 * resolution, no Flow rendering — a Flow card is recorded as a card; nothing here pretends the
 * Flow opened. Zero dependencies (node:http), so the root test suite can start it for real.
 *
 *   node bot/scripts/e2e/mock-graph-api.js            # MOCK_PORT (4010), MOCK_BOT_URL, PHONE_NUMBER_ID
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const sim = require('../simulate');

const MIME_BY_EXT = { '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.ogg': 'audio/ogg; codecs=opus', '.opus': 'audio/ogg; codecs=opus',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const mimeFor = (file, given) => given || MIME_BY_EXT[path.extname(String(file)).toLowerCase()] || 'application/octet-stream';
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Minimal multipart/form-data parser — enough for the ONE shape whatsapp.service.js sends to /media
 *  (a `file` part plus `messaging_product`/`type` text parts). Returns {file:{filename, mime, bytes}, fields}. */
function parseMultipart(buf, contentType) {
  const m = /boundary=("?)([^";]+)\1/i.exec(contentType || '');
  if (!m) return null;
  const boundary = Buffer.from('--' + m[2]);
  const out = { fields: {}, file: null };
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    const next = buf.indexOf(boundary, pos + boundary.length);
    if (next === -1) break;
    const part = buf.subarray(pos + boundary.length + 2, next - 2);   // strip CRLF after boundary and before next
    const sep = part.indexOf('\r\n\r\n');
    if (sep !== -1) {
      const headers = part.subarray(0, sep).toString();
      const body = part.subarray(sep + 4);
      const name = (/name="([^"]+)"/.exec(headers) || [])[1];
      const filename = (/filename="([^"]+)"/.exec(headers) || [])[1];
      const mime = (/Content-Type:\s*([^\r\n]+)/i.exec(headers) || [])[1];
      if (filename !== undefined) out.file = { filename, mime: mime || mimeFor(filename), bytes: Buffer.from(body) };
      else if (name) out.fields[name] = body.toString();
    }
    pos = next;
  }
  return out;
}

// Meta's documented interactive-message limits. Counted in code points, never bytes/UTF-16 units.
const CAPS = {
  header: 60, footer: 60, body: 1024,
  button: 20, buttons: 3,
  listButton: 20, rowTitle: 24, rowDescription: 72, rows: 10, sections: 10,
};
const cp = (s) => [...String(s == null ? '' : s)].length;

class CapError extends Error {
  constructor(field, limit, actual) {
    super(`${field} is ${actual} code points, Meta allows ${limit}`);
    this.code = 'E2E_CAP'; this.field = field; this.limit = limit; this.actual = actual;
  }
}
const check = (field, value, limit) => { const n = cp(value); if (n > limit) throw new CapError(field, limit, n); };

/** Validate a send payload against the caps, then normalize it into an outbox item. */
function normalize(payload) {
  const type = payload.type;
  if (type === 'text') {
    return { type: 'text', txt: String(payload.text && payload.text.body || ''), btns: [] };
  }
  if (type === 'interactive' && payload.interactive) {
    const it = payload.interactive;
    const header = it.header && it.header.type === 'text' ? it.header.text : (it.header && it.header.text) || '';
    const body = (it.body && it.body.text) || '';
    const footer = (it.footer && it.footer.text) || '';
    if (header) check('header', header, CAPS.header);
    check('body', body, CAPS.body);
    if (footer) check('footer', footer, CAPS.footer);
    const txt = [header, body, footer].filter(Boolean).join('\n');
    const action = it.action || {};
    if (it.type === 'button') {
      const buttons = action.buttons || [];
      if (buttons.length > CAPS.buttons) throw new CapError('buttons', CAPS.buttons, buttons.length);
      for (const b of buttons) check('button', b.reply && b.reply.title, CAPS.button);
      return { type: 'interactive.button', txt, btns: buttons.map((b) => b.reply && b.reply.title).filter(Boolean) };
    }
    if (it.type === 'list') {
      check('list.button', action.button, CAPS.listButton);
      const sections = action.sections || [];
      if (sections.length > CAPS.sections) throw new CapError('sections', CAPS.sections, sections.length);
      const rows = sections.flatMap((s) => s.rows || []);
      if (rows.length > CAPS.rows) throw new CapError('rows', CAPS.rows, rows.length);
      for (const r of rows) {
        check('row.title', r.title, CAPS.rowTitle);
        if (r.description) check('row.description', r.description, CAPS.rowDescription);
      }
      return { type: 'interactive.list', txt, btns: [action.button].filter(Boolean),
        list: { button: action.button, rows: rows.map((r) => ({ id: r.id, title: r.title, description: r.description })) } };
    }
    if (it.type === 'flow') {
      const p = action.parameters || {};
      // Recorded as the CARD the teacher sees. The Flow itself is NOT rendered here.
      return { type: 'interactive.flow', txt, btns: [p.flow_cta].filter(Boolean),
        flow: { id: p.flow_id, cta: p.flow_cta, token: p.flow_token, action: p.flow_action } };
    }
    return { type: 'interactive.' + it.type, txt, btns: [] };
  }
  if (['document', 'image', 'audio', 'video', 'sticker'].includes(type) && payload[type]) {
    // A media send: what WhatsApp Web shows is the caption (or nothing) plus a player/thumbnail —
    // the CDP reader turns that into txt + img/audio/doc flags. `media` carries what the bot sent
    // (by id → the uploaded bytes, by link → the URL) so a PDF report is evidence, hashed.
    const m = payload[type];
    const filename = m.filename || (m.link ? path.basename(new URL(m.link).pathname) : '');
    const txt = String(m.caption || '');
    return { type, txt, btns: [],
      img: type === 'image' || type === 'sticker', audio: type === 'audio', doc: type === 'document',
      pdf: /\.pdf$/i.test(filename) || /\.pdf/i.test(txt),
      media: { id: m.id, link: m.link, filename } };
  }
  // reaction / typing indicator / template: recorded, not asserted on in Phase 1.
  return { type: type || 'unknown', txt: '', btns: [] };
}

function createMockGraphApi(opts = {}) {
  const phoneNumberId = opts.phoneNumberId || process.env.PHONE_NUMBER_ID || 'e2e-local';
  const botUrl = (opts.botUrl || process.env.MOCK_BOT_URL || 'http://127.0.0.1:3100').replace(/\/+$/, '');
  const state = { seq: 0, outbox: [], signals: 0, media: new Map(), mediaSeq: 0 };
  const reset = () => { state.seq = 0; state.outbox = []; state.signals = 0; state.media.clear(); state.mediaSeq = 0; };
  let selfBase = '';   // set on listen(); the URL getMediaInfo hands back must point at THIS server
  const storeMedia = (bytes, mime, filename) => {
    const id = `media.mock.${++state.mediaSeq}`;
    state.media.set(id, { id, bytes, mime, filename, sha256: sha256(bytes), storedAt: new Date().toISOString() });
    return state.media.get(id);
  };
  const say = (m) => { if (!opts.quiet) console.log(`[mock-graph-api] ${new Date().toISOString().slice(11, 23)} ${m}`); };
  // A full, structured conversation record (both sides) when MOCK_TRANSCRIPT is set — the mock.log is
  // truncated and one-sided; this is what a chat viewer renders. One JSON line per message.
  const TRANSCRIPT = process.env.MOCK_TRANSCRIPT;
  const tlog = (rec) => { if (!TRANSCRIPT) return; try { fs.appendFileSync(TRANSCRIPT, JSON.stringify({ ts: new Date().toISOString(), ...rec }) + '\n'); } catch (_) { /* never fail a send on a log write */ } };
  // Reactions, read receipts and typing indicators are API calls, not messages: WhatsApp Web shows no
  // row for them and the CDP reader never sees them. They are acknowledged and counted, never queued —
  // the first live run picked a reaction up as "the reply" and M01 read an empty header (2026-09-07).
  const isSignal = (p) => !p || !p.type || p.type === 'reaction' || p.status === 'read' || p.typing_indicator;

  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const readBody = (req) => new Promise((resolve, reject) => {
    let b = ''; req.on('data', (c) => { b += c; }); req.on('error', reject);
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  });

  async function inject(body) {
    const from = body.from;
    let payload, mediaId;
    tlog({ dir: 'in', kind: body.kind,
      text: body.kind === 'text' ? body.text
          : (body.kind === 'button' || body.kind === 'list') ? body.title
          : body.kind === 'flow' ? ('↩ Flow completed' + (body.flowId ? ' (' + body.flowId + ')' : ''))
          : (body.filename || (body.path ? path.basename(body.path) : body.kind)),
      id: body.id, title: body.title });
    switch (body.kind) {
      case 'text': payload = sim.simulateMessage(String(body.text), { from }); break;
      case 'button': payload = sim.buttonReply(body.id, body.title, { from }); break;
      case 'list': payload = sim.listReply(body.id, body.title, { from }); break;
      case 'flow': payload = sim.flowReply(body.flowId, body.response_json, { from }); break;
      case 'document': case 'image': case 'audio': case 'video': {
        // The teacher "attaches a file": read it off THIS machine, register it so the bot's
        // downloadMedia() can fetch it back through the Graph API, then forge the message.
        let bytes;
        try { bytes = fs.readFileSync(body.path); } catch (e) { return { status: 400, body: { ok: false, error: 'cannot read ' + body.path + ': ' + e.message } }; }
        const filename = body.filename || path.basename(body.path);
        const rec = storeMedia(bytes, mimeFor(body.path, body.mime), filename);
        mediaId = rec.id;
        payload = sim.mediaMessage(body.kind, rec.id, { mime: rec.mime, filename, size: bytes.length, caption: body.caption, sha256: rec.sha256 }, { from });
        break;
      }
      default: return { status: 400, body: { ok: false, error: 'unknown kind: ' + body.kind } };
    }
    // The bot's cross-WABA guard drops any payload whose phone_number_id is not its own; the mock
    // knows which id the bot was started with, so it stamps it here rather than trusting the env.
    payload.entry[0].changes[0].value.metadata.phone_number_id = phoneNumberId;
    const messageId = payload.entry[0].changes[0].value.messages[0].id;
    try {
      const r = await fetch(botUrl + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      return { status: 200, body: { ok: r.ok, status: r.status, messageId, ...(mediaId ? { mediaId } : {}) } };
    } catch (e) {
      return { status: 502, body: { ok: false, error: 'bot unreachable at ' + botUrl + ': ' + e.message, messageId } };
    }
  }
  const readRaw = (req) => new Promise((resolve, reject) => { const c = []; req.on('data', (d) => c.push(d)); req.on('error', reject); req.on('end', () => resolve(Buffer.concat(c))); });

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://mock');
      const parts = u.pathname.split('/').filter(Boolean);
      if (req.method === 'GET' && u.pathname === '/health') return json(res, 200, { ok: true, seq: state.seq, signals: state.signals, bot: botUrl, phoneNumberId });
      if (req.method === 'GET' && u.pathname === '/outbox') {
        const after = Number(u.searchParams.get('after') || 0);
        const to = u.searchParams.get('to');
        const items = state.outbox.filter((i) => i.seq > after && (!to || i.to === to));
        return json(res, 200, { items, last: state.seq });
      }
      if (req.method === 'POST' && u.pathname === '/reset') { reset(); return json(res, 200, { ok: true }); }
      if (req.method === 'POST' && u.pathname === '/inject') {
        const out = await inject(await readBody(req));
        return json(res, out.status, out.body);
      }
      // ── media ──
      // harness: register a local file as if the teacher had attached it (returns the media id)
      if (req.method === 'POST' && u.pathname === '/media/register') {
        const b = await readBody(req);
        let bytes; try { bytes = fs.readFileSync(b.path); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
        const rec = storeMedia(bytes, mimeFor(b.path, b.mime), b.filename || path.basename(b.path));
        return json(res, 200, { id: rec.id, mime: rec.mime, bytes: bytes.length, sha256: rec.sha256 });
      }
      // Meta: the bytes behind a media id (the `url` getMediaInfo returned points here)
      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'media' && parts[2] === 'bytes') {
        const rec = state.media.get(parts[1]);
        if (!rec) return json(res, 404, { error: { message: 'unknown media ' + parts[1], code: 100 } });
        res.writeHead(200, { 'Content-Type': rec.mime, 'Content-Length': rec.bytes.length }); return res.end(rec.bytes);
      }
      // Meta: POST /<version>/<phone_number_id>/media — the bot uploads a document/audio/image to send
      if (req.method === 'POST' && parts.length === 3 && parts[2] === 'media') {
        if (parts[1] !== phoneNumberId) return json(res, 400, { error: { message: `Unknown phone_number_id ${parts[1]}`, code: 100 } });
        const mp = parseMultipart(await readRaw(req), req.headers['content-type']);
        if (!mp || !mp.file) return json(res, 400, { error: { message: 'no file part', code: 100 } });
        const rec = storeMedia(mp.file.bytes, mp.file.mime, mp.file.filename);
        say(`media upload ${rec.id} ${rec.mime} ${rec.bytes.length}B ${rec.filename}`);
        return json(res, 200, { id: rec.id });
      }
      // Meta: GET /<version>/<media_id> — metadata + a download url (which points back at this server)
      if (req.method === 'GET' && parts.length === 2 && /^v\d+\.\d+$/.test(parts[0])) {
        const rec = state.media.get(parts[1]);
        if (!rec) return json(res, 404, { error: { message: 'unknown media ' + parts[1], code: 100 } });
        return json(res, 200, { id: rec.id, url: `${selfBase}/media/${rec.id}/bytes`, mime_type: rec.mime, file_size: rec.bytes.length, sha256: rec.sha256, messaging_product: 'whatsapp' });
      }
      // /<version>/<phone_number_id>/messages — the Meta send endpoint.
      if (req.method === 'POST' && parts.length === 3 && parts[2] === 'messages') {
        if (parts[1] !== phoneNumberId) {
          return json(res, 400, { error: { message: `Unknown phone_number_id ${parts[1]} (mock serves ${phoneNumberId})`, code: 100 } });
        }
        const payload = await readBody(req);
        if (isSignal(payload)) {
          state.signals += 1;
          say(`signal ${payload.type || payload.status || 'typing'} → ${payload.to || payload.message_id || ''}`);
          return json(res, 200, { messaging_product: 'whatsapp', success: true, messages: [{ id: `wamid.mock.signal.${state.signals}` }] });
        }
        let norm;
        try { norm = normalize(payload); }
        catch (e) {
          if (e.code === 'E2E_CAP') { say(`REJECT E2E_CAP ${e.field} ${e.actual}>${e.limit}`); return json(res, 422, { error: { code: 'E2E_CAP', field: e.field, limit: e.limit, actual: e.actual, message: e.message } }); }
          throw e;
        }
        const seq = ++state.seq;
        const id = `wamid.mock.${seq}`;
        if (norm.media && norm.media.id && state.media.has(norm.media.id)) {
          const rec = state.media.get(norm.media.id);
          norm.media = { ...norm.media, filename: norm.media.filename || rec.filename, mime: rec.mime, bytes: rec.bytes.length, sha256: rec.sha256 };
          if (/\.pdf$/i.test(norm.media.filename || '') || rec.mime === 'application/pdf') norm.pdf = true;
        }
        state.outbox.push({ seq, id, ts: new Date().toISOString(), to: payload.to, ...norm, raw: payload });
        tlog({ dir: 'out', seq, type: norm.type, txt: norm.txt, btns: norm.btns, list: norm.list, flow: norm.flow, media: norm.media, pdf: norm.pdf });
        say(`#${seq} ${norm.type} → ${payload.to}: ${JSON.stringify(norm.txt).slice(0, 70)}${norm.btns.length ? ' btns=' + JSON.stringify(norm.btns) : ''}`);
        return json(res, 200, { messaging_product: 'whatsapp', contacts: [{ input: payload.to, wa_id: payload.to }], messages: [{ id }] });
      }
      return json(res, 404, { error: { message: `mock-graph-api: no route ${req.method} ${u.pathname}`, code: 404 } });
    } catch (e) {
      return json(res, 500, { error: { message: e.message } });
    }
  });

  return {
    server, state, phoneNumberId, botUrl,
    listen: (port = Number(process.env.MOCK_PORT || 4010), host = '127.0.0.1') =>
      new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { selfBase = `http://${host}:${server.address().port}`; resolve(server.address().port); }); }),
    close: () => new Promise((resolve) => server.close(() => resolve())),
    reset,
  };
}

module.exports = { createMockGraphApi, normalize, CAPS, CapError };

if (require.main === module) {
  const api = createMockGraphApi();
  api.listen().then((port) => {
    console.log(JSON.stringify({ mockGraphApi: `http://127.0.0.1:${port}`, phoneNumberId: api.phoneNumberId, bot: api.botUrl }));
  }).catch((e) => { console.error('mock-graph-api failed to listen: ' + e.message); process.exit(1); });
}
