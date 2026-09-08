/**
 * A status_action cannot reach the chat undecided.
 *
 * THE SIBLING OF every-flow-is-decided.test.js, and it exists because of the same
 * mistake one layer up. That guard makes a new FLOW declare whether it is offerable.
 * This one makes a new STATUS ACTION declare whether it gets a line in the chat.
 *
 * The bug it generalises: a `status` branch was added to the flow-completion
 * dispatch so that stopping a task got acknowledged in the chat. The branch spoke
 * for `cancelled` and returned silently for everything else — and in doing so it
 * REPLACED a catch-all that had at least said something. `idle` was then silent, on
 * the one path whose Flow screen the teacher never really sees, because the endpoint
 * returns a TERMINAL success screen at INIT when there is nothing to list. Net
 * effect: type /status with a clear store, tap, watch the Flow flash open and shut,
 * read nothing.
 *
 * A specific handler replacing a catch-all is a bug class in its own right: the
 * catch-all was covering cases nobody had enumerated, so narrowing it silently drops
 * them. The fix is not "remember to enumerate" — it is to make the enumeration fail
 * the build when it is incomplete.
 *
 * `noop` is why this file is not merely tidy. It is emitted by the endpoint, it was
 * in neither the ack table nor any test, and its silence was therefore an accident
 * that happened to be right rather than a decision anyone made.
 *
 * Static, deliberately, and for the same reason as the flow guard: the alternative is
 * booting the endpoint to ask it what it can emit.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const ENDPOINT = path.join(ROOT, 'bot/shared/routes/status-flow-endpoint.js');
const HANDLER = path.join(ROOT, 'bot/shared/handlers/flow-response.handler.js');

// Comments stripped before any source assertion. Good code names its own subject in
// the comment above it, so a naive regex matches the prose and never sees the code.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .map((l) => l.split(' // ')[0])
    .join('\n');
}

// What the Flow endpoint can hand back to the chat.
function emittedActions() {
  const src = stripComments(fs.readFileSync(ENDPOINT, 'utf8'));
  const found = new Set();
  for (const m of src.matchAll(/statusAction:\s*'([a-z_]+)'/g)) found.add(m[1]);
  return found;
}

// What the chat-side handler answers. Scoped to the ACK table so another handler's
// table cannot satisfy this by accident.
function ackedActions() {
  const src = stripComments(fs.readFileSync(HANDLER, 'utf8'));
  const start = src.indexOf('const ACK =');
  if (start === -1) throw new Error('could not find the status ACK table — has it been renamed?');
  const table = src.slice(start, src.indexOf('}', start));
  const found = new Set();
  for (const m of table.matchAll(/^\s*([a-z_]+):\s*'/gm)) found.add(m[1]);
  return found;
}

/**
 * Deliberately silent, each with the reason it is silent. The rule these follow:
 * A CHAT LINE IS FOR AN ACTION THAT CHANGED SOMETHING, or for one whose screen she
 * cannot actually read. Everything else would say the same thing twice.
 */
const SILENT = {
  done: 'She closed the list without acting on it. Nothing changed, and the screen she just '
    + 'tapped through said so; a chat line would repeat a no-op back at her.',
  resumed: 'The state is left exactly as it was and the Flow screen tells her to reply here to '
    + 'carry on. This is the remark branch\'s rule: ONE message, not two.',
  noop: 'She tapped Stop on something that had already ended, so there was nothing to stop and '
    + 'nothing changed. Unlike `idle`, this screen follows a real data_exchange rather than '
    + 'being returned at INIT, so she does see it before the Flow closes.',
};

describe('every status_action the Flow can emit is decided', () => {
  it('finds the actions at all — a derivation that matches nothing proves nothing', () => {
    const emitted = emittedActions();
    // Guards the vacuous pass: if buildSuccessScreen is refactored and the regex stops
    // matching, an empty set would satisfy every assertion below.
    expect(emitted.size).toBeGreaterThanOrEqual(5);
    expect([...emitted]).toContain('idle');
    expect([...emitted]).toContain('cancelled');

    expect(ackedActions().size).toBeGreaterThanOrEqual(2);
  });

  it('is either acknowledged in the chat, or silent WITH a stated reason', () => {
    const acked = ackedActions();
    const undecided = [...emittedActions()].filter((a) => !acked.has(a) && !SILENT[a]).sort();

    // If this fails you have added a status_action and not said what the teacher reads
    // when it fires. Add it to the ACK table, or to SILENT with the reason it says
    // nothing. "Nobody thought about it" is what shipped the bug this file is named for.
    expect(undecided).toEqual([]);
  });

  it('a SILENT reason is a sentence, not a shrug', () => {
    for (const [action, reason] of Object.entries(SILENT)) {
      expect(typeof reason).toBe('string');
      expect(reason.trim().length).toBeGreaterThan(40);
      expect(action).toMatch(/^[a-z_]+$/);
    }
  });

  it('no action is both acknowledged and silent', () => {
    const acked = ackedActions();
    expect(Object.keys(SILENT).filter((a) => acked.has(a))).toEqual([]);
  });

  it('SILENT does not list an action the endpoint cannot emit', () => {
    // Otherwise the list rots into a graveyard of names, and a real gap hides among them.
    const emitted = emittedActions();
    expect(Object.keys(SILENT).filter((a) => !emitted.has(a))).toEqual([]);
  });
});

describe('the silent ones really are silent', () => {
  let sendMessage;
  let handler;

  beforeEach(() => {
    jest.resetModules();
    sendMessage = jest.fn().mockResolvedValue(true);
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      sendMessage,
      sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    }));
    handler = require('../../bot/shared/handlers/flow-response.handler');
  });

  it.each(Object.keys(SILENT))('%s sends no chat message', async (action) => {
    const handled = await handler.handleStatusFlowCompletion(
      { status_action: action }, '923000000000', { id: 'u-1', preferred_language: 'en' }
    );
    expect(handled).toBe(true);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
