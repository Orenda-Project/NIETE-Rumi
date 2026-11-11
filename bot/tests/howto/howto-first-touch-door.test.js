'use strict';
/**
 * bd-ik5e8j.5 — the first-touch film's ONE door: whatsapp-bot.js calls it after the user lookup and the child-handset
 * check (StudentIngress.route) and before the message is routed by type, so every message a person sends (text, voice,
 * image, document, a button) passes it, and status callbacks and the request_welcome event never do.
 * And its caption: in the catalog, both languages, under WhatsApp's 1024-code-point caption cap, never "app".
 */
const fs = require('fs');
const path = require('path');

/** The source with comments removed, so a match can never land on a comment that names the call. */
function code(file) {
  return fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
}

describe('howto first touch — the door', () => {
  const src = code(path.join(__dirname, '../../whatsapp-bot.js'));

  test('called once, after the child check and before routing by type', () => {
    const call = src.indexOf('maybeSendHowtoFirstTouch(');
    const child = src.indexOf('StudentIngress.route(');
    const route = src.indexOf('handleTextMessage(message, from, messageBody, user)');
    expect(call).toBeGreaterThan(-1);
    expect(child).toBeGreaterThan(-1);
    expect(route).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(child);
    expect(call).toBeLessThan(route);
    expect(src.split('maybeSendHowtoFirstTouch(').length - 1).toBe(1);
  });
});

describe('howto first touch — the caption', () => {
  const { resolveUx } = require('../../shared/config/ux-strings');
  test.each(['en', 'ur'])('%s: present, under the cap, no "app"', (language) => {
    const s = resolveUx('howtoFirstTouchCaption', { language });
    expect(typeof s).toBe('string');
    expect(s.length).toBeGreaterThan(5);
    expect([...s].length).toBeLessThanOrEqual(1024);
    expect(s).not.toMatch(/\bapps?\b/i);
    expect(s.replace(/واٹس ایپ/g, '')).not.toMatch(/ایپ/);
  });
  test('the two languages differ (no silent English in Urdu)', () => {
    expect(resolveUx('howtoFirstTouchCaption', { language: 'ur' })).not.toBe(resolveUx('howtoFirstTouchCaption', { language: 'en' }));
  });
});
