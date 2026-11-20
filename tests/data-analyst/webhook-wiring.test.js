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
