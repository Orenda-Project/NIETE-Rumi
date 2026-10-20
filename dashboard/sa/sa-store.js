/**
 * The phone's store for the battery (switch sa_engine): every session, event, task result and audio chunk, kept until
 * the server has it. IndexedDB "sa-engine" when the browser has it; a memory store when it does not (a private tab
 * without IndexedDB), which the page reports as "not kept on a reload".
 *
 *   sessions  key session_id         { session_id, battery_id, mode, created_at, snapshot, ended }
 *   events    key [session_id, seq]  the runner's events, synced:0|1
 *   results   key [session_id, task_id]  a task's result, synced:0|1
 *   blobs     key [session_id, task_id, part]  audio chunks, synced:0|1
 *
 * Every write resolves only once the transaction has completed, so the page draws the next screen after the answer is
 * on the phone. UMD: window.SAE.store in the browser, module.exports under Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.SAE = root.SAE || {}; root.SAE.store = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DB = 'sa-engine';
  var VERSION = 1;
  var STORES = {
    sessions: 'session_id',
    events: ['session_id', 'seq'],
    results: ['session_id', 'task_id'],
    blobs: ['session_id', 'task_id', 'part'],
  };

  function keyOf(name, row) {
    var k = STORES[name];
    return Array.isArray(k) ? k.map(function (f) { return row[f]; }) : row[k];
  }
  function sameSession(name, row, id) { return row.session_id === id; }

  /** The memory backend: the same API, for a browser without IndexedDB and for tests. */
  function memoryBackend() {
    var data = { sessions: {}, events: {}, results: {}, blobs: {} };
    return {
      kind: 'memory',
      put: function (name, rows) {
        rows.forEach(function (r) { data[name][JSON.stringify(keyOf(name, r))] = Object.assign({}, r); });
        return Promise.resolve();
      },
      all: function (name, sessionId) {
        var out = [];
        for (var k in data[name]) if (sessionId == null || sameSession(name, data[name][k], sessionId)) out.push(data[name][k]);
        return Promise.resolve(out);
      },
      del: function (name, sessionId) {
        for (var k in data[name]) if (sameSession(name, data[name][k], sessionId)) delete data[name][k];
        return Promise.resolve();
      },
    };
  }

  function req(r) {
    return new Promise(function (ok, no) { r.onsuccess = function () { ok(r.result); }; r.onerror = function () { no(r.error); }; });
  }

  /** The IndexedDB backend. */
  function idbBackend(idb) {
    var opening = new Promise(function (ok, no) {
      var r = idb.open(DB, VERSION);
      r.onupgradeneeded = function () {
        var db = r.result;
        Object.keys(STORES).forEach(function (name) {
          if (db.objectStoreNames.contains(name)) return;
          var os = db.createObjectStore(name, { keyPath: STORES[name] });
          if (name !== 'sessions') os.createIndex('by_session', 'session_id');
        });
      };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { no(r.error); };
      r.onblocked = function () { no(new Error('sa-store: open blocked')); };
    });
    function tx(name, modeRw, fn) {
      return opening.then(function (db) {
        return new Promise(function (ok, no) {
          var t = db.transaction(name, modeRw ? 'readwrite' : 'readonly');
          var out;
          t.oncomplete = function () { ok(out); };
          t.onerror = function () { no(t.error); };
          t.onabort = function () { no(t.error || new Error('sa-store: aborted')); };
          Promise.resolve(fn(t.objectStore(name))).then(function (v) { out = v; }, function (e) { try { t.abort(); } catch (_) { /* gone */ } no(e); });
        });
      });
    }
    return {
      kind: 'indexeddb',
      put: function (name, rows) { return tx(name, true, function (os) { rows.forEach(function (r) { os.put(r); }); }); },
      all: function (name, sessionId) {
        return tx(name, false, function (os) {
          if (sessionId == null) return req(os.getAll());
          if (name === 'sessions') return req(os.get(sessionId)).then(function (r) { return r ? [r] : []; });
          return req(os.index('by_session').getAll(sessionId));
        });
      },
      del: function (name, sessionId) {
        return tx(name, true, function (os) {
          if (name === 'sessions') { os.delete(sessionId); return null; }
          return req(os.index('by_session').getAllKeys(sessionId)).then(function (keys) { keys.forEach(function (k) { os.delete(k); }); });
        });
      },
    };
  }

  /**
   * open({ idb }) → store. idb: the IndexedDB factory (default the page's; null → memory).
   * A failed open falls back to memory and says so (store.kind).
   */
  function open(o) {
    var idb = o && 'idb' in o ? o.idb : (typeof indexedDB !== 'undefined' ? indexedDB : null);
    var be = idb ? idbBackend(idb) : memoryBackend();
    var probe = idb ? be.all('sessions').then(function () { return be; }, function () { return memoryBackend(); }) : Promise.resolve(be);
    return probe.then(function (b) { return wrap(b); });
  }

  function wrap(be) {
    var s = {
      kind: be.kind,
      putSession: function (row) { return be.put('sessions', [row]); },
      getSession: function (id) { return be.all('sessions', id).then(function (r) { return r[0] || null; }); },
      sessions: function () { return be.all('sessions'); },
      /** The runner's snapshot and its event, in one call per event (the reload point moves with the log). */
      appendEvent: function (e) { return be.put('events', [Object.assign({ synced: 0 }, e)]); },
      putResult: function (sessionId, r) { return be.put('results', [Object.assign({ synced: 0 }, r, { session_id: sessionId })]); },
      putChunk: function (sessionId, taskId, part, blob, meta) {
        return be.put('blobs', [Object.assign({ synced: 0 }, meta || {}, { session_id: sessionId, task_id: taskId, part: part, blob: blob })]);
      },
      events: function (id) { return be.all('events', id).then(function (r) { return r.sort(function (a, b) { return a.seq - b.seq; }); }); },
      results: function (id) { return be.all('results', id); },
      chunks: function (id, taskId) {
        return be.all('blobs', id).then(function (r) {
          return r.filter(function (c) { return taskId == null || c.task_id === taskId; }).sort(function (a, b) { return a.part - b.part; });
        });
      },
      /** What the server does not have yet. */
      pending: function (id) {
        return Promise.all([s.events(id), s.results(id), s.chunks(id)]).then(function (v) {
          var unsynced = function (x) { return !x.synced; };
          return { events: v[0].filter(unsynced), results: v[1].filter(unsynced), chunks: v[2].filter(unsynced) };
        });
      },
      /** The server has events up to seq and these task results. */
      markSynced: function (id, uptoSeq, taskIds) {
        return Promise.all([s.events(id), s.results(id)]).then(function (v) {
          var ev = v[0].filter(function (e) { return !e.synced && e.seq <= uptoSeq; }).map(function (e) { return Object.assign({}, e, { synced: 1 }); });
          var rs = v[1].filter(function (r) { return !r.synced && (taskIds || []).indexOf(r.task_id) >= 0; }).map(function (r) { return Object.assign({}, r, { synced: 1 }); });
          return Promise.all([ev.length ? be.put('events', ev) : null, rs.length ? be.put('results', rs) : null]);
        });
      },
      markChunksSynced: function (id, taskId) {
        return s.chunks(id, taskId).then(function (c) {
          var up = c.filter(function (x) { return !x.synced; }).map(function (x) { return Object.assign({}, x, { synced: 1 }); });
          return up.length ? be.put('blobs', up) : null;
        });
      },
      /** A session the server has in full: its rows leave the phone. */
      forget: function (id) {
        return Promise.all(['events', 'results', 'blobs', 'sessions'].map(function (n) { return be.del(n, id); }));
      },
    };
    return s;
  }

  return { DB: DB, VERSION: VERSION, open: open, memoryBackend: memoryBackend };
}));
