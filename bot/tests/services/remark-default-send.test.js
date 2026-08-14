/**
 * bd-2711 — the DEFAULT sendMessage dep must actually be able to send.
 *
 * Every other test for this feature injects `deps.sendMessage`, so the default
 * — the one a real principal hits — was never executed once. It was broken from
 * the first commit: the handler destructured the STATIC method off the class
 *
 *     sendMessage = require('../services/whatsapp.service').sendMessage
 *
 * which drops `this`, and `WhatsAppService.sendMessage` calls
 * `this._removeEmotionTags(message)` on its FIRST line. So every send threw
 * TypeError, sendMessage swallowed it and returned false, and the handler logged
 * "📝 /remark roster sent" regardless. Proven live on staging 2026-08-14T07:58:39Z
 * (corr-1786694309836-wwkqxs1mu): all gates passed, roster built for 3 teachers,
 * zero bytes delivered.
 *
 * These tests therefore stub the TRANSPORT (global.fetch) rather than the
 * sender, so the real default dep runs. A test that mocks sendMessage cannot
 * catch this class of bug and must not be the only coverage of the send path.
 */
const { handleRemarkCommand } = require('../../shared/handlers/remark-command.handler');
const WhatsAppService = require('../../shared/services/whatsapp.service');

const PRINCIPAL = { id: 'p-1', role: 'principal', preferred_language: 'en' };
const CYCLE = { id: 'c-1', name: 'Third Quarter 2026' };
const TEACHERS = [
  { id: 't-1', first_name: 'Ayesha' },
  { id: 't-2', first_name: 'Bilal' },
];

// Deliberately NO sendMessage — that is the whole point of this file.
const GATE_DEPS = {
  hasCapability: async () => true,
  getActiveCycle: async () => CYCLE,
  listSchoolTeachers: async () => TEACHERS,
  getProgress: async () => ({}),
};

let realFetch;
let calls;

beforeEach(() => {
  realFetch = global.fetch;
  calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return {
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.TEST' }] }),
    };
  };
});

afterEach(() => {
  global.fetch = realFetch;
});

describe('bd-2711 — the real send path, transport stubbed', () => {
  test('the mechanism: detaching the static method breaks it, method call works', async () => {
    // Documents WHY the handler must never destructure `.sendMessage`. Class
    // bodies are strict mode, so `this` is undefined in a detached static and
    // `this._removeEmotionTags(...)` throws — caught internally, returned false,
    // nothing sent. Asserted both ways so a future refactor that reintroduces
    // the destructure fails HERE with an explanation rather than in production.
    const detached = WhatsAppService.sendMessage;
    await expect(detached('92300', 'hello')).resolves.toBe(false);
    expect(calls).toHaveLength(0);

    await expect(WhatsAppService.sendMessage('92300', 'hello')).resolves.toBe(true);
    expect(calls).toHaveLength(1);
  });

  test('/remark reaches the transport — a roster is actually sent', async () => {
    const handled = await handleRemarkCommand(PRINCIPAL, '923433890650', '/remark', GATE_DEPS);

    expect(handled).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].body.to).toBe('923433890650');
    expect(calls[0].body.type).toBe('text');
    // The roster names her teachers — proof the built text, not a stub, went out.
    expect(calls[0].body.text.body).toContain('Ayesha');
    expect(calls[0].body.text.body).toContain('Bilal');
  });

  test('a refusal branch also reaches the transport', async () => {
    // no_teachers is the branch a principal with an empty school hits. It sends
    // through the same detached reference, so it was equally silent.
    await handleRemarkCommand(PRINCIPAL, '923433890650', '/remark', {
      ...GATE_DEPS,
      listSchoolTeachers: async () => [],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].body.text.body.length).toBeGreaterThan(0);
  });

  test('the denial branch also reaches the transport', async () => {
    await handleRemarkCommand(PRINCIPAL, '923433890650', '/remark', {
      ...GATE_DEPS,
      hasCapability: async () => false,
    });

    expect(calls).toHaveLength(1);
  });
});
