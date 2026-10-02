'use strict';
/**
 * replies-axiom — the sandbox driver's reply source: the bot's own `whatsapp.outbound_echo` lines in
 * the Axiom dataset `rumi-sandbox`, turned back into the mock outbox shape the coach player reads.
 *
 * Only the Axiom HTTP API (global.fetch) is mocked.
 */
const { create, toItem, buildApl } = require('../../../bot/scripts/e2e/child-test-sim/replies-axiom');
const { DEFAULT_MATCH } = require('../../../bot/scripts/e2e/child-test-sim/coach');

const SIM = '923009990301';
const T0 = Date.parse('2026-10-02T17:00:00Z');

function echoRow({ id, seq = 1, to = SIM, sentMs = T0 + 1000, ingestMs = sentMs + 1500, payload, ok = true }) {
  const data = { echo_id: id, echo_seq: seq, sent_at: new Date(sentMs).toISOString(), to, ok, status: 200, message_id: 'wamid.' + id, payload };
  return { _time: new Date(ingestMs).toISOString(), data: { msg: 'whatsapp.outbound_echo', event: 'whatsapp.outbound_echo', phone: to, data_json: JSON.stringify(data) } };
}
const text = (body) => ({ messaging_product: 'whatsapp', to: SIM, type: 'text', text: { body } });
const list = { messaging_product: 'whatsapp', to: SIM, type: 'interactive', interactive: { type: 'list', body: { text: 'Today: Grade 3' },
  action: { button: 'Children', sections: [{ title: 'Grade 3 A', rows: [{ id: 'ctst_child:d1', title: '4 · Child 3A-04' }, { id: 'ctst_alt:d6', title: '9 · Child 3A-09' }] }] } } };
const buttons = { messaging_product: 'whatsapp', to: SIM, type: 'interactive', interactive: { type: 'button', body: { text: 'Roll 4' },
  action: { buttons: [{ type: 'reply', reply: { id: 'ctst_pres:d1:p', title: 'Present' } }, { type: 'reply', reply: { id: 'ctst_pres:d1:a', title: 'Absent' } }] } } };
const flow = { messaging_product: 'whatsapp', to: SIM, type: 'interactive', interactive: { type: 'flow', body: { text: 'Check roll 4' },
  action: { name: 'flow', parameters: { flow_message_version: '3', flow_id: 'F1', flow_cta: 'Check', flow_token: 'ctst_check:s1:4', flow_action: 'data_exchange' } } } };

function axiomReturning(...batches) {
  const calls = [];
  global.fetch = jest.fn(async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    const rows = batches.length > 1 ? batches.shift() : batches[0];
    return { ok: true, status: 200, json: async () => ({ matches: rows }) };
  });
  return calls;
}

const CFG = { driver: SIM, replies: { module: './replies-axiom.js', dataset: 'rumi-sandbox', tokenEnv: 'SIM_AX_TOKEN', orgEnv: 'SIM_AX_ORG' } };

beforeEach(() => { process.env.SIM_AX_TOKEN = 'xaat-test'; process.env.SIM_AX_ORG = 'org-test'; });

describe('buildApl', () => {
  test('filters strictly: the dataset, the echo event, the one phone and the run window', () => {
    const apl = buildApl({ dataset: 'rumi-sandbox', phone: SIM, fromIso: '2026-10-02T17:00:00.000Z' });
    expect(apl).toContain('["rumi-sandbox"]');
    expect(apl).toContain('event == "whatsapp.outbound_echo"');
    expect(apl).toContain(`phone == "${SIM}"`);
    expect(apl).toContain('_time >= datetime("2026-10-02T17:00:00.000Z")');
  });
  test('refuses a phone that is not digits (no APL injection)', () => {
    expect(() => buildApl({ dataset: 'rumi-sandbox', phone: '92" or 1==1', fromIso: 'x' })).toThrow(/phone/);
  });
});

describe('toItem: the mock outbox shape the coach player reads', () => {
  test('a list keeps its row ids, and the coach player recognises it as today\'s list', () => {
    const it = toItem(JSON.parse(echoRow({ id: 'a', payload: list }).data.data_json), 1);
    expect(it.type).toBe('interactive.list');
    expect(it.list.rows.map((r) => r.id)).toEqual(['ctst_child:d1', 'ctst_alt:d6']);
    expect(DEFAULT_MATCH.list(it)).toBe(true);
  });
  test('buttons carry raw.interactive so Present/Absent can be found by id', () => {
    const it = toItem(JSON.parse(echoRow({ id: 'b', payload: buttons }).data.data_json), 2);
    expect(DEFAULT_MATCH.presentButtons(it)).toBe(true);
    expect(it.btns).toEqual(['Present', 'Absent']);
  });
  test('a Flow card carries its token', () => {
    const it = toItem(JSON.parse(echoRow({ id: 'c', payload: flow }).data.data_json), 3);
    expect(it.flow).toMatchObject({ id: 'F1', token: 'ctst_check:s1:4' });
    expect(DEFAULT_MATCH.checkCard(it)).toBe(true);
  });
  test('the bot\'s send time and send verdict ride along', () => {
    const it = toItem(JSON.parse(echoRow({ id: 'd', payload: text('hi'), ok: false, sentMs: T0 + 5000 }).data.data_json), 4);
    expect(it).toMatchObject({ seq: 4, type: 'text', txt: 'hi', sent_ms: T0 + 5000, send_ok: false });
  });
  test('a payload over a WhatsApp cap is still delivered, flagged with the cap it broke', () => {
    const long = { ...buttons, interactive: { ...buttons.interactive, action: { buttons: [{ type: 'reply', reply: { id: 'x', title: 'A title far longer than twenty' } }] } } };
    const it = toItem(JSON.parse(echoRow({ id: 'e', payload: long }).data.data_json), 5);
    expect(it.cap_error).toMatch(/button/);
    expect(it.raw.interactive.action.buttons[0].reply.id).toBe('x');
  });
});

describe('poll', () => {
  test('returns new items in send order with rising seq; a second poll returns only what is new', async () => {
    const r1 = [echoRow({ id: 'b', seq: 2, sentMs: T0 + 2000, payload: buttons }), echoRow({ id: 'a', seq: 1, sentMs: T0 + 1000, payload: list })];
    const r2 = [...r1, echoRow({ id: 'c', seq: 3, sentMs: T0 + 3000, payload: text('next') })];
    const calls = axiomReturning(r1, r2);
    const src = create({ ...CFG, replies: { ...CFG.replies, sinceMs: T0 } });
    const first = await src.poll(0);
    expect(first.map((i) => [i.seq, i.type])).toEqual([[1, 'interactive.list'], [2, 'interactive.button']]);
    const second = await src.poll(2);
    expect(second.map((i) => [i.seq, i.txt])).toEqual([[3, 'next']]);
    expect(calls[0].url).toBe('https://api.axiom.co/v1/datasets/_apl?format=legacy');
    expect(calls[0].init.headers.Authorization).toBe('Bearer xaat-test');
    expect(calls[0].init.headers['X-Axiom-Org-Id']).toBe('org-test');
  });

  test('a row for another phone or from before the run is dropped even if Axiom returns it', async () => {
    axiomReturning([
      echoRow({ id: 'x', to: '923001112223', payload: { ...text('someone else'), to: '923001112223' } }),
      echoRow({ id: 'y', sentMs: T0 - 60000, payload: text('old run') }),
      echoRow({ id: 'z', payload: text('mine') }),
    ]);
    const src = create({ ...CFG, replies: { ...CFG.replies, sinceMs: T0 } });
    expect((await src.poll(0)).map((i) => i.txt)).toEqual(['mine']);
  });

  test('poll(after) with an older cursor replays from the cursor (the coach player re-reads nothing it saw)', async () => {
    axiomReturning([echoRow({ id: 'a', payload: text('one') }), echoRow({ id: 'b', sentMs: T0 + 2000, payload: text('two') })]);
    const src = create({ ...CFG, replies: { ...CFG.replies, sinceMs: T0 } });
    await src.poll(0);
    expect((await src.poll(1)).map((i) => i.txt)).toEqual(['two']);
  });

  test('refuses a production dataset and a missing token', () => {
    expect(() => create({ ...CFG, replies: { ...CFG.replies, dataset: 'niete-logs' } })).toThrow(/production/);
    delete process.env.SIM_AX_TOKEN;
    expect(() => create(CFG)).toThrow(/SIM_AX_TOKEN/);
  });

  test('an Axiom error is loud, never an empty "no replies yet"', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({ message: 'forbidden' }) }));
    const src = create({ ...CFG, replies: { ...CFG.replies, sinceMs: T0 } });
    await expect(src.poll(0)).rejects.toThrow(/axiom 403/);
  });
});
