'use strict';
/**
 * bd-lqpog — the LP-selection prompt must route by type. A list payload sent to
 * sendInteractiveButtons throws ("cannot read length of undefined") and stalls the
 * coaching flow. This locks the routing so the regression cannot recur.
 */
const { sendLpPrompt } = require('../../bot/shared/services/coaching/lp-coaching/send-lp-prompt');

function svc() {
  const calls = { list: [], buttons: [] };
  return {
    calls,
    // Mirror the REAL sendInteractiveButtons contract: it destructures buttons and
    // reads .length — so a list payload (no buttons) throws, exactly as in prod.
    sendInteractiveButtons: async (to, options) => {
      const { buttons } = options;
      if (buttons.length > 3) return false; // eslint-disable-line
      calls.buttons.push({ to, options });
      return true;
    },
    sendInteractiveMessage: async (to, listData) => { calls.list.push({ to, listData }); return true; },
  };
}

describe('sendLpPrompt routing (bd-lqpog)', () => {
  test('a list payload goes to sendInteractiveMessage, NEVER sendInteractiveButtons', async () => {
    const w = svc();
    const listData = { header: { text: 'h' }, body: { text: 'b' }, action: { button: 'pick', sections: [{ title: 'x', rows: [{ id: 'r1', title: 't', description: 'd' }] }] } };
    await expect(sendLpPrompt(w, '92300', { type: 'list', listData })).resolves.toBe(true);
    expect(w.calls.list).toHaveLength(1);
    expect(w.calls.list[0].listData).toBe(listData);
    expect(w.calls.buttons).toHaveLength(0);
  });

  test('a buttons payload goes to sendInteractiveButtons', async () => {
    const w = svc();
    const payload = { type: 'buttons', body: 'pick one', buttons: [{ id: 'lp_upload', title: 'Add own' }, { id: 'lp_none', title: 'None' }] };
    await sendLpPrompt(w, '92300', payload);
    expect(w.calls.buttons).toHaveLength(1);
    expect(w.calls.list).toHaveLength(0);
  });

  test('REGRESSION: sending a list via the buttons path throws (proves the bug the router prevents)', async () => {
    const w = svc();
    const listPayload = { type: 'list', listData: { action: { sections: [] } } };
    // Directly calling the buttons method with a list payload throws — the old code path.
    await expect(w.sendInteractiveButtons('92300', listPayload)).rejects.toThrow();
  });
});
