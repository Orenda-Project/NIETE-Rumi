/**
 * A grown-up's preview of a practice story on the hub page (/h/<token>#listen/<passage_id>, the practice home's story
 * tiles): Jugnu's stored clip with the word highlight (wq-readalong.js), fetched by the hub token from
 * /api/wq/listen/h/<token>/<pid> (the bot answers only on the phone the hub link is bound to). No run, no microphone,
 * no sticker, no event keyed by a child. Refused or offline: back to the hub, never a blank page.
 *
 * The edge adds this script, before hub.js, only when the hub JSON says `listen: true` (web_quiz_readalong on); off,
 * the hub page and hub.js are today's. hub.js hands over at boot with one guard expression:
 *   if (!(window.WQLISTEN && WQLISTEN.take(boot, render, bar))) boot();
 * take() answers true when the address carries #listen/<pid> and the preview is drawn; this file owns the hash test,
 * the context and the hashchange listener (a tile sets the hash in place).
 */
(function () {
  'use strict';
  var T = {
    en: { say: 'Listen to Jugnu read it.', back: 'Back', ra: { play: 'Play', pause: 'Pause', replay: 'Hear it again' } },
    ur: { say: 'جگنو سے کہانی سنیں۔', back: 'واپس', ra: { play: 'سنیں', pause: 'روکیں', replay: 'دوبارہ سنیں' } },
  };
  var hub = null;      // { boot, render, bar } from hub.js, once it has booted (never on a locked hub)
  var player = null;
  var shown = false;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pidOf() {
    var m = /^#listen\/([A-Za-z0-9._-]{3,64})$/.exec(String((typeof location !== 'undefined' && location.hash) || ''));
    return m && m[1].indexOf('..') < 0 ? m[1] : null;
  }
  function boot() {
    try { return JSON.parse(document.getElementById('boot').textContent) || {}; } catch (e) { return {}; }
  }
  // The player's script at this file's own version (the edge's ?v= hashes both files).
  function loadPlayer(onload, onerror) {
    try {
      var me = document.querySelector('script[src*="/wq/wq-readalong-listen.js"]');
      var v = me && /[?&]v=([A-Za-z0-9]+)/.exec(me.getAttribute('src') || '');
      var s = document.createElement('script');
      s.src = '/wq/wq-readalong.js' + (v ? '?v=' + v[1] : '');
      s.addEventListener('load', onload);
      s.addEventListener('error', onerror);
      document.head.appendChild(s);
    } catch (e) { onerror(); }
  }

  function leave() {
    try { if (player) player.destroy(); } catch (e) { /* gone */ }
    player = null;
    shown = false;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* the hub draws anyway */ }
    hub.boot();
  }

  function open(pid) {
    var B = boot();
    var lang = B.lang === 'ur' ? 'ur' : 'en';
    var t = T[lang];
    var root = document.getElementById('wq');
    shown = true;
    hub.render(hub.bar() + '<div class="wq-jug"><span class="wq-jimg" data-jpose="hello"><img src="/wq/jugnu/hello.webp" alt="" width="92" height="92"></span><div class="wq-say">' + esc(t.say) + '</div></div>'
      + '<div id="wq-listen-ra"></div><div class="wq-stack">'
      + '<button class="wq-btn wq-soft" id="wq-listen-back" type="button">' + esc(t.back) + '</button></div>', 'HL');
    var b = root.querySelector('#wq-listen-back');
    if (b) b.addEventListener('click', leave);
    var go = function () {
      fetch('/api/wq/listen/h/' + encodeURIComponent(String(B.token || '')) + '/' + encodeURIComponent(pid) + '?lang=' + lang, { method: 'GET', headers: { accept: 'application/json' } })
        .then(function (r) { return r.text().then(function (x) { var j = null; try { j = x ? JSON.parse(x) : null; } catch (e) {} return { ok: r.ok, body: j || {} }; }); })
        .then(function (r) {
          var el = root.querySelector('#wq-listen-ra');
          if (!shown) return;
          if (!r.ok || !r.body.readalong || !window.WQReadAlong || !el) { leave(); return; }
          player = window.WQReadAlong.mount(el, r.body.readalong, { labels: t.ra });   // its own play button: the tap starts the voice
        }, function () { if (shown) leave(); });
    };
    if (window.WQReadAlong) go(); else loadPlayer(go, function () { if (shown) leave(); });
  }

  // From hub.js at boot (and from a tile's hashchange): true when the preview is drawn instead of the hub.
  function take(bootHub, render, bar) {
    if (bootHub) hub = { boot: bootHub, render: render, bar: bar };
    var pid = hub && pidOf();
    if (!pid) return false;
    open(pid);
    return true;
  }

  window.addEventListener('hashchange', function (e) {
    if (!hub) return;
    if (pidOf()) take();
    else if (shown) {          // the phone's Back from a preview: the hub, drawn once (the v3 home's own listener, added
      leave();                 // after this one, would draw it again)
      if (e && e.stopImmediatePropagation) e.stopImmediatePropagation();
    }
  });
  window.WQLISTEN = { take: take };
}());
