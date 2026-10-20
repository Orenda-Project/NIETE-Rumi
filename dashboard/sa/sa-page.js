/**
 * The child's page, /sa/play.html (switch sa_engine): the one screen both surfaces open.
 *
 *   ?s=<session id>&form=<sa.coach.G3.A.ur>&mode=proctored|game&lang=ur|en&block=B1..B5|full&back=<same-origin url>
 *   &skin=game &embed=1   #n=<first name>
 *
 * embed=1: the page sits in the coach page's same-origin iframe; at the hand-back it tells the parent
 * (postMessage {type:'sa:done', s, reason}) instead of going to back.
 *
 * The first name rides in the fragment (never sent to a server), is read once for the handover screen and dropped
 * from the address bar. block picks battery.blocks[block] (the coach's five-block design); absent or "full" runs every
 * task. Proctored mode syncs through the coach sink (portal relay, cookie); game mode through SAE.sinks.game when the
 * game's skin has loaded it. The page asks the service worker to keep the battery and its clips, then starts.
 *
 * UMD: the pure helpers are module.exports under Node (tests); in the browser the page boots itself.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', function () { api.boot(); });
    else api.boot();
  }
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var FORM_RX = /^sa\.(coach|game)\.[A-Za-z0-9]+(\.[A-Za-z0-9]+)?\.(en|ur)$/;
  var SESSION_RX = /^[A-Za-z0-9_-]{6,64}$/;

  /** The page's parameters, checked; anything unexpected falls back to the safe value. */
  function params(search, hash) {
    var q = new URLSearchParams(search || '');
    var h = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    var form = q.get('form') || '';
    var back = q.get('back') || '';
    var name = (h.get('n') || '').trim().slice(0, 40);
    return {
      session_id: SESSION_RX.test(q.get('s') || '') ? q.get('s') : null,
      form: FORM_RX.test(form) ? form : null,
      mode: q.get('mode') === 'game' ? 'game' : 'proctored',
      lang: q.get('lang') === 'en' ? 'en' : (q.get('lang') === 'ur' ? 'ur' : (/\.en$/.test(form) ? 'en' : 'ur')),
      block: /^(B[1-9]|full|maths|english|urdu|tower)$/.test(q.get('block') || '') ? q.get('block') : null,
      // Only a same-origin path: never an open redirect.
      back: /^\/(?!\/)[^\s\\]*$/.test(back) ? back : null,
      skin: q.get('skin') === 'game' ? 'game' : null,
      embed: q.get('embed') === '1',
      // A linked phone's token (the coach's QR/link): the sink uses the token routes, no cookie.
      token: /^[A-Za-z0-9._~-]{16,700}$/.test(q.get('t') || '') ? q.get('t') : null,
      first_name: name || null,
    };
  }

  /**
   * The tasks of one block, in the block's own order: a coach block (blocks.B1..B5), a game island (islands.maths …) or
   * the game's tower (tower = the coach order); the whole battery for "full", no block or an unknown one.
   */
  function pick(battery, block) {
    var want = null;
    if (block && block !== 'full') {
      if (block === 'tower' && Array.isArray(battery.tower)) want = battery.tower;
      else if (battery.blocks && Array.isArray(battery.blocks[block])) want = battery.blocks[block];
      else if (battery.islands && Array.isArray(battery.islands[block])) want = battery.islands[block];
    }
    if (!want) return battery;
    var out = {};
    for (var k in battery) if (Object.prototype.hasOwnProperty.call(battery, k)) out[k] = battery[k];
    // The list's own order (the tower runs in the coach order, which is not the islands' order).
    var byId = {};
    battery.tasks.forEach(function (t) { byId[t.id] = t; });
    out.tasks = want.map(function (id) { return byId[id]; }).filter(Boolean);
    out.battery_id = battery.battery_id + '#' + block;
    return out.tasks.length ? out : battery;
  }

  function el(tag, cls, text) {
    var e = root.document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  /** A script, resolved when it ran or when it is missing (a skin not shipped yet never stops the test). */
  function load(doc, src) {
    return new Promise(function (ok) {
      var s = doc.createElement('script');
      s.src = src;
      s.onload = function () { ok(true); };
      s.onerror = function () { ok(false); };
      doc.head.appendChild(s);
    });
  }

  /**
   * Proctored: no way out for the child but finishing. The browser's back is caught and logged (the page stays), the
   * first tap asks for full screen (a browser needs a tap for it; not when embedded in the coach page), and the screen
   * is kept awake while the run lasts.
   * The coach's own way out is the press-and-hold on the screens. Returns a release().
   */
  function lockDown(win, engine, o) {
    // Embedded in the coach page's frame: that page owns the screen. A full-screen frame would sit above the coach
    // page's own end-test hold and hide it, so the frame never asks for full screen.
    var fullscreen = !(o && o.embed);
    var doc = win.document;
    var nav = win.navigator;
    var lock = null;
    var hist = win.history;
    var onPop = function () {
      engine.runner.log('back_blocked');
      if (hist && hist.pushState) hist.pushState({ sa: 1 }, '', win.location.href);
    };
    if (hist && hist.pushState) { hist.pushState({ sa: 1 }, '', win.location.href); win.addEventListener('popstate', onPop); }
    var onFirst = function () {
      doc.removeEventListener('pointerdown', onFirst, true);
      var de = doc.documentElement;
      var req = de.requestFullscreen || de.webkitRequestFullscreen;
      if (req) { try { var r = req.call(de); if (r && r.catch) r.catch(function () {}); } catch (_) { /* not allowed here */ } }
    };
    if (fullscreen) doc.addEventListener('pointerdown', onFirst, true);
    var wake = function () {
      if (!nav || !nav.wakeLock || doc.visibilityState !== 'visible') return;
      nav.wakeLock.request('screen').then(function (l) { lock = l; }, function () {});
    };
    var onVis = function () { if (doc.visibilityState === 'visible') wake(); else engine.runner.log('hidden'); };
    doc.addEventListener('visibilitychange', onVis);
    wake();
    return function release() {
      win.removeEventListener('popstate', onPop);
      doc.removeEventListener('pointerdown', onFirst, true);
      doc.removeEventListener('visibilitychange', onVis);
      if (lock && lock.release) lock.release().catch(function () {});
      if (doc.fullscreenElement && doc.exitFullscreen) doc.exitFullscreen().catch(function () {});
    };
  }

  function fail(mount, words) {
    mount.textContent = '';
    mount.appendChild(el('p', 'sa-fail', words));
  }

  function boot() {
    var SAE = root.SAE || {};
    var doc = root.document;
    var p = params(root.location.search, root.location.hash);
    if (root.location.hash && root.history && root.history.replaceState) {
      root.history.replaceState(null, '', root.location.pathname + root.location.search);
    }
    var mount = doc.getElementById('sae-root') || doc.body;
    doc.documentElement.lang = p.lang;
    doc.documentElement.dir = p.lang === 'ur' ? 'rtl' : 'ltr';
    if (!p.session_id || !p.form) { fail(mount, p.lang === 'ur' ? 'یہ لنک درست نہیں۔' : 'This link is not right.'); return; }
    // Game mode: the game lane's sink and skin, loaded (or found missing) before the engine starts, so the skin sees
    // the first event and the sink exists for the first sync.
    var extras = [];
    if (p.skin === 'game') {
      var css = el('link'); css.rel = 'stylesheet'; css.href = '/sa/skin-game.css'; doc.head.appendChild(css);
      extras.push('/sa/skin-game.js');
    }
    if (p.mode === 'game') extras.push('/sa/sink-game.js');
    var url = '/sa/batteries/' + p.form + '.json';
    Promise.all(extras.map(function (src) { return load(doc, src); })).then(function () {
      return root.fetch(url, { cache: 'no-cache' });
    }).then(function (r) {
      if (!r.ok) throw new Error('battery ' + r.status);
      return r.json();
    }).then(function (full) {
      var battery = pick(full, p.block);
      var sink = p.mode === 'proctored'
        ? (p.token ? (SAE.sinks && SAE.sinks.coachLinked ? SAE.sinks.coachLinked(p.token) : null)
          : (SAE.sinks && SAE.sinks.coach ? SAE.sinks.coach() : null))
        : ((root.SAE.sinks && root.SAE.sinks.game) ? root.SAE.sinks.game({ session_id: p.session_id }) : null);
      // The device's readiness (RULING #14, #11): the battery and clips on the phone, a voice for the language, storage
      // kept. SAE.prepare (car 4b) answers voice 'clips' | 'tts' | 'none'; the older offline.prepare when it is absent.
      var offline = SAE.prepare ? SAE.prepare(full, { lang: p.lang, battery_url: url, base: '/' })
        : (SAE.offline ? SAE.offline.prepare({ battery_url: url, battery: full, lang: p.lang, base: '/' }) : Promise.resolve({ ready: false }));
      offline = offline.then(null, function () { return { ready: false }; });
      return root.SAE.start({
        mount: mount, battery: battery, mode: p.mode, lang: p.lang, sink: sink, session_id: p.session_id,
        child: p.first_name ? { first_name: p.first_name } : null, back: p.back, embed: p.embed,
      }).then(function (engine) {
        root.__sae = engine;
        if (p.mode === 'proctored') {
          var release = lockDown(root, engine, { embed: p.embed });
          engine.on('unlock', release);
        }
        offline.then(function (o) {
          engine.runner.log('device_ready', { value: {
            ready: !!o.ready, voice: o.voice || null, persisted: o.persisted == null ? null : !!o.persisted,
            clips_total: o.clips_total != null ? o.clips_total : null, clips_cached: o.clips_cached != null ? o.clips_cached : (o.clips || 0),
          } });
          // No clip and no phone voice for this language: Jugnu would be silent, so the test does not start.
          if (o.voice === 'none' && engine.view && engine.view.refuse) {
            engine.runner.log('voice_not_ready');
            engine.view.refuse('voice');
          }
        });
        root.addEventListener('offline', function () { engine.runner.log('offline'); });
        root.addEventListener('online', function () { engine.runner.log('online'); });
        return engine;
      });
    }).catch(function () {
      fail(mount, p.lang === 'ur' ? 'ابھی کھل نہیں سکا۔ کوچ سے کہیں کہ دوبارہ کھولیں۔' : 'This did not open. Ask the coach to open it again.');
    });
  }

  return { params: params, pick: pick, lockDown: lockDown, boot: boot };
}));
