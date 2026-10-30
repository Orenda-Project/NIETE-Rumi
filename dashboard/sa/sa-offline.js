/**
 * The page's side of the battery's offline copy (switch sa_engine): registers /sa/sw.js (scope /sa/) and asks it to
 * keep this session's battery file and Jugnu's clips for this language, then says whether the phone can lose the
 * network now.
 *
 *   SAE.offline.urls(battery, lang, base) → the clip URLs the session can play
 *   SAE.offline.lineUrls(battery, lang, base) → the clips of the engine's own lines (battery.lines), asked for first
 *   SAE.offline.images(battery, lang) → the picture URLs the session shows (option_images, script.demo_image)
 *   SAE.offline.prepare({ battery_url, battery, lang, base }) → Promise<{ ready, battery, clips, clips_missing, images,
 *     images_missing, why? }>
 *     ready = the engine files, the battery and its pictures are on the phone (a picture task offline has nothing to
 *     tap without them); a clip not on the phone is spoken by the phone's own voice instead (clips_missing counts
 *     them), so it never blocks "ready".
 *   SAE.prepare(battery, { lang, battery_url, base }) → Promise<{ clips_total, clips_cached, voice, persisted, ready,
 *     battery, why? }> — the voice-readiness gate (RULING #14): voice 'clips' when every clip of the session is on the
 *     phone, else 'tts' when the phone has a voice in the session's language, else 'none' (the surface refuses the
 *     start). It asks for persistent storage (RULING #11) and keeps sa:voice / sa:persisted for the sink's batch.
 *   SAE.offline.prepVisit({ forms, part?, fresh?, paused?, onProgress?, chunk? }) → Promise<{ ok, total, cached, missing, bytes,
 *     forms, why? }>
 *     round 8 (switches sa_r8_offline_prep / sa_r8_offline_first, the coach page, while online): every listed battery
 *     (sa.coach.G3.A.ur …) read fresh, then every clip in its language and every picture, onProgress({ done, total,
 *     bytes }) after each chunk. part { block, seed }: only what that child's page runs (the page's pick + rotate,
 *     partOf), so a Start waits for one part, not the whole battery. Jugnu's pictures (ART) come too. A started test
 *     then needs no network. fresh: false keeps a battery already on the phone (no re-read); paused() holds the next
 *     chunk while it says true (a background download giving the line to the Start gate).
 *   SAE.offline.checkVisit({ forms }) → Promise<{ ready, total, cached, why? }>: the same files, looked up on the phone
 *     only (nothing fetched).
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

  /** The clip URLs of the engine's own lines (battery.lines) for this language. */
  function lineUrls(battery, lang, base) { return urls({ lines: battery && battery.lines }, lang, base); }

  /** The opening's clips (RULING W3-18): the welcome, the sound check and its help line, and the check words. */
  var OPENING = ['welcome', 'audio_check', 'audio_fail'];
  function openingUrls(battery, lang, base) {
    var l = (battery && battery.lines) || {};
    var pick = {};
    OPENING.forEach(function (k) { if (l[k]) pick[k] = l[k]; });
    return urls({ lines: pick, check_words: battery && battery.check_words }, lang, base);
  }

  var IMG_RX = /^[A-Za-z0-9_./-]+$/;

  /** Every picture in the battery for this language, as URLs from the site root (the way sa-ui.js shows them). */
  function images(battery, lang) {
    var out = {};
    function add(p) {
      if (typeof p !== 'string' || !IMG_RX.test(p) || p.indexOf('..') >= 0) return;
      out['/' + p.replace(/^\/+/, '')] = true;
    }
    ((battery && battery.tasks) || []).forEach(function (t) {
      var o = t && t.option_images;
      if (o && typeof o === 'object') Object.keys(o).forEach(function (k) { add(o[k]); });
      var d = t && t.script && t.script.demo_image;
      if (d && typeof d === 'object') d = d[lang] || d.en || d.ur;
      add(d);
    });
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

  var UPDATE_WAIT_MS = 10000;
  // "Get ready" and its check: an update() still unanswered after this is "not ready" (worker_update_pending), never "none"
  var VISIT_UPDATE_WAIT_MS = 30000;
  /** pending when update() did not answer in time: a new worker may still be on its way. */
  var UNANSWERED = { state: 'update_unanswered' };

  /**
   * reg.update(), then the new worker it finds (or one already installing), followed until it is active, for up to
   * ACTIVE_WAIT_MS. register() with the same script URL never looks for a new worker, so a phone on the previous SESSION
   * used to prepare into the old worker's cache, which the new worker deletes when it activates on the first online child
   * start. → { reg, pending }: pending = that new worker when it is still not active at the bound or its install failed
   * (redundant); null offline (update rejects) or with no new worker. An update check that takes over UPDATE_WAIT_MS gives
   * null for the child page (the active worker as before) and, with strict (Get ready, its check), UNANSWERED after
   * VISIT_UPDATE_WAIT_MS: a slow answer is unknown, and work given to the old worker meanwhile keeps the new one from
   * activating.
   */
  function updated(reg, strict) {
    return new Promise(function (ok) {
      var done = false;
      var found = null;
      var t;
      function finish() { if (done) return; done = true; clearTimeout(t); ok({ reg: reg, pending: found && reg.active !== found ? found : null }); }
      function follow(w) {
        found = w;
        clearTimeout(t);
        t = setTimeout(finish, ACTIVE_WAIT_MS);
        if (w.state === 'activated' || w.state === 'redundant') return finish();
        w.addEventListener('statechange', function () { if (w.state === 'activated' || w.state === 'redundant') finish(); });
      }
      var now = reg.installing || reg.waiting;
      if (now && typeof now.addEventListener === 'function') return follow(now);
      t = setTimeout(function () {
        if (strict && !found) { done = true; return ok({ reg: reg, pending: UNANSWERED }); }
        finish();
      }, strict ? VISIT_UPDATE_WAIT_MS : UPDATE_WAIT_MS);
      Promise.resolve().then(function () { return reg.update(); }).then(function () {
        if (done) return;
        var w = reg.installing || reg.waiting;
        if (!w || typeof w.addEventListener !== 'function') return finish();
        follow(w);
      }, finish);
    });
  }

  /** Why "ready for offline" waits: the new worker is still installing, or its install failed. */
  function pendingWhy(w) { return w.state === 'redundant' ? 'worker_update_failed' : 'worker_update_pending'; }

  /**
   * The engine's registration, without waiting on the network: register() fetches the worker's script, so with no signal it
   * rejects even when the worker is installed and every file is on the phone (round 8, the school with no signal). An
   * active registration is updated first (updated(); out.pending tells the caller a new worker is not active yet); a
   * phone with none registers first.
   */
  function registration(sw, out) {
    var opts = { scope: '/sa/' };
    var fresh = function () { return sw.register('/sa/sw.js', opts); };
    var have = typeof sw.getRegistration === 'function' ? Promise.resolve().then(function () { return sw.getRegistration('/sa/'); }).then(null, function () { return null; }) : Promise.resolve(null);
    return have.then(function (reg) {
      if (reg && reg.active) {
        if (typeof reg.update === 'function') return updated(reg, !!out).then(function (u) { if (out) out.pending = u.pending; return u.reg; });
        Promise.resolve().then(fresh).then(null, function () { /* offline: the installed worker serves */ });
        return reg;
      }
      return fresh();
    });
  }

  function prepare(o) {
    var nav = root.navigator;
    if (!nav || !nav.serviceWorker) return Promise.resolve({ ready: false, why: 'no_service_worker' });
    var clips = urls(o.battery, o.lang, o.base);
    // The opening (the welcome, the sound check and its help line, the check words) plays from the first second: it is
    // its own first list, then the engine's other lines, then the task clips (still six at a time on a busy tunnel).
    var open = openingUrls(o.battery, o.lang, o.base).filter(function (u) { return clips.indexOf(u) >= 0; });
    var first = lineUrls(o.battery, o.lang, o.base).filter(function (u) { return open.indexOf(u) < 0; });
    var rest = clips.filter(function (u) { return open.indexOf(u) < 0 && first.indexOf(u) < 0; });
    var pics = images(o.battery, o.lang);
    return registration(nav.serviceWorker)
      .then(function (reg) { return reg && reg.active ? reg : nav.serviceWorker.ready; })
      .then(function (reg) {
        var sw = reg.active || nav.serviceWorker.controller;
        if (!sw) return { ready: false, why: 'no_active_worker' };
        var list = [o.battery_url].filter(Boolean);
        var none = { ok: true, missing: [] };
        var opened = open.length ? ask(sw, { type: 'prepare', urls: open }) : Promise.resolve(none);
        // The opening is on the phone (or given up on): the page may speak it now (o.onLines, RULING W3-18).
        if (typeof o.onLines === 'function') opened.then(function () { o.onLines(); }, function () { o.onLines(); });
        var said = opened.then(function () { return first.length ? ask(sw, { type: 'prepare', urls: first }) : none; });
        var then = said.then(function () { return ask(sw, { type: 'prepare', urls: rest }); });
        return Promise.all([said, ask(sw, { type: 'prepare', urls: list }), then, ask(sw, { type: 'prepare', urls: pics }), opened]).then(function (r) {
          var core = r[1] || { ok: false, missing: list };
          var audio = { missing: (r[4] || { missing: open }).missing.concat((r[0] || { missing: first }).missing, (r[2] || { missing: rest }).missing) };
          var img = r[3] || { ok: false, missing: pics };
          var ready = !!core.ok && img.missing.length === 0;
          return { ready: ready, battery: !!core.ok, clips: clips.length - audio.missing.length, clips_missing: audio.missing.length,
            images: pics.length - img.missing.length, images_missing: img.missing.length,
            why: !core.ok ? 'battery_not_cached' : (ready ? undefined : 'images_not_cached') };
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
      Promise.resolve().then(function () { return off({ battery_url: o.battery_url, battery: battery, lang: lang, base: o.base, onLines: o.onLines }); }).then(null, function () { return null; }),
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

  /**
   * partOf(battery, block, seed) → the battery the child's page runs for this block and session: sa-page.js pick() then
   * rotate(), mirrored here because that file boots itself in any page that loads it. The tests pin the two equal
   * (dashboard/tests/sa-r8-offline-prep.service.test.js), so a change there fails here until it is mirrored.
   */
  function partOf(battery, block, seed) {
    return rotatePart(pickPart(battery, block), seed);
  }
  function pickPart(battery, block) {
    var want = null;
    var caps = null;
    if (block && block !== 'full') {
      if (block === 'tower' && Array.isArray(battery.tower)) want = battery.tower;
      else if (block === 'rdf' && Array.isArray(battery.rdf)) { want = battery.rdf; caps = battery.rdf_items || null; }
      else if ((block === 'rdf_auto' || block === 'rdf_manual') && Array.isArray(battery[block])) want = battery[block];
      else if (battery.blocks && Array.isArray(battery.blocks[block])) want = battery.blocks[block];
      else if (battery.islands && Array.isArray(battery.islands[block])) want = battery.islands[block];
    }
    if (!want && Array.isArray(battery.full) && battery.full.length < battery.tasks.length) want = battery.full;
    if (!want) return battery;
    var out = {};
    for (var k in battery) if (Object.prototype.hasOwnProperty.call(battery, k)) out[k] = battery[k];
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
      for (var j in t) if (Object.prototype.hasOwnProperty.call(t, j)) c[j] = t[j];
      if (orphan) delete c.depends_on;
      if (rule > 0 || (rule && Array.isArray(rule.drop))) {
        c.items = keepItems(t.items, rule);
        if (Array.isArray(t.variants)) c.variants = t.variants.map(function (v) { var w = {}; for (var x in v) if (Object.prototype.hasOwnProperty.call(v, x)) w[x] = v[x]; w.items = keepItems(v.items, rule); return w; });
      }
      return c;
    });
    out.battery_id = battery.battery_id + (block && block !== 'full' ? '#' + block : '');
    return out.tasks.length ? out : battery;
  }
  function hashOf(s) {
    var x = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
    return x;
  }
  function rotatePart(battery, seed) {
    if (!battery || !Array.isArray(battery.tasks) || !battery.tasks.some(function (t) { return Array.isArray(t.variants) && t.variants.length; })) return battery;
    var h = hashOf(String(seed || ''));
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

  /** Jugnu's pictures on the child's screens (sa-ui.js art_base '/wq/' + 'jugnu_' + mood): the worker keeps /wq/ too. */
  var ART = ['celebrate', 'correct', 'hello', 'idle', 'notyet', 'sleep', 'thinking'].map(function (m) { return '/wq/jugnu_' + m + '.webp'; });

  var FORM_NAME_RX = /^sa\.(coach|game)\.[A-Za-z0-9]+(\.[A-Za-z0-9]+)?\.(en|ur)$/;
  var CHUNK = 24;
  var ACTIVE_WAIT_MS = 30000;

  /**
   * The engine's worker, active, as an ask(msg) → Promise<reply>. A page outside /sa/ (the coach page) is never
   * controlled by it, so serviceWorker.ready would never resolve there: wait on the registration's own worker instead.
   */
  function workerAsk(out) {
    var nav = root.navigator;
    if (!nav || !nav.serviceWorker || !root.MessageChannel) return Promise.resolve(null);
    return registration(nav.serviceWorker, out).then(function (reg) {
      if (out) out.reg = reg;
      if (reg.active) return reg.active;
      var w = reg.installing || reg.waiting;
      if (!w) return null;
      return new Promise(function (ok) {
        var t = setTimeout(function () { ok(reg.active || null); }, ACTIVE_WAIT_MS);
        w.addEventListener('statechange', function () {
          if (w.state === 'activated' || reg.active) { clearTimeout(t); ok(reg.active || w); }
          else if (w.state === 'redundant') { clearTimeout(t); ok(reg.active || null); }
        });
      });
    }).then(function (sw) {
      if (out) out.sw = sw;
      return sw ? function (msg) { return ask(sw, msg); } : null;
    }, function () { return null; });
  }

  /**
   * After the work: a worker newer than the one it went to (installing, waiting, or already active) deletes that worker's
   * SESSION cache when it takes over, so what was just kept will not stay. An update() that answered "none" while another
   * page's update was about to find one ends here.
   */
  function replaced(out) {
    var r = out && out.reg;
    if (!r || !out.sw) return false;
    return !!(r.installing || r.waiting || (r.active && r.active !== out.sw));
  }

  /** A worker newer than the one the work goes to (installing, waiting, or another active one), else null. */
  function newerOf(upd) {
    var r = upd && upd.reg;
    if (!r || !upd.sw) return null;
    return r.installing || r.waiting || (r.active && r.active !== upd.sw ? r.active : null);
  }

  /**
   * Wait (up to ACTIVE_WAIT_MS) for the newer worker w to take over → { turn, sw } (start again on it), or { turn, why } when
   * it did not activate in time or its install failed.
   */
  function settle(upd, w) {
    var r = upd.reg;
    function now() { return r.active && r.active !== upd.sw && r.active.state === 'activated' ? r.active : null; }
    return new Promise(function (ok) {
      if (now()) return ok({ turn: true, sw: now() });
      if (w.state === 'redundant') return ok({ turn: true, why: pendingWhy(w) });
      var t = setTimeout(function () { ok(now() ? { turn: true, sw: now() } : { turn: true, why: pendingWhy(w) }); }, ACTIVE_WAIT_MS);
      if (typeof w.addEventListener !== 'function') return;
      w.addEventListener('statechange', function () {
        if (w.state === 'activated' || now()) { clearTimeout(t); ok({ turn: true, sw: now() || w }); }
        else if (w.state === 'redundant') { clearTimeout(t); ok({ turn: true, why: pendingWhy(w) }); }
      });
    });
  }

  /**
   * q, checked before EVERY message: while a newer worker exists nothing is posted; the call waits for it (settle) and
   * rejects with the turn, so the caller starts again on the new worker or answers not ready.
   */
  function guarded(q, upd) {
    return function (msg) {
      var w = newerOf(upd);
      if (!w) return q(msg);
      return settle(upd, w).then(function (turn) { throw turn; });
    };
  }

  /**
   * run(q) once, and again on the new worker when one takes over mid-way (what the old one kept goes with it), at most
   * twice; a newer worker that does not activate → failed(why).
   */
  function onWorker(q, upd, run, failed) {
    var turns = 0;
    function again(e) {
      if (!e || !e.turn) throw e;
      if (e.why || !e.sw || turns++ >= 2) return failed(e.why || 'worker_update_pending');
      upd.sw = e.sw;
      return run(guarded(function (msg) { return ask(e.sw, msg); }, upd)).then(null, again);
    }
    return run(guarded(q, upd)).then(null, again);
  }

  /** A kept battery file (the worker's copy), else null. */
  function readKept(url) {
    var c = root.caches;
    if (!c || typeof c.match !== 'function') return Promise.resolve(null);
    return c.match(url, { ignoreSearch: true }).then(function (r) { return r ? r.json() : null; }).then(null, function () { return null; });
  }

  function formsOf(list) {
    var seen = {};
    return (list || []).filter(function (f) {
      if (typeof f !== 'string' || !FORM_NAME_RX.test(f) || seen[f]) return false;
      seen[f] = true;
      return true;
    });
  }
  function langOf(form) { return /\.en$/.test(form) ? 'en' : 'ur'; }
  function batteryUrl(form) { return '/sa/batteries/' + form + '.json'; }
  /** A battery's own files on the phone: every clip in its language and every picture (of one part when given). */
  function filesOf(battery, form, part) {
    var l = langOf(form);
    var b = part && typeof part === 'object' ? partOf(battery, part.block || null, part.seed || '') : battery;
    return urls(b, l, '/').concat(images(b, l));
  }

  /** prepVisit — see the header. o.ask / o.readBattery are injected by tests. */
  function prepVisit(o) {
    o = o || {};
    var forms = formsOf(o.forms);
    var size = o.chunk > 0 ? o.chunk : CHUNK;
    var progress = typeof o.onProgress === 'function' ? o.onProgress : function () {};
    var read = o.readBattery || readKept;
    var bats = forms.map(batteryUrl);
    var upd = {};
    return (o.ask ? Promise.resolve(o.ask) : workerAsk(upd)).then(function (q) {
      if (!q) return { ok: false, total: 0, cached: 0, missing: 0, bytes: 0, forms: [], why: 'no_service_worker' };
      // a new worker that is not active yet would delete what goes into this one: not ready, the next press waits again
      if (upd.pending) return { ok: false, total: 0, cached: 0, missing: 0, bytes: 0, forms: [], why: pendingWhy(upd.pending) };
      return onWorker(q, upd, function (q) { return prepOn(q, o, forms, bats, size, progress, read, upd); },
        function (why) { return { ok: false, total: 0, cached: 0, missing: 0, bytes: 0, forms: [], why: why }; });
    }).then(null, function (e) { return { ok: false, total: 0, cached: 0, missing: 0, bytes: 0, forms: [], why: String(e && e.message || e) }; });
  }

  /** One pass of prepVisit through q (one worker); a turn (newer worker) rejects out of it. */
  function prepOn(q, o, forms, bats, size, progress, read, upd) {
    var bytes = 0;
    var missingSet = {};
    // fresh: false (the Start gate after a warm-up): a battery on the phone is not read again
    return q(o.fresh === false ? { type: 'prepare', urls: bats } : { type: 'prepare', urls: bats, fresh: bats }).then(function (r) {
      r = r || { missing: bats };
      bytes += r.bytes || 0;
      (r.missing || []).forEach(function (u) { missingSet[u] = true; });
      return Promise.all(bats.map(function (u) { return Promise.resolve().then(function () { return read(u); }).then(null, function () { return null; }); }));
    }).then(function (batteries) {
      var per = forms.map(function (f, i) { return { form: f, files: [bats[i]].concat(batteries[i] ? filesOf(batteries[i], f, o.part) : []), read: !!batteries[i] }; });
      var all = [];
      var inAll = {};
      per.forEach(function (p) { p.files.slice(1).forEach(function (u) { if (!inAll[u]) { inAll[u] = true; all.push(u); } }); });
      // Jugnu's pictures, once for the visit (without them the screens show no Jugnu offline)
      if (forms.length) ART.forEach(function (u) { if (!inAll[u]) { inAll[u] = true; all.push(u); } });
      var total = bats.length + all.length;
      var done = bats.length;
      progress({ done: done, total: total, bytes: bytes });
      var chunks = [];
      for (var i = 0; i < all.length; i += size) chunks.push(all.slice(i, i + size));
      // paused() (the coach page's Start gate is downloading a child's part): no new chunk until it says false
      var held = typeof o.paused === 'function' ? o.paused : null;
      var waitMs = o.pauseMs > 0 ? o.pauseMs : 400;
      var whileHeld = function () {
        if (!held || !held()) return Promise.resolve();
        return new Promise(function (ok) { setTimeout(ok, waitMs); }).then(whileHeld);
      };
      return chunks.reduce(function (chain, c) {
        return chain.then(whileHeld).then(function () { return q({ type: 'prepare', urls: c }); }).then(function (r) {
          r = r || { missing: c };
          bytes += r.bytes || 0;
          (r.missing || []).forEach(function (u) { missingSet[u] = true; });
          done += c.length;
          progress({ done: done, total: total, bytes: bytes });
        });
      }, Promise.resolve()).then(function () {
        var missing = Object.keys(missingSet).length;
        var out = per.map(function (p) {
          var m = p.files.filter(function (u) { return missingSet[u]; }).length;
          return { form: p.form, ok: p.read && m === 0, files: p.files.length, missing: m };
        });
        var res = { ok: missing === 0 && out.every(function (f) { return f.ok; }), total: total, cached: total - missing, missing: missing, bytes: bytes, forms: out };
        // a newer worker is the reason, ahead of any file count: what this one kept goes when it takes over
        if (replaced(upd)) { res.ok = false; res.why = 'worker_update_pending'; }
        return res;
      });
    });
  }

  /** checkVisit — see the header. Never fetches: a battery not kept counts as its own file missing. */
  function checkVisit(o) {
    o = o || {};
    var forms = formsOf(o.forms);
    var read = o.readBattery || readKept;
    var upd = {};
    return (o.ask ? Promise.resolve(o.ask) : workerAsk(upd)).then(function (q) {
      if (!q) return { ready: false, total: 0, cached: 0, why: 'no_service_worker' };
      if (upd.pending) return { ready: false, total: 0, cached: 0, why: pendingWhy(upd.pending) };
      return onWorker(q, upd, function (q) { return checkOn(q, o, forms, read, upd); },
        function (why) { return { ready: false, total: 0, cached: 0, why: why }; });
    }).then(null, function (e) { return { ready: false, total: 0, cached: 0, why: String(e && e.message || e) }; });
  }

  /** One pass of checkVisit through q (one worker). */
  function checkOn(q, o, forms, read, upd) {
    return Promise.all(forms.map(function (f) { return Promise.resolve().then(function () { return read(batteryUrl(f)); }).then(null, function () { return null; }); }))
      .then(function (batteries) {
        var want = [];
        var seen = {};
        forms.forEach(function (f, i) {
          [batteryUrl(f)].concat(batteries[i] ? filesOf(batteries[i], f, o.part) : []).forEach(function (u) { if (!seen[u]) { seen[u] = true; want.push(u); } });
        });
        if (forms.length) ART.forEach(function (u) { if (!seen[u]) { seen[u] = true; want.push(u); } });
        var chunks = [];
        for (var i = 0; i < want.length; i += 200) chunks.push(want.slice(i, i + 200));
        return Promise.all(chunks.map(function (c) { return q({ type: 'check', urls: c }); })).then(function (rs) {
          var missing = 0;
          rs.forEach(function (r, i) { missing += r ? (r.missing || []).length : chunks[i].length; });
          var ready = want.length > 0 && missing === 0 && batteries.every(Boolean);
          if (replaced(upd)) return { ready: false, total: want.length, cached: want.length - missing, why: 'worker_update_pending' };
          return { ready: ready, total: want.length, cached: want.length - missing };
        });
      });
  }

  return { urls: urls, lineUrls: lineUrls, openingUrls: openingUrls, images: images, prepare: prepare, prepareSession: prepareSession, hasVoice: hasVoice,
    prepVisit: prepVisit, checkVisit: checkVisit, partOf: partOf, ART: ART };
}));
