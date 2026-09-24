'use strict';
/**
 * The inbound-message log line names a voice note by the field the WhatsApp
 * Cloud API actually sets.
 *
 * A voice note arrives as `message.audio` with `audio.voice === true`; there is
 * no `message.voice`. The webhook logged `hasVoice: !!message.voice`, which is
 * therefore false on every message ever received — and a telemetry read of that
 * field once concluded that teachers send no voice notes when two in three of
 * their recordings are exactly that.
 *
 * A source assertion (comments stripped, so a comment naming the old field
 * cannot satisfy or trip it): the entry file is an Express app that no unit
 * test loads, and the line is a log field, not a branch.
 */
const fs = require('fs');
const path = require('path');

const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const BOT = stripComments(fs.readFileSync(path.join(__dirname, '../../bot/whatsapp-bot.js'), 'utf8'));
const receivedLog = BOT.slice(BOT.indexOf('Message received from'), BOT.indexOf('Message received from') + 600);

describe('the inbound-message log line', () => {
  test('is present (so the assertions below are not vacuous)', () => {
    expect(BOT.indexOf('Message received from')).toBeGreaterThan(-1);
    expect(receivedLog).toMatch(/hasAudio: !!message\.audio/);
  });

  test('logs a voice note from audio.voice, the field the Cloud API sets', () => {
    expect(receivedLog).toMatch(/isVoiceNote: !!message\.audio\?\.voice/);
  });

  test('no longer logs message.voice, a field the Cloud API never sends', () => {
    expect(receivedLog).not.toMatch(/message\.voice\b/);
    expect(receivedLog).not.toMatch(/hasVoice/);
  });
});
