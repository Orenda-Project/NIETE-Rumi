/* The v3 child home's three door screens (app_settings web_quiz_home_v3; loaded by wq-home.js after the home paints, so a
 * door tap is already warm and the home's own first load never carries it): Stories, Games, Videos, and the video player
 * for a child with no class (#watch/<lesson id>). The home owns the shell (header, Next tile, bottom bar, the grown-ups
 * corner); this file draws what is behind each door. Every screen: Home top-left, exactly one data-primary, a speaker
 * on every row, the bottom bar. Nothing here counts anything about the child.
 *   WQDOORS.owns(name)                 true for 'stories' | 'games' | 'videos' | 'watch/<id>'
 *   WQDOORS.html(B, ctx, name, data)   a door's markup (pure, for tests); data = the fetched rows, else the boot's
 *   WQDOORS.mount(root, B, ctx, name)  draw it, wire it, fetch the full rows and redraw
 *   WQDOORS.watchHtml(w, ctx, next)    the watch screen's markup (pure)
 * Data: the boot's `doors` (instant), then GET /api/wq/doors/h/<token>?d=stories|games (every story that opens,
 * shuffled per child per day, with `pos`; the number games), and for Videos the library's own /api/wq/lib/h/<token>.
 * A video: POST /api/wq/videos/start {hub, kid, vid} -> {code, k} (a class: /q/<code>, video then quiz) or {watch}
 * (no class: played here, the quiz offered after as the Next tile when the server says `after`). */
(function () {
  'use strict';
  var COPY = {
    en: {
      weekStory: 'This week\'s story', toRead: 'Stories to read', toListen: 'Stories to listen to', books: 'Storybooks',
      listen: 'Listen to a story', story: 'A story with Jugnu', newTag: 'New', doneTag: 'Done',
      numbers: 'Number games', fromTeacher: 'From your teacher', again: 'Play again', quiz: 'Your teacher\'s quiz',
      warm: 'Number warm-up', missing: 'Missing number', bigger: 'Which is bigger?', g1: 'Numbers with Jugnu',
      pick: 'Pick a subject', back: 'Back', opening: 'Opening the video…', none: 'No videos here yet.',
      oops: 'This did not load.', retry: 'Try again', watchNext: 'Watch next', quizAfter: 'Play the quiz',
      moreVideos: 'More videos', play: 'Play the video', say: 'Listen',
      storiesNone: 'New stories are on the way. Play a game!', gamesNone: 'Read a story with Jugnu!', toGames: 'Play a game', toStories: 'Read a story',
      mins: function (m) { return m + ' min'; },
      subj: function (s) { return s; },
    },
    ur: {
      weekStory: 'اس ہفتے کی کہانی', toRead: 'پڑھنے کی کہانیاں', toListen: 'سننے کی کہانیاں', books: 'کہانیوں کی کتابیں',
      listen: 'کہانی سنیں', story: 'جگنو کے ساتھ کہانی', newTag: 'نئی', doneTag: 'مکمل',
      numbers: 'گنتی کے کھیل', fromTeacher: 'ٹیچر کی طرف سے', again: 'دوبارہ کھیلیں', quiz: 'استاد کا کوئز',
      warm: 'گنتی کا کھیل', missing: 'کون سا عدد غائب ہے؟', bigger: 'کون سا عدد بڑا ہے؟', g1: 'جگنو کے ساتھ گنتی',
      pick: 'ایک مضمون چنیں', back: 'واپس', opening: 'ویڈیو کھل رہی ہے…', none: 'یہاں ابھی کوئی ویڈیو نہیں۔',
      oops: 'اوہو! یہ نہیں کھل سکا۔', retry: 'دوبارہ کوشش کریں', watchNext: 'اگلی ویڈیو دیکھیں', quizAfter: 'کوئز کھیلیں',
      moreVideos: 'اور ویڈیوز دیکھیں', play: 'ویڈیو چلائیں', say: 'سنیں',
      storiesNone: 'نئی کہانیاں آ رہی ہیں۔ تب تک کھیل کھیلیں!', gamesNone: 'جگنو کے ساتھ کہانی پڑھیں!', toGames: 'کھیل کھیلیں', toStories: 'کہانی پڑھیں',
      mins: function (m) { return urDigits(m) + ' منٹ'; },
      subj: function (s) { return SUBJ_UR[s] || s; },
    },
  };
  var SUBJ_UR = { English: 'انگریزی', Maths: 'ریاضی', Urdu: 'اردو', Science: 'سائنس', Geography: 'جغرافیہ', 'General Knowledge': 'معلوماتِ عامہ', History: 'تاریخ', 'Islamic Studies': 'اسلامیات', 'Social Studies': 'معاشرتی علوم' };
  var DOORS = ['stories', 'games', 'videos'];
  var PLAY = '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
  var TICK = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var SPK = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M4 9h4l5-4v14l-5-4H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  var HOMEI = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M12 3l9 8h-3v9h-4v-6h-4v6H6v-9H3z"/></svg>';

  function urDigits(n) { return String(n).replace(/[0-9]/g, function (d) { return String.fromCharCode(0x06F0 + Number(d)); }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function langOf(ctx) { return ctx && ctx.lang === 'ur' ? 'ur' : 'en'; }
  function C(ctx) { return COPY[langOf(ctx)]; }
  function home() { return (typeof window !== 'undefined' && window.WQHOME) || null; }
  function owns(name) { return DOORS.indexOf(name) >= 0 || /^watch\/[0-9a-f-]{36}$/i.test(String(name || '')); }
  function tok(B, ctx) { return (ctx && ctx.token) || B.token || ''; }
  function withLang(h, l) { return typeof window !== 'undefined' && window.WQT && window.WQT.withLang ? window.WQT.withLang(h, l) : h; }
  function withHome(B, h) { return B.nav_home ? h + (h.indexOf('?') >= 0 ? '&' : '?') + 'home=1' : h; }
  function chHref(B, ctx) { return withHome(B, withLang('/c/' + encodeURIComponent(tok(B, ctx)) + '?kid=' + encodeURIComponent(B.kid || ''), langOf(ctx))); }
  function quizHref(code, k, again) { return '/q/' + encodeURIComponent(code) + '?' + (again ? 'again=1&' : '') + 'k=' + encodeURIComponent(k || ''); }
  // A Story Time passage opens in the room by its id; a LISTEN passage must say so (wq-trail.js storyRoom: ex=listen).
  function storyHref(B, ctx, s) { return chHref(B, ctx) + '&room=story&pid=' + encodeURIComponent(s.id) + (s.kind === 'listen' ? '&ex=listen' : ''); }
  function gameHref(B, ctx, g) { return chHref(B, ctx) + '#' + encodeURIComponent(g.stop || ''); }
  function bootDoors(B) { var d = B.doors || {}; return { stories: d.stories || [], games: d.games || [], videos: d.videos || null }; }
  // A title with no Arabic-script letter (an English lesson title on an Urdu page) keeps the Latin face, left to right.
  function lat(text) { return /[\u0600-\u06FF]/.test(String(text || '')) ? '' : ' class="wq-lat" dir="ltr"'; }
  function minsOf(secs) { var m = Math.round((Number(secs) || 0) / 60); return m >= 1 ? m : null; }

  /* ---------------- pieces ---------------- */
  function sayBtn(text, url, ctx) {
    return '<button class="wq-dspk" type="button" data-tap="say" data-sound data-trigger="tap" data-say="' + esc(text) + '"' + (url ? ' data-url="' + esc(url) + '"' : '') + ' aria-label="' + esc(C(ctx).say + ': ' + text) + '">' + SPK + '</button>';
  }
  function row(o, ctx) {
    // o: {href, title, sub, tag, kind, pos, item, say, done, art, tap}
    var art = o.art ? '<img class="wq-rart" src="' + esc(o.art) + '" alt="" width="56" height="56" loading="lazy" decoding="async">' : '';
    var tag = o.done ? '<i class="wq-donetag" role="img" aria-label="' + esc(C(ctx).doneTag) + '">' + TICK + '</i>' : (o.tag ? '<i class="wq-new">' + esc(o.tag) + '</i>' : '');
    var attrs = ' data-tap="' + (o.tap || 'row') + '" data-kind="' + esc(o.kind) + '"' + (o.pos != null ? ' data-pos="' + esc(o.pos) + '"' : '') + (o.item ? ' data-item="' + esc(o.item) + '"' : '');
    var inner = art + '<span class="wq-rtext"><b><bdi' + lat(o.title) + '>' + esc(o.title) + '</bdi></b>' + (o.sub ? '<small><bdi' + lat(o.sub) + '>' + esc(o.sub) + '</bdi></small>' : '') + '</span>' + tag;
    var main = o.href ? '<a class="wq-row wq-drow"' + attrs + ' href="' + esc(o.href) + '">' + inner + '</a>' : '<button class="wq-row wq-drow" type="button"' + attrs + '>' + inner + '</button>';
    return '<li class="wq-dli' + (o.done ? ' done' : '') + '">' + main + sayBtn(o.title, o.say, ctx) + '</li>';
  }
  function section(title, rows) { return rows ? '<h3 class="wq-dsec" dir="auto"><bdi' + lat(title) + '>' + esc(title) + '</bdi></h3><ul class="wq-rows">' + rows + '</ul>' : ''; }
  // Exactly one primary per screen: the first row there is, else the screen's own fallback button.
  function primaryFirst(h) { return h.replace(/<(a|button) class="wq-row wq-drow"/, '<$1 class="wq-row wq-drow" data-primary'); }
  function frame(B, ctx, name, title, body) {
    var H = home();
    var bar = H && typeof H.bar === 'function' ? H.bar(ctx, DOORS.indexOf(name) >= 0 ? name : 'videos') : '';
    var t = (H && H.COPY && H.COPY[langOf(ctx)]) || {};
    return '<section class="wq-screen wq-home wq-droom" data-screen="' + esc(name.split('/')[0]) + '" data-m="H3-' + esc(name.split('/')[0]) + '" lang="' + langOf(ctx) + '" dir="' + (langOf(ctx) === 'ur' ? 'rtl' : 'ltr') + '">' +
      '<div class="wq-dtop"><a class="wq-homebtn" href="#" data-home data-tap="home" aria-label="' + esc(t.home || 'Home') + '">' + HOMEI + '</a><h2 dir="auto">' + esc(title) + '</h2></div>' +
      body + '</section>' + bar;
  }
  function emptyNote(text, to, label) {
    return '<div class="wq-dempty"><p class="wq-soon">' + esc(text) + '</p><a class="wq-btn wq-go" data-primary data-tap="door" data-door="' + to + '" href="#' + to + '">' + esc(label) + '</a></div>';
  }

  /* ---------------- Stories ---------------- */
  function storiesBody(B, ctx, data) {
    var t = C(ctx);
    var list = data && data.stories ? data.stories : bootDoors(B).stories.filter(function (s) { return s.kind === 'passage' || s.kind === 'listen'; }).map(function (s, i) { return { kind: s.kind, id: s.id, title: s.title, fresh: s.fresh, week: i === 0 && s.kind === 'passage', pos: i }; });
    var shelfOn = data ? Boolean(data.shelf) : bootDoors(B).stories.some(function (s) { return s.kind === 'shelf'; });
    var mk = function (s) {
      var title = s.title || (s.kind === 'listen' ? t.listen : (s.week ? t.weekStory : t.story));
      return row({ href: storyHref(B, ctx, s), title: title, sub: s.week && s.title ? t.weekStory : '', tag: s.fresh && !s.done ? t.newTag : '', done: s.done, kind: s.kind === 'listen' ? 'listen' : 'passage', pos: s.pos, item: s.id, say: s.say }, ctx);
    };
    var week = list.filter(function (s) { return s.week; });
    var reads = list.filter(function (s) { return !s.week && s.kind !== 'listen'; });
    var listens = list.filter(function (s) { return s.kind === 'listen'; });
    var h = (week.length ? '<ul class="wq-rows wq-week">' + week.map(mk).join('') + '</ul>' : '') +
      section(t.toRead, reads.map(mk).join('')) +
      (shelfOn ? '<div class="wq-shelfwrap"><h3 class="wq-dsec" dir="auto">' + esc(t.books) + '</h3><div class="wq-shelf" data-shelf="1"></div></div>' : '') +
      section(t.toListen, listens.map(mk).join(''));
    if (!list.length && !shelfOn) return emptyNote(t.storiesNone, 'games', t.toGames);
    return list.length ? primaryFirst(h) : h;
  }

  /* ---------------- Games ---------------- */
  function gameName(g, t) { return g.stop === 'missing' ? (g.warm ? t.warm : (g.name || t.missing)) : g.stop === 'bigger' ? (g.name || t.bigger) : t.g1; }
  function gamesBody(B, ctx, data) {
    var t = C(ctx);
    var boot = bootDoors(B).games;
    var quizzes = boot.filter(function (g) { return g.kind === 'quiz'; });
    var open = quizzes.filter(function (g) { return !g.done; });
    var done = quizzes.filter(function (g) { return g.done; });
    var nums = data && data.games ? data.games : (boot.some(function (g) { return g.kind === 'numbers'; }) ? [{ kind: 'numbers', stop: '' }] : []);
    var quizRow = function (g, i) { return row({ href: quizHref(g.code, g.k, g.done), title: g.topic || t.quiz, done: g.done, kind: g.done ? 'again' : 'quiz', pos: i, say: g.say }, ctx); };
    var h = section(t.fromTeacher, open.map(quizRow).join('')) +
      section(t.numbers, nums.map(function (g, i) { return row({ href: g.stop ? gameHref(B, ctx, g) : chHref(B, ctx), title: g.stop ? gameName(g, t) : t.g1, kind: 'game', item: g.stop || 'numbers', pos: i, say: g.say }, ctx); }).join('')) +
      section(t.again, done.map(quizRow).join(''));
    if (!open.length && !nums.length && !done.length) return emptyNote(t.gamesNone, 'stories', t.toStories);
    return primaryFirst(h);
  }

  /* ---------------- Videos (the library's own data) ---------------- */
  function subjectsBody(ctx, lib) {
    var t = C(ctx);
    if (!lib) return '<p class="wq-soon wq-wait" data-primary>' + esc(t.opening) + '</p>';
    if (lib.err) return '<div class="wq-dempty"><p class="wq-soon">' + esc(t.oops) + '</p><button class="wq-btn wq-go" type="button" data-primary data-tap="retry">' + esc(t.retry) + '</button></div>';
    var subs = lib.subjects || [];
    if (!subs.length) return emptyNote(t.none, 'stories', t.toStories);
    return primaryFirst('<p class="wq-dsay">' + esc(t.pick) + '</p><ul class="wq-rows">' + subs.map(function (s, i) {
      return row({ title: t.subj(s.key), kind: 'subject', item: s.key, pos: i, art: s.art, tap: 'subj' }, ctx);
    }).join('') + '</ul>');
  }
  function chaptersBody(ctx, lib, subj) {
    var t = C(ctx);
    var back = '<button class="wq-dback" type="button" data-tap="subjects">' + esc(t.back) + '</button>';
    if (!lib) return back + '<p class="wq-soon wq-wait" data-primary>' + esc(t.opening) + '</p>';
    var art = lib.art || null; var i = 0;
    var body = (lib.chapters || []).map(function (ch) {
      return section(ch.name, (ch.videos || []).map(function (v) {
        var m = minsOf(v.secs);
        return row({ title: v.title, sub: m ? t.mins(m) : '', done: v.done, kind: 'video', item: v.vid, pos: i++, art: art, tap: 'vid' }, ctx);
      }).join(''));
    }).join('');
    return body ? back + primaryFirst(body) : back.replace('type="button"', 'type="button" data-primary') + '<p class="wq-soon">' + esc(t.none) + '</p>';
  }

  /* ---------------- the watch screen (a child with no class) ---------------- */
  function watchHtml(w, ctx, next) {
    var t = C(ctx);
    var nx = next ? '<a class="wq-next wq-vnext" data-tap="after" data-kind="' + esc(next.kind) + '" href="' + esc(next.href || '#videos') + '">' +
      '<span class="wq-ntext"><b>' + esc(next.title) + '</b>' + (next.sub ? '<small><bdi' + lat(next.sub) + '>' + esc(next.sub) + '</bdi></small>' : '') + '</span><span class="wq-ngo" aria-hidden="true">' + PLAY + '</span></a>' : '';
    return '<div class="wq-vbox"><video class="wq-vid" playsinline controls preload="none" controlslist="nodownload"' + (w.poster ? ' poster="' + esc(w.poster) + '"' : '') + ' src="' + esc(w.url) + '"></video>' +
      '<button class="wq-vplay" type="button" data-primary data-tap="play" data-sound data-trigger="tap" aria-label="' + esc(t.play) + '">' + PLAY + '</button></div>' +
      '<p class="wq-vtitle" dir="auto"><bdi' + lat(w.title) + '>' + esc(w.title || '') + '</bdi></p>' +
      '<div class="wq-after" hidden>' + nx + '</div>';
  }

  /* ---------------- markup entry (pure) ---------------- */
  function html(B, ctx, name, data) {
    var H = home(); var ht = (H && H.COPY && H.COPY[langOf(ctx)]) || {};
    if (name === 'stories') return frame(B, ctx, name, ht.stories || 'Stories', storiesBody(B, ctx, data));
    if (name === 'games') return frame(B, ctx, name, ht.games || 'Games', gamesBody(B, ctx, data));
    if (name === 'videos') return frame(B, ctx, name, ht.videos || 'Videos', data && data.subject ? chaptersBody(ctx, data.lib, data.subject) : subjectsBody(ctx, data && data.lib));
    if (/^watch\//.test(name)) return frame(B, ctx, name, ht.videos || 'Videos', data && data.watch ? watchHtml(data.watch, ctx, data.next) : '<p class="wq-soon wq-wait" data-primary>' + esc(C(ctx).opening) + '</p>');
    return '';
  }

  /* ---------------- live: fetch, wire, play ---------------- */
  var cache = {};
  var lib = { subjects: null, chapters: {} };
  var going = false;
  function getJson(url, done) {
    try {
      fetch(url, { headers: { accept: 'application/json' }, credentials: 'same-origin' }).then(function (r) {
        return r.ok ? r.json().then(function (j) { done(null, j); }) : done(r.status);
      }, function () { done(0); });
    } catch (e) { done(0); }
  }
  function postJson(url, body, done) {
    try {
      fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) }).then(function (r) {
        return r.text().then(function (x) { var j = null; try { j = x ? JSON.parse(x) : null; } catch (e) {} done(r.ok ? null : r.status, j); });
      }, function () { done(0); });
    } catch (e) { done(0); }
  }
  function go(ctx, href, what) { if (!href) return; if (ctx.go) ctx.go(href, what); else location.assign(href); }
  function each(root, sel, fn) { Array.prototype.forEach.call(root.querySelectorAll(sel), fn); }
  function speak(el, ctx) {
    var url = el.getAttribute('data-url'); var text = el.getAttribute('data-say') || '';
    try {
      if (url) { var a = new Audio(url); a.play().catch(function () {}); return; }
      if (window.speechSynthesis && window.SpeechSynthesisUtterance) {
        var u = new SpeechSynthesisUtterance(text); u.lang = langOf(ctx) === 'ur' ? 'ur-PK' : 'en-IN'; u.rate = 0.9;
        window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
      }
    } catch (e) {}
  }
  function storiesShelf(root, B, ctx) {
    var sh = root.querySelector('[data-shelf]');
    if (!sh) return;
    var fill = function () { try { if (window.WQSTORIES && typeof window.WQSTORIES.shelf === 'function') window.WQSTORIES.shelf(sh, { token: tok(B, ctx), kid: B.kid, lang: langOf(ctx), ev: ctx.ev || function () {} }); } catch (e) {} };
    if (window.WQSTORIES) return fill();
    var H = home();
    if (H && typeof H.loadOnce === 'function') H.loadOnce('wq-stories', fill);
  }

  var view = { name: null, subject: null, watch: null, next: null, list: null };
  function draw(root, B, ctx, name, data) {
    root.innerHTML = html(B, ctx, name, data);
    root.setAttribute('data-m', 'H3-' + name.split('/')[0]);
    wire(root, B, ctx, name);
    try { window.scrollTo(0, 0); } catch (e) {}
  }
  function mount(root, B, ctx, name) {
    view.name = name;
    if (name === 'stories' || name === 'games') {
      draw(root, B, ctx, name, cache[name] || null);
      if (!cache[name]) {
        getJson('/api/wq/doors/h/' + encodeURIComponent(tok(B, ctx)) + '?kid=' + encodeURIComponent(B.kid || '') + '&d=' + name + '&l=' + langOf(ctx), function (err, j) {
          if (err || !j) return;
          cache[name] = j;
          if (view.name === name) draw(root, B, ctx, name, j);
        });
      }
      return;
    }
    if (name === 'videos') return videos(root, B, ctx, view.subject);
    if (/^watch\//.test(name)) return start(root, B, ctx, { vid: name.slice(6) });
  }
  function libUrl(B, ctx, s) { return '/api/wq/lib/h/' + encodeURIComponent(tok(B, ctx)) + '?kid=' + encodeURIComponent(B.kid || '') + '&l=' + langOf(ctx) + (s ? '&s=' + encodeURIComponent(s) : ''); }
  function videos(root, B, ctx, subject) {
    view.subject = subject || null;
    if (!subject) {
      draw(root, B, ctx, 'videos', { lib: lib.subjects });
      if (!lib.subjects || lib.subjects.err) getJson(libUrl(B, ctx), function (err, j) { lib.subjects = err || !j ? { err: true } : j; if (view.name === 'videos' && !view.subject) draw(root, B, ctx, 'videos', { lib: lib.subjects }); });
      return;
    }
    draw(root, B, ctx, 'videos', { subject: subject, lib: lib.chapters[subject] || null });
    if (!lib.chapters[subject]) getJson(libUrl(B, ctx, subject), function (err, j) { if (err || !j) return; lib.chapters[subject] = j; if (view.name === 'videos' && view.subject === subject) draw(root, B, ctx, 'videos', { subject: subject, lib: j }); });
  }
  // The lesson after this one in the open subject's list (Watch next), or null.
  function nextInList(vid) {
    var l = view.subject && lib.chapters[view.subject]; if (!l) return null;
    var all = []; (l.chapters || []).forEach(function (c) { (c.videos || []).forEach(function (v) { all.push(v); }); });
    for (var i = 0; i < all.length - 1; i++) if (all[i].vid === vid) return all[i + 1];
    return null;
  }
  function start(root, B, ctx, v) {
    if (going) return;
    if (v.code && v.k) { going = true; return go(ctx, '/q/' + encodeURIComponent(v.code) + '?k=' + encodeURIComponent(v.k), 'door_video'); }
    going = true;
    var t = C(ctx);
    if (view.name !== 'watch/' + v.vid) draw(root, B, ctx, 'watch/' + v.vid, null);
    view.name = 'watch/' + v.vid;
    postJson('/api/wq/videos/start', { hub: tok(B, ctx), kid: B.kid || '', vid: v.vid }, function (err, j) {
      going = false;
      if (!err && j && j.code) return go(ctx, '/q/' + encodeURIComponent(j.code) + (j.k ? '?k=' + encodeURIComponent(j.k) : ''), 'door_video');
      if (!err && j && j.watch) {
        var after = nextInList(v.vid);
        var next = j.watch.after ? { kind: 'quiz', title: t.quizAfter, sub: j.watch.title, href: '#', quiz: true }
          : after ? { kind: 'video', title: t.watchNext, sub: after.title, href: '#', vid: after.vid } : { kind: 'video', title: t.moreVideos, sub: '', href: '#videos' };
        view.watch = j.watch; view.next = next;
        return draw(root, B, ctx, 'watch/' + v.vid, { watch: j.watch, next: next });
      }
      draw(root, B, ctx, 'videos', { lib: { err: true } });
    });
  }

  function wire(root, B, ctx, name) {
    var ev = ctx.ev || function () {};
    each(root, '[data-tap]', function (el) {
      el.addEventListener('click', function (e) {
        var tap = el.getAttribute('data-tap');
        try { if (window.WQJ && typeof window.WQJ.tap === 'function') window.WQJ.tap(); } catch (x) {}
        if (tap === 'say') { e.preventDefault(); e.stopPropagation(); return speak(el, ctx); }
        if (tap === 'home') { e.preventDefault(); view.subject = null; try { location.hash = ''; } catch (x) {} if (home()) home().mount(root, B, ctx); return; }
        if (tap === 'door') { ev('door_tap', { door: el.getAttribute('data-door'), pos: DOORS.indexOf(el.getAttribute('data-door')) + 1 }); return; }
        if (tap === 'row') {
          e.preventDefault();
          ev('door_row_tap', { door: name, kind: el.getAttribute('data-kind'), item: el.getAttribute('data-item') || undefined, pos: Number(el.getAttribute('data-pos')) });
          return go(ctx, el.getAttribute('href'), 'door_' + el.getAttribute('data-kind'));
        }
        if (tap === 'subj') { e.preventDefault(); ev('door_row_tap', { door: 'videos', kind: 'subject', item: el.getAttribute('data-item'), pos: Number(el.getAttribute('data-pos')) }); return videos(root, B, ctx, el.getAttribute('data-item')); }
        if (tap === 'subjects') { e.preventDefault(); return videos(root, B, ctx, null); }
        if (tap === 'retry') { e.preventDefault(); lib.subjects = null; return videos(root, B, ctx, null); }
        if (tap === 'vid') {
          e.preventDefault();
          var vid = el.getAttribute('data-item');
          var l = lib.chapters[view.subject] || {}; var hit = null;
          (l.chapters || []).forEach(function (c) { (c.videos || []).forEach(function (v) { if (v.vid === vid) hit = v; }); });
          ev('door_row_tap', { door: 'videos', kind: 'video', item: vid, pos: Number(el.getAttribute('data-pos')) });
          return start(root, B, ctx, hit || { vid: vid });
        }
        if (tap === 'after') {
          e.preventDefault();
          var nx = view.next || {};
          ev('next_tap', { ctx: 'after_video', kind: nx.kind, pos: 0 });
          if (nx.quiz && view.watch) {
            return postJson('/api/wq/videos/start', { hub: tok(B, ctx), kid: B.kid || '', vid: view.watch.vid, after: 1 }, function (err, j) {
              if (!err && j && j.code) return go(ctx, '/q/' + encodeURIComponent(j.code) + (j.k ? '?k=' + encodeURIComponent(j.k) : ''), 'after_video');
              videos(root, B, ctx, view.subject);
            });
          }
          if (nx.vid) return start(root, B, ctx, { vid: nx.vid });
          try { location.hash = '#videos'; } catch (x) {}
          return videos(root, B, ctx, view.subject);
        }
      });
    });
    if (name === 'stories') storiesShelf(root, B, ctx);
    var vEl = root.querySelector('.wq-vid');
    if (vEl) wireVideo(root, vEl, ctx, ev);
  }
  // video_open on the first play, video_watched at >= 90 % played (EVENTS_V3 §3); then the Next tile is the primary.
  function wireVideo(root, vEl, ctx, ev) {
    var vid = view.watch && view.watch.vid; var opened = false; var watched = false; var t0 = 0;
    var playBtn = root.querySelector('.wq-vplay');
    var showAfter = function () {
      var a = root.querySelector('.wq-after'); if (!a || !a.hidden) return;
      a.hidden = false;
      if (playBtn) { playBtn.removeAttribute('data-primary'); playBtn.hidden = true; }
      var nx = a.querySelector('.wq-vnext'); if (nx) nx.setAttribute('data-primary', '');
      ev('next_shown', { ctx: 'after_video', kind: (view.next || {}).kind, pos: 0, source: 'fallback' });
    };
    if (playBtn) playBtn.addEventListener('click', function () { try { var p = vEl.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {} });
    vEl.addEventListener('play', function () {
      if (playBtn) playBtn.hidden = true;
      if (!opened) { opened = true; t0 = Date.now(); ev('video_open', { item: vid, via: 'hub_door' }); }
    });
    vEl.addEventListener('timeupdate', function () {
      var d = vEl.duration;
      if (!watched && d && isFinite(d) && vEl.currentTime / d >= 0.9) { watched = true; ev('video_watched', { item: vid, via: 'hub_door', ms: Date.now() - t0 }); showAfter(); }
    });
    vEl.addEventListener('ended', showAfter);
  }

  function mountKeep(root, B, ctx, name) { going = false; return mount(root, B, ctx, name); }

  if (typeof window !== 'undefined') {
    window.WQDOORS = { owns: owns, html: html, watchHtml: watchHtml, mount: mountKeep, COPY: COPY, storyHref: storyHref,
      _reset: function () { cache = {}; lib = { subjects: null, chapters: {} }; going = false; view = { name: null, subject: null, watch: null, next: null }; } };
  }
})();
