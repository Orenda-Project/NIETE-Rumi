/**
 * The /status Flow's completion has to land somewhere (bd-43519).
 *
 * status-flow-endpoint.js has emitted `status_action` in
 * extension_message_response.params since it shipped, and docs/flows/status-flow.json
 * declares it. Its own comment says the params exist "so the chat-side nfm_reply
 * branch can dispatch a contextual ack instead of the generic" one.
 *
 * That branch was never written. detectFlowType had no rule for `status_action`,
 * so a /status completion fell through whatsapp-bot.js's chain to the `else`
 * "Unknown flow type" arm: it logged `⚠️ Received unknown flow submission` and
 * replied "Thanks for your response! Type /menu to see what I can help you with."
 *
 * Observed live: stopping a coaching session worked (the state really was cleared)
 * but the chat — the teacher's only persistent record — said nothing about it.
 *
 * This is pre-merge-checklist Class A, orphan dispatch, and the THIRD instance of
 * the same pattern in this file's neighbourhood: the `remark` branch (bd-2712) and
 * the `observe_visit` branch (bd-2432) both carry comments saying that without them
 * the completion lands on the generic /menu fallback.
 */

describe('detectFlowType: a /status completion is recognised (bd-43519)', () => {
  const { detectFlowType } = require('../../bot/shared/utils/flow-type-detector');

  it('status_action → "status", and is NOT eaten by the loose attendance fallback', () => {
    // The fallback matches any flow_token containing a colon. The status flow's
    // token is a bare user id today, but every other flow that got swallowed by
    // this fallback (exam-generator, observe, training-msq) was swallowed exactly
    // when its token format changed — so pin it now.
    expect(detectFlowType({ status_action: 'cancelled' })).toBe('status');
    expect(detectFlowType({ status_action: 'cancelled', flow_token: 'a:b' })).toBe('status');
    expect(detectFlowType({ status_action: 'done', resource_kind: 'flow_cancel' })).toBe('status');
  });

  it('existing detections unchanged', () => {
    expect(detectFlowType({ flow_token: 'a:b' })).toBe('attendance_marking');
    expect(detectFlowType({ remark_action: 'x', flow_token: 'a:b' })).toBe('remark');
    expect(detectFlowType({ observe_action: 'x', flow_token: 'a:b' })).toBe('observe');
    expect(detectFlowType({})).toBe('unknown');
  });
});

describe('the completion ack (bd-43519)', () => {
  let sendMessage;
  let logToFile;
  let handler;

  function load() {
    jest.resetModules();
    sendMessage = jest.fn().mockResolvedValue(true);
    logToFile = jest.fn();
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      sendMessage,
      sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    }));
    handler = require('../../bot/shared/handlers/flow-response.handler');
  }

  const USER = { id: 'u-1', preferred_language: 'en' };

  beforeEach(load);

  it('a STOP is acknowledged in the chat, not just on the Flow screen', async () => {
    // The Flow's SUCCESS screen vanishes when the Flow closes. The chat is what
    // the teacher still has tomorrow, so the state-changing action is the one that
    // must leave a line in it.
    const handled = await handler.handleStatusFlowCompletion(
      { status_action: 'cancelled', resource_kind: 'flow_cancel', resource_label: 'Stop: classroom observation' },
      '923000000000',
      USER
    );

    expect(handled).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const body = sendMessage.mock.calls[0][1];
    expect(typeof body).toBe('string');
    expect(body.length).toBeGreaterThan(0);
    // Whatever the copy, it must not be the catch-all that caused this bug.
    expect(body).not.toMatch(/Thanks for your response/i);
  });

  it('a RESUME sends no second message — the Flow screen already said it', async () => {
    // Deliberate, and the same call the `remark` branch makes: "ONE message, not
    // two." The resume path leaves state intact and the Flow screen tells her to
    // reply, so a chat duplicate would say the same thing twice.
    const handled = await handler.handleStatusFlowCompletion(
      { status_action: 'resumed', resource_kind: 'flow_resume', resource_label: 'Continue: classroom observation' },
      '923000000000',
      USER
    );

    expect(handled).toBe(true);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('closing with "Done" is silent', async () => {
    const handled = await handler.handleStatusFlowCompletion(
      { status_action: 'done' }, '923000000000', USER
    );
    expect(handled).toBe(true);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('an EMPTY store is answered in the chat, not left silent (bd-60059)', async () => {
    // The regression this branch caused. `idle` is what buildMainScreen emits
    // when listActiveResources came back empty, and it is a TERMINAL screen
    // returned at INIT — so the Flow flashes open and shut and this is the only
    // thing the teacher is left with. Before the status branch existed, the
    // generic arm at least said something; adding a specific handler that
    // covered only `cancelled` made it worse than the catch-all it replaced.
    //
    // The /status command now answers in the chat without opening the Flow at
    // all when the store is empty (see status-command.test.js), which shrinks
    // this window to "the store emptied between the CTA and the tap". It does
    // not close it, so this arm still has to speak.
    const handled = await handler.handleStatusFlowCompletion(
      { status_action: 'idle' }, '923000000000', USER
    );

    expect(handled).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const body = sendMessage.mock.calls[0][1];
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toMatch(/Thanks for your response/i);
  });

  it('the empty-store answer is in her language too (bd-60059)', async () => {
    await handler.handleStatusFlowCompletion(
      { status_action: 'idle' }, '923000000000', { id: 'u', preferred_language: 'ur' });
    const urBody = sendMessage.mock.calls[0][1];
    expect(urBody).toMatch(/[\u0600-\u06ff]/);
  });

  it('an unrecognised status_action is handled without throwing and without a mystery message', async () => {
    const handled = await handler.handleStatusFlowCompletion(
      { status_action: 'something_new' }, '923000000000', USER
    );
    expect(handled).toBe(true);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('an inherited Object member is not mistaken for an ack key', async () => {
    // `status_action` arrives from Meta's payload. The ack table is keyed by it,
    // so on a plain object 'constructor' / 'toString' would resolve up the
    // prototype chain to a truthy function and get handed to resolveUx. That
    // degrades to a swallowed warning rather than a wrong message, but it is
    // still a lookup finding something that was never a key.
    for (const action of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      const handled = await handler.handleStatusFlowCompletion(
        { status_action: action }, '923000000000', USER
      );
      expect(handled).toBe(true);
    }

    expect(sendMessage).not.toHaveBeenCalled();

    // The assertion that actually discriminates. Asserting only "no message
    // sent" is VACUOUS here: on a plain object the lookup DOES find Object's
    // inherited member, hands it to resolveUx, and resolveUx throws — which the
    // catch swallows, so no message is sent either way and the test passes
    // against the bug it exists to catch. The observable difference is that the
    // un-hardened version reaches the catch and logs. Mutation-verified: swap
    // Object.create(null) for a plain object and this line goes red.
    const acked = logToFile.mock.calls.filter(c => String(c[0]).includes('status ack failed'));
    expect(acked).toEqual([]);
  });

  it('respects the teacher\'s language', async () => {
    const en = await handler.handleStatusFlowCompletion(
      { status_action: 'cancelled' }, '923000000000', { id: 'u', preferred_language: 'en' });
    const enBody = sendMessage.mock.calls[0][1];

    load();
    await handler.handleStatusFlowCompletion(
      { status_action: 'cancelled' }, '923000000000', { id: 'u', preferred_language: 'ur' });
    const urBody = sendMessage.mock.calls[0][1];

    expect(en).toBe(true);
    expect(urBody).not.toBe(enBody);
    expect(urBody).toMatch(/[؀-ۿ]/); // actually Urdu, not English with a flag set
  });
});
