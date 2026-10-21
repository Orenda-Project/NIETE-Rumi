/**
 * Jugnu's voice for the self-administered runner (switch sa_engine).
 *
 * SAE.voice.create({ lang, base, muted, onSpeak }) → { speak(textObj, audioObj) → Promise, stop(), setMuted(b) }
 * onSpeak({ speaking: true|false, text }) fires when Jugnu starts and stops talking (the game skin moves the mouth).
 *   1. a recorded clip: base + audioObj[lang], played in an <audio> element, when given. A clip that errors, is
 *      refused or has not started in load_ms is tried once more (the offline copy usually has it); if that fails too
 *      the line is silent: onSilent({ text, lang }) fires (the screen shows the words) and it resolves after a short
 *      pause. A line that has a clip is never said by the phone's own voice (its accent drifts from Jugnu's);
 *   2. a line with no clip (a form with no clips: SAE.prepare's 'tts'): the phone's own speech (speechSynthesis),
 *      only in a voice in VOICES (South Asian, UK or US English; Urdu), never another en-* (en-SG, en-HK …);
 *   3. else a short pause, so the screen still moves on.
 * textObj: a string, { en, ur }, or { text, lang } (a line in the task's own language: spoken with that language's
 * voice); a { …, audio } on it is used when audioObj is not given. audioObj: a key string or { en, ur }.
 * speak() never throws and its promise always resolves (when the words end, on any error, or on a guard timeout).
 * A new speak() or stop() cuts the one before it and resolves its promise.
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
    var onSpeak = typeof o.onSpeak === 'function' ? o.onSpeak : null;
    var onSilent = typeof o.onSilent === 'function' ? o.onSilent : null;
    var cur = null; // { done(), audio?, tts? }
    function notify(on, text) { if (onSpeak) { try { onSpeak({ speaking: on, text: text || null }); } catch (e) { /* ignore */ } } }

    // Injected for tests; the page uses the browser's own.
    function AudioCtor() { return o.Audio || g('Audio'); }
    function synth() { return o.speechSynthesis || g('speechSynthesis'); }
    function Utter() { return o.SpeechSynthesisUtterance || g('SpeechSynthesisUtterance'); }

    function stopCur() {
      var c = cur;
      cur = null;
      if (!c) return;
      try { if (c.audio) { c.audio.onended = c.audio.onerror = c.audio.onplaying = null; c.audio.pause(); } } catch (e) { /* ignore */ }
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

        // The clip failed twice: the words stay on the screen, Jugnu is silent (never the phone's voice).
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
            var a = new A(base + clip), playing = false, fell = false, t0 = null;
            me.audio = a;
            var fallback = function () {
              if (fell || finished || cur !== me) return;
              fell = true;
              if (t0) clearTimeout(t0);
              try { a.onended = a.onerror = a.onplaying = null; a.pause(); } catch (e) { /* ignore */ }
              me.audio = null;
              if (tries < 2) { try { play(); } catch (e) { silent(); } } else silent();
            };
            a.onplaying = function () { playing = true; start(); };
            a.onended = function () { me.done(); };
            a.onerror = fallback;
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

    return {
      speak: speak,
      stop: function () { try { stopCur(); } catch (e) { cur = null; } },
      setMuted: function (b) { muted = !!b; if (muted) { try { stopCur(); } catch (e) { cur = null; } } },
      get muted() { return muted; },
      lang: lang,
    };
  }

  return { create: create, pick: pick, textOf: textOf, voiceFor: voiceFor, VOICES: VOICES };
}));
