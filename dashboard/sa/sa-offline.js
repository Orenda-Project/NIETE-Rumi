/**
 * The page's side of the battery's offline copy (switch sa_engine): registers /sa/sw.js (scope /sa/) and asks it to
 * keep this session's battery file and Jugnu's clips for this language, then says whether the phone can lose the
 * network now.
 *
 *   SAE.offline.urls(battery, lang, base) → the clip URLs the session can play
 *   SAE.offline.prepare({ battery_url, battery, lang, base }) → Promise<{ ready, battery, clips, clips_missing, why? }>
 *     ready = the engine files and the battery are on the phone; a clip not on the phone is spoken by the phone's own
 *     voice instead (clips_missing counts them), so it never blocks "ready".
 *
 * UMD: window.SAE.offline in the browser, module.exports under Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else { root.SAE = root.SAE || {}; root.SAE.offline = factory(root); }
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

  return { urls: urls, prepare: prepare };
}));
