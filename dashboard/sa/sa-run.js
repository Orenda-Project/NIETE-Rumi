/**
 * Standalone QA bootstrap for /sa/run.html (the screens on their own, no store or sync):
 *   ?lang=ur|en &mode=game|proctored &form=<battery file in this folder, default demo-battery> [&muted=1]
 *   [&name=<first name>] [&back=<same-site url>] [&skin=game] [&warmup=0] [&audio_check=0]
 * The child's real page is /sa/play.html (sa-page.js). window.__sae = { runner, ui, voice, events } for QA.
 */
(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  var lang = q.get('lang') === 'en' ? 'en' : 'ur';
  var mode = q.get('mode') === 'proctored' ? 'proctored' : 'game';
  var form = /^[A-Za-z0-9._-]{1,80}$/.test(q.get('form') || '') ? q.get('form').replace(/\.json$/, '') : 'demo-battery';
  var muted = q.get('muted') === '1';
  var el = document.getElementById('sae-root');
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ur' ? 'rtl' : 'ltr';

  function skin() {
    if (q.get('skin') !== 'game') return Promise.resolve();
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = '/sa/skin-game.css';
    document.head.appendChild(l);
    return new Promise(function (ok) {
      var s = document.createElement('script');
      s.src = '/sa/skin-game.js'; s.onload = ok; s.onerror = function () { ok(); }; // the skin is optional
      document.body.appendChild(s);
    });
  }

  Promise.all([fetch('./' + form + '.json').then(function (r) {
    if (!r.ok) throw new Error(form + ': HTTP ' + r.status);
    return r.json();
  }), skin()]).then(function (got) {
    var battery = got[0];
    var SAE = window.SAE;
    var events = [];
    var runner = SAE.core.createRunner({
      battery: battery,
      now: function () { return performance.now(); },
      session_id: 'qa-' + Date.now(),
      audio_check: q.get('audio_check') !== '0',
      warmup: q.get('warmup') !== '0',
      onEvent: function (e) { events.push(e); },
    });
    var voice = SAE.voice.create({ lang: lang, base: '/', muted: muted });
    var ui = SAE.ui.mount(el, {
      runner: runner, battery: battery, lang: lang, mode: mode, speak: voice.speak, muted: muted,
      child: q.get('name') ? { first_name: q.get('name') } : null,
      back: q.get('back') || null,
      onMute: mode === 'game' ? function (b) { voice.setMuted(b); } : null,
      onRecordStart: function (t, it) { events.push({ type: 'qa_record_start', task_id: t.id, item_id: it ? it.id : null }); },
      onRecordStop: function (t, it) { events.push({ type: 'qa_record_stop', task_id: t.id, item_id: it ? it.id : null }); },
      onState: function (v) { window.__saeView = v; },
    });
    if (mode === 'proctored') ui.setSync({ state: 'local' });
    // as sa-engine.js: a line held while the page was hidden plays on when it is shown again
    document.addEventListener('visibilitychange', function () { if (document.visibilityState !== 'hidden') voice.resume(); });
    window.__sae = { runner: runner, events: events, ui: ui, voice: voice };
  }).catch(function (e) {
    el.textContent = 'Could not start: ' + (e && e.message ? e.message : e);
  });
}());
