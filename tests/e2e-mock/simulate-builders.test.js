/**
 * simulate.js builders — every forged webhook must survive the bot's own inbound guards.
 *
 * The webhook handler drops a payload silently when: entry.id is a Meta sample id,
 * metadata.phone_number_id is not OUR PHONE_NUMBER_ID, `from` is a Meta test number, or
 * the message id was seen before (in-process dedupe). A builder that trips any of those
 * produces a run where the bot "never replied" for a reason nobody can see.
 *
 * Red-first: fails on develop — buttonReply / listReply do not exist, and two text
 * messages built in the same millisecond share an id.
 */
const load = () => {
  jest.resetModules();
  process.env.PHONE_NUMBER_ID = 'ph-1';
  return {
    sim: require('../../bot/scripts/simulate'),
    v: require('../../bot/shared/utils/validators'),
  };
};

const guards = (v, payload) => {
  const parsed = v.validateWebhookMessage({ body: payload });
  return {
    parsed,
    ours: v.isOurPhoneNumber(parsed.phoneNumberId),
    testWebhook: v.isTestWebhook(parsed.entry),
    testPhone: v.isTestPhoneNumber(parsed.from),
  };
};

describe('simulate.js builders pass the inbound guards', () => {
  test('simulateMessage (text) is accepted and typed text', () => {
    const { sim, v } = load();
    const g = guards(v, sim.simulateMessage('/menu', { from: '923000000001' }));
    expect(g.parsed.messageType).toBe('text');
    expect(g.parsed.messageBody).toBe('/menu');
    expect(g.ours).toBe(true);
    expect(g.testWebhook).toBe(false);
    expect(g.testPhone).toBe(false);
  });

  test('two text messages built back to back never share a message id', () => {
    const { sim } = load();
    const ids = new Set();
    for (let i = 0; i < 50; i++) ids.add(sim.simulateMessage('x').entry[0].changes[0].value.messages[0].id);
    expect(ids.size).toBe(50);
  });

  test('listReply forges an interactive list_reply the handler routes by id', () => {
    const { sim, v } = load();
    const g = guards(v, sim.listReply('menu_ask_anything', 'Ask Anything', { from: '923000000001' }));
    expect(g.parsed.messageType).toBe('interactive');
    expect(g.parsed.message.interactive.type).toBe('list_reply');
    expect(g.parsed.message.interactive.list_reply).toEqual({ id: 'menu_ask_anything', title: 'Ask Anything' });
    expect(g.parsed.from).toBe('923000000001');
    expect(g.ours && !g.testWebhook && !g.testPhone).toBe(true);
  });

  test('mediaMessage forges document / image / audio messages with the fields the handlers read', () => {
    const { sim, v } = load();
    const d = guards(v, sim.mediaMessage('document', 'media.mock.7', { mime: 'audio/mp4', filename: 'class.m4a', size: 4086396 }, { from: '923000000001' }));
    expect(d.parsed.messageType).toBe('document');
    expect(d.parsed.message.document).toEqual({ id: 'media.mock.7', mime_type: 'audio/mp4', filename: 'class.m4a', file_size: 4086396 });
    const i = guards(v, sim.mediaMessage('image', 'media.mock.8', { mime: 'image/png', caption: 'page 12' }, { from: '923000000001' }));
    expect(i.parsed.message.image).toMatchObject({ id: 'media.mock.8', mime_type: 'image/png', caption: 'page 12' });
    const a = guards(v, sim.mediaMessage('audio', 'media.mock.9', { mime: 'audio/ogg; codecs=opus' }, { from: '923000000001' }));
    expect(a.parsed.message.audio).toEqual({ id: 'media.mock.9', mime_type: 'audio/ogg; codecs=opus', voice: true });
    expect(d.ours && !d.testWebhook && !d.testPhone).toBe(true);
  });

  test('flowReply forges the nfm_reply Meta sends when a Flow completes — name flow_<id>, response_json as a string', () => {
    const { sim, v } = load();
    const g = guards(v, sim.flowReply('123456', { flow_token: 'u1:settings:9', language: 'ur' }, { from: '923000000001' }));
    expect(g.parsed.messageType).toBe('interactive');
    expect(g.parsed.message.interactive.type).toBe('nfm_reply');
    expect(g.parsed.message.interactive.nfm_reply.name).toBe('flow_123456');
    expect(JSON.parse(g.parsed.message.interactive.nfm_reply.response_json)).toEqual({ flow_token: 'u1:settings:9', language: 'ur' });
    expect(g.parsed.message.interactive.nfm_reply.body).toBe('Sent');
    expect(g.ours && !g.testWebhook && !g.testPhone).toBe(true);
  });

  test('buttonReply forges an interactive button_reply', () => {
    const { sim, v } = load();
    const g = guards(v, sim.buttonReply('lang_en', 'English', { from: '923000000001' }));
    expect(g.parsed.message.interactive.type).toBe('button_reply');
    expect(g.parsed.message.interactive.button_reply).toEqual({ id: 'lang_en', title: 'English' });
    expect(g.ours && !g.testWebhook && !g.testPhone).toBe(true);
  });
});
