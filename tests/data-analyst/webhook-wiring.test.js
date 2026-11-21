'use strict';
/**
 * The webhook asks the data-analyst door before the ordinary text handler, after the user lookup and
 * the child check, and only for text. Read from source: the webhook module boots the whole bot.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../../bot/whatsapp-bot.js'), 'utf8');

test('the door runs right before the text dispatch, for text only, and returns when it took the message', () => {
  const dispatch = SRC.indexOf("if (messageType === 'text' && messageBody) {\n      await handleTextMessage(message, from, messageBody, user);");
  expect(dispatch).toBeGreaterThan(0);
  const door = SRC.lastIndexOf('maybeHandleDataAnalyst', dispatch);
  expect(door).toBeGreaterThan(0);
  const guard = SRC.lastIndexOf("if (user && messageType === 'text' && messageBody) {", door);
  expect(guard).toBeGreaterThan(0);
  expect(door - guard).toBeLessThan(200);
  expect(SRC.slice(door, dispatch)).toMatch(/\)\) return;/);
  // After the user lookup and the child router: a child's handset never reaches it.
  expect(SRC.indexOf('StudentIngress.route(')).toBeLessThan(door);
  expect(SRC.indexOf('user = await getOrCreateUser(from)')).toBeLessThan(door);
});

test('a failure inside the door can never stop the ordinary handler', () => {
  const door = SRC.indexOf('maybeHandleDataAnalyst');
  const block = SRC.slice(door - 400, door + 400);
  expect(block).toMatch(/catch \(/);
});

describe('round 2 wiring: buttons, list picks and the question Flow reach the data analyst first', () => {
  const branch = (marker) => {
    const at = SRC.indexOf(marker);
    expect(at).toBeGreaterThan(0);
    return SRC.slice(at, at + 3000);
  };
  test('a button tap: data-analyst ids are offered to it, and a hand-back runs the ordinary text handler', () => {
    const b = branch("message.interactive?.type === 'button_reply'");
    expect(b).toMatch(/buttonId\.startsWith\('da_'\)/);
    expect(b).toMatch(/handleDataAnalystButton/);
    expect(b).toMatch(/handleTextMessage\(message, from, [a-zA-Z.]*normalText, user\)/);
  });
  test('a list pick: the same', () => {
    const b = branch("message.interactive?.type === 'list_reply'");
    expect(b).toMatch(/handleDataAnalystButton/);
  });
  test('a Flow reply on a dataq: token is claimed before any other Flow routing', () => {
    const b = branch("message.interactive?.type === 'nfm_reply'");
    const claim = b.indexOf("startsWith('dataq:')");
    expect(claim).toBeGreaterThan(0);
    expect(b.indexOf('handleDataAnalystFlowReply')).toBeGreaterThan(claim);
    expect(claim).toBeLessThan(b.indexOf("startsWith('vqjoin:')"));
  });
});

test('every door call hands over the message id, so the door can react instead of texting (21 Nov)', () => {
  const calls = SRC.match(/data-analyst\/entry'\)\.(maybeHandleDataAnalyst|handleDataAnalystButton|handleDataAnalystFlowReply)\(\{[^}]*\}/g) || [];
  expect(calls).toHaveLength(4);
  for (const c of calls) expect(c).toMatch(/messageId: message\.id/);
});
