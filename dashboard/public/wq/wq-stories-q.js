/* Stories, second part (loaded by wq-stories.js at the same ?v=): Your turn, reading together sentence by sentence,
 * the questions, the done screen, the teacher's read-only questions. Copy follows the rules just below. */
/* Copy rules (this file's and wq-stories.js's): no test words (test, exam, assessment, امتحان, ٹیسٹ); gender-neutral آپ;
 ergative past agreeing with the story («آپ نے … پڑھ لی»); teacher is «ٹیچر», never the formal word; «دبائیں» not «ٹیپ کریں»;
 «کھویا ہوا» not «گم شدہ»; Urdu digits in Urdu prose; no U+00B7; every Urdu run in dir="rtl"; short lines. */
(function () {
  'use strict';
  var W = window, S = W.WQSTORIES, K = S && S._k;
  if (!K) return;
  var IC = K.IC, esc = K.esc, scr = K.scr, img = K.img, ic = K.ic, top = K.top, req = K.req, JG = K.JG;
  function sents(ws) {
    var out = [], a = 0;
    // the player's end test (wq-readalong.js sentenceOf), letter for letter; a silent word never ends a sentence
    ws.forEach(function (w, i) { if ((!w.silent && /[.!?\u06D4\u061F]["'\u201D\u2019)\u00BB]*$/.test(w.t)) || i === ws.length - 1) { out.push([a, i]); a = i + 1; } });
    return out;
  }
  S._sents = sents;
  // a long page's Your turn in parts: <= 40 words is one part; longer pages go by consecutive lines, <= 25 words a part
  function chunks(p, ln) {
    var n = (p.words || []).length, out = [], a = -1, z = -1, g = [], i;
    if (n <= 40) return [[0, n - 1]];
    ln.l.forEach(function (x) { g.push([x.i[0], x.i[x.i.length - 1]]); });
    if (ln.of.filter(function (x) { return x != null; }).length !== n) for (g = [], i = 0; i < n; i += 25) g.push([i, Math.min(n, i + 25) - 1]);
    g.forEach(function (x) {
      if (a >= 0 && x[1] - a + 1 > 25) { out.push([a, z]); a = -1; }
      if (a < 0) a = x[0];
      z = x[1];
    });
    out.push([a, z]);
    return out;
  }
  S._chunks = chunks;
  var T2 = {
    en: {
      done: 'I\'m done', readNow: 'Read it aloud!', keepGoing: 'Keep going!', checking: 'Listening…',
      netWait: 'Jugnu\'s voice is waiting for the internet…', gone: 'This story is not here any more.', micAgain: 'Try the mic again',
      more: 'More stories',
      denied: 'That\'s OK, let\'s listen with Jugnu', wellRead: 'Well read!', together: 'Let\'s read it together', echoB: 'Read it together', practise: 'Let\'s practise this word',
    },
    ur: {
      done: 'میں نے پڑھ لیا', readNow: 'اونچی آواز میں پڑھیں!', keepGoing: 'پڑھتے رہیں!', checking: 'آپ کی آواز سنی جا رہی ہے…',
      netWait: 'جگنو کی آواز انٹرنیٹ کا انتظار کر رہی ہے…', gone: 'یہ کہانی اب یہاں نہیں ہے۔', micAgain: 'مائیک پھر سے چلا کر دیکھیں',
      more: 'اور کہانیاں',
      denied: 'کوئی بات نہیں، جگنو کے ساتھ سنیں', wellRead: 'بہت اچھا پڑھا!', together: 'آئیں مل کر پڑھیں', echoB: 'آئیں مل کر پڑھیں', practise: 'آئیں، یہ لفظ پھر سے پڑھیں',
    },
  };
  ['en', 'ur'].forEach(function (l) { for (var k in T2[l]) K.T[l][k] = T2[l][k]; });

  // a book that is not here (unpublished, or a mistyped link): kind words and the way to the other stories
  S._gone = function (R) {
    var L = R.ctx.lang === 'ur' ? 'ur' : 'en', t = K.T[L];
    R.paint(scr('stories-gone', L, top(L, ic(t, 'back', t.back, '‹')) + img(JG + 'thinking.webp', 96, 96, 'wqs-jg') + '<p class="wqs-say">' + esc(t.gone) + '</p><button class="wqs-main" data-primary data-tap="back">' + esc(t.more) + '</button>', 'wqs-sheet'));
  };

  S._q = function (R) {
    var ctx = R.ctx, C = R.C, id = R.id, root = R.root, paint = R.paint, b = R.b, P = R.P, m = R.m, L = R.L, t = R.t;
    var eo = null, ck = [], ci = 0, sum = null, stopAll = 0, stream = null, D = null, dw = null, rd = null;
    // the reading moment (the book's read_fb: web_quiz_read_feedback): its file comes with this one, once
    if (b.read_fb && !W.WQMoment && !S._rfAsked) { S._rfAsked = 1; K.load('wq-moment.js', 'wq-moment.css', function () {}); }
    // this page's read answered after Your turn (wq-moment.js page(): small, and "Hear Jugnu say it" on a skipped word)
    function Mq(k, x) { return b.read_fb && W.WQMoment ? W.WQMoment.q(k, R, m, x) : ''; }
    function rfHtml(st) { return rd && rd.i === m.i ? Mq('page', { rd: rd, st: st, sents: sents }) : ''; }
    // the questions and the done screen come in their own file, the first time a child gets there
    function dv(v) {
      return function () {
        if (D) return D[v]();
        if (!dw) {
          dw = 1;
          K.load('wq-stories-d.js', 0, function () {
            dw = 0;
            if (S._d && !D) D = S._d(R);
            if (!live() || m.st !== (v === 'q' ? 'questions' : 'done')) return;
            if (D) D[v](); else paint(scr('stories-retry', L, top(L, ic(t, 'back', t.back, '‹')) + '<p class="wqs-say">' + esc(t.oops) + '</p><button class="wqs-main" data-primary data-tap="retry">' + esc(t.retry) + '</button>', 'wqs-sheet'));
          });
        }
      };
    }
    function live() { return R.live(); }
    // the mic is on only while a child reads: off when a read ends, the page or reader is left, or it comes too late
    function stopTracks(s) { try { s.getTracks().forEach(function (x) { x.stop(); }); } catch (e) {} }
    function free() { stopTracks(stream); stream = null; }
    var set0 = m.set, go0 = m.go;
    m.set = function (st) { if (st != 'reading' && st != 'echo') free(); return set0.apply(m, arguments); };
    m.go = function () { free(); return go0.apply(m, arguments); };
    // the page's lines after Your turn (the states below are reached only through this file): praise, a word to
    // practise, the kind words, Read it together
    R.ex = function (s, p) {
      var w = p.words && p.words[m.skip], h = '';
      var echo = b.lr3 && b.grade < 3 && p.audio && !R.keyNo && (s === 'together' || /^(read|practise)$/.test(s) && m.ratio <= 0.5);
      var rf = /^(read|practise|together)$/.test(s) ? rfHtml(s) : '';
      if (s === 'practise' && w) h = rf + '<p>' + esc(t.practise) + '</p><button class="wqs-word" data-tap="word" data-arg="' + m.skip + '"' + (p.audio ? ' data-sound data-trigger="tap"' : '') + ' lang="' + L + '" dir="' + (L === 'ur' ? 'rtl' : 'ltr') + '">' + (p.audio ? IC.spk + ' ' : '') + esc(w.t) + '</button>';
      else if (s === 'read' || s === 'practise') h = rf || '<p class="wqs-well">' + esc(t.wellRead) + '</p>';
      else if (s === 'together' && rf) h = rf + (rd.fb.zero ? '' : '<p>' + esc(t.together) + '</p>');
      else if (s === 'denied' || s === 'together') h = '<p>' + esc(t[s]) + '</p>';
      if (echo) h += '<button class="wqs-sec" data-tap="echo" data-sound data-trigger="tap">' + esc(rf ? Mq('withJ') : t.echoB) + '</button>';
      return h;
    };
    var micO = {
      lang: L, src: 'story', ev: ctx.ev, hash: !!b.steady, notice: { kid: ctx.kid, keep: !!b.lr3_keep },
      onStream: function (s) { if (m.st == 'mic' && R.live()) { free(); stream = s; m.granted(); } else stopTracks(s); },
      onDenied: function (why) { if (m.st !== 'mic') return; if (why === 'not_now') return micO.onNotNow(); m.denied(); },
      onNotNow: function () { if (m.st === 'mic') m.notNow(); },
    };
    function micScreen() {
      paint(scr('story-mic', L, top(L, ic(t, 'close', t.close, '✕')) + (m.dn ? '<p class="wqs-say">' + esc(t.micAgain) + '</p>' : '') + '<div data-mic></div>', 'wqs-sheet'));
      var el = root.querySelector('[data-mic]');
      W.WQLiveRead.askMic(el, micO);
      var g = el && el.querySelector('.lr-go');
      if (g) g.setAttribute('data-primary', '');
    }
    function spoken(ws) { return ws.filter(function (w) { return !w.silent; }); }
    function lrOn(ws, cb) {
      var p = P[m.i], o = {
        words: ws, image: p.image, lang: L, dir: b.dir, id: b.id + ':' + p.n, stream: stream, meter: 'none', record: false, counted: false,
        finish: { pct: 0.8, quiet_ms: 4000, tail_ms: 1000, quiet: true },
        copy: { done: t.done, readNow: t.readNow, keepGoing: t.keepGoing, checking: t.checking, wellRead: t.wellRead },
        getKey: function () { return req('POST', '/api/wq/lr/key', { st: ctx.token, kid: ctx.kid, book: b.id, page: p.n, lang: L }).then(function (r) { if (!r.ok || r.body.error) R.keyNo = 1; return r.body; }, function (x) { R.keyNo = 1; throw x; }); },
        onResult: cb, onFallback: function (why) {
          if (why !== 'key' && why !== 'rest') return;
          if (why === 'key') R.keyNo = 1;
          var el = why === 'rest' && root.querySelector('[data-lr]'), n = el && el.querySelector('.lr-nudge'), s;
          if (n && n.parentNode) n.parentNode.removeChild(n);
          eo = sum = null; m.voice();
          s = root.querySelector('[data-lrl]');
          if (s && n) s.appendChild(n);
        },
      };
      if (p.quality === 'low') o.playWord = null;
      return (R.lr = W.WQLiveRead.mount(root.querySelector('[data-lr]'), o));
    }

    function readScreen() {
      var p = P[m.i], LR = W.WQLiveRead, c, lh = '<div class="wqs-lr" data-lr></div>', st;
      if (!sum) { ck = S._chunks(p, S._lines(p)); ci = 0; stopAll = 0; sum = { words_total: 0, words_read: 0, skipped: 0, ms: 0, marks: [] }; }
      c = ck[ci];
      st = R.stage(p, (p.boxes_ok ? '' : img(p.image.url, p.image.w, p.image.h)) + lh);   // the live reader draws the picture itself on a boxed page
      paint(scr('story-read', L, top(L, ic(t, 'close', t.close, '✕')) + img(JG + 'hello.webp', 72, 72, 'wqs-jg wqs-g0', ' data-jg') +
        (R.mode() === 'z' || R.mode() === 'l' ? st : lh) + Mq('line') + '<button class="wqs-main wqs-done" data-primary data-tap="main">' + (LR.doneHtml && LR.COPY && LR.COPY[L] ? LR.doneHtml(LR.COPY[L]) : esc(t.done) + ' ' + IC.tick) + '</button>'));
      var z = R.mode() === 'z';
      // the camera frames every line of the part being read, whole (both edges, any writing direction), once, and holds
      // still while the child reads (a line's own zoom, or the larger-print floor, would push lines off the edge)
      if (z) { var LN = R.lines(), bs = [], seen = {}; for (var i = c[0]; i <= c[1]; i++) { var n = LN.of[i]; if (n != null && !seen[n]) { seen[n] = 1; bs = bs.concat(LN.l[n].bs); } } R.camTo(bs, 1); }
      else if (R.mode() === 'l') R.camTo([p.text_band.box], 1);
      var ws = p.words.slice(c[0], c[1] + 1), sw = spoken(ws);
      // the live reader is asked only the spoken words; its marks come back on the page's own word numbers
      var back = function (r) { var k = 0, mk = (r = r || {}).marks || []; r.marks = ws.map(function (w) { return w.silent ? 'silent' : mk[k++]; }); result(r); };
      if (!sw.length) return back({ words_total: 0 });
      try { lrOn(sw, back); } catch (e) { m.denied(); return; }
      var r0 = C.now();
      R.poll = C.set(function tick() {
        var v = R.lr && R.lr.view && R.lr.view(), g = root.querySelector('[data-jg]');
        if (v && g && LR.glowLevel) g.className = 'wqs-jg wqs-g' + LR.glowLevel(v);
        Mq('tick', { g: g, v: v, ms: C.now() - r0 });
        if (R.lr) R.poll = C.set(tick, 500);
      }, 500);
    }
    function result(r) {
      if (m.st !== 'reading') return;
      r = r || {};
      ['words_total', 'words_read', 'skipped', 'ms'].forEach(function (k) { sum[k] += +r[k] || 0; });
      sum.ended = r.ended; sum.marks = sum.marks.concat(r.marks || []);
      if (++ci < ck.length && !stopAll && r.ended !== 'hidden') { R.drop(); return readScreen(); }
      var s = sum;
      sum = null;
      var sk = [];
      s.marks.forEach(function (x, i) { if (x === 'skipped') sk.push(i); });
      R.pp('story_page_read', { words_total: s.words_total, words_read: s.words_read, skipped: s.skipped, ms: s.ms, ended: s.ended, skipped_words: sk, first: m.first[m.i] || 'read' }, m.i);
      rd = { s: s, i: m.i };
      m.result(s);
      // Jugnu's sound for it (the badge jingle; the soft chime after a 0-word try)
      if (rd.fb && W.WQMoment) W.WQMoment.sound(root.querySelector('[data-rf]'), rd.fb);
      Mq('after');
    }

    function eGo() {
      eo = { s: sents(P[m.i].words), k: 0, f: m.st };
      // the read gave the mic back: the live reader asks again inside this tap
      var LR = W.WQLiveRead, again = !stream && LR && LR.micAgain && LR.micAgain(), me = eo;
      if (again) again.then(function (s) { if (eo == me && m.st == 'echo' && R.live()) stream = s; else stopTracks(s); }, function () {});
      m.set('echo');
    }
    function eScreen() {
      var p = P[m.i];
      paint(scr('story-echo', L, top(L, ic(t, 'eend', t.close, '✕'), b.title, 1) +
        R.stage(p, (p.boxes_ok ? '' : img(p.image.url, p.image.w, p.image.h)) + '<div data-ra></div><div data-es></div><div class="wqs-lr" data-lr></div>') +
        '<button class="wqs-main" data-main data-primary data-tap="main" data-sound data-trigger="tap"></button>'));
      R.camTo(null);
      R.mount(p, { onEnd: function () { if (eo && !eo.ph) eMic(); }, onState: function (s) { if (s === 'error' && on) down(); } });
      eSay();
    }
    function eBtn() { var e = root.querySelector('[data-main]'); if (e) e.textContent = t[eo.pz ? 'listen' : 'pause']; }
    function eSay() {
      var x = eo.s[eo.k], sw = spoken(P[m.i].words.slice(x[0], x[1] + 1)), e = (sw[sw.length - 1] || {}).e_ms, el = root.querySelector('[data-es]');
      eo.ph = eo.pz = 0; eBtn();
      if (el) el.innerHTML = sw.map(function (w) { var q = w.box; return q ? '<i class="wqs-es" style="left:' + q[0] + 'px;top:' + q[1] + 'px;width:' + q[2] + 'px;height:' + q[3] + 'px"></i>' : ''; }).join('');
      R.camLine(x[0]);
      if (!R.pl) return eMic();
      R.pl.seekToWord(sw.length ? P[m.i].words.indexOf(sw[0]) : x[0]); R.pl.play(); watch();
      R.poll = C.set(function tk() {
        var a = R.pl && R.pl.audio;
        if (!eo || eo.ph) return;
        if (a && a.currentTime * 1000 >= e || R.pl.current > x[1]) return eMic();
        R.poll = C.set(tk, 40);
      }, 40);
    }
    function eMic() {
      var x = eo.s[eo.k], me;
      if (R.poll) C.clear(R.poll);
      R.poll = null; eo.ph = 1;
      if (R.pl) R.pl.pause();
      var sw = spoken(P[m.i].words.slice(x[0], x[1] + 1));
      if (!sw.length) return eNext();
      try { me = lrOn(sw, function () { if (eo && !eo.pz && R.lr === me) eNext(); }); } catch (e) { eNext(); }
    }
    function eNext() {
      if (R.lr) { try { R.lr.destroy(); } catch (e) {} R.lr = null; }
      if (++eo.k < eo.s.length) return eSay();
      eEnd(1);
    }
    function eEnd(all) {
      var f = eo.f;
      eo = null;
      if (all) { m.l[m.i] = 1; f = 'listened'; }
      m.set(f);
    }
    function eTog() {
      eo.pz = !eo.pz; eBtn();
      if (eo.pz) { if (!eo.ph) R.pl.pause(); else if (R.lr) R.lr.stop('pause'); }
      else if (!eo.ph) R.pl.play();
      else { if (R.lr) { try { R.lr.destroy(); } catch (e) {} R.lr = null; } eSay(); }
    }

    // ---- never a silent stall: the voice waiting for the internet, the picture, the page's place, a late tap ----
    // (the book's `steady`, setting web_quiz_stories_steady; without it every line below keeps today's reader)
    var on = !!b.steady, nt = 0, ns = -1, wq = {}, ask = {}, H = W.history;
    function aud() { return R.pl && R.pl.audio; }
    function lrl(h) { var e = root.querySelector('[data-lrl]'); if (e) e.innerHTML = h; }
    function line(x) { lrl('<p class="wqs-net" role="status">' + esc(t.netWait) + '</p>' + (x || '')); }
    // the voice stopped for the internet: the clock stops, the box rests, the button is Listen again, which fetches anew
    function down() {
      ns = -1;
      if (!live()) return;
      R.ac(); R.nw = 1;
      if (eo) eEnd();
      if (m.st === 'listening') { if (R.pl) R.pl.pause(); if (m.st === 'listening') m.set(m.l[m.i] ? 'listened' : 'paused'); }
      R.word(-1); line();
    }
    // while Jugnu reads: starved of data (readyState under HAVE_FUTURE_DATA) the clock stops at once; the kind line at
    // 3 s; the rest at 3 s once the voice had played (10 s while it first loads), or at once when the phone is offline.
    // Once it plays, the next page's voice and picture are warmed (never before the child's first Listen).
    function watch() {
      if (nt || !on) return;
      nt = C.set(function tk() {
        nt = 0;
        var a = aud(), w;
        if (!a || !live() || !(m.st === 'listening' || eo && !eo.ph && !eo.pz)) { ns = -1; return; }
        if (a.currentTime > 0 && !wq[m.i]) warm();
        if (a.readyState < 3 && !a.paused) {
          if (ns < 0) { ns = C.now(); R.ac(); }
          w = C.now() - ns;
          if (w >= (a.currentTime > 0 ? 3000 : 10000) || W.navigator && W.navigator.onLine === false) return down();
          if (w >= 3000) line();
        } else if (ns >= 0) { ns = -1; lrl(''); if (m.st === 'listening') R.ac(1); }
        nt = C.set(tk, 500);
      }, 500);
    }
    // the next page's picture and voice, once this page's voice plays (without the setting: wq-stories.js, on every page drawn)
    function warm() {
      var nx = P[m.i + 1];
      wq[m.i] = 1;
      if (!nx) return;
      try { new W.Image().src = nx.image.url; } catch (e) { /* the turn fetches it */ }
      try { if (nx.audio && W.WQReadAlong.preload) W.WQReadAlong.preload({ id: b.id + '/p' + nx.n, audio: nx.audio, words: nx.words }); } catch (e) { /* the tap fetches it */ }
    }
    R.os = function (s, i) {   // with the setting only (without it wq-stories.js keeps today's page without its voice)
      if (!on || !live() || i !== m.i) return;
      if (s === 'playing') { if (!R.nw) lrl(''); watch(); } else if (s === 'error') down();
    };
    // the page's place in the address (#story/<id>/p<N>): a closed in-app browser reopened lands on the same page
    function here() {
      if (on && !R.tch && live() && /^#story\//.test(W.location.hash || '') && !/^(questions|done)$/.test(m.st)) try { H.replaceState(null, '', '#story/' + id + '/p' + (m.i + 1)); } catch (e) { /* the page still turns */ }
    }
    var go1 = m.go;
    m.go = function () { var r = go1.apply(m, arguments); here(); return r; };
    // a page served before its voice was ready: one quiet look again after 3 s; offline, the line and Try again
    // (without the setting: wq-stories.js's own look again, the line never)
    function late(i) {
      var p = P[i];
      if (!on || !p || p.audio || p.is_picture || ask[i]) return;
      ask[i] = 1;
      C.set(function () {
        req('GET', R.tch ? ctx.bookUrl : '/api/wq/stories/book/' + K.enc(id) + '/h/' + K.enc(ctx.token) + '?kid=' + K.enc(ctx.kid)).then(function (r) {
          var np = r.ok && r.body.pages && r.body.pages[i];
          if (!r.ok) throw r;
          if (!np || !np.audio || !W.WQReadAlong || !live()) return;
          P[i].audio = np.audio; P[i].words = np.words || P[i].words;
          if (m.i === i && m.st === 'idle') R.re();
        }).catch(function () { if (live() && m.i === i) { ask[i] = 0; line('<button class="wqs-again" data-tap="late">' + esc(t.retry) + '</button>'); } });
      }, 3000);
    }
    // until the page's picture has loaded, the stage shows the page's words and "Opening…" under it
    function ph() {
      var f = root.querySelector('[data-ph]'), s = root.querySelector('[data-stage]'), im = s && s.querySelectorAll ? s.querySelectorAll('img') : [], k;
      if (!f || f._w) return;
      f._w = 1;
      var hide = function () { f.style.display = 'none'; };
      for (k = 0; k < im.length; k++) { if (im[k].complete && im[k].naturalWidth) return hide(); if (im[k].addEventListener) im[k].addEventListener('load', hide); }
    }
    R.ph = ph;
    // the main button keeps its old meaning (and colour) for 600 ms after it changes: a late tap never lands on the new one
    R.sy = function (mb, lab) {
      var o = R.ml;
      ph();
      if (mb !== R.mb) { R.mb = mb; late(m.i); }   // a page drawn
      R.ml = lab;
      if (!on || o == null || o === lab) return;
      R.lk = C.now(); mb.className = 'wqs-main wqs-' + o + ' wqs-lk';
      C.set(function () { if (R.ml === lab && / wqs-lk/.test(mb.className)) mb.className = 'wqs-main wqs-' + lab; }, 600);
    };
    // window events while this book is open: all of them go when the book is left (R.kill), or at the latest the first time one fires after
    var wl = [];
    function onW(n, f) { var g = function () { if (!live()) return R.un(); f(); }; wl.push([n, g]); W.addEventListener(n, g); }
    R.un = function () { wl.forEach(function (x) { W.removeEventListener(x[0], x[1]); }); wl = []; };
    // a clip already buffered to its end plays on offline
    function full(a) { try { return a.buffered.end(a.buffered.length - 1) >= a.duration - 0.2; } catch (e) { return false; } }
    if (on && W.addEventListener) {
      if (root.setAttribute) root.setAttribute('data-steady', '');
      onW('offline', function () { if ((m.st === 'listening' || eo) && !full(aud())) down(); });
      onW('online', function () { if ((R.nw || root.querySelector('.wqs-bad')) && /^(idle|paused|listened|together|denied|read|practise|picture)$/.test(m.st)) { R.nw = 0; R.re(); } });
      onW('pagehide', function () { free(); R.fl(1); });   // keepalive: the send outlives the closing in-app browser
    }
    // the mic is given back when the book is left (Back, Home, another book: kill -> R.un) and when the tab closes
    // (pagehide: with the setting on, the listener above); no listener of its own stays on the window
    else if (W.addEventListener) onW('pagehide', free);
    var un0 = R.un;
    R.un = function () { free(); un0(); };
    if (m.st === 'listening') watch();
    R.ml = m.label(); R.mb = root.querySelector('[data-main]'); here(); ph(); late(m.i);

    // Slower turned on (its switch) while the page waits is heard in the tap: before the first Listen it is that Listen;
    // else this (or, heard to the end, the last) sentence again from its first word's own start; rate() keeps the pauses
    function slw() {
      var p = R.pl, ws = P[m.i].words, k = p && p.current, s = 0, o;
      try { o = W.localStorage.getItem('wq_st_slow:' + (ctx.kid || '')) !== '1'; } catch (e) { /* off */ }
      if (!b.slow_gaps || !o || !p || !/^(idle|paused|listened)$/.test(m.st)) return;
      p.slow(1, b.slow_gaps);
      if (k < 0 && m.st !== 'listened') return m.label() === 'listen' ? m.primary() : m.altTap();
      sents(ws).forEach(function (x) { if (k < 0 || x[0] <= k && k <= x[1]) s = x[0]; });
      R.ac(1); p.seekToWord(s); p.audio.currentTime = ws[s].s_ms / 1000; m.set('listening');
    }
    var A = {
      mic: micScreen, read: function () { sum = null; readScreen(); }, q: dv('q'), d: dv('d'), e: eScreen,
      act: function (tap, arg) {
        if (tap === 'main' && C.now() - R.lk < 600) return true;
        if (R.nw && (tap === 'main' || tap === 'again') && !eo && !/^(mic|reading)$/.test(m.st)) { R.nw = 0; R.re(); return false; }
        if (tap === 'late') { lrl(''); late(m.i); }
        else if (tap === 'main' && m.st === 'reading') { stopAll = 1; if (R.lr) R.lr.stop('done_tap'); }
        else if (tap === 'close') { if (m.st === 'mic') micO.onNotNow(); else m.notNow(); }
        else if (tap === 'word') { if (R.pl && P[m.i].quality !== 'low') R.pl.playWord(+arg); }   // the word to practise (drawn by R.ex)
        else if (tap === 'echo') eGo();
        else if (tap === 'rfagain') m.set('mic');
        else if (tap === 'rfwith' && m.st === 'reading') { stopAll = 1; Mq('with'); }
        else if (tap === 'rfhear' && rd) Mq('hear', { rd: rd, sents: sents });
        else if (eo && (tap === 'main' || tap === 'hush' && !eo.pz)) eTog();
        else if (tap === 'eend' && eo) eEnd();
        else if (tap === 'slow') { slw(); return false; }   // wq-stories.js keeps the toggle
        else if (D) return D.act(tap, arg);
        else return false;
        return true;
      },
    };
    // the page hidden (the phone locked, the in-app browser left) in the echo or while the child reads
    var hu = R.hush;
    R.hush = function () {
      if (m.st !== 'echo') { hu(); if (R.lr && m.st === 'reading') R.lr.stop('hidden'); return; }
      if (R.au) R.au.pause();
      A.act('hush');
    };
    return A;
  };
}());
