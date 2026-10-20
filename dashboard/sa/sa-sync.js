/**
 * The battery's upload queue (switch sa_engine): what is on the phone goes to the surface's server when the network
 * is there, idempotently, with a status the page can show.
 *
 * The surface supplies the sink (the engine owns no server contract):
 *   putBatch({ session_id, seq_from, seq_to, events, results }) → { ok, acked_to? }   upsert on (session_id, seq) and
 *                                                                                    (session_id, task_id)
 *   presignAudio({ session_id, task_id, mime, bytes }) → { url, key }
 *   registerAudio({ session_id, task_id, key, bytes, duration_ms })
 * A batch is sent again until acknowledged (the server's upsert makes a repeat harmless); a task's audio goes up only
 * once its recording is closed (a chunk marked final), as one file. A failure waits 2 s, then doubling to 60 s; the
 * browser's online event and every new event (poke) try at once.
 *
 * status() → { state: 'synced'|'pending'|'offline'|'error', pending_events, pending_audio, last_ok_at }
 * UMD: window.SAE.sync in the browser, module.exports under Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else { root.SAE = root.SAE || {}; root.SAE.sync = factory(root); }
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var BATCH = 200;
  var MIN_WAIT = 2000;
  var MAX_WAIT = 60000;

  function defaultJoin(chunks, mime) {
    return new root.Blob(chunks.map(function (c) { return c.blob; }), { type: mime });
  }
  function defaultPut(url, body, mime) {
    return root.fetch(url, { method: 'PUT', body: body, headers: { 'Content-Type': mime } }).then(function (r) {
      if (!r.ok) throw new Error('upload ' + r.status);
    });
  }

  /**
   * create({ store, sink, session_id, onStatus, online, put, join, timers }) → sync.
   * online() (default navigator.onLine), put(url, body, mime) the audio upload, join(chunks, mime) → body.
   */
  function create(o) {
    var store = o.store;
    var sink = o.sink;
    var id = o.session_id;
    var online = o.online || function () { return !root.navigator || root.navigator.onLine !== false; };
    var put = o.put || defaultPut;
    var join = o.join || defaultJoin;
    var timers = o.timers || { set: function (f, ms) { return setTimeout(f, ms); }, clear: function (h) { clearTimeout(h); } };
    var st = { state: 'pending', pending_events: 0, pending_audio: 0, last_ok_at: null, last_error: null };
    var running = null;
    var again = false;
    var wait = MIN_WAIT;
    var timer = null;
    var stopped = false;

    function emit(next) {
      for (var k in next) st[k] = next[k];
      if (o.onStatus) o.onStatus(status());
    }
    function status() { return { state: st.state, pending_events: st.pending_events, pending_audio: st.pending_audio, last_ok_at: st.last_ok_at }; }

    function audioTasks(chunks) {
      var by = {};
      chunks.forEach(function (c) { (by[c.task_id] = by[c.task_id] || []).push(c); });
      return Object.keys(by).filter(function (t) { return by[t].some(function (c) { return c.final; }); }).map(function (t) {
        return { task_id: t, chunks: by[t].sort(function (a, b) { return a.part - b.part; }) };
      });
    }

    function once() {
      return store.pending(id).then(function (p) {
        var audio = audioTasks(p.chunks);
        emit({ pending_events: p.events.length + p.results.length, pending_audio: audio.length });
        if (!p.events.length && !p.results.length && !audio.length) { emit({ state: 'synced' }); return false; }
        if (!online()) { emit({ state: 'offline' }); return false; }
        var ev = p.events.slice(0, BATCH);
        var send = Promise.resolve();
        if (ev.length || p.results.length) {
          var seqTo = ev.length ? ev[ev.length - 1].seq : 0;
          var clean = function (x) { var y = {}; for (var k in x) if (k !== 'synced') y[k] = x[k]; return y; };
          send = Promise.resolve(sink.putBatch({
            session_id: id, seq_from: ev.length ? ev[0].seq : null, seq_to: ev.length ? seqTo : null,
            events: ev.map(clean), results: p.results.map(clean),
          })).then(function (r) {
            if (!r || r.ok === false) throw new Error('batch refused');
            var acked = typeof r.acked_to === 'number' ? Math.min(r.acked_to, seqTo) : seqTo;
            return store.markSynced(id, acked, p.results.map(function (x) { return x.task_id; }));
          });
        }
        return send.then(function () {
          return audio.reduce(function (chain, a) {
            return chain.then(function () { return upload(a); });
          }, Promise.resolve());
        }).then(function () { return true; });
      });
    }

    function upload(a) {
      var head = a.chunks[0];
      var fin = a.chunks.filter(function (c) { return c.final; })[0];
      var mime = head.mime || 'audio/webm';
      var body = join(a.chunks.filter(function (c) { return c.blob != null; }), mime);
      var bytes = body && (body.size != null ? body.size : body.length) || 0;
      return Promise.resolve(sink.presignAudio({ session_id: id, task_id: a.task_id, mime: mime, bytes: bytes })).then(function (pre) {
        if (!pre || !pre.url || !pre.key) throw new Error('no presign');
        return Promise.resolve(put(pre.url, body, mime)).then(function () {
          return sink.registerAudio({ session_id: id, task_id: a.task_id, key: pre.key, bytes: bytes, duration_ms: fin.duration_ms || null });
        });
      }).then(function () { return store.markChunksSynced(id, a.task_id); });
    }

    function schedule(ms) {
      if (stopped) return;
      if (timer) timers.clear(timer);
      timer = timers.set(function () { timer = null; flush(); }, ms);
    }

    /** Send everything pending now; resolves when this round is over. */
    function flush() {
      if (stopped) return Promise.resolve(status());
      if (running) { again = true; return running; }
      var rounds = 0;
      running = (function loop() {
        again = false;
        return once().then(function (more) {
          if ((more || again) && ++rounds < 50) return loop();
          return null;
        });
      }()).then(function () {
        wait = MIN_WAIT;
        if (st.state !== 'offline') emit({ state: 'synced', last_ok_at: new Date().toISOString() });
        else schedule(wait);
      }, function (e) {
        emit({ state: online() ? 'error' : 'offline', last_error: String(e && e.message || e) });
        schedule(wait);
        wait = Math.min(MAX_WAIT, wait * 2);
      }).then(function () { running = null; return status(); });
      return running;
    }

    var onOnline = function () { wait = MIN_WAIT; flush(); };
    if (root.addEventListener && !o.timers) root.addEventListener('online', onOnline);

    return {
      flush: flush,
      /** A new event is on the phone: try soon. */
      poke: function () { if (!running && !timer) schedule(0); else again = true; },
      status: status,
      stop: function () {
        stopped = true;
        if (timer) timers.clear(timer);
        if (root.removeEventListener) root.removeEventListener('online', onOnline);
      },
    };
  }

  return { create: create, BATCH: BATCH, MIN_WAIT: MIN_WAIT, MAX_WAIT: MAX_WAIT };
}));
