/**
 * The child's page, /sa/play.html (switch sa_engine): the one screen both surfaces open.
 *
 *   ?s=<session id>&form=<sa.coach.G3.A.ur>&mode=proctored|game&lang=ur|en&block=B1..B5|full|rdf|rdf_auto|rdf_manual&back=<same-origin url>
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
  // This build of the page, logged on device_ready (round 28): always sw.js VERSION in the same tree (a test pins the two).
  var VERSION = 'sa-49';

  // the server's MAX_EVENT_DATA (sa-api.service.js): a longer value is not kept at all
  var MAX_VALUE = 300;
  /** A worker's word for device_ready / worker_swap: whole or null (never cut), so the event stays inside 300 characters. */
  function stamp(v) { return typeof v === 'string' && v && v.length <= 64 ? v : null; }

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
      block: /^(B[1-9]|full|rdf|rdf_auto|rdf_manual|maths|english|urdu|tower)$/.test(q.get('block') || '') ? q.get('block') : null,
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

  /** Round 13 (sa_r13_whole_stop): the run is the Whole battery (block full, or none). */
  function wholeOf(block) { return block == null || block === 'full'; }

  /** RDF manual is coach-led only when the server's switch (sa_rdf_manual) put ui.rdf_manual on the battery. */
  function manualOf(battery, block) { return block === 'rdf_manual' && !!(battery && battery.ui && battery.ui.rdf_manual === true); }

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
      // Wave 3: RDF auto and RDF manual (the form's own lists; the same tasks, manual is coach-led).
      else if ((block === 'rdf_auto' || block === 'rdf_manual') && Array.isArray(battery[block])) want = battery[block];
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

  /**
   * The phone's readiness for the part this child takes (RULING #51): the chosen block's battery (its tasks, the
   * passage variant drawn, the engine's lines), so a clip of another part that failed never refuses this child.
   */
  function prepareOf(SAE, battery, lang, url, onLines) {
    var o = { lang: lang, battery_url: url, base: '/', onLines: onLines };
    var p = SAE.prepare ? SAE.prepare(battery, o)
      : (SAE.offline ? SAE.offline.prepare({ battery_url: url, battery: battery, lang: lang, base: '/', onLines: onLines }) : Promise.resolve({ ready: false }));
    return p.then(null, function () { return { ready: false }; });
  }

  function tell(ctx, msg) {
    var w = ctx.win;
    if (!ctx.embed || !w || !w.parent || w.parent === w || !w.location) return;
    try { w.parent.postMessage(msg, w.location.origin); } catch (_) { /* the coach page is gone */ }
  }

  /**
   * Whether a task's item prompt is a clip: the child must hear the item to answer it. The letter-sound picker and the
   * spoken MCQ (kind pick | mcq), the spoken questions (mode oral), a listening task, and any task whose items Jugnu
   * says as they show (say | prompt | prompt_audio; a task that reads them only on its replay tile shows them instead).
   * The listen-and-tap grids (letters, words, numbers: the item is said, the child taps it) are clip-prompted.
   */
  function clipPrompted(t) {
    if (!t) return true;
    if (t.kind === 'pick' || t.kind === 'mcq' || t.mode === 'oral' || /listen/.test(String(t.subtask || ''))) return true;
    if (t.say_on === 'replay') return false;
    return (t.items || []).some(function (it) { return !!(it && (it.say || it.prompt || it.prompt_audio)); });
  }

  /** A late 'none' may wait for the task's end only in a timed task whose items need no clip (the child sees them). */
  function deferrable(t) { return !!(t && t.time_limit_s > 0) && !clipPrompted(t); }

  /**
   * After the preparation: device_ready is logged; no clip and no phone voice → the screen refuses the start and the
   * coach page is told {type:'sa:refused', s, reason:'voice'}. With sa_voice_gate_v2 (battery.ui.voice_gate_v2) the
   * refusal offers Try again: ctx.again() prepares once more; a voice → the test starts, {type:'sa:unrefused', s}.
   *
   * The preparation is not awaited by the start, so the verdict can land inside a running timed task. There a 'none'
   * never refuses (O-86 (c)): voice_late_none { task, ms into the task } is logged, the clock runs on untouched, the
   * task's result carries voice_deferred: true, and the gate runs at that task's task_end (voice_deferred_end { task, ms,
   * by } just before the refusal: by 'task_end', or the phase that ended the task), so the refusal falls between
   * tasks, before anything of the next one. Only a timed task whose items need no clip defers (deferrable); before any
   * task, between tasks, in an untimed task or a clip-prompted one the refusal is at once. A task left without its end
   * (the page hidden: a timed task runs again from its start) is gated then, before it runs again.
   */
  function voiceGate(engine, offline, ctx) {
    function readyOf(o, session) {
      var v = {
        ready: !!o.ready, voice: o.voice || null, persisted: o.persisted == null ? null : !!o.persisted,
        clips_total: o.clips_total != null ? o.clips_total : null, clips_cached: o.clips_cached != null ? o.clips_cached : (o.clips || 0),
        // how the preparation went on this phone (sa-offline.js): its ms, bytes, the first clip stage that stalled, clips missing
        prep_ms: o.prep_ms != null ? o.prep_ms : null, prep_bytes: o.prep_bytes != null ? o.prep_bytes : null,
        prep_gaveup_stage: o.prep_gaveup_stage || null, prep_missing: o.prep_missing != null ? o.prep_missing : null,
        page: VERSION, sw: stamp(o.sw), session: stamp(session),
      };
      // the server drops a value over MAX_EVENT_DATA whole: long names give way first, so the preparation fields are kept
      if (JSON.stringify(v).length > MAX_VALUE) { v.sw = null; v.session = null; }
      return v;
    }
    /** The timed task under way when the verdict lands, if the gate may wait for its end; else null. */
    function running() {
      if (typeof engine.on !== 'function' || !engine.runner.view) return null;
      var v = engine.runner.view();
      if (!v || (v.phase !== 'running' && v.phase !== 'last_word') || !deferrable(v.task)) return null;
      return v;
    }
    function waitForEnd(v) {
      var id = v.task.id;
      var ms = Math.max(0, Math.round(v.task.time_limit_s * 1000 - (v.time_left_ms || 0)));
      engine.runner.log('voice_late_none', { task_id: id, value: { task: id, ms: ms } });
      var pending = true;
      function done() {
        if (!pending) return false;
        pending = false;
        engine.off('task_end', onEnd);
        engine.off('state', onState);
        return true;
      }
      // how the deferral ended, on the task, immediately before the refusal: by 'task_end', or the phase that ended it
      // (silence_reminder: a silent attempt under sa_silence_repeat is no result, and with no voice the reminder can't play)
      function ended(by, used) {
        var w = engine.runner.view();
        var left = w && w.task && w.task.id === id ? (w.time_left_ms || 0) : 0;
        var at = used != null ? used : Math.max(0, Math.round(v.task.time_limit_s * 1000 - left));
        engine.runner.log('voice_deferred_end', { task_id: id, value: { task: id, ms: at, by: by } });
        refuse();
      }
      // task_end fires inside the runner's finish, before any screen of the task's end or of the next task is drawn
      function onEnd(e) {
        if (e && e.task_id === id && e.value) e.value.voice_deferred = true;
        if (done()) ended('task_end', e && e.task_id === id && e.value ? e.value.time_used_ms : null);
      }
      function onState(s) {
        if (s && (s.phase === 'running' || s.phase === 'last_word') && s.task && s.task.id === id) return;
        if (done()) ended((s && s.phase) || null, null);
      }
      engine.on('task_end', onEnd);
      engine.on('state', onState);
    }
    return offline.then(function (o) {
      // The clips' cache (o.held, capped at 2 s by sa-offline.js) is waited for only when no refusal is coming: a refusal
      // is never held back by it, and its device_ready says session null.
      var refusing = o.voice === 'none' && engine.view && engine.view.refuse;
      var held = !refusing && o.held && typeof o.held.then === 'function' ? o.held.then(null, function () { return null; }) : Promise.resolve(null);
      return held.then(function (session) { return [o, session]; });
    }).then(function (r) {
      var o = r[0];
      var value = readyOf(o, r[1]);
      if (typeof ctx.onReady === 'function') ctx.onReady(value);
      engine.runner.log('device_ready', { value: value });
      // No clip and no phone voice for this language: Jugnu would be silent, so the test does not start.
      if (o.voice !== 'none' || !engine.view || !engine.view.refuse) return;
      var under = running();
      if (under) { waitForEnd(under); return; }
      refuse();
    });
    function refuse() {
      engine.runner.log('voice_not_ready');
      var gate2 = !!(ctx.battery && ctx.battery.ui && ctx.battery.ui.voice_gate_v2 === true) && typeof ctx.again === 'function';
      var retry = gate2 ? function () {
        return Promise.resolve().then(ctx.again).then(null, function () { return { voice: 'none' }; }).then(function (r) {
          r = r || { voice: 'none' };
          engine.runner.log('voice_retry', { value: { voice: r.voice || null, clips_cached: r.clips_cached != null ? r.clips_cached : null } });
          if (r.voice === 'none') return false;
          if (engine.view.unrefuse) engine.view.unrefuse();
          tell(ctx, { type: 'sa:unrefused', s: engine.session_id });
          return true;
        });
      } : null;
      if (retry) engine.view.refuse('voice', { retry: retry }); else engine.view.refuse('voice');
      tell(ctx, { type: 'sa:refused', s: engine.session_id, reason: 'voice' });
    }
  }

  /**
   * worker_swap { from, to, task } (round 28): a newer worker took the page over mid-session (skipWaiting + clients.claim,
   * no reload), so the clips from here on come from its cache. from = the worker before (first: from(), device_ready's sw),
   * to = version(the new controller) or null, task = the task running when it happened, or null between tasks. Data only.
   */
  function swapWatch(engine, container, from, version) {
    if (!container || typeof container.addEventListener !== 'function') return;
    var task = null;
    var last;
    if (typeof engine.on === 'function') {
      engine.on('task_start', function (e) { task = e && e.task_id || null; });
      engine.on('task_end', function () { task = null; });
    }
    container.addEventListener('controllerchange', function () {
      var was = last !== undefined ? last : from();
      var at = task;
      Promise.resolve().then(function () { return version(container.controller); }).then(null, function () { return null; }).then(function (to) {
        last = stamp(to);
        engine.runner.log('worker_swap', { task_id: at || undefined, value: { from: stamp(was), to: last, task: at } });
      });
    });
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

  /** Round 8 item 4: the same form in the other language (sa.coach.G3.A.ur → sa.coach.G3.A.en), or null. */
  function otherForm(form) {
    var m = /^(.+)\.(en|ur)$/.exec(String(form || ''));
    if (!m) return null;
    var l = m[2] === 'ur' ? 'en' : 'ur';
    return { form: m[1] + '.' + l, lang: l };
  }

  /**
   * Round 8 item 4 (sa_r8_lang_switch): the other language's battery for this run, picked and rotated as the run was,
   * or null when it is not the same test (another task list, other items or another passage), so the toggle stays off.
   */
  function langAltOf(run, altFull, block, seed) {
    if (!run || !Array.isArray(run.tasks) || !altFull || !Array.isArray(altFull.tasks)) return null;
    var alt = rotate(pick(altFull, block), seed);
    if (!alt || alt.tasks.length !== run.tasks.length) return null;
    var ids = function (l) { return (l || []).map(function (x) { return x && x.id; }).join('|'); };
    var vid = function (t) { return t.variant ? t.variant.id : null; };
    for (var i = 0; i < run.tasks.length; i++) {
      var a = run.tasks[i], b = alt.tasks[i];
      if (a.id !== b.id || ids(a.items) !== ids(b.items) || vid(a) !== vid(b)) return null;
    }
    return alt;
  }

  /**
   * Round 8 item 4: after this run's own preparation, fetch the other language's battery, keep it (and its clips) on the
   * phone through the offline lane's prepare, and hand it to the screens, which then show the toggle. Not reachable
   * (offline and never kept), or not the same test: no toggle, the run as before.
   */
  function langAltLoad(SAE, p, run, after, engine) {
    var o = otherForm(p.form);
    if (!o || o.lang === p.lang || !engine.view || typeof engine.view.langBattery !== 'function') return Promise.resolve(null);
    var url = '/sa/batteries/' + o.form + '.json';
    var doc = root.document;
    return Promise.resolve(after).then(null, function () {}).then(function () {
      return root.fetch(url, { cache: 'no-cache' });
    }).then(function (r) {
      if (!r.ok) throw new Error('battery ' + r.status);
      return r.json();
    }).then(function (full) {
      var alt = langAltOf(run, full, p.block, p.session_id);
      if (!alt) return null;
      var keep = SAE.offline && SAE.offline.prepare
        ? SAE.offline.prepare({ battery_url: url, battery: alt, lang: o.lang, base: '/' }).then(null, function () { return { ready: false }; })
        : Promise.resolve({ ready: true });
      return keep.then(function (k) {
        // offline without its pictures: a picture task in that language would have nothing to tap
        if (!(k && k.ready) && root.navigator && root.navigator.onLine === false) return null;
        engine.view.langBattery(o.lang, SAE.core && SAE.core.normalize ? SAE.core.normalize(alt) : alt, {
          onSwitch: function (l) { doc.documentElement.lang = l; doc.documentElement.dir = l === 'ur' ? 'rtl' : 'ltr'; },
        });
        return o.lang;
      });
    }).then(null, function () { return null; });
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
   *        this page runs), online, timers, onProgress (the sync's: each server answer, the bytes of an upload) }
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
          var sy = o.sync.create({ store: o.store, sink: sink, session_id: id, online: o.online, timers: o.timers, onProgress: o.onProgress });
          return sy.flush().then(function (st) {
            if (sy.stop) sy.stop();
            out.push({ s: id, state: st.state, pending_events: st.pending_events, pending_audio: st.pending_audio });
          });
        });
      }, Promise.resolve()).then(function () { return out; });
    });
  }

  var PROGRESS_EVERY_MS = 1000;
  /**
   * The drain page (/sa/play.html?drain=1&embed=1): no screen, no session; drain, then tell the coach page once.
   * While it works it tells the coach page {type:'sa:drain_progress', acks, bytes} on each server answer and, at most
   * once a second, as an upload's bytes go out, so a slow upload that is moving is never cut.
   */
  function bootDrain(SAE, p) {
    var store = SAE.store;
    var sink = function () { return SAE.sinks.coach(); };
    var tell = p.embed && root.parent && root.parent !== root;
    var acks = 0;
    var bytes = 0;
    var last = 0;
    var onProgress = !tell ? null : function (kind, n) {
      if (kind === 'ack') acks += 1; else bytes = n;
      var now = Date.now();
      if (kind !== 'ack' && now - last < PROGRESS_EVERY_MS) return;
      last = now;
      root.parent.postMessage({ type: 'sa:drain_progress', acks: acks, bytes: bytes }, root.location.origin);
    };
    return store.open().then(function (st) {
      return drain({ store: st, sync: SAE.sync, sink: sink, onProgress: onProgress });
    }).then(function (sessions) { return sessions; }, function () { return []; }).then(function (sessions) {
      if (tell) {
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
      // The device's readiness (RULING #14, #11, #51): the part's battery and clips on the phone, a voice for the
      // language, storage kept. SAE.prepare (car 4b) answers voice 'clips' | 'tts' | 'none'.
      // RULING W3-18 (sa_voice_gate_v2): the opening lines' prefetch, which the engine waits for (capped) before
      // Jugnu's first words; the whole preparation ending counts too.
      var linesDone = null;
      var opening = battery.ui && battery.ui.voice_gate_v2 === true ? new Promise(function (ok) { linesDone = ok; }) : null;
      var offline = prepareOf(SAE, battery, p.lang, url, linesDone);
      return root.SAE.start({
        mount: mount, battery: battery, mode: p.mode, lang: p.lang, sink: sink, session_id: p.session_id,
        child: p.first_name ? { first_name: p.first_name } : null, back: p.back, embed: p.embed,
        manual: manualOf(full, p.block), whole: wholeOf(p.block), opening: opening ? Promise.race([opening, offline]) : null,
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
        var served = null;
        voiceGate(engine, offline, { win: root, embed: p.embed, battery: battery, again: function () { return prepareOf(SAE, battery, p.lang, url); },
          onReady: function (v) { served = v.sw; } });
        if (SAE.offline && SAE.offline.version) swapWatch(engine, root.navigator && root.navigator.serviceWorker, function () { return served; }, SAE.offline.version);
        if (battery.ui && battery.ui.r8_lang_switch === true) langAltLoad(SAE, p, battery, offline, engine);
        root.addEventListener('offline', function () { engine.runner.log('offline'); });
        root.addEventListener('online', function () { engine.runner.log('online'); });
        return engine;
      });
    }).catch(function () {
      fail(mount, p.lang === 'ur' ? 'ابھی کھل نہیں سکا۔ کوچ سے کہیں کہ دوبارہ کھولیں۔' : 'This did not open. Ask the coach to open it again.');
    });
  }

  return { VERSION: VERSION, otherForm: otherForm, langAltOf: langAltOf, langAltLoad: langAltLoad, params: params, pick: pick, manualOf: manualOf, wholeOf: wholeOf, rotate: rotate, prepareOf: prepareOf, voiceGate: voiceGate, swapWatch: swapWatch, deferrable: deferrable, clipPrompted: clipPrompted, lockDown: lockDown, drain: drain, bootDrain: bootDrain, boot: boot };
}));
