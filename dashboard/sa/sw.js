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
 * { ok, cached, missing[] }; "ready offline" is shown only when missing is empty. The files are fetched six at a time,
 * and one that fails (a 429 from a busy tunnel, a dropped request) is tried once more after a short pause.
 */
'use strict';

// sa-3: the install of sa-2 may have kept the portal's page for an engine file the folder did not have yet.
// sa-4: the prepare queue (six at a time, one retry): phones take the new worker and the new engine files.
var VERSION = 'sa-4';
var CORE = 'sa-core-' + VERSION;
// v2: v1 may hold the portal's page cached as a clip (a missing clip used to answer 200 HTML); it is dropped.
// v3: letter-sound clips re-made under the same keys (one held "ssss", not "s s s"); a kept copy would play the old one.
var SESSION = 'sa-session-v3';
var CORE_FILES = ['play.html', 'sa-core.js', 'sa-store.js', 'sa-voice.js', 'sa-ui.js', 'sa-sync.js', 'sa-rec.js',
  'sa-engine.js', 'sa-mic.js', 'sa-offline.js', 'sa-page.js', 'sa.css', 'sink-coach.js', 'sink-game.js', 'skin-game.css', 'skin-game.js'];
var NETWORK_WAIT_MS = 3000;
var PREFETCH_AT_ONCE = 6;
var RETRY_MS = 1500;

/**
 * prefetch(urls, { fetch, match, put, ok, limit?, retryMs? }) → Promise<missing urls>: each url not already kept
 * (match) is fetched, at most `limit` at a time, kept (put) when ok(url, res); a failure is tried once more after
 * retryMs. Never rejects.
 */
function prefetch(urls, o) {
  var limit = o.limit || PREFETCH_AT_ONCE;
  var wait = o.retryMs != null ? o.retryMs : RETRY_MS;
  var queue = urls.slice();
  var missing = [];
  function once(u) {
    return Promise.resolve().then(function () { return o.fetch(u); }).then(function (res) {
      if (!o.ok(u, res)) throw new Error(String(res && res.status));
      return Promise.resolve(o.put(u, res)).then(function () { return true; });
    }).then(null, function () { return false; });
  }
  function one(u) {
    return Promise.resolve().then(function () { return o.match(u); }).then(null, function () { return null; }).then(function (hit) {
      if (hit) return true;
      return once(u).then(function (got) {
        return got ? true : new Promise(function (r) { setTimeout(r, wait); }).then(function () { return once(u); });
      });
    }).then(function (got) { if (!got) missing.push(u); });
  }
  function worker() { var u = queue.shift(); return u === undefined ? null : one(u).then(worker); }
  var workers = [];
  for (var i = 0; i < Math.min(limit, urls.length); i++) workers.push(worker());
  return Promise.all(workers).then(function () { return urls.filter(function (u) { return missing.indexOf(u) >= 0; }); });
}

/** A response worth keeping: 2xx, and the type the URL is (a clip is audio, a battery JSON, an engine file not HTML). */
function cacheable(url, res) {
  if (!res || !res.ok) return false;
  var type = String((res.headers && res.headers.get && res.headers.get('content-type')) || '').toLowerCase();
  var p = new URL(url).pathname;
  if (/\.(mp3|m4a|ogg)$/.test(p)) return type.indexOf('audio/') === 0;
  if (/\.json$/.test(p)) return type.indexOf('json') >= 0;
  if (/\.html$/.test(p)) return type.indexOf('text/html') === 0;
  return type.indexOf('text/html') < 0;
}

/** One engine file into the install cache, only when it is one (a cold portal may answer its own page once). */
function installOne(cache, url, fetchFn) {
  return Promise.resolve().then(function () { return fetchFn(url, { cache: 'no-cache' }); })
    .then(function (res) { return cacheable(url, res) ? cache.put(url, res) : null; })
    .catch(function () { return null; });
}

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
  module.exports = { strategyFor: strategyFor, cacheable: cacheable, installOne: installOne, prefetch: prefetch, CORE_FILES: CORE_FILES, CORE: CORE, SESSION: SESSION };
} else {
  self.addEventListener('install', function (e) {
    e.waitUntil(caches.open(CORE).then(function (c) {
      // One by one: a file the game lane has not shipped yet must not stop the worker installing.
      return Promise.all(CORE_FILES.map(function (f) { return installOne(c, new URL('/sa/' + f, self.location.href).href, fetch); }));
    }).then(function () { return self.skipWaiting(); }));
  });

  self.addEventListener('activate', function (e) {
    e.waitUntil(caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return (k.indexOf('sa-core-') === 0 && k !== CORE) || (k.indexOf('sa-session-') === 0 && k !== SESSION); }).map(function (k) { return caches.delete(k); }));
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
          if (cacheable(e.request.url, res)) { var copy = res.clone(); caches.open(SESSION).then(function (c) { c.put(e.request, copy); }); }
          return res;
        });
      }).catch(function () { return fromCache(e.request); }));
      return;
    }
    e.respondWith(new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(fromCache(e.request)); } }, NETWORK_WAIT_MS);
      fetch(e.request).then(function (res) {
        if (cacheable(e.request.url, res)) {
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
      return prefetch(urls, {
        fetch: function (u) { return fetch(u); },
        match: function (u) { return caches.match(u, { ignoreSearch: true }); },
        put: function (u, res) { return c.put(u, res); },
        ok: function (u, res) { return cacheable(new URL(u, self.location.href).href, res); },
      });
    }).then(function (missing) {
      port.postMessage({ ok: missing.length === 0, cached: urls.length - missing.length, missing: missing });
    }, function (err) {
      port.postMessage({ ok: false, cached: 0, missing: urls, error: String(err) });
    }));
  });
}
