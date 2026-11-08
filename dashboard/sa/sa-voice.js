/**
 * Jugnu's voice for the self-administered runner (switch sa_engine).
 *
 * SAE.voice.create({ lang, base, muted, onSpeak }) → { speak(textObj, audioObj) → Promise, stop(), setMuted(b) }
 * onSpeak({ speaking: true|false, text }) fires when Jugnu starts and stops talking (the game skin moves the mouth).
 *   1. a recorded clip: base + audioObj[lang], played in an <audio> element, when given. A clip that errors, is
 *      refused (a busy tunnel's 429) or has not started in load_ms is tried once more after retry_ms (1.5 s: the
 *      offline copy usually has it by then); if that fails too, the phone's own voice says the line when the phone
 *      has one of VOICES for its language (never a guess while the list is not loaded), else onSilent({ text, lang })
 *      fires (the screen shows the words and the replay) and it resolves after a short pause. A line is never left
 *      silent for longer than the retry;
 *   2. a line with no clip (a form with no clips: SAE.prepare's 'tts'): the phone's own speech (speechSynthesis),
 *      only in a voice in VOICES (South Asian, UK or US English; Urdu), never another en-* (en-SG, en-HK …);
 *   3. else a short pause, so the screen still moves on.
 * textObj: a string, { en, ur }, or { text, lang } (a line in the task's own language: spoken with that language's
 * voice); a { …, audio } on it is used when audioObj is not given. audioObj: a key string or { en, ur }.
 * speak() never throws and its promise always resolves (when the words end, on any error, or on a guard timeout).
 * A new speak() or stop() cuts the one before it and resolves its promise.
 * The page hidden mid-line (another tab, another app, the screen off; the tester, 28 Oct):
 *   - a clip refused, failing or not started while the page is hidden is held, never handed to the phone's voice;
 *   - a clip the browser pauses on its own ('pause' with no 'ended') is held;
 *   resume() (the page is visible again) plays a held line on: the same clip from where it stopped, or Jugnu's clip
 *   again. A clip still paused stall_ms after it was paused on a visible page (or after resume()) is tried once more,
 *   then the words are shown (onSilent) and the line ends: Next never waits on a clip that is not playing.
 *   onHeld({ kind: 'parked'|'paused'|'resumed'|'gave_up' }) reports each, for the session's record.
 * Round 10, audio 3 and 4 (o.unlock: battery.ui.r10_bigger_audio; o.warm: battery.ui.r10_practice_gap): an Android
 * WebView (the in-app browser) plays a NEW <audio> only inside a tap, so a clip that starts with no tap in the last few
 * seconds (a screen that moves on by itself, the answer after "The answer is:") was refused, tried again and dropped.
 *   o.unlock: Jugnu speaks through POOL_N elements of his own, each unlocked by the child's taps (a muted, silent play,
 *     paused at once); a line takes a free unlocked one (until one is unlocked, a new element, as without it). A refused
 *     clip is reported (onHeld 'refused'; 'lost' when the line is dropped).
 *   o.warm (with unlock): warm([audioObj…]) loads clips into free elements before they are needed (a practice task's
 *     answers); the line that wants one starts on it at once.
 *
 * UMD: window.SAE.voice in the browser, module.exports under Node (the test stubs Audio and speechSynthesis).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.SAE = root.SAE || {}; root.SAE.voice = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BCP47 = { ur: 'ur-PK', en: 'en-US' };
  // The phone voices Jugnu may use when a line has no clip, in order of preference ('ur' = any ur-*).
  var VOICES = { en: ['en-in', 'en-pk', 'en-gb', 'en-us'], ur: ['ur-pk', 'ur'] };
  // Round 10 (o.unlock): Jugnu's own elements, and the 10 ms of silence that unlocks one inside a tap.
  var POOL_N = 3;
  var SILENT = 'data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

  /** voiceFor(speechSynthesis, 'en'|'ur') → { ok, voice }: the first allowed voice; an unloaded list is tried as is. */
  function voiceFor(s, tl) {
    var vs = [];
    try { vs = (s.getVoices && s.getVoices()) || []; } catch (e) { vs = []; }
    if (!vs.length) return { ok: true, voice: null }; // the list is not loaded yet: try anyway
    var want = VOICES[tl] || [];
    for (var w = 0; w < want.length; w++) {
      for (var i = 0; i < vs.length; i++) {
        var l = String(vs[i].lang || '').toLowerCase().replace('_', '-');
        if (l === want[w] || (want[w].indexOf('-') < 0 && l.split('-')[0] === want[w])) return { ok: true, voice: vs[i] };
      }
    }
    return { ok: false, voice: null };
  }

  function pick(obj, lang) {
    if (typeof obj === 'string') return obj || null;
    if (obj && typeof obj === 'object' && typeof obj[lang] === 'string' && obj[lang]) return obj[lang];
    return null;
  }
  /** textObj → { text, lang } for the page language. */
  function textOf(obj, lang) {
    if (typeof obj === 'string') return obj ? { text: obj, lang: lang } : null;
    if (!obj || typeof obj !== 'object') return null;
    if (typeof obj.text === 'string' && obj.text) return { text: obj.text, lang: obj.lang === 'ur' || obj.lang === 'en' ? obj.lang : lang };
    if (obj.text && typeof obj.text === 'object') return textOf(obj.text, lang);
    var t = pick(obj, lang);
    return t ? { text: t, lang: lang } : null;
  }
  function g(name) {
    try { return typeof globalThis !== 'undefined' ? globalThis[name] : (typeof self !== 'undefined' ? self[name] : undefined); }
    catch (e) { return undefined; }
  }

  function create(o) {
    o = o || {};
    var lang = o.lang === 'ur' ? 'ur' : 'en';
    var base = typeof o.base === 'string' ? o.base : '';
    var muted = !!o.muted;
    var pauseMs = o.pause_ms != null ? o.pause_ms : 400;
    var loadMs = o.load_ms != null ? o.load_ms : 5000;
    var retryMs = o.retry_ms != null ? o.retry_ms : 1500;
    var onSpeak = typeof o.onSpeak === 'function' ? o.onSpeak : null;
    var onSilent = typeof o.onSilent === 'function' ? o.onSilent : null;
    var onHeld = typeof o.onHeld === 'function' ? o.onHeld : null;
    var stallMs = o.stall_ms != null ? o.stall_ms : 4000;
    var cur = null; // { done(), audio?, tts?, park? }
    function notify(on, text) { if (onSpeak) { try { onSpeak({ speaking: on, text: text || null }); } catch (e) { /* ignore */ } } }
    function held(kind) { if (onHeld) { try { onHeld({ kind: kind }); } catch (e) { /* ignore */ } } }
    function hidden() {
      try { var d = o.document || g('document'); return !!d && d.visibilityState === 'hidden'; } catch (e) { return false; }
    }

    // Injected for tests; the page uses the browser's own.
    function AudioCtor() { return o.Audio || g('Audio'); }
    function synth() { return o.speechSynthesis || g('speechSynthesis'); }
    function Utter() { return o.SpeechSynthesisUtterance || g('SpeechSynthesisUtterance'); }

    // Round 10 (o.unlock / o.warm): Jugnu's own elements, unlocked by a tap. { a, ok, trying, busy, warm, url, used }
    var warmOn = !!o.warm;
    var unlockOn = !!o.unlock || warmOn;
    var pool = [], useN = 0, wanted = [];
    var gestureDoc = unlockOn ? (o.document || g('document')) : null;
    var GESTURES = ['pointerup', 'touchend', 'click', 'keydown'];
    function unlockAll() {
      var A = AudioCtor();
      if (!A) return;
      while (pool.length < POOL_N) {
        var na = new A();
        try { na.preload = 'auto'; } catch (e) { /* old browser */ }
        pool.push({ a: na, ok: false, trying: false, busy: false, warm: false, url: null, used: 0 });
      }
      pool.forEach(function (p) {
        if (p.ok || p.trying || p.busy) return;
        var a = p.a;
        p.trying = true;
        var fin = function (ok) {
          p.trying = false;
          if (ok) p.ok = true;
          try { if (!p.busy) { a.pause(); if (p.url) a.currentTime = 0; } a.muted = false; } catch (e) { /* ignore */ }
          if (ok) applyWarm();
        };
        try {
          a.muted = true;
          if (!p.url) a.src = SILENT;
          var q = a.play();
          // refused (no tap behind it): stays locked for the next tap; any other end (an aborted load) has unlocked it
          if (q && typeof q.then === 'function') q.then(function () { fin(true); }, function (e) { fin(!(e && e.name === 'NotAllowedError')); });
          else fin(true);
        } catch (e) { fin(false); }
      });
      if (pool.every(function (p) { return p.ok; })) gestureOff();
    }
    function onGesture() { try { unlockAll(); } catch (e) { /* the page's tap goes on */ } }
    function gestureOff() {
      if (!gestureDoc || !gestureDoc.removeEventListener) return;
      GESTURES.forEach(function (t) { try { gestureDoc.removeEventListener(t, onGesture, true); } catch (e) { /* ignore */ } });
    }
    if (gestureDoc && gestureDoc.addEventListener) {
      GESTURES.forEach(function (t) { try { gestureDoc.addEventListener(t, onGesture, true); } catch (e) { /* ignore */ } });
    }
    /** A free unlocked element for url (one already holding it first, else the longest unused), or null. */
    function take(url) {
      var p = null, i, q;
      for (i = 0; i < pool.length; i++) { q = pool[i]; if (q.ok && !q.busy && q.url === url) { p = q; break; } }
      if (!p) for (i = 0; i < pool.length; i++) { q = pool[i]; if (q.ok && !q.busy && !q.warm && (!p || q.used < p.used)) p = q; }
      if (!p) for (i = 0; i < pool.length; i++) { q = pool[i]; if (q.ok && !q.busy && (!p || q.used < p.used)) p = q; }
      if (!p) return null;
      p.busy = true; p.warm = false; p.used = ++useN;
      try {
        if (p.url !== url) { p.a.src = url; p.url = url; } else p.a.currentTime = 0;
      } catch (e) { /* the play below decides */ }
      return p;
    }
    function free(p) { if (p) p.busy = false; }
    function applyWarm() {
      wanted.forEach(function (url) {
        if (pool.some(function (q) { return q.url === url; })) return;
        var p = null;
        pool.forEach(function (q) { if (q.ok && !q.busy && !q.warm && (!p || q.used < p.used)) p = q; });
        if (!p) return;
        p.url = url; p.warm = true;
        try { p.a.src = url; if (p.a.load) p.a.load(); } catch (e) { /* loaded when it plays */ }
      });
    }
    /** o.warm: these clips are wanted soon (at most POOL_N - 1, one element stays free for the line on now). */
    function warm(list) {
      if (!warmOn || !Array.isArray(list)) return;
      var urls = [];
      list.forEach(function (x) { var c = pick(x, lang); if (c && urls.indexOf(base + c) < 0) urls.push(base + c); });
      wanted = urls.slice(0, POOL_N - 1);
      try { applyWarm(); } catch (e) { /* loaded when it plays */ }
    }

    function stopCur() {
      var c = cur;
      cur = null;
      if (!c) return;
      try { if (c.audio) { c.audio.onended = c.audio.onerror = c.audio.onplaying = c.audio.onpause = null; c.audio.pause(); } } catch (e) { /* ignore */ }
      try { if (c.tts) { var s = synth(); if (s && s.cancel) s.cancel(); } } catch (e) { /* ignore */ }
      c.done();
    }

    function speak(textObj, audioObj) {
      try { stopCur(); } catch (e) { cur = null; }
      return new Promise(function (resolve) {
        var finished = false, timers = [], said = false;
        var said0 = null;
        try {
          said0 = textOf(textObj, lang);
          if (audioObj == null && textObj && typeof textObj === 'object' && textObj.audio) audioObj = textObj.audio;
        } catch (e) { said0 = null; }
        var text = said0 ? said0.text : null;
        var tl = said0 ? said0.lang : lang;
        function start() { if (!said && !finished) { said = true; notify(true, text); } }
        var me = {
          done: function () {
            if (finished) return;
            finished = true;
            free(me.slot); me.slot = null;
            if (said) notify(false, text);
            timers.forEach(function (t) { clearTimeout(t); });
            if (cur === me) cur = null;
            resolve();
          },
        };
        cur = me;
        function later(fn, ms) { timers.push(setTimeout(fn, ms)); }

        function pause() { later(me.done, text ? Math.min(2500, Math.max(pauseMs, text.length * 40)) : pauseMs); }

        function tts() {
          if (finished || cur !== me) return;
          try {
            var s = synth(), U = Utter();
            if (muted || !text || !s || !U || !s.speak) { pause(); return; }
            var v = voiceFor(s, tl);
            if (!v.ok) { pause(); return; }
            var u = new U(text);
            u.lang = v.voice ? String(v.voice.lang).replace('_', '-') : BCP47[tl];
            if (v.voice) u.voice = v.voice;
            u.rate = 0.9;
            u.onstart = start;
            u.onend = function () { me.done(); };
            u.onerror = function () { me.done(); };
            me.tts = true;
            if (s.cancel) s.cancel();
            s.speak(u);
            start();
            // Some engines never fire onend: resolve after a generous estimate.
            later(me.done, 3000 + text.length * 150);
          } catch (e) { pause(); }
        }

        // The clip failed twice: the phone's own voice when it has an allowed one for the language, else the words.
        function lost() {
          if (finished || cur !== me) return;
          if (unlockOn) held('lost');
          var s = null;
          try { s = synth(); } catch (e) { s = null; }
          var has = false;
          try { has = !!(text && s && Utter() && voiceFor(s, tl).voice); } catch (e) { has = false; }
          if (has) tts(); else silent();
        }
        function silent() {
          if (finished || cur !== me) return;
          if (onSilent && text) { try { onSilent({ text: text, lang: tl }); } catch (e) { /* ignore */ } }
          pause();
        }

        var clip = null;
        try {
          if (muted) { later(me.done, Math.min(pauseMs, 300)); return; }
          clip = pick(audioObj, lang);
          var A = AudioCtor();
          if (!clip) { tts(); return; }
          if (!A) { silent(); return; }
          var tries = 0;
          var play = function () {
            tries += 1;
            // o.unlock: one of Jugnu's own unlocked elements when one is free, else a new one (as without it)
            var slot = unlockOn ? take(base + clip) : null;
            var a = slot ? slot.a : new A(base + clip), playing = false, fell = false, t0 = null;
            me.audio = a;
            me.slot = slot;
            var fallback = function (err) {
              if (fell || finished || cur !== me) return;
              fell = true;
              if (t0) clearTimeout(t0);
              if (unlockOn && err && err.name === 'NotAllowedError') held('refused');
              try { a.onended = a.onerror = a.onplaying = a.onpause = null; a.pause(); } catch (e) { /* ignore */ }
              me.audio = null;
              free(me.slot); me.slot = null;
              // The page is hidden: the line waits for it, in Jugnu's own clip (resume()), never the phone's voice.
              if (hidden()) { tries -= 1; me.park = play; held('parked'); return; }
              if (tries < 2) later(function () { if (finished || cur !== me) return; try { play(); } catch (e) { lost(); } }, retryMs);
              else lost();
            };
            // Paused by the browser (the page hidden, the audio taken): held until resume(), or until stallMs on a visible page.
            var stall = function () {
              later(function () {
                if (finished || cur !== me || me.held !== a || hidden()) return;
                me.held = null;
                var gaveUp = function () {
                  if (finished || cur !== me || !a.paused) return;
                  try { a.onended = a.onerror = a.onplaying = a.onpause = null; a.pause(); } catch (e) { /* ignore */ }
                  me.audio = null;
                  held('gave_up');
                  silent();
                };
                var q;
                try { q = a.play(); } catch (e) { q = null; gaveUp(); return; }
                if (q && typeof q.then === 'function') q.then(null, gaveUp);
                later(gaveUp, loadMs);
              }, stallMs);
            };
            a.onpause = function () {
              if (fell || finished || cur !== me || a.ended || !playing) return;
              me.held = a;
              held('paused');
              if (!hidden()) stall();
            };
            me.unhold = function () {
              if (me.held !== a) return;
              held('resumed');
              var q;
              try { q = a.play(); } catch (e) { q = null; }
              if (q && typeof q.then === 'function') q.then(function () { if (me.held === a) me.held = null; }, function () { /* the stall below decides */ });
              stall();
            };
            a.onplaying = function () { playing = true; start(); };
            a.onended = function () { me.done(); };
            a.onerror = function () { fallback(); };
            t0 = setTimeout(function () { if (!playing) fallback(); }, loadMs); // never loaded
            timers.push(t0);
            var p = a.play();
            if (p && typeof p.then === 'function') p.then(function () { playing = true; start(); }, fallback);
          };
          later(me.done, 60000); // never ended
          play();
        } catch (e) {
          if (clip) silent(); else tts();
        }
      });
    }

    /** The page is visible again: a held line plays on (the paused clip, or Jugnu's clip again). Never throws. */
    function resume() {
      var c = cur;
      if (!c || hidden()) return;
      try {
        if (c.park) { var f = c.park; c.park = null; held('resumed'); f(); }
        else if (c.held && c.unhold) c.unhold();
      } catch (e) { /* the line's own guards end it */ }
    }

    return {
      speak: speak,
      resume: resume,
      warm: warm,
      stop: function () { try { stopCur(); } catch (e) { cur = null; } },
      setMuted: function (b) { muted = !!b; if (muted) { try { stopCur(); } catch (e) { cur = null; } } },
      get muted() { return muted; },
      lang: lang,
    };
  }

  return { create: create, pick: pick, textOf: textOf, voiceFor: voiceFor, VOICES: VOICES };
}));
