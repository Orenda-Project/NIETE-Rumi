/**
 * The Trail (v2) read result card when the server judged the read not a reading (sticker false on the result): no
 * "a sticker went into your Book" line. Any other result keeps its sticker line. The page runs whole in a vm
 * (wqc-page-harness.js) with wq-trail.js loaded before it; only the browser and the network are faked.
 */
const fs = require('fs');
const path = require('path');
const H = require('./wqc-page-harness');

const TRAIL_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-trail.js'), 'utf8');
const TC = { stopDone: 'Stop done!', badge: 'Done', next: 'Next', mic: 'uses the microphone' };
const V2 = { pool: true, story: false };
const MENU = (lang) => ({ lang, form: 'G3', record: true, trail: true, trail_copy: TC, v2: V2, exercises: [{ id: 'read', name: 'Read aloud', mins: 2, done: false, last: null }] });
const READ = (lang) => ({ ...H.READ, lang, record: true, trail: true, trail_copy: TC, v2: V2 });
const STICKER = { en: 'A sticker went into your Book.', ur: 'آپ کی کتاب میں ایک اسٹیکر لگ گیا۔' };

async function resultCard(lang, r) {
  const p = H.page({ lang, menu: MENU(lang), freshEls: true, pre: [TRAIL_SRC], routes: { 'ch/HUB.TOKEN/read': H.ok(READ(lang)) } });
  p.w.open('read');
  await p.flush();
  p.w.readResult(r);
  return p.html();
}

describe.each(['en', 'ur'])('%s: the read result card and its sticker line', (lang) => {
  test('sticker false (an implausible read): no sticker line', async () => {
    const h = await resultCard(lang, { score: { correct: 0, attempted: 0, stopped: false }, wcpm: null, sticker: false });
    expect(h).toContain('data-screen="read-result"');
    expect(h).not.toContain('id="wqc-sticker"');
    expect(h).not.toContain(STICKER[lang]);
  });
  test('a zero read without sticker false (the wrong passage, unheard): the sticker line, as today', async () => {
    const h = await resultCard(lang, { failed: true, reason: 'unheard' });
    expect(h).toContain(STICKER[lang]);
  });
  test('an ordinary read: the sticker line, as today', async () => {
    const h = await resultCard(lang, { score: { correct: 40, attempted: 44, stopped: false }, wcpm: 40 });
    expect(h).toContain(STICKER[lang]);
  });
});
