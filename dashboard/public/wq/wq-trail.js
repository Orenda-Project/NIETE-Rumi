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
 * Copy: copy.v2.json keys (jg.*), camelCase of the key tail; gender-neutral; no number about the child.
 */
(function () {
  'use strict';
  var T = {
    en: {
      helpQ: 'Is someone helping you today?', helpAlone: 'No, on my own', helpWith: 'Yes, someone is helping', helpNote: 'You get the sticker both ways.',
      // jg.keep.notice / jg.keep.notice_ok (deck v2.3, bot/shared/config/copy.v2.json): the mic notice, {name} = the child's first name
      noticeT: 'Jugnu keeps this reading to see how {name} is learning. One checker may listen. A grown-up can remove the phone number any time by sending STOP on WhatsApp; the reading stays.',
      noticeOk: 'Got it',
      whoTurn: 'Whose turn?', whoTapName: 'Tap your name.', whoPlayedHere: 'Played on this phone before', whoSomeoneElse: "My name isn't here",
      nextOnItsWay: 'A new story is on its way.',
      endReadAll: 'You read the whole story!', endReadSome: 'You read out loud with Jugnu!', endZeroWords: 'You tried a whole new story!',
      endListen: 'You listened to the whole story!', endTap: 'You answered all the questions!', endSticker: 'A sticker went into your Book.',
      endB3Next: 'Next time Jugnu can read a story with you first.', endNext: function (title) { return 'Next: ' + title; }, endHome: 'Home',
      trailPractice: 'Playing again: just for fun', trailMicWait: 'This game needs the mic. Play it when the mic is on.', trailOther: 'Try another game', trailStopDone: 'Game done!',
      lanternTrailOne: 'A game is waiting for you on the Trail.', lanternTrailMany: 'Games are waiting for you on the Trail.',
      storyBanner: 'Story Time: just for fun',
      storyAsk: 'Hear it from me first, or read it yourself.', storyReadAlong: 'Read along with Jugnu', storyAgain: 'Read this story again any time.',
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
      noticeT: 'جگنو یہ ریکارڈنگ رکھتا ہے تاکہ ⁨{name}⁩ کی پڑھائی دیکھی جا سکے۔ اسے صرف ایک جانچنے والا سن سکتا ہے۔ گھر کے بڑے کسی بھی وقت ⁦STOP⁩ بھیج کر فون نمبر ہٹا سکتے ہیں، ریکارڈنگ پھر بھی رہے گی۔',
      noticeOk: 'ٹھیک ہے',
      whoTurn: 'کس کی باری ہے؟', whoTapName: 'اپنا نام دبائیں۔', whoPlayedHere: 'پہلے بھی اسی فون پر کھیلا گیا', whoSomeoneElse: 'میرا نام یہاں نہیں',
      nextOnItsWay: 'ایک نئی کہانی آنے والی ہے۔',
      endReadAll: 'آپ نے پوری کہانی پڑھ لی!', endReadSome: 'آپ نے جگنو کے ساتھ اونچی آواز میں پڑھا!', endZeroWords: 'آپ نے ایک بالکل نئی کہانی کھول کر دیکھی!',
      endListen: 'آپ نے پوری کہانی سن لی!', endTap: 'آپ نے سارے سوالوں کے جواب دے دیے!', endSticker: 'آپ کی کتاب میں ایک اسٹیکر لگ گیا۔',
      endB3Next: 'اگلی بار جگنو پہلے آپ کے ساتھ کہانی پڑھ سکتا ہے۔', endNext: function (title) { return 'آگے: ⁨' + title + '⁩'; }, endHome: 'واپس جائیں',
      trailPractice: 'یہ کھیل دوبارہ: بس مزے کے لیے', trailMicWait: 'اس کھیل کے لیے مائیک چاہیے۔ مائیک چلنے پر کھیلیں۔', trailOther: 'کوئی اور کھیل کھیلیں', trailStopDone: 'کھیل مکمل!',
      lanternTrailOne: 'جگنو کے راستے پر ایک کھیل آپ کا انتظار کر رہا ہے۔', lanternTrailMany: 'جگنو کے راستے پر کھیل آپ کا انتظار کر رہے ہیں۔',
      storyBanner: 'کہانی کا وقت: بس مزے کے لیے',
      storyAsk: 'پہلے مجھ سے سن لیں، یا خود پڑھیں۔', storyReadAlong: 'جگنو کے ساتھ ساتھ پڑھیں', storyAgain: 'یہ کہانی جب چاہیں دوبارہ پڑھیں۔',
      warmupTitle: 'گنتی کا کھیل', warmupSay: 'چلیں، پہلے گنتی سے شروع کریں۔', warmupDone: 'گنتی کا کھیل مکمل!',
      // no welcomeBack: jg.trail.welcome_back has no Urdu line on this page yet, so an Urdu child sees today's intro
      // jg.t.practice (deck bytes, bot/shared/config/copy.v2.json)
      teacherPractice: 'مشق: ٹیچر کے فون پر کچھ بھی شمار نہیں ہوتا۔',
    },
  };
  var ANIMALS = { cat: '🐱', dog: '🐶', rabbit: '🐰', parrot: '🦜', fish: '🐟', turtle: '🐢', lion: '🦁', elephant: '🐘', owl: '🦉', butterfly: '🦋', bee: '🐝', horse: '🐴' };
  var HELP_KEY = 'wqc_helped_v2';
  var CLIP_TRIES = 3;
  var ALONG_CAP_MS = 180000;   // a WebView that never reports the clip's end still reaches the read

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
    function home() { return '<div class="wq-stack">' + btn('wqc-menu', t.endHome) + '</div>'; }
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
      if (hash && (m.exercises || []).some(function (x) { return x.id === hash; })) { h.open(hash); return true; }
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
    function storyOpened(ex, d, intro) {
      if (!d || outcome(d) === 'on_its_way' || d.practice_round !== true || (ex === 'read' && !(d.story && d.story.text))) { storyWait(); return; }
      if (ex === 'listen' && !clipUrl(d)) { gettingReady(ex); return; }
      tries = 0;
      d.story_room = true;
      d.live = false;   // no words-a-minute bar in Story Time
      h.S.data = d;
      h.ev('ch_start', { step: ex });
      if (ex === 'read' && clipUrl(d)) storyAsk(); else intro();
    }
    // two equal answers, neither pressed until a tap
    function storyAsk() {
      h.show('story-ask', h.jug('hello', t.storyAsk, true) + '<div class="wq-stack">'
        + btn('wqc-story-along', t.storyReadAlong) + btn('wqc-story-read', h.t.ready) + '</div>');
      h.on('wqc-story-along', readAlong);
      h.on('wqc-story-read', h.read);
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
    // Read along: the story clip plays, the line it is on is lit, then the normal read (the microphone, the story)
    function readAlong() {
      var d = h.S.data;
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
        h.read();
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
      h.on('wqc-along-read', go);
      try {
        a = new Audio(clipUrl(d));
        a.addEventListener('timeupdate', light);
        a.addEventListener('ended', go);
        a.addEventListener('error', go);
        var p = a.play();
        if (p && p.catch) p.catch(go);
        cap = setTimeout(go, ALONG_CAP_MS);
      } catch (e) { go(); }
    }
    // the end of a story run: it can be read again, and the sticker line (never a number, never a score)
    function storyEnd(name, qa) {
      h.show(name, h.jug('celebrate', t.storyAgain, true) + '<p class="wq-sub" id="wqc-sticker">⭐ ' + esc(t.endSticker) + '</p>'
        + '<div class="wq-stack">' + (qa ? h.qaButtons() : btn('wqc-menu', t.endHome)) + '</div>');
      h.on('wqc-menu', h.refreshMenu);
      if (qa) h.on('wqc-qa', function () { h.qa().open(); });
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
      return TRAIL_OVER[k] ? t[TRAIL_OVER[k]] : null;
    }
    function trailSub(xs) {
      var waiting = xs.filter(function (x) { return !x.badge; }).length;
      return waiting === 0 ? '' : (waiting === 1 ? t.lanternTrailOne : t.lanternTrailMany);
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
    function notice(then) {
      var d = h.S.data;
      if (!d || !d.v2 || !d.v2.consent || !d.v2.notice || noticeRun === d.ct || noticeSeenHere(d.v2.notice)) return false;
      var v = d.v2.notice;
      // one card, one control: nothing to choose, nothing preselected
      h.show('mic-notice', h.jug('hello', noticeLine(d.v2.name), true) + '<div class="wq-stack">' + btn('wqc-notice-ok', t.noticeOk) + '</div>');
      h.on('wqc-notice-ok', function () { noticeRun = d.ct; noteNoticeHere(v); then(); });
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
      var sticker = !d.practice_round && !r.noSticker ? '<p class="wq-sub" id="wqc-sticker">⭐ ' + esc(t.endSticker) + '</p>' : '';
      var next = nx && nx.title ? '<p class="wq-sub" id="wqc-next">' + esc(t.endNext(nx.title)) + '</p>' : '';
      var b3 = (r.read_along_first || d.read_along_first) ? '<p class="wq-sub" id="wqc-b3">' + esc(t.endB3Next) + '</p>' : '';
      var again = r.again ? btn('wqc-again', h.t.again, 'wq-soft') : '';
      // the questions about the story read still follow a reading (today's step; its own back button)
      var qa = r.qa ? h.qaButtons() : '';
      h.show(name, h.jug(pose, line, true) + sticker + next + b3 + '<div class="wq-stack">' + (qa || btn('wqc-menu', t.endHome)) + again + '</div>');
      h.on('wqc-menu', h.refreshMenu);
      if (r.again) h.on('wqc-again', function () { h.open(d.ex); });
      if (r.qa) h.on('wqc-qa', function () { h.qa().open(); });
    }
    function storyLen(d) { return (d && d.story && d.story.tokens && d.story.tokens.length) || 0; }
    function readEnd(r, words) {
      var d = h.S.data || {};
      if (isStory()) {
        var heard = r && !r.failed && !r.later && r.score && (r.score.attempted != null ? r.score.attempted : r.score.correct) > 0;
        storyEnd('read-result', !!(heard && d.questions_on));
        return;
      }
      if (r && r.later) { endCard('read-result', 'hello', h.t.later, r); return; }
      var n = words != null ? words : (r && r.score ? (r.score.attempted != null ? r.score.attempted : r.score.correct) : 0);
      var zero = !r || r.failed || !(n > 0);
      var all = !zero && storyLen(d) > 0 && n >= storyLen(d);
      var ex = Object.assign({}, r || {}, { again: zero, qa: !zero && !!d.questions_on });
      endCard('read-result', zero ? 'hello' : 'celebrate', zero ? t.endZeroWords : (all ? t.endReadAll : t.endReadSome), ex);
    }
    // s: the server's score for bigger / missing; a run stopped early did not answer every question, so the card
    // never says it did: the sticker line alone (a first counted run), or today's "Stop done!" on a practice round
    function tapEnd(name, s) {
      var d = h.S.data || {};
      if (isStory()) { storyEnd(name, false); return; }
      if (s && s.stopped && !isWarmup(d)) {
        var line0 = !d.practice_round ? t.endSticker : h.tc('stopDone');
        endCard(name, 'hello', line0, { noSticker: true });
        return;
      }
      var line = isWarmup(d) ? t.warmupDone : (d.ex === 'listen' ? t.endListen : t.endTap);
      endCard(name, 'celebrate', line, {});
    }

    return { opened: opened, openFailed: openFailed, menu: menu, stops: stops, stopLine: stopLine, trailSub: trailSub, trailCopy: trailCopy, notice: notice, consent: consent, withHelped: withHelped,
      readEnd: readEnd, tapEnd: tapEnd, storyQs: storyQs, isStory: isStory, introTitle: introTitle, introLine: introLine, T: T };
  }

  window.WQTRAIL = { init: init, T: T };
})();
