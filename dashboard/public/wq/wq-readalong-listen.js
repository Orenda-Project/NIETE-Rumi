/**
 * A grown-up's preview of a practice story on the hub page (/h/<token>#listen/<passage_id>, the practice home's story
 * tiles): Jugnu's stored clip with the word highlight (wq-readalong.js), fetched by the hub token from
 * /api/wq/listen/h/<token>/<pid>. No run, no microphone, no sticker, no event keyed by a child. Refused or offline:
 * back to the hub, never a blank page. hub.js loads this file only when the address carries #listen/<pid>.
 *
 *   WQLISTEN.open({ pid, root, token, lang, render, bar, jug, esc, api, loadOnce, back })
 */
(function () {
  'use strict';
  var T = {
    en: { say: 'Listen to Jugnu read it.', back: 'Back', ra: { play: 'Play', pause: 'Pause', replay: 'Hear it again' } },
    ur: { say: 'جگنو سے کہانی سنیں۔', back: 'واپس', ra: { play: 'سنیں', pause: 'روکیں', replay: 'دوبارہ سنیں' } },
  };
  var player = null;

  function open(c) {
    var t = T[c.lang === 'ur' ? 'ur' : 'en'];
    function leave() {
      try { if (player) player.destroy(); } catch (e) { /* gone */ }
      player = null;
      c.back();
    }
    c.render(c.bar() + c.jug('hello', t.say) + '<div id="wq-listen-ra"></div><div class="wq-stack">'
      + '<button class="wq-btn wq-soft" id="wq-listen-back" type="button">' + c.esc(t.back) + '</button></div>', 'HL');
    var b = c.root.querySelector('#wq-listen-back');
    if (b) b.addEventListener('click', leave);
    var go = function () {
      c.api('GET', 'listen/h/' + encodeURIComponent(c.token) + '/' + encodeURIComponent(c.pid) + '?lang=' + c.lang).then(function (r) {
        var el = c.root.querySelector('#wq-listen-ra');
        if (!r.ok || !r.body.readalong || !window.WQReadAlong || !el) { leave(); return; }
        player = window.WQReadAlong.mount(el, r.body.readalong, { labels: t.ra });   // its own play button: the tap starts the voice
      }, leave);
    };
    if (window.WQReadAlong) go(); else c.loadOnce('wq-readalong', false, go, null, leave);
  }

  window.WQLISTEN = { open: open };
}());
