/* The v3 child home (/h/<token>, app_settings web_quiz_home_v3; loaded by hub.js only when the bot's hub JSON carries
 * `home_v3`): ONE big thing to do now, three doors at the thumb (Stories, Games, Videos), the day-dots and the sticker
 * jar in the header, and the grown-ups corner behind a 2-second hold. The page decides nothing: the Next tile is the
 * server's `next` (web_quiz_next_offer) when it came, else the hub's own lantern / teacher card in today's order; the
 * doors are the server's `doors`. Copy lives in COPY below (one object, EN + UR): a door rename is one line.
 *   WQHOME.mount(root, B, ctx)  draw the home (or a door, from location.hash) and wire it; ctx {token, lang, ev, go}
 *   WQHOME.html(B, ctx)         the home's markup (pure, for tests)     WQHOME.door(B, ctx, name)  a door's markup
 *   WQHOME.nextOf(B, ctx)       the one Next thing {kind, title, sub, href, art, minutes, src, tag} (pure)
 * A practice boot (B.practice, a coach previewing what the class sees) is the same home by grade: "Class N" in the
 * header, a strip with Back to the teacher home, and every tap that would need a child says so instead of opening —
 * unless the boot says practice_play (app_settings web_quiz_practice_play): then every tap opens as a child's does. */
(function () {
  'use strict';
  var COPY = {
    en: {
      hi: function (n) { return n ? 'Hi ' + n + '!' : 'Hi!'; },
      stories: 'Stories', games: 'Games', videos: 'Videos',
      storiesSay: 'Stories you read with Jugnu', gamesSay: 'Games with numbers and sounds', videosSay: 'Videos your teacher chose',
      soon: 'Coming soon', home: 'Home',
      nextQuiz: 'Your teacher\'s quiz', nextCont: 'Finish your quiz', nextStory: 'Read a story with Jugnu', nextListen: 'Listen to a story',
      nextGame: 'Come along with Jugnu', nextNumbers: 'Play the numbers game', nextVideo: 'Watch a video', nextAgain: 'Play again',
      nextNone: 'Ask your teacher for a quiz link', nextPick: 'Pick a story', playQuiz: 'Play a quiz',
      weekStory: 'This week\'s story', listen: 'Listen to a story', shelf: 'Storybooks', numbers: 'Numbers with Jugnu',
      fromTeacher: 'From your teacher', again: 'Play again', newTag: 'New', newQuiz: 'New', openVideos: 'Open the videos',
      mins: function (m) { return m + ' min'; },
      jar: 'My stickers', jarNew: 'A new sticker', sndOn: 'Sound on', sndOff: 'Sound off',
      sep: ', ', grown: 'Grown-ups', grownHold: 'Press and hold', grownTap: 'Hold for grown-ups', grownKeep: 'Keep holding…', grownLang: 'اردو', grownClose: 'Close', helloAgain: 'Show Jugnu\'s hello again', week: 'Days you played this week',
      who: 'Who is playing?', someoneNew: 'Someone new?',
      remember: 'Jugnu will remember you on this phone.', remUndo: 'Undo', forget: 'Forget this phone',
      friendJoined: 'A friend joined Jugnu from your card!', friendStamp: 'Guide',
      cls: function (n) { return 'Class ' + n; }, prSees: 'This is what your class sees', prBack: 'Back', prNote: 'Children open this from their own link',
      off: 'No internet. Try again when you are online.', offAgain: 'Try again',
      myClass: 'My class', mySchool: 'My school', social: 'My class and my school',
      grade: 'Grade', gradeN: function (n) { return 'Grade ' + n; }, inClass: function (n) { return 'In class: Grade ' + n; },
      gradeSaved: function (n) { return 'Saved. Home now shows Grade ' + n + '.'; }, gradeLater: 'Try again tomorrow.',
      gradeSavedCls: function (n, c) { return 'Saved. Stories and videos now open at Grade ' + n + '. Class quizzes stay Grade ' + c + '.'; },
    },
    ur: {
      hi: function (n) { return n ? '⁨' + n + '⁩، السلام علیکم!' : 'السلام علیکم!'; },
      stories: 'کہانیاں', games: 'کھیل', videos: 'ویڈیوز',
      storiesSay: 'جگنو کے ساتھ کہانیاں پڑھیں اور سنیں', gamesSay: 'گنتی اور آوازوں کے کھیل', videosSay: 'ٹیچر کی چنی ہوئی ویڈیوز',
      soon: 'جلد آ رہا ہے', home: 'ہوم',
      nextQuiz: 'ٹیچر کا کوئز', nextCont: 'اپنا کوئز مکمل کریں', nextStory: 'جگنو کے ساتھ کہانی پڑھیں', nextListen: 'کہانی سنیں',
      nextGame: 'جگنو کے ساتھ چلیں', nextNumbers: 'گنتی کا کھیل کھیلیں', nextVideo: 'ویڈیو دیکھیں', nextAgain: 'دوبارہ کھیلیں',
      nextNone: 'ٹیچر سے کوئز کا لنک لیں', nextPick: 'کہانی چنیں', playQuiz: 'کوئز کھیلیں',
      weekStory: 'اس ہفتے کی کہانی', listen: 'کہانی سنیں', shelf: 'کہانیوں کی کتابیں', numbers: 'جگنو کے ساتھ گنتی',
      fromTeacher: 'ٹیچر کی طرف سے', again: 'دوبارہ کھیلیں', newTag: 'نئی', newQuiz: 'نیا', openVideos: 'ویڈیوز کھولیں',
      mins: function (m) { return urDigits(m) + ' منٹ'; },
      jar: 'میرے اسٹیکرز', jarNew: 'نیا اسٹیکر', sndOn: 'آواز چالو', sndOff: 'آواز بند',
      sep: '، ', grown: 'بڑوں کے لیے', grownHold: 'دبائے رکھیں', grownTap: 'بڑوں کے لیے دبائے رکھیں', grownKeep: 'تھوڑی دیر اور دبائے رکھیں…', grownLang: 'English', grownClose: 'بند کریں', helloAgain: 'جگنو کا سلام دوبارہ دکھائیں', week: 'اس ہفتے آپ نے کب کب کھیلا',
      who: 'کس کی باری ہے؟', someoneNew: 'کوئی اور؟',
      remember: 'جگنو آپ کو اس فون پر یاد رکھے گا۔', remUndo: 'یاد نہ رکھیں', forget: 'اس فون پر یاد نہ رکھیں',
      friendJoined: 'آپ کے کارڈ سے ایک دوست نے جگنو شروع کیا!', friendStamp: 'رہنما',
      cls: function (n) { return 'کلاس ' + urDigits(n); }, prSees: 'آپ کی کلاس کو یہی نظر آتا ہے', prBack: 'واپس', prNote: 'بچے اسے اپنے لنک سے کھولیں گے',
      off: 'انٹرنیٹ نہیں ہے۔ انٹرنیٹ آنے پر دوبارہ کوشش کریں۔', offAgain: 'دوبارہ کوشش کریں',
      myClass: 'میری کلاس', mySchool: 'میرا اسکول', social: 'میری کلاس اور میرا اسکول',
      grade: 'جماعت', gradeN: function (n) { return 'جماعت ' + urDigits(n); }, inClass: function (n) { return 'اسکول میں: جماعت ' + urDigits(n); },
      gradeSaved: function (n) { return 'محفوظ ہو گیا۔ اب ہوم پر جماعت ' + urDigits(n) + ' نظر آئے گی۔'; }, gradeLater: 'کل دوبارہ کوشش کریں۔',
      gradeSavedCls: function (n, c) { return 'محفوظ ہو گیا۔ اب کہانیاں اور ویڈیوز جماعت ' + urDigits(n) + ' کی کھلیں گی۔ کلاس کے کوئز جماعت ' + urDigits(c) + ' کے رہیں گے۔'; },
    },
  };
  // The door icons (inline, one colour, currentColor): a book, a die, a play button.
  var ICON = {
    stories: '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path fill="currentColor" d="M3 5c3-1.3 6-1.3 9 .5 3-1.8 6-1.8 9-.5v14c-3-1.3-6-1.3-9 .5-3-1.8-6-1.8-9-.5zM12 7v11"/><path d="M12 6v13" stroke="#fff" stroke-width="1.4"/></svg>',
    games: '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor"/><g fill="#fff"><circle cx="8" cy="8" r="1.7"/><circle cx="16" cy="16" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="16" cy="8" r="1.7"/><circle cx="8" cy="16" r="1.7"/></g></svg>',
    videos: '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="4" fill="currentColor"/><path d="M10 8.5v7l6-3.5z" fill="#fff"/></svg>',
    home: '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M12 3l9 8h-3v9h-4v-6h-4v6H6v-9H3z"/></svg>',
    sndOn: '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    sndOff: '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    go: '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
    myClass: '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><g fill="currentColor"><circle cx="12" cy="7" r="3.2"/><circle cx="5" cy="9.5" r="2.4"/><circle cx="19" cy="9.5" r="2.4"/><path d="M6.5 20a5.5 5.5 0 0 1 11 0zM1 19a4 4 0 0 1 6-3.4A7 7 0 0 0 5.2 19zM23 19a4 4 0 0 0-6-3.4 7 7 0 0 1 1.8 3.4z"/></g></svg>',
    mySchool: '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path fill="currentColor" d="M12 2l9 5v2H3V7zM4 10h3v8H4zM10.5 10h3v8h-3zM17 10h3v8h-3zM2 19h20v3H2z"/></svg>',
    jar: '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path fill="currentColor" d="M7 2h10v3H7zM6 6h12a2 2 0 0 1 2 2v11a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a2 2 0 0 1 2-2z"/><path fill="#fff" d="M12 9.5l1.4 2.9 3.1.4-2.3 2.2.6 3.1-2.8-1.5-2.8 1.5.6-3.1-2.3-2.2 3.1-.4z"/></svg>',
  };
  var DOORS = ['stories', 'games', 'videos'];

  function urDigits(n) { return String(n).replace(/[0-9]/g, function (d) { return String.fromCharCode(0x06F0 + Number(d)); }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function langOf(ctx) { return ctx && ctx.lang === 'ur' ? 'ur' : 'en'; }
  // a quiz row's name: a video lesson's Urdu-script name on an Urdu screen (the hub's topic_ur), else its topic
  function topicOf(g, ctx) { return (langOf(ctx) === 'ur' && g.topic_ur) || g.topic; }
  function C(ctx) { return COPY[langOf(ctx)]; }
  function withLang(h, l) { return typeof window !== 'undefined' && window.WQT && window.WQT.withLang ? window.WQT.withLang(h, l) : h; }
  function withHome(B, h) { return B.nav_home ? h + (h.indexOf('?') >= 0 ? '&' : '?') + 'home=1' : h; }
  function quizHref(code, k, again) { return '/q/' + encodeURIComponent(code) + '?' + (again ? 'again=1&' : '') + 'k=' + encodeURIComponent(k || ''); }
  function chHref(B, ctx) { return withHome(B, withLang('/c/' + encodeURIComponent(ctx.token || B.token || '') + '?kid=' + encodeURIComponent(B.kid || ''), langOf(ctx))); }
  function doorsOf(B) { var d = B.doors || {}; return { stories: d.stories || [], games: d.games || [], videos: d.videos || null }; }

  /* ---------------- the one Next thing ---------------- */
  // web_quiz_page_lang (the hub's `page_lang: true`): a quiz page the home opens names the child's language, as the
  // Videos door's links do, so an Urdu child's English lesson door is in Urdu
  function qLang(B, ctx, h) { return B && B.page_lang === true && /^\/q\//.test(h || '') && !/[?&]lang=/.test(h) ? h + (h.indexOf('?') >= 0 ? '&' : '?') + 'lang=' + langOf(ctx) : h; }
  function nextOf(B, ctx) { var n = nextOf0(B, ctx); if (n && n.href) n.href = qLang(B, ctx, n.href); return n; }
  function nextOf0(B, ctx) {
    var t = C(ctx); var l = langOf(ctx); var n = B.next;
    if (n && n.href) {
      return { kind: n.kind, title: (l === 'ur' && n.title_ur) || n.title || t.nextStory, sub: (l === 'ur' && n.sub_ur) || n.sub || '', tag: (l === 'ur' && n.tag_ur) || n.tag || null, href: n.href, art: n.art || null, minutes: n.minutes || null, src: 'next' };
    }
    // No `next` from the server (web_quiz_next_offer off): today's order — the teacher's quiz, the quiz left open, the lantern.
    // The teacher's pending quiz IS the Next tile: "New · From your teacher", the topic beneath.
    // The fallback carries the same minutes the ranker uses (quiz/video 3, story 2, numbers 1) and the thing's own art.
    if (B.teacher && B.teacher.code) return { kind: 'quiz', title: t.fromTeacher, tag: t.newQuiz, sub: topicOf(B.teacher, ctx) || '', href: quizHref(B.teacher.code, B.teacher.k), src: 'teacher', art: artOfCode(B, B.teacher.code), minutes: 3 };
    if (B.last && B.last.code && B.last.state === 'open') return { kind: 'quiz', title: t.nextCont, sub: topicOf(B.last, ctx) || '', href: quizHref(B.last.code, B.last.k), src: 'last', art: artOfCode(B, B.last.code), minutes: 3 };
    // A game tile opens the one game it names (#next: the first not done; #numbers: the warm-up; wq-trail.js), never the list.
    var x = B.play && B.play.lantern;
    if (x && B.challenge && B.challenge.on) {
      // the games list's first open step may be a game, a read or a listen: the tile names it when the server does (in
      // the page's language), else neutral words that promise none of them
      if (x.kind === 'trail') return { kind: 'game', title: (x.first && x.first.label && x.first.lang === l) ? x.first.label : t.nextGame, sub: '', href: chHref(B, ctx) + '#next', src: 'lantern', minutes: 2 };
      if (x.kind === 'story' && x.title) return { kind: 'story', title: t.nextStory, sub: x.title, href: chHref(B, ctx) + (x.pid ? '&room=story&pid=' + encodeURIComponent(x.pid) : ''), src: 'lantern', minutes: 2 };
      if (x.kind === 'numbers') return { kind: 'game', title: t.nextNumbers, sub: '', href: chHref(B, ctx) + '#numbers', src: 'lantern', minutes: 1 };
    }
    var d = doorsOf(B);
    var s = d.stories.filter(function (r) { return r.kind === 'passage' || r.kind === 'listen'; })[0];
    if (s) return { kind: 'story', title: s.kind === 'listen' ? t.nextListen : t.nextStory, sub: s.title || '', href: storyHref(B, ctx, s), src: 'door', minutes: 2 };
    if (d.videos && d.videos.href) return { kind: 'video', title: t.nextVideo, sub: '', href: withHome(B, d.videos.href), src: 'door', art: d.videos.art || null, minutes: 3 };
    var g = d.games[0];
    if (g) return g.kind === 'numbers' ? { kind: 'game', title: t.nextNumbers, sub: '', href: chHref(B, ctx) + '#numbers', src: 'door', minutes: 1 }
      : { kind: 'quiz', title: g.done ? t.nextAgain : t.playQuiz, sub: topicOf(g, ctx) || '', href: quizHref(g.code, g.k, g.done), src: 'door', art: g.art || null, minutes: 3 };
    // Nothing to offer: the primary still opens something (the Stories door); the sentence becomes the sub-line.
    return { kind: 'door', title: t.nextPick, sub: t.nextNone, href: '#stories', src: 'none' };
  }
  // The art the server put on a quiz's Games row (its subject's picture), or null.
  function artOfCode(B, code) { var r = doorsOf(B).games.filter(function (g) { return g.code === code && g.art; })[0]; return r ? r.art : null; }
  // A listening story asks the story room for a listen (wq-trail.js reads &ex=listen), else it is served as a read.
  function storyHref(B, ctx, s) { return chHref(B, ctx) + '&room=story&pid=' + encodeURIComponent(s.id) + (s.kind === 'listen' ? '&ex=listen' : ''); }
  var POSE = { story: 'hello', game: 'correct', quiz: 'thinking', video: 'idle', door: 'hello', none: 'sleep' };

  /* ---------------- markup ---------------- */
  function dotsHtml(B, t) {
    var h = B.head || {}; var n = Math.max(0, Math.min(7, Number(h.dots) || 0)); var out = '';
    // The coach's preview has no child, so no day of theirs to ring: seven empty dots.
    for (var i = 0; i < 7; i++) out += '<i class="wq-dot' + (i < n ? ' on' : '') + (i === n && !h.today && !B.practice ? ' ring' : '') + '"></i>';
    return '<span class="wq-dots" role="img" aria-label="' + esc(t.week) + '">' + out + '</span>';
  }
  function headHtml(B, ctx) {
    var t = C(ctx); var me = (B.kids || []).filter(function (k) { return k.chip === B.kid; })[0] || {};
    var hi = B.practice ? t.cls(Number(B.grade) || '') : t.hi(me.first || '');
    // the look: «السلام علیکم!» never splits over two lines (a narrow phone breaks after the name instead)
    if (lookOn()) hi = hi.replace('السلام علیکم', 'السلام\u00a0علیکم');
    var hiH = esc(hi);
    // the look, in Urdu: one right-to-left greeting «السلام علیکم، <name>!», the name isolated so a Latin name keeps the comma in place
    // (one inline run: the header is a flex column, so a bare <bdi> would be a line of its own; a long name and its "!"
    // move to the second line as one piece, .wq-hn)
    if (lookOn() && !B.practice && me.first && langOf(ctx) === 'ur') hiH = '<span>' + esc('السلام\u00a0علیکم، ') + '<span class="wq-hn"><bdi>' + esc(me.first) + '</bdi>!</span></span>';
    var jar = B.head && B.head.jar ? '<a class="wq-jar" href="#book" data-tap="jar" aria-label="' + esc(t.jar) + '">' + ICON.jar + (B.head.jar.fresh ? '<b class="wq-jarnew" aria-label="' + esc(t.jarNew) + '"></b>' : '') + '</a>' : '';
    return '<header class="wq-hhead"><img class="wq-hjug" data-tap="jugnu" data-sound="giggle" data-trigger="tap" src="' + jv('/wq/jugnu/hello.webp') + '" alt="" width="48" height="48">' +
      '<span class="wq-hhi">' + (whoOn(B) ? '<button class="wq-hname" type="button" data-tap="who">' + hiH + '</button>' : hiH) + dotsHtml(B, t) + '</span>' + jar +
      '<button class="wq-snd" type="button" data-tap="sound" aria-pressed="' + (muted() ? 'false' : 'true') + '" aria-label="' + esc(muted() ? t.sndOff : t.sndOn) + '">' + (muted() ? ICON.sndOff : ICON.sndOn) + '</button></header>';
  }
  // A shared phone: the child's name opens "Who is playing?" (this phone's children) and, when the server minted a join
  // token for this phone (the boot's `jn`; never read from a URL a child could forward), a last row "Someone new?" for a
  // brother or sister. Never in the coach's preview.
  function jnOf(B) { return typeof B.jn === 'string' && /^[A-Za-z0-9._-]{8,600}$/.test(B.jn) ? B.jn : null; }
  function whoOn(B) { return !B.practice && ((B.kids || []).length > 1 || Boolean(jnOf(B))); }
  function who(B, ctx) {
    var t = C(ctx); var j = jnOf(B);
    var rows = (B.kids || []).map(function (k) {
      return '<li><a class="wq-row" data-tap="pick" href="' + esc(withLang('/h/' + encodeURIComponent(ctx.token || B.token || '') + '?kid=' + encodeURIComponent(k.chip), langOf(ctx))) + '"><b><bdi>' + esc(k.first || '') + '</bdi></b></a></li>';
    }).join('') + (j ? '<li><a class="wq-row" data-tap="join" href="/quiz/join/' + esc(j) + '"><b>' + esc(t.someoneNew) + '</b></a></li>' : '');
    return '<b>' + esc(t.who) + '</b><ul class="wq-rows">' + rows + '</ul><button class="wq-btn wq-ghost" type="button" data-tap="close">' + esc(t.grownClose) + '</button>';
  }
  function whoSheet(root, B, ctx) {
    var box = document.createElement('div');
    box.className = 'wq-gsheet wq-who'; box.setAttribute('role', 'dialog'); box.setAttribute('data-screen', 'who');
    box.innerHTML = who(B, ctx);
    root.appendChild(box);
    var c = box.querySelector('[data-tap="close"]');
    if (c) c.addEventListener('click', function () { if (box.parentNode) box.parentNode.removeChild(box); });
  }
  // The coach's preview: one strip on top, "This is what your class sees" + Back to the teacher home.
  function stripHtml(B, ctx) {
    if (!B.practice) return '';
    var t = C(ctx);
    var back = B.practice_back ? '<a class="wq-prback" data-tap="prback" href="' + esc(B.practice_back) + '">' + esc(t.prBack) + '</a>' : '<button class="wq-prback" type="button" data-tap="prback">' + esc(t.prBack) + '</button>';
    return '<div class="wq-prstrip" data-practice-strip="1"><span>' + esc(t.prSees) + '</span>' + back + '</div>';
  }
  function jv(u) { return window.wqjv ? window.wqjv(u) : u; } // a Jugnu picture with its version (the page's wqjv, web_quiz_brotli on), else as is
  function nextHtml(nx, ctx) {
    var t = C(ctx);
    var art = nx.art ? '<img class="wq-nart" src="' + esc(nx.art) + '" alt="" width="96" height="96">' : '<img class="wq-nart" src="' + jv('/wq/jugnu/' + (POSE[nx.kind] || 'hello') + '.webp') + '" alt="" width="96" height="96">';
    var meta = [nx.sub ? '<bdi>' + esc(nx.sub) + '</bdi>' : '', nx.minutes ? '<span class="wq-nmin">' + esc(t.mins(nx.minutes)) + '</span>' : ''].filter(Boolean).join(langOf(ctx) === 'ur' ? '، ' : ' · ');
    var tag = nx.tag ? '<i class="wq-new">' + esc(nx.tag) + '</i>' : '';
    var inner = art + '<span class="wq-ntext">' + tag + '<b>' + esc(nx.title) + '</b>' + (meta ? '<small>' + meta + '</small>' : '') + '</span>' + (nx.href ? '<span class="wq-ngo" aria-hidden="true">' + ICON.go + '</span>' : '');
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
  // My class + my school (app_settings web_quiz_class_doors, the hub's class_doors): the quiz page's own class table and
  // school league for the child's newest class quiz. Only this site's /q/<code>/class|schools paths; nothing without them.
  var SOCIAL_RX = { myClass: /^\/q\/[A-Za-z0-9]{4,16}\/class(\?[A-Za-z0-9=&._~-]*)?$/, mySchool: /^\/q\/[A-Za-z0-9]{4,16}\/schools(\?[A-Za-z0-9=&._~-]*)?$/ };
  function socialHtml(B, ctx) {
    var cd = B.class_doors;
    if (!cd || B.practice) return '';
    var t = C(ctx);
    var links = [['myClass', cd['class']], ['mySchool', cd.schools]].filter(function (x) { return typeof x[1] === 'string' && SOCIAL_RX[x[0]].test(x[1]); });
    if (!links.length) return '';
    return '<nav class="wq-social" aria-label="' + esc(t.social) + '">' + links.map(function (x) {
      return '<a class="wq-btn wq-soft wq-soc" data-tap="social" data-social="' + x[0] + '" href="' + esc(withLang(x[1], langOf(ctx))) + '">' + ICON[x[0]] + '<span>' + esc(t[x[0]]) + '</span></a>';
    }).join('') + '</nav>';
  }
  // The add-to-home-screen card's slot (web_quiz_install_prompt, the hub's play.install): under the Next tile (the trail
  // goes between them) and above My class, never above Next; hub-play.js fills it once the browser offers the install.
  function instHtml(B) { return B.play && B.play.install && !B.practice ? '<div id="wqp-inst" class="wq-inst"></div>' : ''; }
  // The one-button look (the bot's `one_button`, web_quiz_one_button): the hold says what it is ("Hold for grown-ups"),
  // a ring around the lock fills over the 2 s, the words stay above the fill, and a short tap says "Keep holding".
  var LOCK = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M7 10V8a5 5 0 0 1 10 0v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V8a3 3 0 0 0-6 0z"/></svg>';
  function lookOn() {
    try { return document.documentElement.classList.contains('wq-1b'); } catch (e) { return false; }
  }
  function grownHtml(ctx, B) {
    var t = C(ctx);
    // the hold whenever the page has the look (a boot that said on keeps it when a later answer's cache went stale)
    if ((B && B.one_button === true) || lookOn()) {
      return '<footer class="wq-grown"><button class="wq-btn wq-btn--hold" type="button" data-tap="grownups" aria-label="' + esc(t.grownTap) + '">' +
        '<span class="wq-gring" data-hold-ring aria-hidden="true"><svg viewBox="0 0 36 36" width="36" height="36"><circle class="wq-gtrack" cx="18" cy="18" r="16"/><circle class="wq-garc" cx="18" cy="18" r="16" pathLength="100"/></svg>' + LOCK + '</span>' +
        '<span class="wq-glab" data-hold-label>' + esc(t.grownTap) + '</span></button>' +
        '<p class="wq-ghint" data-hold-hint role="status" hidden>' + esc(t.grownKeep) + '</p></footer>';
    }
    return '<footer class="wq-grown"><button class="wq-gbtn" type="button" data-tap="grownups" aria-label="' + esc(t.grown + ' — ' + t.grownHold) + '"><i class="wq-gfill"></i>' + esc(t.grown) + '</button></footer>';
  }
  function html(B, ctx) {
    return '<section class="wq-screen wq-home" data-screen="home" data-m="H3">' + stripHtml(B, ctx) + headHtml(B, ctx) + rememberHtml(B, ctx) + friendsHtml(B, ctx) + nextHtml(nextOf(B, ctx), ctx) + instHtml(B) + socialHtml(B, ctx) + grownHtml(ctx, B) + '</section>' + barHtml(ctx, null);
  }
  /* The child's first open, "Jugnu says hello" (web_quiz_child_welcome, the boot's `welcome`): wq-welcome.js, asked for
   * after the home paints and shown over it (WQW.start). Absent `welcome`: nothing is asked for, the home is today's. */
  function welcomeIn(root, B, ctx, again) {
    var run = function () { if (window.WQW && root.getAttribute('data-m') === 'H3') window.WQW[again ? 'replay' : 'start'](root, B, ctx, { muted: muted }); };
    if (window.WQW) return run();
    loadOnce('wq-welcome', run);
  }
  // a Next tap before the welcome is up (the fast home can be tapped first): done, on this phone and on the server, so
  // the welcome never comes late over the page the child already chose
  function welcomeTap(B, ctx) {
    if (window.WQW && window.WQW.up()) return;
    var k = 'wq.welcome.' + B.kid;
    try { var x = JSON.parse(localStorage.getItem(k) || 'null'); if (x && x.v === B.welcome.v && x.s) return; } catch (e) {}
    try { localStorage.setItem(k, JSON.stringify({ s: 'done', v: B.welcome.v })); } catch (e) {}
    try { fetch('/api/wq/welcome', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ hub: ctx.token, kid: B.kid, outcome: 'done' }), keepalive: true, credentials: 'same-origin' }).catch(function () {}); } catch (e) {}
  }
  /* The first home after a child joins on their own (the boot's `remember`, which the bot sends once, to the phone that
   * joined): ONE line under the greeting, "Jugnu will remember you on this phone.", with ONE small Undo, for `s` (20)
   * seconds from its first paint; then it fades and this page never draws it again. Undo asks the existing
   * POST /api/wq/bind/undo {from:'join'}: the bot erases that phone's binding (the child stays) and answers the
   * "who are you?" page. Absent `remember`: nothing here, the home is today's. */
  var rem = { until: 0, gone: false, timer: null, busy: false };
  /* A friend joined from this child's shared card (the boot's `friends_joined: {n}`, web_quiz_share_joined): ONE line
   * with the "Guide" stamp, once per new count on this phone. The count is today's, so the count seen is kept per child
   * and per day on this phone (a new day's first friend shows again); a re-render of the same page keeps it. A count
   * only: never who, never when. Absent: nothing, the home is today's. */
  var fj = {};
  function dayKey() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function friendsHtml(B, ctx) {
    var n = B.friends_joined && typeof B.friends_joined === 'object' ? Math.floor(Number(B.friends_joined.n)) : 0;
    if (!(n > 0) || B.practice) return '';
    var k = 'wq_fj_' + String(B.kid || '') + '_' + dayKey();
    if (fj[k] !== n) {
      var seen = 0;
      try { seen = Number(localStorage.getItem(k)) || 0; } catch (e) { seen = 0; }
      if (n <= seen) return '';
      fj[k] = n;
      try { localStorage.setItem(k, String(n)); } catch (e) { /* shown this page only */ }
    }
    var t = C(ctx);
    return '<p class="wq-friend" data-friends role="status"><span class="wq-fstamp"><svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="13" fill="#FDE68A" stroke="#F59E0B" stroke-width="2"/><path d="M14 6l2.4 5 5.4.6-4 3.7 1.1 5.3L14 18l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z" fill="#F59E0B"/></svg>' +
      esc(t.friendStamp) + '</span><span>' + esc(t.friendJoined) + '</span></p>';
  }
  var GO_RX = /^(https:\/\/[A-Za-z0-9.-]+(:\d+)?)?\/quiz\/go\/[A-Za-z0-9._~-]{4,600}$/;
  function remOn(B) { return Boolean(B.remember) && !B.practice && !rem.gone && (!rem.until || Date.now() < rem.until); }
  function rememberHtml(B, ctx) {
    if (!remOn(B)) return '';
    var t = C(ctx);
    return '<p class="wq-remember" data-remember role="status"><span>' + esc(t.remember) + '</span><button class="wq-remundo" type="button" data-remember-undo>' + esc(t.remUndo) + '</button></p>';
  }
  function remDrop(root) {
    rem.gone = true;
    var x = root.querySelector('[data-remember]');
    if (x && x.parentNode) x.parentNode.removeChild(x);
  }
  function remember(root, B, ctx) {
    var line = root.querySelector('[data-remember]');
    if (!line) return;
    var s = Math.max(1, Math.min(60, Number(B.remember && B.remember.s) || 20));
    if (!rem.until) rem.until = Date.now() + s * 1000;
    if (!rem.timer) {
      rem.timer = setTimeout(function () {
        rem.gone = true;
        var x = root.querySelector('[data-remember]');
        if (!x) return;
        x.classList.add('wq-remgone');
        setTimeout(function () { if (x.parentNode) x.parentNode.removeChild(x); }, 600);
      }, Math.max(0, rem.until - Date.now()));
    }
    var u = line.querySelector('[data-remember-undo]');
    if (!u) return;
    u.addEventListener('click', function () {
      if (rem.busy) return;
      rem.busy = true; u.disabled = true;
      fetch('/api/wq/bind/undo', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ from: 'join', lang: langOf(ctx) }) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j || !j.ok) throw new Error('undo');
          if (typeof j.next === 'string' && GO_RX.test(j.next)) { rem.gone = true; location.replace(j.next); return; }
          remDrop(root);
        })
        .catch(function () { rem.busy = false; u.disabled = false; });
    });
  }
  function rowHtml(href, title, sub, tag, kind, art) {
    var pic = art ? '<img class="wq-rart" src="' + esc(art) + '" alt="" width="48" height="48" loading="lazy" decoding="async">' : '';
    return '<li><a class="wq-row' + (pic ? ' wq-rowart' : '') + '" data-tap="row" data-kind="' + esc(kind) + '" href="' + esc(href) + '">' + pic + '<span class="wq-rtx"><b><bdi>' + esc(title) + '</bdi></b>' + (sub ? '<small><bdi>' + esc(sub) + '</bdi></small>' : '') + '</span>' + (tag ? '<i class="wq-new">' + esc(tag) + '</i>' : '') + '</a></li>';
  }
  function door(B, ctx, name) {
    var t = C(ctx); var d = doorsOf(B); var rows = '';
    if (name === 'stories') {
      // the storybooks' door: the shelf only (a passage opens from the Games door and the Next tile)
      rows = d.stories.filter(function (s) { return s.kind === 'shelf'; }).map(function () { return '<li class="wq-stories-shelf" data-stories-shelf="1"></li>'; }).join('');
    } else if (name === 'games') {
      rows = d.games.map(function (g) {
        if (g.kind === 'numbers') return rowHtml(chHref(B, ctx), t.numbers, '', '', 'numbers');
        return rowHtml(qLang(B, ctx, quizHref(g.code, g.k, g.done)), topicOf(g, ctx) || (g.done ? t.playQuiz : t.nextQuiz), g.done ? t.again : t.fromTeacher, '', g.done ? 'again' : 'quiz', g.art);
      }).join('');
    } else if (name === 'videos' && d.videos) {
      rows = rowHtml(withHome(B, d.videos.href), t.openVideos, '', '', 'videos');
    }
    // Exactly one primary per screen: the door's first row, else (an empty door) the Home button.
    if (rows) rows = rows.replace(/<a class="wq-row( wq-rowart)?"/, function (m) { return m + ' data-primary'; });
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
    markFailed = Boolean(B.list_states);
    if (B.practice) ctx = practiceCtx(ctx);
    if (B.offline_guard === true) offGuard(ctx);
    hashOnce(root, B, ctx);
    // The door screens (wq-doors.js, fetched after the home paints): theirs once loaded; until then the rows below.
    if (window.WQDOORS && window.WQDOORS.owns(name)) return window.WQDOORS.mount(root, B, ctx, name);
    var html0 = DOORS.indexOf(name) >= 0 ? door(B, ctx, name) : html(B, ctx);
    root.innerHTML = html0;
    root.setAttribute('data-m', DOORS.indexOf(name) >= 0 ? 'H3-' + name : 'H3');
    if (B.remember) remember(root, B, ctx);
    var ev = ctx.ev || function () {};
    var nx = DOORS.indexOf(name) < 0 ? nextOf(B, ctx) : null;
    var shownAt = null;
    // Every home render is a home_view (the funnel's denominator); the tile it shows is a next_shown beside it.
    if (nx) {
      ev('home_view', { src: arrivedFrom(B) });
      shownAt = Date.now();
      ev('next_shown', rankOf(B, { ctx: 'home', kind: nx.kind, pos: 0, source: nx.src === 'next' ? (/^(pinned|ranked|fallback)$/.test(B.next.source) ? B.next.source : 'ranked') : 'fallback' }));
      if (!B.practice) prefetchOnce(nx.href, ctx);
    }
    each(root, '[data-tap]', function (el) {
      el.addEventListener('click', function (e) {
        var tap = el.getAttribute('data-tap');
        juice('tap');
        var href = el.getAttribute('href') || '';
        // The coach's preview opens nothing that needs a child: one line says where the class opens it (a preview that
        // plays, the boot's practice_play, opens it: the server answers the preview read-only for its grade).
        if (B.practice && !B.practice_play && (tap === 'next' || tap === 'row') && href.charAt(0) !== '#') { e.preventDefault(); note(root, ctx); return; }
        if (tap === 'next' && B.welcome && !B.welcome.replay) welcomeTap(B, ctx);
        if (tap === 'next') { ev('next_tap', rankOf(B, msToTap({ ctx: 'home', pos: 0, kind: el.getAttribute('data-kind') }, shownAt))); if (href.charAt(0) === '#') return; e.preventDefault(); go(ctx, href, 'next'); }
        else if (tap === 'door') { ev('door_tap', { door: el.getAttribute('data-door'), pos: DOORS.indexOf(el.getAttribute('data-door')) + 1 }); }
        else if (tap === 'row') { e.preventDefault(); go(ctx, el.getAttribute('href'), 'door_' + el.getAttribute('data-kind')); }
        else if (tap === 'sound') { setMuted(!muted()); mount(root, B, ctx); }
        else if (tap === 'who') { (ctx.ev || function () {})('who_open', { kids: (B.kids || []).length, jn: jnOf(B) ? 1 : 0 }); whoSheet(root, B, ctx); }
        else if (tap === 'prback' && !B.practice_back) { try { history.back(); } catch (x) {} }
        else if (tap === 'jar') { e.preventDefault(); book(root, B, ctx); }
        // Tap Jugnu, hear the giggle (the sound kit's sprite; nothing without it).
        else if (tap === 'jugnu') {
          try { if (window.WQJ) { if (window.WQJ.giggle) window.WQJ.giggle(); if (window.WQJ.pop) window.WQJ.pop(el); } } catch (x) {}
          // a child who has had the welcome: Jugnu shows the Next stop's step again (DESIGN §5)
          if (B.welcome && B.welcome.replay && !B.practice) welcomeIn(root, B, ctx, true);
        }
      });
    });
    if (B.welcome && !B.welcome.replay && !B.practice && DOORS.indexOf(name) < 0) welcomeIn(root, B, ctx);
    var g = root.querySelector('[data-tap="grownups"]');
    if (g) hold(g, function () { grownups(root, B, ctx); }, B.one_button === true ? root.querySelector('[data-hold-hint]') : null);
    if (root.querySelector('#wqp-inst')) {
      var inst = function () { if (window.WQPLAY && typeof window.WQPLAY.install === 'function') window.WQPLAY.install(B, ev, root, { h3: true }); };
      if (window.WQPLAY) inst(); else loadOnce('hub-play', function () { if (root.querySelector('#wqp-inst')) inst(); }, null, true);
    }
    // The stories reader (wq-stories.js, web_quiz_stories: the boot's `stories.on`) fills [data-shelf] and owns #story/<id>.
    var sh = root.querySelector('[data-stories-shelf]');
    if (sh && window.WQSTORIES && typeof window.WQSTORIES.shelf === 'function') { try { window.WQSTORIES.shelf(sh, { token: ctx.token, kid: B.kid, lang: langOf(ctx), ev: ev }); } catch (e) {} }
    else if (B.stories && B.stories.on && !window.WQSTORIES && (sh || /^story\//.test(name))) loadOnce('wq-stories');
    if (name === 'book' && B.head && B.head.jar) book(root, B, ctx);
    // the doors ask for their rows as they load (web_quiz_list_states), so a door tap paints its whole list at once
    if (!window.WQDOORS) loadOnce('wq-doors', function () { if (window.WQDOORS && typeof window.WQDOORS.warm === 'function') window.WQDOORS.warm(B, ctx); var n = String(location.hash || '').replace(/^#/, ''); if (window.WQDOORS && window.WQDOORS.owns(n)) mount(root, B, ctx); });
    try { window.scrollTo(0, 0); } catch (e) {}
  }
  // An empty hash (the reader's way home) reads as '' — home again; a door or #watch/<video id> draws its screen;
  // #story/<id> set in the page (the Next tile, a resume tile) fetches the reader, which routes the hash on load.
  function hashOnce(root, B, ctx) {
    if (wired) return;
    wired = true;
    try { window.addEventListener('hashchange', function () {
      if (/^#story\//.test(location.hash || '')) { if (B.stories && B.stories.on && !window.WQSTORIES) loadOnce('wq-stories'); return; }
      if (/^(#(stories|games|videos|watch\/[0-9a-f-]{36})?)?$/i.test(location.hash || '')) mount(root, B, ctx);
    }); } catch (e) {}
  }
  // The arrival (?from= on the home's URL) as EVENTS_V3's home_view.src: door | home | link | quiz | who.
  var FROM = { quiz: 'quiz', door: 'door', link: 'link', class_link: 'link', card: 'link', wa: 'link', who: 'who' };
  function arrivedFrom(B) {
    if (B.src && /^(door|home|link|quiz|who)$/.test(B.src)) return B.src;
    var m = /[?&]from=([a-z_]+)/.exec((typeof location !== 'undefined' && location.search) || '');
    return (m && FROM[m[1]]) || 'home';
  }
  // next_tap's ms_to_tap (EVENTS_V3 §2): whole ms since its next_shown on this render, never invented
  function msToTap(e, at) { if (at != null) e.ms_to_tap = Math.max(0, Math.round(Date.now() - at)); return e; }
  // The ranking's own fields ride on next_shown / next_tap when the server's `next` carried them; never invented.
  function rankOf(B, e) {
    var n = B.next;
    if (n && n.href) ['arm', 'score_v', 'offer', 'rank_src'].forEach(function (k) { if (n[k] != null) e[k] = n[k]; });
    return e;
  }
  // The coach's preview: every event says it is one (kid:null, practice:1); nothing is a child's.
  function practiceCtx(ctx) {
    if (ctx.practiceWrapped) return ctx;
    var ev = ctx.ev || function () {};
    var out = {}; for (var k in ctx) out[k] = ctx[k];
    out.ev = function (n, p) { var e = {}; for (var j in (p || {})) e[j] = p[j]; e.kid = null; e.practice = 1; ev(n, e); };
    out.practiceWrapped = true;
    return out;
  }
  function note(root, ctx) {
    var t = C(ctx);
    var old = root.querySelector && root.querySelector('.wq-prnote'); if (old && old.parentNode) old.parentNode.removeChild(old);
    var box = document.createElement('div');
    box.className = 'wq-gsheet wq-prnote'; box.setAttribute('role', 'status');
    box.innerHTML = '<b>' + esc(t.prNote) + '</b><button class="wq-btn wq-ghost" type="button" data-tap="close">' + esc(t.grownClose) + '</button>';
    root.appendChild(box);
    var c = box.querySelector('[data-tap="close"]');
    if (c) c.addEventListener('click', function () { if (box.parentNode) box.parentNode.removeChild(box); });
  }
  /* The Next tile is known at boot, so its activity's first JSON is fetched while the phone is idle: one <link
   * rel=prefetch>, the tile only (pos 0), a same-site challenge link only (a quiz page carries its quiz in the page),
   * never on Save-Data or a 2g link. The challenge page asks /api/wq/ch/<token>?lang=<l>&kid=<kid> first. */
  var prefetched = false;
  function prefetchOnce(href, ctx) {
    if (prefetched || !href) return;
    var m = /^\/c\/([^/?#]+)\?([^#]*)/.exec(href);
    if (!m) return;
    var q = {}; m[2].split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) q[kv.slice(0, i)] = kv.slice(i + 1); });
    var url = '/api/wq/ch/' + m[1] + '?lang=' + (q.lang === 'ur' || q.lang === 'en' ? q.lang : langOf(ctx)) + (q.kid ? '&kid=' + q.kid : '');
    prefetched = true;
    var run = function () {
      try {
        if (slowNet()) return;
        var l = document.createElement('link'); l.rel = 'prefetch'; l.href = url; document.head.appendChild(l);
      } catch (e) {}
    };
    try { if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 4000 }); else setTimeout(run, 1500); } catch (e) {}
  }
  function go(ctx, href, what) { if (!href) return; if (ctx.go) ctx.go(href, what); else location.assign(href); }
  function slowNet() { var c = typeof navigator !== 'undefined' && navigator.connection; return !!(c && (c.saveData || /(^|-)2g$/.test(String(c.effectiveType || '')))); }
  // A tap while offline (the hub's offline_guard): every page the home and its doors open goes through ctx.go. Offline:
  // stay, the offline line + Try again; `online` or Try again opens it once. A slow line HEADs it first (2 s, then opens).
  // The line check asks a small static file of ours (never the page: a page's address runs its handler on the server).
  function probeUrl() {
    try { var l = document.querySelector('link[href*="/wq/wq.css"]'); var h = l && l.getAttribute('href'); if (h) return h; } catch (e) {}
    return '/wq/manifest.webmanifest';
  }
  var held = null, ogCtx = null;
  function offGuard(ctx) {
    if (ctx.og) return;
    var go0 = ctx.go;
    ctx.og = 1;
    ctx.go = function (href, what) { offCheck(ctx, function () { if (go0) go0(href, what); else location.assign(href); }); };
    offLinks(ctx);
  }
  function offCheck(ctx, nav) {
    if (held) { held.nav = nav; return; }
    if (navigator.onLine === false) return offHold(ctx, nav);
    if (!slowNet() || typeof fetch !== 'function') return nav();
    held = { nav: nav };
    var t = setTimeout(function () { end(1); }, 2000);
    var end = function (ok) { if (!held || held.box) return; clearTimeout(t); var n = held.nav; held = null; if (ok) n(); else offHold(ctx, n); };
    fetch(probeUrl(), { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' }).then(function () { end(1); }, function () { end(0); });
  }
  // The "Who is playing?" sheet's rows, the jar book's story links and My class / My school are plain links drawn after the home's wiring:
  // one capture listener (once per page) sends them through the same check; online they open as a plain link does.
  function offLinks(ctx) {
    var first = !ogCtx;
    ogCtx = ctx;
    if (!first) return;
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      var tap = a ? a.getAttribute('data-tap') || '' : '';
      if (!a || !(a.id === 'wq-bk-go' || /(^|\s)wq-bk-st(\s|$)/.test(a.className || '') || (/^(pick|join)$/.test(tap) && a.closest('.wq-who')) || (tap === 'social' && a.closest('.wq-social')))) return;
      var href = a.getAttribute('href') || '';
      if (!href || href.charAt(0) === '#') return;
      e.preventDefault();
      offCheck(ogCtx, function () { location.assign(href); });
    }, true);
  }
  function offHold(ctx, nav) {
    var t = C(ctx), box = document.createElement('div');
    box.className = 'wq-off';
    box.setAttribute('role', 'status');
    box.setAttribute('style', 'position:fixed;left:16px;right:16px;bottom:16px;z-index:50;background:#fff;border-radius:16px;padding:16px;box-shadow:0 4px 24px rgba(0,0,0,.2);text-align:center');
    box.innerHTML = '<p dir="auto">' + esc(t.off) + '</p><button class="wq-btn wq-go" type="button">' + esc(t.offAgain) + '</button>';
    held = { nav: nav, box: box };
    var fire = function () {
      if (!held || navigator.onLine === false) return;
      var n = held.nav;
      held = null;
      window.removeEventListener('online', fire);
      if (box.parentNode) box.parentNode.removeChild(box);
      n();
    };
    box.querySelector('button').addEventListener('click', fire);
    window.addEventListener('online', fire);
    document.body.appendChild(box);
  }
  function each(root, sel, fn) { Array.prototype.forEach.call(root.querySelectorAll(sel), fn); }
  // The grown-ups corner opens only on a ~2 s press-and-hold (IA §2; never a tap, never arithmetic).
  // With `hint` (the one-button look): a press let go early shows "Keep holding" for 1.5 s, and the open is felt (a short
  // buzz where the phone has one) and heard (the sound kit's tap, muted with the rest).
  function hold(el, done, hint) {
    var timer = null; var hintT = null;
    // One finger fires pointerdown AND touchstart on Android: the second start is ignored, so a tap never leaves a timer.
    var start = function (e) { if (e && e.preventDefault) e.preventDefault(); if (timer) return; if (hint) { hint.hidden = true; clearTimeout(hintT); } el.classList.add('held'); timer = setTimeout(function () { timer = null; el.classList.remove('held'); if (hint) { try { if (navigator.vibrate) navigator.vibrate(30); } catch (x) {} juice('tap'); } done(); }, 2000); };
    var stop = function () { if (timer) { clearTimeout(timer); timer = null; if (hint) { hint.hidden = false; clearTimeout(hintT); hintT = setTimeout(function () { hint.hidden = true; }, 1500); } } el.classList.remove('held'); };
    ['pointerdown', 'touchstart'].forEach(function (n) { el.addEventListener(n, start); });
    ['pointerup', 'pointerleave', 'pointercancel', 'touchend', 'touchcancel'].forEach(function (n) { el.addEventListener(n, stop); });
  }
  // The sheet's Grade row (the server's `grownups.grade_on`, web_quiz_grade_change): a label and a value button that
  // opens the Stories grade chips 1-5; `gr` = {now, cls} once the bot answered (until then a skeleton), `pick` = the chips
  // are open, `said` = the line under them (saved / tomorrow).
  function gradeRow(t, l, gr, pick, said) {
    if (!gr) return '<span class="wq-glabel">' + esc(t.grade) + '</span><span class="wq-gskel" aria-hidden="true"></span>';
    var chips = '';
    if (pick) [1, 2, 3, 4, 5].forEach(function (n) { chips += '<button class="wqs-chip" data-tap="g" data-arg="' + n + '" aria-pressed="' + (n === gr.now) + '">' + (l === 'ur' ? urDigits(n) : n) + '</button>'; });
    return '<span class="wq-glabel">' + esc(t.grade) + '</span>' +
      '<button class="wq-btn wq-btn--secondary" type="button" data-tap="grade" aria-expanded="' + !!pick + '">' + esc(gr.now ? t.gradeN(gr.now) : t.grade) + ' ▾</button>' +
      (pick ? '<div class="wqs-pick">' + chips + '</div>' : '') +
      (gr.cls && gr.cls !== gr.now ? '<p class="wq-gcls">' + esc(t.inClass(gr.cls)) + '</p>' : '') +
      (said ? '<p class="wq-gsaid" role="status">' + esc(said) + '</p>' : '');
  }
  // Behind the hold: the language and, when the server names them, the child's grade, the teacher switch and the phone link's STOP.
  function grownups(root, B, ctx) {
    var t = C(ctx); var other = langOf(ctx) === 'ur' ? 'en' : 'ur';
    var g = B.grownups || {};
    var box = document.createElement('div');
    box.className = 'wq-gsheet'; box.setAttribute('role', 'dialog'); box.setAttribute('data-screen', 'grownups');
    box.innerHTML = '<b>' + esc(t.grown) + '</b>' +
      '<a class="wq-btn wq-go" data-primary data-tap="lang" href="' + esc(withLang('/h/' + encodeURIComponent(ctx.token || '') + '?kid=' + encodeURIComponent(B.kid || ''), other) + '&keep=1') + '">' + esc(t.grownLang) + '</a>' +
      (g.grade_on === true ? '<div class="wq-ggrade" data-grade>' + gradeRow(t, langOf(ctx), null) + '</div>' : '') +
      (g.teacher_href ? '<a class="wq-btn wq-ghost" data-tap="teacher" href="' + esc(g.teacher_href) + '">' + esc(g.teacher_label || '') + '</a>' : '') +
      (g.stop_href ? '<a class="wq-btn wq-ghost" data-tap="stop" href="' + esc(g.stop_href) + '">' + esc(g.stop_label || '') + '</a>' : '') +
      // the phone that made this child's link (the boot's `forget_phone`, the link's whole life): one tap forgets it
      (B.forget_phone && !B.practice ? '<button class="wq-btn wq-ghost" type="button" data-tap="forget">' + esc(t.forget) + '</button>' : '') +
      // web_quiz_child_welcome (the boot's `welcome`): a grown-up can have Jugnu say hello to this child again
      (B.welcome && !B.practice ? '<button class="wq-btn wq-ghost" type="button" data-tap="hello">' + esc(t.helloAgain) + '</button>' : '') +
      '<button class="wq-btn wq-ghost" type="button" data-tap="close">' + esc(t.grownClose) + '</button>';
    // Keep my place lives here on the v3 home (the card and, back from WhatsApp, its "Saved ✓ … Undo"): the sheet stays
    // in the page until Close, so the Undo lands in it. A phone already kept is told how a grown-up removes it (STOP).
    var KB = window.WQBIND && B.bind && !B.practice ? window.WQBIND : null;
    if (KB && B.bind.offer) {
      var me = (B.kids || []).filter(function (k) { return k.chip === B.kid; })[0] || {};
      var slot = document.createElement('div'); slot.className = 'wq-gbind'; box.appendChild(slot);
      try { KB.card(slot, { hub: B.bind.hub || ctx.token, kid: B.kid, first: me.first || '', lang: langOf(ctx), practice: false, ev: ctx.ev }); } catch (e) {}
    } else if (KB && B.bind.state === 'bound') {
      var w = {}; try { w = (KB.t && KB.t(langOf(ctx))) || {}; } catch (e) { w = {}; }
      if (w.noticeStopPhoneOnly) box.innerHTML += '<p class="wq-gstop">' + esc(w.noticeStopPhoneOnly) + '</p>';
    }
    root.appendChild(box);
    // The home behind the open sheet cannot be reached (no second primary for a screen reader or the keyboard).
    var behind = [];
    Array.prototype.forEach.call(root.children || [], function (n) {
      if (n === box || !n.setAttribute) return;
      n.setAttribute('inert', ''); n.setAttribute('aria-hidden', 'true'); behind.push(n);
    });
    var hl = box.querySelector('[data-tap="hello"]');
    if (hl) hl.addEventListener('click', function () {
      if (hl.disabled) return;
      hl.disabled = true;
      fetch('/api/wq/welcome', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ hub: ctx.token, kid: B.kid, outcome: 'reset' }) })
        .then(function (r) { if (!r || !r.ok) throw new Error('reset'); try { localStorage.removeItem('wq.welcome.' + B.kid); } catch (x) {} location.reload(); })
        .catch(function () { hl.disabled = false; });
    });
    var fg = box.querySelector('[data-tap="forget"]');
    if (fg) fg.addEventListener('click', function () {
      if (fg.disabled) return;
      fg.disabled = true;
      fetch('/api/wq/bind/undo', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ from: 'home', kid: B.kid }) })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (!j || !j.ok) throw new Error('forget'); location.reload(); })
        .catch(function () { fg.disabled = false; });
    });
    // The grade is asked when the sheet opens (GET /api/wq/hub/grade; a skeleton until it answers; no answer: no row).
    // A chip tap saves it for good (POST); the saved line shows for 2 s, and Close redraws Home.
    var saved = false;
    var row = g.grade_on === true ? box.querySelector('[data-grade]') : null;
    if (row) {
      var gr = null; var pick = false; var said = ''; var saidT = null; var busy = false;
      var draw = function () { row.innerHTML = gradeRow(t, langOf(ctx), gr, pick, said); };
      var say = function (line, ms) { said = line; clearTimeout(saidT); draw(); if (ms) saidT = setTimeout(function () { said = ''; draw(); }, ms); };
      draw();
      fetch('/api/wq/hub/grade?hub=' + encodeURIComponent(ctx.token || '') + '&kid=' + encodeURIComponent(B.kid || ''), { headers: { accept: 'application/json' } })
        .then(function (r) { if (r.status !== 200) throw new Error('grade'); return r.json(); })
        .then(function (j) { gr = { now: +(j && j.now) || null, cls: +(j && j.cls) || null }; draw(); })
        .catch(function () { row.innerHTML = ''; row.hidden = true; });
      row.addEventListener('click', function (e) {
        var b = e && e.target && e.target.closest ? e.target.closest('[data-tap]') : null;
        var tap = b && gr ? b.getAttribute('data-tap') : null;
        if (tap === 'grade') { pick = !pick; said = ''; return draw(); }
        var n = tap === 'g' ? +b.getAttribute('data-arg') : 0;
        if (!n || n === gr.now || busy) return;
        busy = true;
        fetch('/api/wq/hub/grade', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ hub: ctx.token, kid: B.kid, grade: n }) })
          .then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); })
          .then(function (a) {
            busy = false;
            if (a.s === 429) { pick = false; return say(t.gradeLater); }
            if (!a.j || !a.j.ok) throw new Error('grade');
            gr.now = n; saved = true; pick = false;
            // a class child: Stories and Videos open at the new grade, class quizzes stay at the class's
            say(gr.cls && gr.cls !== n ? t.gradeSavedCls(n, gr.cls) : t.gradeSaved(n), 2000);
          })
          .catch(function () { busy = false; });
      });
    }
    var c = box.querySelector('[data-tap="close"]');
    if (c) c.addEventListener('click', function () {
      behind.forEach(function (n) { n.removeAttribute('inert'); n.removeAttribute('aria-hidden'); });
      if (box.parentNode) box.parentNode.removeChild(box);
      if (saved) location.reload();
    });
  }
  // The jar opens Jugnu's Book (wq-book.js); Back returns to the home.
  function book(root, B, ctx) {
    var open = function () { if (window.WQBOOK) window.WQBOOK.open({ root: root, token: ctx.token, kid: B.kid, lang: langOf(ctx), v3: true, ev: ctx.ev, back: function () { mount(root, B, ctx); } }); };
    if (window.WQBOOK) return open();
    loadOnce('wq-book', open, 'wq-bk-js');
  }
  // /wq/<name>.css + .js at hub.js's own ?v=, at most once per page.
  // `list_states`: a script that failed is marked (data-failed), so a screen that comes after the error can tell
  var asked = {};
  var markFailed = false;
  function loadOnce(name, onload, id, noCss) {
    if (asked[name]) return;
    asked[name] = true;
    try {
      var me = document.querySelector('script[src*="/wq/hub.js"]');
      var v = me && /[?&]v=([A-Za-z0-9]+)/.exec(me.getAttribute('src') || '');
      var q = v ? '?v=' + v[1] : '';
      if (!noCss) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/wq/' + name + '.css' + q; document.head.appendChild(l); }
      var s = document.createElement('script'); if (id) s.id = id; s.src = '/wq/' + name + '.js' + q; if (onload) s.addEventListener('load', onload);
      if (markFailed) s.addEventListener('error', function () { s.setAttribute('data-failed', '1'); });
      document.head.appendChild(s);
    } catch (e) {}
  }

  // practiceNote: the door screens (wq-doors.js) show the same one line on a coach's preview tap.
  window.WQHOME = { mount: mount, html: html, door: door, nextOf: nextOf, COPY: COPY, DOORS: DOORS, practiceNote: note, who: who, bar: barHtml, loadOnce: loadOnce };
})();
