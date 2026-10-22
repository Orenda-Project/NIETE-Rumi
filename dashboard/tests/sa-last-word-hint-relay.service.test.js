'use strict';
/**
 * The coach's phone asks the bot for the last word read (sa_coach_last_word): the portal relays
 * POST /sa/session/:id/last-word-hint { taskId } to the bot's sa/last-word-hint with the session's user, behind the SA gates.
 */
const fs = require('fs');
const path = require('path');

test('the portal relays /sa/session/:id/last-word-hint with taskId, behind saGates', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'portal-child-test.routes.js'), 'utf8');
  expect(src).toMatch(/router\.post\('\/sa\/session\/:id\/last-word-hint', \.\.\.saGates, relay\('sa\/last-word-hint', onSession\(\['taskId'\]\)\)\);/);
});
