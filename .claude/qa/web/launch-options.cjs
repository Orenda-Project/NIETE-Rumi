// launch-options — how the web lane starts its browser (bd-l1xxi1).
// A hidden run is muted: the child quiz reads its questions aloud, and with no visible tab the voice came out of the
// operator's speakers from nowhere they could find. A headed run (WEB_HEADED=1) or WEB_AUDIO=1 keeps the sound.
// Speech checks still work muted: they read speechSynthesis.speaking / audio.paused, not real sound.
'use strict';

function launchOptions(env) {
  const headed = env.WEB_HEADED === '1';
  const sound = headed || env.WEB_AUDIO === '1';
  return { headless: !headed, slowMo: Number(env.WEB_SLOWMO || 0), args: sound ? [] : ['--mute-audio'] };
}

// --mute-audio silences the browser's own audio, but speechSynthesis speaks through the Mac's system voice, outside it.
// So a hidden run also gets this page init script: every utterance still goes to the real speak() (speaking, onend and
// the page's own state are unchanged) but at volume 0. Returns null when sound is wanted.
function silenceSpeech(env) {
  if (env.WEB_HEADED === '1' || env.WEB_AUDIO === '1') return null;
  return function (w) {
    w = w || window;
    const s = w.speechSynthesis;
    if (!s || typeof s.speak !== 'function') return;
    const speak = s.speak.bind(s);
    s.speak = function (u) { try { u.volume = 0; } catch (_) { /* read-only: speak as is */ } return speak(u); };
  };
}

module.exports = { launchOptions, silenceSpeech };
