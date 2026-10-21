/**
 * The child's page, /sa/play.html (switch sa_engine): the one screen both surfaces open.
 *
 *   ?s=<session id>&form=<sa.coach.G3.A.ur>&mode=proctored|game&lang=ur|en&block=B1..B5|full|rdf&back=<same-origin url>
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
      block: /^(B[1-9]|full|rdf|maths|english|urdu|tower)$/.test(q.get('block') || '') ? q.get('block') : null,
      // Only a same-origin path: never an open redirect.
      back: /^\/(?!\/)[^\s\\]*$/.test(back) ? back : null,
      skin: q.get('skin') === 'game' ? 'game' : null,
      embed: q.get('embed') === '1',
      drain: q.get('drain') === '1',
      // A linked phone's token (the coach's QR/link): the sink uses the token routes, no cookie.
      token: /^[A-Za-z0-9._~-]{16,700}$/.test(q.get('t') || '') ? q.get('t') : null,
      first_name: name || null,
    };
  }

  /**
   * The tasks of one block, in the block's own order: a coach block (blocks.B1..B5), the RDF short form (rdf, with its
   * per-task item rules rdf_items: a number caps the items, {drop: [ids]} leaves those out; a task it lists without
   * its dependency runs on its own), a game island (islands.maths …) or the game's tower (tower = the coach order);
   * the whole battery (its `full` order when it names one) for "full", no block or an unknown one.
   */
  function pick(battery, block) {
    var want = null;
    var caps = null;
    if (block && block !== 'full') {
      if (block === 'tower' && Array.isArray(battery.tower)) want = battery.tower;
      else if (block === 'rdf' && Array.isArray(battery.rdf)) { want = battery.rdf; caps = battery.rdf_items || null; }
      else if (battery.blocks && Array.isArray(battery.blocks[block])) want = battery.blocks[block];
      else if (battery.islands && Array.isArray(battery.islands[block])) want = battery.islands[block];
    }
    // The tasks only a short form runs (RDF's recorded letter sounds) are not part of the whole battery.
    if (!want && Array.isArray(battery.full) && battery.full.length < battery.tasks.length) want = battery.full;
    if (!want) return battery;
    var out = {};
    for (var k in battery) if (Object.prototype.hasOwnProperty.call(battery, k)) out[k] = battery[k];
    // The list's own order (the tower runs in the coach order, which is not the islands' order).
    var byId = {};
    battery.tasks.forEach(function (t) { byId[t.id] = t; });
    var keepItems = function (items, rule) {
      if (!Array.isArray(items)) return items;
      if (rule > 0) return items.slice(0, rule);
      return items.filter(function (it) { return !it || rule.drop.indexOf(it.id) < 0; });
    };
    out.tasks = want.map(function (id) { return byId[id]; }).filter(Boolean).map(function (t) {
      var rule = caps && caps[t.id];
      var orphan = caps && t.depends_on && t.depends_on.task && want.indexOf(t.depends_on.task) < 0;
      if (!(rule > 0 || (rule && Array.isArray(rule.drop))) && !orphan) return t;
      var c = {};
      for (var k in t) if (Object.prototype.hasOwnProperty.call(t, k)) c[k] = t[k];
      if (orphan) delete c.depends_on;
      if (rule > 0 || (rule && Array.isArray(rule.drop))) {
        c.items = keepItems(t.items, rule);
        if (Array.isArray(t.variants)) c.variants = t.variants.map(function (v) { var w = {}; for (var j in v) if (Object.prototype.hasOwnProperty.call(v, j)) w[j] = v[j]; w.items = keepItems(v.items, rule); return w; });
      }
      return c;
    });
    out.battery_id = battery.battery_id + (block && block !== 'full' ? '#' + block : '');
    return out.tasks.length ? out : battery;
  }

  /** FNV-1a of a string: the same session always gets the same number. Math.imul keeps the product's low bits
   *  (a plain * rounds them away above 2^53, and hash % 2 then lands on 0 almost every time). */
  function hash(s) {
    var x = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
    return x;
  }

  /**
   * RULING #39 (A02): a task with variants[] (the passage, its questions, the listening story) runs variant
   * hash(seed) mod n, the same index for every task with the same n, so a passage and its questions stay together.
   * The battery carries variants only while sa_passage_rotation is ON (the server drops them otherwise).
   */
  function rotate(battery, seed) {
    if (!battery || !Array.isArray(battery.tasks) || !battery.tasks.some(function (t) { return Array.isArray(t.variants) && t.variants.length; })) return battery;
    var h = hash(String(seed || ''));
    var out = {};
    for (var k in battery) if (Object.prototype.hasOwnProperty.call(battery, k)) out[k] = battery[k];
    out.tasks = battery.tasks.map(function (t) {
      if (!Array.isArray(t.variants) || !t.variants.length) return t;
      var v = t.variants[h % t.variants.length];
      var c = {};
      for (var j in t) if (Object.prototype.hasOwnProperty.call(t, j) && j !== 'variants') c[j] = t[j];
      if (v.passage) c.passage = v.passage;
      c.items = v.items;
      if (v.stop) c.stop = v.stop;
      c.variant = { id: v.id, src: v.src, fielded: v.fielded };
      return c;
    });
    return out;
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

  /**
   * Send what earlier children left on this phone. Each session's sync lives in its own page, so a child whose
   * network came back after the hand-back would never send. drain() lists every coach (proctored) session in the
   * phone's store with something unsent, and runs the same sync for each, one after another, through the coach sink.
   *   o: { store, sync (SAE.sync), mode ('proctored' default | 'game'), sink(id) → a sink or null, exclude (the session
   *        this page runs), online, timers }
   * → Promise<[{ s, state, pending_events, pending_audio }]>. A game session goes through its own kept run token (the
   * game sink for that id); none kept → state 'no_sink', left on the phone.
   */
  function drain(o) {
    return o.store.sessions().then(function (rows) {
      var mode = o.mode === 'game' ? 'game' : 'proctored';
      var ids = rows.filter(function (r) { return r && r.session_id && r.session_id !== o.exclude && (r.mode === 'game') === (mode === 'game'); })
        .map(function (r) { return r.session_id; });
      var out = [];
      return ids.reduce(function (chain, id) {
        return chain.then(function () { return o.store.pending(id); }).then(function (p) {
          if (!p.events.length && !p.results.length && !p.chunks.some(function (c) { return c.final; })) return null;
          var sink = o.sink(id);
          if (!sink) { out.push({ s: id, state: 'no_sink', pending_events: p.events.length + p.results.length, pending_audio: p.chunks.filter(function (c) { return c.final; }).length }); return null; }
          var sy = o.sync.create({ store: o.store, sink: sink, session_id: id, online: o.online, timers: o.timers });
          return sy.flush().then(function (st) {
            if (sy.stop) sy.stop();
            out.push({ s: id, state: st.state, pending_events: st.pending_events, pending_audio: st.pending_audio });
          });
        });
      }, Promise.resolve()).then(function () { return out; });
    });
  }

  /** The drain page (/sa/play.html?drain=1&embed=1): no screen, no session; drain, then tell the coach page once. */
  function bootDrain(SAE, p) {
    var store = SAE.store;
    var sink = function () { return SAE.sinks.coach(); };
    return store.open().then(function (st) {
      return drain({ store: st, sync: SAE.sync, sink: sink });
    }).then(function (sessions) { return sessions; }, function () { return []; }).then(function (sessions) {
      if (p.embed && root.parent && root.parent !== root) {
        root.parent.postMessage({ type: 'sa:drained', sessions: sessions }, root.location.origin);
      }
      return sessions;
    });
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
    if (p.drain && SAE.store && SAE.sync && SAE.sinks && SAE.sinks.coach) { bootDrain(SAE, p); return; }
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
      var battery = rotate(pick(full, p.block), p.session_id);
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
          // Belt and braces: an earlier child's rows on this phone go too, after this child's own start.
          if (!p.token && SAE.sync && SAE.sinks && SAE.sinks.coach) {
            setTimeout(function () {
              drain({ store: engine.store, sync: SAE.sync, sink: function () { return SAE.sinks.coach(); }, exclude: engine.session_id })
                .then(function (d) { if (d.length) engine.runner.log('drained', { value: d }); }, function () {});
            }, 3000);
          }
          engine.on('unlock', release);
        } else if (p.mode === 'game' && SAE.sync && SAE.sinks && SAE.sinks.game) {
          // The next island sends what an earlier island left (its network came back after it closed), each session
          // through the run token the game kept for it.
          setTimeout(function () {
            drain({ store: engine.store, sync: SAE.sync, mode: 'game', exclude: engine.session_id,
              sink: function (id) { try { return root.SAE.sinks.game({ session_id: id }); } catch (_) { return null; } } })
              .then(function (d) { if (d.length) engine.runner.log('drained', { value: d }); }, function () {});
          }, 3000);
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

  return { params: params, pick: pick, rotate: rotate, lockDown: lockDown, drain: drain, boot: boot };
}));
