/*
 * The reading moment (window.WQMoment; app_settings web_quiz_read_feedback): every reading effort is answered at once —
 * how many words, a jar of Jugnu's lights for the speed (the number beside it), stars for reading the words right,
 * a line against the child's OWN last read only, and an effort badge. Loaded only when the payload carries
 * `read_feedback: true` (the Jugnu page's menu, a storybook's `read_fb`); with it off this file is never asked for.
 *
 *   WQMoment.feedback(o)        pure: one read as {words, total, wcpm, prev, acc, zero, showNum}, from a checked read
 *                               {wcpm, previous: {wcpm}, score: {correct, attempted}}, a live count {score, secs}, or a
 *                               page / book read {words_read, words_total, ms, prev_wcpm}; a body with only the server's
 *                               band {feedback: {stars, badge, words_heard}} (another phone) draws that band as is
 *   WQMoment.level(fb, grade)   pure: {lights 0-5, stars 0-3, growth 'up'|'same'|null, badge 'try'|'reader'|'star'|'faster'}
 *                               (a share card takes this, never the number)
 *   WQMoment.html(fb, lang, o)  the block (no buttons: the host keeps its own Next / Share / Home); o = {grade?, size?: 's'}
 *   WQMoment.mount(el, fb, lang, o)  the block just before `el` (or into it, o.into); one sound when the kit is there
 *
 * The jar, its number and the growth line show only on the reading child's own screen (the server sends the speed only
 * to that phone) and only when the read is long enough to be honest (15 words and 6 seconds); otherwise the words, the
 * stars and the badge carry it. A 0-word read has no stars row at all (never empty stars).
 * Copy rules: no test words; gender-neutral آپ; Urdu digits in Urdu; every Urdu run in dir="rtl". Never "slower".
 */
(function () {
  'use strict';
  // Lights by words a minute, by grade (the reading lead's bands): the first light for any word read.
  var BANDS = { lo: [1, 10, 20, 35, 50], mid: [1, 15, 30, 50, 70], hi: [1, 20, 40, 60, 85] };
  var STAR_AT = [0.7, 0.9];      // 2 stars from 70 % of the words read right, 3 from 90 %
  var GROWTH_UP = 2;             // "faster than last time" from 2 more words a minute; within 1 is "steady"
  var MIN_WORDS = 15, MIN_MS = 6000;
  var C = {
    en: {
      words: function (n) { return n === 1 ? 'You read 1 word!' : 'You read ' + n + ' words!'; },
      zero: "Let's read it together!",
      num: function (n) { return n + ' words a minute'; },
      lights: function (n) { return n + ' of 5 lights'; },
      stars: function (n) { return n + ' of 3 stars'; },
      up: 'Faster than last time!', same: 'Steady, just like last time!',
      badge: { reader: 'Brave reader', star: 'Star reader', faster: 'Faster reader', try: 'Brave try' }
    },
    ur: {
      words: function (n) { return n === 1 ? 'آپ نے ۱ لفظ پڑھا!' : 'آپ نے ' + ud(n) + ' لفظ پڑھے!'; },
      zero: 'آئیں مل کر پڑھیں!',
      num: function (n) { return 'ایک منٹ میں ' + ud(n) + ' لفظ'; },
      lights: function (n) { return '۵ میں سے ' + ud(n) + ' روشنیاں'; },
      stars: function (n) { return '۳ میں سے ' + ud(n) + ' ستارے'; },
      up: 'پچھلی بار سے تیز!', same: 'بالکل پچھلی بار کی طرح، شاباش!',
      badge: { reader: 'بہادر پڑھنے والے', star: 'ستارہ پڑھنے والے', faster: 'تیز پڑھنے والے', try: 'زبردست کوشش' }
    }
  };
  function ud(n) { return String(n).replace(/[0-9]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.charAt(+d); }); }
  function L(l) { return l === 'ur' ? 'ur' : 'en'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { var n = Number(v); return isFinite(n) && n > 0 ? n : 0; }

  /* ---------- pure ---------- */
  function feedback(o) {
    o = o || {};
    var sc = o.score || null;
    var words = o.words_read != null ? num(o.words_read) : sc ? num(sc.correct != null ? sc.correct : sc.attempted) : num(o.words);
    var tried = sc && sc.attempted != null ? num(sc.attempted) : null;
    var total = num(o.words_total) || null;
    var ms = num(o.ms) || num(o.secs) * 1000;
    var checked = num(o.wcpm);
    var wcpm = checked ? Math.round(checked) : (words && ms ? Math.round(words / (ms / 60000)) : null);
    var prev = num(o.previous && o.previous.wcpm) || num(o.prev_wcpm) || null;
    var acc = sc && tried ? Math.min(1, num(sc.correct) / tried) : (total ? Math.min(1, words / total) : (o.acc != null ? Math.min(1, num(o.acc) / 100) : null));
    // another phone's body (or a cookie miss): no speed and no words-right, only the server's coarse band — drawn as is
    var band = o.feedback && typeof o.feedback === 'object' && !checked && !(sc && sc.correct != null) ? o.feedback : null;
    if (band) words = num(band.words_heard) || (num(band.stars) ? words : 0);
    var zero = !(words > 0);
    var showNum = !zero && !!wcpm && words >= MIN_WORDS && (checked > 0 || ms >= MIN_MS);
    var fb = { words: words, total: total, wcpm: zero ? null : wcpm, prev: prev, acc: zero ? null : acc, zero: zero, showNum: showNum };
    if (band && !zero) { fb.wcpm = null; fb.showNum = false; fb.band = { stars: Math.max(1, Math.min(3, num(band.stars))) }; }
    return fb;
  }
  function bands(grade) {
    var g = parseInt(String(grade == null ? '' : grade).replace(/[^0-9]/g, ''), 10);
    return g > 0 && g <= 2 ? BANDS.lo : g >= 4 ? BANDS.hi : BANDS.mid;
  }
  function level(fb, grade) {
    fb = fb || {};
    if (fb.zero) return { lights: 0, stars: 0, growth: null, badge: 'try' };
    if (fb.band) return { lights: 0, stars: fb.band.stars, growth: null, badge: fb.band.stars === 3 ? 'star' : 'reader' };
    var b = bands(grade), lights = 0, i;
    // the lights name the speed's band: only on a read long enough to be honest, like the number beside them
    if (fb.wcpm && fb.showNum) { for (i = 0; i < b.length; i++) if (fb.wcpm >= b[i]) lights = i + 1; }
    var stars = fb.acc == null ? 1 : fb.acc >= STAR_AT[1] ? 3 : fb.acc >= STAR_AT[0] ? 2 : 1;
    var growth = null;
    // growth only against the child's own last read, and only when both are honest numbers
    if (fb.prev && fb.wcpm && fb.showNum) growth = fb.wcpm - fb.prev >= GROWTH_UP ? 'up' : Math.abs(fb.wcpm - fb.prev) <= 1 ? 'same' : null;
    return { lights: lights, stars: stars, growth: growth, badge: growth === 'up' ? 'faster' : stars === 3 ? 'star' : 'reader' };
  }

  /* ---------- drawn (never emoji) ---------- */
  function light(on) {
    return '<svg class="wq-moment-light" data-on="' + (on ? 1 : 0) + '" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12" class="wq-moment-halo"/>' +
      '<circle cx="14" cy="14" r="6" class="wq-moment-core"/></svg>';
  }
  function star(on) {
    return '<svg class="wq-moment-star" data-on="' + (on ? 1 : 0) + '" width="36" height="36" viewBox="0 0 120 120" aria-hidden="true">' +
      '<path d="M60 10l15 31 34 5-25 24 6 34-30-16-30 16 6-34-25-24 34-5z"/></svg>';
  }
  var BADGE = '<svg width="44" height="44" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="54" class="wq-moment-disc"/>' +
    '<path d="M60 26l10 21 23 3-17 16 4 23-20-11-20 11 4-23-17-16 23-3z" class="wq-moment-mark"/></svg>';

  function html(fb, lang, o) {
    o = o || {};
    var l = L(lang), c = C[l], lv = level(fb, o.grade), dir = l === 'ur' ? 'rtl' : 'ltr', i;
    var out = '<section class="wq-moment' + (o.size === 's' ? ' wq-moment--s' : '') + '" data-deed="read" data-rf' + (lv.lights ? ' data-level="' + lv.lights + '"' : '') + ' role="status" aria-live="polite" lang="' + l + '" dir="' + dir + '">' +
      '<div class="wq-moment-sky" aria-hidden="true"></div>';
    if (fb.zero) {
      out += '<p class="wq-moment-deed">' + esc(c.zero) + '</p>';
    } else {
      out += '<p class="wq-moment-deed">' + esc(c.words(fb.words)) + '</p>';
      var lights = '';
      for (i = 0; i < 5; i++) lights += light(i < lv.lights);
      // Jugnu's jar with the number beside it: an honest read on the child's own phone only (a short read, another
      // phone: the words and the stars carry it)
      if (lv.lights) out += '<div class="wq-moment-meter" data-level="' + lv.lights + '" role="img" aria-label="' + esc(c.lights(lv.lights)) + '"><span class="wq-moment-jar">' + lights + '</span>' +
        '<span class="wq-moment-num">' + esc(c.num(fb.wcpm)) + '</span></div>';
      var stars = '';
      for (i = 0; i < 3; i++) stars += star(i < lv.stars);
      out += '<div class="wq-moment-stars" data-stars="' + lv.stars + '" role="img" aria-label="' + esc(c.stars(lv.stars)) + '">' + stars + '</div>';
      if (lv.growth) out += '<p class="wq-moment-growth" data-growth="' + lv.growth + '">' + esc(c[lv.growth]) + '</p>';
    }
    out += '<div class="wq-moment-badge" data-badge="' + lv.badge + '">' + BADGE + '<span>' + esc(c.badge[lv.badge]) + '</span></div></section>';
    return out;
  }

  // the block before `el` (or into it): the lights fill by CSS (a 150 ms fade under reduced motion); one sound
  function mount(el, fb, lang, o) {
    o = o || {};
    if (!el) return null;
    var box = document.createElement('div');
    box.innerHTML = html(fb, lang, o);
    var sec = box.firstChild;
    if (o.into) el.appendChild(sec); else if (el.parentNode) el.parentNode.insertBefore(sec, el);
    sound(sec, fb, o);
    return sec;
  }
  function sound(sec, fb, o) {
    var J = window.WQJ;
    if (!J || (o && o.sound === false)) return;
    try {
      var b = sec && sec.querySelector ? sec.querySelector('.wq-moment-badge') : null;
      if (fb && !fb.zero && J.badge) J.badge(b);
      else if (J.sentence) J.sentence();
    } catch (e) { /* the moment still shows */ }
  }

  window.WQMoment = { feedback: feedback, level: level, html: html, mount: mount, sound: sound, BANDS: BANDS };
})();
