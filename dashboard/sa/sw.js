/**
 * The battery's service worker, scope /sa/ (switch sa_engine): the child's page keeps working when the network goes
 * down mid-child. Served no-cache by routes/sa-engine.routes.js; it never touches /wq/'s or the portal's requests.
 *
 *   the engine's files and play.html   network first (3 s), else the cached copy: an update reaches an online phone,
 *                                      an offline phone still opens the page
 *   the battery file and Jugnu's clips cache first (they never change under one URL: the clip name is a hash)
 *   anything else (the sink's /api calls, other paths)  not touched
 *
 * The page asks for a session's files with postMessage({ type: 'prepare', urls }) on a MessageChannel and gets back
 * { ok, cached, missing[] }; "ready offline" is shown only when missing is empty.
 */
'use strict';

var VERSION = 'sa-1';
var CORE = 'sa-core-' + VERSION;
var SESSION = 'sa-session-v1';
var CORE_FILES = ['play.html', 'sa-core.js', 'sa-store.js', 'sa-voice.js', 'sa-ui.js', 'sa-sync.js', 'sa-rec.js',
  'sa-engine.js', 'sa-offline.js', 'sa-play.js', 'sa.css', 'sink-coach.js', 'sink-game.js', 'skin-game.css', 'skin-game.js'];
var NETWORK_WAIT_MS = 3000;

/** Which way a request is answered: 'core' | 'static' | null (not ours). */
function strategyFor(url, method, origin) {
  if (method !== 'GET') return null;
  var u = new URL(url);
  if (u.origin !== origin) return null;
  var p = u.pathname;
  if (/^\/sa\/v\d+\//.test(p) || /^\/sa\/batteries\//.test(p) || /\.(mp3|m4a|ogg|webp|png|woff2)$/.test(p)) {
    return /^\/(sa|wq)\//.test(p) ? 'static' : null;
  }
  if (/^\/sa\/[^/]+\.(js|css|html|json)$/.test(p) && p !== '/sa/sw.js') return 'core';
  return null;
}

if (typeof module === 'object' && module.exports) {
  module.exports = { strategyFor: strategyFor, CORE_FILES: CORE_FILES, CORE: CORE, SESSION: SESSION };
} else {
  self.addEventListener('install', function (e) {
    e.waitUntil(caches.open(CORE).then(function (c) {
      // One by one: a file the game lane has not shipped yet must not stop the worker installing.
      return Promise.all(CORE_FILES.map(function (f) { return c.add('/sa/' + f).catch(function () { return null; }); }));
    }).then(function () { return self.skipWaiting(); }));
  });

  self.addEventListener('activate', function (e) {
    e.waitUntil(caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('sa-core-') === 0 && k !== CORE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); }));
  });

  var fromCache = function (req) {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) {
      return hit || new Response('offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    });
  };

  self.addEventListener('fetch', function (e) {
    var how = strategyFor(e.request.url, e.request.method, self.location.origin);
    if (!how) return;
    if (how === 'static') {
      e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
        return hit || fetch(e.request).then(function (res) {
          if (res.ok) { var copy = res.clone(); caches.open(SESSION).then(function (c) { c.put(e.request, copy); }); }
          return res;
        });
      }).catch(function () { return fromCache(e.request); }));
      return;
    }
    e.respondWith(new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(fromCache(e.request)); } }, NETWORK_WAIT_MS);
      fetch(e.request).then(function (res) {
        if (res.ok) {
          var copy = res.clone();
          var key = new URL(e.request.url); key.search = '';
          caches.open(CORE).then(function (c) { c.put(key.toString(), copy); });
        }
        if (!done) { done = true; clearTimeout(timer); resolve(res.ok ? res : fromCache(e.request).then(function (hit) { return hit.status === 503 ? res : hit; })); }
      }, function () {
        if (!done) { done = true; clearTimeout(timer); resolve(fromCache(e.request)); }
      });
    }));
  });

  self.addEventListener('message', function (e) {
    var d = e.data || {};
    var port = e.ports && e.ports[0];
    if (d.type !== 'prepare' || !port) return;
    var urls = (d.urls || []).filter(function (u) { return typeof u === 'string'; });
    e.waitUntil(caches.open(SESSION).then(function (c) {
      return Promise.all(urls.map(function (u) {
        return caches.match(u, { ignoreSearch: true }).then(function (hit) {
          if (hit) return null;
          return fetch(u).then(function (res) { if (!res.ok) throw new Error(String(res.status)); return c.put(u, res); })
            .then(function () { return null; }, function () { return u; });
        });
      }));
    }).then(function (miss) {
      var missing = miss.filter(Boolean);
      port.postMessage({ ok: missing.length === 0, cached: urls.length - missing.length, missing: missing });
    }, function (err) {
      port.postMessage({ ok: false, cached: 0, missing: urls, error: String(err) });
    }));
  });
}
