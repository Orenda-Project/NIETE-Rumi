/* Jugnu's Book (app_settings web_quiz_challenge_book; the class lights: web_quiz_class_wall). Loaded by the hub page
 * only when the bot says the Book is on (boot `book_on`). No framework, no build step.
 *   WQBOOK.hubLine(B, ctx)  the hub's Book tile and the class lights line, under the greeting
 *   WQBOOK.open(ctx)        the Book screen: lamps, days this week, story stickers, the grown-up's line, the lights
 * The page computes nothing about the child: lamps, outlines, stickers, days, lights and the new lamp all come from
 * the bot (GET /api/wq/book/h/<token>). The page only remembers which new lamp it has already shown, to show it once.
 * Copy: the deck's jg.book.*, jg.rung.*, jg.levelup.*, jg.opens.longer / two_digit / hundreds (the three lamps that open a room), jg.lights.*, jg.parent.* (camelCase of the key tail);
 * "Back" is the library page's shipped string. */
(function () {
  'use strict';
  var T = {
    en: {
      bookTitle: function (n) { return n + '\'s Jugnu Book'; }, bookLamps: 'My lamps', bookReading: 'Reading', bookNumbers: 'Numbers',
      bookDays: 'Days you played this week', bookStickers: 'Story stickers', bookStickersSub: 'One for every whole story',
      bookTrailStickers: 'Trail stickers', bookDayLetters: 'M|T|W|T|F|S|S'.split('|'),
      rungR1: 'Starting a story', rungR2: 'Reading a short story', rungR3: 'Understanding a short story', rungR4: 'Reading a longer story', rungR5: 'Understanding a longer story',
      rungN1: 'Finding numbers', rungN2: 'Comparing numbers', rungN3: 'Filling number gaps', rungN4: 'Counting past 100', rungN5: 'Filling every number gap',
      levelupHead: 'A new lamp is lit!', levelupOpen: function (t) { return 'Now open for you: ' + t; }, levelupSay: 'You read a story and answered its questions.', levelupSayNumbers: 'You filled in the number games!', levelupGo: 'Let\'s go',
      opensLonger: 'longer stories', opensTwoDigit: 'two-digit games', opensHundreds: 'hundreds games',
      lightsTerm: function (n) { return 'Your class has lit ' + n + ' lights this term.'; }, lightsWeek: function (n) { return n + ' of them this week.'; }, lightsHidden: 'Your class is playing too',
      parentShow: 'Show your grown-up', parentLine: function (n) { return 'This is ' + n + '\'s Jugnu Book. Each sticker is a game or a story finished with Jugnu.'; },
      back: 'Back',
    },
    ur: {
      bookTitle: function (n) { return '⁨' + n + '⁩ کی جگنو کتاب'; }, bookLamps: 'میرے دیے', bookReading: 'پڑھنا', bookNumbers: 'گنتی',
      bookDays: 'اس ہفتے آپ نے کن دنوں کھیلا', bookStickers: 'کہانیوں کے اسٹیکر', bookStickersSub: 'ہر پوری کہانی پر ایک اسٹیکر',
      bookTrailStickers: 'جگنو کے راستے کے اسٹیکر', bookDayLetters: 'پیر|منگل|بدھ|جمعرات|جمعہ|ہفتہ|اتوار'.split('|'),
      rungR1: 'کہانی شروع کرنا', rungR2: 'چھوٹی کہانی پڑھنا', rungR3: 'چھوٹی کہانی سمجھنا', rungR4: 'لمبی کہانی پڑھنا', rungR5: 'لمبی کہانی سمجھنا',
      rungN1: 'نمبر ڈھونڈنا', rungN2: 'بڑا چھوٹا نمبر پہچاننا', rungN3: 'غائب نمبر بھرنا', rungN4: 'سو سے آگے گننا', rungN5: 'سارے غائب نمبر بھرنا',
      levelupHead: 'ایک نیا دیا جل گیا!', levelupOpen: function (t) { return 'اب ⁨' + t + '⁩ بھی کھولیں!'; }, levelupSay: 'آپ نے کہانی پڑھی اور اس کے سوالوں کے جواب دیے۔', levelupSayNumbers: 'آپ نے گنتی کے کھیلوں میں نمبر بھر دیے!', levelupGo: 'چلیں',
      opensLonger: 'لمبی کہانیاں', opensTwoDigit: 'دو ہندسوں والے کھیل', opensHundreds: 'سینکڑوں کے کھیل',
      lightsTerm: function (n) { return 'آپ کی کلاس نے اس ٹرم میں ' + n + ' روشنیاں جلائی ہیں۔'; }, lightsWeek: function (n) { return 'ان میں سے ' + n + ' اس ہفتے۔'; }, lightsHidden: 'آپ کی کلاس بھی کھیل رہی ہے',
      parentShow: 'گھر کے بڑوں کو دکھائیں', parentLine: function (n) { return 'یہ ⁨' + n + '⁩ کی جگنو کتاب ہے۔ ہر اسٹیکر ایک کھیل یا کہانی کا ہے جو جگنو کے ساتھ پوری ہوئی۔'; },
      back: 'واپس',
    },
  };
  var OPENS = { longer: 'opensLonger', two_digit: 'opensTwoDigit', hundreds: 'opensHundreds' };
  var STOP_ICON = { missing: '🔢', read: '📖', listen: '🎧', bigger: '⚖️' };
  var SEEN_KEY = 'wq_bk_seen';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function tOf(lang) { return T[lang === 'ur' ? 'ur' : 'en']; }
  // A count in an Urdu line: Urdu digits, no isolate (COPY §C: isolates are for ASCII atoms only).
  function num(n, lang) {
    var s = String(Math.max(0, Math.floor(Number(n) || 0)));
    if (lang !== 'ur') return s;
    return s.replace(/[0-9]/g, function (d) { return String.fromCharCode(0x06F0 + Number(d)); });
  }

  /* ---------------- the class lights line (the bot decided shown / hidden and every number) ---------------- */
  function lightsHtml(cl, lang) {
    if (!cl) return '';
    var t = tOf(lang);
    // nobody else in the class has a light yet (none): "your class is playing too" would not be true, so no line
    if (!cl.shown) return cl.none ? '' : '<p class="wq-bk-lights" data-lights="hidden">✨ ' + esc(t.lightsHidden) + '</p>';
    return '<p class="wq-bk-lights" data-lights="total">✨ ' + esc(t.lightsTerm(num(cl.term_total, lang))) +
      // The week line is its own sentence on its own line (display:block), only from 1: never "0 of them this week".
      (Number(cl.week_n) >= 1 ? ' <span class="wq-bk-week">' + esc(t.lightsWeek(num(cl.week_n, lang))) + '</span>' : '') + '</p>';
  }
  function lightsEvent(cl) {
    if (!cl) return null;
    if (!cl.shown) return { shown: 'hidden_under5' };
    var e = { shown: 'total', term_total: cl.term_total };
    if (cl.week_n) e.week_n = cl.week_n;
    return e;
  }

  /* ---------------- the Book (pure: data in, HTML out) ---------------- */
  function ladderHtml(ladder, lit, outline, lang) {
    var t = tOf(lang);
    var key = ladder === 'reading' ? 'R' : 'N';
    var lamps = '';
    for (var k = 1; k <= Math.min(5, lit); k++) lamps += '<li class="wq-bk-lamp"><span class="wq-bk-glow" aria-hidden="true">🪔</span><span>' + esc(t['rung' + key + k]) + '</span></li>';
    if (outline && lit < 5) lamps += '<li class="wq-bk-outline" aria-hidden="true"></li>';
    return '<div class="wq-bk-ladder" data-ladder="' + ladder + '"><h3>' + esc(ladder === 'reading' ? t.bookReading : t.bookNumbers) + '</h3><ol>' + lamps + '</ol></div>';
  }
  function daysHtml(days, lang) {
    var dots = '';
    var dl = tOf(lang).bookDayLetters;
    // Monday first in the markup: the page's direction puts it on the left in English and on the right in Urdu.
    for (var i = 0; i < 7; i++) dots += '<span class="wq-bk-day"><span class="wq-bk-dot' + (days && days[i] ? ' wq-bk-lit' : '') + '" aria-hidden="true"></span><span class="wq-bk-dl">' + esc(dl[i]) + '</span></span>';
    return '<section class="wq-bk-days"><h2>' + esc(tOf(lang).bookDays) + '</h2><div class="wq-bk-dots">' + dots + '</div></section>';
  }
  function storyHref(ctx, pid) {
    return '/c/' + encodeURIComponent(ctx.token) + '?kid=' + encodeURIComponent(ctx.kid || '') + '&lang=' + (ctx.lang === 'ur' ? 'ur' : 'en') + '&room=story' + (pid ? '&pid=' + encodeURIComponent(pid) : '');
  }
  function levelupHtml(up, ctx) {
    var t = tOf(ctx.lang);
    var thing = up.opens && OPENS[up.opens] ? t[OPENS[up.opens]] : null;
    // The task line only where it is true: a reading lamp that needed answered questions, a numbers lamp past N1.
    var say = up.ladder === 'reading' && (up.rung === 3 || up.rung === 5) ? t.levelupSay : up.ladder === 'numbers' && up.rung >= 2 && up.rung <= 5 ? t.levelupSayNumbers : null;
    return '<section class="wq-bk-up" data-up="' + esc(up.ladder) + '"><span class="wq-bk-glow wq-bk-big" aria-hidden="true">🪔</span><h2>' + esc(t.levelupHead) + '</h2>' +
      (thing ? '<p>' + esc(t.levelupOpen(thing)) + '</p>' : '') + (say ? '<p>' + esc(say) + '</p>' : '') +
      (thing ? '<a class="wq-btn wq-bk-go" id="wq-bk-go" href="' + esc(storyHref(ctx, null)) + '">' + esc(t.levelupGo) + '</a>' : '') + '</section>';
  }
  function bookHtml(d, ctx, showUp) {
    var t = tOf(ctx.lang);
    var lamps = d.lamps || {};
    var nx = d.next_outline || {};
    var trail = (d.trail_stickers || []).map(function (s) { return STOP_ICON[s] ? '<span class="wq-bk-trail" aria-hidden="true">' + STOP_ICON[s] + '</span>' : ''; }).join('');
    var stickers = (d.story_stickers || []).map(function (s) {
      return '<a class="wq-bk-st" data-pid="' + esc(s.passage_id) + '" href="' + esc(storyHref(ctx, s.passage_id)) + '"><span aria-hidden="true">⭐</span><span dir="auto">' + esc(s.title) + '</span></a>';
    }).join('');
    return '<div class="wq-bk-bar"><button class="wq-btn wq-ghost wq-bk-back" id="wq-bk-back">' + esc(t.back) + '</button></div>' +
      '<h1 class="wq-bk-title">' + esc(t.bookTitle(d.name || '')) + '</h1>' +
      (showUp && d.levelup ? levelupHtml(d.levelup, ctx) : '') +
      (trail ? '<section class="wq-bk-trailbox"><h2>' + esc(t.bookTrailStickers) + '</h2><div class="wq-bk-trails">' + trail + '</div></section>' : '') +
      '<section class="wq-bk-lamps"><h2>' + esc(t.bookLamps) + '</h2>' +
      ladderHtml('reading', Number(lamps.reading) || 0, nx.reading === true, ctx.lang) + ladderHtml('numbers', Number(lamps.numbers) || 0, nx.numbers === true, ctx.lang) + '</section>' +
      daysHtml(d.days_this_week, ctx.lang) +
      '<section class="wq-bk-stickers"><h2>' + esc(t.bookStickers) + '</h2><p class="wq-bk-sub">' + esc(t.bookStickersSub) + '</p>' + (stickers ? '<div class="wq-bk-sts">' + stickers + '</div>' : '') + '</section>' +
      '<section class="wq-bk-parent"><button class="wq-btn wq-bk-show" id="wq-bk-show">' + esc(t.parentShow) + '</button><p class="wq-bk-pline" id="wq-bk-pline" hidden>' + esc(t.parentLine(d.name || '')) + '</p></section>' +
      lightsHtml(d.class_lights, ctx.lang);
  }

  /* ---------------- the new lamp, once ---------------- */
  function seenStore(ctx) { return ctx.store || (typeof localStorage !== 'undefined' ? localStorage : null); }
  function seenOf(ctx) {
    try { var all = JSON.parse(seenStore(ctx).getItem(SEEN_KEY) || '{}') || {}; return all[ctx.kid || ''] || {}; } catch (e) { return {}; }
  }
  function markSeen(ctx, up) {
    try {
      var s = seenStore(ctx);
      var all = JSON.parse(s.getItem(SEEN_KEY) || '{}') || {};
      var mine = all[ctx.kid || ''] || {};
      mine[up.ladder] = Math.max(Number(mine[up.ladder]) || 0, Number(up.rung) || 0);
      all[ctx.kid || ''] = mine;
      s.setItem(SEEN_KEY, JSON.stringify(all));
    } catch (e) {}
  }
  function showLevelup(d, ctx) {
    var up = d && d.levelup;
    if (!up || (up.ladder !== 'reading' && up.ladder !== 'numbers')) return false;
    return (Number(seenOf(ctx)[up.ladder]) || 0) < (Number(up.rung) || 0);
  }

  /* ---------------- screens ---------------- */
  var wallSent = false;
  function wallEvent(cl, ctx) {
    var e = lightsEvent(cl);
    if (!e || wallSent || typeof ctx.ev !== 'function') return;
    wallSent = true;
    ctx.ev('class_wall_shown', e);
  }
  function api(ctx) {
    var url = '/api/wq/book/h/' + encodeURIComponent(ctx.token) + '?kid=' + encodeURIComponent(ctx.kid || '') + '&l=' + (ctx.lang === 'ur' ? 'ur' : 'en');
    return fetch(url, { method: 'GET', headers: { accept: 'application/json' }, credentials: 'same-origin' }).then(function (r) {
      return r.text().then(function (t) { var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {} if (!r.ok || !j) throw new Error('book_' + r.status); return j; });
    });
  }
  function render(ctx, d) {
    var up = showLevelup(d, ctx);
    ctx.root.innerHTML = '<section class="wq-screen wq-bk" data-m="BK">' + bookHtml(d, ctx, up) + '</section>';
    ctx.root.setAttribute('data-m', 'BK');
    if (up) markSeen(ctx, d.levelup);
    try { window.scrollTo(0, 0); } catch (e) {}
    var back = ctx.root.querySelector('#wq-bk-back');
    if (back) back.addEventListener('click', function () { if (typeof ctx.back === 'function') ctx.back(); });
    var show = ctx.root.querySelector('#wq-bk-show');
    if (show) show.addEventListener('click', function () { var p = ctx.root.querySelector('#wq-bk-pline'); if (p) p.hidden = false; });
    wallEvent(d.class_lights, ctx);
  }
  function open(ctx) {
    return api(ctx).then(function (d) { render(ctx, d); return d; }).catch(function () { if (typeof ctx.back === 'function') ctx.back(); return null; });
  }
  function hubLine(B, ctx) {
    var t = tOf(ctx.lang);
    var me = (B.kids || []).filter(function (k) { return k.chip === B.kid; })[0] || {};
    var html = '<div class="wq-bk-hub"><a class="wq-htile wq-bk-tile" id="wq-bk-open" href="#book"><span class="wq-htic" aria-hidden="true">📒</span><b>' + esc(t.bookTitle(me.first || '')) + '</b></a>' +
      lightsHtml(B.class_lights, ctx.lang) + '</div>';
    // One tile per hub: a late second call (the hub drawn again while this loaded) replaces it, never adds another.
    Array.prototype.forEach.call(ctx.root.querySelectorAll ? ctx.root.querySelectorAll('.wq-bk-hub') : [], function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
    // After the hub's top block (its tiles), before Play again / Try these next; else before Switch player; else at the end.
    var tiles = ctx.root.querySelector('.wq-htiles');
    var sw = ctx.root.querySelector('#wq-h-switch');
    var sec = ctx.root.querySelector('.wq-hub');
    if (tiles && tiles.insertAdjacentHTML) tiles.insertAdjacentHTML('afterend', html);
    else if (sw && sw.insertAdjacentHTML) sw.insertAdjacentHTML('beforebegin', html);
    else if (sec && sec.insertAdjacentHTML) sec.insertAdjacentHTML('beforeend', html);
    var tile = ctx.root.querySelector('#wq-bk-open');
    if (tile) tile.addEventListener('click', function (e) { if (e && e.preventDefault) e.preventDefault(); open({ root: ctx.root, token: ctx.token, kid: B.kid, lang: ctx.lang, ev: ctx.ev, back: ctx.back, store: ctx.store }); });
    wallEvent(B.class_lights, ctx);
    return html;
  }

  window.WQBOOK = { open: open, hubLine: hubLine, _bookHtml: bookHtml, _lightsHtml: lightsHtml, _showLevelup: showLevelup, _render: render };
})();
