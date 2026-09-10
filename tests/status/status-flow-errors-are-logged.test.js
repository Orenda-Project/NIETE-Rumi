/**
 * A /status Flow refusal must be visible to the error monitor.
 *
 * WHY THIS FILE EXISTS. On 2026-09-09 the published status Flow on the sandbox
 * WABA had an EMPTY MAIN footer payload, so the teacher's Continue/Stop choice
 * never reached the endpoint. The endpoint did the right thing — it saw no
 * action and refused — but it refused at level `info`, and Meta renders every
 * refusal as its own generic "Something went wrong. Try again later."
 *
 * Net effect: the teacher learned nothing, and neither did we. Axiom showed
 * `📋 Status Flow data_exchange` at info and nothing else. The bug was found
 * only because a human happened to be watching the screen, and it had already
 * been hit by a second, unrelated user 30 seconds earlier.
 *
 * This is pre-merge Class N — terminal failures logged at info are invisible to
 * the error monitor — applied to a Flow endpoint rather than a catch block.
 *
 * The teacher-facing string is deliberately NOT asserted here: Meta overrides it
 * with its own copy, so the message is for us, not her. What matters is the
 * LEVEL and the context needed to debug it.
 */

const LOGGER = '../../bot/shared/utils/logger';
const ENDPOINT = '../../bot/shared/routes/status-flow-endpoint';
const TEACHER_STATE = '../../bot/shared/services/teacher-state.service';

function load({ items = [], cancelResult, parsed } = {}) {
  jest.resetModules();
  const logToFile = jest.fn();
  jest.doMock(LOGGER, () => ({ logToFile }));
  jest.doMock(TEACHER_STATE, () => ({
    listActiveResources: jest.fn().mockResolvedValue(items),
    cancelResource: jest.fn().mockResolvedValue(cancelResult || { ok: true, message: 'stopped' }),
    parseResourceId: jest.fn(() => parsed || { kind: 'unknown' }),
  }));
  return { endpoint: require(ENDPOINT), logToFile };
}

// A refusal is logged iff some logToFile call passed 'error' as its third arg.
function errorCalls(logToFile) {
  return logToFile.mock.calls.filter((c) => c[2] === 'error');
}

describe('every /status Flow refusal is logged at error', () => {
  it('MAIN with no action selected — the exact shape of the sandbox outage', async () => {
    const { endpoint, logToFile } = load();

    const res = await endpoint.handleStatusFlowDataExchange('u-1', 'MAIN', {});

    // Still refuses, as before.
    expect(res.data.error).toBeTruthy();
    // ...but now it is visible.
    const errs = errorCalls(logToFile);
    expect(errs.length).toBeGreaterThan(0);
    // and carries enough to debug it without a human at the screen
    const payload = JSON.stringify(errs[0][1] || {});
    expect(payload).toContain('MAIN');
    expect(payload).toContain('u-1');
  });

  it('MAIN with an unrecognised action', async () => {
    const { endpoint, logToFile } = load({ parsed: { kind: 'unknown' } });
    const res = await endpoint.handleStatusFlowDataExchange('u-2', 'MAIN', { _action: 'nonsense' });
    expect(res.data.error).toBeTruthy();
    expect(errorCalls(logToFile).length).toBeGreaterThan(0);
  });

  it('CONFIRM_CANCEL with no resource id', async () => {
    const { endpoint, logToFile } = load();
    const res = await endpoint.handleStatusFlowDataExchange('u-3', 'CONFIRM_CANCEL', {});
    expect(res.data.error).toBeTruthy();
    expect(errorCalls(logToFile).length).toBeGreaterThan(0);
  });

  it('a cancel that fails outright', async () => {
    const { endpoint, logToFile } = load({
      items: [{ id: 'cancel_quiz_1', title: 'Quiz', kind: 'quiz' }],
      parsed: { kind: 'quiz' },
      cancelResult: { ok: false, reason: 'db down' },
    });
    const res = await endpoint.handleStatusFlowDataExchange('u-4', 'CONFIRM_CANCEL', { resource_id: 'cancel_quiz_1' });
    expect(res.data.error).toBeTruthy();
    expect(errorCalls(logToFile).length).toBeGreaterThan(0);
  });

  it('an unknown screen', async () => {
    const { endpoint, logToFile } = load();
    const res = await endpoint.handleStatusFlowDataExchange('u-5', 'NOPE', {});
    expect(res.data.error).toBeTruthy();
    expect(errorCalls(logToFile).length).toBeGreaterThan(0);
  });

  it('CONTROL: a SUCCESSFUL exchange logs NO error — else the assertion is vacuous', async () => {
    // Without this, a module that logged 'error' unconditionally would pass every
    // test above while telling the monitor nothing.
    const { endpoint, logToFile } = load({ items: [] });

    const res = await endpoint.handleStatusFlowDataExchange('u-6', 'MAIN', { _action: 'done' });

    expect(res.screen).toBe('SUCCESS');
    expect(res.data.error).toBeUndefined();
    expect(errorCalls(logToFile)).toEqual([]);
  });
});
