'use strict';
/**
 * The webhook hands the quiz the wamid of the tap it is answering.
 *
 * The free ✅/❌ on a child's answer (NQ1) and the free 👍 on a teacher's "Not
 * now" (NO2) land on the user's OWN message, so the handler needs its id. The
 * services are driven end to end in child-quiz-fewer-bubbles.test.js and
 * teacher-quiz-handoff-fewer-bubbles.test.js, and the typed-letter door through
 * the real text handler (video-quiz-typed-letter.test.js). The webhook branches
 * cannot be driven here — booting whatsapp-bot.js starts workers and Redis — so
 * every call site is pinned at the source, comments stripped so a match cannot
 * land on prose. Without the id, both services fall back to today's text, so a
 * missing argument costs money, never a message.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../../bot/whatsapp-bot.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

test('`message` is the webhook handler\'s own binding (what every call below reads)', () => {
  expect(SRC).toMatch(/const \{[^}]*\bmessage\b[^}]*\} = validation;/);
});

test('every video-quiz answer door — button, list row, picture Flow — passes the tap\'s message id', () => {
  const calls = [...SRC.matchAll(/VideoQuizService\.handleAnswer\(([^)]*\))?[^;]*/g)].map((m) => m[0]);
  expect(calls).toHaveLength(3);
  calls.forEach((c) => expect(c).toContain('{ messageId: message.id }'));
});

test('the transcript-quiz offer buttons pass the tap\'s message id', () => {
  expect(SRC).toMatch(/TranscriptQuizOffer\.handleOfferButton\(buttonId, from, \{ messageId: message\.id \}\)/);
});
