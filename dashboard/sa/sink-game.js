/**
 * The game surface's sink for the battery's sync (switch sa_game): the engine's putBatch / presignAudio / registerAudio
 * / status as the big flight's token routes, /api/sa-game/s/* (the edge forwards them to the bot). A run is linked by
 * its run token `st` alone; the phone's device ref rides as x-wq-device (the hub's own `wq_d`, read, never minted here).
 *
 *   create({ st, session_id, base?, fetch? })       a sink for one run already opened (fetchImpl is taken too)
 *   openSession({ t, kid, part, form, lang, n?, base?, fetchImpl? }) → Promise<{ session_id, st }>
 *   forGame(boot, part, n?)                          a sink that opens its run on first use (boot = the game page's
 *                                                    { token, kid, form, lang }); n defaults to the engine's own run
 *                                                    number (the last ".<n>" of its session id), else 1
 *
 * The same interface and wire shapes as the coach sink (sink-coach.js): the engine calls putBatch({ session_id, seq_from,
 * seq_to, events, results }) → { ok, acked_to }, presignAudio({ task_id, mime, bytes }) → { url, key } (the engine then
 * PUTs with Content-Type), registerAudio({ task_id, key, bytes, duration_ms }), status(); on the wire, as the coach's:
 * batch { seqFrom, seqTo, events, results } → { ackedTo }, presign { taskId, itemId?, mime, bytes }, register { taskId,
 * itemId?, key, bytes, durationMs } — each with the run token st and the server's session id (where the coach sink has
 * the session id in its path and the cookie, this one has st). A recording id "<task>/<item>" is split into both.
 * A refused call (switch off 404, a bad token 401/403, 503) throws with .status, so the sync keeps the data for later;
 * status() answers null instead.
 * UMD: window.SAE.sinkGame (and SAE.sinks.game) in the browser, module.exports under Node.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.SAE = root.SAE || {};
    root.SAE.sinkGame = api;
    root.SAE.sinks = root.SAE.sinks || {};
    if (!root.SAE.sinks.game) root.SAE.sinks.game = api.create; // the skin (skin-game.js) may have set its own, which waits for this file
    // the game page asks W.SAG.sink(boot, part) for its sink (dashboard/sa-game/game.js)
    root.SAG = root.SAG || {};
    if (!root.SAG.sink) root.SAG.sink = api.forGame;
  }
}(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
  'use strict';

  var BASE = '/api/sa-game/s';
  var DEV_RX = /^[A-Za-z0-9_-]{22}$/;

  /** The phone's device ref as the hub keeps it: localStorage wq_d (a JSON string, or {id}), else the wq_dv cookie. */
  function deviceRef() {
    var d = null;
    try {
      var raw = JSON.parse(root.localStorage.getItem('wq_d') || 'null');
      d = typeof raw === 'string' ? raw : (raw && typeof raw.id === 'string' ? raw.id : null);
    } catch (e) { d = null; }
    if (d && DEV_RX.test(d)) return d;
    try {
      var m = /(?:^|;\s*)wq_dv=([A-Za-z0-9_-]{22})(?:;|$)/.exec(root.document.cookie || '');
      if (m) return m[1];
    } catch (e) { /* no cookie */ }
    return null;
  }

  /** A recording's id is "<task_id>" or "<task_id>/<item_id>" (a spoken answer per question). */
  function splitRec(id, itemId) {
    var s = String(id || '');
    var i = s.indexOf('/');
    if (i < 0) return { taskId: s, itemId: itemId || undefined };
    return { taskId: s.slice(0, i), itemId: s.slice(i + 1) };
  }

  function caller(o) {
    var base = o.base || BASE;
    var f = o.fetch || o.fetchImpl || function (u, init) { return root.fetch(u, init); };
    return function (method, path, body) {
      var headers = { Accept: 'application/json' };
      if (body) headers['Content-Type'] = 'application/json';
      var dev = deviceRef();
      if (dev) headers['x-wq-device'] = dev;
      return Promise.resolve(f(base + path, {
        method: method, credentials: 'include', cache: 'no-store', headers: headers,
        body: body ? JSON.stringify(body) : undefined,
      })).then(function (res) {
        if (!res || !res.ok) { var e = new Error('game sink ' + path + ' ' + (res && res.status)); e.status = res && res.status; throw e; }
        return res.json();
      });
    };
  }

  function openSession(o) {
    o = o || {};
    var body = { t: o.t, kid: o.kid, part: o.part, form: o.form, lang: o.lang };
    if (o.n != null) body.n = o.n;
    return caller(o)('POST', '/session', body).then(function (r) {
      if (!r || !r.st || !r.session_id) { var e = new Error('game sink: no session'); e.status = 502; throw e; }
      return { session_id: r.session_id, st: r.st };
    });
  }

  /** `run` is { st, session_id } or a function returning a Promise of it (opened on first use). */
  function sinkFor(run, o) {
    var call = caller(o || {});
    var got = null;
    function ready(hint) {
      if (typeof run !== 'function') return Promise.resolve(run);
      if (!got) got = Promise.resolve(run(hint)).catch(function (e) { got = null; throw e; });
      return got;
    }
    return {
      putBatch: function (b) {
        b = b || {};
        return ready(b.session_id).then(function (r) {
          return call('POST', '/batch', { st: r.st, sessionId: r.session_id, seqFrom: b.seq_from, seqTo: b.seq_to, events: b.events || [], results: b.results || [] })
            .then(function (out) {
              var acked = typeof out.ackedTo === 'number' ? out.ackedTo : (typeof out.acked_to === 'number' ? out.acked_to : b.seq_to);
              return { ok: true, acked_to: acked };
            });
        });
      },
      presignAudio: function (a) {
        a = a || {};
        var s = splitRec(a.task_id, a.item_id);
        return ready(a.session_id).then(function (r) {
          return call('POST', '/audio/presign', { st: r.st, taskId: s.taskId, itemId: s.itemId, mime: a.mime, bytes: a.bytes })
            .then(function (out) { return { url: out.url, key: out.key }; });
        });
      },
      registerAudio: function (a) {
        a = a || {};
        var s = splitRec(a.task_id, a.item_id);
        return ready(a.session_id).then(function (r) {
          return call('POST', '/audio/register', { st: r.st, taskId: s.taskId, itemId: s.itemId, key: a.key, bytes: a.bytes, durationMs: a.duration_ms });
        });
      },
      status: function () {
        return ready(null).then(function (r) { return call('GET', '/status?st=' + encodeURIComponent(r.st)); })
          .then(null, function () { return null; });
      },
    };
  }

  function create(o) {
    o = o || {};
    return sinkFor({ st: o.st, session_id: o.session_id }, o);
  }

  function forGame(boot, part, n, o) {
    boot = boot || {};
    o = o || {};
    return sinkFor(function (engineSid) {
      var m = /\.(\d{1,2})$/.exec(String(engineSid || ''));
      var runNo = n != null ? n : (m ? parseInt(m[1], 10) : 1);
      return openSession({ t: boot.token, kid: boot.kid, part: part, form: boot.form, lang: boot.lang, n: runNo, base: o.base, fetchImpl: o.fetch || o.fetchImpl });
    }, o);
  }

  return { create: create, openSession: openSession, forGame: forGame, deviceRef: deviceRef, splitRec: splitRec, BASE: BASE };
}));
