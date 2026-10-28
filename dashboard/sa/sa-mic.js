/**
 * The microphone checks the battery's screens use (switch sa_engine): the game's once-per-device mic check and the
 * practice spoken question. Nothing here is uploaded: the probe is played back to the child and dropped.
 *
 *   SAE.mic.state(store)            'ok' | 'no' | 'unknown' from localStorage sa:mic_ok ('1'/'0', or the coach
 *                                   pre-flight's JSON {ok|mic_ok, mic_rms}; an earlier game mic check on this phone)
 *   SAE.mic.remember(ok, rms)       sa:mic_ok ('1'/'0') and sa:mic_rms
 *   SAE.mic.probe(ms)               Promise<{ ok, rms, url }>: record ms (2 s), the level's RMS, a blob URL to play back
 *   SAE.mic.level(cb[, { stream }]) a live level 0..1 to cb about 10× a second; returns stop(). It listens on the
 *                                   stream given, else the recorder's open one (SAE.rec.stream()), else its own; a
 *                                   stream it did not open is never stopped (the recorder keeps recording).
 *
 * UMD: window.SAE.mic in the browser, module.exports under Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else { root.SAE = root.SAE || {}; root.SAE.mic = factory(root); }
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var KEY_OK = 'sa:mic_ok';
  var KEY_RMS = 'sa:mic_rms';
  // A probe whose RMS stays under this is silence (a muted or dead mic), whatever the child heard.
  var FLOOR = 0.01;

  function ls(store) {
    if (store) return store;
    try { return root.localStorage; } catch (_) { return null; }
  }

  function state(store) {
    var s = ls(store);
    var v = null;
    try { v = s ? s.getItem(KEY_OK) : null; } catch (_) { v = null; }
    if (v === '1' || v === 'true') return 'ok';
    if (v === '0' || v === 'false') return 'no';
    // The coach's pre-flight may store a JSON record ({ok|mic_ok: true, mic_rms}).
    try {
      var o = v ? JSON.parse(v) : null;
      if (o && typeof o === 'object') {
        var ok = o.ok != null ? o.ok : o.mic_ok;
        if (ok === true) return 'ok';
        if (ok === false) return 'no';
      }
    } catch (_) { /* not JSON */ }
    return 'unknown';
  }

  function remember(ok, rms, store) {
    var s = ls(store);
    try {
      if (!s) return;
      // A pass is kept for the phone; a failure is not, so the next run asks again (a grown-up may have fixed the
      // permission in between).
      if (ok) s.setItem(KEY_OK, '1');
      else if (s.getItem(KEY_OK) !== '1') s.removeItem(KEY_OK);
      if (typeof rms === 'number') s.setItem(KEY_RMS, String(Math.round(rms * 10000) / 10000));
    } catch (_) { /* private tab: the check is asked again next time */ }
  }

  function rmsOf(buf) {
    var sum = 0;
    for (var i = 0; i < buf.length; i++) { var x = (buf[i] - 128) / 128; sum += x * x; }
    return Math.sqrt(sum / buf.length);
  }

  function open() {
    var nav = root.navigator;
    if (!nav || !nav.mediaDevices || !nav.mediaDevices.getUserMedia) return Promise.reject(new Error('no_mic'));
    return nav.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  }

  function analyser(stream) {
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    var ctx = new AC();
    var src = ctx.createMediaStreamSource(stream);
    var an = ctx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    var buf = new Uint8Array(an.fftSize);
    return { read: function () { an.getByteTimeDomainData(buf); return rmsOf(buf); }, close: function () { try { ctx.close(); } catch (_) { /* closed */ } } };
  }

  function stopStream(stream) { if (stream && stream.getTracks) stream.getTracks().forEach(function (t) { t.stop(); }); }

  function probe(ms) {
    ms = ms || 2000;
    return open().then(function (stream) {
      return new Promise(function (resolve) {
        var an = analyser(stream);
        var peak = 0;
        var samples = [];
        var timer = an ? setInterval(function () { var v = an.read(); samples.push(v); if (v > peak) peak = v; }, 100) : null;
        var chunks = [];
        var mr = null;
        try { mr = new root.MediaRecorder(stream); } catch (_) { mr = null; }
        function finish() {
          if (timer) clearInterval(timer);
          if (an) an.close();
          stopStream(stream);
          var rms = samples.length ? samples.reduce(function (a, b) { return a + b; }, 0) / samples.length : 0;
          var url = chunks.length ? root.URL.createObjectURL(new root.Blob(chunks, { type: chunks[0].type || 'audio/webm' })) : null;
          resolve({ ok: !an || peak > FLOOR, rms: Math.round(rms * 10000) / 10000, peak: Math.round(peak * 10000) / 10000, url: url });
        }
        if (mr) {
          mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
          mr.onstop = finish;
          mr.start();
          setTimeout(function () { try { mr.stop(); } catch (_) { finish(); } }, ms);
        } else setTimeout(finish, ms);
      });
    }, function () { return { ok: false, rms: 0, peak: 0, url: null }; });
  }

  /** A stream whose tracks are all still live, or null. */
  function live(s) {
    try {
      var ts = s && s.getTracks ? s.getTracks() : null;
      return ts && ts.length && ts.every(function (t) { return t.readyState !== 'ended'; }) ? s : null;
    } catch (_) { return null; }
  }
  /** The recorder's open stream (sa-rec.js), so a meter never opens a second microphone while it records. */
  function shared() {
    try {
      var rec = root.SAE && root.SAE.rec;
      return rec && typeof rec.stream === 'function' ? live(rec.stream()) : null;
    } catch (_) { return null; }
  }

  function level(cb, o) {
    var stopped = false;
    var stream = null;
    var an = null;
    var timer = null;
    var borrowed = live(o && o.stream) || shared();
    (borrowed ? Promise.resolve(borrowed) : open()).then(function (s) {
      stream = borrowed ? null : s; // a borrowed stream is the recorder's to stop
      if (stopped) { stopStream(stream); return; }
      an = analyser(s);
      if (!an) return;
      timer = setInterval(function () { cb(Math.min(1, an.read() * 4)); }, 100);
    }, function () { /* no mic: no meter */ });
    return function stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      if (an) an.close();
      stopStream(stream);
    };
  }

  return { KEY_OK: KEY_OK, KEY_RMS: KEY_RMS, FLOOR: FLOOR, state: state, remember: remember, rmsOf: rmsOf, probe: probe, level: level };
}));
