/*
 * Read aloud, live: the words light up as the child reads (window.WQLive, used by wq-challenge.js).
 *
 *   clean / same / align   a 1:1 port of the bot's scoring/text-norm.js (the study's Urdu folding, the one-edit
 *                          "same word" rule for words of 4+ letters, Levenshtein) — a parity test holds them equal.
 *   tracker(refTokens)     the passage word by word: the child reads a PREFIX of it, so the hypothesis is aligned to
 *                          the best-matching prefix (never to a repeated word further on). Each word is
 *                            ok    heard, and final (Soniox never changes a final word)
 *                            okp   heard, not final yet (may still change)
 *                            miss  passed over: "not caught" (shown soft, never as wrong — the alignment's
 *                                  "wrong word" flags were right only about 1 time in 4 on children's reading)
 *                            none  not reached
 *   open(opts)             the Soniox real-time WebSocket with a temporary key from the bot: the key travels in the
 *                          first message (never in a URL); audio is the MediaRecorder's own webm/opus chunks
 *                          ("auto"); {"type":"finalize"} then an empty frame ends it. Any failure calls onFail once
 *                          and the page carries on with the upload path.
 */
(function () {
  'use strict';

  // ── text-norm.js, ported ──────────────────────────────────────────────────────────────────────────
  var UR_MAP = { 'ي': 'ی', 'ك': 'ک', 'ه': 'ہ', 'ۂ': 'ہ', 'ۀ': 'ہ', 'ے': 'ی', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ؤ': 'و', 'ئ': 'ی', 'ة': 'ہ', 'ھ': 'ہ' };
  var DIAC = /[ً-ٰٟۖ-ۭ​-‏]/g;
  var PUNC = /[؀-؅،؛؟٪-٭۔.,!?;:"'()\-–—«»]/g;

  function clean(w) {
    var s = String(w == null ? '' : w).replace(DIAC, '').replace(PUNC, '');
    s = s.replace(/[يكهۂۀےأإآؤئةھ]/g, function (c) { return UR_MAP[c] || c; });
    return s.trim().toLowerCase();
  }

  function same(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
    var i;
    if (a.length === b.length) {
      var d = 0;
      for (i = 0; i < a.length; i += 1) if (a[i] !== b[i]) d += 1;
      return d === 1;
    }
    var s = a.length < b.length ? a : b;
    var l = a.length < b.length ? b : a;
    for (i = 0; i < l.length; i += 1) if (l.slice(0, i) + l.slice(i + 1) === s) return true;
    return false;
  }

  function table(ref, hyp, eq) {
    var n = ref.length; var m = hyp.length; var D = []; var i; var j;
    for (i = 0; i <= n; i += 1) { D.push(new Array(m + 1)); D[i][0] = i; }
    for (j = 0; j <= m; j += 1) D[0][j] = j;
    for (i = 1; i <= n; i += 1) {
      for (j = 1; j <= m; j += 1) {
        var c = eq(ref[i - 1], hyp[j - 1]) ? 0 : 1;
        D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + c);
      }
    }
    return D;
  }

  function back(D, ref, hyp, eq, i0) {
    var i = i0; var j = hyp.length; var ins = 0;
    var status = []; var hypIdx = []; var k;
    for (k = 0; k < ref.length; k += 1) { status.push('omit'); hypIdx.push(-1); }
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (eq(ref[i - 1], hyp[j - 1]) ? 0 : 1)) {
        status[i - 1] = eq(ref[i - 1], hyp[j - 1]) ? 'correct' : 'sub';
        hypIdx[i - 1] = j - 1; i -= 1; j -= 1;
      } else if (i > 0 && D[i][j] === D[i - 1][j] + 1) {
        status[i - 1] = 'omit'; i -= 1;
      } else {
        ins += 1; j -= 1;
      }
    }
    return { status: status, hypIdx: hypIdx, ins: ins };
  }

  /** text-norm.align: the whole passage against the whole hypothesis. */
  function align(ref, hyp, eq) {
    var e = eq || same;
    return back(table(ref, hyp, e), ref, hyp, e, ref.length);
  }

  /** The child read a prefix: end the alignment at the passage word the hypothesis matches best (the earliest on a tie). */
  function alignPrefix(ref, hyp, eq) {
    var e = eq || same;
    var D = table(ref, hyp, e); var m = hyp.length; var best = 0; var i;
    for (i = 1; i <= ref.length; i += 1) if (D[i][m] < D[best][m]) best = i;
    return back(D, ref, hyp, e, best);
  }

  // ── the passage, word by word ─────────────────────────────────────────────────────────────────────
  // Soniox tokens are pieces of words; a word starts on a piece that begins with a space (as text-norm.wordsFromTokens).
  function words(text) {
    var out = []; var rx = /\S+/g; var m;
    while ((m = rx.exec(text))) out.push({ raw: m[0], w: clean(m[0]), at: m.index, end: m.index + m[0].length });
    return out.filter(function (x) { return x.w; });
  }

  function tracker(refTokens) {
    var raw = (refTokens || []).filter(function (x) { return String(x).trim(); });
    var ref = raw.map(clean);
    var st = { F: '', N: '', fin: [], done: false };   // fin: each final piece's offset in F and its end_ms
    function endMsAt(charEnd) {
      var out = null;
      for (var k = 0; k < st.fin.length && st.fin[k].at < charEnd; k += 1) out = st.fin[k].endMs;
      return out;
    }
    function view() {
      var all = st.F + st.N;
      var hw = words(all);
      var hyp = hw.map(function (x) { return x.w; });
      // A word is final when all of it is in the final text and no non-final piece carries it on.
      var final = hw.map(function (x) { return x.end < st.F.length || (x.end === st.F.length && (st.done || !st.N || /^\s/.test(st.N))); });
      var a = alignPrefix(ref, hyp);
      var reachedFinal = 0; var i;
      for (i = 0; i < ref.length; i += 1) if (a.status[i] !== 'omit' && a.hypIdx[i] >= 0 && final[a.hypIdx[i]]) reachedFinal = i + 1;
      var marks = []; var correct = 0;
      for (i = 0; i < ref.length; i += 1) {
        var h = a.hypIdx[i];
        if (a.status[i] === 'correct' && final[h]) { marks.push('ok'); correct += 1; }
        else if (a.status[i] === 'correct') marks.push('okp');
        else if (i < reachedFinal) marks.push('miss');
        else marks.push('none');
      }
      var next = 0;
      for (i = 0; i < ref.length; i += 1) if (marks[i] !== 'none') next = i + 1;
      var lastOk = ref.length > 0 && marks[ref.length - 1] === 'ok';
      // heard = confirmed + not yet confirmed: Soniox confirms words seconds after they are said, so the bar and
      // the "keep going" nudge follow what is heard; the stored count is confirmed words only.
      var heardOk = 0;
      for (i = 0; i < ref.length; i += 1) if (marks[i] === 'ok' || marks[i] === 'okp') heardOk += 1;
      var lastHeard = ref.length > 0 && (marks[ref.length - 1] === 'ok' || marks[ref.length - 1] === 'okp');
      var endMs = lastOk ? endMsAt(hw[a.hypIdx[ref.length - 1]].end) : null;
      return { marks: marks, correct: correct, heardOk: heardOk, attempted: reachedFinal, next: next < ref.length ? next : -1, finished: lastOk, lastHeard: lastHeard, endMs: endMs, heard: hyp.length };
    }
    return {
      words: raw,
      /** One Soniox message's tokens: finals are appended for good; the non-finals replace the last ones. */
      push: function (tokens) {
        var nf = '';
        (tokens || []).forEach(function (t) {
          var tx = String((t && t.text) || '');
          if (tx === '<fin>' || tx === '<end>') return;
          if (t.is_final) {
            st.fin.push({ at: st.F.length, endMs: Number(t.end_ms) || 0 });
            st.F += tx;
          } else nf += tx;
        });
        st.N = nf;
        return view();
      },
      end: function () { st.N = ''; st.done = true; return view(); },
      view: view,
    };
  }

  // ── the stream ────────────────────────────────────────────────────────────────────────────────────
  var OPEN_WAIT_MS = 4000;
  var BACKLOG_BYTES = 64 * 1024;   // ≈ 15 s of opus the network has not taken: the uplink has stalled
  var FINISH_WAIT_MS = 2000;
  var QUEUE_MAX = 40;

  function open(o) {
    var WS = (o && o.WebSocket) || window.WebSocket;
    var state = 'opening'; var queue = []; var failed = false; var finishedCb = null; var opened = false;
    var sock;
    function fail(err) {
      if (failed || state === 'finished') return;
      failed = true; state = 'failed';
      try { sock.close(); } catch (e) { /* already closed */ }
      if (o.onFail) o.onFail(err);
    }
    try { sock = new WS(o.ws); } catch (e) { setTimeout(function () { fail('socket'); }, 0); return { send: function () {}, finish: function (cb) { cb(); }, state: function () { return 'failed'; } }; }
    var wait = setTimeout(function () { if (!opened) fail('open_timeout'); }, o.openWaitMs || OPEN_WAIT_MS);
    sock.onopen = function () {
      opened = true; clearTimeout(wait);
      if (failed) return;
      state = 'open';
      sock.send(JSON.stringify({ api_key: o.api_key, model: o.model, audio_format: 'auto', language_hints: [o.lang], language_hints_strict: true }));
      queue.forEach(function (c) { sock.send(c); });
      queue = [];
    };
    sock.onmessage = function (e) {
      var m = null;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (!m) return;
      if (m.error_code) { fail('soniox_' + String(m.error_code).replace(/[^0-9a-z_]/gi, '').slice(0, 12)); return; }
      if (m.tokens && m.tokens.length && o.onTokens) o.onTokens(m.tokens);
      if (m.finished) {
        state = 'finished';
        try { sock.close(); } catch (err) { /* fine */ }
        if (finishedCb) { var cb = finishedCb; finishedCb = null; cb(); }
      }
    };
    sock.onerror = function () { fail('error'); };
    sock.onclose = function (e) { if (state !== 'finished' && state !== 'ending') fail('closed_' + ((e && e.code) || 0)); else if (state === 'ending' && finishedCb) { var cb = finishedCb; finishedCb = null; cb(); } };
    return {
      send: function (chunk) {
        if (failed || !chunk) return;
        if (state === 'opening') { if (queue.length < QUEUE_MAX) queue.push(chunk); else fail('open_timeout'); return; }
        if (state !== 'open') return;
        if ((sock.bufferedAmount || 0) > BACKLOG_BYTES) { fail('backlog'); return; }
        sock.send(chunk);
      },
      /** Ask for the last words and end the stream; cb runs once, at "finished" or after FINISH_WAIT_MS. */
      finish: function (cb) {
        if (failed || state !== 'open') { cb(); return; }
        state = 'ending';
        var called = false;
        var done = function () { if (!called) { called = true; cb(); } };
        finishedCb = done;
        setTimeout(done, o.finishWaitMs || FINISH_WAIT_MS);
        try { sock.send('{"type":"finalize"}'); sock.send(''); } catch (e) { done(); }
      },
      state: function () { return state; },
    };
  }

  window.WQLive = { clean: clean, same: same, align: align, alignPrefix: alignPrefix, tracker: tracker, open: open };
})();
