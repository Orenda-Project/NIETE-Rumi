#!/usr/bin/env node
/* test_launch_options.js — the web lane's browser stays silent unless someone is watching (bd-l1xxi1).
 *
 * Run: node .claude/qa/web/test_launch_options.js
 *
 * The child quiz page reads its questions aloud (speechSynthesis). A hidden-browser run played that voice through
 * the operator's speakers with no tab to show where it came from. Muting the browser keeps the speech checks
 * working: they read speechSynthesis.speaking and audio.paused, not real sound.
 *
 * Red-first: fails before launch-options.cjs exists.
 */
const assert = require('assert');
const path = require('path');
const { launchOptions } = require(path.join(__dirname, 'launch-options.cjs'));

let failed = 0;
const t = (name, fn) => { try { fn(); console.log('  ok    ' + name); } catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + e.message); } };

t('hidden run: muted, headless', () => {
  const o = launchOptions({});
  assert.strictEqual(o.headless, true);
  assert.ok(o.args.includes('--mute-audio'), 'args: ' + JSON.stringify(o.args));
});
t('headed run: sound on, a person is watching', () => {
  const o = launchOptions({ WEB_HEADED: '1' });
  assert.strictEqual(o.headless, false);
  assert.ok(!o.args.includes('--mute-audio'));
});
t('WEB_AUDIO=1 opts a hidden run back into sound', () => {
  assert.ok(!launchOptions({ WEB_AUDIO: '1' }).args.includes('--mute-audio'));
});
t('slowMo still read from WEB_SLOWMO', () => {
  assert.strictEqual(launchOptions({}).slowMo, 0);
  assert.strictEqual(launchOptions({ WEB_SLOWMO: '250' }).slowMo, 250);
});

// --mute-audio does not reach the Mac's system voice, which speechSynthesis uses: every utterance goes out at volume 0
// in a hidden run, still spoken (speaking/onend unchanged) so the audio checks see the same page.
const { silenceSpeech } = require(path.join(__dirname, 'launch-options.cjs'));
t('hidden run: speech silenced by volume 0, still spoken', () => {
  const spoken = [];
  const win = { speechSynthesis: { speak(u) { spoken.push(u); } } };
  silenceSpeech({}).call(null, win);
  const u = { text: 'Which is bigger?', volume: 1 };
  win.speechSynthesis.speak(u);
  assert.strictEqual(spoken.length, 1, 'utterance still reaches the real speak()');
  assert.strictEqual(spoken[0].volume, 0);
});
t('headed or WEB_AUDIO run: no silencer', () => {
  assert.strictEqual(silenceSpeech({ WEB_HEADED: '1' }), null);
  assert.strictEqual(silenceSpeech({ WEB_AUDIO: '1' }), null);
});
t('silencer is safe on a page without speechSynthesis', () => {
  silenceSpeech({}).call(null, {});
});

if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('launch options: all passed');
