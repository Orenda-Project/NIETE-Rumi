/*
 * The Trail page v2 (window.WQTRAIL), loaded by the Challenge page only when its menu payload carries `v2`
 * (web_quiz_challenge_v2 on). wq-challenge.js hands it its helpers once (init) and delegates a few points to it;
 * with `v2` absent this file is not even loaded and the Challenge page is today's.
 *
 *   help       "Is someone helping you today?" once per sitting, before the first scored stop (never before a
 *              practice round), nothing preselected; the answer rides every result as helped:'self'|'helped'.
 *   notice     the mic NOTICE (RULING #96(4)): before the microphone is asked for, on the read stop, one card with one
 *              control ("Got it"), when the payload's v2 carries `notice` (this child has not seen that wording on this
 *              phone) and the phone's own mirror (localStorage wq_notice_v:<chip>) has not seen it either; the control
 *              goes on to the microphone; that run's upload and result carry audio_consent:'notice_shown'.
 *   whose turn the serve answers ask:'whose_turn' → one chip per child, a tap reloads with kid=<chip>; never auto-picked.
 *   outcomes   on_its_way → a card, the stop stays closed (no run, no mic); lower_band → the ordinary passage screen.
 *   end cards  what was done (read all / read some / tried / listened / answered), the same sticker line for every
 *              first counted run, the next thing when the server names it — never words a minute, never a count.
 *   warm-up    a stop whose payload carries anchor_block is the Number warm-up (its own title and line).
 *   intro      a read or listen stop whose payload carries `title` {en, ur} names the passage in one line (Urdu: ur → en
 *              → the stop's name; English: en → the stop's name); the server withholds a title that would give an answer
 *              away, so the page draws whatever the serve sends; `reopened: true` says "Welcome back" in place of the
 *              intro line (English only, no hear button); `teacher_preview: true` makes the practice banner the teacher's.
 *   story time ?room=story&pid=<id> with the menu's v2.story: the read (or listen, ex=listen) is asked for with
 *              room=story&pid=<id> (that request only) and served as a practice run: its banner on every screen; a read
 *              first asks "hear it from me first, or read it yourself" (read along = the story clip with the line lit,
 *              then the normal read); no clock, no score, no words a minute, no "N of M"; the end card says the story
 *              can be read again + the sticker line. A refused id (any 400), 404 or no network is "on its way".
 *   preview   a grown-up's preview that plays (the serve's `practice_play`, app_settings web_quiz_practice_play): a
 *              Story Time read is the read-along only (Jugnu reads, the words light) and then the story's end card; the
 *              microphone is never asked for (no "read it yourself"), and nothing is scored or kept.
 * Copy: copy.v2.json keys (jg.*), camelCase of the key tail; gender-neutral; no number about the child.
 */
(function () {
  'use strict';
  var T = {
    en: {
      helpQ: 'Is someone helping you today?', helpAlone: 'No, on my own', helpWith: 'Yes, someone is helping', helpNote: 'You get the sticker both ways.',
      // jg.keep.notice / jg.keep.notice_ok (deck v2.3, bot/shared/config/copy.v2.json): the mic notice, {name} = the child's first name
      noticeT: 'Jugnu keeps {name}\'s reading recordings, with no end date yet. Only the people who make Jugnu can listen. Sending STOP on WhatsApp removes this phone number; the recordings stay.',
      noticeOk: 'Got it',
      whoTurn: 'Whose turn?', whoTapName: 'Tap your name.', whoPlayedHere: 'Played on this phone before', whoSomeoneElse: "My name isn't here",
      nextOnItsWay: 'A new story is on its way.',
      endReadAll: 'You read the whole story!', endReadSome: 'You read out loud with Jugnu!', endZeroWords: 'You tried a whole new story!',
      endListen: 'You listened to the whole story!', endTap: 'You answered all the questions!', endSticker: 'A sticker went into your Book.',
      endB3Next: 'Next time Jugnu can read a story with you first.', endNext: function (title) { return 'Next: ' + title; }, endHome: 'Home',
      // the folded end card (the child home on): the home's own Next with nothing ranked (wq-home.js), the bar's Home
      foldPick: 'Pick a story', foldHome: 'Home',
      trailPractice: 'Playing again: just for fun', trailMicWait: 'This game needs the mic. Play it when the mic is on.', trailOther: 'Try another game', trailStopDone: 'Game done!',
      lanternTrailOne: 'A game is waiting for you on the Trail.', lanternTrailMany: 'Games are waiting for you on the Trail.',
      gamesTitle: "{name}'s games", gamesPick: 'Pick a game', gamesBack: "Back to {name}'s games",
      gamesWaitOne: 'A game is waiting for you.', gamesWaitMany: 'Games are waiting for you.',
      storyBanner: 'Story Time: just for fun',
      storyAsk: 'Hear it from me first, or read it yourself.', storyReadAlong: 'Read along with Jugnu', storyAgain: 'Read this story again any time.',
      ra: { play: 'Play', pause: 'Pause', replay: 'Hear it again' }, showWords: 'Show me the words',
      warmupTitle: 'Number warm-up', warmupSay: "Let's start with some numbers.", warmupDone: 'Warm-up done!',
      // jg.trail.welcome_back (the lead's posted EN): the intro line of a re-served record (reopened: true)
      welcomeBack: "Welcome back! Let's carry on.",
      // jg.t.practice (bot/shared/config/copy.v2.json): the practice banner of a teacher's own visit (teacher_preview)
      teacherPractice: "Practice: nothing counts on a teacher's phone.",
    },
    ur: {
      helpQ: 'کیا آج آپ کو کسی کی مدد مل رہی ہے؟', helpAlone: 'نہیں، اپنے آپ', helpWith: 'جی ہاں، کسی کی مدد سے', helpNote: 'اسٹیکر دونوں طرح ملے گا۔',
      // jg.keep.notice / jg.keep.notice_ok (deck v2.3 bytes, bot/shared/config/copy.v2.json: {name} inside U+2068…U+2069,
      // STOP inside U+2066…U+2069)
      noticeT: 'جگنو ⁨{name}⁩ کے پڑھنے کی ریکارڈنگ رکھتا ہے۔ ابھی طے نہیں کہ یہ کب تک رکھی جائے گی۔ یہ ریکارڈنگ صرف جگنو بنانے والے سن سکتے ہیں۔ واٹس ایپ پر ⁦STOP⁩ بھیجنے سے فون نمبر ہٹا دیا جاتا ہے، لیکن ریکارڈنگ موجود رہتی ہے۔',
      noticeOk: 'ٹھیک ہے',
      whoTurn: 'کس کی باری ہے؟', whoTapName: 'اپنا نام دبائیں۔', whoPlayedHere: 'پہلے بھی اسی فون پر کھیلا گیا', whoSomeoneElse: 'میرا نام یہاں نہیں',
      nextOnItsWay: 'ایک نئی کہانی آنے والی ہے۔',
      endReadAll: 'آپ نے پوری کہانی پڑھ لی!', endReadSome: 'آپ نے جگنو کے ساتھ اونچی آواز میں پڑھا!', endZeroWords: 'آپ نے ایک بالکل نئی کہانی کھول کر دیکھی!',
      endListen: 'آپ نے پوری کہانی سن لی!', endTap: 'آپ نے سارے سوالوں کے جواب دے دیے!', endSticker: 'آپ کی کتاب میں ایک اسٹیکر لگ گیا۔',
      endB3Next: 'اگلی بار جگنو پہلے آپ کے ساتھ کہانی پڑھ سکتا ہے۔', endNext: function (title) { return 'آگے: ⁨' + title + '⁩'; }, endHome: 'واپس جائیں',
      foldPick: 'کہانی چنیں', foldHome: 'ہوم',
      trailPractice: 'یہ کھیل دوبارہ: بس مزے کے لیے', trailMicWait: 'اس کھیل کے لیے مائیک چاہیے۔ مائیک چلنے پر کھیلیں۔', trailOther: 'کوئی اور کھیل کھیلیں', trailStopDone: 'کھیل مکمل!',
      lanternTrailOne: 'جگنو کے راستے پر ایک کھیل آپ کا انتظار کر رہا ہے۔', lanternTrailMany: 'جگنو کے راستے پر کھیل آپ کا انتظار کر رہے ہیں۔',
      gamesTitle: '{name} کے کھیل', gamesPick: 'ایک کھیل چنیں', gamesBack: '{name} کے کھیلوں پر واپس',
      gamesWaitOne: 'ایک کھیل آپ کا انتظار کر رہا ہے۔', gamesWaitMany: 'کچھ کھیل آپ کا انتظار کر رہے ہیں۔',
      storyBanner: 'کہانی کا وقت: بس مزے کے لیے',
      storyAsk: 'پہلے مجھ سے سن لیں، یا خود پڑھیں۔', storyReadAlong: 'جگنو کے ساتھ ساتھ پڑھیں', storyAgain: 'یہ کہانی جب چاہیں دوبارہ پڑھیں۔',
      ra: { play: 'سنیں', pause: 'روکیں', replay: 'دوبارہ سنیں' }, showWords: 'الفاظ دکھائیں',
      warmupTitle: 'گنتی کا کھیل', warmupSay: 'چلیں، پہلے گنتی سے شروع کریں۔', warmupDone: 'گنتی کا کھیل مکمل!',
      welcomeBack: 'دوبارہ خوش آمدید! آئیں، آگے چلتے ہیں۔',
      // jg.t.practice (deck bytes, bot/shared/config/copy.v2.json)
      teacherPractice: 'مشق: ٹیچر کے فون پر کچھ بھی شمار نہیں ہوتا۔',
    },
  };
  var ANIMALS = { cat: '🐱', dog: '🐶', rabbit: '🐰', parrot: '🦜', fish: '🐟', turtle: '🐢', lion: '🦁', elephant: '🐘', owl: '🦉', butterfly: '🦋', bee: '🐝', horse: '🐴' };
  var HELP_KEY = 'wqc_helped_v2';
  var CLIP_TRIES = 3;
  var ALONG_CAP_MS = 180000;   // a WebView that never reports the clip's end still reaches the read
  var RA_WAIT_MS = 4000;       // a tap that beat the player waits this long for it (inside the tap's 5-s audio window)
  // the word-by-word player (wq-readalong.js), fetched only when a story serve carries `readalong`
  // (web_quiz_readalong); its version is the file's sha256, first 10 hex (a test keeps the two in step)
  var RA_V = '64569caa64';

  // own styles (only under v2): the chip's second line under the name; Urdu lines at Nastaliq-readable size
  function css() {
    try {
      if (document.getElementById('wqtr-css')) return;
      var st = document.createElement('style');
      st.id = 'wqtr-css';
      st.textContent = '.wqc-who{flex-wrap:wrap}.wqc-who2{flex-basis:100%;display:block;font-weight:600;font-size:15px;opacity:.8;padding-bottom:6px}[lang="ur"] .wqc-who{padding-bottom:10px}'
        + '[lang="ur"] .wqc .wq-sub,[lang="ur"] .wqc-who2,[lang="ur"] #wqc-story-banner{font-size:20px}'
        // Urdu at 20 px or more on every v2 screen (bubble, buttons, lines): only under .wqt-v2, which WQTRAIL sets
        + 'html[lang="ur"] .wqt-v2 .wq-say,html[lang="ur"] .wqt-v2 .wq-btn,html[lang="ur"] .wqt-v2 .wq-sub,html[lang="ur"] .wqt-v2 .wqc-banner,'
        + 'html[lang="ur"] .wqt-v2 .wqc-pill,html[lang="ur"] .wqt-v2 small{font-size:20px}';
      document.head.appendChild(st);
    } catch (e) { /* unstyled still works */ }
  }

  function init(h) {
    css();
    try { var rootEl = document.getElementById('wq'); if (rootEl && rootEl.classList) rootEl.classList.add('wqt-v2'); } catch (e) { /* unstyled */ }
    var L = h.L === 'ur' ? 'ur' : 'en';
    var t = T[L];
    var esc = h.esc;
    var noticeRun = null;   // the run (ct) the mic notice was shown on: its upload and result say notice_shown
    var tries = 0;
    var deep = null;
    var games = false;   // came from the new home's Next tile: the game starts at once, and the list draws no Next of its own
    try { deep = String((location && location.hash) || '').replace(/^#/, '') || null; } catch (e) { deep = null; }

    // ── the sitting's help answer (sessionStorage: one tab, one child) ──
    function sitKey() { return HELP_KEY + ':' + (h.boot.kid || ''); }
    function helpedNow() {
      try { var v = window.sessionStorage.getItem(sitKey()); return v === 'self' || v === 'helped' ? v : null; } catch (e) { return null; }
    }
    function setHelped(v) { try { window.sessionStorage.setItem(sitKey(), v); } catch (e) { /* this view only */ } mem = v; }
    var mem = null;
    function helped() { return helpedNow() || mem; }

    function btn(id, label, cls) { return '<button class="wq-btn ' + (cls || 'wq-go') + '" id="' + id + '" type="button">' + esc(label) + '</button>'; }
    // the button back to the list says where it goes («Back to Jugnu's games») with the child home on (the menu's
    // card_fold, web_quiz_home_v3): the list is not the home there. Off, it is today's "Home".
    function toGames() { return (h.md() || {}).card_fold ? trailCopy('back') : t.endHome; }
    function home() { return '<div class="wq-stack">' + btn('wqc-menu', toGames()) + '</div>'; }

    // ── the child home on (the menu's card_fold; app_settings web_quiz_home_v3): an end card is the card and ONE next
    // thing — the ranked Next (the first offer this page can open, else "Pick a story": the home on its Stories door), or
    // the story's questions when they follow — "Share to class group" soft, and ONE Home row to the child's home. No
    // again, no "Show me the words", no "Next: …" line. Never on a class round turn (its hand-back card is today's). ──
    function fold() { var d = h.S.data || {}; return !!(h.md() || {}).card_fold && !d.round_turn && !!(h.boot && h.boot.token); }
    function homeHref(hash) { return '/h/' + encodeURIComponent(h.boot.token) + '?' + (h.boot.kid ? 'kid=' + encodeURIComponent(h.boot.kid) + '&' : '') + 'from=home' + (hash || ''); }
    // the slot's offer, or the next of its alternatives, that opens on this site (an invite's WhatsApp message never)
    function foldNext(nx) {
      var all = nx && typeof nx === 'object' ? [nx].concat(Array.isArray(nx.alts) ? nx.alts : []) : [];
      for (var i = 0; i < all.length; i++) {
        var x = all[i];
        if (x && typeof x.href === 'string' && /^\/[^/]/.test(x.href) && ((L === 'ur' && x.title_ur) || x.title)) return x;
      }
      return { kind: 'stories', href: homeHref('#stories'), title: t.foldPick };
    }
    // the next thing (the questions, or this page's own Next link — the card's tile takes its place when the card is
    // drawn), then the host's stack with the one Home row; the card's block goes between them (Share under the Next)
    function foldHtml(fx, qa) {
      var first = qa ? h.qaButtons().replace(/<button[^>]*id="wqc-menu"[\s\S]*?<\/button>/, '').replace('id="wqc-qa"', 'id="wqc-qa" data-primary')
        : '<a class="wq-btn wq-go" id="wqc-fnext" data-primary href="' + esc(fx.href) + '">' + esc((L === 'ur' && fx.title_ur) || fx.title) + '</a>';
      // the reading moment's own word for Home when it is on («گھر», the app's word; off: today's)
      var hw = (h.md() || {}).read_feedback === true && window.WQMoment && window.WQMoment.label ? window.WQMoment.label(L, 'home') : t.foldHome;
      return '<div class="wqc-fold">' + first + '</div><div class="wq-stack"><a class="wq-btn wq-soft" id="wqc-fhome" data-home href="' + esc(homeHref()) + '">' + esc(hw) + '</a></div>';
    }
    // after the card: one Home (the page's top link goes), one Next (the card's tile, or ours), Share soft under the questions
    function foldAfter(qa) {
      try {
        var top = document.getElementById('wq-home');
        if (top && top.parentNode) top.parentNode.removeChild(top);
        var mine = document.getElementById('wqfc-next') ? document.getElementById('wqc-fnext') : null;
        if (mine && mine.parentNode) mine.parentNode.removeChild(mine);
        var card = document.getElementById('wqfc-share');
        if (card && qa) { card.className = card.className.replace(/\bwq-go\b/, 'wq-soft'); card.removeAttribute('data-primary'); }
        // the card is the one headline: a practice run's banner (Story Time's "just for fun") stays on the screens before it
        var banner = card ? document.getElementById('wqc-practice') : null;
        if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
      } catch (e) { /* the card still works */ }
    }
    // a read that heard nothing (the kind card, never the 10-s "later" one), with its switch on (zero_listen): its ONE
    // Next is "Hear it again" — Jugnu reads the passage word by word — when the passage's timings are here (on the
    // serve, or asked for by the run token once the recording has gone up); "I'm ready" opens the read again
    function replayRa(d, card) {
      var r = (card && card.r) || {};
      if (d.ex !== 'read' || d.zero_listen !== true || !r.tried || r.later || r.hold) return null;
      var ra = d.readalong || d.hear_first || d.words_ra;
      return ra ? (window.WQReadAlong ? ra : 'wait') : false;   // false: no timings yet; 'wait': the player is on its way
    }
    function foldEnd(name, top, qa, nx, card) {
      var d = h.S.data || {};
      var want = qa ? null : replayRa(d, card);
      var ra = want && want !== 'wait' ? want : null;
      var fx = foldNext(nx);
      // web_quiz_fold_retry: a 0-word try (card.r.again, never on a held card) gets one soft Try again above Next; the
      // reading moment's own (wqc-rfagain) stays the only one when it is drawn
      var md = h.md() || {};
      var rfa = top.indexOf('id="wqc-rfagain"') >= 0;
      var retry = md.fold_retry === true && card && card.r && card.r.again && !card.r.hold && !rfa;
      // the reading moment's own button (wqc-rfagain) with a read-along: ONE button for ONE action — "Read with Jugnu"
      // reads with the words lit, then opens the read; the card's Next stays its one primary (no separate "Hear it again")
      var rfRa = rfa && ra && window.WQMoment && window.WQMoment.label ? ra : null;
      if (rfRa) top = top.replace(/(id="wqc-rfagain"[^>]*>)[^<]*/, '$1' + esc(window.WQMoment.label(L, 'withJ')));
      var replay = ra && !rfRa;
      // no read-along for this passage at all: Jugnu's line asks for what the button does ("let's read it once more"),
      // never "let's read it together" with no one to read with (want null: no read-along switch, or none to come)
      if (window.WQFC && rfa && want === null && card && card.line === window.WQFC.together(L)) top = top.split(esc(card.line)).join(esc(window.WQMoment.label(L, 'once')));
      h.show(name, top + (retry ? btn('wqc-again', h.t.again, 'wq-soft') : '') + (replay ? foldHtml(fx, false).replace(/<a class="wq-btn wq-go" id="wqc-fnext"[^>]*>[\s\S]*?<\/a>/, btn('wqc-fnext', t.ra.replay).replace('type="button"', 'data-primary type="button"')) : foldHtml(fx, qa)));
      if (qa) h.on('wqc-qa', function () { h.qa().open(); });
      if (retry) h.on('wqc-again', function () { h.open(d.ex); });
      // bound here, so a redraw (the timings landing later) binds it again
      if (rfa) h.on('wqc-rfagain', function () { if (rfRa) timedAlong(rfRa, function () { h.open(d.ex); }); else h.open(d.ex); });
      if (replay) h.on('wqc-fnext', function () { timedAlong(ra, function () { h.open(d.ex); }); });
      if (window.WQFC) window.WQFC.trailEnd(h, Object.assign(card, { fold: { next: qa || replay ? null : fx } }));
      foldAfter(qa);
      // no timings on the serve (a counted read): asked for now (once the recording is up); drawn again with "Hear it again"
      var redraw = function () { if (h.S.data === d && h.S.screen === name) foldEnd(name, top, qa, nx, card); };
      if (want === false && d.ct) askWords(d, redraw);
      if (want === 'wait') { raLoad(); if (!raLoad.failed) raWaits.push(function (ok) { if (ok) redraw(); }); }
    }
    function outcome(d) { return (d && (d.outcome || (d.draw && d.draw.outcome))) || null; }
    function isWarmup(d) { return !!(d && d.anchor_block); }

    // ── Story Time: the room's one story request and its run ──
    var story = null;      // { ex, pid } from the room's link, while that story is asked for / played
    var roomUsed = false;  // the room opened its story once in this page load; the menu after it is the trail
    function storyQs(ex) { return story && story.ex === ex ? '&room=story&pid=' + encodeURIComponent(story.pid) : ''; }
    function isStory() { return !!(story && h.S.data && h.S.data.story_room); }
    function clipUrl(d) { return (d && d.story_clip && d.story_clip.url) || null; }

    function helpAsk(then) {
      // two answers, neither pressed nor checked until a tap
      h.show('help-ask', h.jug('hello', t.helpQ, true) + '<div class="wq-stack">'
        + btn('wqc-help-no', t.helpAlone) + btn('wqc-help-yes', t.helpWith) + '</div><p class="wq-sub" id="wqc-help-note">' + esc(t.helpNote) + '</p>');
      h.on('wqc-help-no', function () { setHelped('self'); h.ev('ch_helped', { v: 'self' }); then(); });
      h.on('wqc-help-yes', function () { setHelped('helped'); h.ev('ch_helped', { v: 'helped' }); then(); });
    }

    function whoseTurn(ask) {
      var chips = (ask.kids || []).map(function (k) {
        var a = ANIMALS[k.animal] || '⭐';
        return '<button class="wq-btn wq-soft wqc-who" type="button" id="wqc-who-' + esc(k.chip) + '" data-chip="' + esc(k.chip) + '">'
          + '<span class="wq-ani" role="img" aria-label="' + esc(k.animal || '') + '">' + a + '</span> <b>' + esc(k.first) + '</b>'
          + (k.line2 ? '<small class="wqc-who2">' + esc(k.line2) + '</small>' : '')
          + (k.avatarLine ? '<small class="wqc-who2">' + esc(t.whoPlayedHere) + '</small>' : '') + '</button>';
      }).join('');
      // A child who is not remembered (a cousin, a third sibling) never has to tap someone else's name to start:
      // "Someone else" opens this hub with nobody picked, and no run starts here.
      var other = '<button class="wq-btn wq-soft" type="button" id="wqc-who-else">' + esc(t.whoSomeoneElse) + '</button>';
      h.show('whose-turn', h.jug('hello', t.whoTurn, true) + '<p class="wq-sub">' + esc(t.whoTapName) + '</p><div class="wq-stack">' + chips + other + '</div>');
      (ask.kids || []).forEach(function (k) { h.on('wqc-who-' + k.chip, function () { pick(k.chip); }); });
      h.on('wqc-who-else', function () { if (h.boot && h.boot.token) location.href = '/h/' + encodeURIComponent(h.boot.token) + '?from=home'; });
    }
    function pick(chip) {
      try {
        var u = new URL(location.href);
        u.searchParams.set('kid', chip);
        location.href = u.toString();
      } catch (e) { /* stays on the question */ }
    }

    function onItsWay() {
      h.S.data = null;
      h.show('on-its-way', h.jug('hello', t.nextOnItsWay, true) + home());
      h.on('wqc-menu', h.refreshMenu);
    }

    // a listening story still being recorded: a friendly line (today's), a few quiet retries, never a dead screen
    function gettingReady(ex) {
      var line = h.t.listenWrong || h.t.wrong;
      h.show('getting-ready', h.jug('hello', line, true) + '<div class="wq-stack">' + btn('wqc-retry', h.t.again) + btn('wqc-menu', h.backLabel(), 'wq-soft') + '</div>');
      h.on('wqc-retry', function () { tries = 0; h.open(ex); });
      h.on('wqc-menu', h.refreshMenu);
      if (tries < CLIP_TRIES) { tries += 1; setTimeout(function () { if (h.S.screen === 'getting-ready') h.open(ex); }, 2000 * Math.pow(2, tries - 1)); }
    }

    /** The serve came back (open(ex)): the server decides; the page renders. */
    function opened(ex, d, intro) {
      if (d && d.ask === 'whose_turn') { h.S.data = null; whoseTurn(d); return; }
      if (story && story.ex === ex) { storyOpened(ex, d, intro); return; }
      if (outcome(d) === 'on_its_way') { onItsWay(); return; }
      if (ex === 'listen' && !(d.story_clip && d.story_clip.url)) { gettingReady(ex); return; }
      tries = 0;
      h.S.data = d;
      if (d.clips && isWarmup(d)) d.clips = Object.assign({}, d.clips, { intro: { text: t.warmupSay, url: null } });
      h.ev('ch_start', { step: ex });
      // a replayed read (practice, never a counted one or a class round) may be heard first, word by word (hear_first)
      if (ex === 'read' && d.hear_first && d.practice_round === true && !d.round_turn) { raLoad(); hearAsk(intro); return; }
      // never in the teacher's class round (round_turn): that run is never a record, and the child holds the teacher's phone
      if (!d.practice_round && !d.round_turn && !helped()) helpAsk(intro); else intro();
    }
    function openFailed(ex, e) {
      // a refused story id (any 400), a story that is gone (404) or no network: the room's "on its way"
      if (story && story.ex === ex && (!e || !e.status || e.status === 400 || e.status === 404)) { storyWait(); return true; }
      if (e && e.status === 503 && (e.message === 'getting_ready')) { gettingReady(ex); return true; }
      return false;
    }

    /** The menu itself may ask "Whose turn?" (a scored route on a phone with two children and no tap). */
    function menu() {
      var m = h.md();
      if (m && m.ask === 'whose_turn') { whoseTurn(m); return true; }
      if (storyRoom(m)) return true;
      // a stop opened by URL (#read): the serve decides what it is (whose turn / practice / on its way), never the hash
      var hash = deep;
      deep = null;
      // the new home's Next tile (#next: the first game not done; #numbers: the warm-up) starts that one game; the list
      // it comes back to is "Jugnu's games", never the Trail
      if (hash === 'next' || hash === 'numbers') {
        games = true;
        var xs = m.exercises || [];
        var x = hash === 'numbers' ? xs.filter(isWarmup)[0] || xs.filter(function (s) { return s.id === 'missing'; })[0] : xs.filter(function (s) { return !s.badge; })[0];
        if (x) { h.open(x.id); return true; }
        return false;
      }
      // a game opened by its own id (a tile's link: the ranked tile, a Games door row) is the same: the list draws no Next
      if (hash && (m.exercises || []).some(function (x) { return x.id === hash; })) { games = true; h.open(hash); return true; }
      return false;
    }
    // Story Time (?room=story&pid=…, web_quiz_challenge_story): the story named by the link is asked for once (the
    // read, or the listen when the link says ex=listen); with no pid the room says its banner and that a new story
    // is on its way. Back from a story the menu is the trail (the story id goes on no other request).
    function storyRoom(m) {
      if (roomUsed) { story = null; return false; }
      var qp = null;
      try { qp = new URL(location.href).searchParams; } catch (e) { qp = null; }
      if (!qp || qp.get('room') !== 'story' || !(m && m.v2 && m.v2.story)) return false;
      var pid = qp.get('pid');
      if (pid) {
        roomUsed = true;
        story = { ex: qp.get('ex') === 'listen' ? 'listen' : 'read', pid: pid };
        h.open(story.ex);
        return true;
      }
      storyWait();
      return true;
    }
    function storyWait() {
      h.S.data = null;
      h.show('story', '<p class="wqc-banner" id="wqc-story-banner">' + esc(t.storyBanner) + '</p>' + h.jug('hello', t.nextOnItsWay, true) + home());
      h.on('wqc-menu', function () { try { var u = new URL(location.href); u.searchParams.delete('room'); u.searchParams.delete('pid'); location.href = u.toString(); } catch (e) { /* stays */ } });
    }
    // The story came back: only a practice run plays here (never a counted run from the room); a read needs its text
    // a grown-up's preview (the serve's practice_play): the read-along only, never the microphone
    function micless(d) { return !!(d && d.practice_play); }
    // what follows the read-along: the normal read (the microphone), or on a preview the story's end card
    function afterAlong() { return micless(h.S.data) ? function () { storyEnd('read-result', false); } : h.read; }
    function storyOpened(ex, d, intro) {
      if (!d || outcome(d) === 'on_its_way' || d.practice_round !== true || (ex === 'read' && !(d.story && d.story.text))) { storyWait(); return; }
      if (ex === 'read' && micless(d) && !(clipUrl(d) || d.readalong)) { storyWait(); return; }   // nothing to hear yet
      if (ex === 'listen' && !clipUrl(d)) { gettingReady(ex); return; }
      tries = 0;
      d.story_room = true;
      if (!d.lr3) d.live = false;   // no words-a-minute bar in Story Time (live reading v3 keeps the words lighting, no meter)
      h.S.data = d;
      h.ev('ch_start', { step: ex });
      if (ex === 'read' && d.readalong) raLoad();   // fetched now, so the child's tap can start the voice
      if (ex === 'read' && (clipUrl(d) || d.readalong)) storyAsk(); else intro();
    }
    // a practice read: "hear it from me first, or read it yourself" — two equal answers; both end at the read's intro
    function hearAsk(intro) {
      h.show('hear-ask', h.jug('hello', t.storyAsk, true) + '<div class="wq-stack">'
        + btn('wqc-hear-along', t.storyReadAlong) + btn('wqc-hear-read', h.t.ready) + '</div>');
      h.on('wqc-hear-along', function () {
        var d = h.S.data;
        if (window.WQReadAlong) timedAlong(d.hear_first, intro);
        else if (raLoad.asked && !raLoad.failed) alongWait(d, d.hear_first, intro, intro);   // the player is on its way
        else intro();
        unwarm();
      });
      h.on('wqc-hear-read', function () { unwarm(); intro(); });
      warm();
    }
    // two equal answers, neither pressed until a tap
    function storyAsk() {
      // a preview: the one answer (Jugnu reads it; the tap starts the voice), never "read it yourself"
      if (micless(h.S.data)) {
        h.show('story-ask', h.jug('hello', t.storyReadAlong, true) + '<div class="wq-stack">' + btn('wqc-story-along', h.t.listenGo).replace('type="button"', 'type="button" data-primary') + '</div>');
        h.on('wqc-story-along', function () { readAlong(); unwarm(); });
        warm();
        return;
      }
      h.show('story-ask', h.jug('hello', t.storyAsk, true) + '<div class="wq-stack">'
        + (window.WQJ ? btn('wqc-story-along', t.storyReadAlong).replace('type="button"', 'type="button" data-primary') + btn('wqc-story-read', h.t.ready, 'wq-soft') : btn('wqc-story-along', t.storyReadAlong) + btn('wqc-story-read', h.t.ready)) + '</div>'); // the kit (web_quiz_juice): one primary
      h.on('wqc-story-along', function () { readAlong(); unwarm(); });
      h.on('wqc-story-read', function () { unwarm(); h.read(); });
      warm();
    }
    // the words as printed when they line up with the tokens; the lines as the serve gives them
    function alongWords(st) {
      var tk = (st.tokens && st.tokens.length ? st.tokens : String(st.text || '').split(/\s+/)).filter(function (w) { return String(w).trim(); });
      var printed = String(st.text || '').split(/\s+/).filter(function (w) { return w.trim(); });
      return printed.length === tk.length ? printed : tk;
    }
    function alongHtml(ws, lines, at) {
      var ln = lines[at] || { from: 0, to: ws.length - 1 };
      return ws.map(function (w, i) { return '<span class="wqc-w' + (i >= ln.from && i <= ln.to ? ' wqc-next' : '') + '">' + esc(w) + '</span>'; }).join(' ');
    }
    function raLoad() {
      if (window.WQReadAlong || raLoad.asked) return;
      raLoad.asked = true;
      try {
        var s = document.createElement('script');
        s.src = '/wq/wq-readalong.js?v=' + RA_V;
        s.addEventListener('load', warm);
        s.addEventListener('load', function () { raLanded(true); });
        s.addEventListener('error', function () { raLanded(false); });
        document.head.appendChild(s);
      } catch (e) { raLoad.failed = true; /* the line-lit read-along stays */ }
    }
    // the player's script landed (or failed): a "Read along" tap that came before it goes on now
    var raWaits = [];
    function raLanded(ok) {
      if (!ok) raLoad.failed = true;
      raWaits.splice(0).forEach(function (fn) { fn(ok); });
    }
    // the ask screen is where the story is listened to: its clip may preload (one request, no decode, never a play)
    // so the child's tap starts the voice at once; once per timing object, and only while the ask is on screen
    function warm() {
      var d = h.S.data;
      var ra = d && (d.readalong || d.hear_first);
      if (!ra || warm.d === ra || !window.WQReadAlong || !window.WQReadAlong.preload || !/^(story|hear)-ask$/.test(h.S.screen)) return;
      warm.d = ra;
      try { warm.a = window.WQReadAlong.preload(ra); } catch (e) { /* the tap still plays */ }   // held: a dropped element may stop its request
    }
    // the ask answered: the warmed element is let go (after the player's own play() has asked for the clip)
    function unwarm() {
      var a = warm.a;
      warm.a = null;
      try { if (a) { a.removeAttribute('src'); a.load(); } } catch (e) { /* gone */ }
    }
    // Read along, word by word (the serve's `readalong` and the player loaded): Jugnu reads at a child's pace, the
    // green pill on each word as it is spoken; play/pause, replay, tap a word to hear it from there. Nothing moves on
    // by itself: "I'm ready" goes to the normal read whenever the child is.
    function timedAlong(ra, next) {
      h.show('story-along', h.jug('hello', t.storyReadAlong, true) + '<div id="wqc-along-ra"></div>'
        + '<div class="wqc-sticky">' + btn('wqc-along-read', h.t.ready) + '</div>');
      var p = window.WQReadAlong.mount(h.q('wqc-along-ra'), ra, { labels: t.ra });
      h.on('wqc-along-read', function () { try { p.destroy(); } catch (e) { /* gone */ } next(); });
      p.play();   // inside the child's tap: the in-app browser's audio unlock
    }
    // Read along: the story clip plays, the line it is on is lit, then the normal read (the microphone, the story)
    function readAlong() {
      var d = h.S.data;
      if (d.readalong && window.WQReadAlong) { timedAlong(d.readalong, afterAlong()); return; }
      // the player was asked for when the story opened and is still on its way (a quick tap on a slow phone): the
      // along screen waits for it, never the old clip, and Jugnu reads word by word the moment it lands
      if (d.readalong && raLoad.asked && !raLoad.failed) { alongWait(d, d.readalong, afterAlong(), lineAlong); return; }
      lineAlong(d);
    }
    // the passage's words wait on the along screen for the player (ra: its timings; next: after "I'm ready"); a player
    // that fails or is not here in time: fallback(d)
    function alongWait(d, ra, next, fallback) {
      var st = d.story || {};
      var over = false;
      var end = function (ok) {
        if (over) return;
        over = true;
        if (h.S.data !== d || h.S.screen !== 'story-along') return;
        if (ok && window.WQReadAlong) timedAlong(ra, next); else fallback(d);
      };
      h.show('story-along', h.jug('hello', t.storyReadAlong, true) + '<div id="wqc-along-ra">'
        + (st.text ? '<div class="wqc-story" dir="' + (st.dir === 'rtl' ? 'rtl' : 'ltr') + '" lang="' + L + '">' + esc(st.text) + '</div>' : '') + '</div>'
        + '<div class="wqc-sticky">' + btn('wqc-along-read', h.t.ready) + '</div>');
      h.on('wqc-along-read', function () { over = true; next(); });
      raWaits.push(end);
      setTimeout(function () { end(false); }, RA_WAIT_MS);
    }
    function lineAlong(d) {
      // with word timings on the serve (their player failed or came too late) nothing moves on by itself: only "I'm ready"
      var stay = !!d.readalong;
      if (!clipUrl(d) && !stay) { afterAlong()(); return; }
      var st = d.story;
      var ws = alongWords(st);
      var lines = (st.lines && st.lines.length) ? st.lines : [{ from: 0, to: ws.length - 1 }];
      var at = 0;
      h.show('story-along', h.jug('hello', t.storyReadAlong, true)
        + '<div class="wqc-story" id="wqc-along-story" dir="' + (st.dir === 'rtl' ? 'rtl' : 'ltr') + '" lang="' + L + '">' + alongHtml(ws, lines, 0) + '</div>'
        + '<div class="wqc-sticky">' + btn('wqc-along-read', h.t.ready) + '</div>');
      var a = null;
      var over = false;
      var cap = null;
      var go = function () {
        if (over) return;
        over = true;
        clearTimeout(cap);
        try { if (a) a.pause(); } catch (e) { /* already stopped */ }
        afterAlong()();
      };
      var light = function () {
        var dur = a && a.duration;
        if (!(dur > 0) || !isFinite(dur)) return;
        var w = Math.min(ws.length - 1, Math.floor((a.currentTime / dur) * ws.length));
        var k = 0;
        lines.forEach(function (ln, i) { if (w >= ln.from) k = i; });
        if (k === at) return;
        at = k;
        var el = h.q('wqc-along-story');
        if (el) el.innerHTML = alongHtml(ws, lines, at);
      };
      var halt = function () { try { if (a) a.pause(); } catch (e) { /* already stopped */ } };
      var end = stay ? halt : go;
      h.on('wqc-along-read', go);
      if (!clipUrl(d)) return;
      try {
        a = new Audio(clipUrl(d));
        a.addEventListener('timeupdate', light);
        a.addEventListener('ended', end);
        a.addEventListener('error', end);
        var p = a.play();
        if (p && p.catch) p.catch(end);
        if (!stay) cap = setTimeout(go, ALONG_CAP_MS);
      } catch (e) { end(); }
    }
    // the end of a story run: it can be read again, and the sticker line (never a number, never a score)
    // r: the read's result; the card gets it (its ranked next_offer), and the card after the story's questions too
    function storyEnd(name, qa, r, hold) {
      var d = h.S.data || {};
      if (r) { d.story_r = r; d.story_hold = !!hold; }
      if (name === 'read-result') d.story_qa = !!qa;
      var once = rfOnce(name);
      if (window.WQJ && once) window.WQJ.finish({ kind: name });
      // the story's own result, when the page handed it over (data.story_r), carries the ranked Next
      // folded, a practice run (Story Time is one) puts no sticker in the Book, so it says none
      var rf = rfHtml(d.story_r, !once, null, null, d.story_hold);
      if (fold()) { var sd = h.S.data || {}; foldEnd(name, h.jug('celebrate', t.storyAgain, true) + rf + (sd.practice_round ? '' : '<p class="wq-sub" id="wqc-sticker">⭐ ' + esc(t.endSticker) + '</p>'), !!qa, (sd.story_r && sd.story_r.next_offer) || sd.next_offer, { name: name, story: true, t: t, r: sd.story_r }); rfSound(once && rf); return; }
      h.show(name, h.jug('celebrate', t.storyAgain, true) + rf + '<p class="wq-sub" id="wqc-sticker">⭐ ' + esc(t.endSticker) + '</p>'
        + '<div class="wq-stack">' + wordsBtn() + (qa ? h.qaButtons() : btn('wqc-menu', toGames())) + '</div>');
      h.on('wqc-menu', h.refreshMenu);
      rfSound(once && rf);
      if (qa) h.on('wqc-qa', function () { h.qa().open(); });
      wordsAfter(function () { storyEnd(name, qa, r, hold); });
      if (window.WQFC) window.WQFC.trailEnd(h, { name: name, story: true, t: t, r: d.story_r });
    }
    // "Show me the words" after a practice listen's questions (show_words; never a counted listen or a class round):
    // the words are asked for by the run token only now, after the questions; the card is drawn again with the button
    // once they are here (and the player script), so the tap itself starts the voice
    function wordsOk(d) { return d && d.ex === 'listen' && d.show_words === true && d.practice_round === true && !d.round_turn; }
    function wordsBtn() { var d = h.S.data; return wordsOk(d) && d.words_ra && window.WQReadAlong ? btn('wqc-show-words', t.showWords) : ''; }
    function wordsAfter(redraw) {
      var d = h.S.data;
      if (!wordsOk(d)) return;
      if (d.words_ra) { if (window.WQReadAlong) h.on('wqc-show-words', function () { showWords(d.words_ra); }); return; }
      askWords(d, redraw);
    }
    // the passage's timings, asked for once by the run token (d.words_ra); redraw() once they and the player are here.
    // A read run asks only after its recording has gone up (d.sent); while the server is still checking it (409) the
    // page asks again after 1, 2 and 4 s, and stops when the card is gone
    function askWords(d, redraw) {
      if (d.words_asked) return;
      d.words_asked = true;
      raLoad();
      var shown = h.S.screen;
      var waits = [1000, 2000, 4000];
      var here = function () { return h.S.data === d && h.S.screen === shown; };
      var ask = function () {
        fetch('/api/wq/ch/words/' + encodeURIComponent(d.ct) + '?lang=' + L, { credentials: 'same-origin' })
          .then(function (r) {
            if (r.status === 409 && waits.length && here()) { setTimeout(function () { if (here()) ask(); }, waits.shift()); return null; }
            return r.ok ? r.text().then(function (x) { try { return JSON.parse(x); } catch (e) { return null; } }) : null;
          })
          .then(got, function () { /* no words: the card stays as it is */ });
      };
      if (d.ex === 'read' && d.sent && typeof d.sent.then === 'function') d.sent.then(ask, ask); else ask();
      function got(j) {
        if (!j || !j.readalong || h.S.data !== d) return;
        d.words_ra = j.readalong;
        var tries = 0;
        // the player script may still be on its way: look again for a short while, then leave the card as it is
        (function again() {
          if (h.S.data !== d || h.S.screen !== shown) return;
          if (window.WQReadAlong) { redraw(); return; }
          if ((tries += 1) <= 20) setTimeout(again, 150);
        }());
      }
    }
    function showWords(ra) {
      h.show('listen-words', h.jug('hello', t.storyReadAlong, true) + '<div id="wqc-along-ra"></div>'
        + '<div class="wq-stack">' + btn('wqc-menu', toGames()) + '</div>');
      var p = window.WQReadAlong.mount(h.q('wqc-along-ra'), ra, { labels: t.ra });
      h.on('wqc-menu', function () { try { p.destroy(); } catch (e) { /* gone */ } h.refreshMenu(); });
      p.play();   // inside the child's tap
    }
    // a stop's minutes and microphone line: in Urdu, Urdu digits and the mic on its own line (no Latin middot)
    function stopLine(x, wait, micLine) {
      var mic = x.mic && !wait;
      if (L !== 'ur') return esc(h.t.mins(x.mins)) + (mic ? ' · 🎤 ' + esc(micLine) : '');
      var n = String(x.mins).replace(/[0-9]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.charAt(+d); });
      return esc(n + ' منٹ') + (mic ? '<br>🎤 ' + esc(micLine) : '');
    }
    // the map's line under the title: no count (one vs many stops still waiting), nothing when none waits
    // the trail's server lines that say «پڑاؤ» or a count, replaced under v2 by the ruled copy (jg.trail.*)
    var TRAIL_OVER = { practice: 'trailPractice', micWait: 'trailMicWait', other: 'trailOther', stopDone: 'trailStopDone' };
    // a teacher's own visit (teacher_preview) says nothing counts on their phone; a story run's practice banner is Story Time's own
    function trailCopy(k) {
      if (k === 'practice' && h.S.data && h.S.data.teacher_preview) return t.teacherPractice;
      if (k === 'practice' && isStory()) return t.storyBanner;
      // the newer games page is "Jugnu's games" on every entry, never the Trail (the server's copy stays the old page's)
      if (k === 'title') return t.gamesTitle;
      if (k === 'back') return t.gamesBack.split('{name}').join((h.boot && h.boot.mascot) || (L === 'ur' ? 'جگنو' : 'Jugnu'));
      return TRAIL_OVER[k] ? t[TRAIL_OVER[k]] : null;
    }
    function trailSub(xs) {
      if (games) return t.gamesPick;
      var waiting = xs.filter(function (x) { return !x.badge; }).length;
      return waiting === 0 ? '' : (waiting === 1 ? t.gamesWaitOne : t.gamesWaitMany);
    }
    // ── the stop's intro ──
    // the passage's title on a read or listen stop, one line; no title object ⇒ no line (today's intro)
    function introTitle(d) {
      if (!d || (d.ex !== 'read' && d.ex !== 'listen') || !d.title || typeof d.title !== 'object') return '';
      var pick = function (v) { return typeof v === 'string' && v.trim() ? v : null; };
      var line = (L === 'ur' ? pick(d.title.ur) || pick(d.title.en) : pick(d.title.en)) || pick(d.name);
      return line ? '<p class="wq-sub" id="wqc-ptitle">' + esc(line) + '</p>' : '';
    }
    // a re-served record: the welcome-back line in place of the intro line; null ⇒ today's intro (and in Urdu)
    function introLine(d) { return d && d.reopened === true && t.welcomeBack ? t.welcomeBack : null; }
    function stops(xs) {
      return xs.map(function (x) { return x.anchor_block ? Object.assign({}, x, { name: t.warmupTitle }) : x; });
    }

    // ── the mic notice: once per child per phone, before the microphone is asked for ──
    var NOTICE_KEY = 'wq_notice_v';
    function noticeKey() { return h.boot && h.boot.kid ? NOTICE_KEY + ':' + h.boot.kid : null; }
    // the phone's mirror of the server's record (a failed server write never shows it twice); no chip, no mirror
    function noticeSeenHere(v) {
      var k = noticeKey();
      if (!k) return false;
      try { return window.localStorage.getItem(k) === String(v); } catch (e) { return false; }
    }
    function noteNoticeHere(v) {
      var k = noticeKey();
      if (!k) return;
      try { window.localStorage.setItem(k, String(v)); } catch (e) { /* the server's record still holds */ }
    }
    function noticeLine(name) {
      var n = String(name || '');
      // the Urdu deck line already isolates {name} (U+2068…U+2069): the name goes in as it is
      return t.noticeT.split('{name}').join(n);
    }
    // then: the microphone, exactly as the stop would have gone on (micStart). false = no notice, go on now.
    // under live reading v3 (the payload's lr3) the words and the mark are the live reader's: one notice for the storybook's
    // sheet and the passage, shown on whichever is the child's first microphone use (WQLiveRead.noticeSeen / noticeMark)
    function lrNotice(d) { var LR = window.WQLiveRead; return d.lr3 && LR && LR.noticeText ? LR : null; }
    function notice(then) {
      var d = h.S.data;
      if (!d || !d.v2 || !d.v2.consent || !d.v2.notice || noticeRun === d.ct) return false;
      var LR = lrNotice(d);
      var kid = h.boot && h.boot.kid;
      if (LR ? LR.noticeSeen(kid, true) : noticeSeenHere(d.v2.notice)) return false;
      var v = d.v2.notice;
      // one card, one control: nothing to choose, nothing preselected
      h.show('mic-notice', h.jug('hello', LR ? LR.noticeText(L, true) : noticeLine(d.v2.name), true) + '<div class="wq-stack">' + btn('wqc-notice-ok', t.noticeOk) + '</div>');
      h.on('wqc-notice-ok', function () { noticeRun = d.ct; if (LR) LR.noticeMark(kid, true); else noteNoticeHere(v); then(); });
      return true;
    }
    function consent(b) {
      var d = h.S.data;
      if (d && d.v2 && d.v2.consent && noticeRun && noticeRun === d.ct) b.audio_consent = 'notice_shown';
      return b;
    }
    function withHelped(b) {
      var v = helped();
      if (v) b.helped = v;
      return consent(b);
    }

    // ── end cards: what was done, never a number ──
    function endCard(name, pose, line, extra) {
      var d = h.S.data || {};
      var r = extra || {};
      var nx = r.next || d.next;
      // a class round turn (round_turn): no sticker line (a round run is no counted stop of the child's own), and the
      // one button hands the phone back to the round page (jg.round.c_handback); no Home
      var round = !!d.round_turn;
      // sticker false: the server judged it not a reading (an implausible check) — no sticker went into the Book
      var sticker = !round && !d.practice_round && !r.noSticker && r.sticker !== false ? '<p class="wq-sub" id="wqc-sticker">⭐ ' + esc(t.endSticker) + '</p>' : '';
      var next = nx && nx.title ? '<p class="wq-sub" id="wqc-next">' + esc(t.endNext(nx.title)) + '</p>' : '';
      var b3 = (r.read_along_first || d.read_along_first) ? '<p class="wq-sub" id="wqc-b3">' + esc(t.endB3Next) + '</p>' : '';
      // hold: a live reading's card before the server's result settles: the listening line, and no button the result
      // could change (no again, no questions; Home only when the questions are off, the same Home in both results)
      var hold = !!r.hold;
      var wait = hold ? '<p class="wq-sub" id="wqc-listening">' + esc(h.t.listening) + '</p>' : '';
      var again = r.again && !hold ? btn('wqc-again', h.t.again, 'wq-soft') : '';
      // the questions about the story read still follow a reading (today's step; its own back button)
      var qa = r.qa && !hold ? h.qaButtons() : '';
      var home = hold && d.questions_on ? '' : btn('wqc-menu', toGames());
      // the sound + motion kit (web_quiz_juice): the finish beat on a card that celebrates
      var once = rfOnce(name + '|' + pose);
      if (window.WQJ && pose === 'celebrate' && once) window.WQJ.finish({ kind: name });
      if (round) {
        h.show(name, h.jug(pose, line, true) + wait + '<div class="wq-stack">' + btn('wqc-handback', d.round_handback || '') + '</div>');
        h.on('wqc-handback', function () { if (d.round_back) location.href = d.round_back; else { try { history.back(); } catch (e) { /* stays */ } } });
        return;
      }
      // folded, the card has no Try again of its own: a 0-word try gets it in the moment
      var rf = rfHtml(r, !once, line, fold() && r.again && !hold ? h.t.again : null, hold);
      if (fold()) { foldEnd(name, h.jug(pose, line, true) + wait + rf + sticker, !!(r.qa && !hold), r.next_offer || d.next_offer, { name: name, line: line, r: r, t: t }); rfSound(once && rf); return; }
      h.show(name, h.jug(pose, line, true) + wait + rf + sticker + next + b3 + '<div class="wq-stack">' + wordsBtn() + (qa || home) + again + '</div>');
      rfSound(once && rf); rfAgain(rf, d);
      h.on('wqc-menu', h.refreshMenu);
      if (r.again) h.on('wqc-again', function () { h.open(d.ex); });
      if (r.qa) h.on('wqc-qa', function () { h.qa().open(); });
      wordsAfter(function () { endCard(name, pose, line, extra); });
      if (window.WQFC) window.WQFC.trailEnd(h, { name: name, line: line, r: r, t: t });
    }
    // the reading moment (web_quiz_read_feedback, wq-moment.js): the read answered on its card — the words, Jugnu's jar
    // of lights with the speed beside it, stars, the child's own last read, a badge. r.rf: the read as the page knows it
    // (the live count, then the checked result). Key off, file not here or a class round: nothing (today's card)
    // still: a redraw of a result already answered (the moment laid in without its motion again); said: Jugnu's line;
    // retry: the Try again label (folded 0-word card); hold: a card before the check (no "read it again" offer yet)
    var rfFb = null;
    function rfHtml(r, still, said, retry, hold) {
      rfFb = null;
      var md = h.md() || {};
      if (md.read_feedback !== true || !window.WQMoment || !r || !r.rf || (h.S.data || {}).round_turn) return '';
      rfFb = window.WQMoment.feedback(r.rf);
      return window.WQMoment.card(rfFb, L, { grade: md.form, still: still, said: said, retry: retry, hold: hold });
    }
    // once per result (key on): the finish beat and Jugnu's sound on a result's first card only; the checked redraw and
    // the words redraw lay the card in silently. Key off: every draw, as today
    function rfOnce(name) {
      if ((h.md() || {}).read_feedback !== true || !window.WQMoment || !window.WQMoment.once) return true;
      return window.WQMoment.once(((h.S.data || {}).ct || '') + '|' + name);
    }
    function rfAgain(rf, d) { if (rf) h.on('wqc-rfagain', function () { h.open(d.ex); }); }
    // Jugnu's sound for it: the badge jingle after a read (after the finish fanfare), the soft chime after a 0-word try
    function rfSound(rf) {
      if (!rf || !rfFb || !window.WQMoment) return;
      var fb = rfFb, J = window.WQJ, go = function () { window.WQMoment.sound(document.querySelector ? document.querySelector('[data-rf]') : null, fb); };
      if (J && J.after && !fb.zero) J.after(1200, go); else go();
    }
    function storyLen(d) { return (d && d.story && d.story.tokens && d.story.tokens.length) || 0; }
    // heard: a live reading's words heard; when given, it chooses the line (all = 90% of the story's words heard)
    // hold: the card waits for the server's result (endCard); true back = held, the page draws the settled card later
    function readEnd(r, words, heard, hold) {
      var d = h.S.data || {};
      if (window.WQFC && (h.md() || {}).card_v3 && window.WQFC.unheard(r, words, heard, storyLen(d))) { endCard('read-result', 'hello', window.WQFC.triedLine(L, r), Object.assign({}, r || {}, { again: !(r && r.later), qa: false, noSticker: true, tried: true, hold: !!hold })); return !!hold; }
      if (isStory()) {
        var heard = r && !r.failed && !r.later && r.score && (r.score.attempted != null ? r.score.attempted : r.score.correct) > 0;
        storyEnd('read-result', !!(heard && d.questions_on), r, hold);
        return;
      }
      if (r && r.later) { endCard('read-result', 'hello', h.t.later, r); return; }
      var n = words != null ? words : (r && r.score ? (r.score.attempted != null ? r.score.attempted : r.score.correct) : 0);
      var byHeard = heard != null;
      var zero = !r || r.failed || !(n > 0) || (byHeard && !(heard > 0));
      var all = !zero && storyLen(d) > 0 && (byHeard ? heard >= 0.9 * storyLen(d) : n >= storyLen(d));
      var ex = Object.assign({}, r || {}, { again: zero, qa: !zero && !!d.questions_on, hold: !!hold });
      endCard('read-result', zero ? 'hello' : 'celebrate', zero ? t.endZeroWords : (all ? t.endReadAll : t.endReadSome), ex);
      return !!hold;
    }
    // a live reading's first card, before the server answers (the story room draws at once, as today)
    function readHold(r, words, heard) { return readEnd(r, words, heard, true) === true; }
    // a live story read's checked result came after its card: the card gets the ranked next thing (finish card only)
    function storySettled(r) {
      var d = h.S.data || {};
      if (!isStory() || !r || !r.next_offer || h.S.screen !== 'read-result' || (d.story_r && d.story_r.next_offer)) return;
      // the reading moment (key on) stays on the redrawn card, now with the checked speed
      if (window.WQFC && (h.md() || {}).card_v3) storyEnd('read-result', !!d.story_qa, (h.md() || {}).read_feedback === true && !r.rf && r.score ? Object.assign({}, r, { rf: r }) : r);
    }
    // s: the server's score for bigger / missing; a run stopped early did not answer every question, so the card
    // never says it did: the sticker line alone (a first counted run), or today's "Stop done!" on a practice round
    function tapEnd(name, s) {
      var d = h.S.data || {};
      if (isStory()) { storyEnd(name, false); return; }
      if (s && s.stopped && !isWarmup(d)) {
        var line0 = !d.practice_round && !d.round_turn ? t.endSticker : h.tc('stopDone');
        endCard(name, 'hello', line0, { noSticker: true });
        return;
      }
      var line = isWarmup(d) ? t.warmupDone : (d.ex === 'listen' ? t.endListen : t.endTap);
      endCard(name, 'celebrate', line, {});
    }

    return { games: function () { return games; }, opened: opened, openFailed: openFailed, menu: menu, stops: stops, stopLine: stopLine, trailSub: trailSub, trailCopy: trailCopy, notice: notice, consent: consent, withHelped: withHelped,
      readEnd: readEnd, readHold: readHold, storySettled: storySettled, tapEnd: tapEnd, storyQs: storyQs, isStory: isStory, introTitle: introTitle, introLine: introLine, T: T };
  }

  window.WQTRAIL = { init: init, T: T };
})();
