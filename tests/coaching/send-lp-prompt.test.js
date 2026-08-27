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

describe('bd-zrlcp · a refused list must fall back, never vanish', () => {
  // sendInteractiveMessage returns FALSE (it does not throw) when it refuses a
  // payload — over the 10-row cap, no sections, or a transport failure. Ignoring
  // that return is what stranded 20 sessions on 2026-08-27: the caller had
  // already moved the session to awaiting_lesson_plan and the teacher saw nothing.
  function refusingSvc() {
    const calls = { list: [], buttons: [] };
    return {
      calls,
      sendInteractiveMessage: async (to, listData) => { calls.list.push({ to, listData }); return false; },
      sendInteractiveButtons: async (to, options) => { calls.buttons.push({ to, options }); return true; },
    };
  }

  const fallback = {
    type: 'buttons',
    body: 'Do you have a lesson plan for this class?',
    buttons: [{ id: 'lessonplan_yes_s1', title: 'Yes' }, { id: 'lessonplan_no_s1', title: 'No' }],
  };
  const listPayload = () => ({
    type: 'list',
    listData: { body: { text: 'b' }, action: { button: 'pick', sections: [{ title: 'x', rows: [] }] } },
    fallback,
  });

  test('when the list is refused, the 2-row Yes/No prompt is sent instead', async () => {
    const w = refusingSvc();
    await expect(sendLpPrompt(w, '92300', listPayload())).resolves.toBe(true);
    expect(w.calls.list).toHaveLength(1);
    expect(w.calls.buttons).toHaveLength(1);
    expect(w.calls.buttons[0].options).toEqual(fallback);
  });

  test('when the list IS delivered, no fallback is sent', async () => {
    const calls = { list: [], buttons: [] };
    const w = {
      sendInteractiveMessage: async (to, listData) => { calls.list.push({ to, listData }); return true; },
      sendInteractiveButtons: async (to, options) => { calls.buttons.push({ to, options }); return true; },
    };
    await expect(sendLpPrompt(w, '92300', listPayload())).resolves.toBe(true);
    expect(calls.buttons).toHaveLength(0);
  });

  test('a refusal with no fallback available reports failure rather than claiming success', async () => {
    const w = refusingSvc();
    const noFallback = listPayload();
    delete noFallback.fallback;
    await expect(sendLpPrompt(w, '92300', noFallback)).resolves.toBe(false);
  });
});
