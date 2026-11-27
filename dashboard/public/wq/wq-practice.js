/* The practice door on the finish screen (A/B test ict-quiz-practice-door, arm B; app_settings ab_quiz_practice_door).
 * wq.js asks for this file only when finish's answer carries practice_door, and never on a friend's challenge run.
 * "Practise for your test" → pick up to 3 topics → 5 fresh questions (A/B/C) → the round's result, graded on the server,
 * with the lesson plan's worked answer where it has one → back to the score. Nothing is shared and nothing is sent
 * to anyone: no share button, no WhatsApp link. Copy in English and Urdu, as data (W). Reuses the page's own button
 * classes (wq-btn wq-go / wq-soft / wq-ghost), so wq.css is unchanged.
 *
 *   window.WQPRAC.html(ctx) → the door's markup for the card;  window.WQPRAC.wire(ctx) → its tap.
 * ctx (from wq.js): res, lang, T {oops, offline}, esc, num (digits in the page's language), render, on, api, toast,
 * st, back.
 */
(function () {
  'use strict';
  var MAX_PICKED = 3;
  var W = {
    en: {
      door: 'Practise for your test',
      left: function (n, raw) { return raw === 1 ? n + ' practice round left today' : n + ' practice rounds left today'; },
      pick: 'Pick up to 3 topics',
      pickSub: 'Or press Start and we will choose for you.',
      start: 'Start',
      qOf: function (i, n) { return 'Question ' + i + ' of ' + n; },
      score: function (s, t) { return 'You got ' + s + ' of ' + t + ' right'; },
      yours: 'Your answer',
      answer: 'Answer',
      lesson: 'From your lesson',
      right: 'Right!',
      wrong: 'Not quite',
      again: 'Practise again',
      back: 'Back to my score',
      capped: 'That is all the practice for today. Come back tomorrow!',
      short: 'No new practice questions right now. Please try again later.',
    },
    ur: {
      door: 'اپنے ٹیسٹ کی مشق کریں',
      left: function (n) { return 'آج مشق کے ' + n + ' راؤنڈ باقی ہیں'; },
      pick: 'تین تک موضوعات چنیں',
      pickSub: 'یا شروع کریں دبائیں، ہم آپ کے لیے چن لیں گے۔',
      start: 'شروع کریں',
      qOf: function (i, n) { return 'سوال ' + i + ' (کل ' + n + ')'; },
      score: function (s, t) { return 'آپ کے ' + t + ' میں سے ' + s + ' جواب درست ہیں'; },
      yours: 'آپ کا جواب',
      answer: 'درست جواب',
      lesson: 'آپ کے سبق سے',
      right: 'درست!',
      wrong: 'ٹھیک نہیں',
      again: 'دوبارہ مشق کریں',
      back: 'اپنے نمبر پر واپس جائیں',
      capped: 'آج کی مشق پوری ہو گئی۔ کل پھر آئیں!',
      short: 'ابھی مشق کے نئے سوال نہیں ہیں۔ بعد میں دوبارہ کوشش کریں۔',
    },
  };
  var SLOTS = ['A', 'B', 'C'];
  var C = null;          // the page's ctx, from the last html()/wire()
  var gen = 0;           // the screen a tap belongs to: a tap on an earlier screen does nothing
  var busy = false;
  var round = null;      // { id, questions, i, answers, left }

  function w() { return W[C && C.lang === 'ur' ? 'ur' : 'en']; }
  function n(x) { return C && C.num ? C.num(x) : x; }
  function e(s) { return C.esc(s); }
  function show(h) { gen += 1; C.render('<div class="wq-pd-screen">' + h + '</div>', 'M10P'); }
  // A tap wired to the screen it was drawn on.
  function tap(sel, fn) { var g = gen; return C.on(sel, function (ev) { if (g === gen && !busy) fn(ev); }); }
  function left() { var pd = C.res && C.res.practice_door; return pd && typeof pd.rounds_left === 'number' ? pd.rounds_left : null; }

  function html(ctx) {
    C = ctx;
    var l = left();
    return '<div class="wq-pd"><button class="wq-btn wq-soft" id="wq-pd-go">' + e(w().door) + '</button>' +
      (l != null ? '<p class="wq-small wq-center">' + e(w().left(n(l), l)) + '</p>' : '') + '</div>';
  }

  // POST practice/<path>; answers ok → then(body), else a toast and nothing changes.
  function call(path, body, then) {
    busy = true;
    C.api('POST', 'practice/' + path, body).then(function (r) {
      busy = false;
      var b = r.body || {};
      if (!r.ok) return C.toast(C.T.oops);
      if (b.capped) return C.toast(w().capped);
      if (b.short) return C.toast(w().short);
      then(b);
    }, function () { busy = false; C.toast(C.T.offline); });
  }

  function go() { call('start', { st: C.st }, function (b) { if (Array.isArray(b.topics)) topics(b.topics); else if (b.questions) play(b); }); }

  function topics(list) {
    var picked = [];
    show('<h2 class="wq-title">' + e(w().pick) + '</h2><p class="wq-sub">' + e(w().pickSub) + '</p>' +
      list.map(function (t, i) { return '<button class="wq-btn wq-soft" id="wq-pd-t-' + i + '" aria-pressed="false">' + e(t) + '</button>'; }).join('') +
      '<button class="wq-btn wq-go" id="wq-pd-start">' + e(w().start) + '</button>' +
      '<button class="wq-btn wq-ghost" id="wq-pd-back">' + e(w().back) + '</button>');
    list.forEach(function (t, i) {
      var el = tap('#wq-pd-t-' + i, function () {
        var at = picked.indexOf(t);
        if (at >= 0) picked.splice(at, 1);
        else if (picked.length < MAX_PICKED) picked.push(t);
        if (el) el.setAttribute('aria-pressed', picked.indexOf(t) >= 0 ? 'true' : 'false');
      });
    });
    tap('#wq-pd-start', function () {
      call('start', { st: C.st, topics: picked.slice() }, function (b) { if (b.questions) play(b); });
    });
    tap('#wq-pd-back', function () { C.back(); });
  }

  function play(b) {
    round = { id: b.round_id, questions: b.questions || [], i: 0, answers: {}, left: b.rounds_left };
    question();
  }

  function question() {
    var q = round.questions[round.i];
    var opts = q.options || {};
    show('<p class="wq-sub">' + e(w().qOf(n(round.i + 1), n(round.questions.length))) + '</p>' +
      '<h2 class="wq-title" dir="auto">' + e(q.text) + '</h2>' +
      SLOTS.filter(function (s) { return opts[s] != null; }).map(function (s) {
        return '<button class="wq-btn wq-soft" id="wq-pd-o-' + s + '" dir="auto">' + e(opts[s]) + '</button>';
      }).join(''));
    SLOTS.forEach(function (s) {
      tap('#wq-pd-o-' + s, function () {
        round.answers[q.qid] = s;
        round.i += 1;
        if (round.i < round.questions.length) question();
        else finish();
      });
    });
  }

  function finish() {
    var r = round;
    call('finish', { st: C.st, round_id: r.id, answers: r.answers }, function (b) { result(r, b); });
  }

  function result(r, b) {
    var byId = {};
    r.questions.forEach(function (q) { byId[q.qid] = q; });
    var items = (b.items || []).map(function (it) {
      var q = byId[it.qid] || { options: {} };
      var opt = function (s) { return s && q.options && q.options[s] != null ? q.options[s] : ''; };
      return '<div class="wq-banner"><p dir="auto"><b>' + e(it.right ? w().right : w().wrong) + '</b> ' + e(q.text || '') + '</p>' +
        (it.right ? '' : '<p class="wq-small" dir="auto">' + e(w().yours) + ': ' + e(opt(it.chosen)) + '</p>') +
        '<p class="wq-small" dir="auto">' + e(w().answer) + ': ' + e(opt(it.correct)) + '</p>' +
        (it.worked ? '<p class="wq-small" dir="auto">' + e(w().lesson) + ': ' + e(it.worked) + '</p>' : '') + '</div>';
    }).join('');
    var more = typeof r.left === 'number' && r.left > 0;
    show('<h2 class="wq-title">' + e(w().score(n(b.score || 0), n(b.total || r.questions.length))) + '</h2>' + items +
      (more ? '<button class="wq-btn wq-go" id="wq-pd-again">' + e(w().again) + '</button>' : '') +
      '<button class="wq-btn wq-ghost" id="wq-pd-back">' + e(w().back) + '</button>');
    if (C.res && C.res.practice_door && typeof r.left === 'number') C.res.practice_door.rounds_left = r.left;
    if (more) tap('#wq-pd-again', go);
    tap('#wq-pd-back', function () { C.back(); });
  }

  function wire(ctx) {
    C = ctx;
    tap('#wq-pd-go', go);
  }

  window.WQPRAC = { html: html, wire: wire, W: W };
})();
