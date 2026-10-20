/**
 * The page's side of the battery's offline copy (switch sa_engine): registers /sa/sw.js (scope /sa/) and asks it to
 * keep this session's battery file and Jugnu's clips for this language, then says whether the phone can lose the
 * network now.
 *
 *   SAE.offline.urls(battery, lang, base) → the clip URLs the session can play
 *   SAE.offline.prepare({ battery_url, battery, lang, base }) → Promise<{ ready, battery, clips, clips_missing, why? }>
 *     ready = the engine files and the battery are on the phone; a clip not on the phone is spoken by the phone's own
 *     voice instead (clips_missing counts them), so it never blocks "ready".
 *   SAE.prepare(battery, { lang, battery_url, base }) → Promise<{ clips_total, clips_cached, voice, persisted, ready,
 *     battery, why? }> — the voice-readiness gate (RULING #14): voice 'clips' when every clip of the session is on the
 *     phone, else 'tts' when the phone has a voice in the session's language, else 'none' (the surface refuses the
 *     start). It asks for persistent storage (RULING #11) and keeps sa:voice / sa:persisted for the sink's batch.
 *
 * UMD: window.SAE.offline (and SAE.prepare) in the browser, module.exports under Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else { root.SAE = root.SAE || {}; root.SAE.offline = factory(root); root.SAE.prepare = root.SAE.offline.prepareSession; }
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var AUDIO_RX = /\.(mp3|m4a|ogg|webm|wav)$/i;

  /** Every audio key in the battery for this language (strings, or {en, ur} picked by lang), as URLs under base. */
  function urls(battery, lang, base) {
    var out = {};
    var b = base == null ? '/' : base;
    function add(k) {
      if (typeof k !== 'string' || !AUDIO_RX.test(k)) return;
      out[/^(https?:)?\//.test(k) ? k : b.replace(/\/?$/, '/') + k] = true;
    }
    (function walk(x, key) {
      if (x == null) return;
      if (typeof x === 'string') { add(x); return; }
      if (Array.isArray(x)) { x.forEach(function (v) { walk(v, key); }); return; }
      if (typeof x === 'object') {
        if (key === 'audio' || key === 'prompt_audio' || key === 'choice_audio') {
          if (typeof x[lang] === 'string') { add(x[lang]); return; }
        }
        for (var k in x) {
          if (!Object.prototype.hasOwnProperty.call(x, k)) continue;
          // A line's audio in the other language is not this session's.
          if ((k === 'en' || k === 'ur') && k !== lang && (key === 'audio' || key === 'prompt_audio')) continue;
          walk(x[k], k);
        }
      }
    }(battery, null));
    return Object.keys(out).sort();
  }

  function ask(sw, msg, waitMs) {
    return new Promise(function (ok) {
      var ch = new root.MessageChannel();
      var t = setTimeout(function () { ok(null); }, waitMs || 60000);
      ch.port1.onmessage = function (e) { clearTimeout(t); ok(e.data); };
      sw.postMessage(msg, [ch.port2]);
    });
  }

  function prepare(o) {
    var nav = root.navigator;
    if (!nav || !nav.serviceWorker) return Promise.resolve({ ready: false, why: 'no_service_worker' });
    var clips = urls(o.battery, o.lang, o.base);
    return nav.serviceWorker.register('/sa/sw.js', { scope: '/sa/' })
      .then(function () { return nav.serviceWorker.ready; })
      .then(function (reg) {
        var sw = reg.active || nav.serviceWorker.controller;
        if (!sw) return { ready: false, why: 'no_active_worker' };
        var list = [o.battery_url].filter(Boolean);
        return Promise.all([ask(sw, { type: 'prepare', urls: list }), ask(sw, { type: 'prepare', urls: clips })]).then(function (r) {
          var core = r[0] || { ok: false, missing: list };
          var audio = r[1] || { ok: false, missing: clips };
          return { ready: !!core.ok, battery: !!core.ok, clips: clips.length - audio.missing.length, clips_missing: audio.missing.length, why: core.ok ? undefined : 'battery_not_cached' };
        });
      })
      .catch(function (e) { return { ready: false, why: String(e && e.message || e) }; });
  }

  var VOICES_WAIT_MS = 1500;

  /** Does the phone speak lang? getVoices() is empty until 'voiceschanged' on some browsers: wait for it, briefly. */
  function hasVoice(speech, lang) {
    if (!speech || typeof speech.getVoices !== 'function') return Promise.resolve(false);
    function match() { return (speech.getVoices() || []).some(function (v) { return String(v.lang || '').toLowerCase().indexOf(lang) === 0; }); }
    if (match()) return Promise.resolve(true);
    if (typeof speech.addEventListener !== 'function') return Promise.resolve(false);
    return new Promise(function (ok) {
      var t = setTimeout(function () { ok(match()); }, VOICES_WAIT_MS);
      speech.addEventListener('voiceschanged', function () { if (match()) { clearTimeout(t); ok(true); } });
    });
  }

  function persist(storage) {
    if (!storage || typeof storage.persist !== 'function') return Promise.resolve(false);
    return Promise.resolve().then(function () { return storage.persist(); }).then(function (v) { return v === true; }, function () { return false; });
  }

  function pick(o, k, dflt) { return o && k in o ? o[k] : dflt; }

  /** prepareSession(battery, { lang, battery_url, base, offline?, speech?, storage?, localStorage? }) — see the header. */
  function prepareSession(battery, o) {
    o = o || {};
    var lang = o.lang === 'en' ? 'en' : 'ur';
    var nav = root.navigator;
    var off = o.offline || prepare;
    var speech = pick(o, 'speech', root.speechSynthesis || null);
    var storage = pick(o, 'storage', nav && nav.storage || null);
    var ls = pick(o, 'localStorage', (function () { try { return root.localStorage; } catch (_) { return null; } }()));
    var total = urls(battery, lang, o.base).length;
    return Promise.all([
      Promise.resolve().then(function () { return off({ battery_url: o.battery_url, battery: battery, lang: lang, base: o.base }); }).then(null, function () { return null; }),
      hasVoice(speech, lang).then(null, function () { return false; }),
      persist(storage),
    ]).then(function (r) {
      var c = r[0] || {};
      var cached = typeof c.clips === 'number' ? Math.min(c.clips, total) : 0;
      var voice = total > 0 && cached === total ? 'clips' : (r[1] ? 'tts' : 'none');
      if (ls) { try { ls.setItem('sa:voice', voice); ls.setItem('sa:persisted', String(r[2])); } catch (_) { /* a full or blocked store: the batch says null */ } }
      return { clips_total: total, clips_cached: cached, voice: voice, persisted: r[2], ready: !!c.ready, battery: !!c.battery, why: c.why };
    });
  }

  return { urls: urls, prepare: prepare, prepareSession: prepareSession, hasVoice: hasVoice };
}));
