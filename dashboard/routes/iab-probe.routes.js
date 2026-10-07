/**
 * The phone test page for WhatsApp's in-app browser.
 *
 * A web page inside WhatsApp's browser can do only what WhatsApp lets it. The
 * microphone works there (a real phone, 2026-10-07); whether the camera, the
 * gallery and the file picker open for a page is WhatsApp's own choice and is
 * written down nowhere. This page asks on a real phone, and sends every file it
 * gets to the portal, so we see it arrive on the server too.
 *
 *   GET  /iab/:token            the test page, for a token signed for the probe
 *   POST /api/iab-probe/upload  one file (?kind=…): logged as size, type and a
 *                               fingerprint, then thrown away — nothing is stored
 *   POST /api/iab-probe/result  the page's own finding for one check
 *
 * The page is opened from the iab_probe_v1 template's button (a template's link
 * opens inside WhatsApp; a link in a message opens Chrome). Only a token signed
 * with the portal-link key for 'probe' opens it or is accepted with a file, so
 * this is not an open upload endpoint, and the token is logged as /iab/:token
 * (middleware/latency-logger.js). Mounted in index.js before the body parsers,
 * like the web quiz edge, so a file is read as bytes here whatever its type.
 */
const crypto = require('crypto');
const express = require('express');
const { verifyPortalLink } = require('../../bot/shared/services/portal-link-token');
// The portal's own sink: the bot's loggers need pino, which this service does not install.
const telemetry = require('../services/telemetry.service');

const KINDS = ['file', 'camera', 'gallery', 'multi', 'audio', 'mic'];
const CHECKS = [...KINDS, 'load', 'wakelock', 'storage'];
const OUTCOMES = ['ok', 'fail', 'denied', 'unsupported', 'cancelled', 'error'];
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

function log(event, props) {
  try { telemetry.logEvent(event, props); } catch (_) { /* logging never decides the response */ }
}

function browserFacts(req) {
  const ua = String(req.get('user-agent') || '').slice(0, 300);
  const xrw = String(req.get('x-requested-with') || '').slice(0, 80) || null;
  const iab = /WhatsApp|WA4A\/|; wv\)/.test(ua) || /^com\.whatsapp/.test(xrw || '') ? 1 : 0;
  return { ua, xrw, iab };
}

/** The probe payload for a genuine, unexpired probe token; else null. */
function probeFrom(token) {
  const p = verifyPortalLink(token);
  return p && p.area === 'probe' ? p : null;
}

const EXPIRED_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Test link expired</title>
<style>body{margin:0;padding:24px 16px;font:17px/1.5 system-ui,sans-serif;background:#fff;color:#333748}
@media (prefers-color-scheme:dark){body{background:#14161c;color:#eceef3}}</style></head>
<body><h1 style="font-size:20px">This test link has expired</h1><p>Ask for a new one.</p></body></html>`;

function renderPage(token) {
  // The token goes in as JSON, then into a header on every request the page makes.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Phone test</title>
<style>
  :root { --bg:#ffffff; --fg:#333748; --muted:#5b6475; --accent:#47BA7D; --card:#f3f6f4; --line:#d9dee8; --ok:#11804a; --bad:#b3261e; }
  @media (prefers-color-scheme: dark) { :root { --bg:#14161c; --fg:#eceef3; --muted:#a6adbb; --card:#1d2129; --line:#2a3347; --ok:#4cc38a; --bad:#ff8a80; } }
  * { box-sizing:border-box; }
  body { margin:0; padding:16px; background:var(--bg); color:var(--fg); font:16px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width:520px; margin:0 auto; }
  h1 { font-size:20px; margin:4px 0 4px; }
  p.sub { margin:0 0 14px; color:var(--muted); font-size:14px; }
  section { background:var(--card); border-radius:14px; padding:14px; margin:0 0 12px; border-left:4px solid var(--accent); }
  h2 { font-size:16px; margin:0 0 8px; }
  label.btn, button { display:inline-flex; align-items:center; min-height:48px; padding:10px 16px; border-radius:10px; border:0; background:var(--accent); color:#fff; font:inherit; font-weight:600; cursor:pointer; }
  input[type=file] { position:absolute; width:1px; height:1px; opacity:0; }
  .out { margin-top:8px; font-size:14px; word-break:break-word; }
  .ok { color:var(--ok); font-weight:600; } .bad { color:var(--bad); font-weight:600; }
  img.preview { display:block; max-width:100%; max-height:200px; margin-top:8px; border-radius:8px; }
  audio { display:block; width:100%; margin-top:8px; }
</style>
</head>
<body>
<main>
<h1>Phone test</h1>
<p class="sub">Try each step. Every file you pick is sent to our server, which says how much it received, then throws it away.</p>

<section><h2>1. Take a photo with the camera</h2>
<label class="btn" for="in-camera">Take photo</label>
<input id="in-camera" type="file" accept="image/*" capture="environment" data-kind="camera">
<div class="out" id="out-camera"></div></section>

<section><h2>2. Pick a photo from the gallery</h2>
<label class="btn" for="in-gallery">Pick photo</label>
<input id="in-gallery" type="file" accept="image/*" data-kind="gallery">
<div class="out" id="out-gallery"></div></section>

<section><h2>3. Pick several photos</h2>
<label class="btn" for="in-multi">Pick photos</label>
<input id="in-multi" type="file" accept="image/*" multiple data-kind="multi">
<div class="out" id="out-multi"></div></section>

<section><h2>4. Pick any file (a PDF, a document)</h2>
<label class="btn" for="in-file">Pick file</label>
<input id="in-file" type="file" data-kind="file">
<div class="out" id="out-file"></div></section>

<section><h2>5. Pick an audio recording</h2>
<label class="btn" for="in-audio">Pick recording</label>
<input id="in-audio" type="file" accept="audio/*" data-kind="audio">
<div class="out" id="out-audio"></div></section>

<section><h2>6. Record 5 seconds with the microphone</h2>
<button id="mic-btn" type="button">Record 5 seconds</button>
<div class="out" id="out-mic"></div></section>
</main>
<script>
(function () {
  'use strict';
  var TOKEN = ${JSON.stringify(token)};
  function el(id) { return document.getElementById(id); }
  function say(id, html) { el('out-' + id).innerHTML += '<div>' + html + '</div>'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function kb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function result(check, outcome, detail) {
    try {
      fetch('/api/iab-probe/result', { method: 'POST', keepalive: true,
        headers: { 'content-type': 'application/json', 'x-probe-token': TOKEN },
        body: JSON.stringify({ check: check, outcome: outcome, detail: String(detail || '').slice(0, 200) }) }).catch(function () {});
    } catch (e) {}
  }
  function upload(kind, blob) {
    return fetch('/api/iab-probe/upload?kind=' + kind, { method: 'POST',
      headers: { 'content-type': blob.type || 'application/octet-stream', 'x-probe-token': TOKEN }, body: blob })
      .then(function (r) { return r.json().then(function (j) { j.status = r.status; return j; }, function () { return { status: r.status }; }); });
  }
  function received(kind, file) {
    return upload(kind, file).then(function (j) {
      if (j.ok) say(kind, '<span class="ok">Server received ' + kb(j.bytes) + ' \\u2713</span> (' + esc(j.type) + ', ' + esc(j.sha) + ')');
      else say(kind, '<span class="bad">Upload failed (' + j.status + ')</span>');
      return j.ok;
    }, function (e) { say(kind, '<span class="bad">Upload failed: ' + esc(e && e.message) + '</span>'); return false; });
  }

  Array.prototype.forEach.call(document.querySelectorAll('input[type=file]'), function (input) {
    var kind = input.getAttribute('data-kind');
    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files || []);
      if (!files.length) { say(kind, 'Nothing picked.'); result(kind, 'cancelled', 'no file'); return; }
      var total = 0;
      files.forEach(function (f) {
        total += f.size;
        say(kind, esc(f.name || '(no name)') + ' \\u2014 ' + kb(f.size) + ', ' + esc(f.type || 'unknown type'));
        if (/^image\\//.test(f.type)) {
          var img = document.createElement('img'); img.className = 'preview'; img.alt = '';
          img.src = URL.createObjectURL(f); el('out-' + kind).appendChild(img);
        }
      });
      Promise.all(files.map(function (f) { return received(kind, f); })).then(function (oks) {
        var n = oks.filter(Boolean).length;
        result(kind, n === files.length ? 'ok' : 'fail', files.length + ' file(s), ' + total + ' B, ' + n + ' received');
      });
    });
  });

  el('mic-btn').addEventListener('click', function () {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder !== 'function') {
      say('mic', '<span class="bad">This browser cannot record.</span>'); result('mic', 'unsupported', ''); return;
    }
    say('mic', 'Asking for the microphone\\u2026');
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var chunks = []; var rec = new MediaRecorder(stream);
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        var blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        var a = document.createElement('audio'); a.controls = true; a.src = URL.createObjectURL(blob);
        el('out-mic').appendChild(a);
        say('mic', 'Recorded ' + kb(blob.size) + ' (' + esc(blob.type) + '). Play it back above.');
        received('mic', blob).then(function (ok) { result('mic', ok ? 'ok' : 'fail', blob.size + ' B ' + blob.type); });
      };
      rec.start(); say('mic', 'Recording\\u2026 say something.');
      setTimeout(function () { if (rec.state !== 'inactive') rec.stop(); }, 5000);
    }, function (e) {
      var name = (e && e.name) || 'error';
      say('mic', '<span class="bad">Microphone refused: ' + esc(name) + '</span>');
      result('mic', name === 'NotAllowedError' ? 'denied' : 'error', name + ' ' + (e && e.message || ''));
    });
  });

  // What a long recording would lean on: keeping the screen on, and storage that survives.
  try {
    if (navigator.wakeLock && navigator.wakeLock.request) {
      navigator.wakeLock.request('screen').then(function (l) { result('wakelock', 'ok', 'granted'); l.release(); },
        function (e) { result('wakelock', 'denied', (e && e.name) || ''); });
    } else { result('wakelock', 'unsupported', ''); }
  } catch (e) { result('wakelock', 'error', e && e.name); }
  try {
    var idb = window.indexedDB ? 'indexedDB' : 'no indexedDB';
    var ls = (function () { try { localStorage.setItem('iab_probe', '1'); return 'localStorage'; } catch (e) { return 'no localStorage'; } })();
    result('storage', 'ok', idb + ', ' + ls);
  } catch (e) { result('storage', 'error', e && e.name); }
  result('load', 'ok', (navigator.userAgent || '').slice(0, 150));
})();
</script>
</body>
</html>`;
}

function createIabProbeRouter({ maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const router = express.Router();

  router.get('/iab/:token', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const p = probeFrom(req.params.token);
    if (!p) return res.status(404).type('html').send(EXPIRED_PAGE);
    log('iab_probe.open', { userId: p.u, ...browserFacts(req) });
    return res.status(200).type('html').send(renderPage(req.params.token));
  });

  const raw = express.raw({ type: () => true, limit: maxBytes });
  router.post('/api/iab-probe/upload', (req, res, next) => {
    // The token first, so nothing is read for a caller who has none.
    const p = probeFrom(req.get('x-probe-token'));
    if (!p) return res.status(401).json({ ok: false, error: 'not_a_probe_link' });
    req.probe = p;
    return raw(req, res, (err) => {
      if (err && err.type === 'entity.too.large') return res.status(413).json({ ok: false, error: 'too_large' });
      if (err) return next(err);
      const kind = String(req.query.kind || '');
      if (!KINDS.includes(kind)) return res.status(400).json({ ok: false, error: 'unknown_kind' });
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!body.length) return res.status(400).json({ ok: false, error: 'empty' });
      const type = String(req.get('content-type') || '').slice(0, 80);
      const sha = crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);
      log('iab_probe.upload', { userId: p.u, kind, bytes: body.length, type, sha, ...browserFacts(req) });
      return res.json({ ok: true, bytes: body.length, type, sha });
    });
  });

  router.post('/api/iab-probe/result', express.json({ limit: '4kb' }), (req, res) => {
    const p = probeFrom(req.get('x-probe-token'));
    if (!p) return res.status(401).json({ ok: false, error: 'not_a_probe_link' });
    const { check, outcome, detail } = req.body || {};
    if (!CHECKS.includes(check) || !OUTCOMES.includes(outcome)) return res.status(400).json({ ok: false, error: 'bad_result' });
    log('iab_probe.result', { userId: p.u, check, outcome, detail: String(detail || '').slice(0, 200), ...browserFacts(req) });
    return res.status(204).end();
  });

  return router;
}

module.exports = { createIabProbeRouter };
