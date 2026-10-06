/*
 * The video library on the web child quiz: SUBJECT tiles for the child's grade (a grade strip on
 * top), then the subject's CHAPTERS, in the WhatsApp Flow's own order (the bot sorts). Loaded by
 * the quiz page before wq.js; wq.js calls WQL.open() from "Watch another video".
 *
 *   WQL.open({code, st, lang, grade, subject, onPick, onBack, fallback, paint, on, ev, iab})
 *   WQL.prefetch({code, st})   in idle time: the subjects and the quiz's own subject's chapters
 *   WQL.dlHtml / WQL.wireDl    the Download button (video screen, chapter cards)
 *   WQL.off()                  true once the bot said the library is off (then wq.js keeps its list)
 *
 * Lists are kept in memory and in sessionStorage for 10 minutes, so the tap paints at once; a
 * painted list is refetched quietly. A tap on a lesson the class already has a code for goes
 * straight to /q/<code>; the first 2 such lessons are prefetched as documents.
 */
(function () {
  'use strict';
  var TTL = 10 * 60 * 1000;
  var mem = {};
  var OFF = false;
  var inflight = {};
  var seq = 0;            // every show() takes a number; only the newest may paint
  var docs = {};          // lesson pages already prefetched

  var SUBJ_UR = { English: 'انگریزی', Maths: 'ریاضی', Urdu: 'اردو', Science: 'سائنس', Geography: 'جغرافیہ', 'General Knowledge': 'معلوماتِ عامہ', History: 'تاریخ', 'Islamic Studies': 'اسلامیات' };
  var T = {
    en: {
      libT: 'Video library', pick: 'Pick a subject', vids: function (n) { return n === 1 ? '1 video' : n + ' videos'; },
      grade: function (g) { return g === 'NURSERY' ? 'Nursery' : g === 'KG' ? 'KG' : 'Grade ' + g; },
      subj: function (s) { return s; }, subjects: 'Subjects', back: 'Back', done: 'Done ✓', mins: function (n) { return n + ' min'; },
      dl: 'Download', dlHelp: 'Download not starting?', chrome: 'Open in Chrome', none: 'No videos here yet.',
      oops: 'The videos did not load.', retry: 'Try again', wait: 'Opening the library…',
    },
    ur: {
      libT: 'ویڈیو لائبریری', pick: 'ایک مضمون چنیں', vids: function (n) { return n + ' ویڈیوز'; },
      grade: function (g) { return g === 'NURSERY' ? 'نرسری' : g === 'KG' ? 'کے جی' : 'جماعت ' + g; },
      subj: function (s) { return SUBJ_UR[s] || s; }, subjects: 'مضامین', back: 'واپس', done: 'مکمل ✓', mins: function (n) { return n + ' منٹ'; },
      dl: 'ڈاؤن لوڈ', dlHelp: 'ڈاؤن لوڈ شروع نہیں ہوا؟', chrome: 'Chrome میں کھولیں', none: 'یہاں ابھی کوئی ویڈیو نہیں۔',
      oops: 'ویڈیوز نہیں کھلیں۔', retry: 'دوبارہ کوشش کریں', wait: 'لائبریری کھل رہی ہے…',
    },
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function now() { return Date.now(); }
  // A list carries one child's data (their grade, their Done ticks): its key names the child's session.
  function hash(x) {
    var h = 2166136261;
    for (var i = 0; i < String(x || '').length; i++) { h ^= String(x).charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(36);
  }
  var lastSt = null;
  function key(code, st, g, s) { return 'wql:' + code + ':' + hash(st) + ':' + (g || '') + ':' + (s || ''); }
  // The network the phone says it has: no prefetch on Data saver or 2G; on 3G the small lists only.
  function net() {
    var c = (typeof navigator !== 'undefined' && navigator.connection) || {};
    if (c.saveData || /2g$/.test(c.effectiveType || '')) return 'off';
    return c.effectiveType === '3g' ? 'lists' : 'all';
  }
  // Urdu runs: digits isolated left-to-right (counts, minutes, grade numbers).
  function nb(o, text) {
    var h = esc(text);
    return o.lang === 'ur' ? h.replace(/\d+/g, function (m) { return '<bdi dir="ltr">' + m + '</bdi>'; }) : h;
  }
  function attr(v) { return String(v).replace(/["\\]/g, '\\$&'); }
  function ss() { try { return window.sessionStorage || null; } catch (e) { return null; } }
  function cached(k) {
    var hit = mem[k];
    if (!hit) {
      try { var raw = ss() && ss().getItem(k); hit = raw ? JSON.parse(raw) : null; } catch (e) { hit = null; }
      if (hit) mem[k] = hit;
    }
    return hit && now() - hit.at < TTL ? hit.data : null;
  }
  function put(k, data) {
    var v = { at: now(), data: data };
    mem[k] = v;
    try { if (ss()) ss().setItem(k, JSON.stringify(v)); } catch (e) {}
  }
  function url(code, st, g, s) {
    var q = [];
    if (st) q.push('st=' + encodeURIComponent(st));
    if (g) q.push('g=' + encodeURIComponent(g));
    if (s) q.push('s=' + encodeURIComponent(s));
    return '/api/wq/lib/' + encodeURIComponent(code) + (q.length ? '?' + q.join('&') : '');
  }
  // Resolves with the data, or {off:true}; rejects on a network or server failure. One request per key at a time.
  function load(code, st, g, s) {
    var k = key(code, st, g, s);
    if (inflight[k]) return inflight[k];
    var p = fetch(url(code, st, g, s), { headers: { accept: 'application/json' } }).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
        if (r.status === 404 && j && j.error === 'library_off') { OFF = true; return { off: true }; }
        if (!r.ok || !j) throw new Error('lib_' + r.status);
        put(k, j);
        return j;
      });
    });
    inflight[k] = p;
    var clear = function () { delete inflight[k]; };
    p.then(clear, clear);
    return p;
  }
  function idle(fn) {
    if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 2500 });
    else setTimeout(fn, 1200);
  }

  /** In idle time: the subjects, then the quiz's own subject's chapters (what "Watch another video" opens). */
  function prefetch(o) {
    if (OFF || !o || !o.code || net() === 'off') return;
    idle(function () {
      var l1 = cached(key(o.code, o.st, '', ''));
      var p = l1 ? Promise.resolve(l1) : load(o.code, o.st, '', '');
      p.then(function (d) {
        if (d && !d.off && d.mine && !cached(key(o.code, o.st, '', d.mine))) return load(o.code, o.st, '', d.mine);
        return null;
      }).catch(function () {});
    });
  }

  /* ---------------- rendering ---------------- */

  function mb(v) { return v ? '<bdi dir="ltr">' + esc(v + ' MB') + '</bdi>' : ''; }
  function dlHref(o, vid) { return '/api/wq/videos/dl/' + encodeURIComponent(o.code) + '?st=' + encodeURIComponent(o.st || '') + '&vid=' + encodeURIComponent(vid); }
  function chromeHref(path) {
    var host = (location.host || '').replace(/[^A-Za-z0-9.:-]/g, '');
    return 'intent://' + host + path + '#Intent;scheme=https;package=com.android.chrome;end';
  }

  /** The Download button: the size when known; in WhatsApp's browser a way out to Chrome appears after the tap. */
  function dlHtml(o, v, big) {
    if (!o.st || !v || !v.vid) return '';
    var t = T[o.lang] || T.en;
    var size = v.mb ? ' (' + mb(v.mb) + ')' : '';
    return '<a class="' + (big ? 'wq-btn wq-soft wql-dlbig' : 'wql-dl') + '" data-dl="' + esc(v.vid) + '" href="' + esc(dlHref(o, v.vid)) + '" download><span>⬇ ' + esc(t.dl) + size + '</span></a>';
  }
  function helpHtml(o) {
    var t = T[o.lang] || T.en;
    return o.iab ? '<p class="wql-dlhelp" id="wql-dlhelp" hidden>' + esc(t.dlHelp) + ' <a id="wql-chrome" href="#">' + esc(t.chrome) + '</a></p>' : '';
  }
  function wireDl(o, vids) {
    vids.forEach(function (v) {
      o.on('[data-dl="' + v.vid + '"]', function () {
        if (o.ev) o.ev('video_download', { vid: v.vid });
        if (!o.iab) return;
        var help = document.getElementById ? document.getElementById('wql-dlhelp') : null;
        var a = document.getElementById ? document.getElementById('wql-chrome') : null;
        if (a) a.setAttribute('href', chromeHref(dlHref(o, v.vid)));
        if (help) help.hidden = false;
      });
    });
  }

  function subjectsHtml(o, d) {
    var t = T[o.lang] || T.en;
    var grades = (d.grades || []).map(function (x) {
      var on = x.g === d.grade;
      return '<button class="wql-g' + (on ? ' wql-on' : '') + '" data-g="' + esc(x.g) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        (x.art ? '<img src="' + esc(x.art) + '" alt="" width="36" height="36">' : '') + '<span>' + nb(o, t.grade(x.g)) + '</span></button>';
    }).join('');
    var tiles = (d.subjects || []).map(function (x) {
      return '<button class="wql-sub" data-s="' + esc(x.key) + '">' +
        (x.art ? '<img src="' + esc(x.art) + '" alt="" width="160" height="120">' : '<span class="wql-noart" aria-hidden="true">▶</span>') +
        '<b>' + esc(t.subj(x.key)) + '</b><small>' + nb(o, t.vids(x.n)) + '</small></button>';
    }).join('');
    return '<h2>' + esc(t.libT) + '</h2>' +
      '<div class="wql-grades" role="group">' + grades + '</div>' +
      (tiles ? '<p class="wq-sub">' + esc(t.pick) + '</p><div class="wql-subs">' + tiles + '</div>' : '<p class="wq-sub">' + esc(t.none) + '</p>') +
      '<button class="wq-btn wq-ghost" id="wql-back">' + esc(t.back) + '</button>';
  }

  function cardHtml(o, d, v, art, row) {
    var t = T[o.lang] || T.en;
    var meta = [v.secs ? nb(o, t.mins(Math.max(1, Math.round(v.secs / 60)))) : '', mb(v.mb)].filter(Boolean).join(' · ');
    var w = row ? 120 : 160, h = row ? 68 : 90;
    return '<div class="wql-card' + (row ? ' wql-row' : '') + '"><button class="wql-pick" data-v="' + esc(v.vid) + '">' +
      '<span class="wql-thumb"' + (art ? ' style="background-image:url(' + esc(art) + ')"' : '') + '>' +
      (v.poster ? '<img src="' + esc(v.poster) + '" alt="" loading="lazy" width="' + w + '" height="' + h + '" onerror="this.style.display=\'none\'">' : '') +
      (v.done ? '<span class="wql-done">' + esc(t.done) + '</span>' : '') + '</span>' +
      '<span class="wql-txt"><b dir="auto">' + esc(v.title) + '</b>' + (meta ? '<small>' + meta + '</small>' : '') + '</span></button>' +
      // The size is on the line above: the card's link stays short enough for a 168px card.
      dlHtml(o, { vid: v.vid }, false) + '</div>';
  }

  function chaptersHtml(o, d) {
    var t = T[o.lang] || T.en;
    var art = d.art || null;
    var body = (d.chapters || []).map(function (c) {
      var vids = c.videos || [];
      var one = vids.length === 1;
      var title = c.name && (!one || c.name.toLowerCase() !== String(vids[0].title || '').toLowerCase()) ? '<h3 class="wql-ch" dir="auto">' + esc(c.name) + '</h3>' : '';
      return '<section class="wql-chap">' + title + '<div class="' + (one ? 'wql-one' : 'wql-strip') + '">' +
        vids.map(function (v) { return cardHtml(o, d, v, art, one); }).join('') + '</div></section>';
    }).join('');
    return '<div class="wql-head"><button class="wql-up" id="wql-up">' + esc(t.subjects) + '</button><h2>' + esc(t.subj(d.subject)) + ' · ' + nb(o, t.grade(d.grade)) + '</h2></div>' +
      (body || '<p class="wq-sub">' + esc(t.none) + '</p>') + helpHtml(o) +
      '<button class="wq-btn wq-ghost" id="wql-back">' + esc(t.back) + '</button>';
  }

  function allVideos(d) {
    var out = [];
    (d.chapters || []).forEach(function (c) { (c.videos || []).forEach(function (v) { out.push(v); }); });
    return out;
  }

  function prefetchDocs(vids) {
    if (!document.head || !document.createElement || net() !== 'all') return;
    vids.filter(function (v) { return v.code; }).slice(0, 2).forEach(function (v) {
      if (docs[v.code]) return;
      docs[v.code] = 1;
      try {
        var l = document.createElement('link');
        l.rel = 'prefetch';
        l.href = '/q/' + encodeURIComponent(v.code);
        document.head.appendChild(l);
      } catch (e) {}
    });
  }

  /* ---------------- the screens ---------------- */

  var cur = null;   // the open library: { o, g, s }

  function waitHtml(o) {
    var t = T[o.lang] || T.en;
    return '<div class="wq-boot"><img src="/wq/jugnu/thinking.webp" alt="" width="96" height="96"><p class="wq-sub">' + esc(t.wait) + '</p></div>';
  }
  // Leaving the library: nothing still on its way may paint afterwards.
  function leave(o) { seq++; cur = null; o.onBack(); }
  function failed(o, again) {
    var t = T[o.lang] || T.en;
    o.paint('<p class="wq-sub wq-center">' + esc(t.oops) + '</p><button class="wq-btn wq-go" id="wql-retry">' + esc(t.retry) + '</button>' +
      '<button class="wq-btn wq-ghost" id="wql-back">' + esc(t.back) + '</button>', 'M15-error');
    o.on('#wql-retry', again);
    o.on('#wql-back', function () { leave(o); });
    if (o.ev) o.ev('error', { err: 'lib_net' });
  }
  // Paint from the cache when it has the list (0 round trips), else wait for the bot; refetch quietly after.
  function show(o, g, s, draw) {
    var my = ++seq;
    var k = key(o.code, o.st, g, s);
    var hit = cached(k);
    if (hit) {
      draw(hit, 'mem');
      load(o.code, o.st, g, s).catch(function () {});
      return;
    }
    o.paint(waitHtml(o), 'M15-wait');
    load(o.code, o.st, g, s).then(function (d) {
      if (my !== seq) return;               // the child has moved on (Back, another grade)
      if (d.off) return o.fallback();
      draw(d, 'net');
    }, function () { if (my === seq) failed(o, function () { show(o, g, s, draw); }); });
  }

  function subjects(o, g) {
    cur = { o: o, g: g || '', s: '' };
    show(o, g || '', '', function (d) {
      if (!o.grade0) o.grade0 = d.grade;
      o.paint(subjectsHtml(o, d), 'M15');
      if (o.ev) o.ev('lib_view', { g: d.grade || undefined, n: (d.subjects || []).length });
      (d.grades || []).forEach(function (x) { o.on('[data-g="' + attr(x.g) + '"]', function () { subjects(o, x.g === o.grade0 ? '' : x.g); }); });
      (d.subjects || []).forEach(function (x) { o.on('[data-s="' + attr(x.key) + '"]', function () { chapters(o, cur.g, x.key); }); });
      o.on('#wql-back', function () { leave(o); });
      // The child's own grade may sit past the screen's edge in the strip: bring it into view.
      try {
        var on = document.querySelector && document.querySelector('.wql-g.wql-on');
        if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
      } catch (e) {}
    });
  }

  function chapters(o, g, s) {
    cur = { o: o, g: g || '', s: s };
    show(o, g || '', s, function (d, src) {
      o.paint(chaptersHtml(o, d), 'M15-ch');
      if (cur) cur.shown = true;
      var vids = allVideos(d);
      if (o.t0) {
        if (o.ev) o.ev('more_timing', { list_ms: now() - o.t0, src: src });
        o.t0 = 0;
      }
      if (o.ev) o.ev('lib_view', { g: d.grade || undefined, s: d.subject, n: vids.length });
      var i = 0;
      (d.chapters || []).forEach(function (c, ci) {
        (c.videos || []).forEach(function (v) {
          var at = i++;
          o.on('[data-v="' + attr(v.vid) + '"]', function () {
            if (o.ev) o.ev('lib_pick', { vid: v.vid, ch_i: ci });
            o.onPick({ vid: v.vid, title: v.title, code: v.code || null, done: Boolean(v.done) }, at);
          });
        });
      });
      wireDl(o, vids);
      o.on('#wql-up', function () { subjects(o, cur ? cur.g : ''); });
      o.on('#wql-back', function () { leave(o); });
      prefetchDocs(vids);
    });
  }

  /** Opens the library: the quiz's own subject's chapters when known (Back -> its subjects), else the subjects. */
  function open(o) {
    o.lang = o.lang === 'ur' ? 'ur' : 'en';
    o.t0 = now();
    // Another child in this tab: the last child's lists are not theirs.
    if (lastSt !== null && lastSt !== o.st) mem = {};
    lastSt = o.st;
    var l1 = cached(key(o.code, o.st, '', ''));
    var s = o.subject || (l1 && l1.mine) || '';
    if (l1) o.grade0 = l1.grade;
    if (s) return chapters(o, '', s);
    if (l1) return subjects(o, '');
    // Nothing cached: ask for the subjects, then go straight on to the quiz's own subject.
    o.paint(waitHtml(o), 'M15-wait');
    cur = { o: o, g: '', s: '' };
    var my = ++seq;
    load(o.code, o.st, '', '').then(function (d) {
      if (my !== seq) return;
      if (d.off) return o.fallback();
      o.grade0 = d.grade;
      if (d.mine) chapters(o, '', d.mine); else subjects(o, '');
    }, function () { if (my === seq) failed(o, function () { open(o); }); });
  }

  /** Back from the chapters goes to the subjects; from the subjects, out of the library. */
  function up() {
    if (cur && cur.s && cur.shown) return subjects(cur.o, cur.g);
    if (cur) return leave(cur.o);
    return null;
  }

  window.WQL = {
    open: open, prefetch: prefetch, up: up, dlHtml: dlHtml, helpHtml: helpHtml, wireDl: wireDl,
    off: function () { return OFF; }, active: function () { return Boolean(cur); }, T: T,
    _reset: function () { mem = {}; OFF = false; inflight = {}; cur = null; seq = 0; docs = {}; lastSt = null; },
  };
})();
