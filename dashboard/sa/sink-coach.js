/**
 * The coach surface's sink for the battery's sync (switch sa_engine; the routes behind portal_child_test_sa): the
 * engine's putBatch / presignAudio / registerAudio as the portal relay's /api/portal/leader/child-test/sa/session/:id/*
 * calls, with the coach's own session cookie (same origin). The engine never sees a coach credential.
 *
 * A signed-out coach (401/403) or a switched-off route (404) is a failure the sync retries later: nothing is lost.
 * UMD: window.SAE.sinks.coach in the browser, module.exports under Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else { root.SAE = root.SAE || {}; root.SAE.sinks = root.SAE.sinks || {}; root.SAE.sinks.coach = factory(root).create; }
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var BASE = '/api/portal/leader/child-test/sa';

  /** A recording's id is "<task_id>" or "<task_id>/<item_id>" (a spoken answer per question). */
  function splitRec(id) {
    var i = String(id).indexOf('/');
    return i < 0 ? { taskId: id, itemId: undefined } : { taskId: id.slice(0, i), itemId: id.slice(i + 1) };
  }

  function create(o) {
    o = o || {};
    var base = o.base || BASE;
    var f = o.fetch || function (u, init) { return root.fetch(u, init); };

    function post(sessionId, path, body) {
      return Promise.resolve(f(base + '/session/' + encodeURIComponent(sessionId) + path, {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      })).then(function (res) {
        if (!res.ok) { var e = new Error('coach sink ' + path + ' ' + res.status); e.status = res.status; throw e; }
        return res.json();
      });
    }

    return {
      putBatch: function (b) {
        return post(b.session_id, '/batch', { seqFrom: b.seq_from, seqTo: b.seq_to, events: b.events, results: b.results })
          .then(function (r) { return { ok: true, acked_to: typeof r.ackedTo === 'number' ? r.ackedTo : b.seq_to }; });
      },
      presignAudio: function (a) {
        var s = splitRec(a.task_id);
        return post(a.session_id, '/presign', { taskId: s.taskId, itemId: s.itemId, mime: a.mime, bytes: a.bytes })
          .then(function (r) { return { url: r.url, key: r.key }; });
      },
      registerAudio: function (a) {
        var s = splitRec(a.task_id);
        return post(a.session_id, '/register', { taskId: s.taskId, itemId: s.itemId, key: a.key, bytes: a.bytes, durationMs: a.duration_ms });
      },
      status: function (sessionId) {
        return Promise.resolve(f(base + '/session/' + encodeURIComponent(sessionId) + '/status', { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } }))
          .then(function (res) { return res.ok ? res.json() : null; });
      },
    };
  }

  return { create: create, splitRec: splitRec, BASE: BASE };
}));
