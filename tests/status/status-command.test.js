/**
 * /status must answer in the chat when nothing is running (bd-60059).
 *
 * THIS IS A REGRESSION TEST FOR A REGRESSION I SHIPPED. bd-43519 added a
 * `status` branch to the flow-completion dispatch so that stopping a task got
 * acknowledged in the chat instead of falling to the generic "Thanks for your
 * response!" arm. That branch messages on `status_action === 'cancelled'` and
 * returns silently for everything else — which REMOVED the catch-all that used
 * to cover `idle`.
 *
 * So the empty-store path went from "a generic but present reply" to nothing at
 * all, and it is worse than it sounds, because buildMainScreen returns a
 * TERMINAL SUCCESS screen at INIT when the store is empty. From the teacher's
 * side: type /status, tap "Open status", the Flow flashes open and shut, and the
 * chat says nothing. Observed live on staging by the operator.
 *
 * Two independent fixes, and both are needed:
 *
 *   1. Decide BEFORE sending the CTA. If nothing is running there is no reason
 *      to offer a form whose only content is "nothing is running" — answer in
 *      the chat. `decideStatusReply` is that decision, extracted as a pure
 *      function because text-message.handler.js drags in ~40 services and is
 *      therefore asserted on statically in this repo (same shape as
 *      class-command.js and the /certificate extraction).
 *
 *   2. Message on `idle` as a backstop, for the store emptying between the CTA
 *      and the tap. (1) shrinks that window; it cannot close it.
 *
 * Ordering matters: the probe must not be able to SUPPRESS the Flow when it
 * fails. `items: null` means "could not tell", and a null must still open the
 * Flow — the Flow re-reads at INIT and shows its own error screen, so a failed
 * probe degrades to today's behaviour rather than to silence.
 */

const fs = require('fs');
const path = require('path');

const HANDLER = path.join(__dirname, '../../bot/shared/handlers/text-message.handler.js');

// Comments are stripped before ANY source assertion. Language-protocol §7,
// failure mode 1: good code names its own subject in the comment above it, so a
// naive regex passes on the prose and never sees the code. That has happened
// five times in this codebase.
//
// Trailing comments are cut at " // " rather than "//" so that a "https://" in
// a string survives. Whole-line comments and /* */ blocks go entirely.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .map(line => line.split(' // ')[0])
    .join('\n');
}

// The /status branch only, so an assertion cannot accidentally be satisfied by
// some other command's use of the same helper.
function statusBranch() {
  const src = fs.readFileSync(HANDLER, 'utf8');
  const start = src.indexOf('if (/^\\/status\\b/i.test(trimmedMessage))');
  if (start === -1) throw new Error('could not locate the /status branch — has it been renamed?');
  const rest = src.slice(start);
  const end = rest.indexOf('// ============', 1);
  return stripComments(end === -1 ? rest : rest.slice(0, end));
}

describe('decideStatusReply — decide before anything is sent (bd-60059)', () => {
  const { decideStatusReply } = require('../../bot/shared/services/status/status-command');

  const ONE = [{ id: 'cancel_coaching_1', title: 'Stop: classroom observation' }];

  it('nothing running → answer in the chat, and do NOT open the Flow', () => {
    // The whole bug. A form whose only content is "nothing is running" is worse
    // than a sentence, because it costs a tap and then vanishes.
    expect(decideStatusReply({ statusFlowId: 'flow-123', items: [] }))
      .toEqual({ mode: 'text', kind: 'empty' });
  });

  it('nothing running and no Flow published → still answers in the chat', () => {
    expect(decideStatusReply({ statusFlowId: '', items: [] }))
      .toEqual({ mode: 'text', kind: 'empty' });
  });

  it('something running → open the Flow, which is the surface that can stop it', () => {
    expect(decideStatusReply({ statusFlowId: 'flow-123', items: ONE }))
      .toEqual({ mode: 'flow' });
  });

  it('something running but no Flow published → the plain-text list', () => {
    expect(decideStatusReply({ statusFlowId: '', items: ONE }))
      .toEqual({ mode: 'text', kind: 'list' });
  });

  it('the probe FAILED → open the Flow anyway; a failed read must not cause silence', () => {
    // `null` is "could not tell", which is NOT "nothing". Treating it as empty
    // would answer "nothing is running" to a teacher who has a live session —
    // trading my silence bug for a lying bug. The Flow re-reads at INIT and has
    // its own error screen, so this degrades to exactly today's behaviour.
    expect(decideStatusReply({ statusFlowId: 'flow-123', items: null }))
      .toEqual({ mode: 'flow' });
    expect(decideStatusReply({ statusFlowId: 'flow-123' }))
      .toEqual({ mode: 'flow' });
  });

  it('the probe failed AND no Flow published → says so, rather than nothing', () => {
    expect(decideStatusReply({ statusFlowId: '', items: null }))
      .toEqual({ mode: 'text', kind: 'unknown' });
  });

  it('a non-array that is not null is still "could not tell", not empty', () => {
    // Defensive: listActiveResources returns [] on a total failure today, but a
    // future refactor returning undefined/an object must not read as "empty".
    expect(decideStatusReply({ statusFlowId: 'f', items: undefined }).mode).toBe('flow');
    expect(decideStatusReply({ statusFlowId: 'f', items: {} }).mode).toBe('flow');
  });
});

describe('the /status branch routes through the decision (bd-60059)', () => {
  it('probes what is running BEFORE it can send the Flow', () => {
    const branch = statusBranch();

    const probeAt = branch.indexOf('listActiveResources');
    const flowAt = branch.indexOf('sendFlow');

    expect(probeAt).toBeGreaterThan(-1);
    expect(flowAt).toBeGreaterThan(-1);
    // Both operands asserted present FIRST. Language-protocol §7, failure mode
    // 2: `search()` returns -1 when absent and -1 < anything, so an ordering
    // assertion on a missing token passes while testing nothing.
    expect(probeAt).toBeLessThan(flowAt);
  });

  it('uses decideStatusReply rather than re-deriving the decision inline', () => {
    expect(statusBranch()).toContain('decideStatusReply');
  });

  it('CONTROL: the ordering assertion really can fail', () => {
    // Mutation-test the guard itself. Language-protocol §7, failure mode 3: a
    // guard never proven capable of failing is not evidence. This is the
    // pre-fix shape — CTA first, probe only in the fallback arm — and the
    // ordering check must reject it.
    const preFix = stripComments([
      'if (STATUS_FLOW_ID) {',
      '  await WhatsAppService.sendFlow(from, { flowId: STATUS_FLOW_ID });',
      '} else {',
      '  const items = await TeacherStateService.listActiveResources(user.id);',
      '}',
    ].join('\n'));

    expect(preFix.indexOf('listActiveResources')).toBeGreaterThan(preFix.indexOf('sendFlow'));
  });

  it('CONTROL: stripComments removes prose that would otherwise satisfy a match', () => {
    const commentOnly = stripComments([
      '// we call decideStatusReply here',
      '/* and listActiveResources in a block comment */',
      'const x = 1; // sendFlow in a trailing comment',
    ].join('\n'));

    expect(commentOnly).not.toContain('decideStatusReply');
    expect(commentOnly).not.toContain('listActiveResources');
    expect(commentOnly).not.toContain('sendFlow');
    expect(commentOnly).toContain('const x = 1;');
  });
});
