/**
 * The coach surface's sink for the battery's sync (switch sa_engine; the routes behind portal_child_test_sa): the
 * engine's putBatch / presignAudio / registerAudio as the portal relay's /api/portal/leader/child-test/sa/session/:id/*
 * calls, with the coach's own session cookie (same origin). The engine never sees a coach credential.
 *
 * A signed-out coach (401/403) or a switched-off route (404) is a failure the sync retries later: nothing is lost.
 * Every batch carries the phone's device fields (mic_ok, mic_rms, persisted, voice) from the mic check and
 * SAE.prepare's localStorage keys; a presign's {skip, reason} comes through for the sync.
 * UMD: window.SAE.sinks.coach in the browser, module.exports under Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else { root.SAE = root.SAE || {}; root.SAE.sinks = root.SAE.sinks || {}; var m = factory(root); root.SAE.sinks.coach = m.create; root.SAE.sinks.coachLinked = m.linked; }
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var BASE = '/api/portal/leader/child-test/sa';

  /** A recording's id is "<task_id>" or "<task_id>/<item_id>" (a spoken answer per question). */
  function splitRec(id) {
    var i = String(id).indexOf('/');
    return i < 0 ? { taskId: id, itemId: undefined } : { taskId: id.slice(0, i), itemId: id.slice(i + 1) };
  }

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }

  /** The phone's device fields: the coach's mic check keeps JSON in sa:mic_ok, the game's keeps sa:mic_ok + sa:mic_rms. */
  function device(ls) {
    var d = { mic_ok: false, mic_rms: null, persisted: null, voice: null };
    if (ls) try {
      var raw = ls.getItem('sa:mic_ok');
      var m = null;
      try { m = JSON.parse(raw); } catch (_) { m = raw; }
      if (m && typeof m === 'object') { d.mic_ok = m.mic_ok === true; d.mic_rms = num(m.mic_rms); } else d.mic_ok = m === true || m === 1 || m === '1' || m === 'true';
      if (d.mic_rms == null) d.mic_rms = num(ls.getItem('sa:mic_rms'));
      var p = ls.getItem('sa:persisted');
      d.persisted = p === 'true' ? true : (p === 'false' ? false : null);
      d.voice = ls.getItem('sa:voice') || null;
    } catch (_) { /* blocked storage: what we have */ }
    // An unknown field is left out, so it never overwrites what the server already has from this phone.
    for (var k in d) if (d[k] == null) delete d[k];
    return d;
  }

  function create(o) {
    o = o || {};
    var ls = 'localStorage' in o ? o.localStorage : (function () { try { return root.localStorage; } catch (_) { return null; } }());
    var base = o.base || BASE;
    var f = o.fetch || function (u, init) { return root.fetch(u, init); };
    // A linked phone (no coach sign-in) carries its token in the path and sends no cookie.
    var cred = o.credentials || 'include';
    var extra = o.headers || {};
    function hdr(h) { for (var k in extra) h[k] = extra[k]; return h; }

    function post(sessionId, path, body) {
      return Promise.resolve(f(base + '/session/' + encodeURIComponent(sessionId) + path, {
        method: 'POST', credentials: cred, cache: 'no-store',
        headers: hdr({ 'Content-Type': 'application/json', Accept: 'application/json' }),
        body: JSON.stringify(body),
      })).then(function (res) {
        if (!res.ok) { var e = new Error('coach sink ' + path + ' ' + res.status); e.status = res.status; throw e; }
        return res.json();
      });
    }

    return {
      putBatch: function (b) {
        return post(b.session_id, '/batch', { seqFrom: b.seq_from, seqTo: b.seq_to, events: b.events, results: b.results, device: device(ls) })
          .then(function (r) { return { ok: true, acked_to: typeof r.ackedTo === 'number' ? r.ackedTo : b.seq_to }; });
      },
      presignAudio: function (a) {
        var s = splitRec(a.task_id);
        return post(a.session_id, '/presign', { taskId: s.taskId, itemId: s.itemId, mime: a.mime, bytes: a.bytes })
          .then(function (r) { return r && r.skip === true ? { skip: true, reason: r.reason || null } : { url: r.url, key: r.key }; });
      },
      registerAudio: function (a) {
        var s = splitRec(a.task_id);
        return post(a.session_id, '/register', { taskId: s.taskId, itemId: s.itemId, key: a.key, bytes: a.bytes, durationMs: a.duration_ms });
      },
      status: function (sessionId) {
        return Promise.resolve(f(base + '/session/' + encodeURIComponent(sessionId) + '/status', { credentials: cred, cache: 'no-store', headers: hdr({ Accept: 'application/json' }) }))
          .then(function (res) { return res.ok ? res.json() : null; });
      },
    };
  }

  var pagePhone = null;
  /** This phone's own random id (sa:phone), minted once; blocked storage: one id for the page's life. Not a fingerprint. */
  function phoneId(ls) {
    var id = null;
    try { id = ls ? ls.getItem('sa:phone') : null; } catch (_) { id = null; }
    if (id && /^[0-9a-f]{24}$/.test(id)) return id;
    if (!pagePhone) {
      var b = new Uint8Array(12);
      var c = root.crypto || (typeof globalThis !== 'undefined' && globalThis.crypto);
      if (c && c.getRandomValues) c.getRandomValues(b);
      else for (var i = 0; i < b.length; i += 1) b[i] = Math.floor(Math.random() * 256);
      pagePhone = Array.prototype.map.call(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
    }
    try { if (ls) ls.setItem('sa:phone', pagePhone); } catch (_) { /* blocked storage: the page's id */ }
    return pagePhone;
  }

  /** The sink for a phone opened by the coach's QR/link: the token routes, no cookie, the phone's own id. */
  function linked(token, o) {
    var x = {};
    for (var k in (o || {})) x[k] = o[k];
    x.base = BASE + '/link/' + encodeURIComponent(token);
    x.credentials = 'omit';
    var ls = 'localStorage' in x ? x.localStorage : (function () { try { return root.localStorage; } catch (_) { return null; } }());
    x.headers = { 'X-SA-Phone': phoneId(ls) };
    return create(x);
  }

  return { create: create, linked: linked, splitRec: splitRec, device: device, BASE: BASE };
}));
