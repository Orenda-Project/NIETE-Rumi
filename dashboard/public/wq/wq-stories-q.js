/* Stories, the lazy part: loaded by wq-stories.js (same ?v=) when a reader opens. Your turn (WQLiveRead; pages over 40
 * words run per chunk of <= 25 words, ONE story_page_read with summed numbers), the questions with Look back (#S7),
 * the done card (#S5, W6; m-scorecard's WQFC when the book says card_v3) and the teacher's read-only questions.
 * Copy follows the rules above T in wq-stories.js. No framework, no build step. */
(function () {
  'use strict';
  var W = window, S = W.WQSTORIES, K = S && S._k;
  if (!K) return;
  var esc = K.esc, enc = K.enc, scr = K.scr, img = K.img, ic = K.ic, top = K.top, post = K.post, req = K.req, juice = K.juice, JG = K.JG;
  var T2 = {
    en: {
      done: 'I\'m done ✓', micSay: 'Tap to let Jugnu hear you', ok: 'OK', notNow: 'Not now, just listen',
      readNow: 'Read it aloud!', keepGoing: 'Keep going!', checking: 'Jugnu is listening…',
      lookBack: 'Let\'s look back!', backQ: 'Back to the question', hear: 'Hear it',
      wholeRead: 'You read the whole story!', readSome: 'You read with Jugnu!', wholeHeard: 'You listened to the whole story!', tried: 'You tried a new story!',
      pagesRead: function (s, n) { return s + (n === 1 ? ' page read' : ' pages read'); },
      pagesHeard: function (s, n) { return s + (n === 1 ? ' page listened to' : ' pages listened to'); },
      sticker: 'A new sticker for your Book!', more: 'More stories', share: 'Share with family',
      shareRead: function (x) { return 'I read ' + x + ' with Jugnu!'; }, shareHeard: function (x) { return 'I listened to ' + x + ' with Jugnu!'; },
    },
    ur: {
      done: 'میں نے پڑھ لیا ✓', micSay: 'جگنو کو اپنی آواز سنانے کے لیے دبائیں', ok: 'ٹھیک ہے', notNow: 'ابھی نہیں، صرف سنیں',
      readNow: 'اونچی آواز میں پڑھیں!', keepGoing: 'پڑھتے رہیں!', checking: 'جگنو سن رہا ہے…',
      lookBack: 'آئیں، کہانی میں پھر سے دیکھیں!', backQ: 'سوال پر واپس جائیں', hear: 'سنیں',
      wholeRead: 'آپ نے پوری کہانی پڑھ لی!', readSome: 'آپ نے جگنو کے ساتھ پڑھا!', wholeHeard: 'آپ نے پوری کہانی سن لی!', tried: 'آپ نے ایک نئی کہانی شروع کی!',
      pagesRead: function (s, n) { return s + (n === 1 ? ' صفحہ پڑھا' : ' صفحے پڑھے'); },
      pagesHeard: function (s, n) { return s + (n === 1 ? ' صفحہ سنا' : ' صفحے سنے'); },
      sticker: 'آپ کی کتاب کے لیے ایک نیا اسٹیکر!', more: 'اور کہانیاں', share: 'گھر والوں کو بھیجیں',
      shareRead: function (x) { return 'میں نے جگنو کے ساتھ «' + x + '» پڑھی!'; }, shareHeard: function (x) { return 'میں نے جگنو کے ساتھ «' + x + '» سنی!'; },
    },
  };
  ['en', 'ur'].forEach(function (l) { for (var k in T2[l]) K.T[l][k] = T2[l][k]; });

  S._q = function (R) {
    var ctx = R.ctx, C = R.C, id = R.id, root = R.root, paint = R.paint, b = R.b, P = R.P, m = R.m, L = R.L, t = R.t;
    var qi = 0, ans = [], tries = [], chosen = -1, qlock = 0, qs = null, fcw = null, ck = [], ci = 0, sum = null, stopAll = 0, stream = null, spr = null, end = 0;
    function live() { return R.live(); }
    function declined(how) { K.evt(ctx, 'mic_declined', { src: 'story', how: how }); }

    /* ---- the mic: LIVEREAD §11 askMic owns the in-app-browser ask and its "Not now" door; else our minimal sheet ---- */
    var micO = {
      lang: L, src: 'story',
      onStream: function (s) { if (m.st === 'mic') { stream = s; m.granted(); } },
      onDenied: function (why) { if (m.st !== 'mic') return; if (why === 'not_now') return micO.onNotNow(); declined('denied'); m.denied(); },
      onNotNow: function () { if (m.st === 'mic') { declined('not_now'); m.notNow(); } },
    };
    function micScreen() {
      var ask = W.WQLiveRead.askMic, h = top(L, ic(t, 'close', t.close, '✕')) + img(JG + 'hello.webp', 96, 96, 'wqs-jg');
      paint(scr('story-mic', L, h + (ask ? '<div data-mic></div>' : '<h2 class="wqs-say">' + esc(t.micSay) + '</h2><button class="wqs-main" data-primary data-tap="mic">🎤 ' + esc(t.ok) +
        '</button><button class="wqs-sec" data-tap="notnow">' + esc(t.notNow) + '</button>'), 'wqs-sheet'));
      if (!ask) return;
      var el = root.querySelector('[data-mic]');
      ask(el, micO);
      var g = el && el.querySelector('.lr-go');
      if (g) g.setAttribute('data-primary', '');
    }
    function mic() {   // our sheet's OK: getUserMedia inside the tap
      var md = W.navigator && W.navigator.mediaDevices;
      if (md && md.getUserMedia) md.getUserMedia({ audio: true }).then(micO.onStream, micO.onDenied); else micO.onDenied();
    }

    /* ---- Your turn, zoomed to the line like the listen; long pages per chunk ---- */
    function readScreen() {
      var p = P[m.i], LR = W.WQLiveRead, c, lh = '<div class="wqs-lr" data-lr></div>', st;
      if (!sum) { ck = S._chunks(p, S._lines(p)); ci = 0; stopAll = 0; sum = { words_total: 0, words_read: 0, skipped: 0, ms: 0, marks: [] }; }
      c = ck[ci];
      st = R.stage(p, lh);
      paint(scr('story-read', L, top(L, ic(t, 'close', t.close, '✕')) + img(JG + 'hello.webp', 72, 72, 'wqs-jg wqs-g0', ' data-jg') +
        (R.mode() === 'z' ? st : lh) + '<button class="wqs-main wqs-done" data-primary data-tap="main">' + esc(t.done) + '</button>'));
      var z = R.mode() === 'z';
      if (z) R.camLine(c[0]);
      try {
        R.lr = LR.mount(root.querySelector('[data-lr]'), {
          words: p.words.slice(c[0], c[1] + 1), image: p.image, lang: L, dir: b.dir, id: b.id + ':' + p.n, stream: stream, meter: 'none', record: false, counted: false,
          finish: { pct: 0.8, quiet_ms: 4000, tail_ms: 1000, quiet: true },
          copy: { done: t.done, readNow: t.readNow, keepGoing: t.keepGoing, checking: t.checking, wellRead: t.wellRead },
          getKey: function () { return req('POST', '/api/wq/lr/key', { st: ctx.token, kid: ctx.kid, book: b.id, page: p.n, lang: L }).then(function (r) { return r.body; }); },
          onResult: result,
        });
      } catch (e) { m.denied(); return; }
      // Jugnu glows by the share of words lit and the camera follows the next word: never by time
      R.poll = C.set(function tick() {
        var v = R.lr && R.lr.view && R.lr.view(), g = root.querySelector('[data-jg]'), k = 0, ss = (v && v.states) || [];
        if (v && g && LR.glowLevel) g.className = 'wqs-jg wqs-g' + LR.glowLevel(v);
        while (k < ss.length - 1 && /read|heard|skipped/.test(ss[k])) k++;
        if (z && ss.length) R.camLine(c[0] + k);
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
      post(ctx, id, 'story_page_read', { words_total: s.words_total, words_read: s.words_read, skipped: s.skipped, ms: s.ms, ended: s.ended }, P[m.i].n);
      m.result(s);
    }

    /* ---- questions: one at a time, spoken when there is a clip; the server checks ---- */
    function qStart() {
      if (R.tch) return paint(preview());
      if (W.location.hash !== '#story/' + id + '/q') W.location.hash = '#story/' + id + '/q';
      qi = 0; ans = []; tries = []; chosen = -1; qlock = 0;
      need(function () {});
      // one sprite for every question clip (lead ruling): fetched once here, played by time
      var qsp = b.questions_sprite;
      if (qsp && qsp.url && W.Audio && !spr) { spr = new W.Audio(); spr.preload = 'auto'; spr.src = qsp.url; }
      if (!(b.questions || []).length) return m.set('done');
      qPaint();
    }
    // a question's clip: {s_ms, e_ms} in the sprite, else its own url (option k is 'q<n>o<k+1>')
    function clip(k) {
      var q = b.questions[qi], c = spr && (b.questions_sprite.clips || {})['q' + q.n + (k === 'q' ? '' : 'o' + (+k + 1))], a = q.audio || {};
      return c || (k === 'q' ? a.q : (a.o || [])[+k]);
    }
    function say(k, pr) { return '<button class="wqs-ic wqs-say" data-tap="say" data-arg="' + k + '"' + (pr ? ' data-primary' : '') + ' data-sound data-trigger="tap" aria-label="' + esc(t.hear) + '">🔊</button>'; }
    function optOf(op) { return typeof op === 'string' ? { t: op } : op || {}; }
    // warm a question's clips (the question + its options) in parallel; the next one during the 900 ms
    function warm(k) {
      var a = (b.questions[k] || {}).audio;
      if (a && W.Audio && !spr) [a.q].concat(a.o || []).forEach(function (u) { try { if (u) { var x = new W.Audio(); x.preload = 'auto'; x.src = u; } } catch (e) {} });
    }
    function qPaint() {
      var q = b.questions[qi], a = { q: clip('q') }, o = (q.options || []).map(function (x, k) { return clip(k); });
      if (chosen < 0) warm(qi);
      paint(scr('story-questions', L, top(L, ic(t, 'back', t.back, '‹'), '', 1) +
        '<p class="wqs-dots" aria-hidden="true">' + b.questions.map(function (x, k) { return '<i class="' + (k < qi ? 'wqs-was' : k === qi ? 'wqs-now' : '') + '"></i>'; }).join('') + '</p>' +
        '<div class="wqs-qc">' + (a.q ? say('q', 1) : '') + '<h2>' + esc(q.q) + '</h2></div><div class="wqs-opts">' +
        (q.options || []).map(function (op, k) {
          op = optOf(op);
          return '<div class="wqs-orow"><button class="wqs-opt' + (chosen === k ? ' wqs-chosen' : '') + '" data-tap="ans" data-arg="' + k + '"' + (!a.q && !k ? ' data-primary' : '') + '>' +
            (op.img ? img(/\//.test(op.img) ? op.img : '/s/' + b.id + '/' + op.img, 64, 64) : '') + '<span>' + esc(op.t) + '</span></button>' + (o[k] ? say(k) : '') + '</div>';
        }).join('') + '</div>'));
    }
    function sayIt(k) {
      var u = clip(k), pr;
      if (!u || K.muted() || !W.Audio) return;
      if (R.au) R.au.pause();
      if (u.e_ms) {
        R.au = spr; end = u.e_ms; spr.currentTime = u.s_ms / 1000;
        var tick = function () { if (spr.currentTime * 1000 >= end) spr.pause(); else if (!spr.paused) { if (W.requestAnimationFrame) W.requestAnimationFrame(tick); else C.set(tick, 30); } };
        C.set(tick, 30);
      } else R.au = new W.Audio(u);
      pr = R.au.play();
      if (pr && pr.catch) pr.catch(function () {});
    }
    // #S7 look back: a first miss shows the page that answers it; the 2nd try is taken; a failed call moves on
    function answer(k) {
      if (qlock) return;
      var q = b.questions[qi], again = tries[qi];
      qlock = 1; chosen = +k; ans[qi] = +k; tries[qi] = 1;
      juice('tap'); qPaint();
      var r0 = post(ctx, id, 'story_answer', { n: q.n, i: +k });
      if (again) return on();
      r0.then(function (r) {
        if (!live()) return;
        if (!r || r.right == null || r.right) { if (r && r.right) juice('correct'); return on(); }
        juice('wrong');
        var o = root.querySelector('.wqs-chosen');
        if (o) o.className += ' wqs-wob';
        var lp = P.filter(function (x) { return x.n === q.page_ref; })[0];
        C.set(function () { if (!live()) return; if (lp) look(lp); else { qlock = 0; chosen = -1; qPaint(); } }, 600);
      });
    }
    function on() {
      warm(qi + 1);
      C.set(function () {
        if (!live()) return;
        qlock = 0; chosen = -1;
        if (++qi < b.questions.length) return qPaint();
        R.wait();
        post(ctx, id, 'story_questions_done', { answers: ans }).then(function (r) { qs = r && r.stars != null ? r.stars : null; if (live()) m.set('done'); });
      }, 900);
    }
    function look(p) {
      R.drop();
      paint(scr('story-look', L, top(L, ic(t, 'lret', t.back, '‹'), '', !!p.audio) + img(JG + 'thinking.webp', 72, 72, 'wqs-jg') + '<h2 class="wqs-say">' + esc(t.lookBack) + '</h2>' +
        R.stage(p, (p.audio && p.boxes_ok ? '' : img(p.image.url, p.image.w, p.image.h)) + (p.audio ? '<div data-ra></div>' : '')) +
        (p.audio ? '<button class="wqs-again" data-tap="lplay" data-sound data-trigger="tap">🔊 ' + esc(t.listen) + '</button>' : '') +
        '<button class="wqs-main" data-primary data-tap="lret">' + esc(t.backQ) + '</button>', 'wqs-sheet'));
      R.camTo(null);
      if (p.audio) R.mount(p, { onEnd: function () { R.camTo(null); R.word(-1); } });
    }
    function preview() {
      return scr('story-questions', L, top(L, ic(t, 'back', t.back, '‹')) + '<ol class="wqs-pv">' + (b.questions || []).map(function (q) {
        return '<li><h2>' + esc(q.q) + '</h2><ul>' + (q.options || []).map(function (op) { return '<li>' + esc(optOf(op).t) + '</li>'; }).join('') + '</ul></li>';
      }).join('') + '</ol><button class="wqs-main" data-primary data-tap="back">' + esc(t.back) + '</button>');
    }
    // m-scorecard's finish card: loaded at our own ?v= only when the book says card_v3
    function need(cb) {
      if (!b.card_v3 || W.WQFC || fcw === true) return cb();
      if (fcw) return fcw.push(cb);
      fcw = [cb];
      K.load('wq-finish-card.js', 'wq-finish-card.css', function () { var w = fcw; fcw = true; w.forEach(function (f) { f(); }); });
    }

    // the done card (#S5, W6): read -> listened to every text page -> tried; one sticker at most, no score
    function finish() {
      if (R.tch) return paint(preview());
      var c = m.counts(), tp = [], k;
      for (k = 0; k < P.length; k++) if (!P[k].is_picture && P[k].words && P[k].words.length) tp.push(k);
      var all = function (o) { return tp.length > 0 && tp.every(function (i) { return o[i]; }); };
      var rd = c.pages_read > 0, heard = !rd && all(m.l), n = rd ? c.pages_read : heard ? c.pages_listened : 0;
      var head = rd ? (all(m.r) ? t.wholeRead : t.readSome) : heard ? t.wholeHeard : t.tried;
      R.wait();
      post(ctx, id, 'story_done', { pages_listened: c.pages_listened, pages_read: c.pages_read, stars: qs }).then(function (r) { need(function () {
        if (!live()) return;
        var stk = n > 0 && !!(r && r.sticker === true), deed = function (k) { return t[rd ? 'pagesRead' : 'pagesHeard'](K.dg(k, L), k); };
        var sh = n ? t[rd ? 'shareRead' : 'shareHeard'](b.title) : '';
        paint(scr('story-done', L, top(L, '', '', 1) + '<div class="wqs-col" data-own>' + img('/wq/jugnu_celebrate.webp', 120, 120, 'wqs-jg') + '<h2>' + esc(head) + '</h2>' +
          (n ? '<p class="wqs-deed" data-n>' + esc(deed(n)) + '</p>' : '') + (stk ? '<p class="wqs-stk"><span aria-hidden="true">🌟</span> ' + esc(t.sticker) + '</p>' : '') + '</div>' +
          '<div class="wqs-col" data-col><button class="wqs-main" data-primary data-tap="more">' + esc(t.more) + '</button>' +
          (sh ? '<a class="wqs-sec" href="https://wa.me/?text=' + enc(sh) + '" target="_blank" rel="noopener" data-tap="share">' + esc(t.share) + '</a>' : '') +
          '<button class="wqs-sec" data-home data-tap="home">' + esc(t.home) + '</button></div>', 'wqs-sheet'));
        var ok = false, own = root.querySelector('[data-own]');
        if (n && b.card_v3 && W.WQFC && W.WQFC.mount) {
          try { ok = W.WQFC.mount(root.querySelector('[data-col]'), { kind: 'book', deed: 'book_read', lang: L, title: b.title, cover: b.cover, next: null, home: '#', auth: { hub: ctx.token, kid: ctx.kid }, ev: ctx.ev }) !== false; } catch (e) {}
        }
        if (own) own.hidden = ok;
        if (ok || !n) return;
        juice('finish', { stars: 3, kind: 'story' });
        var el = root.querySelector('[data-n]'), j = 0;
        var still = W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (el && n > 1 && !still) (function up() { el.textContent = deed(++j); if (j < n) C.set(up, 150); })();
      }); });
    }

    return {
      mic: micScreen, read: function () { sum = null; readScreen(); }, q: qStart, d: finish,
      act: function (tap, arg) {
        if (tap === 'main' && m.st === 'reading') { stopAll = 1; if (R.lr) R.lr.stop('done_tap'); }
        else if ((tap === 'close' || tap === 'notnow') && m.st === 'mic') micO.onNotNow();
        else if (tap === 'mic') { if (!W.WQLiveRead.askMic) mic(); }
        else if (tap === 'say') sayIt(arg);
        else if (tap === 'ans') answer(arg);
        else if (tap === 'lplay') { if (R.pl) R.pl.play(); }
        else if (tap === 'lret') { R.drop(); qlock = 0; chosen = -1; qPaint(); }
        else if (tap === 'share') post(ctx, id, 'story_shared');
        else if (tap === 'more') { R.kill(); W.location.hash = '#stories'; }
        else return false;
        return true;
      },
    };
  };
}());
