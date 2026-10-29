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
 * battery_end, audio ({speaking, text}), silent ({text, lang}: a clip failed twice, the words stay on screen), sync (the status). engine.mute(b) in game mode only. engine.destroy().
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
  function done(win, opts, sessionId, runner, onWait) {
    var ended = runner.results().some(function (r) { return r.stop_reason === 'coach_end'; });
    var msg = { type: 'sa:done', s: sessionId, reason: ended ? 'coach_end' : 'complete' };
    if (opts.embed && win.parent && win.parent !== win) {
      win.parent.postMessage(msg, win.location.origin);
      return 'posted';
    }
    if (opts.back && win.location) {
      if (opts.mode === 'game' && typeof win.fetch === 'function') { backWhenThere(win, opts.back, onWait); return 'waiting'; }
      win.location.assign(opts.back);
      return 'navigated';
    }
    return null;
  }

  /**
   * Game mode: the map is an online page, so go only when it answers (HEAD, no-store; the offline worker's 503 is "not
   * yet"). Offline, the child stays on the last screen and goes on the 'online' event or a re-probe every 10 s, never
   * to the browser's no-internet page. One wait per window, however often the child taps; onWait once, on the first miss.
   */
  var BACK_RETRY_MS = 10000;
  function backWhenThere(win, url, onWait) {
    if (win.__saBackWait) return;
    win.__saBackWait = true;
    var gone = false;
    var told = false;
    var timer = null;
    function probe() {
      if (gone) return;
      clearTimeout(timer);
      Promise.resolve().then(function () { return win.fetch(url, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' }); })
        .then(function (r) { return Boolean(r && r.status < 500); }, function () { return false; })
        .then(function (ok) {
          if (gone) return;
          if (!ok) {
            if (!told && typeof onWait === 'function') { told = true; try { onWait(); } catch (e) { /* the screen */ } }
            timer = setTimeout(probe, BACK_RETRY_MS);
            return;
          }
          gone = true;
          if (win.removeEventListener) win.removeEventListener('online', probe);
          win.location.assign(url);
        });
    }
    if (win.addEventListener) win.addEventListener('online', probe);
    probe();
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
    var micMod = deps.mic || SAE.mic || null;
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
          if (e.type === 'silence_repeat') discardFor = e.task_id;
          if (e.type === 'battery_end') batteryEnd();
          // The game's mic check is kept for this phone (the coach's pre-flight writes the same keys).
          if (e.type === 'mic_check' && micMod) micMod.remember(!!(e.value && e.value.ok), e.value && e.value.rms);
        }
        // The microphone as the runner sees it: the coach's pre-flight or an earlier mic check on this phone; in game
        // mode an unknown phone gets the engine's own mic check, in proctored mode no mic_ok means no recording.
        function micState() {
          var m = micMod ? micMod.state() : 'unknown';
          return m === 'unknown' && mode === 'proctored' ? 'no' : m;
        }

        // Round 7b (sa_silence_repeat): RDF auto listens for a voice on every read-aloud part; a silent attempt's recording
        // is discarded (never uploaded), so the repeat's is the one kept.
        var silenceRepeat = (battery.ui || {}).silence_repeat === true && mode === 'proctored' && opts.manual !== true;
        var discardFor = null;
        // The sandbox-only "Jump to…" (RULING #43): only when the server put SA_DEV_TOOLS = true on the page (it does
        // so only on the sandbox service), and only for the coach.
        var devTools = mode === 'proctored' && (deps.win || root).SA_DEV_TOOLS === true;
        // Wave 3 (the server's switches put battery.ui on the battery; absent, the run is today's): one cell at a time,
        // the passage as printed, and RDF manual (the page passes manual for block rdf_manual; coach mode only).
        var w3 = battery.ui || {};
        var manual = mode === 'proctored' && opts.manual === true;
        runner = core.createRunner({ battery: battery, now: now, session_id: sessionId, resume: resume, onEvent: onEvent, audio_check: !resume && opts.audio_check !== false, warmup: !resume && opts.warmup !== false,
          dev_tools: devTools, mic: deps.micState || micState, mic_check: mode === 'game', oral_practice: opts.oral_practice !== false, keypad_warmup: opts.keypad_warmup !== false,
          one_at_a_time: w3.one_at_a_time === true, manual: manual, comp_all_questions: w3.comp_all_questions === true,
          cell_pace: w3.cell_pace === true, section_recording: w3.section_recording === true, cell_next_only: w3.cell_next_only === true,
          // sa_auto_no_last_word (round 7): RDF auto ends the passage on "I'm done" / time up, with no last-word step.
          skip_last_word: w3.auto_no_last_word === true && mode === 'proctored' && !manual,
          // round 7b (the runner keeps each to its mode: end_section RDF manual; incomplete and silence_repeat RDF auto)
          end_section: w3.end_section === true && mode === 'proctored', incomplete: w3.incomplete_move_on === true && mode === 'proctored',
          silence_repeat: silenceRepeat });
        var voice = voiceMod.create({ lang: lang, base: opts.audio_base || '/', muted: false, onSpeak: function (s) { fire('audio', s); }, onSilent: function (s) { fire('silent', s); },
          // a line held by a hidden page (parked, paused, resumed, gave_up): kept on the session (voice_held)
          onHeld: function (h) { runner.log('voice_held', { task_id: runner.view().task ? runner.view().task.id : undefined, value: { kind: h.kind } }); } });
        if (syncMod && opts.sink) {
          sync = syncMod.create({ store: store, sink: opts.sink, session_id: sessionId, onStatus: function (s) { fire('sync', s); } });
        }
        // The microphone: asked once, up front, only when the battery has something to record (the passage, the
        // spoken answers). One recording per passage, one per spoken answer ("<task>/<item>").
        var needsMic = battery.tasks.some(function (t) { return t.mode === 'record' || t.mode === 'oral'; });
        var rec = needsMic && recMod ? recMod.create({ store: store, session_id: sessionId }) : null;
        var micReady = rec ? rec.ready() : Promise.resolve(false);
        var cancelSilence = null;
        var cancelVoice = null;
        function endVoice() { if (cancelVoice) { try { cancelVoice(); } catch (_) { /* ended */ } cancelVoice = null; } }
        // A recording still open when the phone goes back (the last spoken answer, a coach's early end) is closed
        // first, so its final marker is on the phone before the last flush and it goes up with it.
        function closeRecording() {
          if (!rec || !rec.recording || !rec.recording()) return null;
          if (cancelSilence) { try { cancelSilence(); } catch (_) { /* ended */ } cancelSilence = null; }
          endVoice();
          return Promise.resolve(rec.stop()).then(null, function () { return null; });
        }
        function recStart(t, item) {
          if (!rec) return;
          micReady.then(function (ok) {
            if (!ok) { runner.log('mic_unavailable', { task_id: t.id }); return; }
            if (rec.start(item ? t.id + '/' + item.id : t.id)) runner.log('record_start', { task_id: t.id, item_id: item ? item.id : undefined });
            // The mercy rule on the passage (RULING #10): no voice for 12 s → Jugnu offers the star once; 20 s → the
            // task ends as early_stop_silence. The recorder's watch starts now, with the recording running.
            // sa_cell_pace: a one-at-a-time item waits 3 s after the child's last voice, so the engine hears the voice.
            if (rec.onVoice && ((w3.cell_pace === true && t.mode === 'record' && !item && !t.passage) || (silenceRepeat && t.mode === 'record' && !item))) {
              endVoice();
              cancelVoice = rec.onVoice(function () { runner.voice(); });
            }
            if (t.mode === 'record' && !item && rec.onSilence && !runner.holdsCell()) {
              cancelSilence = rec.onSilence({ after_s: t.mercy_after_s || 12, total_s: t.silence_stop_s || 20 }, function (s) {
                if (s.kind === 'mercy') {
                  runner.mercyOffered();
                  if (view && view.mercy) view.mercy();
                } else if (s.kind === 'ear_unavailable') {
                  runner.earUnavailable();
                } else if (s.kind === 'early_stop_silence') {
                  runner.silence(s.silence_s);
                  recStop(t, null);
                  if (view && view.render) view.render();
                }
              });
            }
          });
        }
        function recStop(t, item) {
          if (cancelSilence) { try { cancelSilence(); } catch (_) { /* ended */ } cancelSilence = null; }
          endVoice();
          if (!rec) return Promise.resolve(null);
          // sa_silence_repeat: the silent attempt's recording never leaves the phone
          if (!item && discardFor && t && discardFor === t.id && rec.discard) {
            discardFor = null;
            return Promise.resolve(rec.discard()).then(function () { if (sync) sync.poke(); return null; }, function () { return null; });
          }
          return rec.stop().then(function (meta) {
            if (meta) runner.log('record_stop', { task_id: t.id, item_id: item ? item.id : undefined, value: { duration_ms: meta.duration_ms, parts: meta.parts } });
            if (sync) sync.poke();
            return meta;
          });
        }
        // sa_coach_last_word: the word heard last in the passage's recording, from the server once the clip is up (it
        // answers pending until then: asked again every few seconds for up to 30 s). null: the coach taps it.
        function lastWordHint(t) {
          if (w3.coach_last_word !== true || !opts.sink || !opts.sink.lastWordHint) return Promise.resolve(null);
          var retryMs = typeof deps.hintRetryMs === 'number' ? deps.hintRetryMs : 3000;
          var tries = Math.ceil(30000 / Math.max(1, retryMs));
          function once(n) {
            return Promise.resolve(sync ? sync.flush() : null).then(null, function () { return null; })
              .then(function () { return opts.sink.lastWordHint({ session_id: sessionId, task_id: t.id }); })
              .then(function (r) {
                if (r && typeof r.index === 'number') return r.index;
                if (r && r.pending && n < tries) return new Promise(function (ok) { setTimeout(ok, retryMs); }).then(function () { return once(n + 1); });
                return null;
              }, function () { return null; });
          }
          return once(1);
        }
        var view = ui.mount(opts.mount, {
          runner: runner, battery: battery, lang: lang, mode: mode, speak: voice.speak,
          check_words: battery.check_words || null,
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
            writes.then(closeRecording).then(function () { return sync ? sync.flush() : null; }).then(function () {
              fire('unlock', null);
              done(deps.win || root, opts, sessionId, runner, function () { if (view && view.backWait) view.backWait(); });
            });
          },
          onHandover: function () { runner.log('handover_in'); },
          devJump: devTools ? function (i) {
            try { voice.stop(); } catch (_) { /* nothing playing */ }
            var t = runner.view().task;
            if (t && rec && rec.recording && rec.recording()) recStop(t, null);
            if (runner.jumpTo(i) && view && view.render) view.render();
          } : undefined,
          // round 8 (battery.ui.r8_ios_mic): the meter's AudioContext made inside the tap, for iPhones
          micProbe: micMod ? function () { return micMod.probe(2000, w3.r8_ios_mic === true ? { ios: true } : undefined); } : null,
          micLevel: micMod ? function (cb) { return micMod.level(cb, w3.r8_ios_mic === true ? { ios: true } : undefined); } : null,
          manual: manual, passage_punct: w3.passage_punct === true, opening: opts.opening || null, section_recording: w3.section_recording === true,
          coach_last_word: w3.coach_last_word === true, lastWordHint: lastWordHint, auto_child_last_word: w3.auto_child_last_word === true,
          app_asks: manual && w3.app_asks === true,
          ur_fit: w3.ur_fit === true,
          embed: opts.embed === true,
        });
        if (sync && view && view.setSync) hooks.sync = [function (st) { view.setSync(st); }];
        // Embedded in the coach page (RULINGs #34a, #48): the last task's end is told at once ({type:'sa:battery_ending',
        // s}: the page drops its corner hold and shows "Next child" as sending), the recording is closed, the events and
        // results go up ahead of the audio, and {type:'sa:battery_end', s} follows once the server has them (the page
        // enables "Next child", the child is complete). A failed send (offline) still ends it: the rows stay queued.
        var ended = null;
        function batteryEnd() {
          var w = deps.win || root;
          if (ended || !opts.embed || !w.parent || w.parent === w || !w.location) return;
          var post = function (type) { w.parent.postMessage({ type: type, s: sessionId }, w.location.origin); };
          post('sa:battery_ending');
          var send = function () { return sync ? (sync.flushEvents ? sync.flushEvents() : sync.flush()) : null; };
          ended = writes.then(closeRecording).then(send).then(null, function () { return null; }).then(function () {
            post('sa:battery_end');
            if (sync) sync.poke();
          });
        }
        // Embedded in the coach page: its own corner hold asks the engine to end the run ({type:'sa:coach_end', s}).
        // The running task ends as coach_end (so a coach-ended minute is never read as a whole block), the last
        // writes and the sync go, then sa:done {reason:'coach_end'}, once. Only this session, only the page's origin.
        var win = deps.win || root;
        var coachEnded = false;
        // Round 7b (sa_end_section, RDF manual): the coach page's End this section ({type:'sa:end_section', s}); the
        // runner ends the task on show and skips the rest of its section, the test goes on. Only this session, this origin.
        var onSection = function (e, d) {
          if (coachEnded || !manual || w3.end_section !== true || d.s !== sessionId) return;
          if (!win.location || e.origin !== win.location.origin) return;
          if (runner.endSection() && view && view.render) view.render();
        };
        var onMsg = function (e) {
          var d = e && e.data;
          if (opts.embed && d && d.type === 'sa:end_section') { onSection(e, d); return; }
          if (coachEnded || !opts.embed || !d || d.type !== 'sa:coach_end' || d.s !== sessionId) return;
          if (!win.location || e.origin !== win.location.origin) return;
          coachEnded = true;
          // The battery has ended: the child is complete, whichever way the coach takes the phone back.
          if (!ended && w3.end_test_restart === true) {
            // round 7b (sa_end_test_restart): the coach's End test is one kept event, on the task on show
            var on = runner.view().task;
            runner.log('end_test', { task_id: on ? on.id : undefined, value: { by: 'coach', mode: manual ? 'coach_led' : 'auto' } });
          }
          if (ended) {
            ended.then(function () {
              if (win.parent && win.parent !== win) win.parent.postMessage({ type: 'sa:done', s: sessionId, reason: 'complete' }, win.location.origin);
            });
            return;
          }
          runner.coachEnd();
          runner.log('coach_end_run');
          runner.log('handover_out');
          writes.then(closeRecording).then(function () { return sync ? sync.flush() : null; }).then(function () {
            fire('unlock', null);
            if (win.parent && win.parent !== win) win.parent.postMessage({ type: 'sa:done', s: sessionId, reason: 'coach_end' }, win.location.origin);
          });
        };
        if (opts.embed && win.addEventListener) win.addEventListener('message', onMsg);
        // Another app, the screen off, a call: logged, and a timed task in progress runs again (RULING #12).
        // Shown again: Jugnu's line held while the page was hidden plays on (sa-voice resume()).
        var doc = deps.doc || root.document;
        var onVis = function () {
          if (doc.visibilityState === 'hidden') { runner.visibilityLost(); if (view && view.render) view.render(); }
          else if (voice.resume) voice.resume();
        };
        if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', onVis);
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
            if (doc && doc.removeEventListener) doc.removeEventListener('visibilitychange', onVis);
            if (win.removeEventListener) win.removeEventListener('message', onMsg);
            hooks = {};
          },
        };
      });
    });
  }

  return { start: start, done: done };
}));
