/**
 * The battery's recorder (switch sa_engine): one recording per read-aloud task, kept on the phone as it is made.
 *
 * MediaRecorder with the portal's types, in the portal's order (portal/src/portal/lib/recordingSupport.ts CANDIDATES,
 * copied: no build step here). A chunk is written to the store every second, so a killed tab keeps the audio up to
 * the kill; stop() writes the closing chunk marked final (with the duration), and only a final recording is uploaded
 * (sa-sync). The microphone is asked for once, at the audio check, and kept open for the battery.
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

  function pickType(MR) {
    if (!MR || typeof MR.isTypeSupported !== 'function') return null;
    for (var i = 0; i < CANDIDATES.length; i++) if (MR.isTypeSupported(CANDIDATES[i].mimeType)) return CANDIDATES[i];
    return null;
  }

  /**
   * create({ store, session_id, MediaRecorder, getUserMedia, now }) → recorder.
   * recorder.supported() · ready() → Promise<bool> (asks for the microphone) · start(taskId) · stop() → Promise<meta>.
   */
  function create(o) {
    var MR = o.MediaRecorder || root.MediaRecorder;
    var gum = o.getUserMedia || function (c) { return root.navigator.mediaDevices.getUserMedia(c); };
    var now = o.now || function () { return Date.now(); };
    var type = pickType(MR);
    var stream = null;
    var cur = null;

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
      if (!cur) return Promise.resolve(null);
      var c = cur;
      cur = null;
      try { c.mr.stop(); } catch (_) { c.resolve(null); }
      return c.done;
    }

    function release() {
      if (stream && stream.getTracks) stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }

    return { supported: function () { return !!type; }, type: function () { return type; }, ready: ready, start: start, stop: stop, release: release, recording: function () { return !!cur; } };
  }

  return { CANDIDATES: CANDIDATES, pickType: pickType, create: create };
}));
