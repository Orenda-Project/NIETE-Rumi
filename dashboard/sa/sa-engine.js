/**
 * The battery engine's one door for a surface (switch sa_engine): SAE.start({ mount, battery, mode, lang, sink, … })
 * → engine. Joins the runner (sa-core), the phone's store (sa-store), the voice (sa-voice), the screens (sa-ui) and,
 * when loaded, the sync (sa-sync) and the recorder (sa-rec).
 *
 *   mount       the surface's element; the engine draws its screens inside it and nothing else
 *   battery     the content lane's battery file (sa.<form>.<lang>.json; sa-core normalize/validate)
 *   mode        'proctored' (coach) | 'game' (Jugnu)
 *   lang        'en' | 'ur'
 *   sink        the surface's server side (sa-sync): putBatch, presignAudio, registerAudio — optional
 *   session_id  the surface's id for this child's run (a reload with the same id resumes it); default a new uuid
 *   audio_base  where the battery's audio keys (sa/v1/<lang>/<sha1>.mp3) resolve (default '/')
 *   onEvent     every logged event, after it is on the phone
 *
 * engine.on(name, fn) for: state (every frame: the view), correct, incorrect, practice_feedback, task_start, task_end,
 * battery_end, audio ({speaking, text}), sync (the status). engine.mute(b) in game mode only. engine.destroy().
 * Every event is written to the store in order, with the reload snapshot; a write never blocks a tap, and pagehide
 * waits on nothing (IndexedDB commits what it was given).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else { root.SAE = root.SAE || {}; root.SAE.start = factory(root).start; }
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  function uuid() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }

  /**
   * The phone goes back to the coach (or the game's map): embedded in the coach page's iframe, tell the parent
   * ({type:'sa:done', s, reason}: 'complete', or 'coach_end' when the coach ended any task); else go to back.
   */
  function done(win, opts, sessionId, runner) {
    var ended = runner.results().some(function (r) { return r.stop_reason === 'coach_end'; });
    var msg = { type: 'sa:done', s: sessionId, reason: ended ? 'coach_end' : 'complete' };
    if (opts.embed && win.parent && win.parent !== win) {
      win.parent.postMessage(msg, win.location.origin);
      return 'posted';
    }
    if (opts.back && win.location) { win.location.assign(opts.back); return 'navigated'; }
    return null;
  }

  var HOOK = { item_correct: 'correct', item_incorrect: 'incorrect', task_start: 'task_start', task_end: 'task_end', battery_end: 'battery_end' };

  /** start(opts) → Promise<engine>. deps (tests): { core, store, ui, voice, sync, rec, now }. */
  function start(opts, deps) {
    var SAE = root.SAE || {};
    deps = deps || {};
    var core = deps.core || SAE.core;
    var storeMod = deps.store || SAE.store;
    var ui = deps.ui || SAE.ui;
    var voiceMod = deps.voice || SAE.voice;
    var syncMod = deps.sync || SAE.sync || null;
    var recMod = deps.rec || SAE.rec || null;
    var now = deps.now || function () { return (root.performance && root.performance.now) ? root.performance.now() : Date.now(); };
    var mode = opts.mode === 'game' ? 'game' : 'proctored';
    var lang = opts.lang === 'en' ? 'en' : 'ur';
    core.validate(opts.battery);
    var battery = core.normalize(opts.battery);
    var sessionId = opts.session_id || uuid();
    var hooks = {};
    function fire(name, v) { (hooks[name] || []).slice().forEach(function (fn) { try { fn(v); } catch (_) { /* a skin's bug never stops the test */ } }); }

    return storeMod.open(deps.idb !== undefined ? { idb: deps.idb } : undefined).then(function (store) {
      return store.getSession(sessionId).then(function (prev) {
        var resume = prev && prev.snapshot && !prev.snapshot.ended && prev.battery_id === (battery.battery_id || null) ? prev.snapshot : null;
        var writes = Promise.resolve();
        var runner;
        var sync = null;
        function write(fn) { writes = writes.then(fn).catch(function (e) { fire('store_error', e); }); return writes; }

        function onEvent(e) {
          var snap = runner ? runner.snapshot() : null;
          write(function () {
            var jobs = [store.appendEvent(e)];
            if (e.type === 'task_end') jobs.push(store.putResult(sessionId, e.value));
            if (snap) jobs.push(store.putSession({ session_id: sessionId, battery_id: battery.battery_id || null, mode: mode, lang: lang, snapshot: snap, ended: snap.ended, updated_at: new Date().toISOString() }));
            return Promise.all(jobs);
          }).then(function () { if (opts.onEvent) opts.onEvent(e); if (sync) sync.poke(); });
          if (HOOK[e.type]) fire(HOOK[e.type], e);
        }

        runner = core.createRunner({ battery: battery, now: now, session_id: sessionId, resume: resume, onEvent: onEvent, audio_check: !resume && opts.audio_check !== false, warmup: !resume && opts.warmup !== false });
        var voice = voiceMod.create({ lang: lang, base: opts.audio_base || '/', muted: false, onSpeak: function (s) { fire('audio', s); } });
        if (syncMod && opts.sink) {
          sync = syncMod.create({ store: store, sink: opts.sink, session_id: sessionId, onStatus: function (s) { fire('sync', s); } });
        }
        // The microphone: asked once, up front, only when the battery has something to record (the passage, the
        // spoken answers). One recording per passage, one per spoken answer ("<task>/<item>").
        var needsMic = battery.tasks.some(function (t) { return t.mode === 'record' || t.mode === 'oral'; });
        var rec = needsMic && recMod ? recMod.create({ store: store, session_id: sessionId }) : null;
        var micReady = rec ? rec.ready() : Promise.resolve(false);
        function recStart(t, item) {
          if (!rec) return;
          micReady.then(function (ok) {
            if (!ok) { runner.log('mic_unavailable', { task_id: t.id }); return; }
            if (rec.start(item ? t.id + '/' + item.id : t.id)) runner.log('record_start', { task_id: t.id, item_id: item ? item.id : undefined });
          });
        }
        function recStop(t, item) {
          if (!rec) return Promise.resolve(null);
          return rec.stop().then(function (meta) {
            if (meta) runner.log('record_stop', { task_id: t.id, item_id: item ? item.id : undefined, value: { duration_ms: meta.duration_ms, parts: meta.parts } });
            if (sync) sync.poke();
            return meta;
          });
        }
        var view = ui.mount(opts.mount, {
          runner: runner, battery: battery, lang: lang, mode: mode, speak: voice.speak,
          onState: function (v) { fire('state', v); },
          onFeedback: function (f) { fire('practice_feedback', f); },
          onRecordStart: function (t, item) { recStart(t, item); fire('record_start', t); },
          onRecordStop: function (t, item) { recStop(t, item); fire('record_stop', t); },
          onMute: mode === 'game' ? function (b) { voice.setMuted(!!b); } : null,
          child: opts.child || null,
          back: opts.back || null,
          // The hand-back screen's press-and-hold: the phone is the coach's again (or the game's map).
          onUnlock: function () {
            runner.log('handover_out');
            writes.then(function () { return sync ? sync.flush() : null; }).then(function () {
              fire('unlock', null);
              done(deps.win || root, opts, sessionId, runner);
            });
          },
          onHandover: function () { runner.log('handover_in'); },
        });
        if (sync && view && view.setSync) hooks.sync = [function (st) { view.setSync(st); }];
        if (prev === null) write(function () { return store.putSession({ session_id: sessionId, battery_id: battery.battery_id || null, mode: mode, lang: lang, snapshot: null, ended: false, created_at: new Date().toISOString() }); });

        return {
          session_id: sessionId,
          resumed: !!resume,
          view: view,
          runner: runner,
          store: store,
          on: function (name, fn) { (hooks[name] = hooks[name] || []).push(fn); return this; },
          off: function (name, fn) { hooks[name] = (hooks[name] || []).filter(function (f) { return f !== fn; }); return this; },
          micReady: micReady,
          mute: function (b) { if (mode === 'game') voice.setMuted(!!b); },
          syncStatus: function () { return sync ? sync.status() : { state: 'local', pending_events: null }; },
          /** Resolves when every event so far is on the phone. */
          flushed: function () { return writes; },
          destroy: function () {
            try { voice.stop(); } catch (_) { /* nothing playing */ }
            if (view && view.destroy) view.destroy();
            if (sync && sync.stop) sync.stop();
            if (rec) { rec.stop(); rec.release(); }
            hooks = {};
          },
        };
      });
    });
  }

  return { start: start, done: done };
}));
