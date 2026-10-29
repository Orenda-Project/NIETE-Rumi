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
 *   micLevel(cb(level 0..1)) → stop() (a live input level, for the practice oral question),
 *   manual (RDF manual: the coach gives the instructions), app_asks (manual: Jugnu asks the questions), passage_punct (the passage drawn from its own text)
 * }) → { render(), destroy(), setSync(status), mercy(), refuse(kind[, { retry }]), unrefuse(), backWait() }
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
 * Wave 3 (each OFF unless the page passes it):
 *   one cell at a time  a read-aloud grid in the runner's one_at_a_time shows one big cell and Next; when the runner
 *                       moves a cell on by itself Jugnu says lines.please_go_on. Mental maths shows its sum big.
 *   manual              before each task Jugnu says only lines.coach_will_instruct; a coach screen shows the words to
 *                       read out (task.coach_text, else the instruction) and "Give the phone to the child"; no
 *                       other clip plays (no welcome, warm-up, item, practice model, feedback or end line; the sound check
 *                       keeps its prompt, word and replay, and the hand-over screen says to put the headphones on). Every
 *                       item auto speaks is listed on the coach screen and shown again with its item, for the coach to
 *                       read out; a hidden passage is shown to the coach to read; no replay buttons.
 *   app_asks            (round 6, R6-2, manual only) the coach says the instruction; Jugnu asks every question: each
 *                       item it has words for (a comprehension question; a sum on its replay tile, as auto), a tap item's
 *                       question (the task's own tap line, which carries no per-item words), the practice models and the
 *                       practice feedback, the star line and "Stop" at time-up. The coach screen splits "You say" from
 *                       "Jugnu asks" (folded, not for reading out) and says how the child answers.
 *   passage_punct       the passage's words are the whitespace tokens of passage.text (its «۔ ، ؟» and ". , ?"),
 *                       one per item, a multi-word item spanning its tokens; scoring and the last word are unchanged.
 *                       A text that does not line up with the items falls back to the items' words.
 *
 * Round 7b, the child's screens (each OFF unless the served battery carries battery.ui.<flag>; sa-battery-switches.js):
 *   back_button       a Back button next to Next on the item screens (a one-at-a-time cell after the first, a tap /
 *                     typed / spoken item after the first), both modes: runner.back() (sa-core) shows the one before.
 *   audio_gated_next  the instruction's Next, the spoken practice's Next and Ready's Go wait until Jugnu has finished
 *                     (a voice that never ends opens them after GATE_CAP_MS). Coach-led: Jugnu is silent, nothing waits.
 *   say_then_next     lines.r7_say_next / r7_say_done after the task's instruction (said and shown) and shown under the
 *                     item while the child answers; tick_prompt: lines.r7_type_tick for a typed number; story_scroll:
 *                     lines.r7_scroll after the story's instruction, and a down arrow under the story while more is below.
 *
 * Round 8, the child's flow (each OFF unless battery.ui.<flag>):
 *   r8_reading_no_done   a reading (passage) screen says nothing about "done" on the way in; the recorder opens after a
 *                        short gap (R8_REC_GAP_MS) in place of the Done line. The star keeps its Done label.
 *   r8_comp_wait_next    a story / listening question never moves on by itself (sa-core); its button reads Next, and a
 *                        quiet line under it says a stuck child can press it (lines.stuck_press_next, else COPY). Shown,
 *                        never spoken on the question: Jugnu's voice would land in the child's recorded answer.
 *   r8_practice_autoplay a spoken practice says its answer (its model) on arrival, after its prompt; Next goes straight
 *                        on (no second telling); the replay chip says the prompt and the answer again. Coach-led: silent.
 * Round 8, the child's screens (each OFF unless the served battery carries battery.ui.r8_<flag>):
 *   r8_layout         (items 6/12/21) the mount carries .is-r8-layout (sa.css "Round 8"): pictures and tap targets sized
 *                     for the phone or the tablet, large text at normal weight, a letter card one fixed box; a Latin
 *                     card or text tile is centred on its ink like an Urdu one, and every card is placed again on resize.
 *   r8_story_snap     (item 15) the story is its own scroll box of parts, one box high each (CSS scroll-snap, snap-stop
 *                     always: a fling cannot skip a part); the down arrow moves exactly one part on. The recording, the
 *                     clock and the star are as before.
 * Round 8, the child's screens (each OFF unless the served battery carries battery.ui.r8_<flag>):
 *   r8_nudges         (items 25/26) every child item screen shows how it is answered, small and quiet at the top bar's
 *                     physical right edge (both directions): a mic on a speaking screen (read aloud, a spoken answer,
 *                     a spoken practice) with a level bar from SAE.mic.level (opts.micLevel; hidden until the first
 *                     level, so no mic = the icon alone), a tapping finger on a tapping or typing screen. One level loop
 *                     per screen, stopped when the screen changes and on destroy().
 *   r8_highlight      (item 32) the instruction's words (and its round-7b line) are lit one by one while Jugnu says them,
 *                     like the storybook: the timing file beside a v4 clip (sa/v4/<lang>/<key>.json, fetched once), the
 *                     clock the playing clip's currentTime (speak.audio(), the voice's), read every animation frame and
 *                     the light moved only when the word changes. No file, a 404, a word count unlike the text on the
 *                     screen, a clip that is not v4 or no audio element: the plain words, silently.
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
      coach_last_word: 'Coach: tap the last word the child read',
      lw_listening: 'Finding it in the recording…',
      lw_suggested: 'Marked from the recording. Tap another word to change it.',
      lw_none: 'Tap the last word the child read.',
      lw_confirm: 'Confirm',
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
      mic_skip_say: 'If the microphone is not working, tap the Skip button.',
      mic_skip_task: 'No microphone found. That is fine, let us go on to the next game',
      dev_jump: 'Jump to…',
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
      please_go_on: 'Please go on.',
      coach_will_instruct: 'Your coach will now give the instructions.',
      // round 7b (sa_silence_repeat): no voice heard on a read-aloud part
      silence_repeat: 'Jugnu could not hear you. Say your answer out loud again. Let us do this part again.',
      silence_again: 'Try again',
      silence_title: 'Say it out loud',
      coach_read: 'Read this to the child:',
      coach_then: 'Then give the phone to the child.',
      coach_items: 'Read each one out when it shows:',
      coach_you: 'You say — read this to the child:',
      coach_app: 'Jugnu asks — do not read these:',
      answers_by: 'The child answers by:',
      by_say: 'saying it aloud',
      by_tap: 'tapping',
      by_type: 'typing',
      headphones: 'Put the headphones on the child, then check the sound.',
      back_item: 'Back',
      more_below: 'More of the story below',
      chip_say_next: 'Say it, then press Next',
      chip_type_tick: 'Type, then press ✓',
      // round 8 (r8_comp_wait_next): under a story question, when the battery has no lines.stuck_press_next
      stuck_press_next: 'If you are stuck, press the button to go on.',
      // round 8 (sa_r8_lang_switch): the language toggle's spoken name
      r8_lang: 'Language: Urdu or English',
      // round 8 (items 25/26): the quiet cue's spoken name (screen readers)
      cue_speak: 'Answer by speaking',
      cue_tap: 'Answer by tapping',
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
      coach_last_word: 'کوچ: بچے کا پڑھا ہوا آخری لفظ دبائیں',
      lw_listening: 'ریکارڈنگ میں تلاش ہو رہا ہے…',
      lw_suggested: 'یہ لفظ ریکارڈنگ سے چنا گیا ہے۔ بدلنے کے لیے دوسرا لفظ دبائیں۔',
      lw_none: 'بچے کا پڑھا ہوا آخری لفظ دبائیں۔',
      lw_confirm: 'تصدیق کریں',
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
      mic_skip_say: 'اگر مائیک کام نہیں کر رہا تو "چھوڑ دیں" کا بٹن دبائیں۔',
      mic_skip_task: 'مائیک نہیں ملا۔ کوئی بات نہیں، اگلے کھیل پر چلتے ہیں',
      dev_jump: 'اس حصے پر جائیں…',
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
      please_go_on: 'آگے چلیں۔',
      coach_will_instruct: 'اب آپ کے کوچ ہدایات دیں گے۔',
      silence_repeat: 'جگنو آپ کی آواز نہیں سن سکا۔ جواب کو دوبار اونچی آواز میں بولیں۔ آئیے یہ حصہ دوبارہ کرتے ہیں۔',
      silence_again: 'دوبارہ کریں',
      silence_title: 'اونچی آواز میں بولیں',
      coach_read: 'یہ بچے کو پڑھ کر سنائیں:',
      coach_then: 'پھر فون بچے کو دے دیں۔',
      coach_items: 'ہر ایک سامنے آنے پر پڑھ کر سنائیں:',
      coach_you: 'آپ کہیں — یہ بچے کو پڑھ کر سنائیں:',
      coach_app: 'جگنو پوچھے گا — یہ آپ نہ پڑھیں:',
      answers_by: 'بچہ جواب دے گا:',
      by_say: 'بول کر',
      by_tap: 'دبا کر',
      by_type: 'لکھ کر',
      headphones: 'بچے کو ہیڈفون لگائیں، پھر آواز چیک کریں۔',
      back_item: 'پیچھے',
      more_below: 'کہانی نیچے بھی ہے',
      chip_say_next: 'بولیں، پھر «آگے» دبائیں',
      chip_type_tick: 'لکھیں، پھر ✓ دبائیں',
      stuck_press_next: 'اگر آپ کو جواب نہ آئے تو آگے جانے کے لیے بٹن دبائیں۔',
      // round 8 (sa_r8_lang_switch)
      r8_lang: 'زبان: اردو یا انگریزی',
      // round 8 (items 25/26)
      cue_speak: 'بول کر جواب دیں',
      cue_tap: 'دبا کر جواب دیں',
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
  var MIC_SKIP_MS = 3000;   // a record task skipped for no microphone: its line stays this long (RULING #38b)
  var PRESS_MS = 180;
  var MN_FLOAT_MS = 300;    // round 8 item 30: a tapped number floats into the blank this long
  var MN_HOLD_MS = 450;     // ... and the screen waits this much longer than a plain tap, so the child sees it land
  var WARM_N = 10;
  var WARM_CAP_MS = 25000;
  var HOLD_MS = 3000;
  var GATE_CAP_MS = 30000;  // audio_gated_next: Next opens by itself this long after the words began, whatever the voice does
  var R8_REC_GAP_MS = 600;  // r8_reading_no_done: the reading's recorder opens this long after the screen, in place of the Done line
  var KEYPAD_MIN = 3;        // digits the keypad takes; more when the task has a longer answer (1,000 + 300 + 80 + 3)
  var WORD_MAX = 16;
  var LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
  var KP_WARM_MS = 20000;   // RULING #17: 20 s of free typing
  var HEARD_LEVEL = 0.15;   // the practice oral question: the meter crossed this once = heard
  var PROBE_MS = 4000;      // the mic probe's own guard
  // Round 8 (items 25/26): the cue's pictures, drawn in the text colour (sa.css mutes it): a mic, a tapping finger.
  var CUE_SVG = {
    speak: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false"><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/><path d="M9 21h6"/></svg>',
    tap: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M10 13V5.5a1.5 1.5 0 0 1 3 0V12"/><path d="M13 11.5a1.5 1.5 0 0 1 3 0V13"/><path d="M16 12.5a1.5 1.5 0 0 1 3 0V16a6 6 0 0 1-6 6h-1.2a5 5 0 0 1-4-2l-3-4a1.5 1.5 0 0 1 2.3-1.9L10 16"/><path d="M6.5 6.5a5 5 0 0 1 9.5-1.5"/></svg>',
  };

  // Round 8 (item 32): a v4 clip's word timings sit beside it (sa/v4/<lang>/<key>.json, the storybook read-along's
  // shape: { v: 1, key, lang, text, audio: { url, ms }, words: [{ i, t, s_ms, e_ms }] }). Fetched once per page.
  var V4_RX = /(^|\/)sa\/v4\//;
  var TIMINGS = {};
  /** The timing file's URL for a playing clip's src (a v4 clip only), else null. */
  function timingUrl(src) {
    var m = /^([^?#]*)\.(mp3|m4a|aac|ogg|opus|webm|wav)([?#].*)?$/i.exec(String(src || ''));
    return m && V4_RX.test(m[1]) ? m[1] + '.json' : null;
  }
  /** A timing object checked (version 1, words in order with times), as { words }; anything else null. */
  function timingOk(d) {
    if (!d || d.v !== 1 || !Array.isArray(d.words) || !d.words.length) return null;
    var prev = -1, words = [];
    for (var k = 0; k < d.words.length; k++) {
      var w = d.words[k], st = Number(w && w.s_ms), en = Number(w && w.e_ms);
      if (!w || w.i !== k || !isFinite(st) || !isFinite(en) || st < 0 || en < st || st < prev) return null;
      prev = st;
      words.push({ s_ms: st, e_ms: en });
    }
    return { words: words };
  }
  /** Promise<{ words } | null> for a playing clip; never rejects, never logs. A refused fetch (offline) is asked again next time. */
  function timingFor(src) {
    var u = timingUrl(src);
    if (!u) return Promise.resolve(null);
    if (TIMINGS[u]) return TIMINGS[u];
    var f = typeof window !== 'undefined' && typeof window.fetch === 'function' ? window.fetch.bind(window) : (typeof fetch === 'function' ? fetch : null);
    if (!f) return Promise.resolve(null);
    var p = TIMINGS[u] = Promise.resolve().then(function () { return f(u, { credentials: 'same-origin' }); }).then(function (r) {
      return r && r.ok ? Promise.resolve(r.json()).then(timingOk, function () { return null; }) : null;
    }, function () { delete TIMINGS[u]; return null; });
    return p;
  }
  function nextFrame(fn) { return typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16); }
  function cancelFrame(id) { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); else clearTimeout(id); }

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
  /**
   * The passage's words as printed (sa_passage_punct): the whitespace tokens of passage.text, one per item (an item of
   * n words takes n tokens), each checked against its item with punctuation and vowel marks aside. null when they do not line up.
   */
  var PUNCT_RX = /[\u0021-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007E\u00AB\u00BB\u060C\u061B\u061F\u06D4\u2018-\u201F\u2026]/g;
  // Compared with the vowel marks aside too: a scored word may drop the text's zer/zabar/pesh (بھوک for بھُوک).
  var MARKS_RX = /[\u064B-\u065F\u0670\u06EA-\u06ED\u200C\u200D]/g;
  function bare(x) { return String(x).replace(PUNCT_RX, '').replace(MARKS_RX, '').replace(/\s+/g, ' ').trim(); }
  function passageWords(t) {
    var text = t && t.passage && (typeof t.passage === 'string' ? t.passage : t.passage.text);
    var items = (t && t.items) || [];
    if (typeof text !== 'string' || !items.length) return null;
    var tokens = text.split(/\s+/).filter(Boolean);
    var out = [], k = 0;
    for (var i = 0; i < items.length; i++) {
      var w = items[i] && (items[i].label != null ? items[i].label : items[i].target);
      if (w == null) return null;
      var n = String(w).trim().split(/\s+/).length;
      var shown = tokens.slice(k, k + n).join(' ');
      if (k + n > tokens.length || bare(shown) !== bare(w)) return null;
      out.push(shown);
      k += n;
    }
    return k === tokens.length ? out : null;
  }

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  /** Urdu (and Arabic-Indic) digits as 0-9. */
  var URDU_DIGIT_RX = /[\u06F0-\u06F9\u0660-\u0669]/;
  function latinDigits(s) {
    return String(s).replace(/[\u06F0-\u06F9\u0660-\u0669]/g, function (d) { var c = d.charCodeAt(0); return String(c >= 0x06F0 ? c - 0x06F0 : c - 0x0660); });
  }
  /** A sum on its own ("1 + 3", "19 − 6 =", "3 × 4 = ?"): numbers and one or more operators, an optional = and blank. */
  var SUM_RX = /^\s*[\d\u06F0-\u06F9\u0660-\u0669][\d\u06F0-\u06F9\u0660-\u0669.,\s]*[+\-\u2212\u00D7\u00F7][\d\u06F0-\u06F9\u0660-\u0669.,\s+\-\u2212\u00D7\u00F7]*(=\s*[?_]*)?\s*$/;
  function sumBase(s) { return String(s).replace(/\s*=?\s*[?_]*\s*$/, '').trim(); }
  function capped(p, ms) { return Promise.race([Promise.resolve(p).catch(function () {}), delay(ms)]); }

  function mount(el, opts) {
    var runner = opts.runner;
    // Round 8 item 4 (sa_r8_lang_switch): the screens read the run through langView() (the instruction language's words)
    var r8Lang = !!(opts.battery && opts.battery.ui && opts.battery.ui.r8_lang_switch === true);
    if (r8Lang) runner = langRunner(opts.runner);
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
    var refusedRetry = null;  // refuse(kind, { retry }) (sa_voice_gate_v2): Try again, () → Promise<boolean>
    var retrying = false;
    var backWaiting = false;  // backWait(): game, the map not reachable yet; the end screen says the island waits here
    var starEl = null;
    var starSpeech = null;
    var childName = opts.child && typeof opts.child.first_name === 'string' ? opts.child.first_name.trim().slice(0, 40) : '';
    var manual = !!opts.manual;
    var appAsks = manual && !!opts.app_asks; // sa_app_asks (round 6, R6-2)
    var sectionRec = !!opts.section_recording; // an oral task is one recording from Begin (sa_section_recording)
    // sa_coach_last_word: the coach marks the last word read; the recording suggests it, the coach confirms (coach mode only)
    // sa_auto_child_last_word (round 5): in RDF auto the child taps it, as before; the coach's screen is RDF manual's only.
    var childLW = !!opts.auto_child_last_word && mode === 'proctored' && !manual;
    var coachLW = !!opts.coach_last_word && mode === 'proctored' && !childLW;
    var lw = null; // { task, state: pending | ready | none, suggested, picked }
    var punct = !!opts.passage_punct;
    var urFit = !!opts.ur_fit; // sa_ur_fit (round 6): an Urdu sentence on a demo card is marked Urdu, so it takes the Urdu rules
    // Round 7b, the child's screens: the served battery's switches (sa-battery-switches.js)
    var r7 = (opts.battery && opts.battery.ui) || {};
    // Round 8 item 4 (sa_r8_lang_switch): the instruction language can change mid-test (the toggle in the top bar)
    var homeLang = lang;
    var homeLines = lines;
    var langAlt = {};     // lang → the same test's battery in that language (normalised), from langBattery()
    var langWant = null;  // the language the toggle asked for; it takes over at the next screen
    var langOnSwitch = null;
    var langCache = null; // runner task / item → the same in the instruction language (stable per language)
    var gate = { key: null, open: true, tok: 0 }; // audio_gated_next: the screen whose Next waits, and whether it is open
    var moreEl = null; // story_scroll: the arrow under the story on show
    // Round 8 (the reviewer's 28 Oct list), the maths screens: battery.ui.r8_* (absent = today's screens).
    var r8Digits = r7.r8_latin_digits === true; // items 29/3/34: every number shown in 0-9; a sum reads "1 + 3 = ___"
    var r8Mn = r7.r8_missing_number === true;   // item 30: the number row large; a tapped number floats into the blank
    var mnFill = null;                          // item 30: { item, value }, the number tapped into the item's blank
    // Round 8: r8_layout (items 6/12/21), r8_story_snap (item 15)
    var r8Layout = r7.r8_layout === true;
    var r8Snap = r7.r8_story_snap === true;
    var snapPos = { id: null, top: 0 }; // r8_story_snap: where the story box was scrolled to, kept over a redraw

    function later(fn, ms) { var t = setTimeout(function () { if (alive) fn(); }, ms); timers.push(t); return t; }
    /** audio_gated_next: the screen `key`'s Next waits for `p` (Jugnu's words), at most GATE_CAP_MS. */
    function gateOn(key, p) {
      if (r7.audio_gated_next !== true || manual) return;
      var tok = ++gate.tok;
      gate.key = key; gate.open = false;
      Array.prototype.forEach.call(el.querySelectorAll('.sae-gated'), function (b) { b.disabled = true; b.classList.add('is-wait'); });
      function open() {
        if (!alive || tok !== gate.tok) return;
        gate.open = true;
        Array.prototype.forEach.call(el.querySelectorAll('.sae-gated'), function (b) { b.disabled = false; b.classList.remove('is-wait'); });
      }
      Promise.resolve(p).then(open, open);
      later(open, GATE_CAP_MS);
    }
    function waiting(v) { return !gate.open && gate.key === keyOf(v); }
    /** A primary button that waits for Jugnu (audio_gated_next) on screen v. */
    function gatedBtn(v, label, onclick, cls) {
      var b = btn(label, function (e) { if (!waiting(v)) onclick(e); }, (cls || '') + ' sae-gated');
      if (waiting(v)) { b.disabled = true; b.classList.add('is-wait'); }
      return b;
    }
    /** A task read aloud one cell at a time (its Next moves on). */
    function cellish(t) {
      if (!t || t.mode !== 'record' || t.passage) return false;
      if (t.present === 'one_at_a_time') return true;
      return r7.one_at_a_time === true && Array.isArray(t.grid) && t.grid.length > 0;
    }
    /** say_then_next / tick_prompt / story_scroll: the task's extra instruction line, when its switch and line are there. */
    function hintOf(t) {
      if (!t) return null;
      if (r7.say_then_next === true && cellish(t)) return line('r7_say_next');
      if (r7.say_then_next === true && t.mode === 'oral') return (compWait(t) && line('r7_say_next_q')) || line('r7_say_done');
      if (r7.tick_prompt === true && t.mode === 'keypad') return line('r7_type_tick');
      if (r7.story_scroll === true && t.mode === 'record' && t.passage) return line('r7_scroll');
      return null;
    }
    /** r8_comp_wait_next: a story or listening question, which waits for Next (sa-core drops its timeout). */
    function compWait(t) { return r7.r8_comp_wait_next === true && !!t && t.mode === 'oral' && /comprehension$/.test(t.subtask || '') && (!manual || appAsks); }
    function sayNext(t) { return r7.say_then_next === true && cellish(t) && !!line('r7_say_next'); }
    function hintEl(t, cls) {
      var hl = hintOf(t);
      if (!hl) return null;
      return h('p', { class: (cls || 'sae-say') + ' sae-r7-hint' }, [hlText(tx(hl), hl), t.mode === 'keypad' ? h('span', { class: 'sae-r7-tick', 'aria-hidden': 'true', text: ' ✓' }) : null]);
    }
    /** back_button: Back on an item screen after the first item (or cell); runner.back() shows the one before. */
    function backBtn(v) {
      if (r7.back_button !== true || v.phase !== 'running' || !v.task) return null;
      var first = v.cell != null ? !(v.cell_index > 0) : (v.task.mode === 'record' || !(v.item_index > 0));
      if (first) return null;
      return h('button', { class: 'sae-btn sae-secondary sae-back-item', type: 'button', onclick: function () {
        if (busy) return;
        if (runner.back && runner.back(manual ? 'coach' : 'child')) draw();
      } }, [lang === 'ur' ? '→ ' + C.back_item : '← ' + C.back_item]);
    }
    /** The foot of an item screen: Back (when on) beside its own button(s). */
    function itemFoot(v, main) {
      var b = backBtn(v);
      var kids = (main || []).filter(Boolean);
      if (!b) return kids;
      return [h('div', { class: 'sae-navrow' }, [b].concat(kids))];
    }
    /** story_scroll: whether the story on show has more below, in whatever scrolls (the body, else the page). */
    function scroller() {
      var box = r8Snap ? el.querySelector('.sae-passage.is-snap') : null;
      if (box) return box;
      var body = el.querySelector('.sae-run-rec .sae-body');
      if (body && body.scrollHeight > body.clientHeight + 4) {
        var oy = '';
        try { oy = getComputedStyle(body).overflowY; } catch (_) { oy = ''; }
        if (oy === 'auto' || oy === 'scroll') return body;
      }
      return document.scrollingElement || document.documentElement;
    }
    function checkMore() {
      if (!moreEl || !moreEl.isConnected) return;
      var sc = scroller();
      moreEl.hidden = !(sc && sc.scrollTop + sc.clientHeight < sc.scrollHeight - 8);
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('scroll', function () { if (alive) checkMore(); }, true);
      window.addEventListener('resize', function () { if (alive) checkMore(); });
    }
    // Round 8 item 30: a resize fits the missing number above the foot again
    if (r8Mn && typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', function () { if (alive) mnFit(el.querySelector('.sae-screen')); });
    }
    // Round 8: a resize (the phone turned, the address bar went) places the cards' ink and packs the story's parts again
    var refit = null;
    if ((r8Layout || r8Snap) && typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', function () {
        if (!alive) return;
        clearTimeout(refit);
        refit = later(function () {
          var s = el.querySelector('.sae-screen');
          if (s && r8Layout) fitCells(s);
          if (r8Snap) snapPack();
        }, 100);
      });
    }
    /**
     * RULING W3-18 (sa_voice_gate_v2, opts.opening): Jugnu's opening words wait for their clips' prefetch, at most
     * OPENING_CAP_MS from the first of them, so a busy tunnel's first refusal is not what the child hears; on the cap
     * the voice's own retry and fallback take over. A screen left while waiting says nothing.
     */
    var OPENING_CAP_MS = 3000;
    var opening = opts.opening && typeof opts.opening.then === 'function' ? opts.opening : null;
    var openingGate = null;
    function afterOpening(fn) {
      if (!opening) return fn();
      if (!openingGate) openingGate = Promise.race([opening.then(null, function () {}), new Promise(function (ok) { later(ok, OPENING_CAP_MS); })]);
      var k = keyOf(runner.view());
      return openingGate.then(function () { if (alive && keyOf(runner.view()) === k) return fn(); });
    }
    /** RDF manual: the coach gives every instruction and reads every item; Jugnu says only the line the caller marks. */
    function say(textObj, audioObj, inManual) {
      if (!textObj && !audioObj) return Promise.resolve();
      if (manual && !inManual) return Promise.resolve();
      if (r8Lang && lang !== homeLang) { var tagged = langSaid(textObj, audioObj); textObj = tagged[0]; audioObj = tagged[1]; }
      try {
        var p = Promise.resolve(speakFn(textObj || null, audioObj || null)).catch(function () {});
        if (r7.r8_highlight === true) { try { hlFollow(textObj, audioObj, p); } catch (e) { /* the plain words */ } }
        return p;
      } catch (e) { return Promise.resolve(); }
    }
    /** Say lines one after another, unless the screen changes. */
    function sayChain(list) {
      var g = gen;
      return list.reduce(function (p, x) {
        return p.then(function () { if (alive && g === gen && x) return say(x[0], x[1], x[2]); });
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
    /** Round 7: a maths number on the screen is in English digits on the Urdu page too (the tester: "that's how kids know
     *  them"). Shown text only, maths only (ids "ma.…"): Jugnu's clips still say the number in Urdu. */
    function shownNums(id, s) {
      if (!r8Digits && !/^ma\./.test(String(id || ''))) return s;
      return latinDigits(s);
    }
    /** r8_latin_digits (item 29): every number on the drawn screen in 0-9, Urdu page included. A reading task's own
     *  material (its passage, grid, tiles, the item) is left as printed: it is what is being read. */
    function latinScreen(root, t) {
      var keep = t && !/^ma\./.test(String(t.id || '')) ? '.sae-passage, .sae-grid, .sae-opts, .sae-onecell, .sae-label' : null;
      var w = document.createTreeWalker(root, 4); // text nodes
      for (var n = w.nextNode(); n; n = w.nextNode()) {
        if (!URDU_DIGIT_RX.test(n.nodeValue)) continue;
        if (keep && n.parentNode && n.parentNode.closest && n.parentNode.closest(keep)) continue;
        n.nodeValue = latinDigits(n.nodeValue);
      }
    }
    /** r8_latin_digits (item 34): a sum as a blank to fill, "13 + 6 = ___", so it is never read as a sum to repeat. */
    function isSum(s) { return r8Digits && typeof s === 'string' && SUM_RX.test(s); }
    function sumKids(s) { return [sumBase(s) + ' = ', h('span', { class: 'sae-sum-blank', text: '___' })]; }
    function dirOf(t) { return (t && t.direction && t.direction !== 'ltr') ? t.direction : (taskLang(t) === 'ur' ? 'rtl' : 'ltr'); }
    function line(name) { return lines[name] || null; }
    /** One of the engine's own lines: the battery's (it carries the clip) when it has it, else the built-in words. */
    function copyLine(name) { return line(name) || { en: COPY.en[name], ur: COPY.ur[name] }; }
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
      if (typeof it.say === 'string') return say({ text: it.say, lang: taskLang(t) }, it.prompt_audio || null, appAsks);
      if (it.say) return say(it.say, it.prompt_audio || null, appAsks);
      if (it.prompt) return say(it.prompt, it.prompt.audio || it.prompt_audio || null, appAsks);
      if (it.prompt_audio) return say(null, it.prompt_audio, appAsks);
      if (tapAsk(it, t)) return say(tapAsk(it, t), tapAsk(it, t).audio || null, true);
      return Promise.resolve();
    }
    /** app_asks: a tap or typed maths item carries no words of its own; its question is the task's tap line (Core EGMA
     *  prints that instruction as the item line, Tasks 2-3), said by Jugnu for each item instead of read by the coach. */
    function tapAsk(it, t) { return appAsks && it && t && (t.mode === 'tap' || t.mode === 'keypad') ? introOf(t) : null; }
    function itemSpeaks(it) { return !!(it && (it.say || it.prompt || it.prompt_audio)); }
    /** The words Jugnu says for an item, for the coach to read out (RDF manual). */
    function itemWords(it) { return !it ? '' : shownNums(it.id, typeof it.say === 'string' ? it.say : tx(it.say || it.prompt)); }
    /** RDF manual: an item the auto run speaks, shown for the coach to read out (open, or folded where it is the answer). */
    function coachSays(it, folded) {
      if (!manual || !itemWords(it)) return null;
      var said = h('p', { class: 'sae-say sae-coach-line', text: itemWords(it) });
      if (appAsks) return h('details', { class: 'sae-coach-says is-coach is-app' }, [h('summary', { text: C.coach_app }), said]);
      if (folded) return h('details', { class: 'sae-coach-says is-coach' }, [h('summary', { text: C.coach }), said]);
      return h('div', { class: 'sae-coach-says is-coach' }, [h('p', { class: 'sae-chip', text: C.coach_read }), said]);
    }

    // ---------- round 8 item 4 (sa_r8_lang_switch): the instruction language, switched mid-test ----------
    // The two batteries of a form are one test (the same tasks and item ids); the switch changes what Jugnu says and the
    // screen's words (lines, COPY, the task's script and instruction, an item's prompt, the practice feedback). What the
    // child reads or answers stays the run's own: an item whose answer is a word of the language (a shape's name) keeps
    // its words, so its tap is scored against its own answer. The runner never changes: answers already given stay.
    var LANG_TASK = ['script', 'instruction', 'coach_text', 'chip'];
    var LANG_ITEM = ['say', 'prompt', 'prompt_audio', 'feedback', 'model'];
    var LANG_SAME = ['target', 'answer', 'options', 'show', 'label', 'target_index'];
    function own(o, k) { return o != null && Object.prototype.hasOwnProperty.call(o, k); }
    function copyOf(o) { var c = {}; for (var k in o) if (own(o, k)) c[k] = o[k]; return c; }
    function langRunner(base) {
      var r = Object.create(base);
      r.view = function () { return langView(base.view()); };
      return r;
    }
    function langMemo() {
      if (!langCache || langCache.lang !== lang) langCache = { lang: lang, m: new Map() };
      return langCache.m;
    }
    function byId(list, id) {
      for (var i = 0; list && i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
      return null;
    }
    function langItemOf(it, list) {
      var m = langMemo();
      if (m.has(it)) return m.get(it);
      var a = it ? byId(list, it.id) : null;
      var out = it;
      var same = !!a && LANG_SAME.every(function (k) { return JSON.stringify(it[k]) === JSON.stringify(a[k]); });
      if (same) {
        out = copyOf(it);
        LANG_ITEM.forEach(function (k) { if (own(a, k)) out[k] = a[k]; else delete out[k]; });
      }
      m.set(it, out);
      return out;
    }
    function langTask(t) {
      var m = langMemo();
      if (m.has(t)) return m.get(t);
      var a = byId(langAlt[lang].tasks, t.id);
      var out = t;
      // another passage variant (or no such task) in the other file: the run's own words
      if (a && !(t.variant && a.variant && t.variant.id !== a.variant.id)) {
        out = copyOf(t);
        LANG_TASK.forEach(function (k) { if (own(a, k)) out[k] = a[k]; else delete out[k]; });
        out.items = (t.items || []).map(function (it) { return langItemOf(it, a.items); });
        out.practice = (t.practice || []).map(function (it) { return langItemOf(it, a.practice); });
      }
      m.set(t, out);
      return out;
    }
    function langItem(x, task, key) {
      var m = langMemo();
      if (m.has(x)) return m.get(x);
      return byId(task[key], x.id) || x;
    }
    /** The runner's view with the task and item in the instruction language (the same objects for as long as it lasts). */
    function langView(v) {
      if (!v || !v.task || lang === homeLang || !langAlt[lang]) return v;
      var t = langTask(v.task);
      if (t === v.task) return v;
      var o = copyOf(v);
      o.task = t;
      if (v.item) o.item = langItem(v.item, t, 'items');
      if (v.practice) o.practice = langItem(v.practice, t, 'practice');
      if (v.cell_item) o.cell_item = langItem(v.cell_item, t, 'items');
      return o;
    }
    /** A line said after a switch: in the instruction language, with that language's clip and phone voice. */
    function langSaid(t, a) {
      var l = lang;
      if (a && typeof a === 'object' && !Array.isArray(a)) a = typeof a[l] === 'string' ? a[l] : null;
      if (typeof t === 'string') return [{ text: t, lang: l }, a];
      if (!t || typeof t !== 'object') return [t, a];
      var o;
      if (typeof t.text === 'string') {
        o = copyOf(t);
        if (t.lang !== 'ur' && t.lang !== 'en') o.lang = l;
      } else if (typeof t[l] === 'string') {
        o = { text: t[l], lang: l };
        if (own(t, 'audio')) o.audio = t.audio;
      } else return [t, a];
      if (o.audio && typeof o.audio === 'object') { if (typeof o.audio[l] === 'string') o.audio = o.audio[l]; else delete o.audio; }
      return [o, a];
    }
    /** The switch takes over when a new screen starts: never mid-clip, never inside a recording that runs on. */
    function langApply() {
      if (!langWant) return;
      if (langWant === lang || !(langWant === homeLang || langAlt[langWant])) { langWant = null; return; }
      var raw = opts.runner.view();
      if (keyOf(raw) === lastKey || hold || listening || refused || (!handedOver && raw.phase === 'battery_intro')) return;
      if (recording && raw.task && recording.id === raw.task.id && raw.phase === 'running') return;
      var from = lang;
      lang = langWant;
      langWant = null;
      C = COPY[lang];
      lines = lang === homeLang ? homeLines : (langAlt[lang].lines || homeLines);
      el.setAttribute('lang', lang);
      el.setAttribute('dir', lang === 'ur' ? 'rtl' : 'ltr');
      var it = raw.item || raw.practice || raw.cell_item || null;
      opts.runner.log('lang_switch', { task_id: raw.task ? raw.task.id : undefined, item_id: it ? it.id : undefined,
        value: { from: from, to: lang, item_id: it ? it.id : null, phase: raw.phase } });
      if (langOnSwitch) { try { langOnSwitch(lang); } catch (e) { /* the page's */ } }
    }
    function langPaint(b) {
      var shown = langWant || lang;
      Array.prototype.forEach.call(b.querySelectorAll('[data-lang]'), function (x) { x.classList.toggle('is-on', x.getAttribute('data-lang') === shown); });
      b.classList.toggle('is-pending', !!langWant);
    }
    /** «اردو | English» in the top bar, once the other language's battery is on the phone. A tap picks the next screen's. */
    function langToggle() {
      if (!r8Lang || !langAlt[homeLang === 'ur' ? 'en' : 'ur']) return null;
      var b = h('button', { class: 'sae-r8-lang', type: 'button', dir: 'ltr', 'aria-label': C.r8_lang, title: C.r8_lang }, [
        h('span', { class: 'sae-r8-lang-o', lang: 'ur', 'data-lang': 'ur', text: 'اردو' }),
        h('span', { class: 'sae-r8-lang-bar', 'aria-hidden': 'true', text: ' | ' }),
        h('span', { class: 'sae-r8-lang-o', lang: 'en', 'data-lang': 'en', text: 'English' }),
      ]);
      b.addEventListener('click', function () {
        langWant = (langWant || lang) === 'ur' ? 'en' : 'ur';
        if (langWant === lang) langWant = null;
        langPaint(b);
      });
      langPaint(b);
      return b;
    }

    el.classList.add('sae');
    if (r8Digits) el.classList.add('is-r8-digits');
    if (r8Mn) el.classList.add('is-r8-mn');
    if (r8Lang) el.classList.add('is-r8-lang');
    // sa_ur_fit (round 6): the Urdu text rules (sa.css "Round 6"): every Urdu word inside its box, clear of pictures.
    if (opts.ur_fit) el.classList.add('is-ur-fit');
    // Round 8 (sa.css "Round 8": every rule under these classes, so OFF the page is as before)
    if (r8Layout) el.classList.add('is-r8-layout');
    if (r8Snap) el.classList.add('is-r8-snap');
    // in the coach page's frame, under its corner hold (sa.css keeps the scrolling body below it)
    if (opts.ur_fit && opts.embed) el.classList.add('is-embed');
    // round 8 (items 25/26, r8_nudges): the speak / tap cue's styles (sa.css "Round 8")
    if (r7.r8_nudges === true) el.classList.add('is-r8-cues');
    // round 8 (item 32, r8_highlight): the word being said, lit
    if (r7.r8_highlight === true) el.classList.add('is-r8-hl');
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
    function replayBtn(onclick, device) {
      if (manual && !device && !appAsks) return null; // coach-led: the coach says it again (the sound check keeps its replay)
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
      var lt = langToggle();
      if (lt) kids.push(lt);
      return h('div', { class: 'sae-top' }, kids);
    }
    /** The jump list's own full-width row above the dots: a Whole battery's 33 dots can never push it off-screen. */
    function devJumpRow(v) {
      var dj = devJumpEl(v);
      return dj ? h('div', { class: 'sae-devjump-row' }, [dj]) : null;
    }
    /** Sandbox only (RULING #43): the session's tasks; choosing one starts it at its instruction. Coach mode only. */
    function devJumpEl(v) {
      if (mode !== 'proctored' || typeof opts.devJump !== 'function' || !Array.isArray(v.dev_tasks)) return null;
      var opt0 = h('option', { value: '', text: C.dev_jump });
      opt0.selected = true;
      var sel = h('select', { class: 'sae-devjump', 'aria-label': C.dev_jump }, [opt0].concat(v.dev_tasks.map(function (x) {
        return h('option', { value: String(x.index), text: (x.index + 1) + '. ' + (tx(x.title) || x.id) });
      })));
      sel.addEventListener('change', function () {
        var i = parseInt(sel.value, 10);
        if (isNaN(i)) return;
        try { opts.devJump(i); } catch (e) { /* the engine's */ }
      });
      return sel;
    }
    function screen(v, cls, kids, foot, noTop) {
      return h('div', { class: 'sae-screen ' + (cls || '') }, [
        noTop ? null : devJumpRow(v),
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
        var face = pic || (gl ? [h('span', { class: 'sae-glyph', 'aria-hidden': 'true', text: gl }), h('span', { class: 'sae-cap', text: String(o) })] : h('span', { class: 'sae-ink' }, [String(o)]));
        var short = !pic && !gl && Array.from(String(o)).length === 1;
        var b = h('button', { class: 'sae-opt sa-tile' + (pic ? ' is-pic' : gl ? ' is-glyph' : short ? ' is-short' : ''), type: 'button', 'data-value': String(o), lang: tl, 'aria-label': gl ? String(o) : null }, [].concat(face));
        b.addEventListener('click', function () { if (!busy && !b.disabled) onPick(o, b); });
        if (decorate) decorate(o, b);
        g.appendChild(b);
      });
      return g;
    }
    /** The item's label, when it adds something (a sum, a sequence) and does not give the answer away. */
    /** What the item shows on screen: label, or the content file's `shown` (the sum on a say_on:'replay' task). */
    function shownOf(it) { return it == null ? null : (it.label != null ? it.label : (it.shown != null ? it.shown : null)); }
    function labelOf(it, t) {
      if (!it || shownOf(it) == null || (it.say && it.label == null)) return null;
      var seq = Array.isArray(shownOf(it)) ? shownOf(it) : null;
      var lab = seq ? seq.filter(function (x) { return !isGap(x); }).join(' ') : String(shownOf(it)).trim();
      if (!lab) return null;
      if (Array.isArray(it.options)) {
        var a = lab.split(/\s+/).sort().join(' '), b = it.options.map(String).sort().join(' ');
        if (a === b) return null;
      }
      if (seq) return seqRow(seq, t, t && mnSeq(it) ? mnState(it) : null);
      if (isSum(lab)) return h('p', { class: 'sae-label sa-label', dir: 'ltr' }, sumKids(lab));
      return h('p', { class: 'sae-label sa-label', dir: 'ltr' }, [lab]);
    }
    /**
     * A sequence as tiles, one per number; the missing one is a bordered blank reading "__", wherever it falls.
     * Numbers read left to right on both pages; a row of pictures reads in the task's language (Urdu: right to left).
     */
    function isGap(x) { return x == null || /^_+$/.test(String(x).trim()); } // the source's own "___" is the same blank
    function seqRow(seq, t, mn) {
      if (mn) return mnRow(seq, mn);
      var numeric = seq.every(function (x) { return isGap(x) || /^[\d\u06F0-\u06F9.,\s-]+$/.test(String(x)); });
      var size = seq.length > 7 ? ' is-xlong' : seq.length > 5 ? ' is-long' : '';
      return h('div', { class: 'sae-label sa-label sae-seq' + size, dir: !numeric && taskLang(t) === 'ur' ? 'rtl' : 'ltr' }, seq.map(function (x) {
        return isGap(x) ? h('span', { class: 'sae-seq-tile sae-gap', text: '__' }) : h('span', { class: 'sae-seq-tile', text: String(x) });
      }));
    }
    /** r8_missing_number (item 30): the item's number row when it has a blank (missing number, what comes next), else null. */
    function mnSeq(it) {
      var seq = r8Mn && it && Array.isArray(shownOf(it)) ? shownOf(it) : null;
      if (!seq || !seq.some(isGap)) return null;
      return seq.every(function (x) { return isGap(x) || /^[\d\u06F0-\u06F9\u0660-\u0669.,\s-]+$/.test(String(x)); }) ? seq : null;
    }
    /** What the blank of item `it` holds: the practice answer on show, else the number just tapped. */
    function mnState(it) {
      if (hold && hold.item === it) return { fill: hold.value, cls: hold.res.ok || hold.res.shown != null ? ' is-right' : ' is-tried' };
      return { fill: mnFill && mnFill.item === it ? mnFill.value : null, cls: '' };
    }
    /** The number row large, on one line: its size from its digits, so it fits a 360 px phone and grows on a tablet. */
    function mnRow(seq, mn) {
      var em = (seq.length - 1) * 0.2;
      seq.forEach(function (x) { em += Math.max(isGap(x) ? 1.9 : String(x).length * 0.6 + 0.36, 1.4) + 0.1; });
      return h('div', { class: 'sae-label sa-label sae-seq is-r8-mn', dir: 'ltr', style: 'font-size:var(--mn-fs, min(96px, calc((min(100vw, 520px) - 48px) / ' + em.toFixed(2) + ')))' }, seq.map(function (x) {
        if (!isGap(x)) return h('span', { class: 'sae-seq-tile', text: String(x) });
        if (mn.out) return mn.out;
        var on = mn.fill != null;
        return h('span', { class: 'sae-seq-tile sae-gap' + (on ? ' is-filled' + (mn.cls || '') : '') }, [h('span', { class: 'sae-mn-ink', text: on ? String(mn.fill) : '__' })]);
      }));
    }
    /**
     * r8_missing_number (item 30): the row and every choice above the foot (Back / Next) on a short phone, whatever rows
     * sit above them (the coach's, the sandbox's part list). Measured after drawing; while a choice is still under the
     * foot: Jugnu's picture goes, the choices come down to 56 px, then the row's type shrinks (not below 26 px).
     */
    var MN_OPT_H = 64, MN_OPT_MIN = 56, MN_FS_MIN = 26;
    function mnFit(s) {
      var row = s && s.classList.contains('sae-r8-mn') ? s.querySelector('.sae-seq.is-r8-mn') : null;
      if (!row) return;
      s.classList.remove('is-mn-tight');
      s.style.removeProperty('--mn-opt-h');
      row.style.removeProperty('--mn-fs');
      var foot = s.querySelector('.sae-foot');
      function over() {
        var last = s.querySelector('.sae-opts') || s.querySelector('.sae-keypad');
        if (!last) return 0;
        var limit = foot ? foot.getBoundingClientRect().top : window.innerHeight;
        return last.getBoundingClientRect().bottom - (limit - 4);
      }
      if (over() <= 0) return;
      s.classList.add('is-mn-tight');
      var oh = MN_OPT_H;
      var fs = 0;
      try { fs = parseFloat(getComputedStyle(row).fontSize); } catch (e) { fs = 0; }
      if (!(fs > 0)) fs = 40;
      for (var i = 0; i < 12 && over() > 0; i++) {
        if (oh > MN_OPT_MIN) { oh = Math.max(MN_OPT_MIN, oh - 4); s.style.setProperty('--mn-opt-h', oh + 'px'); continue; }
        if (fs > MN_FS_MIN) { fs = Math.max(MN_FS_MIN, fs * 0.88); row.style.setProperty('--mn-fs', fs.toFixed(1) + 'px'); continue; }
        break;
      }
    }
    function reducedMotion() {
      try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
    }
    /** FLIP: the number starts where the tapped choice was (r0) and slides into the blank; reduced motion lands it at once. */
    function flyFrom(r0, ink) {
      if (!r0 || !ink || reducedMotion()) return;
      var r1 = ink.getBoundingClientRect();
      var dx = (r0.left + r0.width / 2) - (r1.left + r1.width / 2), dy = (r0.top + r0.height / 2) - (r1.top + r1.height / 2);
      ink.style.transition = 'none';
      ink.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
      void ink.offsetWidth;
      ink.style.transition = 'transform ' + MN_FLOAT_MS + 'ms ease-out';
      ink.style.transform = 'translate(0px,0px)';
    }
    /** A choice tapped on a running item: its number floats into the blank and stays; returns how much longer to wait. */
    function mnFloat(b, value, it) {
      mnFill = { item: it, value: value };
      var gap = el.querySelector('.sae-seq.is-r8-mn .sae-gap');
      var ink = gap && gap.querySelector('.sae-mn-ink');
      if (!ink) return 0;
      ink.textContent = r8Digits ? latinDigits(value) : String(value);
      gap.classList.add('is-filled');
      flyFrom(b.getBoundingClientRect(), ink);
      return MN_HOLD_MS;
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
    function playCheck() { return say({ en: check.target.en, ur: check.target.ur }, check.target.audio || null, true); }
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
        h('div', { class: 'sae-row' }, [jugnu('thinking', true), replayBtn(function () { playCheck(); }, true)]),
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
    /** The instruction, then the task's round-7b line (say then Next, the tick, the scroll), when there is one. */
    function playIntroAll(t) {
      var g = gen;
      var hl = hintOf(t);
      return playIntro(t).then(function () { if (hl && alive && g === gen) return say(hl); });
    }
    /** RDF manual: the coach's screen in front of each task (the words to read out), then the phone goes to the child. */
    function sCoachBrief(v) {
      var t = v.task;
      return h('div', { class: 'sae-screen sae-coach-brief is-coach', 'data-task': t.id }, [
        h('div', { class: 'sae-body' }, [
          h('p', { class: 'sae-chip', text: C.coach }),
          h('h1', { class: 'sae-h1', text: tx(t.title) }),
          appAsks ? h('div', { class: 'sae-coach-you' }, [
            h('p', { class: 'sae-sub', text: C.coach_you }),
            h('p', { class: 'sae-say sae-coach-text', text: tx(t.coach_text) || tx(introOf(t)) }),
          ]) : h('p', { class: 'sae-sub', text: C.coach_read }),
          appAsks ? null : h('p', { class: 'sae-say sae-coach-text', text: tx(t.coach_text) || tx(introOf(t)) }),
          hintEl(t, 'sae-say sae-coach-text'),
          demoImage(t),
          demoItem(t),
          appAsks ? appAsksList(t) : coachItems(t),
          appAsks ? h('p', { class: 'sae-sub sae-coach-by' }, [C.answers_by + ' ' + answersBy(t)]) : null,
          h('p', { class: 'sae-sub', text: C.coach_then }),
        ]),
        h('div', { class: 'sae-foot' }, [btn(C.handover_anon, function () { runner.instructionDone(); draw(); }, 'sae-primary')]),
      ]);
    }
    /** Every item the auto run speaks, in order, for the coach to read out one by one. */
    function coachItems(t) {
      var said = (t.items || []).filter(function (it) { return itemWords(it); });
      if (!said.length) return null;
      return h('div', { class: 'sae-coach-list' + (appAsks ? ' sae-coach-app' : '') }, [
        h('p', { class: 'sae-sub', text: appAsks ? C.coach_app : C.coach_items }),
        h('ol', { class: 'sae-coach-items', dir: dirOf(t), lang: taskLang(t) }, said.map(function (it) { return h('li', { text: itemWords(it) }); })),
      ]);
    }
    /** app_asks: what Jugnu will say to the child in this task (practice models, the questions), folded, never to read out. */
    function appAsksList(t) {
      var said = [];
      (t.practice || []).forEach(function (p) {
        if (Array.isArray(p.model)) said.push(shownNums(p.id, p.model.map(tx).join(' ')));
        else if (itemWords(p)) said.push(itemWords(p));
      });
      (t.items || []).forEach(function (it) { if (itemWords(it)) said.push(itemWords(it)); });
      if ((t.mode === 'tap' || t.mode === 'keypad') && introOf(t)) said.push(tx(introOf(t)));
      if (!said.length) return null;
      return h('details', { class: 'sae-coach-list sae-coach-app' }, [
        h('summary', { class: 'sae-sub', text: C.coach_app }),
        h('ol', { class: 'sae-coach-items', dir: dirOf(t), lang: taskLang(t) }, said.map(function (w) { return h('li', { text: w }); })),
      ]);
    }
    /** How the child answers this task, for the coach (says / taps / types). */
    function answersBy(t) { return t.mode === 'tap' ? C.by_tap : (t.mode === 'keypad' || t.mode === 'keyboard') ? C.by_type : C.by_say; }
    /** Round 7 (the tester: say the child's name more often, in the instructions): "<name>، " / "<name>, " in front of a task's
     *  words on the screen, when the coach's page handed over a name. */
    function named(text) {
      if (!childName) return text;
      return [h('bdi', { class: 'sae-name', text: childName }), lang === 'ur' ? '، ' : ', ', text];
    }
    function sInstruction(v) {
      var t = v.task;
      if (manual) return sCoachBrief(v);
      return screen(v, 'sae-instr', [
        h('div', { class: 'sae-row' }, [jugnu('hello', true), replayBtn(function () { gen++; var p = playIntroAll(t); if (!gate.open) gateOn(keyOf(v), p); })]),
        h('h1', { class: 'sae-h1', text: tx(t.title) }),
        h('p', { class: 'sae-say' }, [].concat(named(hlText(tx(introOf(t)), introOf(t))))),
        hintEl(t),
        demoImage(t),
        demoItem(t),
      ], [gatedBtn(v, C.next, function () { runner.instructionDone(); draw(); }, 'sae-primary')]);
    }
    /**
     * Tangerine's demo pattern (A11, script.demo_item): a disabled copy of the first item shown with the instruction,
     * its answer not shown. Nothing on it can be tapped; the first item is then asked and scored as usual.
     */
    function demoItem(t) {
      var d = t.script && t.script.demo_item;
      if (!d || typeof d !== 'object') return null;
      var sayUr = urFit && typeof d.say === 'string' && /[\u0600-\u06FF]/.test(d.say);
      var label = labelOf(d) || (typeof d.say === 'string' ? h('p', { class: 'sae-label sa-label', lang: sayUr ? 'ur' : null, dir: sayUr ? 'rtl' : null, text: d.say }) : null);
      var answer = Array.isArray(d.options) && d.options.length
        ? tiles(d.options, function () {}, function (o, b) { b.disabled = true; }, taskLang(t), t, d.glyphs)
        : h('div', { class: 'sae-demo-blank', 'aria-hidden': 'true', text: '__' });
      return h('div', { class: 'sae-demo', 'aria-disabled': 'true' }, [h('span', { class: 'sae-chip', text: C.practice }), label, answer]);
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
      if (v.task.mode === 'record' && !hold) return sPracticeSpoken(v);
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
        answerArea = tiles(p.options, function (o, b) {
          var r0 = mnSeq(p) ? b.getBoundingClientRect() : null;
          practicePick(p, t, o);
          if (r0) flyFrom(r0, el.querySelector('.sae-seq.is-r8-mn .sae-gap .sae-mn-ink'));
        }, function (o, b) {
          if (!fb) return;
          b.disabled = true;
          if (String(o) === String(fb.value)) b.classList.add(fb.res.ok ? 'is-right' : 'is-tried');
          if (fb.res.shown != null && String(o) === String(fb.res.shown)) b.classList.add('is-right', 'is-shown');
        }, taskLang(t), t, p.glyphs);
      }
      return screen(v, 'sae-practice' + (mnSeq(p) ? ' sae-r8-mn' : ''), [
        // Round 7: a tap practice carries the real items' question tag ("Which is bigger"), so it looks like them.
        t.mode === 'tap' && t.title ? h('p', { class: 'sae-task-tag', text: tx(t.title) }) : null,
        h('div', { class: 'sae-row' }, [
          h('span', { class: 'sae-chip', text: C.practice }),
          itemSpeaks(p) ? replayBtn(function () { gen++; sayItem(p, t); }) : null,
        ]),
        coachSays(p, t.mode !== 'oral'),
        t.mode === 'keypad' || t.mode === 'keyboard' ? null : labelOf(p, t),
        answerArea,
        feedbackLine(fb),
      ], t.mode === 'keypad' || t.mode === 'keyboard' ? null : [jugnu(fb ? (fb.res.ok ? 'correct' : 'notyet') : 'idle', true)]);
    }
    function practicePick(p, t, value) {
      var res = runner.practiceAnswer(value);
      if (!res) return;
      busy = true;
      var f = (r8Lang && p && p.feedback) || res.feedback || {};
      var said = res.ok ? (f.correct || f.right || copyLine('right'))
        : res.retry ? copyLine('try_again')
          : (f.wrong || copyLine('shown'));
      // A line naming an item of the other language is a chain of clips (RULING #31a): said one after another.
      var chain = Array.isArray(said) ? said : [said];
      hold = { item: p, value: value, res: res, text: shownNums(p && p.id, chain.map(tx).join(' ')) };
      try { if (opts.onFeedback) opts.onFeedback({ kind: 'practice', ok: !!res.ok }); } catch (e) { /* skin */ }
      draw();
      Promise.all([delay(FEEDBACK_MS), capped(sayChain(chain.map(function (x) { return [x, undefined, appAsks]; })), 7000)]).then(function () {
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
        h('h1', { class: 'sae-h1 sae-xl' }, [].concat(named(C.ready))),
      ], [gatedBtn(v, C.go, function () {
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
      if (manual && !appAsks) return; // coach-led: the coach reads it from the screen, then taps Next (sListen)
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
      var t = listening;
      if (manual && !appAsks && t) {
        return screen(v, 'sae-listen is-coach', [
          h('p', { class: 'sae-chip', text: C.coach_read }),
          h('p', { class: 'sae-say sae-coach-line', dir: dirOf(t), lang: taskLang(t), text: t.passage.text }),
        ], [btn(C.next, function () { heard[t.id] = true; listening = null; runner.begin(); draw(); }, 'sae-primary')]);
      }
      return screen(v, 'sae-listen', [
        jugnu('hello'),
        h('div', { class: 'sae-ear', 'aria-hidden': 'true', text: '👂' }),
        h('h1', { class: 'sae-h1', text: C.listen }),
      ], null);
    }

    function sRunTap(v) {
      var it = v.item, t = v.task;
      return screen(v, 'sae-run sae-run-tap' + (mnSeq(it) ? ' sae-r8-mn' : ''), [
        clock(v),
        h('p', { class: 'sae-task-tag', text: tx(t.title) }),
        h('div', { class: 'sae-row' }, [jugnu('idle', true), itemSpeaks(it) ? replayBtn(function () { sayItem(it, t); }) : null]),
        coachSays(it, true),
        labelOf(it, t),
        // A tap on the passage itself (print orientation): the words are the buttons, scored by place.
        t.tap_on === 'passage' && typeof it.target_index === 'number'
          ? passageTap(t, function (i, b) { busy = true; b.classList.add('is-pressed'); runner.answer(i); later(function () { busy = false; draw(); }, PRESS_MS); })
          : null,
        t.tap_on === 'passage' && typeof it.target_index !== 'number' ? passageTap(t, null) : null,
        typeof it.target_index === 'number' ? null : tiles(it.options, function (o, b) {
          busy = true;
          b.classList.add('is-pressed');
          var wait = mnSeq(it) ? mnFloat(b, o, it) : 0;
          runner.answer(o);
          later(function () { busy = false; draw(); }, PRESS_MS + wait);
        }, null, taskLang(t), t, it.glyphs),
      ], itemFoot(v, [nextBtn(v)]));
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
      if (isSum(lab)) lab = sumBase(lab) + ' ='; // item 34: one = before the box
      var mn = mnSeq(it);
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
      var mnInk = null;
      if (mn) {
        // r8_missing_number (item 30): the typed number fills the row's own blank; the keypad stays below
        mnInk = h('span', { class: 'sae-mn-ink', text: shown || '__' });
        displayEl = h('output', { class: 'sae-seq-tile sae-gap' + (shown ? ' is-filled' : '') + (fb ? (fb.res.ok || fb.res.shown != null ? ' is-right' : ' is-tried') : ''), dir: 'ltr', 'aria-live': 'polite' }, [mnInk]);
        kids.push(seqRow(seq, t, { out: displayEl }));
      } else {
        displayEl = h('output', { class: 'sae-typed sa-typed' + (fb ? (fb.res.ok || fb.res.shown != null ? ' is-right' : ' is-tried') : ''), dir: 'ltr', 'aria-live': 'polite' }, [shown || ' ']);
        // the typed number big above the keypad (a sum and its box on one line: "1 + 3 = [ ]"); nothing goes until ✓
        if (seq) kids.push(seqRow(seq, t));
        kids.push(lab ? h('div', { class: 'sae-sumrow', dir: 'ltr' }, [h('p', { class: 'sae-sum sa-label' }, [lab]), displayEl]) : displayEl);
      }
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
          if (mnInk) { mnInk.textContent = typed || '__'; displayEl.classList.toggle('is-filled', !!typed); }
          else if (displayEl) displayEl.textContent = typed || ' ';
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
        coachSays(it, true),
        keyboardArea(it, t, function (val) {
          busy = true;
          runner.answer(val);
          later(function () { busy = false; draw(); }, PRESS_MS);
        }, null),
      ], [nextBtn(v)]);
    }
    function sRunKeypad(v) {
      var it = v.item, t = v.task;
      return screen(v, 'sae-run sae-run-keypad' + (mnSeq(it) ? ' sae-r8-mn' : ''), [
        clock(v),
        itemSpeaks(it) ? h('div', { class: 'sae-row' }, [replayBtn(function () { sayItem(it, t); })]) : null,
        coachSays(it, true),
        // tick_prompt: one short chip while typing (the whole line is in the instruction, said and shown)
        r7.tick_prompt === true && hintOf(t) ? h('p', { class: 'sae-chip sae-r7-hint', text: C.chip_type_tick }) : null,
        keypadArea(it, t, function (val) {
          busy = true;
          runner.answer(val);
          later(function () { busy = false; draw(); }, PRESS_MS);
        }, null),
      ], itemFoot(v, [nextBtn(v)]));
    }

    // The passage's words: each item's label, or its target (the runtime batteries carry target only).
    function wordText(w) { return w.label != null ? w.label : w.target; }
    function wordsOf(t) { return (t.items || []).filter(function (w) { return w && wordText(w) != null; }); }
    function passageEl(t, onWord) {
      var dir = dirOf(t), tl = taskLang(t);
      var words = wordsOf(t);
      var printed = punct && words.length === (t.items || []).length ? passageWords(t) : null;
      if (words.length) {
        var rows = [], cur = null, curLine = null;
        words.forEach(function (w, i) {
          var ln = w.line != null ? w.line : 1;
          if (ln !== curLine) { cur = h('span', { class: 'sae-pline' }); rows.push(cur); curLine = ln; }
          var said = printed ? printed[i] : String(wordText(w));
          cur.appendChild(onWord
            ? h('button', { class: 'sae-word sa-word', type: 'button', 'data-i': String(i), onclick: function () { if (!busy) onWord(i); } }, [inkOf(said, tl)])
            : h('span', { class: 'sae-word sa-word', 'data-i': String(i) }, [said]));
          cur.appendChild(document.createTextNode(' '));
        });
        return h('div', { class: 'sae-passage sa-passage' + (onWord ? ' is-pick' : '') + (printed ? ' is-printed' : ''), dir: dir, lang: tl }, rows);
      }
      if (t.passage && (t.passage.text || typeof t.passage === 'string')) {
        return h('p', { class: 'sae-passage sa-passage', dir: dir, lang: tl, text: t.passage.text || t.passage });
      }
      var per = t.per_row || 10;
      // On a phone a row of 10 letters becomes 5; an Urdu word row becomes 3, wide enough for its longest word.
      var narrow = per > 5 ? Math.ceil(per / 2) : tl === 'ur' && per > 3 ? 3 : per;
      return h('div', { class: 'sae-grid sa-grid', dir: dir, lang: tl, style: '--cols:' + per + ';--cols-n:' + narrow },
        (t.grid || []).map(function (x, i) { return h('span', { class: 'sae-cell', 'data-i': String(i) }, [inkOf(String(x), tl)]); }));
    }
    /** An Urdu word on a tile goes in its own ink box, for fitCells to place (other languages stay plain text). */
    function inkOf(s, tl) { return tl === 'ur' ? h('span', { class: 'sae-ink' }, [s]) : s; }
    /** The passage: one big star tile ends the reading (its word is spoken once when it shows; mercy() pulses it). */
    /** One item big: a letter, a word, a number or a sum (a sum reads left to right on an Urdu page too). */
    var NUMERIC_RX = /^[\d\u06F0-\u06F9\u0660-\u0669.,\s+\-\u2212\u00D7\u00F7=?_]+$/;
    function oneCell(text, t, i) {
      var s = String(text);
      var numeric = NUMERIC_RX.test(s);
      return h('div', { class: 'sae-onecell sa-onecell' + (Array.from(s).length <= 2 ? ' is-short' : ''), dir: numeric ? 'ltr' : dirOf(t), lang: numeric ? 'en' : taskLang(t), 'data-i': i == null ? null : String(i) }, [
        isSum(s) ? h('span', { class: 'sae-ink' }, sumKids(s)) : h('span', { class: 'sae-ink' }, [s]),
      ]);
    }
    /**
     * Round 4: Nastaliq ink is not where its line box is (ر ے sink below the middle, ک with ھ climbs above it), so an
     * Urdu cell, text tile, last-word word tile or grid cell is placed by its ink: shrunk when the ink is bigger than its
     * box (a passage word's tile grows instead), then moved so the ink's middle is the box's middle (canvas ink metrics
     * on its own font, again once the font has loaded).
     */
    function fitCells(scope) {
      if (typeof document === 'undefined' || !document.fonts || !scope.querySelectorAll) return;
      var sel = '.sae-onecell[lang=ur] > .sae-ink, .sae-opt[lang=ur] > .sae-ink, .sae-passage.is-pick[lang=ur] .sae-word > .sae-ink, .sae-grid[lang=ur] .sae-cell > .sae-ink';
      // r8_layout (item 21): a Latin card or text tile is placed by its ink too ("y" no longer sits low in its card)
      if (r8Layout) sel += ', .sae-onecell > .sae-ink, .sae-opt > .sae-ink';
      Array.prototype.forEach.call(scope.querySelectorAll(sel), function (ink) {
        fitInk(ink, 0);
        document.fonts.load(getComputedStyle(ink).font, ink.textContent).then(function () {
          if (alive && ink.isConnected) fitInk(ink, 0);
        }, function () {});
      });
    }
    function fitInk(ink, tries) {
      var cell = ink.parentNode;
      var g = document.createElement('canvas').getContext('2d');
      if (!g || !cell) return;
      ink.style.transform = '';
      var word = cell.classList.contains('sae-word');
      if (word) cell.style.minWidth = cell.style.minHeight = '';
      var cs = getComputedStyle(ink);
      g.font = cs.font; g.direction = 'ltr'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      var m = g.measureText(ink.textContent);
      if (m.actualBoundingBoxAscent == null || m.fontBoundingBoxAscent == null) return;
      var pc = getComputedStyle(cell);
      var w = cell.clientWidth - parseFloat(pc.paddingLeft) - parseFloat(pc.paddingRight);
      var hh = cell.clientHeight - parseFloat(pc.paddingTop) - parseFloat(pc.paddingBottom);
      var iw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
      var ih = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
      // A word in the passage keeps the passage's size: its tile grows to hold the ink instead.
      if (word) {
        if (iw / 0.92 > w) cell.style.minWidth = Math.ceil(cell.offsetWidth + iw / 0.92 - w) + 'px';
        if (ih / 0.92 > hh) cell.style.minHeight = Math.ceil(cell.offsetHeight + ih / 0.92 - hh) + 'px';
      }
      var k = word ? 1 : Math.min(1, (w * 0.92) / iw, (hh * 0.92) / ih);
      if (k < 0.98 && tries < 3) {
        ink.style.fontSize = (parseFloat(cs.fontSize) * k).toFixed(1) + 'px';
        return fitInk(ink, tries + 1);
      }
      var range = document.createRange();
      range.selectNodeContents(ink);
      var r = range.getBoundingClientRect();
      var c = cell.getBoundingClientRect();
      var base = r.top + m.fontBoundingBoxAscent;
      var dx = (c.left + c.right) / 2 - (r.left + (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2);
      var dy = (c.top + c.bottom) / 2 - (base + (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2);
      ink.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
    }
    function sRunCell(v) {
      var t = v.task, it = v.cell_item;
      // r8_layout: the card screen fits the phone (sa.css "Round 8 fit": the card takes what is left above the foot)
      return screen(v, 'sae-run sae-run-rec sae-run-cell' + (r8Layout ? ' sae-fit' : ''), [
        clock(v),
        // say_then_next: the chip says "say it, then press Next" in place of "Read aloud" (one short line: the cell never
        // slides under the sticky Back / Next on a short phone; the whole line is in the instruction, said and shown)
        h('div', { class: 'sae-row' }, [h('p', { class: 'sae-chip sae-chip-rec' + (sayNext(t) ? ' sae-r7-hint' : ''), text: sayNext(t) ? C.chip_say_next : recChip(t, C) }), itemSpeaks(it) ? replayBtn(function () { sayItem(it, t); }) : null]),
        oneCell(v.cell, t, v.cell_index),
        coachSays(it),
      ], itemFoot(v, [btn(C.next, function () { runner.nextCell('tap'); draw(); }, 'sae-primary sa-next')]));
    }
    /** A spoken practice item (W3 one-at-a-time tasks): the item big; an example is modelled by Jugnu, a practice item
     *  is modelled after the child's turn (Next); coach-led, the coach models it and Jugnu stays quiet. */
    function modelOf(p) { return (manual && !appAsks) || !Array.isArray(p.model) ? [] : p.model.map(function (m) { return [m, m && m.audio, appAsks]; }); }
    /** r8_practice_autoplay: a spoken practice (not an example, which already models on arrival) says its answer by itself. */
    function autoAnswer(t, p) { return r7.r8_practice_autoplay === true && !!t && t.mode === 'record' && !!p && p.role !== 'example' && modelOf(p).length > 0; }
    /** r8_practice_autoplay's replay: the item's own words (when it has any), then the answer. */
    function sayAgainWithAnswer(p, t) {
      gen++;
      var g = gen;
      return (itemSpeaks(p) ? sayItem(p, t) : Promise.resolve()).then(function () { if (alive && g === gen) return sayChain(modelOf(p)); });
    }
    function sPracticeSpoken(v) {
      var p = v.practice, t = v.task;
      return screen(v, 'sae-practice' + (r8Layout ? ' sae-fit' : ''), [
        h('div', { class: 'sae-row' }, [
          h('span', { class: 'sae-chip', text: C.practice }),
          itemSpeaks(p) || (p.model && (!manual || appAsks)) ? replayBtn(function () {
            if (autoAnswer(t, p)) { sayAgainWithAnswer(p, t); return; }
            gen++; if (itemSpeaks(p)) sayItem(p, t); else sayChain(modelOf(p));
          }) : null,
        ]),
        oneCell(p.show != null ? p.show : p.target, t, null),
        coachSays(p),
      ], [gatedBtn(v, C.next, function () {
        busy = true;
        var k = keyOf(runner.view());
        // r8_practice_autoplay: the answer was said on arrival (the chip says it again), so Next just goes on
        (p.role === 'example' || autoAnswer(t, p) ? Promise.resolve() : capped(sayChain(modelOf(p)), 7000)).then(function () {
          busy = false;
          if (!alive || keyOf(runner.view()) !== k) return;
          runner.practiceAnswer(p.target);
          draw();
        });
      }, 'sae-primary sa-next')]);
    }
    function sRunRecord(v) {
      if (v.cell != null) return sRunCell(v);
      var label = tx(line('done')) || C.done;
      starEl = h('button', { class: 'sae-star sa-star' + (mercied[v.task.id] ? ' is-mercy' : ''), type: 'button', 'aria-label': label }, [
        h('span', { class: 'sae-star-ico', 'aria-hidden': 'true', text: '★' }),
        h('span', { class: 'sae-star-word', text: label }),
      ]);
      starEl.addEventListener('click', function () { if (!busy) { runner.done(); draw(); } });
      // story_scroll: an arrow under the story while more of it is below (it goes at the end); a tap slides the page on
      // r8_story_snap: the story is a box of parts; the arrow (with it, story_scroll or not) moves exactly one part on
      var snap = r8Snap && !!v.task.passage;
      moreEl = (r7.story_scroll === true || snap) && v.task.passage ? h('button', { class: 'sae-more', type: 'button', 'aria-label': C.more_below, hidden: '', onclick: function () {
        var sc = scroller();
        if (snap && sc.classList && sc.classList.contains('is-snap')) { snapNext(sc); return; }
        try { sc.scrollBy({ top: Math.round(sc.clientHeight * 0.7), behavior: 'smooth' }); } catch (_) { try { sc.scrollTop += Math.round(sc.clientHeight * 0.7); } catch (e) { /* old browser */ } }
      } }, [h('span', { class: 'sae-more-ico', 'aria-hidden': 'true', text: '↓' }), h('span', { class: 'sae-more-w', text: C.more_below })]) : null;
      if (moreEl) later(checkMore, 0);
      var story = passageEl(v.task, null);
      if (snap) {
        story.classList.add('is-snap');
        later(snapPack, 0);
        if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (alive) snapPack(); }, function () {});
      }
      // r8_story_snap: the arrow beside the star, one row (the story box gets the height a second row would take)
      return screen(v, 'sae-run sae-run-rec' + (snap ? ' sae-snap' : ''), [
        clock(v),
        h('p', { class: 'sae-chip sae-chip-rec', text: C.read_aloud }),
        story,
      ], snap ? [h('div', { class: 'sae-snapfoot' }, [moreEl, starEl])] : [moreEl, starEl]);
    }
    /**
     * r8_story_snap: the story packed into parts, each as high as the story box. The unit is a row as it shows on this
     * screen (a passage line that wraps is split at its rows; a line whose words are not laid out is one unit): a row that
     * will not fit with the ones before starts the next part, a row taller than the box is a part of its own. Measured
     * after layout, again once the font is in and on resize; the box keeps where it was scrolled to over a redraw.
     */
    function snapPack() {
      var box = el.querySelector('.sae-passage.is-snap');
      if (!box) return;
      var lines = Array.prototype.slice.call(box.querySelectorAll('.sae-pline'));
      if (!lines.length) return;
      var v = runner.view();
      var id = v.task ? v.task.id : null;
      // measured inside one part, so a line wraps at the width it will have
      var all = h('div', { class: 'sae-part' });
      lines.forEach(function (l) { all.appendChild(l); });
      while (box.firstChild) box.removeChild(box.firstChild);
      box.appendChild(all);
      var padTop = 0, padBottom = 0;
      try { var cs = getComputedStyle(all); padTop = parseFloat(cs.paddingTop) || 0; padBottom = parseFloat(cs.paddingBottom) || 0; } catch (_) { padTop = padBottom = 0; }
      var pad = padTop + padBottom;
      var full = box.clientHeight;
      var room = full - pad;
      var units = []; // { line, cls, nodes, h }
      lines.forEach(function (l, li) {
        var tops = [];
        Array.prototype.forEach.call(l.children, function (w) {
          if (!w.classList.contains('sae-word')) return;
          var t = w.offsetTop;
          if (!tops.some(function (x) { return Math.abs(x - t) <= 4; })) tops.push(t);
        });
        if (tops.length < 2) { units.push({ line: li, cls: l.className, nodes: Array.prototype.slice.call(l.childNodes), h: l.offsetHeight }); return; }
        tops.sort(function (a, b) { return a - b; });
        var lt = l.offsetTop, lb = lt + l.offsetHeight, first = units.length;
        tops.forEach(function (t, i) { units.push({ line: li, cls: l.className, nodes: [], h: (i + 1 < tops.length ? tops[i + 1] : lb) - (i ? t : lt) }); });
        var cur = first;
        Array.prototype.slice.call(l.childNodes).forEach(function (n) {
          if (n.nodeType === 1 && n.classList.contains('sae-word')) {
            for (var i = tops.length - 1; i >= 0; i--) if (n.offsetTop >= tops[i] - 4) { cur = first + i; break; }
          }
          units[cur].nodes.push(n);
        });
      });
      var groups = [], group = [], used = 0;
      units.forEach(function (u) {
        if (group.length && used + u.h > room) { groups.push(group); group = []; used = 0; }
        group.push(u); used += u.h;
      });
      groups.push(group);
      box.removeChild(all);
      groups.forEach(function (g) {
        var part = h('div', { class: 'sae-part' });
        // a part is never taller than the box: when one row and its ink room do not fit, the room above gives way
        var rows = g.reduce(function (n, u) { return n + u.h; }, 0);
        if (full > 0 && padTop + rows + padBottom > full) part.style.paddingTop = Math.max(0, full - rows - padBottom) + 'px';
        var line = null, at = null;
        g.forEach(function (u) {
          if (u.line !== at) { line = h('span', { class: u.cls }); part.appendChild(line); at = u.line; }
          u.nodes.forEach(function (n) { line.appendChild(n); });
        });
        if (full > 0) part.style.minHeight = full + 'px';
        box.appendChild(part);
      });
      if (!box.getAttribute('data-snap')) {
        box.setAttribute('data-snap', '1');
        box.addEventListener('scroll', function () { snapPos = { id: id, top: box.scrollTop }; snapSettle(box); });
        // a wheel (a mouse, a trackpad) moves one part per flick, whatever its size
        box.addEventListener('wheel', function (e) {
          if (!e.deltaY) return;
          e.preventDefault();
          if (snapWheel) return;
          snapWheel = true;
          later(function () { snapWheel = false; }, 450);
          snapStep(box, e.deltaY > 0 ? 1 : -1);
        }, { passive: false });
        // the box's height settles after the first pack (the font, the arrow showing): pack again to the new height
        if (typeof ResizeObserver === 'function') {
          var seenH = box.clientHeight;
          var ro = new ResizeObserver(function () {
            if (!alive || !box.isConnected) { ro.disconnect(); return; }
            if (Math.abs(box.clientHeight - seenH) > 2) { seenH = box.clientHeight; snapPack(); }
          });
          ro.observe(box);
        }
      }
      if (snapPos.id === id && snapPos.top > 0) box.scrollTop = snapPos.top;
      snapFrom = snapIndex(box);
      checkMore();
    }
    var snapFrom = 0; // r8_story_snap: the part the last scroll settled on
    var snapWheel = false;
    var snapTimer = null;
    function snapParts(box) { return box.querySelectorAll('.sae-part'); }
    /** The part on show: the last one whose top is at or above the box's top. */
    function snapIndex(box) {
      var parts = snapParts(box), at = box.scrollTop, k = 0;
      for (var i = 0; i < parts.length; i++) if (parts[i].offsetTop <= at + 2) k = i;
      return k;
    }
    function snapTo(box, top) {
      try { box.scrollTo({ top: top, behavior: 'smooth' }); } catch (_) { box.scrollTop = top; }
    }
    /**
     * When a scroll settles more than one part from where it began (a fling the browser let through snap-stop), it is
     * brought back to the part next to the one it began on: no part is ever passed unseen.
     */
    function snapSettle(box) {
      clearTimeout(snapTimer);
      snapTimer = later(function () {
        if (!box.isConnected) return;
        var parts = snapParts(box), k = snapIndex(box);
        if (k > snapFrom + 1) { snapFrom += 1; snapTo(box, parts[snapFrom].offsetTop); return; }
        if (k < snapFrom - 1) { snapFrom -= 1; snapTo(box, parts[snapFrom].offsetTop); return; }
        snapFrom = k;
      }, 160);
    }
    /** One part on (or back); a part taller than the box: its next screenful first, never past a row not yet shown. */
    function snapStep(box, dir) {
      var parts = snapParts(box), at = box.scrollTop, top = null, i;
      if (dir > 0) {
        for (i = 0; i < parts.length; i++) if (parts[i].offsetTop > at + 2) { top = parts[i].offsetTop; break; }
        if (top == null) return;
        if (box.clientHeight > 0) top = Math.min(top, at + box.clientHeight);
      } else {
        for (i = parts.length - 1; i >= 0; i--) if (parts[i].offsetTop < at - 2) { top = parts[i].offsetTop; break; }
        if (top == null) return;
      }
      for (i = 0; i < parts.length; i++) if (parts[i].offsetTop <= top + 2) snapFrom = i;
      snapTo(box, top);
    }
    /** r8_story_snap: the arrow's move, one part on. */
    function snapNext(box) { snapStep(box, 1); }
    function askHint(t) {
      if (lw && lw.task === t.id) return;
      var mine = lw = { task: t.id, state: 'pending', suggested: null, picked: null };
      var n = (t.items || []).length;
      Promise.resolve().then(function () { return opts.lastWordHint ? opts.lastWordHint(t) : null; }).then(null, function () { return null; }).then(function (i) {
        if (lw !== mine) return;
        mine.suggested = typeof i === 'number' && i >= 0 && i < n ? i : null;
        if (mine.picked == null) mine.picked = mine.suggested;
        mine.state = mine.suggested != null ? 'ready' : 'none';
        draw();
      });
    }
    function sCoachLastWord(v) {
      // Ask before drawing: the first frame is already "finding it", and the coach's taps count while the hint is on its way.
      askHint(v.task);
      var s = lw;
      var p = passageEl(v.task, function (i) { if (lw === s) { s.picked = i; draw(); } });
      var b = s.picked != null ? p.querySelector('.sae-word[data-i="' + s.picked + '"]') : null;
      if (b) b.classList.add('is-picked');
      // The suggestion may sit below the passage box's fold: bring it into view once, when it arrives.
      if (b && s.picked === s.suggested && !s.shown) {
        s.shown = true;
        later(function () { try { b.scrollIntoView({ block: 'center' }); } catch (_) { /* old browser */ } }, 0);
      }
      var note = s.state === 'pending' ? C.lw_listening : (s.picked != null && s.picked === s.suggested ? C.lw_suggested : C.lw_none);
      var ok = h('button', { class: 'sae-btn sae-primary sa-lw-confirm', type: 'button', disabled: s.picked == null, onclick: function () {
        if (busy || s.picked == null) return;
        lw = null;
        runner.lastWord(s.picked, { how: s.picked === s.suggested ? 'confirm' : 'tap', suggested: s.suggested });
        draw();
      } }, [C.lw_confirm]);
      return screen(v, 'sae-lastword is-coach', [
        h('h1', { class: 'sae-h1', text: C.coach_last_word }),
        h('p', { class: 'sae-sub sa-lw-note', text: note }),
        p,
      ], [ok]);
    }
    function sLastWord(v) {
      if (coachLW) return sCoachLastWord(v);
      return screen(v, 'sae-lastword', [
        h('h1', { class: 'sae-h1', text: C.last_word }),
        // RDF auto (sa_auto_child_last_word): no last_word_how, so the scorer reads the recording and the child's tap is the check.
        passageEl(v.task, function (i) { runner.lastWord(i); draw(); }),
      ], null);
    }

    function sRunOral(v) {
      var it = v.item, t = v.task;
      var on = sectionRec ? recording === t : !!(oralRec && oralRec.key === keyOf(v));
      return screen(v, 'sae-run sae-run-oral' + (compWait(t) ? ' is-r8-wait' : ''), [
        h('p', { class: 'sae-task-tag', text: tx(t.title) }),
        h('div', { class: 'sae-row' }, [jugnu('idle', true), replayBtn(function () { sayItem(it, t); })]),
        coachSays(it),
        /^mental_/.test(t.subtask || '') && shownOf(it) != null ? labelOf(it, t) : null,
        h('div', { class: 'sae-mic sa-mic' + (on ? ' is-on' : ''), 'aria-hidden': 'true' }, [h('span', { text: '🎤' })]),
        hintOf(t) ? hintEl(t, 'sae-sub') : h('p', { class: 'sae-sub', text: C.say_answer }),
      ], (compWait(t) ? [stuckEl()] : []).concat(itemFoot(v, [btn(compWait(t) ? C.next : C.answered, function () {
        busy = true;
        runner.answer('spoken');
        later(function () { busy = false; draw(); }, PRESS_MS);
      }, compWait(t) ? 'sae-primary sa-next' : 'sae-primary')])));
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
        later(function () { if (micSt === st && st.stage === 'idle') { draw(); say(copyLine('mic_skip_say')); } }, skipMs + 10);
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
      var again = refusedRetry ? btn(C.retry, function () {
        if (retrying) return;
        retrying = true;
        draw();
        Promise.resolve().then(refusedRetry).then(null, function () { return false; }).then(function (ok) {
          retrying = false;
          if (!alive || !refused) return;
          draw();
          if (!ok) say(line('voice_not_ready') || { en: COPY.en.voice_not_ready, ur: COPY.ur.voice_not_ready });
        });
      }, 'sae-primary sa-retry' + (retrying ? ' is-busy' : '')) : null;
      if (again && retrying) again.disabled = true;
      return h('div', { class: 'sae-screen sae-refused' }, [
        h('div', { class: 'sae-body' }, [
          jugnu('sleep'),
          h('h1', { class: 'sae-h1', text: msg }),
        ]),
        again || (mode === 'game' && safeBack(opts.back)) ? h('div', { class: 'sae-foot' }, [again, mode === 'game' && safeBack(opts.back) ? btn(C.back, goBack, again ? 'sae-secondary' : 'sae-primary') : null]) : null,
      ]);
    }

    /** The line for a record task skipped with no microphone: the battery's recorded one, else the COPY text. */
    function micSkipLine() { return line('mic_skip_task') || { en: COPY.en.mic_skip_task, ur: COPY.ur.mic_skip_task }; }
    /** Round 7b (sa_silence_repeat): no voice heard on the part; Jugnu asks for the answers out loud, then the part again. */
    function sSilenceReminder(v) {
      return screen(v, 'sae-silence sa-silence', [
        jugnu('idle', true),
        // a short title, then Jugnu's whole line as a paragraph: the long Urdu line is never cut by the foot (sa_ur_fit)
        h('h1', { class: 'sae-h1', text: C.silence_title }),
        h('p', { class: 'sae-p', text: tx(copyLine('silence_repeat')) }),
      ], [btn(C.silence_again, function () { runner.silenceRepeatDone(); draw(); }, 'sae-primary')]);
    }

    function sTaskEnd(v) {
      var skipped = v.result && /^skipped|^mic_unavailable|^assets_unavailable/.test(v.result.stop_reason || '');
      var noMic = v.result && v.result.stop_reason === 'mic_unavailable';
      return screen(v, 'sae-tend', [
        jugnu(skipped ? 'idle' : 'celebrate'),
        skipped ? null : h('h1', { class: 'sae-h1 sae-xl', text: C.well_done }),
        noMic ? h('p', { class: 'sae-p sae-micskip', text: tx(micSkipLine()) }) : null,
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
        // Round 8 (r8_layout / r8_lang_switch): .is-r8-endfit keeps the hand-back line above the coach page's bottom bar
        return h('div', { class: 'sae-screen sae-end is-proctored' + (r8Layout || r8Lang ? ' is-r8-endfit' : '') }, [
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
          // RDF manual: Jugnu is silent but for the sound check and one line per task, so the coach sets the sound up first.
          manual ? h('p', { class: 'sae-sub sae-headphones', text: C.headphones }) : null,
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

    // ---------- round 8, items 25/26 (r8_nudges): the speak / tap cue ----------
    var cue = null; // the speaking screen's level loop: { k, stop, bar, lvl }
    /** How the child answers the screen on show: 'speak', 'tap', or null (not a child item screen). */
    function cueKind(v, phase) {
      var t = v.task;
      if (!t) return null;
      if (phase === 'running') return t.mode === 'oral' || t.mode === 'record' ? 'speak' : 'tap';
      if (phase === 'practice') return t.mode === 'record' && !hold ? 'speak' : 'tap';
      if (phase === 'last_word' && !coachLW) return 'tap';
      return null;
    }
    function cueStop() {
      var c = cue;
      cue = null;
      if (c && typeof c.stop === 'function') { try { c.stop(); } catch (e) { /* the mic's */ } }
    }
    function cuePaint(c) {
      if (!c.bar || c.lvl == null) return;
      c.bar.hidden = false;
      var fill = c.bar.firstChild;
      if (fill) fill.style.height = Math.round(Math.max(0, Math.min(1, +c.lvl || 0)) * 100) + '%';
    }
    /** SAE.mic.level, through the engine (opts.micLevel) or the page's own module; null when there is none. */
    function levelFn() {
      if (typeof opts.micLevel === 'function') return opts.micLevel;
      if ('micLevel' in opts) return null;
      var m = typeof window !== 'undefined' && window.SAE && window.SAE.mic;
      return m && typeof m.level === 'function' ? m.level : null;
    }
    /** Put the cue in the screen's top bar (its physical right edge, both directions); a speaking screen's bar runs. */
    function cueOn(v, phase, s) {
      var kind = r7.r8_nudges === true ? cueKind(v, phase) : null;
      var k = kind ? keyOf(v) + '|' + kind : null;
      if (cue && cue.k !== k) cueStop();
      if (!kind) return;
      var top = s.querySelector('.sae-top');
      if (!top) return;
      var lf = kind === 'speak' ? levelFn() : null;
      var bar = lf ? h('span', { class: 'sae-r8-lvl', 'aria-hidden': 'true', hidden: '' }, [h('span', { class: 'sae-r8-lvl-fill' })]) : null;
      var ico = h('span', { class: 'sae-r8-ico', 'aria-hidden': 'true' });
      ico.innerHTML = CUE_SVG[kind];
      top.appendChild(h('div', { class: 'sae-r8-cue is-' + kind, 'data-cue': kind, role: 'img', 'aria-label': kind === 'speak' ? C.cue_speak : C.cue_tap }, [ico, bar]));
      if (!lf) return;
      if (!cue) {
        var c = cue = { k: k, stop: null, bar: null, lvl: null };
        try {
          c.stop = lf(function (level) {
            if (!alive || cue !== c) return;
            c.lvl = level;
            cuePaint(c);
          });
        } catch (e) { c.stop = null; }
      }
      cue.bar = bar;
      cuePaint(cue);
    }

    // ---------- round 8, item 32 (r8_highlight): the instruction lit word by word as Jugnu says it ----------
    var hlRun = null; // the line being followed: { host, a, words, spans, idx, raf }
    /** The words of a line Jugnu may say, on the screen: a span keyed by its clip (ON only; OFF the plain text). */
    function hlText(text, said) {
      var clip = r7.r8_highlight === true ? clipOf(said, null) : null;
      if (!clip || !V4_RX.test(clip)) return text;
      return h('span', { class: 'sae-r8-text', 'data-r8-clip': clip, text: text });
    }
    /** The clip key the voice plays for (textObj, audioObj), as sa-voice picks it. */
    function clipOf(textObj, audioObj) {
      var a = audioObj != null ? audioObj : (textObj && typeof textObj === 'object' ? textObj.audio : null);
      if (typeof a === 'string') return a || null;
      return a && typeof a === 'object' && typeof a[lang] === 'string' && a[lang] ? a[lang] : null;
    }
    function hlStop() {
      var r = hlRun;
      hlRun = null;
      if (!r) return;
      if (r.raf != null) cancelFrame(r.raf);
      if (r.spans && r.spans[r.idx]) r.spans[r.idx].classList.remove('is-on');
    }
    /** The lit word kept in sight: on a phone the instruction runs on under the button, inside its scroll box; a word
     *  outside that box is scrolled up to a third of the way down it. A word already in sight never moves the box. */
    function hlKeep(w) {
      var box = null, win = w.ownerDocument && w.ownerDocument.defaultView;
      if (!win || typeof win.getComputedStyle !== 'function') return;
      for (var n = w.parentNode; n && n !== el && n.nodeType === 1; n = n.parentNode) {
        if (n.scrollHeight > n.clientHeight + 1) {
          var oy = win.getComputedStyle(n).overflowY;
          if (oy === 'auto' || oy === 'scroll') { box = n; break; }
        }
      }
      if (!box) return;
      var b = box.getBoundingClientRect(), r = w.getBoundingClientRect();
      if (r.top >= b.top && r.bottom <= b.bottom) return;
      box.scrollTop = Math.max(0, Math.round(box.scrollTop + (r.top - b.top) - box.clientHeight / 3));
    }
    /** Follow a line Jugnu has just started (say()): its words on the screen lit from the playing clip's clock. */
    function hlFollow(textObj, audioObj, done) {
      hlStop();
      var clip = clipOf(textObj, audioObj);
      if (!clip || !V4_RX.test(clip) || typeof speakFn.audio !== 'function') return;
      var host = null;
      Array.prototype.forEach.call(el.querySelectorAll('.sae-r8-text'), function (n) { if (!host && n.getAttribute('data-r8-clip') === clip) host = n; });
      if (!host) return;
      var r = hlRun = { host: host, a: null, words: null, spans: null, idx: -1, raf: null };
      function step() {
        r.raf = null;
        if (hlRun !== r || !alive || !host.isConnected) { if (hlRun === r) hlStop(); return; }
        var a = null;
        try { a = speakFn.audio(); } catch (e) { a = null; }
        if (a && a !== r.a) {
          r.a = a;
          timingFor(a.src).then(function (d) {
            if (hlRun !== r || r.a !== a || !d) return;
            var toks = host.textContent.split(/\s+/).filter(Boolean);
            if (d.words.length !== toks.length) return;
            if (!r.spans) {
              while (host.firstChild) host.removeChild(host.firstChild);
              r.spans = toks.map(function (w, i) {
                if (i) host.appendChild(document.createTextNode(' '));
                return host.appendChild(h('span', { class: 'sae-r8-w', text: w }));
              });
            }
            r.words = d.words;
          });
        }
        if (r.words && r.a) {
          var ms = (+r.a.currentTime || 0) * 1000, i = -1;
          for (var j = 0; j < r.words.length && r.words[j].s_ms <= ms; j++) i = j;
          if (i !== r.idx) {
            if (r.spans[r.idx]) r.spans[r.idx].classList.remove('is-on');
            if (r.spans[i]) { r.spans[i].classList.add('is-on'); hlKeep(r.spans[i]); }
            r.idx = i;
          }
        }
        r.raf = nextFrame(step);
      }
      step();
      Promise.resolve(done).then(function () { if (hlRun === r) hlStop(); });
    }

    // ---------- the frame ----------
    function keyOf(v) {
      var k = v.phase + '|' + v.task_index;
      if (v.phase === 'practice' && v.practice) k += '|' + v.practice.id;
      if (v.phase === 'running' && v.item) k += '|' + v.item.id + '|' + v.item_index;
      if (v.phase === 'running' && v.cell != null) k += '|c' + v.cell_index;
      return k;
    }

    // What a screen says when it first shows.
    function enter(v) {
      var t = v.task;
      var s = (t && t.script) || {};
      if (v.phase === 'battery_intro') afterOpening(function () { return say(line('welcome')); });
      else if (v.phase === 'audio_check') {
        if (checkBad) say(line('audio_fail') || { en: COPY.en.audio_bad_sub, ur: COPY.ur.audio_bad_sub }, null, true);
        else {
          if (!check) newCheck();
          // The sound check is a device check, voiced in a coach-led run too (the coach line needs the speaker).
          // A picture tapped during the question has answered this check: its word is not said after it.
          var asked = check;
          afterOpening(function () {
            return say(line('audio_check') || { en: COPY.en.audio_q, ur: COPY.ur.audio_q }, null, true).then(function () { if (check === asked && !checkBad) return playCheck(); });
          });
        }
      } else if (v.phase === 'warmup') say(copyLine('warm_title'));
      else if (v.phase === 'mic_check') {
        if (typeof opts.micProbe !== 'function') later(function () { if (runner.view().phase === 'mic_check') { micSt = null; runner.micChecked(false, 0); draw(); } }, 0);
        else say(line('mic_check') || { en: COPY.en.mic_say, ur: COPY.ur.mic_say });
      } else if (v.phase === 'oral_practice') {
        var gp = gen;
        say(line('oral_practice') || { en: COPY.en.oral_try, ur: COPY.ur.oral_try }).then(function () { if (alive && gp === gen) startMeter(); });
      } else if (v.phase === 'keypad_warmup') say(line('keypad_warmup') || { en: COPY.en.kp_warm, ur: COPY.ur.kp_warm });
      else if (v.phase === 'instruction' && manual) {
        runner.log('coach_brief', { task_id: t.id });
        say(copyLine('coach_will_instruct'), null, true);
      } else if (v.phase === 'instruction') gateOn(keyOf(v), playIntroAll(t));
      else if (v.phase === 'practice' && v.practice) {
        var first = t.practice.indexOf(v.practice) === 0;
        var k0 = keyOf(v);
        var said = sayChain([first && s.practice_intro && !manual ? [s.practice_intro] : null]).then(function () {
          if (!alive || lastKey !== k0 || hold) return null;
          if (t.mode === 'record' && v.practice.role === 'example') return sayChain(modelOf(v.practice));
          // r8_practice_autoplay: the prompt (unless the task reads it only on replay), then the answer, no tap needed
          if (autoAnswer(t, v.practice)) {
            var gp2 = gen;
            return (t.say_on === 'replay' ? Promise.resolve() : sayItem(v.practice, t)).then(function () {
              if (alive && gp2 === gen && lastKey === k0) return sayChain(modelOf(v.practice));
            });
          }
          if (!(t.mode === 'record' && t.say_on === 'replay')) return sayItem(v.practice, t);
          return null;
        });
        if (t.mode === 'record') gateOn(k0, said); // the spoken practice's Next (a tap practice has none)
      } else if (v.phase === 'ready') gateOn(keyOf(v), sayChain(manual ? [] : [s.test_intro ? [s.test_intro] : null, s.begin ? [s.begin] : null]));
      else if (v.phase === 'running' && v.item) {
        if (t.mode === 'oral') {
          var key = keyOf(v), g2 = gen;
          sayItem(v.item, t).then(function () {
            if (!alive || g2 !== gen || lastKey !== key) return;
            if (runner.promptDone) runner.promptDone(); // the answer window starts after the question
            if (sectionRec) return; // the task's one recording is already running (recorderHooks)
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
      } else if (v.phase === 'running' && t && t.mode === 'record' && v.cell != null) {
        // One cell at a time: no star line; the recorder opens at once and runs across the cells. An item with words
        // (a sum) is read when it shows, unless the task reads it only on replay.
        if (itemSpeaks(v.cell_item) && t.say_on !== 'replay') sayItem(v.cell_item, t);
      } else if (v.phase === 'running' && t && t.mode === 'record') {
        // The star line first; the recorder opens after it (recorderHooks), so Jugnu is neither in the child's
        // recording nor in the silence watch's first second.
        // Round 8 (r8_reading_no_done): nothing about "done" on the way in (a child took «ہو گیا» for the end of the
        // test); the recorder still waits a moment, so the tail of the last line stays out of the recording.
        starSpeech = r7.r8_reading_no_done === true ? delay(R8_REC_GAP_MS) : say(line('done') || { en: COPY.en.done, ur: COPY.ur.done }, null, appAsks);
      } else if (v.phase === 'last_word' && coachLW) {
        askHint(v.task);
        sayChain([v.time_left_ms === 0 && s.time_up ? [s.time_up, undefined, appAsks] : null, manual ? null : [copyLine('give_coach')]]);
      } else if (v.phase === 'last_word') {
        sayChain([v.time_left_ms === 0 && s.time_up ? [s.time_up, undefined, appAsks] : null, manual ? null : (s.intro_tap ? [s.intro_tap] : [copyLine('last_word')])]);
      } else if (v.phase === 'task_end') {
        var r = v.result || {};
        var skipped = /^skipped|^assets_unavailable/.test(r.stop_reason || '');
        var noMic = r.stop_reason === 'mic_unavailable';
        var said = noMic ? micSkipLine() : skipped ? null : ((r.stop_reason === 'time_up' ? s.time_up : r.stop_reason === 'early_stop_first_line' ? s.early_stop : null) || s.after);
        var sp = said ? say(said, null, appAsks && said === s.time_up) : Promise.resolve();
        var at = v.task_index;
        Promise.all([delay(noMic ? MIC_SKIP_MS : skipped ? 400 : TASK_END_MS), capped(sp, TASK_END_CAP_MS)]).then(function () {
          if (!alive) return;
          var now = runner.view();
          if (now.phase === 'task_end' && now.task_index === at) { runner.next(); draw(); }
        });
      } else if (v.phase === 'silence_reminder') {
        say(copyLine('silence_repeat'));
      } else if (v.phase === 'battery_end') {
        if (mode === 'proctored') say(handback === 'teacher' && line('end') ? line('end') : copyLine('give_coach'));
        else say(copyLine('all_done'));
      }
    }

    /** r8_comp_wait_next: the stuck line, small, just above Next in the foot (always in view, never over the question). */
    // Text only from COPY (not copyLine, which is for lines with a clip): the page has no recording of these words.
    function stuckEl() { return h('p', { class: 'sae-sub sae-r8-stuck', text: tx(line('stuck_press_next')) || C.stuck_press_next }); }
    // The recorder hooks: a record task's running phase (however it ends), and each oral question.
    function recorderHooks(v) {
      var isRec = v.phase === 'running' && v.task && (v.task.mode === 'record' || (sectionRec && v.task.mode === 'oral'));
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
      if (r8Lang) langApply();
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
        case 'silence_reminder': s = sSilenceReminder(v); break;
        case 'battery_end': s = sEnd(v); break;
        default: s = screen(v, '', [h('p', { text: v.phase })]);
      }
      while (el.firstChild) el.removeChild(el.firstChild);
      el.appendChild(s);
      cueOn(v, showPhase, s);
      fitCells(s);
      if (mode === 'proctored' && showPhase !== 'handover' && showPhase !== 'refused') {
        coachLayer(v).forEach(function (n) { el.appendChild(n); });
        if (coachMenu) el.appendChild(sCoachMenu(v));
      }
      if (r8Digits) latinScreen(el, v.task);
      if (r8Mn) mnFit(s);
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
      if (r === 'go_on') say(copyLine('please_go_on'));
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
      /**
       * Round 8 item 4 (sa_r8_lang_switch): the same test's battery in the other language (normalised; the page
       * fetched it and checked its tasks and items are this run's). ON, the toggle shows once it is here; OFF, ignored.
       * o.onSwitch(lang) when a switch takes over (the page sets its own lang/dir).
       */
      langBattery: function (l, b, o) {
        if (!r8Lang || !alive || (l !== 'en' && l !== 'ur') || l === homeLang || !b || !Array.isArray(b.tasks)) return;
        langAlt[l] = b;
        langOnSwitch = o && typeof o.onSwitch === 'function' ? o.onSwitch : null;
        draw();
      },
      /** The mercy rule (RULING #10; the engine calls it after 12 s of no voice): Jugnu says lines.mercy once, the star pulses. */
      mercy: function () {
        var v = runner.view();
        if (!alive || v.phase !== 'running' || !v.task || v.task.mode !== 'record' || v.cell != null || mercied[v.task.id]) return;
        mercied[v.task.id] = true;
        var star = el.querySelector('.sae-star');
        if (star) star.classList.add('is-mercy');
        say(line('mercy') || { en: COPY.en.mercy, ur: COPY.ur.mercy });
      },
      /** A full-screen stop: refuse('voice') when the battery's voice is not ready (proctored: no buttons; game: back). */
      refuse: function (kind, o) {
        if (!alive) return;
        refused = kind || 'voice';
        refusedRetry = o && typeof o.retry === 'function' ? o.retry : null;
        gen++;
        loop(false);
        draw();
        say(line('voice_not_ready') || { en: COPY.en.voice_not_ready, ur: COPY.ur.voice_not_ready });
      },
      /** The refusal lifted (Try again found a voice): the screen it covered, from its start. */
      unrefuse: function () {
        if (!alive || !refused) return;
        refused = null;
        refusedRetry = null;
        lastKey = null;
        draw();
      },
      /** Game: the map cannot be reached yet (the engine waits for the network): the end screen says so, spoken once. */
      backWait: function () {
        if (!alive || backWaiting) return;
        backWaiting = true;
        draw();
        say(copyLine('back_wait'));
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
        cueStop();
        hlStop();
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
  /** The chip over a one-at-a-time spoken item: the task's own (the mental sums: "Say the answer"), else "Read aloud". */
  function recChip(t, C) { return (t && t.chip) || C.read_aloud; }

  function handBack(opts, assign, safe) {
    try { if (opts.onHandback) opts.onHandback(); } catch (e) { /* page */ }
    if (opts.onUnlock) {
      try { opts.onUnlock(); } catch (e) { /* page */ }
      return;
    }
    var u = safe(opts.back);
    if (u) assign(u);
  }

  return { mount: mount, handback: handBack, COPY: COPY, passageWords: passageWords, recChip: recChip };
}));
