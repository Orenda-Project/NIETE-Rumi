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
 *   WQMoment.page(s, p, lang, o) / hear(pl, p, s, o)  a storybook page's read: the small block (+ "Hear Jugnu say it"
 *                               on a skipped word, + "read it again for 3 stars"; o.still: a redraw, no motion) and
 *                               that sentence played as a slice of the page's own take
 *   WQMoment.again(fb, lang, o) the minute's "read it again to light one more!" soft button (#wqc-rfagain), or '' (and
 *                               always '' with o.hold: a held card, before the check, whose result could still change)
 *   WQMoment.card(fb, lang, o)  html() with that offer inside the card, under the jar it fills (never loose on the screen)
 *
 * The jar, its number and the growth line show only on the reading child's own screen (the server sends the speed only
 * to that phone) and only when the read is long enough to be honest (15 words and 6 seconds); otherwise the words, the
 * stars and the badge carry it. A 0-word read has no stars row at all (never empty stars).
 * Copy rules: no test words; gender-neutral آپ; Urdu digits in Urdu; every Urdu run in dir="rtl". Never "slower".
 */
(function () {
  'use strict';
  // Lights by words a minute, by grade (the reading bands): the first light for any word read.
  var BANDS = { lo: [1, 10, 20, 35, 50], mid: [1, 15, 30, 50, 70], hi: [1, 20, 40, 60, 85] };
  var STAR_AT = [0.7, 0.9];      // 2 stars from 70 % of the words read right, 3 from 90 %
  // "faster than last time" from 5 more words a minute; within 3 either way is "steady" (one read's speed moves by
  // about 5 words a minute between passages for the same child, so smaller moves are noise, not growth)
  var GROWTH_UP = 5, SAME_WITHIN = 3;
  var MIN_WORDS = 15, MIN_MS = 6000;
  var C = {
    en: {
      words: function (n) { return n === 1 ? 'You read 1 word!' : 'You read ' + n + ' words!'; },
      some: 'You read it out loud!', all: 'You read the whole story!',
      zero: "Let's read it together!",
      num: function (n) { return n === 1 ? '1 word a minute' : n + ' words a minute'; },
      lights: function (n) { return n + ' of 5 lights'; },
      stars: function (n) { return n + ' of 3 stars'; },
      up: 'Faster than last time!', same: 'Steady, just like last time!', hear: 'Hear Jugnu say it',
      again: 'Read it again to light one more!', again3: 'Read it again for 3 stars!',
      near: "I can't hear you yet. Come a little closer!", withJ: 'Read with Jugnu', readAgain: 'Read it again', once: "Let's read it once more!", home: 'Home',
      badge: { reader: 'Brave reader', star: 'Star reader', faster: 'Faster reader', try: 'Brave try' }
    },
    ur: {
      words: function (n) { return n === 1 ? 'آپ نے ۱ لفظ پڑھا!' : 'آپ نے ' + ud(n) + ' لفظ پڑھے!'; },
      some: 'آپ نے اونچی آواز میں پڑھا!', all: 'آپ نے پوری کہانی پڑھی!',
      zero: 'آئیں مل کر پڑھیں!',
      num: function (n) { return 'ایک منٹ میں ' + ud(n) + ' لفظ'; },
      lights: function (n) { return 'روشنیاں: ۵ میں سے ' + ud(n); },
      stars: function (n) { return 'ستارے: ۳ میں سے ' + ud(n); },
      up: 'پچھلی بار سے تیز!', same: 'بالکل پچھلی بار کی طرح، شاباش!', hear: 'جگنو سے سنیں',
      again: 'ایک اور روشنی کے لیے پھر سے پڑھیں!', again3: 'تین ستاروں کے لیے پھر سے پڑھیں!',
      near: 'مجھے ابھی آپ کی آواز نہیں آ رہی۔ تھوڑا قریب آئیں!', withJ: 'جگنو کے ساتھ پڑھیں', readAgain: 'پھر سے پڑھیں', once: 'آئیں، ایک بار پھر پڑھیں!', home: 'گھر',
      badge: { reader: 'ہمت کا تمغہ', star: 'پڑھائی کا ستارہ', faster: 'رفتار کا تمغہ', try: 'ہمت والی کوشش' }
    }
  };
  function ud(n) { return String(n).replace(/[0-9]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.charAt(+d); }); }
  function L(l) { return l === 'ur' ? 'ur' : 'en'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function bare(s) { return String(s == null ? '' : s).replace(/[!.۔\s]+$/, ''); }
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
    // its words heard, or (another phone) only none / some / all of the story: then the deed says that, never a count
    if (band) words = band.read ? (band.read === 'none' ? 0 : words || 1) : num(band.words_heard) || (num(band.stars) ? words : 0);
    var zero = !(words > 0);
    var showNum = !zero && !!wcpm && words >= MIN_WORDS && (checked > 0 || ms >= MIN_MS);
    var fb = { words: words, total: total, wcpm: zero ? null : wcpm, prev: prev, acc: zero ? null : acc, zero: zero, showNum: showNum };
    if (band && !zero) { fb.wcpm = null; fb.showNum = false; fb.band = { stars: Math.max(1, Math.min(3, num(band.stars))) }; if (band.read === 'some' || band.read === 'all') fb.read = band.read; }
    return fb;
  }
  function bands(grade) {
    var g = parseInt(String(grade == null ? '' : grade).replace(/[^0-9]/g, ''), 10);
    // a grade not known reads on the kindest bands: a young child with no grade on file never gets fewer lights
    return !(g >= 3) ? BANDS.lo : g >= 4 ? BANDS.hi : BANDS.mid;
  }
  function level(fb, grade) {
    fb = fb || {};
    if (fb.zero) return { lights: 0, stars: 0, growth: null, badge: 'try' };
    if (fb.band) return { lights: 0, stars: fb.band.stars, growth: null, badge: fb.band.stars === 3 ? 'star' : 'reader' };
    var b = bands(grade), lights = 0, i;
    // the lights name the speed's band: only on a read long enough to be honest, like the number beside them
    if (fb.wcpm && fb.showNum) { for (i = 0; i < b.length; i++) if (fb.wcpm >= b[i]) lights = i + 1; }
    // a short page (a few words) forgives one word missed (often the checker's miss): 3 stars from 70 % then
    var one = fb.total && fb.total - fb.words <= 1;
    var stars = fb.acc == null ? 1 : fb.acc >= STAR_AT[1] || (one && fb.acc >= STAR_AT[0]) ? 3 : fb.acc >= STAR_AT[0] ? 2 : 1;
    var growth = null;
    // growth only against the child's own last read, and only when both are honest numbers; words read right come
    // before speed, so "faster" (and its badge) only from 2 stars
    if (fb.prev && fb.wcpm && fb.showNum) growth = fb.wcpm - fb.prev >= GROWTH_UP ? (stars >= 2 ? 'up' : null) : Math.abs(fb.wcpm - fb.prev) <= SAME_WITHIN ? 'same' : null;
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
    var out = '<section class="wq-moment' + (o.size === 's' ? ' wq-moment--s' : '') + (o.still ? ' wq-moment--still' : '') + '" data-deed="read" data-moment="' + esc(o.moment || 'read-result') + '" data-rf' + (lv.lights ? ' data-level="' + lv.lights + '"' : '') + ' role="status" aria-live="polite" lang="' + l + '" dir="' + dir + '">' +
      '<div class="wq-moment-sky" aria-hidden="true"></div>';
    // Jugnu stays and reacts (o.jg: a host with no Jugnu of its own on the result): cheering 3 stars, happy for fewer,
    // hello after a 0-word try
    if (o.jg) out += '<img class="wq-moment-jg" src="/wq/jugnu/' + (fb.zero ? 'hello' : lv.stars === 3 ? 'celebrate' : 'correct') + '.webp" width="' + (o.size === 's' ? 56 : 72) + '" height="' + (o.size === 's' ? 56 : 72) + '" alt="" aria-hidden="true">';
    // o.said: the host's own Jugnu line; when it already says "let's read it together", the moment does not say it twice
    if (fb.zero) {
      // o.once: no read-along on this card, so the line asks for what its button does ("let's read it once more")
      if (bare(o.said) !== bare(c.zero)) out += '<p class="wq-moment-deed">' + esc(o.once ? c.once : c.zero) + '</p>';
    } else {
      out += '<p class="wq-moment-deed">' + esc(fb.read ? c[fb.read] : c.words(fb.words)) + '</p>';
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
    out += '<div class="wq-moment-badge" data-badge="' + lv.badge + '"' + (fb.zero ? ' data-stamp' : '') + '>' + BADGE + '<span>' + esc(c.badge[lv.badge]) + '</span></div></section>';
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

  /* ---------- a storybook page (wq-stories-q.js after Your turn) ---------- */
  // s: the page's read {words_read, words_total, ms, marks}; p: the page {words, audio, quality}; o.sents: the reader's
  // sentence splitter. The sentence holding the first skipped word, as word indexes and its end in the page's take;
  // none on a page with no voice or poor word timings (quality low)
  function slice(p, s, o) {
    var k = s && s.marks ? s.marks.indexOf('skipped') : -1, ss, j;
    if (k < 0 || !p || !p.audio || p.quality === 'low' || !o || !o.sents) return null;
    ss = o.sents(p.words || []);
    for (j = 0; j < ss.length; j++) if (k >= ss[j][0] && k <= ss[j][1]) return { from: ss[j][0], to: ss[j][1], e_ms: (p.words[ss[j][1]] || {}).e_ms };
    return null;
  }
  // {html, fb}: the small moment, then (o.hear: the practise card) "Hear Jugnu say it" when there is a sentence to play
  function page(s, p, lang, o) {
    o = o || {};
    var fb = feedback({ words_read: s.words_read, words_total: s.words_total, ms: s.ms });
    var h = html(fb, lang, { grade: o.grade, size: 's', jg: 1, still: o.still });
    // the practise card (o.hear) offers one thing at a time: the word chip first; "read it again for 3 stars" once the
    // chip was tapped (o.chipped: this read's chip already was); the sentence plays from the chip's later taps (chip())
    if (o.hear && slice(p, s, o)) h += '<button class="wqs-sec" data-tap="rfhear" data-in-chip data-sound data-trigger="tap">' + esc(C[L(lang)].hear) + '</button>';
    // read it again for 3 stars (a page is too short for lights); never after a 0-word try (that card leads with it)
    if (!fb.zero && level(fb, o.grade).stars < 3) h += '<button class="wqs-sec" data-tap="rfagain"' + (o.hear && !o.chipped ? ' data-after-chip' : '') + '>' + esc(C[L(lang)].again3) + '</button>';
    return { html: h, fb: fb };
  }
  // play that sentence on the reader's own player (never a second one: one voice per book, the one mute), then stop.
  // The 40 ms watch ends with it, and never outlives it: the reader gone (o.live), the player stopped for a second
  // (read it again), the take started again from earlier (the page's own Listen: never cut at this sentence's end)
  var hearT = null;
  function hear(pl, p, s, o) {
    var x = slice(p, s, o);
    if (!x || !pl) return;
    if (hearT) o.clear(hearT);
    pl.seekToWord(x.from); pl.play();
    var last = -1, idle = 0;
    hearT = o.set(function tk() {
      var a = pl.audio, t = a ? a.currentTime * 1000 : 0;
      hearT = null;
      if (!a || (o.live && !o.live()) || t < last - 250 || (a.paused && ++idle > 25)) return;
      if (t >= x.e_ms || pl.current > x.to) { pl.pause(); return; }
      if (!a.paused) idle = 0;
      last = t;
      hearT = o.set(tk, 40);
    }, 40);
  }

  // the minute's read: "read it again for 3 stars!" under 3 stars (words right first), else "read it again to light one
  // more!" (a soft button for the host) on an honest read short of 5 lights; '' otherwise (a short read, another
  // phone, a 0-word try, 5 lights, o.hold: a card before the check)
  function again(fb, lang, o) {
    if (o && o.hold) return '';
    var lv = level(fb, (o || {}).grade), n = lv.lights;
    return n > 0 && n < 5 ? '<button class="wq-btn wq-soft" id="wqc-rfagain" type="button">' + esc(C[L(lang)][lv.stars < 3 ? 'again3' : 'again']) + '</button>' : '';
  }

  // o.retry: a 0-word try on a card with no Try again of its own (the folded card) gets one; it says "read it again", as
  // Jugnu's line asks ("let's read it together"), never a bare "try again"
  function card(fb, lang, o) {
    var a = fb && fb.zero && o && o.retry ? '<button class="wq-btn wq-soft" id="wqc-rfagain" type="button">' + esc(C[L(lang)].readAgain) + '</button>' : again(fb, lang, o), h = html(fb, lang, o);
    return a ? h.replace(/<\/section>$/, '<div class="wq-moment-again">' + a + '</div></section>') : h;
  }

  // a read with no voice yet (the storybook's Your turn, every tick): at 6 s Jugnu leans in with "come a little
  // closer", at 15 s the offer to read with Jugnu (data-tap="rfwith"); a word heard takes it away. el: the read screen's
  // [data-near] line; g: Jugnu ([data-jg]); v: the live reader's view; ms since the read began
  function near(el, g, v, ms, lang) {
    if (!el) return;
    var c = C[L(lang)], k = v && v.heard > 0 ? 0 : ms >= 15000 ? 2 : ms >= 6000 ? 1 : 0;
    el.hidden = !k;
    if (g) g.className = String(g.className || '').replace(/ ?wq-moment-lean/g, '') + (k ? ' wq-moment-lean' : '');
    if (el.rfK === k) return;
    el.rfK = k;
    el.innerHTML = k ? '<span>' + esc(c.near) + '</span>' + (k === 2 ? ' <button class="wqs-sec" data-tap="rfwith">' + esc(c.withJ) + '</button>' : '') : '';
  }
  function say(k, lang) { return C[L(lang)][k]; }
  function fit() { try { window.dispatchEvent(new Event('resize')); } catch (e) { /* the taps stay where they were */ } }
  // once per result: the sound, the fanfare and the moment's motion play on a result's first draw only (key: the run
  // token and the card); a redraw of the same result (live, then checked, then the words) is laid in still and silent
  var fired = {};
  function once(key) { if (fired[key]) return false; fired[key] = 1; return true; }
  function fresh(key) { return !fired[key]; }
  // the storybook reader's glue (wq-stories-q.js keeps its size budget): q(k, R, m, x) with the reader R, its machine m
  //   'page': this page's read, drawn (x {rd, st, sents}); 'hear': its skipped sentence played; 'withJ': the chip's "Read with Jugnu"; 'line': the read screen's [data-near] line; 'tick': near() for this read
  //   (x {g, v, ms}); 'with': stop the quiet read; 'after': after the result, Jugnu reads the page when that was tapped
  // the practise card's word chip (the reader's .wqs-word), heard before the reader's own tap: its first tap is the word
  // (and opens "read it again for 3 stars"); a later tap plays the word's sentence ("Hear Jugnu say it") instead
  var chipOn = 0, chipRd = null;
  function chip(e) {
    var c = e && e.target && e.target.closest ? e.target.closest('.wqs-word') : null, box = c && c.parentNode, hb;
    if (!box) return;
    if (!box.classList.contains('wq-moment-chipped')) { box.classList.add('wq-moment-chipped'); if (chipRd) chipRd.chipped = 1; return; }
    hb = box.querySelector('[data-in-chip]');
    if (hb) { e.stopPropagation(); e.preventDefault(); hb.click(); }
  }
  // a page's result keeps the whole page in view (the reader's own Whole page, which the next page resets): a word
  // replayed from the chip never zooms the art past the screen's edges
  function whole(root) {
    var w = root.querySelector('[data-whole]');
    if (w && w.getAttribute('aria-pressed') !== 'true' && root._wqs) root._wqs('cam');
  }
  // art(box, cam, image, all lines, framed lines, stage [w, h], rtl, at rest): the words framed big (Your turn; an Urdu
  // page at rest) never leave a cut sliver of the picture. The lines keep the reader's own zoom (at rest: within half the
  // stage) on the far side from the picture; the host clips the sheet to them, never into a printed line not being read,
  // and the picture (the sheet's side away from all its words) sits whole and flush on them in the room left, or not at
  // all when it would be under 96 px. null: framed as before (the picture already whole in view, no picture side of its
  // own, or at rest words that would not come up by a quarter)
  // one (web_quiz_read_sheet, the book's read_sheet): the band and the picture are one sheet. Where the framed lines still
  // read at the size the page takes across the stage (a line 25.5 px or more), the band is drawn at that size, so the
  // picture under it is the same page carrying on (no seam, nothing sliced). The picture is drawn at the band's width
  // and its box ends at it; a stage too short for that draws both narrower together (centred, one width), or leaves the
  // picture out when the lines would no longer read. -> {.., one: true}
  // one 2 (web_quiz_read_sheet_fit, the book's read_sheet 2): never words with empty room where the picture would fit.
  // Where it would be left out, the words keep their size and the picture is its own card (rounded all round, centred,
  // 8 px under the band) in the room left, when that is 96 px or more; the stage says the picture's side inset
  // (--wqs-pi), so Jugnu's hint bubble is never wider than the picture it sits on
  // one 3 (web_quiz_read_sheet_trim, the book's read_sheet 3): that own card holds the drawing only (ink()), never the
  // blank paper above or below it, and the drawing takes the room the paper had; again: the host's re-frame, run once
  // when a picture still loading has come in
  function art(a, cam, im, all, bs, d, rtl, rs, one, again) {
    var own = 0, ik, Y0 = 1e9, Y1 = -1e9, x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, nt = 1e9, pb = 0, mh = 1e9, r = function (v) { return Math.round(v * 10) / 10; }, kf, k0, s, tx, p, dn, cy, ch, ty, g, z, i, m, c0, c1, zf, R, s0, t0, lo, hi, k, wl, ps;
    all.forEach(function (b) { Y0 = Math.min(Y0, b[1]); Y1 = Math.max(Y1, b[1] + b[3]); });
    bs.forEach(function (b) { x0 = Math.min(x0, b[0]); x1 = Math.max(x1, b[0] + b[2]); y0 = Math.min(y0, b[1]); y1 = Math.max(y1, b[1] + b[3]); mh = Math.min(mh, b[3]); });
    // one: a stage held at the sheet (its cap, below) is framed in the room the sheet was drawn in, so the cap holds still
    ps = one && a.parentNode;
    if (ps && ps.wqsRoom && ps.wqsRoom[0] === d[0] && ps.wqsRoom[2] === Math.round(d[1])) d = [d[0], ps.wqsRoom[1]];
    dn = im.h - Y1 >= Y0; ch = dn ? im.h - Y1 : Y0;
    if (ch < im.h * .2) return null;
    kf = cam(bs, d[0], d[1], im.w, im.h, rtl, 3, 1); k0 = rs ? cam(null, d[0], d[1], im.w, im.h) : kf;
    if (!rs && -k0.ty / k0.s <= (dn ? Y1 : 0) + 1 && (d[1] - k0.ty) / k0.s >= (dn ? im.h : Y0) - 1 && im.w * k0.s <= d[0] + 1) return null;
    s = rs ? Math.round(Math.min(kf.s, d[1] * .5 / ((y1 - y0) * 1.16)) * 1000) / 1000 : kf.s;
    if (rs && s < k0.s * 1.25) return null;
    tx = s === kf.s ? kf.tx : (x1 - x0) * s <= d[0] * .92 ? d[0] / 2 - (x0 + x1) / 2 * s : rtl ? d[0] * .96 - x1 * s : d[0] * .04 - x0 * s;
    tx = r(Math.min(0, Math.max(d[0] - im.w * s, tx)));
    // one sheet: the page across the stage, when its lines read at that size
    zf = Math.floor(d[0] / im.w * 1000) / 1000;
    if (one && zf <= s && mh * zf >= 25.5) { s = zf; tx = 0; }
    function frame() {
      p = Math.round((y1 - y0) * s * .08) + 8;
      ty = r(dn ? p - y0 * s : d[1] - p - y1 * s);
      // the printed lines next to the framed ones bound the clip
      nt = 1e9; pb = 0;
      all.forEach(function (b) { var c = b[1] + b[3] / 2; if (c > y1) nt = Math.min(nt, b[1]); if (c < y0) pb = Math.max(pb, b[1] + b[3]); });
      c0 = Math.max(0, y0 - p / s, Math.min(y0, pb)); c1 = Math.min(im.h, y1 + p / s, Math.max(y1, nt));
      // the picture: below (above) every printed line, carrying on where the clipped sheet stops
      cy = dn ? Math.max(Y1, c1) : 0; ch = dn ? im.h - cy : Math.min(Y0, c0);
      g = dn ? [r(c1 * s + ty), d[1]] : [0, r(c0 * s + ty)];
    }
    frame();
    if (one) {
      // the picture at the band's width
      z = Math.min(im.w * s, d[0]) / im.w; wl = 1;
      if (z * ch > g[1] - g[0]) {
        // a stage too short for it: the largest size, at or under the band's, at which the band and the picture fit
        // together (one width, one scale, centred) while a drawn line is still the reader's readable size (25.5 px);
        // below that the picture goes first and the words keep their size
        s0 = s; t0 = tx; lo = 25.5 / mh; hi = Math.min(s, zf); wl = 0;
        s = lo; frame();
        if (lo <= hi && ch * s <= g[1] - g[0]) {
          for (k = 0; k < 14; k++) { s = (lo + hi) / 2; frame(); if (ch * s <= g[1] - g[0]) lo = s; else hi = s; }
          s = Math.floor(lo * 1000) / 1000; tx = r((d[0] - im.w * s) / 2); frame(); z = s;
        } else {
          s = s0; tx = t0; frame(); z = 0;
          if (one >= 2) {
            z = Math.min((g[1] - g[0] - 8) / ch, d[0] / im.w, s); if (z * ch >= 96) own = 1; else z = 0;
            if (own && one === 3 && (ik = ink(a, im, cy, cy + ch, again)) && Math.min((g[1] - g[0] - 8) / (ik[1] - ik[0]), d[0] / im.w, s) * (ik[1] - ik[0]) >= 96) {
              cy = ik[0]; ch = ik[1] - ik[0]; z = Math.min((g[1] - g[0] - 8) / ch, d[0] / im.w, s);
            }
          }
        }
      }
    } else z = Math.min((d[0] - 24) / im.w, (g[1] - g[0] - 12) / ch, s);
    a.setAttribute('data-art', z * ch >= 96 ? 'on' : 'off');
    // one: the box says so, and the stage drops its white card (wq-moment.css)
    if (one) a.setAttribute('data-one', 'on');
    // one: the box ends at the picture (no strip under it)
    if (one && z * ch >= 96) g = own ? (dn ? [r(g[0] + 8), r(g[0] + 8 + ch * z)] : [r(g[1] - 8 - ch * z), r(g[1] - 8)]) : dn ? [g[0], r(g[0] + ch * z)] : [r(g[1] - ch * z), g[1]];
    a.style.top = g[0] + 'px'; a.style.height = r(Math.max(0, g[1] - g[0])) + 'px'; a.style.alignItems = dn ? 'flex-start' : 'flex-end';
    i = a.querySelector('i'); m = i && i.querySelector('img');
    if (m) { i.style.width = m.style.width = r(im.w * z) + 'px'; i.style.height = r(ch * z) + 'px'; i.style.borderRadius = own ? '12px' : dn ? '0 0 12px 12px' : '12px 12px 0 0'; m.style.transform = 'translateY(' + r(-cy * z) + 'px)'; }
    if (!one) return { s: s, tx: tx, ty: ty, clip: 'inset(' + r(c0) + 'px 0 ' + r(im.h - c1) + 'px 0)' };
    // one: the stage ends at a sheet that stops short of it (the page as wide as it goes), so nothing empty shows above
    // the row under it; a sheet shrunk to fit takes the stage as it is
    if (z * ch >= 96 && !own) {
      // the band runs on 2 px under the picture's edge (the same page there), so no hairline shows at the join
      if (dn) c1 = Math.min(im.h, c1 + 2 / s); else c0 = Math.max(0, c0 - 2 / s);
    } else if (dn) c1 = Math.min(c1, y1 + 2 / s); else c0 = Math.max(c0, y0 - 2 / s);   // no picture: tight to the lines, never into the art
    // ... and with the picture left out the stage ends at the band too (the sheet is never resized for the hint, which
    // sits over its foot, wq-moment.css, so the cap holds still)
    k = Math.ceil(z * ch >= 96 ? g[1] : c1 * s + ty);
    if (ps && ps.style && ps.style.setProperty) {
      i = dn && (wl || own || z * ch < 96) && k < d[1] - .5;
      ps.style.setProperty('--wqs-cap', i ? k + 'px' : 'none'); ps.style.setProperty('--wqs-min', i ? Math.min(200, k) + 'px' : '200px');
      ps.wqsRoom = i ? [d[0], d[1], k] : null;
      if (one >= 2) ps.style.setProperty('--wqs-pi', z * ch >= 96 ? r(Math.max(0, (d[0] - im.w * z) / 2)) + 'px' : '0px');
    }
    // one: the band's own outer corners round like the picture's (all four when the picture is left out)
    R = r(12 / s) + 'px';
    return { s: s, tx: tx, ty: ty, one: true, clip: 'inset(' + r(c0) + 'px 0 ' + r(im.h - c1) + 'px 0 round ' + (z * ch < 96 || own ? R : dn ? R + ' ' + R + ' 0 0' : '0 0 ' + R + ' ' + R) + ')' };
  }
  // the drawing's rows in the picture's part [y0, y1] (image px), with a thin margin: a small canvas, read once per picture
  // part and kept on the box. The box's own picture, or the stage's copy of it (the same file, drawn already) while the
  // box's is still loading. null when there is nothing to read (no canvas, neither loaded: framed again on its load, a
  // tainted canvas) or no ink: the card is then read_sheet 2's
  function ink(a, im, y0, y1, again) {
    var i = a.querySelector && a.querySelector('i'), m = i && i.querySelector && i.querySelector('img'), key, v = null, w = 120, h, c, x, px, t = -1, b = -1, n, o, rr, j, u, pad = 16, ok = function (e) { return e && e.complete && e.naturalWidth; };
    if (!m) return null;
    key = Math.round(y0) + ':' + Math.round(y1) + ':' + m.src;
    if (a.wqsInk && a.wqsInk[0] === key) return a.wqsInk[1];
    if (!ok(m)) {
      o = a.parentNode && a.parentNode.querySelectorAll ? a.parentNode.querySelectorAll('img') : [];
      for (j = 0; j < o.length && !ok(m); j++) if (o[j].src === m.src && ok(o[j])) m = o[j];
      if (!ok(m)) { if (!m.wqsInkWait && m.addEventListener) { m.wqsInkWait = 1; m.addEventListener('load', again || fit); } return null; }
    }
    try {
      u = m.naturalWidth / im.w; h = Math.max(1, Math.min(200, Math.round((y1 - y0) * w / im.w)));
      c = document.createElement('canvas'); c.width = w; c.height = h; x = c.getContext('2d');
      x.drawImage(m, 0, y0 * u, m.naturalWidth, (y1 - y0) * u, 0, 0, w, h);
      px = x.getImageData(0, 0, w, h).data;
      for (rr = 0; rr < h; rr++) {
        for (n = 0, j = 0; j < w; j++) { o = (rr * w + j) * 4; if (px[o + 3] > 40 && px[o] + px[o + 1] + px[o + 2] < 645) n++; }
        if (n >= 2) { if (t < 0) t = rr; b = rr; }
      }
      if (t >= 0) v = [Math.max(y0, y0 + t * (y1 - y0) / h - pad), Math.min(y1, y0 + (b + 1) * (y1 - y0) / h + pad)];
    } catch (e) { v = null; }
    a.wqsInk = [key, v];
    return v;
  }
  function q(k, R, m, x) {
    var y;
    // its first draw: the picture has just given up height (wq-moment.css), so the page's word taps are placed again
    if (k === 'page') {
      if (x.st === 'practise') { chipRd = x.rd; if (!chipOn && document.addEventListener) { chipOn = 1; document.addEventListener('click', chip, true); } }
      y = page(x.rd.s, R.P[m.i], R.L, { grade: R.b.grade, hear: x.st === 'practise', chipped: x.rd.chipped, sents: x.sents, still: x.rd.drawn });
      // a 0-word try: the host draws Read with Jugnu on any grade; with no voice to read with, Read it again (never Listen alone)
      if (y.fb.zero && !(R.b.lr3 && R.P[m.i].audio && !R.keyNo)) y.html += '<button class="wqs-sec" data-tap="rfagain">' + esc(C[L(R.L)].readAgain) + '</button>';
      if (!x.rd.drawn) R.C.set(fit, 0); R.C.set(function () { if (R.live()) whole(R.root); }, 0); x.rd.drawn = 1; x.rd.fb = y.fb; return y.html; }
    if (k === 'hear') return R.pl && hear(R.pl, R.P[m.i], x.rd.s, { sents: x.sents, set: R.C.set, clear: R.C.clear, live: R.live });
    if (k === 'withJ') return say(k, R.L);
    if (k === 'line') return '<p class="wqs-near" data-near hidden></p>';
    if (k === 'tick') {
      // one sheet (read_sheet): with its picture, the hint is a bubble over the picture's foot, out of the page's flow, so
      // the sheet keeps its reading size when it shows (wq-moment.css); without one (the stage held at the band) it is a
      // line under the sheet, never over the words being read
      y = R.root.querySelector('[data-near]');
      var st = R.b && R.b.read_sheet && R.root.querySelector('[data-stage]'), pa = R.root.querySelector('[data-art]'), mb;
      if (y && st) {
        pa = pa && !pa.hidden && pa.getAttribute('data-art') === 'on';
        if (pa && y.parentNode !== st && st.appendChild) st.appendChild(y);
        else if (!pa && y.parentNode === st && (mb = R.root.querySelector('[data-tap="main"]')) && mb.parentNode) mb.parentNode.insertBefore(y, mb);
      }
      return near(y, x.g, x.v, x.ms, R.L);
    }
    if (k === 'with') { R.rfw = 1; if (R.lr) R.lr.stop('done_tap'); return; }
    if (R.rfw) { R.rfw = 0; if (m.label() === 'listen') m.primary(); }
  }

  // label(lang, key): one of the moment's own words, for a host button that does the moment's action (the folded card)
  function label(lang, k) { return C[L(lang)][k]; }
  window.WQMoment = { art: art, chip: chip, label: label, feedback: feedback, level: level, html: html, mount: mount, sound: sound, page: page, hear: hear, again: again, card: card, near: near, say: say, once: once, fresh: fresh, q: q, BANDS: BANDS };
  // the reader drew its page before this file came: framed again, with the picture box
  if (window.WQSTORIES && window.WQSTORIES._af) window.WQSTORIES._af();
})();
