/*
 * The Trail page v2 (window.WQTRAIL), loaded by the Challenge page only when its menu payload carries `v2`
 * (web_quiz_challenge_v2 on). wq-challenge.js hands it its helpers once (init) and delegates a few points to it;
 * with `v2` absent this file is not even loaded and the Challenge page is today's.
 *
 *   help       "Is someone helping you today?" once per sitting, before the first scored stop (never before a
 *              practice round), nothing preselected; the answer rides every result as helped:'self'|'helped'.
 *   keep       after the microphone is on, a separate screen: may Jugnu keep this reading? (only when the payload
 *              says v2.consent); nothing preselected (the retention lines are held back pending a ruling); the answer rides the upload and the result as audio_consent.
 *   whose turn the serve answers ask:'whose_turn' → one chip per child, a tap reloads with kid=<chip>; never auto-picked.
 *   outcomes   on_its_way → a card, the stop stays closed (no run, no mic); lower_band → the ordinary passage screen.
 *   end cards  what was done (read all / read some / tried / listened / answered), the same sticker line for every
 *              first counted run, the next thing when the server names it — never words a minute, never a count.
 *   warm-up    a stop whose payload carries anchor_block is the Number warm-up (its own title and line).
 * Copy: copy.v2.json keys (jg.*), camelCase of the key tail; gender-neutral; no number about the child.
 */
(function () {
  'use strict';
  var T = {
    en: {
      helpQ: 'Is someone helping you today?', helpAlone: 'No, on my own', helpWith: 'Yes, someone is helping', helpNote: 'You get the sticker both ways.',
      keepQ: 'May Jugnu keep this reading to check that it heard right?',
      keepYes: 'Yes, keep it', keepNo: "No, don't keep it", keepEither: 'Jugnu listens either way.',
      whoTurn: 'Whose turn?', whoTapName: 'Tap your name.', whoPlayedHere: 'Played on this phone before', whoSomeoneElse: 'Someone else',
      nextOnItsWay: 'A new story is on its way.',
      endReadAll: 'You read the whole story!', endReadSome: 'You read out loud with Jugnu!', endZeroWords: 'You tried a whole new story!',
      endListen: 'You listened to the whole story!', endTap: 'You answered all the questions!', endSticker: 'A sticker went into your Book.',
      endB3Next: 'Next time Jugnu can read a story with you first.', endNext: function (title) { return 'Next: ' + title; }, endHome: 'Home',
      trailPractice: 'Playing again: just for fun', trailMicWait: 'This game needs the mic. Play it when the mic is on.', trailOther: 'Try another game', trailStopDone: 'Game done!',
      keepSubV2: 'Kept so one person can listen and confirm Jugnu heard right. A grown-up can say no.', keepAskGrownup: 'Ask a grown-up this one.',
      lanternTrailOne: 'A game is waiting for you on the Trail.', lanternTrailMany: 'Games are waiting for you on the Trail.',
      storyBanner: 'Story Time: just for fun',
      warmupTitle: 'Number warm-up', warmupSay: "Let's start with some numbers.", warmupDone: 'Warm-up done!',
    },
    ur: {
      helpQ: 'کیا آج آپ کو کسی کی مدد مل رہی ہے؟', helpAlone: 'نہیں، اپنے آپ', helpWith: 'جی ہاں، کسی کی مدد سے', helpNote: 'اسٹیکر دونوں طرح ملے گا۔',
      keepQ: 'کیا جگنو یہ ریکارڈنگ رکھ لے، تاکہ دیکھا جا سکے کہ جگنو نے ٹھیک سنا؟',
      keepYes: 'جی ہاں، رکھ لیں', keepNo: 'نہیں، نہ رکھیں', keepEither: 'جگنو دونوں صورتوں میں سنے گا۔',
      whoTurn: 'کس کی باری ہے؟', whoTapName: 'اپنا نام دبائیں۔', whoPlayedHere: 'پہلے بھی اسی فون پر کھیلا گیا', whoSomeoneElse: 'کوئی اور',
      nextOnItsWay: 'ایک نئی کہانی آنے والی ہے۔',
      endReadAll: 'آپ نے پوری کہانی پڑھ لی!', endReadSome: 'آپ نے جگنو کے ساتھ اونچی آواز میں پڑھا!', endZeroWords: 'آپ نے ایک بالکل نئی کہانی کھول کر دیکھی!',
      endListen: 'آپ نے پوری کہانی سن لی!', endTap: 'آپ نے سارے سوالوں کے جواب دے دیے!', endSticker: 'آپ کی کتاب میں ایک اسٹیکر لگ گیا۔',
      endB3Next: 'اگلی بار جگنو پہلے آپ کے ساتھ کہانی پڑھ سکتا ہے۔', endNext: function (title) { return 'آگے: ⁨' + title + '⁩'; }, endHome: 'واپس جائیں',
      trailPractice: 'یہ کھیل دوبارہ: بس مزے کے لیے', trailMicWait: 'اس کھیل کے لیے مائیک چاہیے۔ مائیک چلنے پر کھیلیں۔', trailOther: 'کوئی اور کھیل کھیلیں', trailStopDone: 'کھیل مکمل!',
      keepSubV2: 'یہ ریکارڈنگ اس لیے رکھی جاتی ہے تاکہ ایک شخص سن کر دیکھ سکے کہ جگنو نے ٹھیک سنا۔ گھر کے بڑے منع کر سکتے ہیں۔', keepAskGrownup: 'یہ سوال گھر کے بڑوں سے پوچھیں۔',
      lanternTrailOne: 'جگنو کے راستے پر ایک کھیل آپ کا انتظار کر رہا ہے۔', lanternTrailMany: 'جگنو کے راستے پر کھیل آپ کا انتظار کر رہے ہیں۔',
      storyBanner: 'کہانی کا وقت: بس مزے کے لیے',
      warmupTitle: 'گنتی کا کھیل', warmupSay: 'چلیں، پہلے گنتی سے شروع کریں۔', warmupDone: 'گنتی کا کھیل مکمل!',
    },
  };
  var ANIMALS = { cat: '🐱', dog: '🐶', rabbit: '🐰', parrot: '🦜', fish: '🐟', turtle: '🐢', lion: '🦁', elephant: '🐘', owl: '🦉', butterfly: '🦋', bee: '🐝', horse: '🐴' };
  var HELP_KEY = 'wqc_helped_v2';
  var CLIP_TRIES = 3;

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
        + 'html[lang="ur"] .wqt-v2 .wqc-pill,html[lang="ur"] .wqt-v2 small{font-size:20px}'
        // the keep answers: two equal columns, the same height
        + '.wqc-keep2{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:stretch}.wqc-keep2 .wq-btn{margin:0;min-height:56px;width:100%}';
      document.head.appendChild(st);
    } catch (e) { /* unstyled still works */ }
  }

  function init(h) {
    css();
    try { var rootEl = document.getElementById('wq'); if (rootEl && rootEl.classList) rootEl.classList.add('wqt-v2'); } catch (e) { /* unstyled */ }
    var L = h.L === 'ur' ? 'ur' : 'en';
    var t = T[L];
    var esc = h.esc;
    var keep = null;      // this run's keep answer: 'kept_ok' | 'kept_no' | null (screen not shown)
    var keepFor = null;   // the run (ct) that answer belongs to
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
      if (outcome(d) === 'on_its_way') { onItsWay(); return; }
      if (ex === 'listen' && !(d.story_clip && d.story_clip.url)) { gettingReady(ex); return; }
      tries = 0;
      h.S.data = d;
      if (d.clips && isWarmup(d)) d.clips = Object.assign({}, d.clips, { intro: { text: t.warmupSay, url: null } });
      h.ev('ch_start', { step: ex });
      if (!d.practice_round && !helped()) helpAsk(intro); else intro();
    }
    function openFailed(ex, e) {
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
    // Story Time (?room=story&pid=…, web_quiz_challenge_story): the serve has no story payload yet, so the room says
    // its banner and that a new story is on its way; no reading, no scorer, no upload
    function storyRoom(m) {
      var room = null;
      try { room = new URL(location.href).searchParams.get('room'); } catch (e) { room = null; }
      if (room !== 'story' || !(m && m.v2 && m.v2.story)) return false;
      h.S.data = null;
      h.show('story', '<p class="wqc-banner" id="wqc-story-banner">' + esc(t.storyBanner) + '</p>' + h.jug('hello', t.nextOnItsWay, true) + home());
      h.on('wqc-menu', function () { try { var u = new URL(location.href); u.searchParams.delete('room'); u.searchParams.delete('pid'); location.href = u.toString(); } catch (e) { /* stays */ } });
      return true;
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
    function trailCopy(k) { return TRAIL_OVER[k] ? t[TRAIL_OVER[k]] : null; }
    function trailSub(xs) {
      var waiting = xs.filter(function (x) { return !x.badge; }).length;
      return waiting === 0 ? '' : (waiting === 1 ? t.lanternTrailOne : t.lanternTrailMany);
    }
    function stops(xs) {
      return xs.map(function (x) { return x.anchor_block ? Object.assign({}, x, { name: t.warmupTitle }) : x; });
    }

    // ── keep this reading? ──
    function keepAsk(then) {
      var d = h.S.data;
      if (!d || !d.v2 || !d.v2.consent || keepFor === d.ct) return false;
      keepFor = d.ct; keep = null;
      // jg.keep.sub / jg.keep.stop (90 days, STOP deletes) are held back by ruling and not shipped; jg.keep.sub_v2 instead
      h.show('keep-ask', h.jug('hello', t.keepQ, true) + '<p class="wq-sub" id="wqc-keep-sub">' + esc(t.keepSubV2) + '</p>'
        // the answer is recorded as a grown-up's tap, so the screen says who answers (jg.keep.ask_grownup)
        + '<p class="wq-sub" id="wqc-keep-grownup">' + esc(t.keepAskGrownup) + '</p>'
        // the two answers side by side at equal width, the same button class: neither is "the top green button"
        + '<div class="wqc-keep2" id="wqc-keep-pair">' + btn('wqc-keep-yes', t.keepYes) + btn('wqc-keep-no', t.keepNo) + '</div>'
        + '<p class="wq-sub" id="wqc-keep-either">' + esc(t.keepEither) + '</p>');
      h.on('wqc-keep-yes', function () { keep = 'kept_ok'; then(); });
      h.on('wqc-keep-no', function () { keep = 'kept_no'; then(); });
      return true;
    }
    function consent(b) {
      var d = h.S.data;
      if (d && d.v2 && d.v2.consent && keep && keepFor === d.ct) b.audio_consent = keep;
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
      if (s && s.stopped && !isWarmup(d)) {
        var line0 = !d.practice_round ? t.endSticker : h.tc('stopDone');
        endCard(name, 'hello', line0, { noSticker: true });
        return;
      }
      var line = isWarmup(d) ? t.warmupDone : (d.ex === 'listen' ? t.endListen : t.endTap);
      endCard(name, 'celebrate', line, {});
    }

    return { opened: opened, openFailed: openFailed, menu: menu, stops: stops, stopLine: stopLine, trailSub: trailSub, trailCopy: trailCopy, keepAsk: keepAsk, consent: consent, withHelped: withHelped,
      readEnd: readEnd, tapEnd: tapEnd, T: T };
  }

  window.WQTRAIL = { init: init, T: T };
})();
