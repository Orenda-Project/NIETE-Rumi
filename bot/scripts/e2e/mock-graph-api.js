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
const { URL } = require('url');
const sim = require('../simulate');

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
  // reaction / typing indicator / template / media: recorded, not asserted on in Phase 1.
  return { type: type || 'unknown', txt: '', btns: [] };
}

function createMockGraphApi(opts = {}) {
  const phoneNumberId = opts.phoneNumberId || process.env.PHONE_NUMBER_ID || 'e2e-local';
  const botUrl = (opts.botUrl || process.env.MOCK_BOT_URL || 'http://127.0.0.1:3100').replace(/\/+$/, '');
  const state = { seq: 0, outbox: [] };
  const reset = () => { state.seq = 0; state.outbox = []; };

  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const readBody = (req) => new Promise((resolve, reject) => {
    let b = ''; req.on('data', (c) => { b += c; }); req.on('error', reject);
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  });

  async function inject(body) {
    const from = body.from;
    let payload;
    switch (body.kind) {
      case 'text': payload = sim.simulateMessage(String(body.text), { from }); break;
      case 'button': payload = sim.buttonReply(body.id, body.title, { from }); break;
      case 'list': payload = sim.listReply(body.id, body.title, { from }); break;
      default: return { status: 400, body: { ok: false, error: 'unknown kind: ' + body.kind } };
    }
    // The bot's cross-WABA guard drops any payload whose phone_number_id is not its own; the mock
    // knows which id the bot was started with, so it stamps it here rather than trusting the env.
    payload.entry[0].changes[0].value.metadata.phone_number_id = phoneNumberId;
    const messageId = payload.entry[0].changes[0].value.messages[0].id;
    try {
      const r = await fetch(botUrl + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      return { status: 200, body: { ok: r.ok, status: r.status, messageId } };
    } catch (e) {
      return { status: 502, body: { ok: false, error: 'bot unreachable at ' + botUrl + ': ' + e.message, messageId } };
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://mock');
      const parts = u.pathname.split('/').filter(Boolean);
      if (req.method === 'GET' && u.pathname === '/health') return json(res, 200, { ok: true, seq: state.seq, bot: botUrl, phoneNumberId });
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
      // /<version>/<phone_number_id>/messages — the Meta send endpoint.
      if (req.method === 'POST' && parts.length === 3 && parts[2] === 'messages') {
        if (parts[1] !== phoneNumberId) {
          return json(res, 400, { error: { message: `Unknown phone_number_id ${parts[1]} (mock serves ${phoneNumberId})`, code: 100 } });
        }
        const payload = await readBody(req);
        let norm;
        try { norm = normalize(payload); }
        catch (e) {
          if (e.code === 'E2E_CAP') return json(res, 422, { error: { code: 'E2E_CAP', field: e.field, limit: e.limit, actual: e.actual, message: e.message } });
          throw e;
        }
        const seq = ++state.seq;
        const id = `wamid.mock.${seq}`;
        state.outbox.push({ seq, id, ts: new Date().toISOString(), to: payload.to, ...norm, raw: payload });
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
      new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => resolve(server.address().port)); }),
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
