/**
 * The battery's recorder (switch sa_engine): one recording per read-aloud task, kept on the phone as it is made.
 *
 * MediaRecorder with the portal's types, in the portal's order (portal/src/portal/lib/recordingSupport.ts CANDIDATES,
 * copied: no build step here). A chunk is written to the store every second, so a killed tab keeps the audio up to
 * the kill; stop() writes the closing chunk marked final (with the duration), and only a final recording is uploaded
 * (sa-sync). The microphone is asked for once, at the audio check, and kept open for the battery.
 *
 * The mercy rule's ear (RULING #10b): recorder.onSilence({ after_s, total_s }, cb) reads the mic's level ten times a
 * second from the begin line on; no voice by after_s → cb({kind:'mercy'}) once, still none at total_s →
 * cb({kind:'early_stop_silence', silence_s}). The first voice ends the watch. A voice is the level above
 * max(FLOOR, 2 × the room's quietest second), capped at half the probe's peak (the coach's or the game's mic check).
 *
 * UMD: window.SAE.rec in the browser, module.exports under Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else { root.SAE = root.SAE || {}; root.SAE.rec = factory(root); }
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var CANDIDATES = [
    { mimeType: 'audio/webm;codecs=opus', ext: '.webm' },
    { mimeType: 'audio/webm', ext: '.webm' },
    { mimeType: 'audio/ogg;codecs=opus', ext: '.ogg' },
    { mimeType: 'audio/mp4', ext: '.m4a' },
  ];
  var SLICE_MS = 1000;
  var TICK_MS = 100;
  var FLOOR = 0.02;
  var VOICE_TICKS = 3;
  var last = null;

  /** Root mean square of 8-bit time-domain samples, 0..1 (the portal's mic check uses the same scale). */
  function rmsOf(buf) {
    if (!buf.length) return 0;
    var sum = 0;
    for (var i = 0; i < buf.length; i++) { var v = (buf[i] - 128) / 128; sum += v * v; }
    return Math.min(1, Math.sqrt(sum / buf.length));
  }

  /** The probe's peak level from the mic check: game 'sa:mic_rms', coach JSON 'sa:mic_ok'.mic_rms; else null. */
  function probePeak(ls) {
    if (!ls) return null;
    try {
      var g = parseFloat(ls.getItem('sa:mic_rms'));
      if (g > 0) return g;
      var c = JSON.parse(ls.getItem('sa:mic_ok') || 'null');
      if (c && typeof c.mic_rms === 'number' && c.mic_rms > 0) return c.mic_rms;
    } catch (_) { /* no mic check on this phone */ }
    return null;
  }

  /** The level above which the room is a voice: 2× its floor, never under FLOOR, never over half the probe's peak. */
  function thresholdFor(floor, ls) {
    var t = Math.max(FLOOR, 2 * (floor || 0));
    var peak = probePeak(ls);
    return peak ? Math.max(FLOOR, Math.min(t, peak / 2)) : t;
  }

  function pickType(MR) {
    if (!MR || typeof MR.isTypeSupported !== 'function') return null;
    for (var i = 0; i < CANDIDATES.length; i++) if (MR.isTypeSupported(CANDIDATES[i].mimeType)) return CANDIDATES[i];
    return null;
  }

  /**
   * create({ store, session_id, MediaRecorder, getUserMedia, now, AudioContext, interval, localStorage }) → recorder.
   * recorder.supported() · ready() → Promise<bool> (asks for the microphone) · start(taskId) · stop() → Promise<meta>
   * · onSilence(opts, cb) → cancel().
   */
  function create(o) {
    var MR = o.MediaRecorder || root.MediaRecorder;
    var gum = o.getUserMedia || function (c) { return root.navigator.mediaDevices.getUserMedia(c); };
    var now = o.now || function () { return Date.now(); };
    var AC = o.AudioContext || root.AudioContext || root.webkitAudioContext;
    var interval = o.interval || { set: function (f, ms) { return setInterval(f, ms); }, clear: function (h) { clearInterval(h); } };
    var ls = 'localStorage' in o ? o.localStorage : (function () { try { return root.localStorage; } catch (_) { return null; } }());
    var type = pickType(MR);
    var stream = null;
    var cur = null;
    var ctx = null;
    var analyser = null;
    var watches = [];

    function ear() {
      if (analyser) return analyser;
      if (!stream || !AC) return null;
      try {
        ctx = new AC();
        analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        ctx.createMediaStreamSource(stream).connect(analyser);
      } catch (_) { analyser = null; }
      return analyser;
    }

    function onSilence(opts, cb) {
      var an = ear();
      if (!an) return function () {};
      var afterMs = (opts && opts.after_s || 12) * 1000;
      var totalMs = (opts && opts.total_s || 20) * 1000;
      var buf = new Uint8Array(an.fftSize || 2048);
      var t0 = now();
      var sec = { start: t0, sum: 0, n: 0 };
      var floor = null;
      var loud = 0;
      var mercy = false;
      var h = null;
      function end() { if (h != null) { interval.clear(h); h = null; } watches = watches.filter(function (w) { return w !== end; }); }
      h = interval.set(function () {
        var t = now();
        an.getByteTimeDomainData(buf);
        var r = rmsOf(buf);
        sec.sum += r; sec.n++;
        if (t - sec.start >= 1000) {
          var mean = sec.sum / sec.n;
          floor = floor == null ? mean : Math.min(floor, mean);
          sec = { start: t, sum: 0, n: 0 };
        }
        // The room's floor is known after its first second; a voice is three loud ticks in a row after that.
        loud = floor != null && r > thresholdFor(floor, ls) ? loud + 1 : 0;
        if (loud >= VOICE_TICKS) { end(); return; }
        var el = t - t0;
        var s = Math.round(el / 100) / 10;
        if (!mercy && el >= afterMs) { mercy = true; cb({ kind: 'mercy', silence_s: s }); }
        if (el >= totalMs) { end(); cb({ kind: 'early_stop_silence', silence_s: s }); }
      }, TICK_MS);
      watches.push(end);
      return end;
    }
    function endWatches() { watches.slice().forEach(function (w) { w(); }); }

    function ready() {
      if (!type) return Promise.resolve(false);
      if (stream) return Promise.resolve(true);
      return Promise.resolve().then(function () { return gum({ audio: { echoCancellation: true, noiseSuppression: true } }); })
        .then(function (s) { stream = s; return true; }, function () { return false; });
    }

    function start(taskId) {
      if (!stream || !type) return false;
      if (cur) return false;
      var mr = new MR(stream, { mimeType: type.mimeType });
      var c = { task_id: taskId, mr: mr, part: 0, t0: now(), writes: Promise.resolve(), done: null };
      c.done = new Promise(function (ok) { c.resolve = ok; });
      mr.ondataavailable = function (e) {
        if (!e.data || !e.data.size) return;
        var part = c.part++;
        c.writes = c.writes.then(function () {
          return o.store.putChunk(o.session_id, taskId, part, e.data, { mime: type.mimeType, ext: type.ext });
        }).catch(function () { /* the store's own fallback said so; keep recording */ });
      };
      mr.onstop = function () {
        var dur = Math.round(now() - c.t0);
        c.writes = c.writes.then(function () {
          // The closing marker: no audio of its own, it tells the sync the file is whole.
          return o.store.putChunk(o.session_id, taskId, c.part, null, { mime: type.mimeType, ext: type.ext, final: true, duration_ms: dur });
        }).then(function () { c.resolve({ task_id: taskId, parts: c.part, duration_ms: dur, mime: type.mimeType }); });
      };
      mr.start(SLICE_MS);
      cur = c;
      return true;
    }

    function stop() {
      endWatches();
      if (!cur) return Promise.resolve(null);
      var c = cur;
      cur = null;
      try { c.mr.stop(); } catch (_) { c.resolve(null); }
      return c.done;
    }

    function release() {
      endWatches();
      if (ctx && ctx.close) { try { ctx.close(); } catch (_) { /* already closed */ } }
      ctx = null;
      analyser = null;
      if (stream && stream.getTracks) stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }

    var api = { supported: function () { return !!type; }, type: function () { return type; }, ready: ready, start: start, stop: stop, release: release, recording: function () { return !!cur; }, onSilence: onSilence };
    last = api;
    return api;
  }

  /** SAE.rec.onSilence: the same, on the recorder made last (the engine makes one per battery). */
  function onSilenceLast(opts, cb) { return last ? last.onSilence(opts, cb) : function () {}; }

  return { CANDIDATES: CANDIDATES, pickType: pickType, create: create, onSilence: onSilenceLast, rmsOf: rmsOf, thresholdFor: thresholdFor, FLOOR: FLOOR };
}));
