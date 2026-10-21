/**
 * The screens of the self-administered battery (switch sa_engine): draws runner.view() for one child on a phone.
 *
 * SAE.ui.mount(el, {
 *   runner, battery?, lang:'en'|'ur', mode:'game'|'proctored', speak(textObj, audioObj) → Promise,
 *   onState(view), onFeedback({kind:'practice', ok}), onRecordStart(task[, item]), onRecordStop(task[, item]),
 *   onMute(b)|null (game only), muted, back (url for the end screen), handback:'coach'|'teacher', onHandback(),
 *   art_base (Jugnu's pictures, default '/wq/'), check_words (the audio check's words, with clips),
 *   child: { first_name } (proctored handover), onUnlock() (the coach's hold on the hand-back screen),
 *   onCoachMenu(open) (the coach's hold during the run),
 *   micProbe() → Promise<{ok, rms, url}> (game mic check: a 2-s probe, url = a blob to play back),
 *   micLevel(cb(level 0..1)) → stop() (a live input level, for the practice oral question)
 * }) → { render(), destroy(), setSync(status), mercy(), refuse(kind), backWait() }
 *
 * Session gates (RULINGs #13, #17): mic_check (game, once per device), oral_practice (before the first oral task),
 * keypad_warmup (before the first keypad task). The passage ends on one big spoken star tile; mercy() (the engine, after
 * 12 s of no voice, RULING #10) says lines.mercy once and pulses the star. refuse('voice') covers the screen when the
 * battery's voice is not ready.
 *
 * Proctored (coach) mode adds coach-facing screens around the child's: a handover screen before the intro ("Give the
 * phone to <name>"), a 3 s press-and-hold in the top-left corner during the run that opens a small coach menu (end this
 * task / continue), a sync dot, and the hand-back screen at the end, which stays until the coach holds the corner 3 s.
 *
 * One primary action per screen, touch targets ≥ 64px, laid out for 360×640. Feedback only on practice items: a scored
 * item never shows right or wrong (EGRA gives none), and the child never sees a score. The clock is a shrinking track
 * with Jugnu's light at its end, no digits.
 * Skin hooks: the mount carries data-phase, data-mode, data-task-mode; .sa-tile, .sa-clock, .sa-jugnu on the parts.
 *
 * Response modes (sa-core): tap (tiles), keypad (typed number), keyboard (a word typed on an a–z strip), record (passage aloud, then the last word read),
 * oral (Jugnu asks, the child answers aloud). Phases include warmup (bubbles) and last_word.
 *
 * UMD: window.SAE.ui in the browser, module.exports under Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.SAE = root.SAE || {}; root.SAE.ui = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Every word the screens show. Urdu in Urdu script only, gender-neutral (آپ + -یں; verbs agree with nouns, never
  // with the child), short.
  var COPY = {
    en: {
      hello: 'Hi! I am Jugnu.',
      hello_sub: 'Let’s play some games together.',
      start: 'Start',
      audio_q: 'Can you hear Jugnu?',
      audio_hint: 'Tap the picture Jugnu says.',
      no_sound: 'I can’t hear',
      audio_bad: 'Check your headphones',
      audio_bad_sub: 'Turn the sound up, then try again.',
      retry: 'Try again',
      warm_title: 'Pop the bubbles!',
      warm_sub: 'As fast as you can.',
      replay: 'Hear again',
      next: 'Next',
      practice: 'Practice',
      right: 'That’s right!',
      try_again: 'Try again.',
      shown: 'This is the right one.',
      ready: 'Ready?',
      go: 'Go!',
      listen: 'Listen to the story',
      read_aloud: 'Read aloud',
      im_done: 'I’m done',
      last_word: 'Tap the last word you read',
      say_answer: 'Say your answer out loud',
      answered: 'Done',
      erase: 'Erase',
      ok: 'OK',
      well_done: 'Well done!',
      all_done: 'All done!',
      all_done_sub: 'Thank you for playing with Jugnu.',
      back_wait: 'Your island is saved on this phone. It will go when the internet is back.',
      back: 'Go back',
      give_teacher: 'Give the phone back to your teacher.',
      give_coach: 'Give the phone back to the coach.',
      hold: 'Coach: press and hold',
      handover_pre: 'Give the phone to ',
      handover_post: '',
      handover_anon: 'Give the phone to the child',
      coach: 'Coach',
      end_task: 'End this task',
      cont: 'Continue',
      sync: 'Saved',
      time: 'Time',
      sound_on: 'Sound on',
      sound_off: 'Sound off',
      of: 'of',
      mic_say: 'Say: one, two, three.',
      mic_tap: 'Tap the microphone, then speak',
      mic_skip: 'Skip for now',
      mic_skip_say: 'If the microphone is not working, tap Skip.',
      mic_speak: 'Speak now…',
      mic_ask: 'Did you hear yourself?',
      mic_yes: 'I heard myself',
      mic_no: 'I didn’t',
      oral_try: 'Say it out loud',
      oral_heard: 'I heard you!',
      kp_warm: 'Type any numbers you like. Tap “Done” when you are ready.',
      done: 'Done',
      mercy: 'If reading is hard, tap the star.',
      voice_not_ready: 'The voice is not ready yet',
    },
    ur: {
      hello: 'السلام علیکم! میں جگنو ہوں۔',
      hello_sub: 'آئیں، مل کر کچھ کھیل کھیلیں۔',
      start: 'شروع کریں',
      audio_q: 'کیا جگنو کی آواز آ رہی ہے؟',
      audio_hint: 'جو تصویر جگنو بتائے، اسے دبائیں۔',
      no_sound: 'آواز نہیں آئی',
      audio_bad: 'ہیڈ فون دیکھیں',
      audio_bad_sub: 'آواز تیز کریں، پھر دوبارہ کوشش کریں۔',
      retry: 'دوبارہ کوشش کریں',
      warm_title: 'بلبلے پھوڑیں!',
      warm_sub: 'جتنی جلدی ہو سکے۔',
      replay: 'دوبارہ سنیں',
      next: 'آگے',
      practice: 'مشق',
      right: 'بالکل ٹھیک!',
      try_again: 'ایک بار پھر کوشش کریں۔',
      shown: 'یہ والا ٹھیک ہے۔',
      ready: 'تیار ہیں؟',
      go: 'چلیں!',
      listen: 'کہانی غور سے سنیں',
      read_aloud: 'اونچی آواز میں پڑھیں',
      im_done: 'میں نے پڑھ لیا',
      last_word: 'آخری پڑھا ہوا لفظ دبائیں',
      say_answer: 'جواب اونچی آواز میں بتائیں',
      answered: 'ہو گیا',
      erase: 'مٹائیں',
      ok: 'ٹھیک ہے',
      well_done: 'شاباش!',
      all_done: 'سب ہو گیا!',
      all_done_sub: 'جگنو کے ساتھ کھیلنے کا شکریہ۔',
      back_wait: 'آپ کا جزیرہ اس فون پر محفوظ ہے۔ انٹرنیٹ آتے ہی چلا جائے گا۔',
      back: 'واپس جائیں',
      give_teacher: 'اب فون ٹیچر کو واپس دے دیں۔',
      give_coach: 'اب فون کوچ کو واپس دے دیں۔',
      hold: 'کوچ: دبا کر رکھیں',
      handover_pre: '',
      handover_post: ' کو فون دیں',
      handover_anon: 'اب فون بچے کو دیں',
      coach: 'کوچ',
      end_task: 'یہ حصہ ختم کریں',
      cont: 'جاری رکھیں',
      sync: 'محفوظ',
      time: 'وقت',
      sound_on: 'آواز چالو',
      sound_off: 'آواز بند',
      of: 'میں سے',
      mic_say: 'کہیں: ایک، دو، تین۔',
      mic_tap: 'مائیک دبائیں، پھر بولیں',
      mic_skip: 'ابھی چھوڑ دیں',
      mic_skip_say: 'اگر مائیک کام نہیں کر رہا تو چھوڑ دیں دبائیں۔',
      mic_speak: 'اب بولیں…',
      mic_ask: 'کیا آپ کو اپنی آواز سنائی دی؟',
      mic_yes: 'ہاں، سنائی دی',
      mic_no: 'نہیں سنائی دی',
      oral_try: 'اونچی آواز میں بولیں',
      oral_heard: 'مجھے سنائی دیا!',
      kp_warm: 'جو نمبر چاہیں لکھیں۔ تیار ہوں تو "ہو گیا" دبائیں۔',
      done: 'ہو گیا',
      mercy: 'اگر پڑھنا مشکل ہو تو ستارے کو دبائیں۔',
      voice_not_ready: 'آواز ابھی تیار نہیں',
    },
  };

  // The audio check's words: everyday pictures, not test content. A page may pass its own (with clips) as opts.check_words.
  var CHECK_WORDS = [
    { pic: '🐱', en: 'cat', ur: 'بلی' },
    { pic: '☀️', en: 'sun', ur: 'سورج' },
    { pic: '🐟', en: 'fish', ur: 'مچھلی' },
    { pic: '⚽', en: 'ball', ur: 'گیند' },
    { pic: '🥭', en: 'mango', ur: 'آم' },
    { pic: '🏠', en: 'house', ur: 'گھر' },
  ];

  var FEEDBACK_MS = 1200;
  var TASK_END_MS = 1500;
  var TASK_END_CAP_MS = 8000; // the part's closing line is awaited to its end, never longer than this
  var PRESS_MS = 180;
  var WARM_N = 10;
  var WARM_CAP_MS = 25000;
  var HOLD_MS = 3000;
  var KEYPAD_MIN = 3;        // digits the keypad takes; more when the task has a longer answer (1,000 + 300 + 80 + 3)
  var WORD_MAX = 16;
  var LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
  var KP_WARM_MS = 20000;   // RULING #17: 20 s of free typing
  var HEARD_LEVEL = 0.15;   // the practice oral question: the meter crossed this once = heard
  var PROBE_MS = 4000;      // the mic probe's own guard

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k) || attrs[k] == null || attrs[k] === false) continue;
        if (k === 'class') el.className = attrs[k];
        else if (k === 'text') el.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
        else el.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
      }
    }
    (kids || []).forEach(function (c) {
      if (c == null || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function capped(p, ms) { return Promise.race([Promise.resolve(p).catch(function () {}), delay(ms)]); }

  function mount(el, opts) {
    var runner = opts.runner;
    var lang = opts.lang === 'ur' ? 'ur' : 'en';
    var mode = opts.mode === 'proctored' ? 'proctored' : 'game';
    var C = COPY[lang];
    var lines = (opts.battery && opts.battery.lines) || {};
    var art = opts.art_base != null ? opts.art_base : '/wq/';
    var handback = opts.handback || (mode === 'proctored' ? 'coach' : 'teacher');
    var checkWords = Array.isArray(opts.check_words) && opts.check_words.length >= 2 ? opts.check_words : CHECK_WORDS;
    var speakFn = typeof opts.speak === 'function' ? opts.speak : function () { return delay(300); };
    var muted = !!opts.muted;
    var alive = true;
    var gen = 0;              // bumps on every new screen: a chained line from an old screen is dropped
    var lastKey = null;       // the screen on show; a change triggers its entry speech
    var hold = null;          // a practice answer being shown (the runner has already moved on)
    var busy = false;         // a tap is being acknowledged; other taps wait
    var recording = null;     // the record task whose recorder is on
    var oralRec = null;       // { task, item, key } while an oral answer is being recorded
    var check = null, checkBad = false;
    var warm = null;          // { t0, popped, timer, done }
    var listening = null;     // the oral task whose passage Jugnu is reading (before begin)
    var heard = {};           // task ids whose hidden passage has been read
    var typed = '';           // the keypad's number
    var shownOffer = false;   // whether the "next" button is on screen
    var clockEls = null, displayEl = null;
    var raf = null, iv = null, timers = [];
    var handedOver = mode !== 'proctored';  // proctored: the coach hands the phone over first
    var coachMenu = false;
    var syncState = null;
    var micSt = null;         // the game mic check: { stage: 'idle'|'rec'|'ask', probe }
    var oralP = null;         // the practice oral question: { stage: 'listen'|'heard', max, stop, bar }
    var kpw = null;           // the keypad warm-up: { keys, timer, done }
    var mercied = {};         // task ids the mercy line was said for
    var refused = null;       // refuse(kind): a full-screen stop
    var backWaiting = false;  // backWait(): game, the map not reachable yet; the end screen says the island waits here
    var starEl = null;
    var starSpeech = null;
    var childName = opts.child && typeof opts.child.first_name === 'string' ? opts.child.first_name.trim().slice(0, 40) : '';

    function later(fn, ms) { var t = setTimeout(function () { if (alive) fn(); }, ms); timers.push(t); return t; }
    function say(textObj, audioObj) {
      if (!textObj && !audioObj) return Promise.resolve();
      try { return Promise.resolve(speakFn(textObj || null, audioObj || null)).catch(function () {}); }
      catch (e) { return Promise.resolve(); }
    }
    /** Say lines one after another, unless the screen changes. */
    function sayChain(list) {
      var g = gen;
      return list.reduce(function (p, x) {
        return p.then(function () { if (alive && g === gen && x) return say(x[0], x[1]); });
      }, Promise.resolve());
    }
    function tx(obj) {
      if (obj == null) return '';
      if (typeof obj === 'string' || typeof obj === 'number') return String(obj);
      if (typeof obj.text === 'string') return obj.text;
      if (obj.text && typeof obj.text === 'object') return tx(obj.text);
      return obj[lang] || obj.en || obj.ur || '';
    }
    function taskLang(t) { return (t && t.lang) || lang; }
    function dirOf(t) { return (t && t.direction && t.direction !== 'ltr') ? t.direction : (taskLang(t) === 'ur' ? 'rtl' : 'ltr'); }
    function line(name) { return lines[name] || null; }
    function introOf(t) {
      var s = t.script || {};
      var o = (t.mode === 'record' || t.mode === 'oral') ? s.intro_record : s.intro_tap;
      if (o) return o;
      if (t.instruction) return { text: t.instruction.text || t.instruction, audio: t.instruction.audio };
      return s.intro || null;
    }
    /** What Jugnu says for an item: its say (in the task's language) or its prompt. */
    function sayItem(it, t) {
      if (!it) return Promise.resolve();
      if (typeof it.say === 'string') return say({ text: it.say, lang: taskLang(t) }, it.prompt_audio || null);
      if (it.say) return say(it.say, it.prompt_audio || null);
      if (it.prompt) return say(it.prompt, it.prompt.audio || it.prompt_audio || null);
      if (it.prompt_audio) return say(null, it.prompt_audio);
      return Promise.resolve();
    }
    function itemSpeaks(it) { return !!(it && (it.say || it.prompt || it.prompt_audio)); }

    el.classList.add('sae');
    el.setAttribute('lang', lang);
    el.setAttribute('dir', lang === 'ur' ? 'rtl' : 'ltr');
    el.setAttribute('data-mode', mode);

    // ---------- pieces ----------
    function jugnu(mood, small) {
      var img = h('img', { class: 'sae-jugnu sa-jugnu' + (small ? ' sae-jugnu-s' : ''), 'data-mood': mood, alt: '', src: art + 'jugnu_' + mood + '.webp', draggable: 'false' });
      img.addEventListener('error', function () {
        var f = h('span', { class: 'sae-jugnu sa-jugnu sae-jugnu-f' + (small ? ' sae-jugnu-s' : ''), 'data-mood': mood, 'aria-hidden': 'true', text: '✨' });
        if (img.parentNode) img.parentNode.replaceChild(f, img);
      });
      return img;
    }
    function btn(label, onclick, cls) {
      return h('button', { class: 'sae-btn ' + (cls || ''), type: 'button', onclick: function (e) { if (!busy) onclick(e); } }, [label]);
    }
    function replayBtn(onclick) {
      return h('button', { class: 'sae-replay sa-replay', type: 'button', 'aria-label': C.replay, title: C.replay, onclick: onclick }, [h('span', { 'aria-hidden': 'true', text: '🔁' })]);
    }
    function topBar(v) {
      var dots = [];
      for (var i = 0; i < v.tasks; i++) dots.push(h('span', { class: 'sae-dot' + (i < v.task_index ? ' is-done' : i === v.task_index ? ' is-now' : '') }));
      var kids = [h('div', { class: 'sae-dots', role: 'img', 'aria-label': Math.min(v.task_index + 1, v.tasks) + ' ' + C.of + ' ' + v.tasks }, dots)];
      if (mode === 'game' && typeof opts.onMute === 'function') {
        kids.push(h('button', {
          class: 'sae-mute sa-mute', type: 'button', 'aria-pressed': muted ? 'true' : 'false', 'aria-label': muted ? C.sound_off : C.sound_on,
          onclick: function () { muted = !muted; try { opts.onMute(muted); } catch (e) { /* skin */ } draw(); },
        }, [h('span', { 'aria-hidden': 'true', text: muted ? '🔇' : '🔊' })]));
      }
      return h('div', { class: 'sae-top' }, kids);
    }
    function screen(v, cls, kids, foot, noTop) {
      return h('div', { class: 'sae-screen ' + (cls || '') }, [
        noTop ? null : topBar(v),
        h('div', { class: 'sae-body' }, kids),
        foot && foot.some(Boolean) ? h('div', { class: 'sae-foot' }, foot) : null,
      ]);
    }
    /** A picture option (task.option_images[id] = a path under the site root) or null. */
    function picOf(t, o) {
      var p = t && t.option_images && t.option_images[o];
      if (typeof p !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(p) || p.indexOf('..') >= 0) return null;
      var img = h('img', { class: 'sae-opt-img', src: '/' + p.replace(/^\/+/, ''), alt: '', draggable: 'false' });
      // A picture that will not load leaves a blank tile: the item cannot be answered (assets_unavailable), never scored.
      img.addEventListener('error', function () {
        if (img.parentNode) img.parentNode.disabled = true;
        if (!alive || typeof runner.imageUnavailable !== 'function') return;
        var v = runner.view();
        runner.imageUnavailable(t.id, v.item ? v.item.id : (v.practice ? v.practice.id : null));
        draw();
      });
      return img;
    }
    /** glyphs: the item's picture per option (a picture pattern): drawn large, the option's word as its caption. */
    function tiles(options, onPick, decorate, tl, t, glyphs) {
      var n = options.length;
      var g = h('div', { class: 'sae-opts sa-tiles' + (n > 4 ? ' is-five' : ''), lang: tl, dir: tl === 'ur' ? 'rtl' : 'ltr' });
      options.forEach(function (o, i) {
        var pic = picOf(t, o);
        var gl = !pic && Array.isArray(glyphs) && typeof glyphs[i] === 'string' && glyphs[i] ? glyphs[i] : null;
        var face = pic || (gl ? [h('span', { class: 'sae-glyph', 'aria-hidden': 'true', text: gl }), h('span', { class: 'sae-cap', text: String(o) })] : String(o));
        var b = h('button', { class: 'sae-opt sa-tile' + (pic ? ' is-pic' : gl ? ' is-glyph' : ''), type: 'button', 'data-value': String(o), lang: tl, 'aria-label': gl ? String(o) : null }, [].concat(face));
        b.addEventListener('click', function () { if (!busy && !b.disabled) onPick(o, b); });
        if (decorate) decorate(o, b);
        g.appendChild(b);
      });
      return g;
    }
    /** The item's label, when it adds something (a sum, a sequence) and does not give the answer away. */
    /** What the item shows on screen: label, or the content file's `shown` (the sum on a say_on:'replay' task). */
    function shownOf(it) { return it == null ? null : (it.label != null ? it.label : (it.shown != null ? it.shown : null)); }
    function labelOf(it) {
      if (!it || shownOf(it) == null || (it.say && it.label == null)) return null;
      var seq = Array.isArray(shownOf(it)) ? shownOf(it) : null;
      var lab = seq ? seq.filter(function (x) { return x != null; }).join(' ') : String(shownOf(it)).trim();
      if (!lab) return null;
      if (Array.isArray(it.options)) {
        var a = lab.split(/\s+/).sort().join(' '), b = it.options.map(String).sort().join(' ');
        if (a === b) return null;
      }
      return seq ? seqRow(seq) : h('p', { class: 'sae-label sa-label', dir: 'ltr' }, [lab]);
    }
    /** A sequence as tiles, one per number; the missing one is a bordered blank reading "__", wherever it falls. */
    function seqRow(seq) {
      return h('div', { class: 'sae-label sa-label sae-seq', dir: 'ltr' }, seq.map(function (x) {
        return x == null ? h('span', { class: 'sae-seq-tile sae-gap', text: '__' }) : h('span', { class: 'sae-seq-tile', text: String(x) });
      }));
    }
    function keypadMax(t) {
      var n = KEYPAD_MIN;
      ((t && t.items) || []).concat((t && t.practice) || []).forEach(function (it) {
        if (it && it.target != null) n = Math.max(n, String(it.target).length);
      });
      return n;
    }
    function clock(v) {
      if (v.time_left_ms == null || !v.task || !v.task.time_limit_s) { clockEls = null; return null; }
      var fill = h('div', { class: 'sae-clock-fill' });
      var bug = h('div', { class: 'sae-clock-bug', 'aria-hidden': 'true' });
      var track = h('div', { class: 'sae-clock sa-clock', role: 'progressbar', 'aria-label': C.time, 'aria-valuemin': '0', 'aria-valuemax': '100' }, [fill, bug]);
      clockEls = { track: track, fill: fill, bug: bug, limit: v.task.time_limit_s * 1000 };
      paintClock(v.time_left_ms);
      return track;
    }
    function paintClock(left) {
      if (!clockEls) return;
      var p = Math.max(0, Math.min(1, left / clockEls.limit));
      var pc = (p * 100).toFixed(2) + '%';
      clockEls.fill.style.width = pc;
      clockEls.bug.style[lang === 'ur' ? 'right' : 'left'] = 'calc(' + pc + ' - 16px)';
      clockEls.track.setAttribute('aria-valuenow', String(Math.round(p * 100)));
      clockEls.track.classList.toggle('is-low', p < 0.2);
    }
    function nextBtn(v) {
      shownOffer = !!v.offer_next;
      if (!v.offer_next) return null;
      return btn(C.next, function () { runner.skip(); draw(); }, 'sae-secondary sa-next');
    }

    // ---------- screens ----------
    function sIntro(v) {
      var w = line('welcome');
      return screen(v, 'sae-intro', [
        jugnu('hello'),
        h('h1', { class: 'sae-h1', text: C.hello }),
        h('p', { class: 'sae-sub', text: w ? tx(w) : C.hello_sub }),
        w ? replayBtn(function () { say(w); }) : null,
      ], [btn(C.start, function () { runner.start(); draw(); }, 'sae-primary')], true);
    }

    function newCheck() {
      var pool = checkWords.slice();
      var a = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      var b = pool[Math.floor(Math.random() * pool.length)];
      check = { pair: Math.random() < 0.5 ? [a, b] : [b, a], target: a };
    }
    function playCheck() { return say({ en: check.target.en, ur: check.target.ur }, check.target.audio || null); }
    function sCheck(v) {
      if (checkBad) {
        var f = line('audio_fail');
        return screen(v, 'sae-check is-bad', [
          h('div', { class: 'sae-big-ico', 'aria-hidden': 'true', text: '🎧' }),
          h('h1', { class: 'sae-h1', text: C.audio_bad }),
          h('p', { class: 'sae-sub', text: f ? tx(f) : C.audio_bad_sub }),
        ], [btn(C.retry, function () { checkBad = false; newCheck(); lastKey = null; draw(); }, 'sae-primary')], true);
      }
      if (!check) newCheck();
      var choices = h('div', { class: 'sae-pics' }, check.pair.map(function (w) {
        return h('button', {
          class: 'sae-pic sa-tile', type: 'button', 'aria-label': w[lang],
          onclick: function () {
            if (busy) return;
            var ok = w === check.target;
            runner.audioCheck(ok);
            if (ok) check = null; else { checkBad = true; lastKey = null; }
            draw();
          },
        }, [h('span', { class: 'sae-pic-e', 'aria-hidden': 'true', text: w.pic }), h('span', { class: 'sae-pic-w', text: w[lang] })]);
      }));
      return screen(v, 'sae-check', [
        h('div', { class: 'sae-row' }, [jugnu('thinking', true), replayBtn(function () { playCheck(); })]),
        h('h1', { class: 'sae-h1', text: C.audio_q }),
        h('p', { class: 'sae-sub', text: C.audio_hint }),
        choices,
      ], [btn(C.no_sound, function () { runner.audioCheck(false); checkBad = true; lastKey = null; draw(); }, 'sae-secondary')], true);
    }

    function sWarmup(v) {
      if (!warm) {
        warm = { t0: Date.now(), popped: 0, done: false };
        warm.timer = later(function () { endWarm(); }, WARM_CAP_MS);
      }
      // ten bubbles on a 3×4 board (two cells left empty), a little jitter in each
      var gap1 = warm.t0 % 12, gap2 = (gap1 + 1 + (Math.floor(warm.t0 / 12) % 11)) % 12;
      var spots = [];
      for (var c = 0; c < 12; c++) if (c !== gap1 && c !== gap2) spots.push(c);
      var board = h('div', { class: 'sae-bubbles sa-bubbles' }, spots.slice(0, WARM_N).map(function (cell, k) {
        var col = cell % 3, row = Math.floor(cell / 3);
        var jx = ((k * 37) % 11) - 5, jy = ((k * 53) % 9) - 4;
        var b = h('button', {
          class: 'sae-bubble sa-bubble', type: 'button', 'aria-label': String(k + 1),
          style: 'left:calc(' + (col * 33.33 + 16.66).toFixed(2) + '% - 36px + ' + jx + 'px);top:calc(' + (row * 25 + 12.5) + '% - 36px + ' + jy + 'px)',
        });
        b.addEventListener('pointerdown', function (e) {
          e.preventDefault();
          if (!warm || warm.done || b.classList.contains('is-popped')) return;
          b.classList.add('is-popped');
          warm.popped++;
          if (warm.popped >= WARM_N) endWarm();
        });
        return b;
      }));
      return screen(v, 'sae-warmup', [
        h('h1', { class: 'sae-h1', text: C.warm_title }),
        h('p', { class: 'sae-sub', text: C.warm_sub }),
        board,
      ], null, true);
    }
    function endWarm() {
      if (!warm || warm.done) return;
      warm.done = true;
      clearTimeout(warm.timer);
      var popped = warm.popped, ms = Math.min(WARM_CAP_MS, Date.now() - warm.t0);
      later(function () { warm = null; runner.warmupDone(popped, ms); draw(); }, 250);
    }

    function playIntro(t) { runner.instructionPlayed(); return say(introOf(t)); }
    function sInstruction(v) {
      var t = v.task;
      return screen(v, 'sae-instr', [
        h('div', { class: 'sae-row' }, [jugnu('hello', true), replayBtn(function () { gen++; playIntro(t); })]),
        h('h1', { class: 'sae-h1', text: tx(t.title) }),
        h('p', { class: 'sae-say', text: tx(introOf(t)) }),
        demoImage(t),
      ], [btn(C.next, function () { runner.instructionDone(); draw(); }, 'sae-primary')]);
    }
    /** The example card shown with the instruction (script.demo_image: a path under the site root, or {en, ur}). */
    function demoImage(t) {
      var d = t.script && t.script.demo_image;
      if (d && typeof d === 'object') d = d[lang] || d.en || d.ur;
      if (typeof d !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(d) || d.indexOf('..') >= 0) return null;
      return h('img', { class: 'sae-demo-img', src: '/' + d.replace(/^\/+/, ''), alt: '' });
    }

    function feedbackLine(fb) {
      if (!fb) return h('p', { class: 'sae-fb is-empty', 'aria-hidden': 'true' }, [' ']);
      return h('p', { class: 'sae-fb sa-feedback ' + (fb.res.ok ? 'is-ok' : 'is-again'), role: 'status' }, [fb.text]);
    }
    function sPractice(v) {
      var p = hold ? hold.item : v.practice;
      var t = v.task;
      var fb = hold;
      var answerArea;
      if (t.mode === 'keypad') {
        answerArea = keypadArea(p, t, function (val) { practicePick(p, t, val); }, fb);
      } else if (t.mode === 'keyboard') {
        answerArea = keyboardArea(p, t, function (val) { practicePick(p, t, val); }, fb);
      } else if (typeof p.target_index === 'number') {
        answerArea = passageTap(t, function (i) { practicePick(p, t, i); });
      } else {
        answerArea = tiles(p.options, function (o) { practicePick(p, t, o); }, function (o, b) {
          if (!fb) return;
          b.disabled = true;
          if (String(o) === String(fb.value)) b.classList.add(fb.res.ok ? 'is-right' : 'is-tried');
          if (fb.res.shown != null && String(o) === String(fb.res.shown)) b.classList.add('is-right', 'is-shown');
        }, taskLang(t), t, p.glyphs);
      }
      return screen(v, 'sae-practice', [
        h('div', { class: 'sae-row' }, [
          h('span', { class: 'sae-chip', text: C.practice }),
          itemSpeaks(p) ? replayBtn(function () { gen++; sayItem(p, t); }) : null,
        ]),
        t.mode === 'keypad' || t.mode === 'keyboard' ? null : labelOf(p),
        answerArea,
        feedbackLine(fb),
      ], t.mode === 'keypad' || t.mode === 'keyboard' ? null : [jugnu(fb ? (fb.res.ok ? 'correct' : 'notyet') : 'idle', true)]);
    }
    function practicePick(p, t, value) {
      var res = runner.practiceAnswer(value);
      if (!res) return;
      busy = true;
      var f = res.feedback || {};
      var said = res.ok ? (f.right || { en: COPY.en.right, ur: COPY.ur.right })
        : res.retry ? { en: COPY.en.try_again, ur: COPY.ur.try_again }
          : (f.wrong || { en: COPY.en.shown, ur: COPY.ur.shown });
      hold = { item: p, value: value, res: res, text: tx(said) };
      try { if (opts.onFeedback) opts.onFeedback({ kind: 'practice', ok: !!res.ok }); } catch (e) { /* skin */ }
      draw();
      Promise.all([delay(FEEDBACK_MS), capped(say(said), 7000)]).then(function () {
        if (!alive) return;
        hold = null;
        busy = false;
        typed = '';
        if (res.retry) lastKey = null; // the same item again: Jugnu says it again
        draw();
      });
    }

    function sReady(v) {
      return screen(v, 'sae-ready', [
        jugnu('hello'),
        h('h1', { class: 'sae-h1 sae-xl', text: C.ready }),
      ], [btn(C.go, function () {
        var t = v.task;
        if (t.mode === 'oral' && t.passage && t.passage.shown === false && !heard[t.id]) { listenThenBegin(t); return; }
        runner.begin();
        draw();
      }, 'sae-primary sae-go')]);
    }
    /** A listening task: Jugnu reads the hidden passage (read_times) before the first question; the clock starts after. */
    function listenThenBegin(t) {
      listening = t;
      gen++;
      draw();
      var n = Math.max(1, t.passage.read_times || 1);
      var said = { text: t.passage.text, lang: t.passage.lang || taskLang(t) };
      var p = Promise.resolve();
      for (var i = 0; i < n; i++) {
        p = p.then(function () { return alive && listening === t ? capped(say(said, t.passage.audio || null), 180000) : null; })
          .then(function () { return delay(600); });
      }
      p.then(function () {
        if (!alive || listening !== t) return;
        heard[t.id] = true;
        listening = null;
        runner.begin();
        draw();
      });
    }
    function sListen(v) {
      return screen(v, 'sae-listen', [
        jugnu('hello'),
        h('div', { class: 'sae-ear', 'aria-hidden': 'true', text: '👂' }),
        h('h1', { class: 'sae-h1', text: C.listen }),
      ], null);
    }

    function sRunTap(v) {
      var it = v.item, t = v.task;
      return screen(v, 'sae-run sae-run-tap', [
        clock(v),
        h('p', { class: 'sae-task-tag', text: tx(t.title) }),
        h('div', { class: 'sae-row' }, [jugnu('idle', true), itemSpeaks(it) ? replayBtn(function () { sayItem(it, t); }) : null]),
        labelOf(it),
        // A tap on the passage itself (print orientation): the words are the buttons, scored by place.
        t.tap_on === 'passage' && typeof it.target_index === 'number'
          ? passageTap(t, function (i, b) { busy = true; b.classList.add('is-pressed'); runner.answer(i); later(function () { busy = false; draw(); }, PRESS_MS); })
          : null,
        t.tap_on === 'passage' && typeof it.target_index !== 'number' ? passageTap(t, null) : null,
        typeof it.target_index === 'number' ? null : tiles(it.options, function (o, b) {
          busy = true;
          b.classList.add('is-pressed');
          runner.answer(o);
          later(function () { busy = false; draw(); }, PRESS_MS);
        }, null, taskLang(t), t, it.glyphs),
      ], [nextBtn(v)]);
    }

    /** The passage's words (task.passage.words) as buttons, or as plain text when onWord is null. */
    function passageTap(t, onWord) {
      var ps = t.passage || {};
      var words = Array.isArray(ps.words) ? ps.words : [];
      var dir = ps.direction || dirOf(t), tl = taskLang(t);
      var rows = [], cur = null, curLine = null;
      words.forEach(function (w, i) {
        var ln = w.line != null ? w.line : 1;
        if (ln !== curLine) { cur = h('span', { class: 'sae-pline' }); rows.push(cur); curLine = ln; }
        var label = String(w.target != null ? w.target : w.label);
        if (onWord) {
          var b = h('button', { class: 'sae-word sa-word', type: 'button', 'data-i': String(i) }, [label]);
          b.addEventListener('click', function () { if (!busy) onWord(i, b); });
          cur.appendChild(b);
        } else cur.appendChild(h('span', { class: 'sae-word sa-word', 'data-i': String(i) }, [label]));
        cur.appendChild(document.createTextNode(' '));
      });
      return h('div', { class: 'sae-passage sa-passage' + (onWord ? ' is-pick' : ''), dir: dir, lang: tl }, rows);
    }

    function keypadArea(it, t, submit, fb) {
      var kids = [];
      var seq = Array.isArray(shownOf(it)) ? shownOf(it) : null;
      var lab = !seq && shownOf(it) != null && String(shownOf(it)).trim() ? String(shownOf(it)) : null;
      var max = keypadMax(t);
      if (!lab && !seq) {
        // a word problem: ten counters the child may tap to count with (not scored)
        var dots = [];
        for (var i = 0; i < 10; i++) {
          dots.push(h('button', {
            class: 'sae-counter sa-counter', type: 'button', 'aria-pressed': 'false', 'aria-label': String(i + 1),
            onclick: function (e) {
              var b = e.currentTarget;
              b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
            },
          }));
        }
        kids.push(h('div', { class: 'sae-counters', dir: 'ltr' }, dots));
      }
      var shown = fb ? String(fb.res.shown != null ? fb.res.shown : fb.value) : typed;
      displayEl = h('output', { class: 'sae-typed sa-typed' + (fb ? (fb.res.ok || fb.res.shown != null ? ' is-right' : ' is-tried') : ''), dir: 'ltr', 'aria-live': 'polite' }, [shown || ' ']);
      // the typed number big above the keypad (a sum and its box on one line: "1 + 3 = [ ]"); nothing goes until ✓
      if (seq) kids.push(seqRow(seq));
      kids.push(lab ? h('div', { class: 'sae-sumrow', dir: 'ltr' }, [h('p', { class: 'sae-sum sa-label' }, [lab]), displayEl]) : displayEl);
      // 1 2 3 ⌫ / 4 5 6 ✓ / 7 8 9 ✓ / 0 0 0 ✓: the ✓ is the biggest key (three rows tall)
      var keys = ['1', '2', '3', 'del', '4', '5', '6', 'ok', '7', '8', '9', '0'];
      kids.push(h('div', { class: 'sae-keypad sa-keypad is-tall-ok', dir: 'ltr' }, keys.map(function (k) {
        var b = h('button', {
          class: 'sae-key' + (k === 'ok' ? ' sae-key-ok' : k === 'del' ? ' sae-key-del' : ''), type: 'button',
          'aria-label': k === 'del' ? C.erase : k === 'ok' ? C.ok : k, 'data-key': k,
        }, [k === 'del' ? '⌫' : k === 'ok' ? '✓' : k]);
        if (fb) b.disabled = true;
        b.addEventListener('click', function () {
          if (busy) return;
          if (k === 'del') typed = typed.slice(0, -1);
          else if (k === 'ok') { if (!typed) return; var val = typed; typed = ''; submit(val); return; }
          else if (typed.length < max) typed = (typed === '0' ? '' : typed) + k;
          if (displayEl) displayEl.textContent = typed || ' ';
        });
        return b;
      })));
      return h('div', { class: 'sae-keyarea' + (fb ? ' has-fb' : '') }, kids);
    }
    /** Spelling: the typed word big, an a–z strip (always ltr, English), erase and ✓; nothing goes until ✓. */
    function keyboardArea(it, t, submit, fb) {
      var shown = fb ? String(fb.res.shown != null ? fb.res.shown : fb.value) : typed;
      displayEl = h('output', { class: 'sae-typed sae-word-typed sa-typed' + (fb ? (fb.res.ok || fb.res.shown != null ? ' is-right' : ' is-tried') : ''), dir: 'ltr', lang: 'en', 'aria-live': 'polite' }, [shown || '\u00a0']);
      function press(k) {
        if (busy || fb) return;
        if (k === 'del') typed = typed.slice(0, -1);
        else if (k === 'ok') { if (!typed) return; var val = typed; typed = ''; submit(val); return; }
        else if (typed.length < WORD_MAX) typed += k;
        if (displayEl) displayEl.textContent = typed || '\u00a0';
      }
      // a–z, then ⌫ and a wide ✓ on the last row (y z ⌫ ✓✓)
      var strip = h('div', { class: 'sae-letters sa-keyboard', dir: 'ltr', lang: 'en' }, LETTERS.concat(['del', 'ok']).map(function (k) {
        var ctl = k === 'del' || k === 'ok';
        var b = h('button', {
          class: 'sae-key ' + (k === 'ok' ? 'sae-key-ok' : k === 'del' ? 'sae-key-del' : 'sae-letter'), type: 'button', 'data-key': k, lang: 'en',
          'aria-label': k === 'ok' ? C.ok : k === 'del' ? C.erase : null,
        }, [k === 'ok' ? '✓' : k === 'del' ? '⌫' : k]);
        if (fb) b.disabled = true;
        b.addEventListener('click', function () { press(k); });
        return b;
      }));
      return h('div', { class: 'sae-keyarea sae-kb' + (fb ? ' has-fb' : '') }, [displayEl, strip]);
    }
    function sRunKeyboard(v) {
      var it = v.item, t = v.task;
      return screen(v, 'sae-run sae-run-keyboard', [
        clock(v),
        itemSpeaks(it) ? h('div', { class: 'sae-row' }, [replayBtn(function () { sayItem(it, t); })]) : null,
        keyboardArea(it, t, function (val) {
          busy = true;
          runner.answer(val);
          later(function () { busy = false; draw(); }, PRESS_MS);
        }, null),
      ], [nextBtn(v)]);
    }
    function sRunKeypad(v) {
      var it = v.item, t = v.task;
      return screen(v, 'sae-run sae-run-keypad', [
        clock(v),
        itemSpeaks(it) ? h('div', { class: 'sae-row' }, [replayBtn(function () { sayItem(it, t); })]) : null,
        keypadArea(it, t, function (val) {
          busy = true;
          runner.answer(val);
          later(function () { busy = false; draw(); }, PRESS_MS);
        }, null),
      ], [nextBtn(v)]);
    }

    // The passage's words: each item's label, or its target (the runtime batteries carry target only).
    function wordText(w) { return w.label != null ? w.label : w.target; }
    function wordsOf(t) { return (t.items || []).filter(function (w) { return w && wordText(w) != null; }); }
    function passageEl(t, onWord) {
      var dir = dirOf(t), tl = taskLang(t);
      var words = wordsOf(t);
      if (words.length) {
        var rows = [], cur = null, curLine = null;
        words.forEach(function (w, i) {
          var ln = w.line != null ? w.line : 1;
          if (ln !== curLine) { cur = h('span', { class: 'sae-pline' }); rows.push(cur); curLine = ln; }
          cur.appendChild(onWord
            ? h('button', { class: 'sae-word sa-word', type: 'button', 'data-i': String(i), onclick: function () { if (!busy) onWord(i); } }, [String(wordText(w))])
            : h('span', { class: 'sae-word sa-word', 'data-i': String(i) }, [String(wordText(w))]));
          cur.appendChild(document.createTextNode(' '));
        });
        return h('div', { class: 'sae-passage sa-passage' + (onWord ? ' is-pick' : ''), dir: dir, lang: tl }, rows);
      }
      if (t.passage && (t.passage.text || typeof t.passage === 'string')) {
        return h('p', { class: 'sae-passage sa-passage', dir: dir, lang: tl, text: t.passage.text || t.passage });
      }
      var per = t.per_row || 10;
      var narrow = per > 5 ? Math.ceil(per / 2) : per;
      return h('div', { class: 'sae-grid sa-grid', dir: dir, lang: tl, style: '--cols:' + per + ';--cols-n:' + narrow },
        (t.grid || []).map(function (x, i) { return h('span', { class: 'sae-cell', 'data-i': String(i) }, [String(x)]); }));
    }
    /** The passage: one big star tile ends the reading (its word is spoken once when it shows; mercy() pulses it). */
    function sRunRecord(v) {
      var label = tx(line('done')) || C.done;
      starEl = h('button', { class: 'sae-star sa-star' + (mercied[v.task.id] ? ' is-mercy' : ''), type: 'button', 'aria-label': label }, [
        h('span', { class: 'sae-star-ico', 'aria-hidden': 'true', text: '★' }),
        h('span', { class: 'sae-star-word', text: label }),
      ]);
      starEl.addEventListener('click', function () { if (!busy) { runner.done(); draw(); } });
      return screen(v, 'sae-run sae-run-rec', [
        clock(v),
        h('p', { class: 'sae-chip sae-chip-rec', text: C.read_aloud }),
        passageEl(v.task, null),
      ], [starEl]);
    }
    function sLastWord(v) {
      return screen(v, 'sae-lastword', [
        h('h1', { class: 'sae-h1', text: C.last_word }),
        passageEl(v.task, function (i) { runner.lastWord(i); draw(); }),
      ], null);
    }

    function sRunOral(v) {
      var it = v.item, t = v.task;
      var on = !!(oralRec && oralRec.key === keyOf(v));
      return screen(v, 'sae-run sae-run-oral', [
        h('p', { class: 'sae-task-tag', text: tx(t.title) }),
        h('div', { class: 'sae-row' }, [jugnu('idle', true), replayBtn(function () { sayItem(it, t); })]),
        h('div', { class: 'sae-mic sa-mic' + (on ? ' is-on' : ''), 'aria-hidden': 'true' }, [h('span', { text: '🎤' })]),
        h('p', { class: 'sae-sub', text: C.say_answer }),
      ], [btn(C.answered, function () {
        busy = true;
        runner.answer('spoken');
        later(function () { busy = false; draw(); }, PRESS_MS);
      }, 'sae-primary')]);
    }

    // ---------- session gates ----------
    function tileBtn(label, onclick, cls) {
      return h('button', { class: 'sae-opt sa-tile sae-choice ' + (cls || ''), type: 'button', onclick: function (e) { if (!busy) onclick(e); } }, [label]);
    }
    /** Game mic check (RULING #13): a 2-s probe played back, then "did you hear yourself?". */
    function sMicCheck(v) {
      var st = micSt || (micSt = { stage: 'idle' });
      var head = tx(line('mic_check')) || C.mic_say;
      if (st.stage === 'ask') {
        return screen(v, 'sae-miccheck is-ask', [
          jugnu('thinking', true),
          h('h1', { class: 'sae-h1', text: tx(line('mic_check_ask')) || C.mic_ask }),
          h('div', { class: 'sae-pics' }, [
            tileBtn(C.mic_yes, function () { micDone(true); }, 'is-yes'),
            tileBtn(C.mic_no, function () { micDone(false); }, 'is-no'),
          ]),
        ], null, true);
      }
      var rec = st.stage === 'rec';
      // A child who never taps the mic is not stuck: after a wait a quiet "skip" appears, which counts as no working
      // mic (the reading-aloud tasks are then skipped as mic_unavailable; the check is asked again next run).
      var skipMs = typeof opts.micSkipMs === 'number' ? opts.micSkipMs : 15000;
      if (!st.shownAt) {
        st.shownAt = Date.now();
        later(function () { if (micSt === st && st.stage === 'idle') { draw(); say({ en: COPY.en.mic_skip_say, ur: COPY.ur.mic_skip_say }); } }, skipMs + 10);
      }
      var canSkip = !rec && Date.now() - st.shownAt >= skipMs;
      var mic = h('button', { class: 'sae-mic sae-mic-btn sa-mic' + (rec ? ' is-on' : ''), type: 'button', 'aria-label': C.mic_tap, disabled: rec },
        [h('span', { 'aria-hidden': 'true', text: '🎤' })]);
      mic.addEventListener('click', function () { if (!rec && !busy) probe(); });
      return screen(v, 'sae-miccheck', [
        h('h1', { class: 'sae-h1', text: head }),
        mic,
        h('p', { class: 'sae-sub', text: rec ? C.mic_speak : C.mic_tap }),
      ], [canSkip ? btn(C.mic_skip, function () { micDone(false, 0); }, 'sae-mic-skip') : null], true);
    }
    function probe() {
      if (typeof opts.micProbe !== 'function') { micDone(false, 0); return; }
      micSt = { stage: 'rec' };
      draw();
      var p;
      try { p = Promise.resolve(opts.micProbe()); } catch (e) { p = Promise.reject(e); }
      p.then(function (r) {
        if (!alive || !micSt) return;
        r = r || {};
        micSt = { stage: 'ask', probe: { ok: !!r.ok, rms: typeof r.rms === 'number' ? r.rms : 0 } };
        draw();
        playBack(r.url).then(function () { if (alive && micSt && micSt.stage === 'ask') say(line('mic_check_ask') || { en: COPY.en.mic_ask, ur: COPY.ur.mic_ask }); });
      }, function () { if (alive) micDone(false, 0); });
    }
    /** Play the probe back (a blob: URL from micProbe), resolving when it ends or fails. */
    function playBack(url) {
      return new Promise(function (ok) {
        if (typeof url !== 'string' || !/^blob:/.test(url) || typeof Audio === 'undefined') { ok(); return; }
        var a, done = false;
        function fin() { if (!done) { done = true; ok(); } }
        try {
          a = new Audio(url);
          a.onended = fin; a.onerror = fin;
          var pr = a.play();
          if (pr && pr.then) pr.then(null, fin);
          setTimeout(fin, PROBE_MS);
        } catch (e) { fin(); }
      });
    }
    /** heard: the child's answer; the check passes only when the probe also measured a voice. */
    function micDone(heard, rms) {
      var pr = micSt && micSt.probe;
      var level = typeof rms === 'number' ? rms : (pr ? pr.rms : 0);
      micSt = null;
      runner.micChecked(!!heard && !!(pr && pr.ok), level);
      draw();
    }

    /** The practice spoken question (RULING #13): Jugnu asks, a live meter, "I heard you!". */
    function sOralPractice(v) {
      var st = oralP || (oralP = { stage: 'listen', max: 0 });
      if (st.stage === 'heard') {
        return screen(v, 'sae-oralp is-heard', [
          jugnu('correct'),
          h('h1', { class: 'sae-h1', text: tx(line('oral_heard')) || C.oral_heard }),
        ], [btn(C.next, function () { oralP = null; runner.oralPracticeDone(true); draw(); }, 'sae-primary')]);
      }
      var bar = h('div', { class: 'sae-meter-fill' });
      st.bar = bar;
      return screen(v, 'sae-oralp', [
        h('span', { class: 'sae-chip', text: C.practice }),
        h('p', { class: 'sae-say', text: tx(line('oral_practice')) || C.oral_try }),
        h('div', { class: 'sae-mic sa-mic' + (st.stop ? ' is-on' : ''), 'aria-hidden': 'true' }, [h('span', { text: '🎤' })]),
        typeof opts.micLevel === 'function' ? h('div', { class: 'sae-meter sa-meter', 'aria-hidden': 'true' }, [bar]) : null,
      ], [btn(C.answered, function () { oralHeard(st.max >= HEARD_LEVEL || typeof opts.micLevel !== 'function'); }, 'sae-primary')]);
    }
    function startMeter() {
      if (!oralP || oralP.stop || typeof opts.micLevel !== 'function') return;
      var st = oralP, heardAt = null;
      try {
        st.stop = opts.micLevel(function (level) {
          if (!alive || oralP !== st) return;
          var l = Math.max(0, Math.min(1, +level || 0));
          if (l > st.max) st.max = l;
          if (st.bar) st.bar.style.width = (l * 100).toFixed(1) + '%';
          if (l >= HEARD_LEVEL && heardAt == null) { heardAt = Date.now(); later(function () { if (oralP === st && st.stage === 'listen') oralHeard(true); }, 1200); }
        });
      } catch (e) { st.stop = null; }
      var mic = el.querySelector('.sae-oralp .sae-mic');
      if (mic && st.stop) mic.classList.add('is-on');
    }
    function stopMeter() {
      if (oralP && typeof oralP.stop === 'function') { try { oralP.stop(); } catch (e) { /* page */ } }
      if (oralP) oralP.stop = null;
    }
    function oralHeard(heard) {
      stopMeter();
      if (!heard) { oralP = null; runner.oralPracticeDone(false); draw(); return; }
      oralP.stage = 'heard';
      draw();
      say(line('oral_heard') || { en: COPY.en.oral_heard, ur: COPY.ur.oral_heard });
    }

    /** The keypad warm-up (RULING #17): 20 s of free typing, the digits echoed big, a Done tile. */
    function sKeypadWarmup(v) {
      if (!kpw) {
        kpw = { keys: 0, done: false, shown: '' };
        kpw.timer = later(function () { kpwDone(); }, KP_WARM_MS);
      }
      var out = h('output', { class: 'sae-typed sa-typed sae-kpw-typed', dir: 'ltr', 'aria-live': 'polite' }, [kpw.shown || '\u00a0']);
      var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0'];
      var pad = h('div', { class: 'sae-keypad sa-keypad is-warm', dir: 'ltr' }, keys.map(function (k) {
        var b = h('button', { class: 'sae-key' + (k === 'del' ? ' sae-key-del' : ''), type: 'button', 'data-key': k, 'aria-label': k === 'del' ? C.erase : k }, [k === 'del' ? '⌫' : k]);
        b.addEventListener('click', function () {
          if (!kpw || kpw.done) return;
          kpw.keys++;
          kpw.shown = k === 'del' ? kpw.shown.slice(0, -1) : (kpw.shown + k).slice(-6);
          out.textContent = kpw.shown || '\u00a0';
        });
        return b;
      }));
      return screen(v, 'sae-kpwarm', [
        h('p', { class: 'sae-say', text: tx(line('keypad_warmup')) || C.kp_warm }),
        out,
        pad,
      ], [btn(tx(line('done')) || C.done, function () { kpwDone(); }, 'sae-primary')], true);
    }
    function kpwDone() {
      if (!kpw || kpw.done) return;
      kpw.done = true;
      clearTimeout(kpw.timer);
      var n = kpw.keys;
      kpw = null;
      runner.keypadWarmupDone(n);
      draw();
    }

    /** A full-screen stop the child cannot pass (refuse('voice'): the battery's voice is not ready). */
    function sRefused(v) {
      var msg = refused === 'voice' ? (tx(line('voice_not_ready')) || C.voice_not_ready) : C.voice_not_ready;
      return h('div', { class: 'sae-screen sae-refused' }, [
        h('div', { class: 'sae-body' }, [
          jugnu('sleep'),
          h('h1', { class: 'sae-h1', text: msg }),
        ]),
        mode === 'game' && safeBack(opts.back) ? h('div', { class: 'sae-foot' }, [btn(C.back, goBack, 'sae-primary')]) : null,
      ]);
    }

    function sTaskEnd(v) {
      var skipped = v.result && /^skipped|^mic_unavailable|^assets_unavailable/.test(v.result.stop_reason || '');
      return screen(v, 'sae-tend', [
        jugnu(skipped ? 'idle' : 'celebrate'),
        skipped ? null : h('h1', { class: 'sae-h1 sae-xl', text: C.well_done }),
      ], null);
    }

    function safeBack(u) {
      if (typeof u !== 'string' || !u) return null;
      if (/^\/(?!\/)/.test(u)) return u;
      try { var x = new URL(u, location.href); return x.origin === location.origin ? x.href : null; } catch (e) { return null; }
    }
    // handBack (the module's), not handback (this screen's wording, 'coach' | 'teacher', declared above).
    function goBack() { handBack(opts, function (u) { location.assign(u); }, safeBack); }
    function holdZone(onDone) {
      var z = h('button', { class: 'sae-hold sa-hold', type: 'button', 'aria-label': C.hold }, [h('span', { class: 'sae-hold-ring', 'aria-hidden': 'true' })]);
      var t = null;
      function cancel() { if (t) { clearTimeout(t); t = null; } z.classList.remove('is-holding'); }
      z.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        cancel();
        z.classList.add('is-holding');
        t = later(function () { t = null; z.classList.remove('is-holding'); onDone(); }, HOLD_MS);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (n) { z.addEventListener(n, cancel); });
      z.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      return z;
    }
    function sEnd(v) {
      if (mode === 'proctored') {
        return h('div', { class: 'sae-screen sae-end is-proctored' }, [
          holdZone(goBack),
          h('div', { class: 'sae-body' }, [
            jugnu('sleep'),
            h('h1', { class: 'sae-h1', text: C.all_done }),
            h('p', { class: 'sae-sub sae-handback', text: handback === 'coach' ? C.give_coach : C.give_teacher }),
          ]),
        ]);
      }
      return screen(v, 'sae-end', [
        jugnu('celebrate'),
        h('h1', { class: 'sae-h1 sae-xl', text: C.all_done }),
        h('p', { class: 'sae-sub', text: C.all_done_sub }),
        backWaiting ? h('p', { class: 'sae-sub sae-backwait', text: C.back_wait }) : null,
      ], [safeBack(opts.back) ? btn(C.back, goBack, 'sae-primary') : null], true);
    }

    function sHandover(v) {
      return h('div', { class: 'sae-screen sae-handover is-coach' }, [
        h('div', { class: 'sae-body' }, [
          jugnu('hello'),
          childName
            ? h('h1', { class: 'sae-h1' }, [C.handover_pre, h('bdi', { class: 'sae-name', text: childName }), C.handover_post])
            : h('h1', { class: 'sae-h1', text: C.handover_anon }),
        ]),
        h('div', { class: 'sae-foot' }, [btn(C.start, function () { handedOver = true; draw(); }, 'sae-primary')]),
      ]);
    }
    function coachLayer(v) {
      var kids = [];
      if (syncState) kids.push(h('span', { class: 'sae-sync sa-sync', 'data-state': String(syncState.state || ''), role: 'img', 'aria-label': C.sync + ': ' + String(syncState.state || '') }));
      if (v.phase !== 'battery_end') {
        kids.push(holdZone(function () {
          coachMenu = true;
          try { if (opts.onCoachMenu) opts.onCoachMenu(true); } catch (e) { /* page */ }
          draw();
        }));
      }
      return kids;
    }
    function closeCoach() {
      coachMenu = false;
      try { if (opts.onCoachMenu) opts.onCoachMenu(false); } catch (e) { /* page */ }
      draw();
    }
    function sCoachMenu(v) {
      var canEnd = ['running', 'instruction', 'practice', 'ready', 'last_word'].indexOf(v.phase) >= 0;
      return h('div', { class: 'sae-coach-menu sa-coach-menu', role: 'dialog', 'aria-label': C.coach }, [
        h('div', { class: 'sae-coach-card' }, [
          h('p', { class: 'sae-chip', text: C.coach }),
          v.task ? h('p', { class: 'sae-sub', text: tx(v.task.title) }) : null,
          canEnd ? btn(C.end_task, function () { hold = null; listening = null; runner.coachEnd(); closeCoach(); }, 'sae-secondary sae-danger') : null,
          btn(C.cont, closeCoach, 'sae-primary'),
        ]),
      ]);
    }

    // ---------- the frame ----------
    function keyOf(v) {
      var k = v.phase + '|' + v.task_index;
      if (v.phase === 'practice' && v.practice) k += '|' + v.practice.id;
      if (v.phase === 'running' && v.item) k += '|' + v.item.id + '|' + v.item_index;
      return k;
    }

    // What a screen says when it first shows.
    function enter(v) {
      var t = v.task;
      var s = (t && t.script) || {};
      if (v.phase === 'battery_intro') say(line('welcome'));
      else if (v.phase === 'audio_check') {
        if (checkBad) say(line('audio_fail') || { en: COPY.en.audio_bad_sub, ur: COPY.ur.audio_bad_sub });
        else {
          if (!check) newCheck();
          sayChain([[line('audio_check') || { en: COPY.en.audio_q, ur: COPY.ur.audio_q }], [{ en: check.target.en, ur: check.target.ur }, check.target.audio || null]]);
        }
      } else if (v.phase === 'warmup') say({ en: COPY.en.warm_title, ur: COPY.ur.warm_title });
      else if (v.phase === 'mic_check') {
        if (typeof opts.micProbe !== 'function') later(function () { if (runner.view().phase === 'mic_check') { micSt = null; runner.micChecked(false, 0); draw(); } }, 0);
        else say(line('mic_check') || { en: COPY.en.mic_say, ur: COPY.ur.mic_say });
      } else if (v.phase === 'oral_practice') {
        var gp = gen;
        say(line('oral_practice') || { en: COPY.en.oral_try, ur: COPY.ur.oral_try }).then(function () { if (alive && gp === gen) startMeter(); });
      } else if (v.phase === 'keypad_warmup') say(line('keypad_warmup') || { en: COPY.en.kp_warm, ur: COPY.ur.kp_warm });
      else if (v.phase === 'instruction') playIntro(t);
      else if (v.phase === 'practice' && v.practice) {
        var first = t.practice.indexOf(v.practice) === 0;
        var k0 = keyOf(v);
        sayChain([first && s.practice_intro ? [s.practice_intro] : null]).then(function () { if (alive && lastKey === k0 && !hold) sayItem(v.practice, t); });
      } else if (v.phase === 'ready') sayChain([s.test_intro ? [s.test_intro] : null, s.begin ? [s.begin] : null]);
      else if (v.phase === 'running' && v.item) {
        if (t.mode === 'oral') {
          var key = keyOf(v), g2 = gen;
          sayItem(v.item, t).then(function () {
            if (!alive || g2 !== gen || lastKey !== key) return;
            if (runner.promptDone) runner.promptDone(); // the answer window starts after the question
            oralRec = { task: t, item: v.item, key: key };
            try { if (opts.onRecordStart) opts.onRecordStart(t, v.item); } catch (e) { /* recorder */ }
            var mic = el.querySelector('.sae-mic');
            if (mic) mic.classList.add('is-on');
          });
        } else if (t.say_on === 'replay') {
          // The sum is on the screen; Jugnu reads it only when the replay tile is tapped.
          if (runner.promptDone) runner.promptDone();
        } else if (!t.time_limit_s) {
          // Untimed (word problems, comparison …): the wait for "next" starts once Jugnu has finished reading.
          var key2 = keyOf(v), g3 = gen;
          sayItem(v.item, t).then(function () { if (alive && g3 === gen && lastKey === key2 && runner.promptDone) runner.promptDone(); });
        } else sayItem(v.item, t);
      } else if (v.phase === 'running' && t && t.mode === 'record') {
        // The star line first; the recorder opens after it (recorderHooks), so Jugnu is neither in the child's
        // recording nor in the silence watch's first second.
        starSpeech = say(line('done') || { en: COPY.en.done, ur: COPY.ur.done });
      } else if (v.phase === 'last_word') {
        sayChain([v.time_left_ms === 0 && s.time_up ? [s.time_up] : null, s.intro_tap ? [s.intro_tap] : [{ en: COPY.en.last_word, ur: COPY.ur.last_word }]]);
      } else if (v.phase === 'task_end') {
        var r = v.result || {};
        var skipped = /^skipped|^mic_unavailable|^assets_unavailable/.test(r.stop_reason || '');
        var said = skipped ? null : ((r.stop_reason === 'time_up' ? s.time_up : r.stop_reason === 'early_stop_first_line' ? s.early_stop : null) || s.after);
        var sp = said ? say(said) : Promise.resolve();
        var at = v.task_index;
        Promise.all([delay(skipped ? 400 : TASK_END_MS), capped(sp, TASK_END_CAP_MS)]).then(function () {
          if (!alive) return;
          var now = runner.view();
          if (now.phase === 'task_end' && now.task_index === at) { runner.next(); draw(); }
        });
      } else if (v.phase === 'battery_end') {
        if (mode === 'proctored') say(handback === 'teacher' && line('end') ? line('end') : { en: COPY.en.give_coach, ur: COPY.ur.give_coach });
        else say({ en: COPY.en.all_done, ur: COPY.ur.all_done });
      }
    }

    // The recorder hooks: a record task's running phase (however it ends), and each oral question.
    function recorderHooks(v) {
      var isRec = v.phase === 'running' && v.task && v.task.mode === 'record';
      if (isRec && recording !== v.task) {
        var task = v.task;
        recording = task;
        // After this render's speech is queued: wait for the star line, then open the recorder (if still reading).
        Promise.resolve().then(function () { return starSpeech; }).then(function () {
          starSpeech = null;
          if (alive && recording === task) { try { if (opts.onRecordStart) opts.onRecordStart(task); } catch (e) { /* recorder */ } }
        });
      } else if (!isRec && recording) {
        var t = recording;
        recording = null;
        try { if (opts.onRecordStop) opts.onRecordStop(t); } catch (e) { /* recorder */ }
      }
      if (oralRec && oralRec.key !== keyOf(v)) {
        var o = oralRec;
        oralRec = null;
        try { if (opts.onRecordStop) opts.onRecordStop(o.task, o.item); } catch (e) { /* recorder */ }
      }
    }

    function draw() {
      if (!alive) return;
      var v = runner.view();
      var key = keyOf(v);
      if (hold && v.phase !== 'practice' && v.phase !== 'ready') hold = null;
      if (listening && v.phase !== 'ready') listening = null;
      var showPhase = hold ? 'practice' : listening ? 'listen' : v.phase;
      if (!handedOver && v.phase === 'battery_intro') showPhase = 'handover';
      if (refused) showPhase = 'refused';
      if (v.phase !== 'oral_practice' && oralP) { stopMeter(); oralP = null; }
      if (v.phase !== 'mic_check') micSt = null;
      if (v.phase !== 'keypad_warmup' && kpw) { clearTimeout(kpw.timer); kpw = null; }
      starEl = null;
      var entered = key !== lastKey && !hold && !listening && showPhase !== 'handover' && showPhase !== 'refused';
      if (entered) { gen++; typed = ''; }
      recorderHooks(v);
      clockEls = null;
      displayEl = null;
      shownOffer = false;
      var s;
      switch (showPhase) {
        case 'handover': s = sHandover(v); break;
        case 'refused': s = sRefused(v); break;
        case 'mic_check': s = sMicCheck(v); break;
        case 'oral_practice': s = sOralPractice(v); break;
        case 'keypad_warmup': s = sKeypadWarmup(v); break;
        case 'battery_intro': s = sIntro(v); break;
        case 'audio_check': s = sCheck(v); break;
        case 'warmup': s = sWarmup(v); break;
        case 'instruction': s = sInstruction(v); break;
        case 'practice': s = sPractice(v); break;
        case 'ready': s = sReady(v); break;
        case 'listen': s = sListen(v); break;
        case 'running':
          s = v.task.mode === 'tap' ? sRunTap(v) : v.task.mode === 'keypad' ? sRunKeypad(v) : v.task.mode === 'keyboard' ? sRunKeyboard(v) : v.task.mode === 'oral' ? sRunOral(v) : sRunRecord(v);
          break;
        case 'last_word': s = sLastWord(v); break;
        case 'task_end': s = sTaskEnd(v); break;
        case 'battery_end': s = sEnd(v); break;
        default: s = screen(v, '', [h('p', { text: v.phase })]);
      }
      while (el.firstChild) el.removeChild(el.firstChild);
      el.appendChild(s);
      if (mode === 'proctored' && showPhase !== 'handover' && showPhase !== 'refused') {
        coachLayer(v).forEach(function (n) { el.appendChild(n); });
        if (coachMenu) el.appendChild(sCoachMenu(v));
      }
      el.setAttribute('data-phase', showPhase);
      el.setAttribute('data-task-mode', v.task ? v.task.mode : '');
      if (entered) { lastKey = key; enter(v); }
      loop(v.phase === 'running' && !listening && !refused);
      try { if (opts.onState) opts.onState(v); } catch (e) { /* the page's hook never stops the test */ }
    }

    // ---------- the clock loop (running only) ----------
    function frame() {
      if (!alive || busy || listening) return;
      var r = runner.tick();
      var v = runner.view();
      if (keyOf(v) !== lastKey) { draw(); return; }
      if (r === 'replay' && v.item && v.task.say_on !== 'replay') sayItem(v.item, v.task);
      if (!!v.offer_next !== shownOffer) { draw(); return; }
      if (v.time_left_ms != null) paintClock(v.time_left_ms);
    }
    function rafStep() {
      raf = null;
      frame();
      if (alive && iv != null && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(rafStep);
    }
    function loop(on) {
      if (on) {
        if (iv == null) iv = setInterval(frame, 250); // a background tab gets no animation frames
        if (raf == null && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(rafStep);
      } else {
        if (raf != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
        raf = null;
        if (iv != null) clearInterval(iv);
        iv = null;
      }
    }

    draw();

    return {
      render: function () { draw(); },
      /** The mercy rule (RULING #10; the engine calls it after 12 s of no voice): Jugnu says lines.mercy once, the star pulses. */
      mercy: function () {
        var v = runner.view();
        if (!alive || v.phase !== 'running' || !v.task || v.task.mode !== 'record' || mercied[v.task.id]) return;
        mercied[v.task.id] = true;
        var star = el.querySelector('.sae-star');
        if (star) star.classList.add('is-mercy');
        say(line('mercy') || { en: COPY.en.mercy, ur: COPY.ur.mercy });
      },
      /** A full-screen stop: refuse('voice') when the battery's voice is not ready (proctored: no buttons; game: back). */
      refuse: function (kind) {
        if (!alive) return;
        refused = kind || 'voice';
        gen++;
        loop(false);
        draw();
        say(line('voice_not_ready') || { en: COPY.en.voice_not_ready, ur: COPY.ur.voice_not_ready });
      },
      /** Game: the map cannot be reached yet (the engine waits for the network): the end screen says so, spoken once. */
      backWait: function () {
        if (!alive || backWaiting) return;
        backWaiting = true;
        draw();
        say({ en: COPY.en.back_wait, ur: COPY.ur.back_wait });
      },
      /** The sync status ({ state, pending_events }) as a small coach-facing dot (proctored only). */
      setSync: function (status) {
        syncState = status && typeof status === 'object' ? status : (status ? { state: String(status) } : null);
        if (mode !== 'proctored' || !alive) return;
        var dot = el.querySelector('.sae-sync');
        if (dot && syncState) { dot.setAttribute('data-state', String(syncState.state || '')); dot.setAttribute('aria-label', C.sync + ': ' + String(syncState.state || '')); }
        else draw();
      },
      destroy: function () {
        stopMeter();
        alive = false;
        loop(false);
        timers.forEach(clearTimeout);
        if (recording) { var t = recording; recording = null; try { if (opts.onRecordStop) opts.onRecordStop(t); } catch (e) { /* recorder */ } }
        if (oralRec) { var o = oralRec; oralRec = null; try { if (opts.onRecordStop) opts.onRecordStop(o.task, o.item); } catch (e) { /* recorder */ } }
        while (el.firstChild) el.removeChild(el.firstChild);
      },
    };
  }

  /**
   * The coach's press-and-hold on the hand-back screen. With the engine's onUnlock the screen never navigates: the
   * engine writes the last events, flushes the sync and only then goes to back (or posts sa:done), once. Without it
   * (the standalone demo page) the screen goes to back itself.
   */
  function handBack(opts, assign, safe) {
    try { if (opts.onHandback) opts.onHandback(); } catch (e) { /* page */ }
    if (opts.onUnlock) {
      try { opts.onUnlock(); } catch (e) { /* page */ }
      return;
    }
    var u = safe(opts.back);
    if (u) assign(u);
  }

  return { mount: mount, handback: handBack, COPY: COPY };
}));
