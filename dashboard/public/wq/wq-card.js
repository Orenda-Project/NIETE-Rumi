/*
 * The Jugnu card on the scorecard (app_settings web_quiz_challenge_card, with web_quiz_challenge and web_quiz_hub on).
 * wq.js asks for this file only when finish() offers the card (result.jugnu_card): the quiz page itself is unchanged.
 *
 *   WQCARD.html(ctx)  the card: Jugnu's challenge, first under the score, in the hub tile's own words
 *   WQCARD.wire(ctx)  its tap, and door_shown once per page view (>= 50% in view; on render with no observer)
 *
 * A tap never opens a run: one screen asks "<name>'s turn" (Play, or "Not my turn? Go back" to the card). Play asks
 * the server for this child's challenge link (POST hubdoor {st, jugnu: 1}) and opens it. The door events
 * (door_shown / door_tap {door: 'card', surface: 'scorecard', slot: 1}) go through the page's own ev() batch, only
 * when finish says the events are on (result.jugnu_ev). Nothing about the child is computed here.
 * ctx (from wq.js): {res, lang, mascot, first, T: {play, oops, offline}, esc, ani, bar, wireBar, render, on, ev,
 * flushEv, api, toast, st, back}.
 */
(function () {
  'use strict';
  // Copy: copy.addendum.v1.json jg.card.title / sub / btn and copy.v2.json jg.who.turn_of / not_me / turn.
  var W = {
    en: { cardTitle: 'Jugnu has a game for you', cardSub: '2 minutes, no microphone', cardBtn: 'Play',
      whoTurnOf: function (n) { return n + '\'s turn'; }, whoNotMe: 'Not my turn? Go back', whoTurn: 'Whose turn?' },
    ur: { cardTitle: 'جگنو کے پاس آپ کے لیے ایک کھیل ہے', cardSub: '۲ منٹ، مائیک کی ضرورت نہیں', cardBtn: 'کھیلیں',
      whoTurnOf: function (n) { return '⁨' + n + '⁩ کی باری'; }, whoNotMe: 'میری باری نہیں؟ واپس جائیں', whoTurn: 'کس کی باری ہے؟' }
  };
  var DOOR = { door: 'card', surface: 'scorecard', slot: 1 };
  var CH_HREF = /^\/c\/[A-Za-z0-9._-]+\?kid=[A-Za-z0-9_-]+&via=quiz_card$/;
  var shown = false;   // door_shown: once per page view (a re-render of the card is not another view)
  var lastTap = 0;     // door_tap: debounced 1 s
  var going = false;
  var io = null;

  function lang(c) { return c.lang === 'ur' ? 'ur' : 'en'; }
  function words(c) { return W[lang(c)]; }
  function door(c, n) { if (c.res && c.res.jugnu_ev) c.ev(n, { door: DOOR.door, surface: DOOR.surface, slot: DOOR.slot }); }

  function html(c) {
    var w = words(c);
    return '<div class="wq-card wq-jc" style="display:grid;gap:10px"><p class="wq-name" style="font-size:22px;margin:0"><span aria-hidden="true">⭐</span> ' + c.esc(w.cardTitle) + '</p>' +
      // Nastaliq stays >= 20 px on the card's subline.
      '<p class="wq-sub" style="margin:0' + (lang(c) === 'ur' ? ';font-size:20px' : '') + '">' + c.esc(w.cardSub) + '</p>' +
      '<button class="wq-btn wq-go" id="wq-jc-go">▶ ' + c.esc(w.cardBtn) + '</button></div>';
  }

  function show(c) {
    if (shown) return;
    shown = true;
    if (io) { try { io.disconnect(); } catch (e) {} io = null; }
    door(c, 'door_shown');
  }

  function wire(c) {
    var el = c.on('#wq-jc-go', function () { tap(c); });
    if (shown || !(c.res && c.res.jugnu_ev)) return;
    if (io) { try { io.disconnect(); } catch (e) {} io = null; }
    if (typeof IntersectionObserver === 'function' && el) {
      try {
        io = new IntersectionObserver(function (es) {
          for (var i = 0; i < es.length; i++) if (es[i].isIntersecting && es[i].intersectionRatio >= 0.5) { show(c); return; }
        }, { threshold: [0.5] });
        io.observe(el);
        return;
      } catch (e) { io = null; }
    }
    show(c);
  }

  function tap(c) {
    var now = Date.now();
    if (now - lastTap < 1000) return;
    lastTap = now;
    door(c, 'door_tap');
    confirm(c);
  }

  // The identity step: whose turn it is, before any run.
  function confirm(c) {
    var w = words(c), card = (c.res && c.res.card) || {};
    var first = card.first || c.first || '';
    var h = c.bar() +
      '<div class="wq-card wq-center"><div class="wq-name">' + c.ani(card.animal) + '</div>' +
      '<h2>' + c.esc(first ? w.whoTurnOf(first) : w.whoTurn) + '</h2></div>' +
      '<button class="wq-btn wq-go" id="wq-jc-play">▶ ' + c.esc(c.T.play) + '</button>' +
      '<button class="wq-btn wq-soft" id="wq-jc-back">' + c.esc(w.whoNotMe) + '</button>';
    c.render(h, 'M10-jc');
    c.wireBar();
    c.on('#wq-jc-play', function () { play(c); });
    c.on('#wq-jc-back', function () { c.back(); });
  }

  function play(c) {
    if (going) return;
    going = true;
    c.api('POST', 'hubdoor', { st: c.st, jugnu: 1 }).then(function (r) {
      var href = r.ok && r.body && typeof r.body.href === 'string' ? r.body.href : '';
      c.flushEv(true);
      if (CH_HREF.test(href)) { location.assign(href + '&lang=' + lang(c)); return; }
      going = false;
      c.toast(c.T.oops);
      c.back();
    }, function () { going = false; c.toast(c.T.offline); });
  }

  window.WQCARD = { html: html, wire: wire };
})();
