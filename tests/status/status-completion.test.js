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
  let handler;

  function load() {
    jest.resetModules();
    sendMessage = jest.fn().mockResolvedValue(true);
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
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

  it('an unrecognised status_action is handled without throwing and without a mystery message', async () => {
    const handled = await handler.handleStatusFlowCompletion(
      { status_action: 'something_new' }, '923000000000', USER
    );
    expect(handled).toBe(true);
    expect(sendMessage).not.toHaveBeenCalled();
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
