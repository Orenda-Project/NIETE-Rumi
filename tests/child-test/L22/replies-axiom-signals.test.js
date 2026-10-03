'use strict';
/**
 * bd-s1oo0.30 (L22) — in sandbox mode a 👍 reaction is not the bot's reply, and a refused one is not a
 * bot fault.
 *
 * Sandbox run sandbox5-syn-2032 read every `whatsapp.outbound_echo` line back as a reply, reactions
 * included. Two consequences:
 *   1. The reaction (sent ~0.2 s after the webhook) became "the first bot message after the coach's
 *      send", so rtt_text_reply p50 = 0.156 s and rtt_media_ack p50 = 0.152 s were the time to a 👍
 *      that Meta had refused — not to the bot's answer. The dry-mode mock already treats reactions as
 *      signals, never queued (mock-graph-api isSignal, 2026-09-07); the Axiom reader did not.
 *   2. "37 of 37 reactions failed" was read as a bot defect. 16 were Meta 131009 "Invalid message_id":
 *      the simulator injects `sim_<ms>_<n>` ids Meta never issued, so no reaction to them can ever
 *      succeed. 21 were the pacer skipping a best-effort reaction (status 429 written locally).
 *
 * Now: reactions are dropped from the replies and tallied by cause in `signals()`.
 * Only the Axiom HTTP API (global.fetch) is mocked.
 */
const { create } = require('../../../bot/scripts/e2e/child-test-sim/replies-axiom');
const { sandboxTransport } = require('../../../bot/scripts/e2e/child-test-sim/transports');

const SIM = '923009990301';
const T0 = Date.parse('2026-10-02T17:00:00Z');

function echoRow({ id, sentMs, payload, ok = true, status = 200, local, messageId = null }) {
  const data = { echo_id: id, echo_seq: 1, sent_at: new Date(sentMs).toISOString(), to: SIM, ok, status, message_id: messageId, payload };
  if (local !== undefined) data.local = local;
  return { _time: new Date(sentMs + 1500).toISOString(), data: { event: 'whatsapp.outbound_echo', phone: SIM, data_json: JSON.stringify(data) } };
}
const text = (body) => ({ messaging_product: 'whatsapp', to: SIM, type: 'text', text: { body } });
const reaction = (mid) => ({ messaging_product: 'whatsapp', recipient_type: 'individual', to: SIM, type: 'reaction', reaction: { message_id: mid, emoji: '👍' } });

const CFG = { driver: SIM, replies: { dataset: 'rumi-sandbox', tokenEnv: 'SIM_AX_TOKEN', orgEnv: 'SIM_AX_ORG', sinceMs: T0 } };
beforeEach(() => { process.env.SIM_AX_TOKEN = 'xaat-test'; });

function axiomReturning(rows) {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ matches: rows }) }));
}

const ROWS = [
  // refused by Meta: the reacted-to id was injected by the simulator
  echoRow({ id: 'r1', sentMs: T0 + 100, payload: reaction('sim_1790973148136_1'), ok: false, status: 400, local: null }),
  echoRow({ id: 't1', sentMs: T0 + 2100, payload: text('🎧 received · Urdu'), messageId: 'wamid.T1' }),
  // skipped by the pacer: new echo shape (local) and the shape the deployed bot writes today (429, no local)
  echoRow({ id: 'r2', sentMs: T0 + 5000, payload: reaction('sim_1790973148136_2'), ok: false, status: 429, local: 'skipped' }),
  echoRow({ id: 'r3', sentMs: T0 + 6000, payload: reaction('sim_1790973148136_3'), ok: false, status: 429 }),
  // a reaction to a real Meta id that was delivered, and one Meta refused for another reason
  echoRow({ id: 'r4', sentMs: T0 + 7000, payload: reaction('wamid.REAL1'), ok: true, status: 200, local: null }),
  echoRow({ id: 'r5', sentMs: T0 + 8000, payload: reaction('wamid.REAL2'), ok: false, status: 400, local: null }),
];

test('a reaction is never returned as a reply: the first item after the coach\'s send is the bot\'s answer', async () => {
  axiomReturning(ROWS);
  const src = create(CFG);
  const items = await src.poll(0);
  expect(items.map((i) => [i.seq, i.type, i.txt])).toEqual([[1, 'text', '🎧 received · Urdu']]);
});

test('reactions are tallied by cause: delivered, refused for a simulator id, skipped by the pacer, refused otherwise', async () => {
  axiomReturning(ROWS);
  const src = create(CFG);
  await src.poll(0);
  await src.poll(1);   // a re-read of the same rows counts nothing twice
  expect(src.signals()).toEqual({
    reactions: { sent: 5, delivered: 1, refused_sim_id: 1, pacer_skipped: 2, refused_other: 1 },
  });
});

test('the sandbox transport hands the reader\'s tally to the driver', async () => {
  axiomReturning(ROWS);
  const replies = create(CFG);
  const t = sandboxTransport({ botUrl: 'https://bot-sandbox.up.railway.app/webhook', allowHosts: ['bot-sandbox.up.railway.app'],
    phoneNumberId: 'ph', wabaToken: 'w', driver: SIM, replies });
  await t.poll(0);
  expect(t.signals()).toEqual(replies.signals());
  expect(t.signals().reactions.refused_sim_id).toBe(1);
});
