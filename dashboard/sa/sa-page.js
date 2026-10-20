/**
 * The child's page, /sa/play.html (switch sa_engine): the one screen both surfaces open.
 *
 *   ?s=<session id>&form=<sa.coach.G3.A.ur>&mode=proctored|game&lang=ur|en&block=B1..B5|full&back=<same-origin url>
 *   &skin=game   #n=<first name>
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
    if (p.skin === 'game') {
      var css = el('link'); css.rel = 'stylesheet'; css.href = '/sa/skin-game.css'; doc.head.appendChild(css);
      var js = el('script'); js.src = '/sa/skin-game.js'; js.defer = true; doc.head.appendChild(js);
    }
    var url = '/sa/batteries/' + p.form + '.json';
    root.fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('battery ' + r.status);
      return r.json();
    }).then(function (full) {
      var battery = pick(full, p.block);
      var sink = p.mode === 'proctored'
        ? (SAE.sinks && SAE.sinks.coach ? SAE.sinks.coach() : null)
        : (SAE.sinks && SAE.sinks.game ? SAE.sinks.game({ session_id: p.session_id }) : null);
      var offline = SAE.offline ? SAE.offline.prepare({ battery_url: url, battery: full, lang: p.lang, base: '/' }) : Promise.resolve({ ready: false });
      return SAE.start({
        mount: mount, battery: battery, mode: p.mode, lang: p.lang, sink: sink, session_id: p.session_id,
        child: p.first_name ? { first_name: p.first_name } : null, back: p.back,
      }).then(function (engine) {
        root.__sae = engine;
        offline.then(function (o) { engine.runner.log('offline_ready', { value: { ready: !!o.ready, clips: o.clips || 0, clips_missing: o.clips_missing || 0 } }); });
        root.addEventListener('offline', function () { engine.runner.log('offline'); });
        root.addEventListener('online', function () { engine.runner.log('online'); });
        return engine;
      });
    }).catch(function () {
      fail(mount, p.lang === 'ur' ? 'ابھی کھل نہیں سکا۔ کوچ سے کہیں کہ دوبارہ کھولیں۔' : 'This did not open. Ask the coach to open it again.');
    });
  }

  return { params: params, pick: pick, boot: boot };
}));
