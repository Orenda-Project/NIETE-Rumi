'use strict';
/**
 * bd-fbih0 — reactions must be silent; video gets an explanatory reply; the
 * historical fallback survives byte-for-byte for genuinely unknown types.
 * (Live 2026-08-21: 38 "text and voice only" replies fired on reactions and
 * videos in one morning — one of them mid-/observe photo capture.)
 */

const fs = require('fs');
const path = require('path');
const { unsupportedTypeReply, DEFAULT_REPLY, VIDEO_REPLY } = require('../../shared/utils/unsupported-message');

describe('bd-fbih0 — unsupported-type replies', () => {
  test('reaction / sticker → SILENT (never answer a reaction with an error)', () => {
    expect(unsupportedTypeReply('reaction')).toBeNull();
    expect(unsupportedTypeReply('sticker')).toBeNull();
  });

  test('video → explanatory reply naming the supported inputs, bilingual', () => {
    const r = unsupportedTypeReply('video');
    expect(r).toBe(VIDEO_REPLY);
    expect(r).toMatch(/تصاویر/);       // names photos in Urdu
    expect(r).toMatch(/photos/);       // and in English
  });

  test('unknown types keep the historical fallback byte-for-byte', () => {
    expect(unsupportedTypeReply('contacts')).toBe(DEFAULT_REPLY);
    expect(DEFAULT_REPLY).toBe('میں صرف متن اور آواز پیغامات کا جواب دے سکتا ہوں۔');
  });

  test('whatsapp-bot routes the fallback through the helper (no inline hardcode left)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../whatsapp-bot.js'), 'utf8')
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    expect(src).toMatch(/unsupportedTypeReply\(messageType\)/);
    expect(src).not.toMatch(/صرف متن اور آواز پیغامات کا جواب/); // string lives only in the helper
  });
});
