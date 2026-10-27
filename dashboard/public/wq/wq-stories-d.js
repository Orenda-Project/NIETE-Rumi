/* Stories, third part (loaded by wq-stories-q.js at the same ?v= when a child reaches the questions): the questions,
 * the look-back page, the done screen, the teacher's read-only questions. Copy rules: wq-stories-q.js. */
(function () {
  'use strict';
  var W = window, S = W.WQSTORIES, K = S && S._k;
  if (!K) return;
  var IC = K.IC, esc = K.esc, scr = K.scr, img = K.img, ic = K.ic, top = K.top, post = K.post, juice = K.juice, JG = K.JG;
  var T3 = {
    en: {
      lookAgain: 'Hmm, look again', backQ: 'Back to the question', itWas: function (x) { return 'It was: ' + x; }, hear: 'Hear it',
      wholeRead: 'You read the whole story!', readSome: 'You read with Jugnu!', wholeHeard: 'You listened to the whole story!', heardSome: 'You listened with Jugnu!',
      pagesRead: function (s, n) { return s + (n === 1 ? ' page read' : ' pages read'); },
      pagesHeard: function (s, n) { return s + (n === 1 ? ' page heard' : ' pages heard'); },
      looked: 'You looked through the whole book.',
    },
    ur: {
      lookAgain: 'ہمم، ایک بار پھر دیکھیں', backQ: 'سوال پر واپس جائیں', itWas: function (x) { return 'جواب یہ ہے: ' + x; }, hear: 'سنیں',
      wholeRead: 'آپ نے پوری کہانی پڑھ لی!', readSome: 'آپ نے جگنو کے ساتھ پڑھا!', wholeHeard: 'آپ نے پوری کہانی سن لی!', heardSome: 'آپ نے جگنو کے ساتھ سنا!',
      pagesRead: function (s, n) { return s + (n === 1 ? ' صفحہ پڑھا' : ' صفحے پڑھے'); },
      pagesHeard: function (s, n) { return s + (n === 1 ? ' صفحہ سنا' : ' صفحے سنے'); },
      looked: 'آپ نے پوری کتاب دیکھ لی۔',
    },
  };
  ['en', 'ur'].forEach(function (l) { for (var k in T3[l]) K.T[l][k] = T3[l][k]; });

  S._d = function (R) {
    var ctx = R.ctx, C = R.C, id = R.id, root = R.root, paint = R.paint, b = R.b, P = R.P, m = R.m, L = R.L, t = R.t;
    // the book's mp3 (web_quiz_story_mp3) on a phone that plays no Ogg Opus: the questions' voices as .mp3 too (W.WQMP3)
    var M = W.WQMP3;
    if (b.mp3 === 1 && M && !b.m3) { b.m3 = 1; if (b.questions_sprite) b.questions_sprite.url = M(b.questions_sprite.url); (b.questions || []).forEach(function (x) { var a = x.audio; if (a) { a.q = M(a.q); a.o = (a.o || []).map(M); } }); }
    var qi = 0, ans = [], dim = -1, rv = -1, chosen = -1, qlock = 0, la = 0, qs = null, fcw = null, spr = null, end = 0;
    function live() { return R.live(); }

    function qStart() {
      if (R.tch) return paint(preview());
      if (W.location.hash !== '#story/' + id + '/q') W.location.hash = '#story/' + id + '/q';
      qi = 0; ans = []; dim = -1; rv = -1; chosen = -1; qlock = 0;
      need(function () {});
      var qsp = b.questions_sprite;
      if (qsp && qsp.url && W.Audio && !spr) { spr = new W.Audio(); spr.preload = 'auto'; spr.src = qsp.url; }
      if (!(b.questions || []).length) return m.set('done');
      qPaint();
    }
    function clip(k) {
      var q = b.questions[qi], c = spr && (b.questions_sprite.clips || {})['q' + q.n + (k === 'q' ? '' : 'o' + (+k + 1))], a = q.audio || {};
      return c || (k === 'q' ? a.q : (a.o || [])[+k]);
    }
    function say(k, pr) { return '<button class="wqs-ic wqs-say" data-tap="say" data-arg="' + k + '"' + (pr ? ' data-primary' : '') + ' data-sound data-trigger="tap" aria-label="' + esc(t.hear) + '">' + IC.spk + '</button>'; }
    function optOf(op) { return typeof op === 'string' ? { t: op } : op || {}; }
    function warm(k) {
      var a = (b.questions[k] || {}).audio;
      if (a && W.Audio && !spr) [a.q].concat(a.o || []).forEach(function (u) { try { if (u) { var x = new W.Audio(); x.preload = 'auto'; x.src = u; } } catch (e) {} });
    }
    function qPaint() {
      var q = b.questions[qi], a = { q: clip('q') }, o = (q.options || []).map(function (x, k) { return clip(k); });
      if (chosen < 0) warm(qi);
      paint(scr('story-questions', L, top(L, ic(t, 'back', t.back, '‹'), '', 1) +
        '<p class="wqs-dots" aria-hidden="true">' + b.questions.map(function (x, k) { return '<i class="' + (k < qi ? 'wqs-was' : k === qi ? 'wqs-now' : '') + '"></i>'; }).join('') + '</p>' +
        (la ? '<p class="wqs-say">' + esc(t.lookAgain) + '</p>' : '') + '<div class="wqs-qc">' + (a.q ? say('q', rv < 0) : '') + '<h2>' + esc(q.q) + '</h2></div><div class="wqs-opts">' +
        (q.options || []).map(function (op, k) {
          op = optOf(op);
          return '<div class="wqs-orow"><button class="wqs-opt' + (chosen === k ? ' wqs-chosen' : '') + (dim === k ? ' wqs-dim' : '') + '" data-tap="ans" data-arg="' + k + '"' + (!a.q && !k && rv < 0 ? ' data-primary' : '') + '>' +
            (op.img ? img(/\//.test(op.img) ? op.img : '/s/' + b.id + '/' + op.img, 64, 64) : '') + '<span>' + esc(op.t) + '</span></button>' + (o[k] ? say(k) : '') + '</div>';
        }).join('') + '</div>' + (rv >= 0 ? '<p class="wqs-say">' + esc(t.itWas(optOf(q.options[rv]).t)) + '</p><button class="wqs-main" data-primary data-tap="qnext">' + esc(t.next) + '</button>' : '')));
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
    function answer(k) {
      k = +k;
      if (qlock || k === dim) return;
      var q = b.questions[qi], d = { n: q.n, i: k }, two = !!ans[qi];
      qlock = 1; chosen = k; la = 0; (ans[qi] = ans[qi] || []).push(k);
      if (two) { d.try = 2; d.first = ans[qi][0]; }
      juice('tap'); qPaint();
      post(ctx, id, 'story_answer', d).then(function (r) {
        if (!live()) return;
        if (!r || r.right == null || r.right) { if (r && r.right) juice('correct'); return on(); }
        if (two) { if (r.show == null) return on(); rv = +r.show; chosen = -1; return qPaint(); }
        juice('wrong');
        var o = root.querySelector('.wqs-chosen');
        if (o) o.className += ' wqs-wob';
        dim = k;
        var lp = P.filter(function (x) { return x.n === q.page_ref; })[0];
        C.set(function () { if (!live()) return; if (lp) look(lp); else { qlock = 0; chosen = -1; la = 1; qPaint(); } }, 600);
      });
    }
    function on() { warm(qi + 1); C.set(adv, 900); }
    function adv() {
      if (!live()) return;
      qlock = 0; chosen = -1; dim = -1; rv = -1; la = 0;
      if (++qi < b.questions.length) return qPaint();
      R.wait();
      post(ctx, id, 'story_questions_done', { answers: ans }).then(function (r) { qs = r && r.stars != null ? r.stars : null; if (live()) m.set('done'); });
    }
    function look(p) {
      R.drop();
      paint(scr('story-look', L, top(L, ic(t, 'lret', t.back, '‹'), '', !!p.audio) + img(JG + 'thinking.webp', 72, 72, 'wqs-jg') + '<h2 class="wqs-say">' + esc(t.lookAgain) + '</h2>' +
        R.stage(p, (p.audio && p.boxes_ok ? '' : img(p.image.url, p.image.w, p.image.h)) + (p.audio ? '<div data-ra></div>' : '')) +
        (p.audio ? '<button class="wqs-again" data-tap="lplay" data-sound data-trigger="tap">' + IC.spk + ' ' + esc(t.listen) + '</button>' : '') +
        '<button class="wqs-main" data-primary data-tap="lret">' + esc(t.backQ) + '</button>', 'wqs-sheet'));
      R.camTo(null); if (R.ph) R.ph();   // the words frame goes once the picture has loaded
      if (p.audio) R.mount(p, { onEnd: function () { R.camTo(null); R.word(-1); } });
    }
    function preview() {
      return scr('story-questions', L, top(L, ic(t, 'back', t.back, '‹')) + '<ol class="wqs-pv">' + (b.questions || []).map(function (q) {
        return '<li><h2>' + esc(q.q) + '</h2><ul>' + (q.options || []).map(function (op) { return '<li>' + esc(optOf(op).t) + '</li>'; }).join('') + '</ul></li>';
      }).join('') + '</ol><button class="wqs-main" data-primary data-tap="back">' + esc(t.back) + '</button>');
    }
    function need(cb) {
      if (!b.card_v3 || W.WQFC || fcw === true) return cb();
      if (fcw) return fcw.push(cb);
      fcw = [cb];
      K.load('wq-finish-card.js', 'wq-finish-card.css', function () { var w = fcw; fcw = true; w.forEach(function (f) { f(); }); });
    }

    // the done card drew its own "More stories" tile (a link to the shelf): its tap is ours too, never a page turn
    var fin = 0;
    function finish() {
      if (R.tch) return paint(preview());
      var c = m.counts(), tp = [], k;
      for (k = 0; k < P.length; k++) if (!P[k].is_picture && P[k].words && P[k].words.length) tp.push(k);
      var all = function (o) { return tp.length > 0 && tp.every(function (i) { return o[i]; }); };
      var rd = c.pages_read > 0, n = rd ? c.pages_read : c.pages_listened;
      var head = rd ? (all(m.r) ? t.wholeRead : t.readSome) : n ? (all(m.l) ? t.wholeHeard : t.heardSome) : t.looked;
      R.wait();
      post(ctx, id, 'story_done', { pages_listened: c.pages_listened, pages_read: c.pages_read, stars: qs }).then(function (r) { need(function () {
        if (!live()) return;
        var deed = function (k) { return t[rd ? 'pagesRead' : 'pagesHeard'](K.dg(k, L), k); };
        // with the finish card (card_v3) "More stories" is the card's Next tile and it leads (ONE primary, the share
        // soft under it), so ours is not drawn beside it; a card that refuses leaves today's screen with our primary
        var lo = W.location, nx = /^\/[^/]/.test(lo.pathname || '') ? { kind: 'stories', href: lo.pathname + (lo.search || '') + '#stories', title: t.more } : null;
        // its picture: the next unread book of the last shelf this page drew (kept by the shelf, which the reader
        // replaces on the page; its cached cover; no request)
        var sb = nx && (S.shelf.d || {}).books || [], x;
        for (x = 0; x < sb.length; x++) if (!sb[x].done && sb[x].id !== id && sb[x].cover) { nx.art = sb[x].cover; break; }
        // the book's whole read answered (read_fb; the server's reading from the child's own page reads): above the
        // card and its buttons, beside a card that hides our own head (then the compact strip: the card's Next stays on
        // the first screen)
        var rfb = b.read_fb && rd && r && r.reading && W.WQMoment ? W.WQMoment.feedback(r.reading) : null;
        var draw = function (fc) {
          paint(scr('story-done', L, top(L, '', '', 1) + '<div class="wqs-col" data-own><h2>' + esc(head) + '</h2>' +
            (n ? '<p class="wqs-deed" data-n>' + esc(deed(n)) + '</p>' : '') + '</div>' +
            (rfb ? W.WQMoment.html(rfb, L, { grade: b.grade, moment: 'story-done', size: fc ? 's' : '' }) : '') +
            '<div class="wqs-col" data-col>' + (fc && nx ? '' : '<button class="' + (fc ? 'wqs-sec"' : 'wqs-main" data-primary') + ' data-tap="more">' + esc(t.more) + '</button>') +
            '<button class="wqs-sec" data-home data-tap="home">' + esc(t.home) + '</button></div>', 'wqs-sheet'));
        };
        // the done screen is the book's end: the questions answered count as a deed on the card
        var qa = ans.filter(function (x) { return x && x.length; }).length;
        var ok = false, fc = (n || qa) && b.card_v3 && W.WQFC && W.WQFC.mount;
        draw(fc);
        if (fc) {
          var fo = { source: 'story', ended: rd ? 'read' : 'listened', pages_read: c.pages_read, pages_listened: c.pages_listened, stars: qs, title: b.title, cover: b.cover, lang: L, auth: { hub: ctx.token, kid: ctx.kid }, ev: ctx.ev, home: '#', next: nx, lead: true, whole: true, answered: qa, sticker: !!(r && r.sticker) };
          // the one share (share_v4): the card names the book, so its link lands a new child on it
          if (b.share_v4 === true) { fo.v4 = true; fo.item = { type: 'book', id: String(id) }; }
          try { ok = W.WQFC.mount(root.querySelector('[data-col]'), fo) !== false; } catch (e) {}
          if (!ok) draw(false);
          else fin = nx ? 1 : 0;
        }
        var own = root.querySelector('[data-own]');
        if (own) own.hidden = ok;
        // one sound: the moment's with the finish card; without it, the book's finish fanfare below says it
        if (rfb && ok) W.WQMoment.sound(root.querySelector('[data-rf]'), rfb);
        if (ok || !n) return;
        juice('finish', { stars: 3, kind: 'story' });
        var el = root.querySelector('[data-n]'), j = 0;
        var still = W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (el && n > 1 && !still) (function up() { el.textContent = deed(++j); if (j < n) C.set(up, 150); })();
      }); });
    }


    return {
      q: qStart, d: finish,
      act: function (tap, arg) {
        if (tap === 'say') sayIt(arg);
        else if (tap === 'ans') answer(arg);
        else if (tap === 'lplay') { if (R.pl) R.pl.play(); }
        else if (tap === 'qnext') adv();
        else if (tap === 'lret') { R.drop(); qlock = 0; chosen = -1; qPaint(); }
        else if (tap === 'more' || tap === 'next' && fin) { R.kill(); W.location.hash = '#stories'; }
        else return false;
        return true;
      },
    };
  };
}());
