/* The v3 child home (/h/<token>, app_settings web_quiz_home_v3; loaded by hub.js only when the bot's hub JSON carries
 * `home_v3`): ONE big thing to do now, three doors at the thumb (Stories, Games, Videos), the day-dots and the sticker
 * jar in the header, and the grown-ups corner behind a 2-second hold. The page decides nothing: the Next tile is the
 * server's `next` (web_quiz_next_offer) when it came, else the hub's own lantern / teacher card in today's order; the
 * doors are the server's `doors`. Copy lives in COPY below (one object, EN + UR): a door rename is one line.
 *   WQHOME.mount(root, B, ctx)  draw the home (or a door, from location.hash) and wire it; ctx {token, lang, ev, go}
 *   WQHOME.html(B, ctx)         the home's markup (pure, for tests)     WQHOME.door(B, ctx, name)  a door's markup
 *   WQHOME.nextOf(B, ctx)       the one Next thing {kind, title, sub, href, art, minutes, src} (pure) */
(function () {
  'use strict';
  var COPY = {
    en: {
      hi: function (n) { return n ? 'Hi ' + n + '!' : 'Hi!'; },
      stories: 'Stories', games: 'Games', videos: 'Videos',
      storiesSay: 'Stories you read with Jugnu', gamesSay: 'Games with numbers and sounds', videosSay: 'Videos your teacher chose',
      soon: 'Coming soon', home: 'Home',
      nextQuiz: 'Your teacher\'s quiz', nextCont: 'Finish your quiz', nextStory: 'Read a story with Jugnu', nextListen: 'Listen to a story',
      nextGame: 'Play a game with Jugnu', nextNumbers: 'Play the numbers game', nextVideo: 'Watch a video', nextAgain: 'Play again',
      nextNone: 'Ask your teacher for a quiz link',
      weekStory: 'This week\'s story', listen: 'Listen to a story', shelf: 'Storybooks', numbers: 'Numbers with Jugnu',
      fromTeacher: 'From your teacher', again: 'Play again', newTag: 'New', openVideos: 'Open the videos',
      mins: function (m) { return m + ' min'; },
      jar: 'My stickers', jarNew: 'A new sticker', sndOn: 'Sound on', sndOff: 'Sound off',
      sep: ', ', grown: 'Grown-ups', grownHold: 'Press and hold', grownLang: 'اردو', grownClose: 'Close', week: 'Days you played this week',
    },
    ur: {
      hi: function (n) { return n ? '⁨' + n + '⁩، السلام علیکم!' : 'السلام علیکم!'; },
      stories: 'کہانیاں', games: 'کھیل', videos: 'ویڈیوز',
      storiesSay: 'جگنو کے ساتھ کہانیاں پڑھیں اور سنیں', gamesSay: 'گنتی اور آوازوں کے کھیل', videosSay: 'استاد کی چنی ہوئی ویڈیوز',
      soon: 'جلد آ رہا ہے', home: 'ہوم',
      nextQuiz: 'استاد کا کوئز', nextCont: 'اپنا کوئز مکمل کریں', nextStory: 'جگنو کے ساتھ کہانی پڑھیں', nextListen: 'کہانی سنیں',
      nextGame: 'جگنو کے ساتھ کھیلیں', nextNumbers: 'گنتی کا کھیل کھیلیں', nextVideo: 'ویڈیو دیکھیں', nextAgain: 'دوبارہ کھیلیں',
      nextNone: 'استاد سے کوئز کا لنک لیں',
      weekStory: 'اس ہفتے کی کہانی', listen: 'کہانی سنیں', shelf: 'کہانیوں کی کتابیں', numbers: 'جگنو کے ساتھ گنتی',
      fromTeacher: 'استاد کی طرف سے', again: 'دوبارہ کھیلیں', newTag: 'نئی', openVideos: 'ویڈیوز کھولیں',
      mins: function (m) { return urDigits(m) + ' منٹ'; },
      jar: 'میرے اسٹیکرز', jarNew: 'نیا اسٹیکر', sndOn: 'آواز چالو', sndOff: 'آواز بند',
      sep: '، ', grown: 'بڑوں کے لیے', grownHold: 'دبائے رکھیں', grownLang: 'English', grownClose: 'بند کریں', week: 'اس ہفتے آپ نے کب کب کھیلا',
    },
  };
  // The door icons (inline, one colour, currentColor): a book, a die, a play button.
  var ICON = {
    stories: '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path fill="currentColor" d="M3 5c3-1.3 6-1.3 9 .5 3-1.8 6-1.8 9-.5v14c-3-1.3-6-1.3-9 .5-3-1.8-6-1.8-9-.5zM12 7v11"/><path d="M12 6v13" stroke="#fff" stroke-width="1.4"/></svg>',
    games: '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor"/><g fill="#fff"><circle cx="8" cy="8" r="1.7"/><circle cx="16" cy="16" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="16" cy="8" r="1.7"/><circle cx="8" cy="16" r="1.7"/></g></svg>',
    videos: '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="4" fill="currentColor"/><path d="M10 8.5v7l6-3.5z" fill="#fff"/></svg>',
    home: '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M12 3l9 8h-3v9h-4v-6h-4v6H6v-9H3z"/></svg>',
    jar: '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path fill="currentColor" d="M7 2h10v3H7zM6 6h12a2 2 0 0 1 2 2v11a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a2 2 0 0 1 2-2z"/><path fill="#fff" d="M12 9.5l1.4 2.9 3.1.4-2.3 2.2.6 3.1-2.8-1.5-2.8 1.5.6-3.1-2.3-2.2 3.1-.4z"/></svg>',
  };
  var DOORS = ['stories', 'games', 'videos'];

  function urDigits(n) { return String(n).replace(/[0-9]/g, function (d) { return String.fromCharCode(0x06F0 + Number(d)); }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function langOf(ctx) { return ctx && ctx.lang === 'ur' ? 'ur' : 'en'; }
  function C(ctx) { return COPY[langOf(ctx)]; }
  function withLang(h, l) { return typeof window !== 'undefined' && window.WQT && window.WQT.withLang ? window.WQT.withLang(h, l) : h; }
  function withHome(B, h) { return B.nav_home ? h + (h.indexOf('?') >= 0 ? '&' : '?') + 'home=1' : h; }
  function quizHref(code, k, again) { return '/q/' + encodeURIComponent(code) + '?' + (again ? 'again=1&' : '') + 'k=' + encodeURIComponent(k || ''); }
  function chHref(B, ctx) { return withHome(B, withLang('/c/' + encodeURIComponent(ctx.token || B.token || '') + '?kid=' + encodeURIComponent(B.kid || ''), langOf(ctx))); }
  function doorsOf(B) { var d = B.doors || {}; return { stories: d.stories || [], games: d.games || [], videos: d.videos || null }; }

  /* ---------------- the one Next thing ---------------- */
  function nextOf(B, ctx) {
    var t = C(ctx); var l = langOf(ctx); var n = B.next;
    if (n && n.href) {
      return { kind: n.kind, title: (l === 'ur' && n.title_ur) || n.title || t.nextStory, sub: (l === 'ur' && n.sub_ur) || n.sub || '', href: n.href, art: n.art || null, minutes: n.minutes || null, src: 'next' };
    }
    // No `next` from the server (web_quiz_next_offer off): today's order — the teacher's quiz, the quiz left open, the lantern.
    if (B.teacher && B.teacher.code) return { kind: 'quiz', title: t.nextQuiz, sub: B.teacher.topic || '', href: quizHref(B.teacher.code, B.teacher.k), src: 'teacher' };
    if (B.last && B.last.code && B.last.state === 'open') return { kind: 'quiz', title: t.nextCont, sub: B.last.topic || '', href: quizHref(B.last.code, B.last.k), src: 'last' };
    var x = B.play && B.play.lantern;
    if (x && B.challenge && B.challenge.on) {
      if (x.kind === 'trail') return { kind: 'game', title: t.nextGame, sub: '', href: chHref(B, ctx), src: 'lantern' };
      if (x.kind === 'story' && x.title) return { kind: 'story', title: t.nextStory, sub: x.title, href: chHref(B, ctx) + (x.pid ? '&room=story&pid=' + encodeURIComponent(x.pid) : ''), src: 'lantern' };
      if (x.kind === 'numbers') return { kind: 'game', title: t.nextNumbers, sub: '', href: chHref(B, ctx), src: 'lantern' };
    }
    var d = doorsOf(B);
    var s = d.stories.filter(function (r) { return r.kind === 'passage' || r.kind === 'listen'; })[0];
    if (s) return { kind: 'story', title: s.kind === 'listen' ? t.nextListen : t.nextStory, sub: s.title || '', href: storyHref(B, ctx, s), src: 'door' };
    if (d.videos) return { kind: 'video', title: t.nextVideo, sub: '', href: withHome(B, d.videos.href), src: 'door' };
    var g = d.games[0];
    if (g) return g.kind === 'numbers' ? { kind: 'game', title: t.nextNumbers, sub: '', href: chHref(B, ctx), src: 'door' }
      : { kind: 'quiz', title: g.done ? t.nextAgain : t.nextQuiz, sub: g.topic || '', href: quizHref(g.code, g.k, g.done), src: 'door' };
    return { kind: 'none', title: t.nextNone, sub: '', href: null, src: 'none' };
  }
  // A listening story asks the story room for a listen (wq-trail.js reads &ex=listen), else it is served as a read.
  function storyHref(B, ctx, s) { return chHref(B, ctx) + '&room=story&pid=' + encodeURIComponent(s.id) + (s.kind === 'listen' ? '&ex=listen' : ''); }
  var POSE = { story: 'hello', game: 'correct', quiz: 'thinking', video: 'idle', none: 'sleep' };

  /* ---------------- markup ---------------- */
  function dotsHtml(B, t) {
    var h = B.head || {}; var n = Math.max(0, Math.min(7, Number(h.dots) || 0)); var out = '';
    for (var i = 0; i < 7; i++) out += '<i class="wq-dot' + (i < n ? ' on' : '') + (i === n && !h.today ? ' ring' : '') + '"></i>';
    return '<span class="wq-dots" role="img" aria-label="' + esc(t.week) + '">' + out + '</span>';
  }
  function headHtml(B, ctx) {
    var t = C(ctx); var me = (B.kids || []).filter(function (k) { return k.chip === B.kid; })[0] || {};
    var jar = B.head && B.head.jar ? '<a class="wq-jar" href="#book" data-tap="jar" aria-label="' + esc(t.jar) + '">' + ICON.jar + (B.head.jar.fresh ? '<b class="wq-jarnew" aria-label="' + esc(t.jarNew) + '"></b>' : '') + '</a>' : '';
    return '<header class="wq-hhead"><img class="wq-hjug" data-tap="jugnu" src="/wq/jugnu/hello.webp" alt="" width="44" height="44">' +
      '<span class="wq-hhi">' + esc(t.hi(me.first || '')) + dotsHtml(B, t) + '</span>' + jar +
      '<button class="wq-snd" type="button" data-tap="sound" aria-pressed="' + (muted() ? 'false' : 'true') + '" aria-label="' + esc(muted() ? t.sndOff : t.sndOn) + '">' + (muted() ? '🔇' : '🔊') + '</button></header>';
  }
  function nextHtml(nx, ctx) {
    var t = C(ctx);
    var art = nx.art ? '<img class="wq-nart" src="' + esc(nx.art) + '" alt="" width="96" height="96">' : '<img class="wq-nart" src="/wq/jugnu/' + (POSE[nx.kind] || 'hello') + '.webp" alt="" width="96" height="96">';
    var meta = [nx.sub ? '<bdi>' + esc(nx.sub) + '</bdi>' : '', nx.minutes ? esc(t.mins(nx.minutes)) : ''].filter(Boolean).join(langOf(ctx) === 'ur' ? '، ' : ' · ');
    var inner = art + '<span class="wq-ntext"><b>' + esc(nx.title) + '</b>' + (meta ? '<small>' + meta + '</small>' : '') + '</span>' + (nx.href ? '<span class="wq-ngo" aria-hidden="true">▶</span>' : '');
    return nx.href
      ? '<a class="wq-next" data-primary data-tap="next" data-kind="' + esc(nx.kind) + '" data-src="' + esc(nx.src) + '" href="' + esc(nx.href) + '">' + inner + '</a>'
      : '<div class="wq-next wq-nnone" data-primary data-kind="none">' + inner + '</div>';
  }
  function barHtml(ctx, at) {
    var t = C(ctx);
    return '<nav class="wq-doors" aria-label="' + esc([t.stories, t.games, t.videos].join(t.sep)) + '">' + DOORS.map(function (d) {
      return '<a class="wq-door' + (at === d ? ' at' : '') + '" data-door="' + d + '" data-tap="door" href="#' + d + '">' + ICON[d] + '<span>' + esc(t[d]) + '</span></a>';
    }).join('') + '</nav>';
  }
  function grownHtml(ctx) {
    var t = C(ctx);
    return '<footer class="wq-grown"><button class="wq-gbtn" type="button" data-tap="grownups" aria-label="' + esc(t.grown + ' — ' + t.grownHold) + '"><i class="wq-gfill"></i>' + esc(t.grown) + '</button></footer>';
  }
  function html(B, ctx) {
    return '<section class="wq-screen wq-home" data-screen="home" data-m="H3">' + headHtml(B, ctx) + nextHtml(nextOf(B, ctx), ctx) + grownHtml(ctx) + '</section>' + barHtml(ctx, null);
  }
  function rowHtml(href, title, sub, tag, kind) {
    return '<li><a class="wq-row" data-tap="row" data-kind="' + esc(kind) + '" href="' + esc(href) + '"><b><bdi>' + esc(title) + '</bdi></b>' + (sub ? '<small><bdi>' + esc(sub) + '</bdi></small>' : '') + (tag ? '<i class="wq-new">' + esc(tag) + '</i>' : '') + '</a></li>';
  }
  function door(B, ctx, name) {
    var t = C(ctx); var d = doorsOf(B); var rows = '';
    if (name === 'stories') {
      rows = d.stories.map(function (s) {
        if (s.kind === 'shelf') return '<li class="wq-shelf" data-shelf="1"></li>';
        return rowHtml(storyHref(B, ctx, s), s.title || (s.kind === 'listen' ? t.listen : t.weekStory), s.title ? (s.kind === 'listen' ? t.listen : t.weekStory) : '', s.fresh ? t.newTag : '', s.kind);
      }).join('');
    } else if (name === 'games') {
      rows = d.games.map(function (g) {
        if (g.kind === 'numbers') return rowHtml(chHref(B, ctx), t.numbers, '', '', 'numbers');
        return rowHtml(quizHref(g.code, g.k, g.done), g.topic || t.nextQuiz, g.done ? t.again : t.fromTeacher, '', g.done ? 'again' : 'quiz');
      }).join('');
    } else if (name === 'videos' && d.videos) {
      rows = rowHtml(withHome(B, d.videos.href), t.openVideos, '', '', 'videos');
    }
    // Exactly one primary per screen: the door's first row, else (an empty door) the Home button.
    if (rows) rows = rows.replace('<a class="wq-row"', '<a class="wq-row" data-primary');
    var body = rows ? '<ul class="wq-rows">' + rows + '</ul>' : '<p class="wq-soon" data-soon="' + name + '">' + esc(t.soon) + '</p>';
    return '<section class="wq-screen wq-home wq-droom" data-screen="' + name + '" data-m="H3-' + name + '">' +
      '<div class="wq-dtop"><a class="wq-homebtn" href="#"' + (rows ? '' : ' data-primary') + ' data-home data-tap="home" aria-label="' + esc(t.home) + '">' + ICON.home + '</a><h2 dir="auto">' + esc(t[name]) + '</h2></div>' +
      '<p class="wq-dsay">' + esc(t[name + 'Say']) + '</p>' + body + '</section>' + barHtml(ctx, name);
  }

  /* ---------------- sound toggle: ONE switch for the child, two keys on the phone ----------------
   * JUICE's `wq_snd` ('1'/'0') and the quiz page's `wq_sound` (JSON true/false, it also silences the voice):
   * off if either says off; a toggle writes both (WQJ.muted/WQJ.mute when the sound kit is loaded). */
  function muted() {
    try { if (window.WQJ && typeof window.WQJ.muted === 'function') return Boolean(window.WQJ.muted()); } catch (e) {}
    try { return localStorage.getItem('wq_snd') === '0' || localStorage.getItem('wq_sound') === 'false'; } catch (e) { return false; }
  }
  function setMuted(m) {
    try { if (window.WQJ && typeof window.WQJ.mute === 'function') return window.WQJ.mute(m); } catch (e) {}
    try { localStorage.setItem('wq_snd', m ? '0' : '1'); localStorage.setItem('wq_sound', m ? 'false' : 'true'); } catch (e) {}
  }
  function juice(fn) { try { if (window.WQJ && typeof window.WQJ[fn] === 'function') window.WQJ[fn](); } catch (e) {} }

  /* ---------------- mount ---------------- */
  var wired = false;
  function mount(root, B, ctx) {
    var name = String((typeof location !== 'undefined' && location.hash) || '').replace(/^#/, '');
    hashOnce(root, B, ctx);
    // The door screens (wq-doors.js, fetched after the home paints): theirs once loaded; until then the rows below.
    if (window.WQDOORS && window.WQDOORS.owns(name)) return window.WQDOORS.mount(root, B, ctx, name);
    var html0 = DOORS.indexOf(name) >= 0 ? door(B, ctx, name) : html(B, ctx);
    root.innerHTML = html0;
    root.setAttribute('data-m', DOORS.indexOf(name) >= 0 ? 'H3-' + name : 'H3');
    var ev = ctx.ev || function () {};
    var nxEl = root.querySelector('.wq-next[data-src]');
    if (nxEl) ev('next_shown', { ctx: 'home', kind: nxEl.getAttribute('data-kind'), pos: 0, source: nxEl.getAttribute('data-src') === 'next' ? 'ranked' : 'fallback' });
    else if (DOORS.indexOf(name) < 0) ev('home_view', { src: 'home' });
    each(root, '[data-tap]', function (el) {
      el.addEventListener('click', function (e) {
        var tap = el.getAttribute('data-tap');
        juice('tap');
        if (tap === 'next') { e.preventDefault(); ev('next_tap', { pos: 0, kind: el.getAttribute('data-kind') }); go(ctx, el.getAttribute('href'), 'next'); }
        else if (tap === 'door') { ev('door_tap', { door: el.getAttribute('data-door'), pos: DOORS.indexOf(el.getAttribute('data-door')) + 1 }); }
        else if (tap === 'row') { e.preventDefault(); go(ctx, el.getAttribute('href'), 'door_' + el.getAttribute('data-kind')); }
        else if (tap === 'sound') { setMuted(!muted()); mount(root, B, ctx); }
        else if (tap === 'jar') { e.preventDefault(); book(root, B, ctx); }
        // Tap Jugnu, hear the giggle (the sound kit's sprite; nothing without it).
        else if (tap === 'jugnu') { try { if (window.WQJ) { if (window.WQJ.giggle) window.WQJ.giggle(); if (window.WQJ.pop) window.WQJ.pop(el); } } catch (x) {} }
      });
    });
    var g = root.querySelector('[data-tap="grownups"]');
    if (g) hold(g, function () { grownups(root, B, ctx); });
    // The stories reader (wq-stories.js, web_quiz_stories: the boot's `stories.on`) fills [data-shelf] and owns #story/<id>.
    var sh = root.querySelector('[data-shelf]');
    if (sh && window.WQSTORIES && typeof window.WQSTORIES.shelf === 'function') { try { window.WQSTORIES.shelf(sh, { token: ctx.token, kid: B.kid, lang: langOf(ctx), ev: ev }); } catch (e) {} }
    else if (B.stories && B.stories.on && !window.WQSTORIES && (sh || /^story\//.test(name))) loadOnce('wq-stories');
    if (!window.WQDOORS) loadOnce('wq-doors', function () { var n = String(location.hash || '').replace(/^#/, ''); if (window.WQDOORS && window.WQDOORS.owns(n)) mount(root, B, ctx); });
    try { window.scrollTo(0, 0); } catch (e) {}
  }
  function hashOnce(root, B, ctx) {
    if (wired) return;
    wired = true;
    try { window.addEventListener('hashchange', function () { if (/^#(stories|games|videos|watch\/[0-9a-f-]{36})?$/i.test(location.hash || '')) mount(root, B, ctx); }); } catch (e) {}
  }
  function go(ctx, href, what) { if (!href) return; if (ctx.go) ctx.go(href, what); else location.assign(href); }
  function each(root, sel, fn) { Array.prototype.forEach.call(root.querySelectorAll(sel), fn); }
  // The grown-ups corner opens only on a ~2 s press-and-hold (IA §2; never a tap, never arithmetic).
  function hold(el, done) {
    var timer = null;
    var start = function (e) { if (e && e.preventDefault) e.preventDefault(); el.classList.add('held'); timer = setTimeout(function () { timer = null; el.classList.remove('held'); done(); }, 2000); };
    var stop = function () { if (timer) { clearTimeout(timer); timer = null; } el.classList.remove('held'); };
    ['pointerdown', 'touchstart'].forEach(function (n) { el.addEventListener(n, start); });
    ['pointerup', 'pointerleave', 'pointercancel', 'touchend', 'touchcancel'].forEach(function (n) { el.addEventListener(n, stop); });
  }
  // Behind the hold: the language and, when the server names them, the teacher switch and the phone link's STOP.
  function grownups(root, B, ctx) {
    var t = C(ctx); var other = langOf(ctx) === 'ur' ? 'en' : 'ur';
    var g = B.grownups || {};
    var box = document.createElement('div');
    box.className = 'wq-gsheet'; box.setAttribute('role', 'dialog'); box.setAttribute('data-screen', 'grownups');
    box.innerHTML = '<b>' + esc(t.grown) + '</b>' +
      '<a class="wq-btn" data-primary data-tap="lang" href="' + esc(withLang('/h/' + encodeURIComponent(ctx.token || '') + '?kid=' + encodeURIComponent(B.kid || ''), other)) + '">' + esc(t.grownLang) + '</a>' +
      (g.teacher_href ? '<a class="wq-btn wq-ghost" data-tap="teacher" href="' + esc(g.teacher_href) + '">' + esc(g.teacher_label || '') + '</a>' : '') +
      (g.stop_href ? '<a class="wq-btn wq-ghost" data-tap="stop" href="' + esc(g.stop_href) + '">' + esc(g.stop_label || '') + '</a>' : '') +
      '<button class="wq-btn wq-ghost" type="button" data-tap="close">' + esc(t.grownClose) + '</button>';
    root.appendChild(box);
    var c = box.querySelector('[data-tap="close"]');
    if (c) c.addEventListener('click', function () { if (box.parentNode) box.parentNode.removeChild(box); });
  }
  // The jar opens Jugnu's Book (wq-book.js); Back returns to the home.
  function book(root, B, ctx) {
    var open = function () { if (window.WQBOOK) window.WQBOOK.open({ root: root, token: ctx.token, kid: B.kid, lang: langOf(ctx), ev: ctx.ev, back: function () { mount(root, B, ctx); } }); };
    if (window.WQBOOK) return open();
    loadOnce('wq-book', open, 'wq-bk-js');
  }
  // /wq/<name>.css + .js at hub.js's own ?v=, at most once per page.
  var asked = {};
  function loadOnce(name, onload, id) {
    if (asked[name]) return;
    asked[name] = true;
    try {
      var me = document.querySelector('script[src*="/wq/hub.js"]');
      var v = me && /[?&]v=([A-Za-z0-9]+)/.exec(me.getAttribute('src') || '');
      var q = v ? '?v=' + v[1] : '';
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/wq/' + name + '.css' + q; document.head.appendChild(l);
      var s = document.createElement('script'); if (id) s.id = id; s.src = '/wq/' + name + '.js' + q; if (onload) s.addEventListener('load', onload); document.head.appendChild(s);
    } catch (e) {}
  }

  window.WQHOME = { mount: mount, html: html, door: door, nextOf: nextOf, COPY: COPY, DOORS: DOORS, bar: barHtml, loadOnce: loadOnce };
})();
