/**
 * fake-bot — a stand-in for the bot's side of the child-test conversation, for dry runs before L4's real
 * handler exists and for the driver's own tests. It is a network PEER (an HTTP server that receives the
 * webhooks mock-graph-api forges and answers through the mock's Graph endpoints), not a mock of any bot
 * module, and it speaks only what CONTRACT v0.2 fixes: `ctst_` ids, today's list (5 children + 2
 * alternates, roll numbers only), Present / Absent / Refused, one voice note per block, the strip photo,
 * a check Flow card per child.
 *
 * It downloads every media item it is sent through the mock's Graph API — exactly what the real bot's
 * downloadMedia() does — so a test can prove the bytes arrived.
 */
'use strict';
const http = require('http');

const BLOCKS = ['urdu', 'english', 'maths'];

function createFakeBot({ phoneNumberId, absentRolls = [], checkFlowId = 'ctst-check-flow', idStyle = 'contract' } = {}) {
  // idStyle 'l4' mirrors childtest-golive's machine.js: ctst_child:<drawId>, ctst_alt:<drawId>, ctst_pres:<drawId>:p|a|r,
  // the roll first in the row title, and an absent child that stays on the list (marked) while its alternate is offered.
  const L4 = idStyle === 'l4';
  let graph = '';
  const received = []; const receivedMediaBytes = [];
  const state = { rows: [1, 2, 3, 4, 5], alternates: [6, 7], children: {}, absent: new Set() };
  const self = { received, receivedMediaBytes, mute: false };

  async function send(to, payload) {
    if (self.mute) return;
    await fetch(`${graph}/v21.0/${phoneNumberId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, ...payload }) });
  }
  const text = (to, body) => send(to, { type: 'text', text: { body } });
  const rowId = (kind, r) => (L4 ? `ctst_${kind}:d${r}` : `ctst_${kind}_${r}`);
  const rowTitle = (r) => (L4 ? `${r} · بچہ` : `Roll ${r}`);
  const list = (to) => send(to, { type: 'interactive', interactive: { type: 'list', header: { type: 'text', text: 'بچوں کا ٹیسٹ' },
    body: { text: 'آج کے بچے' }, action: { button: 'بچے', sections: [
      { title: 'Children', rows: state.rows.map((r) => ({ id: rowId('child', r), title: rowTitle(r), description: state.absent.has(r) ? 'absent' : (r === 5 ? 'returning' : 'new') })) },
      { title: 'Alternates', rows: state.alternates.map((r) => ({ id: rowId('alt', r), title: rowTitle(r) })) }] } } });
  const pres = (r, k, legacy) => (L4 ? `ctst_pres:d${r}:${k}` : `ctst_${legacy}_${r}`);
  const buttons = (to, r) => send(to, { type: 'interactive', interactive: { type: 'button', body: { text: `Roll ${r}` }, action: { buttons: [
    { type: 'reply', reply: { id: pres(r, 'p', 'present'), title: 'حاضر' } },
    { type: 'reply', reply: { id: pres(r, 'a', 'absent'), title: 'غیر حاضر' } },
    { type: 'reply', reply: { id: pres(r, 'r', 'refused'), title: 'انکار' } }] } } });
  const checkCard = (to, r) => send(to, { type: 'interactive', interactive: { type: 'flow', body: { text: `Roll ${r}: marks ready` },
    action: { name: 'flow', parameters: { flow_message_version: '3', flow_id: checkFlowId, flow_cta: 'چیک کریں', flow_token: `ctst_check_${r}`, flow_action: 'data_exchange' } } } });

  async function fetchMedia(id) {
    const info = await (await fetch(`${graph}/v21.0/${id}`)).json();
    receivedMediaBytes.push(Buffer.from(await (await fetch(info.url)).arrayBuffer()));
  }

  async function onMessage(m) {
    received.push(m);
    const to = m.from; const cur = state.current;
    if (m.type === 'text' && /\/egra/.test(m.text.body)) return list(to);
    if (m.type === 'interactive' && m.interactive.type === 'list_reply') {
      const r = Number((/(\d+)$/.exec(m.interactive.list_reply.id) || [])[1]); state.current = r; return buttons(to, r);
    }
    if (m.type === 'interactive' && m.interactive.type === 'button_reply') {
      const id = m.interactive.button_reply.id;
      const l4 = /^ctst_pres:d(\d+):([par])$/.exec(id); const legacy = /^ctst_([a-z]+)_(\d+)$/.exec(id);
      const r = Number(l4 ? l4[1] : legacy[2]); const what = l4 ? { p: 'present', a: 'absent', r: 'refused' }[l4[2]] : legacy[1];
      if (what === 'present') {
        if (state.alternates.includes(r)) { state.alternates = state.alternates.filter((x) => x !== r); state.rows.push(r); }
        state.children[r] = { next: 0 }; return text(to, `Roll ${r}: Urdu block — one voice note`);
      }
      if (L4) state.absent.add(r);                                                     // stays, marked; alternate offered below
      else state.rows = state.rows.map((x) => (x === r ? state.alternates.shift() : x));  // absent/refused → next alternate
      return list(to);
    }
    if (m.type === 'audio' && cur && state.children[cur]) {
      await fetchMedia(m.audio.id);
      const c = state.children[cur]; const b = BLOCKS[c.next++];
      return text(to, c.next < 3 ? `${b} received. Next: ${BLOCKS[c.next]}` : `${b} received. Now a photo of the strip`);
    }
    if (m.type === 'image' && cur) {
      await fetchMedia(m.image.id);
      await text(to, `Roll ${cur}: all received`);
      return checkCard(to, cur);
    }
    if (m.type === 'interactive' && m.interactive.type === 'nfm_reply') {
      const tok = JSON.parse(m.interactive.nfm_reply.response_json).flow_token || '';
      return text(to, `Saved ${tok.replace('ctst_check_', 'roll ')}`);
    }
    return text(to, 'not understood');
  }

  const server = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', async () => {
      res.end('ok');
      try {
        const msg = JSON.parse(b).entry[0].changes[0].value.messages[0];
        await onMessage(msg);
      } catch (e) { /* a malformed webhook is ignored, as Meta's retries would be */ }
    });
  });
  self.listen = (port = 0) => new Promise((r) => server.listen(port, '127.0.0.1', () => r(server.address().port)));
  self.close = () => new Promise((r) => server.close(() => r()));
  self.setGraphBase = (u) => { graph = u.replace(/\/+$/, ''); };
  self.absentRolls = absentRolls;
  return self;
}

module.exports = { createFakeBot };
