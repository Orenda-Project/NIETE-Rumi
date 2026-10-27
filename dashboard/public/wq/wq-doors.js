/* The v3 child home's three door screens (app_settings web_quiz_home_v3; loaded by wq-home.js after the home paints, so a
 * door tap is already warm and the home's own first load never carries it): Stories, Games, Videos, and the video player
 * for a child with no class (#watch/<lesson id>). The home owns the shell (header, Next tile, bottom bar, the grown-ups
 * corner); this file draws what is behind each door. Every screen: Home top-left, exactly one data-primary, a speaker
 * on every row, the bottom bar. Nothing here counts anything about the child.
 *   WQDOORS.owns(name)                 true for 'stories' | 'games' | 'videos' | 'watch/<id>'
 *   WQDOORS.html(B, ctx, name, data)   a door's markup (pure, for tests); data = the fetched rows, else the boot's
 *   WQDOORS.mount(root, B, ctx, name)  draw it, wire it, fetch the full rows and redraw
 *   WQDOORS.watchHtml(w, ctx, next, shelf, clean)    the watch screen's markup (pure)
 * Data: the boot's `doors` (instant), then GET /api/wq/doors/h/<token>?d=stories|games (every story that opens,
 * shuffled per child per day, with `pos`; the number games), and for Videos the library's own /api/wq/lib/h/<token>.
 * A video: POST /api/wq/videos/start {hub, kid, vid} -> {code, k} (a class: /q/<code>, video then quiz) or {watch}
 * (no class: played here, the quiz offered after as the Next tile when the server says `after`). A watched video ends
 * on the finish card (window.WQFC, only when the boot says `card_v3`): the card's block draws the one Next tile.
 * A teacher's class preview (`B.practice`, no child): the boot's own rows only, nothing fetched, and a row tap shows the
 * home's one line (WQHOME.practiceNote) instead of opening anything — unless the boot says `practice_play` (app_settings
 * web_quiz_practice_play): then the preview PLAYS, every door fetching and opening exactly what a child's does (the
 * server answers the preview token read-only for its grade). lookOnly(B) is the one test for the old preview.
 * Every list's three states (the boot's `list_states`, app_settings web_quiz_list_states): loading is a skeleton of the
 * list, empty is said only from rows that came back empty, a failed read is a retry. WQDOORS.warm(B, ctx) asks for the
 * Games and Stories rows when this file loads (the home calls it), so a door tap paints its whole list at once. */
(function () {
  'use strict';
  var COPY = {
    en: {
      weekStory: 'This week\'s story', toRead: 'Stories to read', toListen: 'Stories to listen to', books: 'Storybooks',
      listen: 'Listen to a story', story: 'A story with Jugnu', readAlong: 'Read along', listenW: 'Listen', newTag: 'New', doneTag: 'Done',
      numbers: 'Number games', fromTeacher: 'From your teacher', lastQ: 'Your last quiz', recT: 'Try these next', again: 'Play again', quiz: 'Your teacher\'s quiz',
      warm: 'Number warm-up', missing: 'Missing number', bigger: 'Which is bigger?', g1: 'Numbers with Jugnu',
      pick: 'Pick a subject', back: 'Back', opening: 'Opening the video…', none: 'No videos here yet.',
      oops: 'This did not load.', shelfOops: 'The stories could not open yet.', retry: 'Try again', watchNext: 'Watch next', quizAfter: 'Play the quiz',
      moreVideos: 'More videos', play: 'Play the video', say: 'Listen', prVideos: 'Children watch the videos from their own link',
      seeAll: 'See all', quizBtn: 'Quiz', vquiz: 'Play the quiz',
      storiesNone: 'New stories are on the way. Play a game!', gamesNone: 'Read a story with Jugnu!', toGames: 'Play a game', toStories: 'Read a story',
      mins: function (m) { return m + ' min'; },
      subj: function (s) { return s; },
      grade: function (g) { return g === 'all' ? 'All grades' : g === 'NURSERY' ? 'Nursery' : g === 'KG' ? 'KG' : 'Grade ' + g; },
      gradeChip: function (g) { return g === 'NURSERY' ? 'Nursery' : g === 'KG' ? 'KG' : String(g); },
      grades: 'Grades', allGrades: 'All grades', gradesN: function (s) { return 'Grades ' + s; }, fromLink: 'Your class plays this from your link',
    },
    ur: {
      weekStory: 'اس ہفتے کی کہانی', toRead: 'پڑھنے کی کہانیاں', toListen: 'سننے کی کہانیاں', books: 'کہانیوں کی کتابیں',
      listen: 'کہانی سنیں', story: 'جگنو کے ساتھ کہانی', readAlong: 'جگنو کے ساتھ ساتھ پڑھیں', listenW: 'سنیں', newTag: 'نئی', doneTag: 'مکمل',
      numbers: 'گنتی کے کھیل', fromTeacher: 'ٹیچر کی طرف سے', lastQ: 'آپ کا پچھلا کوئز', recT: 'یہ بھی کریں', again: 'دوبارہ کھیلیں', quiz: 'ٹیچر کا کوئز',
      warm: 'گنتی کا کھیل', missing: 'کون سا عدد غائب ہے؟', bigger: 'کون سا عدد بڑا ہے؟', g1: 'جگنو کے ساتھ گنتی',
      pick: 'ایک مضمون چنیں', back: 'واپس', opening: 'ویڈیو کھل رہی ہے…', none: 'یہاں ابھی کوئی ویڈیو نہیں۔',
      oops: 'اوہو! یہ نہیں کھل سکا۔', shelfOops: 'کہانیاں ابھی نہیں کھل سکیں۔', retry: 'دوبارہ کوشش کریں', watchNext: 'اگلی ویڈیو دیکھیں', quizAfter: 'کوئز کھیلیں',
      moreVideos: 'اور ویڈیوز دیکھیں', play: 'ویڈیو چلائیں', say: 'سنیں', prVideos: 'بچے اپنے لنک سے ویڈیوز دیکھیں گے',
      seeAll: 'سب دیکھیں', quizBtn: 'کوئز', vquiz: 'کوئز کھیلیں',
      storiesNone: 'نئی کہانیاں آ رہی ہیں۔ تب تک کھیل کھیلیں!', gamesNone: 'جگنو کے ساتھ کہانی پڑھیں!', toGames: 'کھیل کھیلیں', toStories: 'کہانی پڑھیں',
      mins: function (m) { return urDigits(m) + ' منٹ'; },
      subj: function (s) { return SUBJ_UR[s] || s; },
      grade: function (g) { return g === 'all' ? 'سب جماعتیں' : g === 'NURSERY' ? 'نرسری' : g === 'KG' ? 'کے جی' : 'جماعت ' + urDigits(g); },
      gradeChip: function (g) { return g === 'NURSERY' ? 'نرسری' : g === 'KG' ? 'کے جی' : urDigits(g); },
      grades: 'جماعتیں', allGrades: 'سب جماعتیں', gradesN: function (s) { return 'جماعت ' + s; }, fromLink: 'آپ کی کلاس یہ آپ کے لنک سے کھیلتی ہے',
    },
  };
  var SUBJ_UR = { English: 'انگریزی', Maths: 'ریاضی', Urdu: 'اردو', Science: 'سائنس', Geography: 'جغرافیہ', 'General Knowledge': 'معلوماتِ عامہ', History: 'تاریخ', 'Islamic Studies': 'اسلامیات', 'Social Studies': 'معاشرتی علوم' };
  var DOORS = ['stories', 'games', 'videos'];
  var PLAY = '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
  var TICK = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var SPK = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M4 9h4l5-4v14l-5-4H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  var BACKI = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M10 5l-7 7 7 7v-4.5h11v-5H10z"/></svg>';
  // the adventure look on this page (<html class="wq-adv">)
  function advOn() { try { return document.documentElement.classList.contains('wq-adv'); } catch (e) { return false; } }
  var HOMEI = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M12 3l9 8h-3v9h-4v-6h-4v6H6v-9H3z"/></svg>';

  function urDigits(n) { return String(n).replace(/[0-9]/g, function (d) { return String.fromCharCode(0x06F0 + Number(d)); }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function langOf(ctx) { return ctx && ctx.lang === 'ur' ? 'ur' : 'en'; }
  // a quiz row's name: a video lesson's Urdu-script name on an Urdu screen (the hub's topic_ur), else its topic
  function topicOf(g, ctx) { return (langOf(ctx) === 'ur' && g.topic_ur) || g.topic; }
  function C(ctx) { return COPY[langOf(ctx)]; }
  function home() { return (typeof window !== 'undefined' && window.WQHOME) || null; }
  function owns(name) { return DOORS.indexOf(name) >= 0 || /^watch\/[0-9a-f-]{36}$/i.test(String(name || '')); }
  // the look-only preview (a teacher's class view with web_quiz_practice_play off); a preview that plays is a child's door
  function lookOnly(B) { return Boolean(B && B.practice && !B.practice_play); }
  function tok(B, ctx) { return (ctx && ctx.token) || B.token || ''; }
  function withLang(h, l) { return typeof window !== 'undefined' && window.WQT && window.WQT.withLang ? window.WQT.withLang(h, l) : h; }
  function withHome(B, h) { return B.nav_home ? h + (h.indexOf('?') >= 0 ? '&' : '?') + 'home=1' : h; }
  function chHref(B, ctx) { return withHome(B, withLang('/c/' + encodeURIComponent(tok(B, ctx)) + '?kid=' + encodeURIComponent(B.kid || ''), langOf(ctx))); }
  // web_quiz_page_lang (the hub's `page_lang: true`): a link to a quiz page names the child's language, so the page's own
  // words follow the child (the edge's ui_lang); off, the link as it was
  function qLang(B, ctx, h) { return B && B.page_lang === true ? h + (h.indexOf('?') >= 0 ? '&' : '?') + 'lang=' + langOf(ctx) : h; }
  function quizHref(code, k, again) { return '/q/' + encodeURIComponent(code) + '?' + (again ? 'again=1&' : '') + 'k=' + encodeURIComponent(k || ''); }
  /* No grade forbids a game or a video (bd-5gyspy.5): a grade is the default selection, with «All grades» and every grade
   * one tap away; the visitor's pick is remembered on this phone per visitor (the chosen child, or the preview). */
  function store(k, v) { try { if (v === undefined) return window.localStorage.getItem(k); window.localStorage.setItem(k, v); } catch (e) {} return null; }
  function selKey(B, what) { return 'wq_sel_' + what + '.' + (B.kid || (B.practice ? 'pr' : '-')); }
  var sels = {};
  function selOf(B, what) { if (!(what in sels)) sels[what] = store(selKey(B, what)) || null; return sels[what]; }
  function setSel(B, what, v) { sels[what] = v || null; store(selKey(B, what), v || ''); }
  // the visitor's own grade on the client: a preview's token grade, else the chosen child's chip grade
  function ownGrade(B) {
    if (B.practice) return B.grade == null ? null : String(B.grade);
    var k = (B.kids || []).filter(function (x) { return x && x.chip === B.kid; })[0];
    return k && k.grade != null ? String(k.grade) : null;
  }
  // a selection as the chips show it: 'all' or a list of grades
  function selList(v) { return v === 'all' ? 'all' : (Array.isArray(v) ? v : String(v || '').split(',')).map(String).filter(Boolean); }
  // Every grade picker (Games, Videos, the Stories shelf) names its selection one way («Grade 3», «Grades 3, 4», «All
  // grades») and ends in the same caret, drawn in CSS (.wq-caret): never ▾ or another symbol glyph, a blank box on
  // Android 9 (design-qa P2, bd-5gyspy.5)
  var CARET = '<i class="wq-caret" aria-hidden="true"></i>';
  function selLabel(ctx, sel) {
    var t = C(ctx);
    if (sel === 'all' || !sel.length) return t.allGrades;
    return sel.length > 1 ? t.gradesN(sel.map(function (g) { return t.gradeChip(g); }).join(langOf(ctx) === 'ur' ? '، ' : ', ')) : t.grade(sel[0]);
  }
  // the Games door's picker, folded as the library's
  var gpOpen = false;
  function gradeMenu(ctx, sel, tap, gs) {
    return '<div class="wq-vgrade"><button class="wq-btn wq-btn--secondary wq-vgl" type="button" data-tap="gpk" aria-expanded="' + gpOpen + '">' + esc(selLabel(ctx, sel)) + CARET + '</button>' +
      (gpOpen ? gradeChips(ctx, sel, tap, gs) : '') + '</div>';
  }
  function gradeChips(ctx, sel, tap, gs) {
    var t = C(ctx);
    var chip = function (x, label, on) { return '<button class="wq-chip' + (on ? ' wq-on' : '') + '" type="button" data-tap="' + tap + '" data-item="' + esc(x) + '" aria-pressed="' + on + '">' + esc(label) + '</button>'; };
    return '<div class="wq-chips wq-schips wq-tall wq-gpick" role="group" aria-label="' + esc(t.grades) + '">' + chip('all', t.allGrades, sel === 'all') +
      gs.map(function (g) { return chip(g, t.gradeChip(g), sel !== 'all' && sel.indexOf(String(g)) >= 0); }).join('') + '</div>';
  }
  // A Story Time passage opens in the room by its id; a LISTEN passage must say so (wq-trail.js storyRoom: ex=listen).
  function storyHref(B, ctx, s) { return chHref(B, ctx) + '&room=story&pid=' + encodeURIComponent(s.id) + (s.kind === 'listen' ? '&ex=listen' : ''); }
  function gameHref(B, ctx, g) { return chHref(B, ctx) + '#' + encodeURIComponent(g.stop || ''); }
  function bootDoors(B) { var d = B.doors || {}; return { stories: d.stories || [], games: d.games || [], videos: d.videos || null, recs: d.recs || [] }; }
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
    var inner = art + '<span class="wq-rtext"><b><bdi' + lat(o.title) + '>' + esc(o.title) + '</bdi></b>' + (o.sub ? '<small>' + (o.mins ? '<span class="wq-nmin">' + esc(o.sub) + '</span>' : '<bdi' + lat(o.sub) + '>' + esc(o.sub) + '</bdi>') + '</small>' : '') + '</span>' + tag;
    var main = o.href ? '<a class="wq-row wq-drow"' + attrs + ' href="' + esc(o.href) + '">' + inner + '</a>' : '<button class="wq-row wq-drow" type="button"' + attrs + '>' + inner + '</button>';
    return '<li class="wq-dli' + (o.done ? ' done' : '') + '">' + main + sayBtn(o.title, o.say, ctx) + '</li>';
  }
  // The head takes the screen's direction (dir="auto" skips a <bdi>, so an Urdu head sat at the left edge).
  function section(title, rows) { return rows ? '<h3 class="wq-dsec"><bdi' + lat(title) + '>' + esc(title) + '</bdi></h3><ul class="wq-rows">' + rows + '</ul>' : ''; }
  // Exactly one primary per screen: the first row there is, else the screen's own fallback button.
  function primaryFirst(h) { return h.replace(/<(a|button) class="wq-row wq-drow"/, '<$1 class="wq-row wq-drow" data-primary'); }
  // `back` (the adventure look's see-all): the head's round button steps back to that tap's screen instead of Home, so the
  // screen has one back control.
  function frame(B, ctx, name, title, body, back) {
    var H = home();
    var bar = H && typeof H.bar === 'function' ? H.bar(ctx, DOORS.indexOf(name) >= 0 ? name : 'videos') : '';
    var t = (H && H.COPY && H.COPY[langOf(ctx)]) || {};
    var lead = back ? '<a class="wq-homebtn wq-backbtn" href="#" data-tap="' + back + '" aria-label="' + esc(C(ctx).back) + '">' + BACKI + '</a>'
      : '<a class="wq-homebtn" href="#" data-home data-tap="home" aria-label="' + esc(t.home || 'Home') + '">' + HOMEI + '</a>';
    return '<section class="wq-screen wq-home wq-droom" data-screen="' + esc(name.split('/')[0]) + '" data-m="H3-' + esc(name.split('/')[0]) + '" lang="' + langOf(ctx) + '" dir="' + (langOf(ctx) === 'ur' ? 'rtl' : 'ltr') + '">' +
      '<div class="wq-dtop">' + lead + '<h2 dir="auto">' + esc(title) + '</h2></div>' +
      body + '</section>' + bar;
  }
  // A list still on its way (`list_states`): row-shaped blocks, never an empty note; `primary` when it is the screen's one.
  // `mod` 'bk': the Stories shelf's shape (covers two by two), so the shelf replaces it without a jump; 'in': rows under
  // a section heading already drawn, so the first grey row sits where the first real row will.
  function skel(n, primary, mod) {
    var r = ''; for (var i = 0; i < n; i++) r += '<i class="wq-skrow"></i>';
    return '<div class="wq-dskel' + (mod ? ' wq-dskel-' + mod : '') + '"' + (primary ? ' data-primary' : '') + ' aria-busy="true">' + r + '</div>';
  }
  function errNote(t) { return '<div class="wq-dempty"><p class="wq-soon">' + esc(t.oops) + '</p><button class="wq-btn wq-go" type="button" data-primary data-tap="retry">' + esc(t.retry) + '</button></div>'; }
  // `mark` (list_states): a true empty says so (data-empty), so a walker can tell it from a list still on its way
  function emptyNote(text, to, label, mark) {
    return '<div class="wq-dempty"' + (mark ? ' data-empty' : '') + '><p class="wq-soon">' + esc(text) + '</p><a class="wq-btn wq-go" data-primary data-tap="door" data-door="' + to + '" href="#' + to + '">' + esc(label) + '</a></div>';
  }

  /* ---------------- Stories ---------------- */
  // The storybooks' door: its content is the shelf (wq-stories.js fills the slot, its first unfinished book the primary).
  // Jugnu's passages open from the Games door and the home's Next tile, never from here.
  function storiesBody(B, ctx, data) {
    var t = C(ctx);
    var shelfOn = data ? Boolean(data.shelf) : bootDoors(B).stories.some(function (s) { return s.kind === 'shelf'; });
    if (!shelfOn) return emptyNote(t.storiesNone, 'games', t.toGames, B.list_states);
    // the screen still has its one primary until the shelf draws its own (then this one steps aside); with `list_states`
    // the slot shows a skeleton and the note waits, hidden, until the shelf has answered (the reader fills the slot)
    var wait = Boolean(B.list_states && B.stories && B.stories.on);
    // (the skeleton is the screen's one primary while it waits; the note's button takes it back only if it shows)
    var note = emptyNote(t.storiesNone, 'games', t.toGames, B.list_states);
    return '<div class="wq-shelfwrap"><h3 class="wq-dsec">' + esc(t.books) + '</h3><div class="wq-shelf" data-stories-shelf="1" data-host="doors">' + (wait ? skel(4, true, 'bk') : '') + '</div></div>' +
      '<div data-shelf-fallback="1"' + (wait ? ' hidden' : '') + '>' + (wait ? note.replace(' data-primary', '') : note) + '</div>';
  }

  /* ---------------- Games ---------------- */
  function gameName(g, t) { return g.stop === 'missing' ? (g.warm ? t.warm : (g.name || t.missing)) : g.stop === 'bigger' ? (g.name || t.bigger) : t.g1; }
  function gamesBody(B, ctx, data) {
    var t = C(ctx);
    // `list_states`: before its rows the door is a skeleton (the boot's one numbers stand-in never shows), and rows that
    // failed are a retry above the teacher's quizzes the boot already has (never the empty note)
    var ls = Boolean(B.list_states && !lookOnly(B));
    // before the rows, what the boot already knows is drawn for real (the teacher's quizzes, the numbers' heading) and
    // only the rows still on their way are grey, so the primary is where it stays when they arrive
    var wait = ls && !data;
    var failed = ls && !wait && Boolean(data.err);
    var boot = bootDoors(B).games;
    var quizzes = boot.filter(function (g) { return g.kind === 'quiz'; });
    var open = quizzes.filter(function (g) { return !g.done; });
    // `list_states`: a quiz the child opened themself (a video's, `from: 'last'`) is not the teacher's: it sits under
    // "Your last quiz", after the games, and takes the primary only when it is the screen's one row
    var last = ls ? open.filter(function (g) { return g.from === 'last'; }) : [];
    if (ls) open = open.filter(function (g) { return g.from !== 'last'; });
    var done = quizzes.filter(function (g) { return g.done; });
    // the hub's "Try these next" (the boot's `doors.recs`): new video quizzes, each opens straight at the questions
    var recs = bootDoors(B).recs;
    var hasNums = boot.some(function (g) { return g.kind === 'numbers'; });
    var all = failed || wait ? [] : data && data.games ? data.games : (boot.some(function (g) { return g.kind === 'numbers'; }) ? [{ kind: 'numbers', stop: '' }] : []);
    // the grades this list is for (the answer's `sel`, else the pick on this phone, else the visitor's own grade, else all)
    var own = ownGrade(B);
    var sel = selList(data && data.sel ? data.sel : selOf(B, 'games') || own || 'all');
    var ownIn = sel === 'all' || !own || sel.indexOf(own) >= 0;
    // another grade's number games (a practice play of that grade, `href` from the server), grouped by grade
    var other = all.filter(function (g) { return g.kind === 'numbers' && g.g && g.href; });
    var nums = all.filter(function (g) { return g.kind === 'numbers' && !(g.g && g.href); });
    // the boot says this child has number games but the door's rows came back without them: the games page's own entry
    // stays (a failed read is the retry above, never a made-up row)
    if (!nums.length && hasNums && !failed && !wait && ownIn) nums = [{ kind: 'numbers', stop: '' }];
    var byG = [];
    other.forEach(function (g) { var last = byG[byG.length - 1]; if (last && last.g === g.g) last.rows.push(g); else byG.push({ g: g.g, rows: [g] }); });
    var otherH = byG.map(function (x) {
      return section(t.grade(String(x.g)), x.rows.map(function (g, i) { return row({ href: g.href, title: gameName(g, t), kind: 'game', item: g.stop, pos: i, say: g.say }, ctx); }).join(''));
    }).join('');
    var chips = lookOnly(B) ? '' : gradeMenu(ctx, sel, 'gsel', ['1', '2', '3', '4', '5']);
    // Jugnu's passages beside the games (the server lists each only when it would open): read along and listen in the
    // story room by id, read aloud on the games page
    var reads = all.filter(function (g) { return (g.kind === 'read' && g.stop && g.name) || ((g.kind === 'passage' || g.kind === 'listen') && g.id); });
    var readRow = function (g, i) {
      if (g.kind === 'read') return row({ href: gameHref(B, ctx, g), title: g.name, kind: 'passage', item: g.stop, pos: i, say: g.say }, ctx);
      return row({ href: storyHref(B, ctx, g), title: g.kind === 'listen' ? t.listenW : t.readAlong, sub: g.title || '', kind: g.kind, item: g.id, pos: i, say: g.say }, ctx);
    };
    // a teacher's own quiz in their «experience as a child» preview (`look`): its name only, it opens nothing and is
    // never the screen's primary
    var quizRow = function (g, i) { return g.look ? row({ title: topicOf(g, ctx) || t.quiz, sub: t.fromLink, kind: 'quiz', pos: i, art: g.art, tap: 'look' }, ctx).replace('class="wq-row wq-drow"', 'class="wq-row wq-drow wq-look"') : row({ href: qLang(B, ctx, quizHref(g.code, g.k, g.done)), title: topicOf(g, ctx) || t.quiz, done: g.done, kind: g.done ? 'again' : 'quiz', pos: i, item: g.code, say: g.say, art: g.art }, ctx); };
    var numsH = !wait ? '' : hasNums ? '<h3 class="wq-dsec"><bdi' + lat(t.numbers) + '>' + esc(t.numbers) + '</bdi></h3>' + skel(2, !open.length, 'in') : skel(3, !open.length);
    var h = section(t.fromTeacher, open.map(quizRow).join('')) + numsH +
      section(t.numbers, nums.map(function (g, i) { return row({ href: g.stop ? gameHref(B, ctx, g) : chHref(B, ctx), title: g.stop ? gameName(g, t) : t.g1, kind: 'game', item: g.stop || 'numbers', pos: i, say: g.say }, ctx); }).join('')) + otherH +
      section(t.story, reads.map(readRow).join('')) +
      section(t.recT, recs.map(function (r, i) { return row({ title: (langOf(ctx) === 'ur' && r.title_ur) || r.title || t.vquiz, sub: r.subject ? t.subj(r.subject) : '', kind: 'rec', pos: i, item: r.vid, art: r.art, tap: 'vquiz' }, ctx); }).join('')) +
      section(t.lastQ, last.map(function (g, i) { return row({ href: qLang(B, ctx, quizHref(g.code, g.k, false)), title: topicOf(g, ctx) || t.lastQ, kind: 'quiz', pos: i, item: g.code, say: g.say, art: g.art }, ctx); }).join('')) +
      section(t.again, done.map(quizRow).join(''));
    if (failed) return chips + errNote(t) + h;
    if (wait) return chips + (open.length ? primaryFirst(h) : h);
    if (!open.length && !reads.length && !nums.length && !other.length && !done.length && !last.length && !recs.length) return chips + emptyNote(t.gamesNone, 'stories', t.toStories, ls);
    return chips + primaryFirst(h);
  }

  /* ---------------- Videos (the library's own data) ---------------- */
  function subjectsBody(ctx, lib, B) {
    var t = C(ctx);
    if (shelfOn(B) && lib && !lib.err && (lib.subjects || []).length) return shelvesBody(ctx, lib);
    if (shelfOn(B) && !lib) return waitShelves();
    if (shelfOn(B) && lib.err) return '<div class="wq-dempty">' + oopsHtml(ctx, '', 0).replace('type="button"', 'type="button" data-primary').replace(/ data-item="" data-pos="0"/, '') + '</div>';
    if (!lib) return B.list_states ? skel(5, true) : '<p class="wq-soon wq-wait" data-primary>' + esc(t.opening) + '</p>';
    if (lib.err) return errNote(t);
    var subs = lib.subjects || [];
    if (!subs.length) return emptyNote(t.none, 'stories', t.toStories, B.list_states);
    return primaryFirst('<p class="wq-dsay">' + esc(t.pick) + '</p><ul class="wq-rows">' + subs.map(function (s, i) {
      return row({ title: t.subj(s.key), kind: 'subject', item: s.key, pos: i, art: s.art, tap: 'subj' }, ctx);
    }).join('') + '</ul>');
  }
  function chaptersBody(ctx, lib, subj, B) {
    var t = C(ctx);
    // the look: the head's round button is the way back (frame's `back`), and the subject's lessons are one grid
    var adv = advOn() && shelfOn(B);
    var back = adv ? '' : '<button class="wq-dback" type="button" data-tap="subjects">' + esc(t.back) + '</button>';
    if (shelfOn(B) && lib && (lib.chapters || []).length) return back + gridBody(ctx, lib, adv);
    if (shelfOn(B) && !lib) return back + '<div class="wq-vgrid" data-primary aria-busy="true">' + SKEL + SKEL + SKEL + SKEL + '</div>';
    if (shelfOn(B) && lib && lib.err) return back + '<div class="wq-dempty">' + oopsHtml(ctx, subj, 0).replace('type="button"', 'type="button" data-primary') + '</div>';
    if (!lib) return back + (B.list_states ? skel(4, true) : '<p class="wq-soon wq-wait" data-primary>' + esc(t.opening) + '</p>');
    if (lib.err) return back + errNote(t);
    var art = lib.art || null; var i = 0;
    var body = (lib.chapters || []).map(function (ch) {
      return section((langOf(ctx) === 'ur' && ch.name_ur) || ch.name, (ch.videos || []).map(function (v) {
        var m = minsOf(v.secs);
        return row({ title: vTitle(v, ctx), sub: m ? t.mins(m) : '', mins: Boolean(m), done: v.done, kind: 'video', item: v.vid, pos: i++, art: art, tap: 'vid' }, ctx);
      }).join(''));
    }).join('');
    return body ? back + primaryFirst(body) : back.replace('type="button"', 'type="button" data-primary') + '<p class="wq-soon">' + esc(t.none) + '</p>';
  }

  /* ---------------- Videos as picture shelves (app_settings web_quiz_video_shelf: the boot's `doors.videos.shelf`) ----
   * Every subject is a row of picture cards (the lesson's own small thumbnail, lazy and sized; placeholder cards while
   * its lessons load), "See all" opens the subject as a grid. A card whose quiz can be played (its class code, or the
   * library's `quiz`: a class, or the watch root set) has a Quiz button that opens straight at the questions. Its rules
   * are in wq-doors.css (new class names only, so the switch-off screens look as today); the buttons are the one button
   * system's (wq-btn + one kind). */
  function shelfOn(B) { return Boolean(B && B.doors && B.doors.videos && B.doors.videos.shelf === true); }
  var EAGER = 3; // the first shelf's cards a 360-390 px screen shows before any scroll
  var SKEL = '<span class="wq-vcard wq-vskel" aria-hidden="true"><span class="wq-vthumb"></span><b></b></span>';
  // The watch screen while its lesson loads: a placeholder player and title, never words.
  var WATCH_WAIT = '<div class="wq-vbox wq-vskel" data-primary aria-busy="true"></div><span class="wq-vskh"></span>';
  // The look's grade picker (as the Stories shelf's): "Grade 3" + the caret opens the library's grades as chips; another grade only
  // browses (view.g, this visit), the child's own grade never changes. Its chips are the league's (wq-schips wq-tall, 48 px).
  // «All grades» first (bd-5gyspy.5); several grades (a teacher's) or all: the answer's `sel` says which are on
  function gradePick(ctx, lib) {
    var t = C(ctx); var gs = lib.grades || [];
    if (!advOn() || !lib.grade || gs.length < 2) return '';
    var open = view.gopen === true;
    var sel = lib.sel ? selList(lib.sel) : [String(lib.grade)];
    var label = selLabel(ctx, sel);
    var on = function (g) { return sel !== 'all' && sel.indexOf(String(g)) >= 0; };
    return '<div class="wq-vgrade"><button class="wq-btn wq-btn--secondary wq-vgl" type="button" data-tap="vgl" aria-expanded="' + open + '">' + esc(label) + CARET + '</button>' +
      (open ? '<div class="wq-chips wq-schips wq-tall wq-vpick" role="group" aria-label="' + esc(t.grades) + '">' +
        '<button class="wq-chip' + (sel === 'all' ? ' wq-on' : '') + '" type="button" data-tap="vg" data-item="all" aria-pressed="' + (sel === 'all') + '">' + esc(t.allGrades) + '</button>' + gs.map(function (x) {
        return '<button class="wq-chip' + (on(x.g) ? ' wq-on' : '') + '" type="button" data-tap="vg" data-item="' + esc(x.g) + '" aria-pressed="' + on(x.g) + '">' + esc(t.gradeChip(x.g)) + '</button>';
      }).join('') + '</div>' : '') + '</div>';
  }
  function shelvesBody(ctx, lib) {
    var t = C(ctx);
    return gradePick(ctx, lib) + (lib.subjects || []).map(function (s, i) {
      return '<section class="wq-vsec"><div class="wq-vshead"><h3 class="wq-dsec"><bdi' + lat(t.subj(s.key)) + '>' + esc(t.subj(s.key)) + '</bdi></h3>' +
        '<button class="wq-btn wq-btn--secondary wq-vsall" type="button"' + (i === 0 ? ' data-primary' : '') + ' data-tap="subj" data-kind="subject" data-item="' + esc(s.key) + '" data-pos="' + i + '">' + esc(t.seeAll) + '</button></div>' +
        '<div class="wq-vrow" data-vshelf="' + esc(s.key) + '" data-fetch="pending">' + SKEL + SKEL + SKEL + '</div></section>';
    }).join('');
  }
  // While the subjects load: two placeholder shelves (a heading bar and a row of cards), never words.
  function waitShelves() {
    var sec = '<section class="wq-vsec"><span class="wq-vskh"></span><div class="wq-vrow">' + SKEL + SKEL + SKEL + '</div></section>';
    return '<div class="wq-vwait" data-primary aria-busy="true">' + sec + sec + '</div>';
  }
  function lessonsOf(lib) { var all = []; ((lib && lib.chapters) || []).forEach(function (c) { (c.videos || []).forEach(function (v) { all.push(v); }); }); return all; }
  function card(v, ctx, quiz, pos, eager) {
    var t = C(ctx); var m = minsOf(v.secs); var src = v.thumb || v.poster;
    var pic = src ? '<img class="wq-vtimg" src="' + esc(src) + '" alt="" width="320" height="180"' + (eager ? '' : ' loading="lazy"') + ' decoding="async"' + (v.thumb && v.poster ? ' data-f="' + esc(v.poster) + '"' : '') + '>' : '<span class="wq-vnone" aria-hidden="true">' + PLAY + '</span>';
    var q = quiz || v.code ? '<button class="wq-btn wq-btn--secondary wq-vq" type="button" data-tap="vquiz" data-kind="quiz" data-item="' + esc(v.vid) + '" data-pos="' + pos + '">' + esc(t.quizBtn) + '</button>' : '';
    return '<div class="wq-vcard"><button class="wq-vtap" type="button" data-tap="vid" data-item="' + esc(v.vid) + '" data-pos="' + pos + '">' +
      '<span class="wq-vthumb">' + pic + (m ? '<span class="wq-vmin">' + esc(t.mins(m)) + '</span>' : '') + (v.done ? '<i class="wq-vdone" role="img" aria-label="' + esc(t.doneTag) + '">' + TICK + '</i>' : '') + '</span>' +
      '<b class="wq-vct"><bdi' + lat(vTitle(v, ctx)) + '>' + esc(vTitle(v, ctx)) + '</bdi></b></button>' + q + '</div>';
  }
  // `eager`: how many of the first pictures load at once (the first shelf's visible row); the rest are lazy.
  function shelfHtml(lib, ctx, eager) { return lessonsOf(lib).map(function (v, i) { return card(v, ctx, lib.quiz === true, i, i < (eager || 0)); }).join(''); }
  // `one` (the look): every lesson of the subject in one two-column grid, its chapter a small line on its card, so a
  // chapter of one lesson never leaves half a row empty.
  function gridBody(ctx, lib, one) {
    var i = 0;
    // under several grades each chapter names its grade (a chapter never runs across two)
    var chName = function (ch) { return ((langOf(ctx) === 'ur' && ch.name_ur) || ch.name) + (ch.grade ? ' (' + C(ctx).grade(ch.grade) + ')' : ''); };
    var h = one ? '<div class="wq-vgrid wq-vgrid--one">' + (lib.chapters || []).map(function (ch) {
      return (ch.videos || []).map(function (v) {
        // a lesson named like its chapter shows the name once (no chapter line on that card)
        var cn = chName(ch) !== vTitle(v, ctx) ? chName(ch) : '';
        return card(v, ctx, lib.quiz === true, i++).replace('<b class="wq-vct">', (cn ? '<small class="wq-vch"><bdi' + lat(cn) + '>' + esc(cn) + '</bdi></small>' : '') + '<b class="wq-vct">');
      }).join('');
    }).join('') + '</div>' : (lib.chapters || []).map(function (ch) {
      var cards = (ch.videos || []).map(function (v) { return card(v, ctx, lib.quiz === true, i++); }).join('');
      return cards ? '<h3 class="wq-dsec"><bdi' + lat((langOf(ctx) === 'ur' && ch.name_ur) || ch.name) + '>' + esc((langOf(ctx) === 'ur' && ch.name_ur) || ch.name) + '</bdi></h3><div class="wq-vgrid">' + cards + '</div>' : '';
    }).join('');
    return h.replace('<button class="wq-vtap" type="button"', '<button class="wq-vtap" type="button" data-primary');
  }

  // a video's Urdu title for an Urdu child when the server sends one (only with web_quiz_videos_ur_titles on)
  function vTitle(v, ctx) { return (langOf(ctx) === 'ur' && v.title_ur) || v.title; }

  /* ---------------- the watch screen (a child with no class) ---------------- */
  // clean (web_quiz_video_clean_start, the boot's video_clean): the player's own controls come with the first play
  // (wireVideo), so at 0:00 the big ▶ is the only play button
  function watchHtml(w, ctx, next, shelf, clean) {
    var t = C(ctx);
    // web_quiz_video_shelf: the quiz is a choice from the first second (the 90 % mark stays Jugnu's invite)
    var q = shelf && w.after ? '<button class="wq-btn wq-btn--secondary wq-vquiz" type="button" data-tap="vquiz" data-item="' + esc(w.vid) + '">' + esc(t.vquiz) + '</button>' : '';
    var nx = next ? '<a class="wq-next wq-vnext" data-tap="after" data-kind="' + esc(next.kind) + '" href="' + esc(next.href || '#videos') + '">' +
      '<span class="wq-ntext"><b>' + esc(next.title) + '</b>' + (next.sub ? '<small><bdi' + lat(next.sub) + '>' + esc(next.sub) + '</bdi></small>' : '') + '</span><span class="wq-ngo" aria-hidden="true">' + PLAY + '</span></a>' : '';
    return '<div class="wq-vbox' + (shelf ? ' wq-vbox--s' : '') + '"><video class="wq-vid" playsinline' + (clean ? '' : ' controls') + ' preload="none" controlslist="nodownload"' + (w.poster ? ' poster="' + esc(w.poster) + '"' : '') + ' src="' + esc(w.url) + '"></video>' +
      '<button class="wq-vplay" type="button" data-primary data-tap="play" data-sound data-trigger="tap" aria-label="' + esc(t.play) + '">' + PLAY + '</button></div>' +
      '<p class="wq-vtitle"><bdi' + lat(vTitle(w, ctx)) + '>' + esc(vTitle(w, ctx) || '') + '</bdi></p>' + q +
      '<div class="wq-after" hidden>' + nx + '</div>';
  }

  // The teacher's class preview: videos open from a child's own link, so the door says so and points at Stories.
  function previewVideosBody(ctx) { return emptyNote(C(ctx).prVideos, 'stories', C(ctx).toStories); }

  /* ---------------- markup entry (pure) ---------------- */
  function html(B, ctx, name, data) {
    var H = home(); var ht = (H && H.COPY && H.COPY[langOf(ctx)]) || {};
    if (lookOnly(B) && (name === 'videos' || /^watch\//.test(name))) return frame(B, ctx, 'videos', ht.videos || 'Videos', previewVideosBody(ctx));
    if (name === 'stories') return frame(B, ctx, name, ht.stories || 'Stories', storiesBody(B, ctx, data));
    if (name === 'games') return frame(B, ctx, name, ht.games || 'Games', gamesBody(B, ctx, data));
    if (name === 'videos' && data && data.subject && advOn() && shelfOn(B)) return frame(B, ctx, name, C(ctx).subj(data.subject) + (view.g && String(view.g).indexOf(',') < 0 ? ' · ' + C(ctx).grade(view.g) : ''), chaptersBody(ctx, data.lib, data.subject, B), 'subjects');
    if (name === 'videos') return frame(B, ctx, name, ht.videos || 'Videos', data && data.subject ? chaptersBody(ctx, data.lib, data.subject, B) : subjectsBody(ctx, data && data.lib, B));
    if (/^watch\//.test(name)) return frame(B, ctx, name, ht.videos || 'Videos', data && data.watch ? watchHtml(data.watch, ctx, data.next, shelfOn(B), B.video_clean === true) : shelfOn(B) ? WATCH_WAIT : '<p class="wq-soon wq-wait" data-primary>' + esc(C(ctx).opening) + '</p>');
    return '';
  }

  /* ---------------- live: fetch, wire, play ---------------- */
  var cache = {};
  var asking = {};
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
  // One read of a door's rows at a time (`list_states`): a tap while warm's read is on its way joins it. Only rows that
  // came back whole are kept; a failure (or the server's own `err`) is asked again on the next visit or a retry.
  function doorUrl(B, ctx, name) { var g = name === 'games' ? selOf(B, 'games') : null; return '/api/wq/doors/h/' + encodeURIComponent(tok(B, ctx)) + '?kid=' + encodeURIComponent(B.kid || '') + '&d=' + name + '&l=' + langOf(ctx) + (g ? '&g=' + encodeURIComponent(g) : ''); }
  function ask(B, ctx, name, done) {
    if (asking[name]) return asking[name].push(done);
    asking[name] = [done];
    getJson(doorUrl(B, ctx, name), function (err, j) {
      var all = asking[name] || []; asking[name] = null;
      if (!err && j && !j.err) cache[name] = j;
      all.forEach(function (fn) { fn(err, j); });
    });
  }
  // Asked by the home when this file loads: the Games and Stories rows, so a door tap paints its whole list at once.
  function warm(B, ctx) {
    if (B && B.wait_pre === true && !lookOnly(B)) warmVideos(B, ctx);
    if (!B || !B.list_states || lookOnly(B)) return;
    ['games', 'stories'].forEach(function (n) { if (!cache[n]) ask(B, ctx, n, function () {}); });
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
  // The storybook shelf (wq-stories.js, the boot's `stories.on`): the reader fills [data-stories-shelf]. With rows of
  // its own the door keeps its primary (primary: false); with none the shelf's first cover (or the teacher's book) is
  // the primary, and the door's fallback button steps aside while the shelf shows one (back if the shelf goes away).
  // One shelf per door visit: the rows arriving redraw the door, and the shelf the reader already filled moves into the
  // new slot (no second GET, no repaint of covers still loading); a reader that loads late fills the door's slot on
  // screen, and nothing when the child has left the door.
  var shelfKept = null;
  function storiesShelf(root, B, ctx) {
    var sh = root.querySelector('[data-stories-shelf]');
    if (!sh || !(B.stories && B.stories.on)) return;
    var key = tok(B, ctx) + '|' + (B.kid || '') + '|' + langOf(ctx);
    var filled = false;
    var fill = function () {
      if (filled || !window.WQSTORIES || typeof window.WQSTORIES.shelf !== 'function') return;
      // the slot asked for, or the door's own slot that replaced it; never another screen's (Home drawn meanwhile)
      var cur = root.querySelector('[data-stories-shelf]');
      var slot = cur === sh || (cur && cur.getAttribute('data-host') === 'doors') ? cur : null;
      if (!slot) return;
      // `list_states`: an earlier draw already gave the reader this very slot (the rows redrew the door in between)
      if (B.list_states && shelfKept && shelfKept.key === key && shelfKept.el === slot) { filled = true; return; }
      var fb = root.querySelector('[data-shelf-fallback]');
      if (shelfKept && shelfKept.key === key && shelfKept.el !== slot && slot.parentNode) {
        try { slot.parentNode.replaceChild(shelfKept.el, slot); if (fb) shelfPrimary(shelfKept.el, fb, B.list_states && root, C(ctx).shelfOops); filled = true; return; } catch (e) {}
      }
      if (fb) shelfPrimary(slot, fb, B.list_states && root, C(ctx).shelfOops);
      filled = true;
      try { window.WQSTORIES.shelf(slot, B, { token: tok(B, ctx), lang: langOf(ctx), ev: ctx.ev || function () {}, go: ctx.go, primary: Boolean(fb) }); shelfKept = { el: slot, key: key }; } catch (e) { if (B.list_states) slotFailed(root, sh, ctx, true); }
    };
    if (window.WQSTORIES) return fill();
    var H = home();
    // `list_states`: the home may have asked for the reader already (its loadOnce then drops our callback), so the door
    // also listens to that script; a reader that never arrives turns the skeleton into a reload, never "no stories"
    var s0 = B.list_states ? readerScript() : null;
    if (s0) s0.addEventListener('load', fill);
    if (H && typeof H.loadOnce === 'function') H.loadOnce('wq-stories', fill);
    var s1 = B.list_states ? readerScript() : null;
    // (a script that failed before this tap has fired its error already: the home marked it)
    if (s1 && s1.getAttribute('data-failed') === '1') slotFailed(root, sh, ctx);
    else if (s1) s1.addEventListener('error', function () { slotFailed(root, sh, ctx); });
  }
  function readerScript() { try { return document.querySelector('script[src*="/wq/wq-stories.js"]'); } catch (e) { return null; } }
  // the reader never arrived, or its shelf threw (`thrown`): a reload in the slot, and the door root says failed
  function slotFailed(root, sh, ctx, thrown) {
    var cur = root.querySelector('[data-stories-shelf]');
    if (!cur || (cur !== sh && cur.getAttribute('data-host') !== 'doors') || (window.WQSTORIES && !thrown)) return;
    var t = C(ctx);
    cur.innerHTML = '<div class="wq-dempty"><p class="wq-soon">' + esc(t.shelfOops) + '</p><a class="wq-btn wq-go" data-primary href="' + esc(String(location.href || '')) + '">' + esc(t.retry) + '</a></div>';
    cur.setAttribute('data-filled', '1');
    cur.setAttribute('data-failed', '1');
    if (typeof root.setAttribute === 'function') root.setAttribute('data-fetch', 'failed');
  }
  // `wait` (list_states): while the shelf has not answered (the reader has not filled it, or shows its own skeleton) the
  // note stays hidden; it shows only for a shelf that answered with nothing to open. `wait` is the door root, which
  // carries the test markers.
  // `words` (list_states): the reader's own Try again sheet on a shelf that did not load names the stories, not one book
  // (list_states) one watcher at a time: it ends with the next draw of the shelf or the next door mount, and a slot that
  // is no longer on the door's screen (the child left) writes nothing
  var shelfObs = null;
  function unwatch() { if (shelfObs) { try { shelfObs.disconnect(); } catch (e) {} shelfObs = null; } }
  function shelfPrimary(sh, fb, wait, words) {
    var sync = function () {
      if (wait && typeof wait.contains === 'function' && !wait.contains(sh)) return;
      var has = !sh.hidden && Boolean(sh.querySelector('[data-primary]'));
      var sheet = wait ? sh.querySelector('[data-screen="stories-retry"]') : null;
      var say = sheet && words ? sheet.querySelector('.wqs-say') : null;
      if (say && say.textContent !== words) say.textContent = words;
      var failed = Boolean(wait) && !sh.hidden && (sh.getAttribute('data-failed') === '1' || Boolean(sheet));
      var busy = Boolean(wait) && !sh.hidden && !failed && (sh.getAttribute('data-filled') !== '1' || Boolean(sh.querySelector('[aria-busy="true"]')));
      fb.hidden = has || busy;
      if (wait && typeof wait.getAttribute === 'function') {
        wait.setAttribute('data-fetch', failed ? 'failed' : busy ? 'pending' : 'done');
        if (!busy && wait.getAttribute('data-skel-from') != null && wait.getAttribute('data-skel-to') == null) wait.setAttribute('data-skel-to', now());
        if (!fb.hidden && wait.getAttribute('data-empty-at') == null) wait.setAttribute('data-empty-at', now());
      }
      var b = fb.querySelector('.wq-go');
      if (b) { if (has) b.removeAttribute('data-primary'); else b.setAttribute('data-primary', ''); }
    };
    sync();
    try { var mo = new MutationObserver(sync); mo.observe(sh, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-primary', 'hidden'] }); if (wait) { unwatch(); shelfObs = mo; } } catch (e) {}
  }

  var view = { name: null, subject: null, watch: null, next: null, list: null, g: null, gopen: false };
  function draw(root, B, ctx, name, data) {
    var h = html(B, ctx, name, data);
    root.innerHTML = h;
    root.setAttribute('data-m', 'H3-' + name.split('/')[0]);
    // (the Videos screens as picture shelves stamp with their own writer, vtrip, after the draw)
    if (B.list_states && !lookOnly(B) && !(shelfOn(B) && (name === 'videos' || /^watch\//.test(name)))) trip(root, name, h, data);
    wire(root, B, ctx, name);
    try { window.scrollTo(0, 0); } catch (e) {}
  }
  // The test markers (`list_states` only): data-fetch pending|done|failed, when the skeleton came and went, and
  // when an empty note showed (a visible empty note beside data-fetch=pending is a FAIL for them).
  function now() { try { return String(Math.round(window.performance.now())); } catch (e) { return String(Date.now()); } }
  function trip(root, name, h, data) {
    if (typeof root.getAttribute !== 'function') return;
    var pending = /aria-busy="true"/.test(h) && !/<div data-shelf-fallback="1">/.test(h);
    var failed = Boolean(data && (data.err || (data.lib && data.lib.err)));
    var key = name.split('/')[0] + (data && data.subject ? '/' + data.subject : '');
    if (root.getAttribute('data-trip') !== key || root.getAttribute('data-vtrip') != null) {
      root.setAttribute('data-trip', key);
      if (root.removeAttribute) root.removeAttribute('data-vtrip');
      ['data-skel-from', 'data-skel-to', 'data-empty-at'].forEach(function (k) { if (root.removeAttribute) root.removeAttribute(k); });
    }
    root.setAttribute('data-fetch', pending ? 'pending' : failed ? 'failed' : 'done');
    if (pending && root.getAttribute('data-skel-from') == null) root.setAttribute('data-skel-from', now());
    if (!pending && root.getAttribute('data-skel-from') != null && root.getAttribute('data-skel-to') == null) root.setAttribute('data-skel-to', now());
    if (!pending && !failed && /class="wq-dempty"/.test(h.replace(/<div data-shelf-fallback="1" hidden>[\s\S]*$/, '')) && root.getAttribute('data-empty-at') == null) root.setAttribute('data-empty-at', now());
  }
  function mount(root, B, ctx, name) {
    view.name = name;
    shelfKept = null;
    unwatch();
    if ((name === 'stories' || name === 'games') && B.list_states && !lookOnly(B)) {
      draw(root, B, ctx, name, cache[name] || null);
      if (cache[name]) return;
      return ask(B, ctx, name, function (err, j) {
        if (view.name !== name) return;
        if (!err && j && !j.err) return draw(root, B, ctx, name, j);
        // a failed read: Games says so with a retry; Stories keeps the boot's own shelf (the reader has its own retry)
        if (name === 'games') draw(root, B, ctx, name, { games: [], err: 1 });
      });
    }
    if (name === 'stories' || name === 'games') {
      draw(root, B, ctx, name, cache[name] || null);
      if (!cache[name] && !lookOnly(B)) {
        getJson(doorUrl(B, ctx, name), function (err, j) {
          if (err || !j) return;
          cache[name] = j;
          if (view.name === name) draw(root, B, ctx, name, j);
        });
      }
      return;
    }
    if (lookOnly(B) && (name === 'videos' || /^watch\//.test(name))) return draw(root, B, ctx, 'videos', null);
    if (name === 'videos') return videos(root, B, ctx, view.subject);
    if (/^watch\//.test(name)) return start(root, B, ctx, { vid: name.slice(6) });
  }
  // web_quiz_doors_prefetch (the boot's `wait_pre`): the Videos door's subjects, asked once the home has painted, then
  // with the shelves each subject's shelf one at a time (each when the phone is idle after the last has answered), so a
  // Videos tap paints from rows already here and a home open never asks every shelf at once. Never on Data Saver or 2G,
  // the subjects only on 3G; a read that failed is not kept. A tap joins a read on its way (libGet: one read per list).
  var libAsking = {};
  function libGet(url, done) {
    if (libAsking[url]) return libAsking[url].push(done);
    libAsking[url] = [done];
    getJson(url, function (err, j) { var all = libAsking[url] || []; libAsking[url] = null; all.forEach(function (fn) { fn(err, j); }); });
  }
  function libRead(B) { return B && B.wait_pre === true ? libGet : getJson; }
  function idle(fn) {
    if (typeof requestIdleCallback === 'function') return requestIdleCallback(fn, { timeout: 2000 });
    if (typeof setTimeout === 'function') return setTimeout(fn, 200);
    fn();
  }
  function warmVideos(B, ctx) {
    var c = (typeof navigator !== 'undefined' && navigator && navigator.connection) || {};
    var net = String(c.effectiveType || '');
    if (c.saveData || /(^|-)2g$/.test(net)) return;
    if (lib.subjects && !lib.subjects.err) return;
    libGet(libUrl(B, ctx), function (err, j) {
      if (err || !j || j.err) return;
      lib.subjects = j;
      if (!shelfOn(B) || net === '3g') return;
      var keys = (j.subjects || []).map(function (s) { return s.key; });
      (function next() {
        var k = keys.shift();
        while (k !== undefined && lib.chapters[k]) k = keys.shift();
        if (k === undefined) return;
        idle(function () { if (lib.chapters[k]) return next(); libGet(libUrl(B, ctx, k), function (e, x) { if (!e && x && !x.err && !lib.chapters[k]) lib.chapters[k] = x; next(); }); });
      })();
    });
  }
  function libUrl(B, ctx, s) { if (!view.gread) { view.gread = 1; if (view.g == null) view.g = selOf(B, 'videos'); } return '/api/wq/lib/h/' + encodeURIComponent(tok(B, ctx)) + '?kid=' + encodeURIComponent(B.kid || '') + '&l=' + langOf(ctx) + (view.g ? '&g=' + encodeURIComponent(view.g) : '') + (s ? '&s=' + encodeURIComponent(s) : ''); }
  // Another grade picked (the look's picker): that grade's subjects and shelves, asked for afresh; its own grade again = none.
  function pickGrade(root, B, ctx, g) {
    // the visitor's own single grade (a default of several grades, or all, has none: every pick is asked for as it is)
    var own = lib.own || (lib.subjects && !lib.subjects.sel && lib.subjects.grade) || null;
    if (!lib.own && own) lib.own = own;
    var next = g && String(g) !== String(own) ? String(g) : null;
    view.gopen = false;
    setSel(B, 'videos', next);
    if (next !== view.g) { view.g = next; lib.subjects = null; lib.chapters = {}; vrows = {}; (ctx.ev || function () {})('lib_grade', { g: g, own: String(g) === String(own) ? 1 : 0 }); }
    return videos(root, B, ctx, null);
  }
  function videos(root, B, ctx, subject) {
    view.subject = subject || null;
    if (!subject) {
      draw(root, B, ctx, 'videos', { lib: lib.subjects });
      if (!lib.subjects || lib.subjects.err) { subjState(root, B, true); libRead(B)(libUrl(B, ctx), function (err, j) { lib.subjects = err || !j ? { err: true } : j; if (view.name === 'videos' && !view.subject) { draw(root, B, ctx, 'videos', { lib: lib.subjects }); shelves(root, B, ctx); subjState(root, B); } }); }
      else { shelves(root, B, ctx); subjState(root, B); }
      return;
    }
    draw(root, B, ctx, 'videos', { subject: subject, lib: lib.chapters[subject] || null });
    var see = function (st, l) { if (shelfOn(B)) vtrip(root, 'videos/' + subject, st, st === 'done' && !lessonsOf(l).length); };
    if (lib.chapters[subject]) return see('done', lib.chapters[subject]);
    see('pending');
    libRead(B)(libUrl(B, ctx, subject), function (err, j) { if (err || !j) { if ((shelfOn(B) || B.list_states) && view.name === 'videos' && view.subject === subject) { draw(root, B, ctx, 'videos', { subject: subject, lib: { err: true } }); see('failed'); } return; } lib.chapters[subject] = j; if (view.name === 'videos' && view.subject === subject) { draw(root, B, ctx, 'videos', { subject: subject, lib: j }); see('done', j); } });
  }
  // The walkers' list-state tripwires on the door root (web_quiz_video_shelf; the four attributes every child list
  // writes): data-fetch pending|done|failed, when its placeholders came and went (a Try again starts a new spell), and
  // when a true empty showed (never while pending). `key` is the list (the subjects' shelves, or one subject's grid).
  var vrows = {};       // a subject's shelf -> pending | done | failed | gone (no lessons: its row is removed)
  function vnow() { try { return String(Math.round(window.performance.now())); } catch (e) { return String(Date.now()); } }
  function vtrip(root, key, st, empty) {
    if (!root || typeof root.getAttribute !== 'function') return;
    if (root.getAttribute('data-vtrip') !== key) {
      root.setAttribute('data-vtrip', key);
      // (data-trip is the doors' list writer's key, written only under list_states: the other writer's spell ends here)
      ['data-trip', 'data-skel-from', 'data-skel-to', 'data-empty-at'].forEach(function (k) { root.removeAttribute(k); });
    }
    root.setAttribute('data-fetch', st);
    if (st === 'pending') {
      if (root.getAttribute('data-skel-from') == null || root.getAttribute('data-skel-to') != null) { root.setAttribute('data-skel-from', vnow()); root.removeAttribute('data-skel-to'); }
      return;
    }
    if (root.getAttribute('data-skel-from') != null && root.getAttribute('data-skel-to') == null) root.setAttribute('data-skel-to', vnow());
    if (empty && root.getAttribute('data-empty-at') == null) root.setAttribute('data-empty-at', vnow());
  }
  // The subjects' screen: pending while the subjects or any shelf loads, failed when one did not load (its Try again is
  // on screen), else done; a true empty is no subject with a lesson.
  function subjState(root, B, loading) {
    if (!shelfOn(B) || view.name !== 'videos' || view.subject) return;
    var s = lib.subjects;
    if (loading || !s) return vtrip(root, 'videos', 'pending');
    if (s.err) return vtrip(root, 'videos', 'failed');
    var keys = (s.subjects || []).map(function (x) { return x.key; });
    var has = function (st) { return keys.some(function (k) { return (vrows[k] || 'pending') === st; }); };
    var st = has('pending') ? 'pending' : has('failed') ? 'failed' : 'done';
    vtrip(root, 'videos', st, st === 'done' && !keys.some(function (k) { return vrows[k] === 'done'; }));
  }
  // web_quiz_video_shelf: each subject's shelf fills in place from its own lessons (kept for See all and the quiz taps).
  function shelves(root, B, ctx) {
    if (!shelfOn(B) || !lib.subjects || lib.subjects.err) return;
    (lib.subjects.subjects || []).forEach(function (s, si) { shelf(root, B, ctx, s.key, si); });
  }
  // One subject's shelf. A load that fails shows the oops line and one Try again in its place (never placeholders forever).
  function shelf(root, B, ctx, key, si) {
    var at = function () { return view.name === 'videos' && !view.subject ? root.querySelector('[data-vshelf="' + String(key).replace(/["\\]/g, '') + '"]') : null; };
    var put = function (sh, h) { sh.innerHTML = h; if (typeof sh.querySelectorAll === 'function') { each(sh, '[data-tap]', function (el) { bindTap(el, root, B, ctx, 'videos'); }); thumbFallback(sh); } };
    var state = function (sh, st) { vrows[key] = st; if (sh && typeof sh.setAttribute === 'function') sh.setAttribute('data-fetch', st); subjState(root, B); };
    var fill = function (j) {
      var sh = at(); if (!sh) return;
      var cards = shelfHtml(j, ctx, si === 0 ? EAGER : 0);
      if (!cards) { var sec = sh.parentNode; if (sec && sec.parentNode) sec.parentNode.removeChild(sec); return state(null, 'gone'); }
      put(sh, cards);
      state(sh, 'done');
    };
    if (lib.chapters[key]) return fill(lib.chapters[key]);
    state(at(), 'pending');
    libRead(B)(libUrl(B, ctx, key), function (err, j) {
      if (err || !j) { var sh = at(); if (sh) { put(sh, oopsHtml(ctx, key, si)); state(sh, 'failed'); } return; }
      lib.chapters[key] = j; fill(j);
    });
  }
  function oopsHtml(ctx, key, pos) {
    var t = C(ctx);
    return '<p class="wq-soon wq-voops">' + esc(t.oops) + '</p><button class="wq-btn wq-btn--secondary wq-vretry" type="button" data-tap="vretry" data-item="' + esc(key) + '" data-pos="' + (pos || 0) + '">' + esc(t.retry) + '</button>';
  }
  // A thumbnail that does not load falls back to the full poster once, then to the card's plain tile.
  function thumbFallback(el) {
    each(el, 'img.wq-vtimg', function (im) {
      im.addEventListener('error', function () {
        var f = im.getAttribute('data-f');
        if (f) { im.removeAttribute('data-f'); im.src = f; return; }
        im.hidden = true;
      });
    });
  }
  function findLesson(vid) {
    var hit = null;
    Object.keys(lib.chapters).forEach(function (k) { lessonsOf(lib.chapters[k]).forEach(function (v) { if (!hit && v.vid === vid) hit = v; }); });
    return hit;
  }
  // The quiz of a lesson, straight at its questions (?to=q): a class code the library named opens as is; otherwise the
  // server makes it on the tap (a class child's lesson code, or under the watch root), as the Next tile after a video does.
  function quizGo(root, B, ctx, vid) {
    if (going) return;
    var v = findLesson(vid) || {};
    if (v.code && v.k) { going = true; return go(ctx, qLang(B, ctx, '/q/' + encodeURIComponent(v.code) + '?k=' + encodeURIComponent(v.k) + '&via=videos&to=q'), 'door_quiz'); }
    going = true;
    postJson('/api/wq/videos/start', { hub: tok(B, ctx), kid: B.kid || '', vid: vid, after: 1 }, function (err, j) {
      going = false;
      if (!err && j && j.code) return go(ctx, qLang(B, ctx, '/q/' + encodeURIComponent(j.code) + '?' + (j.k ? 'k=' + encodeURIComponent(j.k) + '&' : '') + 'to=q'), 'door_quiz');
      videos(root, B, ctx, view.subject);
    });
  }

  // The lesson after this one in the open subject's list (Watch next), or null.
  function nextInList(vid) {
    var l = view.subject && lib.chapters[view.subject]; if (!l) return null;
    var all = []; (l.chapters || []).forEach(function (c) { (c.videos || []).forEach(function (v) { all.push(v); }); });
    for (var i = 0; i < all.length - 1; i++) if (all[i].vid === vid) return all[i + 1];
    return null;
  }
  // The server's ranked Next after this video (`watch.next`), or null: its words in the page's language and where it
  // goes — #after/<vid> the quiz after it (minted on the tap), #watch/<vid> another lesson here, another #hash of this
  // page, or a /path of this site. Anything else (no title, another site) is ignored and today's rule stands.
  // The server's offer words for next_shown / next_tap (EVENTS_V3 §2), so a ranked tile joins its next_set: only short
  // plain strings, only the keys the relay keeps; `source` is the server's own (pinned | ranked | fallback: the control
  // arm), anything else reads ranked.
  var JOIN = ['offer', 'rank_src', 'arm', 'score_v', 'id'];
  function joinOf(n) {
    var j = { source: /^(pinned|ranked|fallback)$/.test(n.source) ? n.source : 'ranked' };
    JOIN.forEach(function (k) { if (typeof n[k] === 'string' && /^[A-Za-z0-9._:-]{1,64}$/.test(n[k])) j[k] = n[k]; });
    return j;
  }
  function nextLine(next) {
    var o = { ctx: 'after_video', kind: (next || {}).kind, pos: 0 };
    var j = (next && next.ranked && next.join) || { source: 'fallback' };
    for (var k in j) if (Object.prototype.hasOwnProperty.call(j, k)) o[k] = j[k];
    return o;
  }
  function rankedNext(n, ctx) {
    if (!n || typeof n !== 'object') return null;
    var title = (langOf(ctx) === 'ur' && n.title_ur) || n.title;
    var href = typeof n.href === 'string' ? n.href : '';
    if (typeof title !== 'string' || !title || !/^(#[A-Za-z0-9/_-]*|\/[A-Za-z0-9][^\s]*)$/.test(href)) return null;
    var o = { kind: String(n.kind || ''), title: title, sub: typeof n.sub === 'string' ? n.sub : '', href: '#', ranked: true, join: joinOf(n) };
    var m = /^#after\/([0-9a-f-]{36})$/.exec(href); var w = /^#watch\/([0-9a-f-]{36})$/.exec(href);
    if (m) o.quiz = true; else if (w) o.vid = w[1]; else if (href.charAt(0) === '#') o.hash = href; else o.path = href;
    return o;
  }
  function start(root, B, ctx, v) {
    if (going) return;
    // web_quiz_rewatch_done (the boot's rewatch_done): a finished lesson's page opens as a fresh go (again=1), the video
    // first, never its old finish card. Off: today's link.
    var re = B.rewatch_done === true && v.done ? '&again=1' : '';
    // A class child's lesson page is told it was opened from this door (via=videos): with web_quiz_videos_v3 on it puts the play first.
    if (v.code && v.k) { going = true; return go(ctx, qLang(B, ctx, '/q/' + encodeURIComponent(v.code) + '?k=' + encodeURIComponent(v.k) + '&via=videos' + re), 'door_video'); }
    going = true;
    var t = C(ctx);
    if (view.name !== 'watch/' + v.vid) draw(root, B, ctx, 'watch/' + v.vid, null);
    view.name = 'watch/' + v.vid;
    postJson('/api/wq/videos/start', { hub: tok(B, ctx), kid: B.kid || '', vid: v.vid }, function (err, j) {
      going = false;
      if (!err && j && j.code) return go(ctx, qLang(B, ctx, '/q/' + encodeURIComponent(j.code) + (j.k ? '?k=' + encodeURIComponent(j.k) + '&' : '?') + 'via=videos' + re), 'door_video');
      if (!err && j && j.watch) {
        var after = nextInList(v.vid);
        var next = rankedNext(j.watch.next, ctx) || (j.watch.after ? { kind: 'quiz', title: t.quizAfter, sub: j.watch.title, href: '#', quiz: true }
          : after ? { kind: 'video', title: t.watchNext, sub: after.title, href: '#', vid: after.vid } : { kind: 'video', title: t.moreVideos, sub: '', href: '#videos' });
        view.watch = j.watch; view.next = next; view.shownAt = null;
        return draw(root, B, ctx, 'watch/' + v.vid, { watch: j.watch, next: next });
      }
      draw(root, B, ctx, 'videos', { lib: { err: true } });
    });
  }

  function wire(root, B, ctx, name) {
    var ev = ctx.ev || function () {};
    each(root, '[data-tap]', function (el) { bindTap(el, root, B, ctx, name); });
    if (name === 'stories') storiesShelf(root, B, ctx);
    if (shelfOn(B) && typeof root.querySelectorAll === 'function') thumbFallback(root);
    var vEl = root.querySelector('.wq-vid');
    if (vEl) { wireVideo(root, vEl, B, ctx, ev); cardSoon(B); }
  }
  function bindTap(el, root, B, ctx, name) {
    var ev = ctx.ev || function () {};
      el.addEventListener('click', function (e) {
        var tap = el.getAttribute('data-tap');
        try { if (window.WQJ && typeof window.WQJ.tap === 'function') window.WQJ.tap(); } catch (x) {}
        if (tap === 'say') { e.preventDefault(); e.stopPropagation(); return speak(el, ctx); }
        if (tap === 'home') { e.preventDefault(); view.subject = null; try { location.hash = ''; } catch (x) {} if (home()) home().mount(root, B, ctx); return; }
        if (tap === 'door') { ev('door_tap', { door: el.getAttribute('data-door'), pos: DOORS.indexOf(el.getAttribute('data-door')) + 1 }); return; }
        if (tap === 'row' && lookOnly(B)) { e.preventDefault(); var H0 = home(); if (H0 && typeof H0.practiceNote === 'function') H0.practiceNote(root, ctx); return; }
        if (tap === 'row') {
          e.preventDefault();
          ev('door_row_tap', { door: name, kind: el.getAttribute('data-kind'), item: el.getAttribute('data-item') || undefined, pos: Number(el.getAttribute('data-pos')) });
          return go(ctx, el.getAttribute('href'), 'door_' + el.getAttribute('data-kind'));
        }
        if (tap === 'subj') { e.preventDefault(); ev('door_row_tap', { door: 'videos', kind: 'subject', item: el.getAttribute('data-item'), pos: Number(el.getAttribute('data-pos')) }); return videos(root, B, ctx, el.getAttribute('data-item')); }
        if (tap === 'subjects') { e.preventDefault(); return videos(root, B, ctx, null); }
        if (tap === 'vgl') { e.preventDefault(); view.gopen = !view.gopen; return videos(root, B, ctx, null); }
        if (tap === 'vg') { e.preventDefault(); return pickGrade(root, B, ctx, el.getAttribute('data-item')); }
        if (tap === 'gpk') { e.preventDefault(); gpOpen = !gpOpen; return draw(root, B, ctx, 'games', cache.games || null); }
        if (tap === 'gsel') { e.preventDefault(); gpOpen = false; setSel(B, 'games', el.getAttribute('data-item')); cache.games = null; ev('door_grade', { door: 'games', g: el.getAttribute('data-item') }); return mount(root, B, ctx, 'games'); }
        if (tap === 'retry' && name === 'games') { e.preventDefault(); return mount(root, B, ctx, 'games'); }
        if (tap === 'retry' && view.subject) { e.preventDefault(); return videos(root, B, ctx, view.subject); }
        if (tap === 'retry') { e.preventDefault(); lib.subjects = null; return videos(root, B, ctx, null); }
        if (tap === 'vretry') {
          e.preventDefault();
          var rk = el.getAttribute('data-item');
          if (view.subject) return videos(root, B, ctx, view.subject);
          if (!rk) { lib.subjects = null; return videos(root, B, ctx, null); }
          var rs = root.querySelector('[data-vshelf="' + String(rk).replace(/["\\]/g, '') + '"]');
          if (rs) rs.innerHTML = SKEL + SKEL + SKEL;
          return shelf(root, B, ctx, rk, Number(el.getAttribute('data-pos')) || 0);
        }
        if (tap === 'vid') {
          e.preventDefault();
          var vid = el.getAttribute('data-item');
          var l = lib.chapters[view.subject] || {}; var hit = null;
          (l.chapters || []).forEach(function (c) { (c.videos || []).forEach(function (v) { if (v.vid === vid) hit = v; }); });
          ev('door_row_tap', { door: 'videos', kind: 'video', item: vid, pos: Number(el.getAttribute('data-pos')) });
          return start(root, B, ctx, hit || findLesson(vid) || { vid: vid });
        }
        if (tap === 'vquiz') {
          e.preventDefault();
          ev('door_row_tap', { door: 'videos', kind: 'quiz', item: el.getAttribute('data-item'), pos: Number(el.getAttribute('data-pos')) || 0 });
          return quizGo(root, B, ctx, el.getAttribute('data-item'));
        }
        if (tap === 'after') {
          e.preventDefault();
          var tl = nextLine(view.next);
          if (view.shownAt != null) tl.ms_to_tap = Math.max(0, Math.round(Date.now() - view.shownAt));
          ev('next_tap', tl);
          return afterGo(root, B, ctx);
        }
      });
  }
  // What follows a watched video: the quiz after it (minted on this tap), the next lesson, or the subject's list.
  function afterGo(root, B, ctx) {
    var nx = view.next || {};
    if (nx.quiz && view.watch) {
      return postJson('/api/wq/videos/start', { hub: tok(B, ctx), kid: B.kid || '', vid: view.watch.vid, after: 1 }, function (err, j) {
        if (!err && j && j.code) return go(ctx, qLang(B, ctx, '/q/' + encodeURIComponent(j.code) + (j.k ? '?k=' + encodeURIComponent(j.k) : '')), 'after_video');
        videos(root, B, ctx, view.subject);
      });
    }
    if (nx.vid) return start(root, B, ctx, { vid: nx.vid });
    if (nx.path) return go(ctx, nx.path, 'after_video');
    try { location.hash = nx.hash || '#videos'; } catch (x) {}
    if (nx.hash && nx.hash !== '#videos') return;
    return videos(root, B, ctx, view.subject);
  }
  // The finish card's script, asked for while the video plays so the card is there when it ends (`card_v3` only).
  function cardSoon(B) {
    if (B.card_v3 !== true || window.WQFC) return;
    try {
      if (document.getElementById('wq-fc-js')) return;
      var me = document.querySelector('script[src*="/wq/hub.js"]');
      var v = me && /[?&]v=([A-Za-z0-9]+)/.exec(me.getAttribute('src') || '');
      var s = document.createElement('script'); s.id = 'wq-fc-js'; s.src = '/wq/wq-finish-card.js' + (v ? '?v=' + v[1] : ''); document.head.appendChild(s);
    } catch (e) {}
  }
  // The card after a watched video: its block above the hidden tile holder, the one Next tile inside it (our own tile
  // goes); its Next opens what ours would, and leads (the card and ONE next thing: Share is the soft secondary).
  // false = no card (switch off, script not there): our own tile stays.
  function endCard(root, B, ctx, ev) {
    if (B.card_v3 !== true || !window.WQFC || typeof window.WQFC.mount !== 'function') return false;
    var a = root.querySelector('.wq-after'); var w = view.watch || {}; var nx = view.next || {};
    var here = '';
    try { here = (location.pathname || '') + (location.search || ''); } catch (e) { here = ''; }
    var next = nx.path ? { kind: nx.kind, title: nx.title, sub: nx.sub || '', href: nx.path }
      : /^\/[^/]/.test(here) ? { kind: nx.kind, title: nx.title, sub: nx.sub || '', href: here + (nx.hash || '#videos') } : null;
    var ok = false;
    var fo = { kind: 'video', deed: 'video_watched', lang: langOf(ctx), title: w.title || '', next: next, lead: true, plain: !!(B.doors && B.doors.videos && B.doors.videos.watch === true), auth: { hub: tok(B, ctx), kid: B.kid || '' }, ev: ev };
    // the one share (share_v4): the card names the video, so its link lands a new child on it
    if (B.share_v4 === true) { fo.v4 = true; fo.item = w.vid ? { type: 'video', id: String(w.vid) } : null; }
    // the corrected Urdu share words (web_quiz_ur_share_copy): the no-class Share says «دوستوں کو بھیجیں»
    if (B.ur_share === true) fo.urs = true;
    try { ok = window.WQFC.mount(a, fo); } catch (e) { ok = false; }
    if (!ok) return false;
    if (a && a.parentNode) a.parentNode.removeChild(a);
    var t = document.getElementById('wqfc-next');
    if (t) t.addEventListener('click', function (e) { if (e && e.preventDefault) e.preventDefault(); afterGo(root, B, ctx); });
    return true;
  }
  // video_open on the first play, video_watched at >= 90 % played (EVENTS_V3 §3); then the Next tile is the primary.
  function wireVideo(root, vEl, B, ctx, ev) {
    var vid = view.watch && view.watch.vid; var opened = false; var watched = false; var t0 = 0;
    var playBtn = root.querySelector('.wq-vplay');
    var showAfter = function () {
      var a = root.querySelector('.wq-after'); if (!a || !a.hidden) return;
      if (playBtn) { playBtn.removeAttribute('data-primary'); playBtn.hidden = true; }
      if (endCard(root, B, ctx, ev)) return;
      a.hidden = false;
      var nx = a.querySelector('.wq-vnext'); if (nx) nx.setAttribute('data-primary', '');
      view.shownAt = Date.now();
      ev('next_shown', nextLine(view.next));
    };
    if (playBtn) playBtn.addEventListener('click', function () { try { var p = vEl.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {} });
    // web_quiz_video_clean_start: no native controls before the first play, so the whole box (the poster) is the play
    // tap, like the lesson page's cover; once it has played the player's own controls take the taps
    var box = B.video_clean === true ? root.querySelector('.wq-vbox') : null;
    if (box) box.addEventListener('click', function (e) {
      if (opened || !vEl.paused || (e && playBtn && (e.target === playBtn || (playBtn.contains && playBtn.contains(e.target))))) return;
      try { var p = vEl.play(); if (p && p.catch) p.catch(function () {}); } catch (x) {}
    });
    vEl.addEventListener('play', function () {
      if (playBtn) playBtn.hidden = true;
      if (B.video_clean === true) vEl.setAttribute('controls', '');
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
    window.WQDOORS = { owns: owns, html: html, watchHtml: watchHtml, shelfHtml: shelfHtml, mount: mountKeep, warm: warm, COPY: COPY, storyHref: storyHref,
      _reset: function () { cache = {}; asking = {}; sels = {}; gpOpen = false; lib = { subjects: null, chapters: {} }; vrows = {}; going = false; view = { name: null, subject: null, watch: null, next: null }; } };
  }
})();
