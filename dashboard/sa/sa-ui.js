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
 *   r10_hint_once     round 10 audio 1: the say-then-press hint is not said after the instruction (which says it), only shown.
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
 * Round 28, the letter-sound picker (opts.r28.letter_pick, else battery.ui.r28_letter_pick, and a task of kind 'pick'):
 *   sRunPick          Jugnu's sound clip plays 300 ms after the item shows (coach-led too: the coach never voices it),
 *                     five letter cards of one size (phone 2 + 3, tablet one row), one big replay under them (the clip
 *                     only, logged replay { value: 'child' }, counted). A tap counts at any time, the clip playing or
 *                     not: runner.answer(value, { replays, tap_ms, tap_ms_src[, pre_taps] }), tap_ms against the
 *                     prompt's speech end from v5/prompt_timings.json when it has the clip. A tap before the speech
 *                     starts (+ TAP_LEAD_IN_MS) is not an answer: logged tap_before_sound, counted on the answer as
 *                     pre_taps, the item stays open (no timing entry: the 300 ms lead-in is the speech start). Every play of the sound tells
 *                     the runner (clipPlaying): the auto replay and Next count from the end of the last play. No
 *                     feedback on a scored item.
 *   practice          P1 (role 'example') is modelled: the cards disabled, the right one lit, the clip then the model
 *                     line, then Next (RDF auto: also on by itself 2 s later) → runner.practiceModelled(). P2 is the tap
 *                     practice as for every tap task, with the clip and the replay. At the task's entry every clip of
 *                     the task is loaded (opts.preload(list, ms), the voice's preload); P1 starts once they are ready
 *                     or after PICK_WARM_MS.
 *   the clip          speak(…, { clip_only: true }): a clip that cannot play is never said by the phone's voice. The
 *                     item's first play lost → runner.clipLost(item, 'prompt'): that item is unavailable and the next one
 *                     shows (the task never ends on it); a replay lost → clipLost(item, 'replay'): the item stays open.
 *                     A clip that starts and then stalls is given up by the voice (no progress for 5 s, one retry) as a
 *                     lost clip; on the first play a tap made while it is stalled is dropped (speak.stalled()), on a
 *                     replay the tap counts. The MCQ's first read-out drops such a tap the same way (never held).
 *   coach-led         the coach's line (C.pick_coach_line, text only) above the fold: folded on every item, kept open
 *                     across a redraw once the coach opens it, folded again on the next item. On a scored item the open
 *                     fold carries a replay only, never the target letter; on a practice item the sound and the letter
 *                     («بَ → ب»). The open fold is modal: the first tap anywhere closes it and does nothing else (its
 *                     own replay: closes, then plays); the item's sound never starts while it is open. Logged:
 *                     fold_open {task_id, item_id}, fold_close {task_id, item_id, by: 'summary'|'tap'|'replay'|'item',
 *                     card} ('replay': its own replay button; 'item': the item changed under it, card null). A tap
 *                     within GHOST_MS of a close is the double tap's second half: logged once as ghost_tap {task_id,
 *                     item_id, ms_after_close, card}, never scored (the MCQ's guard, ghostGuard).
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
      replay_sound: 'Hear it again',
      replay_question: 'Hear the question again',
      mcq_coach_line: 'Jugnu reads the question and all four answers. Do not read, translate or give the answer. Let the child tap the answer.',
      // round 28 (sa_r28_letter_pick, lead ruling A.6): the coach's line on every picker screen, coach-led only, text only
      pick_coach_line: 'Jugnu says the sound. Please do not say it. If the child did not hear it, press the sound button.',
      next: 'Next',
      next_go: 'Next →',
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
      all_done: 'All done, my friend!',
      all_done_sub: 'Thank you for playing with Jugnu.',
      back_wait: 'Your island is saved on this phone. It will go when the internet is back.',
      back: 'Go back',
      give_teacher: 'Give the phone back to your teacher.',
      give_coach: 'My friend, give the phone back to the coach.',
      hold: 'Coach: press and hold',
      handover_pre: 'Give the phone to ',
      handover_post: '',
      handover_anon: 'Give the phone to the child',
      coach: 'Coach',
      end_task: 'End this task',
      end_task_r28: 'End this task', // sa_r28_end_task_copy ON (sCoachMenu): the English is unchanged
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
      mic_skip_task: 'No microphone, so we skip this part',
      dev_jump: 'Jump to…',
      mic_speak: 'Speak now…',
      mic_ask: 'Did you hear yourself?',
      mic_yes: 'I heard myself',
      // round 28, O-115 (r28_mic_unknown): the coach's mic card in coach mode
      micu_head: 'Microphone check: tap the button, say one, two, three, then listen.',
      micu_try: 'Try the microphone',
      micu_ask: 'Did you hear the recording?',
      micu_heard: 'I heard it',
      micu_again: 'Try again',
      micu_none: 'No sound came through.',
      micu_without: 'Go on without it',
      micu_denied: 'The microphone is blocked or missing. In Chrome, tap the lock next to the web address, then Permissions → Microphone → Allow. Then tap Try again.',
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
      silence_repeat: 'Jugnu could not hear you. Say each answer out loud. Let us do this part again.',
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
      // round 9 item 3 (r9_skip_instructions): the coach's skip, on the coach-led instruction and practice screens
      skip_instr: 'Skip instructions',
      // round 9 item 7 (r9_scroll_cue): the cue on a screen that runs past the bottom
      r9_scroll: 'Scroll down',
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
      replay_sound: 'دوبارہ سنیں',
      replay_question: 'سوال دوبارہ سنیں',
      mcq_coach_line: 'جگنو سوال اور چاروں جواب خود پڑھے گا۔ آپ نہ پڑھیں، نہ ترجمہ کریں، نہ جواب بتائیں۔ بچے کو خود جواب دبانے دیں۔',
      pick_coach_line: 'آواز جگنو بولے گا۔ آپ آواز نہ بولیں۔ بچہ نہ سنے تو آواز والا بٹن دبائیں۔',
      next: 'آگے',
      next_go: 'آگے ←',
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
      all_done: 'سب ہو گیا پیارے دوست!',
      all_done_sub: 'جگنو کے ساتھ کھیلنے کا شکریہ۔',
      back_wait: 'آپ کا جزیرہ اس فون پر محفوظ ہے۔ انٹرنیٹ آتے ہی چلا دیا جائے گا۔',
      back: 'واپس جائیں',
      give_teacher: 'اب فون ٹیچر کو واپس دے دیں۔',
      give_coach: 'پیارے دوست، اب فون کوچ کو واپس دے دیں۔',
      hold: 'کوچ: دبا کر رکھیں',
      handover_pre: '',
      handover_post: ' کو فون دیں',
      handover_anon: 'اب فون بچے کو دیں',
      coach: 'کوچ',
      end_task: 'یہ حصہ ختم کریں',
      end_task_r28: 'یہ کام ختم کریں', // sa_r28_end_task_copy ON (sCoachMenu)
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
      micu_head: 'مائیک کی جانچ: بٹن دبائیں، ایک، دو، تین کہیں، پھر سنیں۔',
      micu_try: 'مائیک آزمائیں',
      micu_ask: 'کیا ریکارڈ کی ہوئی آواز سنائی دی؟',
      micu_heard: 'آواز سنائی دی',
      micu_again: 'دوبارہ کوشش کریں',
      micu_none: 'آواز نہیں آئی۔',
      micu_without: 'مائیک کے بغیر چلیں',
      micu_denied: 'مائیک بند ہے یا موجود نہیں۔ کروم میں ویب ایڈریس کے ساتھ تالے کا نشان دبائیں، پھر ⁨Permissions → Microphone → Allow⁩۔ پھر "دوبارہ کوشش کریں" دبائیں۔',
      mic_no: 'نہیں سنائی دی',
      oral_try: 'اونچی آواز میں بولیں',
      oral_heard: 'مجھے سنائی دیا!',
      kp_warm: 'جو نمبر چاہیں لکھیں۔ تیار ہوں تو "ہو گیا" دبائیں۔',
      done: 'ہو گیا',
      mercy: 'اگر پڑھنا مشکل ہو تو ستارے کو دبائیں۔',
      voice_not_ready: 'آواز ابھی تیار نہیں',
      please_go_on: 'آگے چلیں۔',
      coach_will_instruct: 'اب آپ کے کوچ ہدایات دیں گے۔',
      silence_repeat: 'جگنو آپ کی آواز نہیں سن سکا۔ ہر جواب اونچی آواز میں بولیں۔ آئیے یہ حصہ دوبارہ کرتے ہیں۔',
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
      // round 9 item 3
      skip_instr: 'ہدایات چھوڑیں',
      // round 9 item 7
      r9_scroll: 'نیچے کی طرف سرکائیں',
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
  // Round 10 timing 1 (r10_practice_next): a tap this soon after the tap that ended a practice is the same double tap
  var DOUBLE_TAP_MS = 300;
  var TASK_END_MS = 1500;
  var TASK_END_CAP_MS = 8000; // the part's closing line is awaited to its end, never longer than this
  var MIC_SKIP_MS = 3000;   // a record task skipped for no microphone: its line stays this long (RULING #38b)
  var PRESS_MS = 180;
  var PICK_PRESS_MS = 400;      // round 28: the letter-sound picker's pressed card, then the next item
  var PICK_CLIP_AFTER_MS = 300; // round 28: the item's sound starts this long after it shows
  var PICK_AUTO_NEXT_MS = 2000; // round 28: RDF auto, the modelled practice moves on this long after its model line
  var PICK_WARM_MS = 5000;      // round 28: the first practice waits for the task's clips at most this long
  var GHOST_MS = 300;           // round 28: a tap this soon after a coach fold closes is the double tap's second half
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
  // Round 28 (the letter-sound picker): where the voice is inside each prompt clip, from the audio lane's map
  // (sa/v5/prompt_timings.json: { "<prompt_audio key>": { speech_start_ms, speech_end_ms } }). Fetched once per task.
  var PROMPT_TIMINGS_URL = 'v5/prompt_timings.json';
  var PROMPT_TIMINGS = null;
  /** Promise<{ key: { s, e } } | null>; never rejects; a refused fetch (offline) is asked again next time. */
  function promptTimings() {
    if (PROMPT_TIMINGS) return PROMPT_TIMINGS;
    var f = typeof window !== 'undefined' && typeof window.fetch === 'function' ? window.fetch.bind(window) : (typeof fetch === 'function' ? fetch : null);
    if (!f) return Promise.resolve(null);
    var p = PROMPT_TIMINGS = Promise.resolve().then(function () { return f(PROMPT_TIMINGS_URL, { credentials: 'same-origin' }); }).then(function (r) {
      return r && r.ok ? Promise.resolve(r.json()).then(promptTimingsOk, function () { return null; }) : null;
    }, function () { PROMPT_TIMINGS = null; return null; });
    return p;
  }
  /** The map checked: only entries with 0 ≤ speech_start_ms ≤ speech_end_ms are kept. */
  function promptTimingsOk(d) {
    if (!d || typeof d !== 'object') return null;
    var out = {}, n = 0;
    for (var k in d) {
      if (!Object.prototype.hasOwnProperty.call(d, k) || !d[k]) continue;
      var st = Number(d[k].speech_start_ms), en = Number(d[k].speech_end_ms);
      if (isFinite(st) && isFinite(en) && st >= 0 && en >= st) { out[k] = { s: st, e: en }; n++; }
    }
    return n ? out : null;
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
    /** Round 28: the clip_only clip on now has stalled mid-play (the voice's speak.stalled(); false without it). */
    function clipStalled() { try { return typeof speakFn.stalled === 'function' && !!speakFn.stalled(); } catch (e) { return false; } }
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
    var reachOffered = null;  // round 28: the item (its key) whose reach was read at the offer of Next
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
    // Round 28, O-115 (r28_mic_unknown): coach mode's mic check is the coach's card (sMicCard)
    var micCard = r7.r28_mic_unknown === true && mode === 'proctored';
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
    // Round 9 item 6 (r9_comp_text): a question on the story the child read is written on the screen as well as said
    var r9Comp = r7.r9_comp_text === true;
    // Round 9 item 3 (r9_skip_instructions): coach-led only, the coach's Skip instructions (never in RDF auto or the game)
    var r9Skip = manual && r7.r9_skip_instructions === true;
    // Round 9 item 7 (r9_scroll_cue): a scroll cue on any screen whose content runs past the bottom
    var r9Scroll = r7.r9_scroll_cue === true;
    // Round 28 (sa_r28_cue_guard, battery.ui.r28_cue_guard): the shown cue never keeps itself shown; scrollCheck takes its
    // own box (height + the gap it adds) off what it measures, so it goes once the screen's own content is in view
    var r28CueGuard = r7.r28_cue_guard === true;
    // Round 28 (sa_r28_toggle_fit, battery.ui.r28_toggle_fit): the language toggle's 56 px button inside a 44 px top bar
    // on every screen, and the head rows that hold a tappable kept clear of its hit area (sa.css "round 28, A11")
    var r28ToggleFit = r7.r28_toggle_fit === true;
    // Round 28 (sa_r28_check_fit, battery.ui.r28_check_fit): the Urdu sound check sized for a phone-height frame, so both
    // picture tiles are whole and tappable without scrolling (sa.css "round 28, the check fit")
    var r28CheckFit = r7.r28_check_fit === true;
    // Round 28 (sa_r28_end_task_copy, battery.ui.r28_end_task_copy): the hold menu's End this task (it ends the test) in
    // Urdu reads «یہ کام ختم کریں», no longer the words of the portal's End this section; OFF: COPY.end_task as before
    var r28EndTask = r7.r28_end_task_copy === true;
    var scrollCue = null; // { s, el, ro, type, phase, task, asked }: the cue of the screen on show
    // Round 10 layout 2 (r10_number_fit): a maths number as large as its box allows, whatever its digits (numFit)
    var r10Num = r7.r10_number_fit === true;
    // Round 10 layout 1 (r10_urdu_fit): every Urdu label centred on its ink, the whole Nastaliq word inside its box
    var r10Fit = r7.r10_urdu_fit === true;
    var scrollSaid = {};  // screen types (phase, or running:<mode>) the cue line was said on
    var talk = null, talkN = 0; // r9Scroll: Jugnu's latest line, and how many are still playing
    // Round 10 audio 1 (r10_hint_once): the say-then-press hint is heard once per task, in the instruction; it stays on the
    // screen but is not said again after the instruction (nor on its replay)
    var r10HintOnce = r7.r10_hint_once === true;
    // Round 10 timing 1 (r10_practice_next): the screen after a practice takes Next at once, no fixed wait on top of
    // Jugnu's words; a double tap still moves one screen (the Go tap inside DOUBLE_TAP_MS of the ending tap is ignored)
    var r10Next = r7.r10_practice_next === true;
    // Round 12 (r12_intro_once): a Ready line marked once (the Whole battery's "Jugnu will not say if an answer is right
    // until the end") is said on the first Ready screen of the run that carries it, not again; its begin line still is
    var r12IntroOnce = r7.r12_intro_once === true;
    var introSaid = false;
    var practiceEndAt = null; // when the tap that ended the practice came (Date.now())
    // Round 28 (battery.ui.r28_letter_pick): the letter-sound picker, a tap task of kind 'pick' (sRunPick)
    var r28Pick = !!(opts.r28 && opts.r28.letter_pick === true) || opts.r28_letter_pick === true || r7.r28_letter_pick === true;
    var pickSt = { id: null, tok: 0, playing: false, end_at: null, replays: 0 }; // the item on show: its clip, its replays
    var pickModelled = null; // the modelled practice screen (its key) whose model line has ended: its Next shows
    var pickWarm = {};       // task id → the promise of its clips loaded (or the PICK_WARM_MS cap)
    var pickTimes = {};      // task id → the prompt timing map (null: none), once fetched
    var TAP_LEAD_IN_MS = 150; // a tap before speech_start_ms + this is a tap into the clip's lead-in (tap_before_sound)
    var PROMPT_LEAD_IN_MS = 300; // A.4: every v5 prompt clip opens with 0.30 s of lead-in (the speech start when there is no timing map)
    var pickFold = null;     // coach-led: the item whose fold the coach opened (it re-folds on the next item)
    var pickFoldWait = [];   // coach-led: what waits for the open fold to close (the item's sound never starts under it)
    var pickFoldTask = null; // coach-led: the task of the item whose fold is open (its fold_close by 'item' at the change)
    // coach-led: the double tap's second half after the picker's fold closed (ghostGuard); the card's 0-based index
    var pickGG = ghostGuard(function (n) {
      var c = n && n.closest ? n.closest('.sae-pick-cards .sae-opt') : null;
      return c ? Array.prototype.indexOf.call(c.closest('.sae-pick-cards').querySelectorAll('.sae-opt'), c) : null;
    });
    // Round 28 (sa_r28_mcq; opts.r28.mcq from sa-engine.js, or battery.ui.r28_mcq): a kind 'mcq' tap task is the spoken
    // multiple choice (sRunMcq)
    var r28Mcq = !!(opts.r28 && opts.r28.mcq === true) || opts.r28_mcq === true || r7.r28_mcq === true;
    // ?probe=1 (sandbox/staging QA): console.debug('hl', option, audio.currentTime) on every light-on and light-off
    var mcqProbe = r28Mcq && typeof location !== 'undefined' && /[?&]probe=1(&|$)/.test(String(location.search || ''));
    var mcq = null; // the read-out of the MCQ item on show: { item, phase, lit, chosen, … } (readOut)
    var mcqPass = null; // round 9 (row 31): the practice passage's own step on show: { item, task, key, t0, run, playing, settle }
    var mcqPassDone = {}; // task|item → the practice passage step ended (logged once; a retry never repeats it)
    var mcqFold = null; // coach-led: { item, task } whose fold the coach opened (modal while open; kept across a redraw)
    var mcqFoldBy = null; // the closing tap's facets for fold_close ({ by: 'tap', card }); else the summary closed it
    // the double tap's second half after the fold closed (ghostGuard): the card is the .sae-mcq-opt's data-index
    var mcqGG = ghostGuard(function (n) { var c = n && n.closest ? n.closest('.sae-mcq-opt') : null; return c ? Number(c.getAttribute('data-index')) : null; });

    function later(fn, ms) { var t = setTimeout(function () { if (alive) fn(); }, ms); timers.push(t); return t; }
    /**
     * Round 28 (lead ruling; the coach-led MCQ and picker folds): the first tap on an open fold only closes it, and the
     * double tap's second half, within GHOST_MS of that close, is no answer either. One guard per screen kind:
     * closed(item, task) when its fold closes; on() while it holds (coach-led only); swallow(e) → true when the tap is
     * that second half: logged once as ghost_tap {task_id, item_id, ms_after_close, card: cardOf(target)} and stopped.
     */
    function ghostGuard(cardOf) {
      var shut = -1e9, of = null;
      function on() { return manual && mcqNow() - shut < GHOST_MS; }
      return {
        closed: function (item, task) { shut = mcqNow(); of = { item: item, task: task }; },
        on: on,
        /** since_fold_ms: ms from this item's last fold close to now (the close this guard recorded), else null. */
        since: function (item) { return of && of.item === item ? Math.round(mcqNow() - shut) : null; },
        swallow: function (e) {
          if (!on()) return false;
          if (of) runner.log('ghost_tap', { task_id: of.task, item_id: of.item, ms_after_close: Math.round(mcqNow() - shut), card: cardOf(e.target) });
          e.stopImmediatePropagation(); e.preventDefault();
          return true;
        },
      };
    }
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
    /** r10_hint_once: whether hint line hl is one of the say-then-press lines (the instruction already says it). */
    function sayHint(hl) { return !!hl && (hl === line('r7_say_next') || hl === line('r7_say_done') || hl === line('r7_say_next_q')); }
    function hintEl(t, cls) {
      var hl = hintOf(t);
      if (!hl) return null;
      return h('p', { class: (cls || 'sae-say') + ' sae-r7-hint' }, [hlText(tx(hl), hl), t.mode === 'keypad' ? h('span', { class: 'sae-r7-tick', 'aria-hidden': 'true', text: ' ✓' }) : null]);
    }
    /** back_button: Back on an item screen after the first item (or cell); runner.back() shows the one before.
     *  Round 28: never on the letter picker (sa_r28_letter_pick) or the spoken MCQ (sa_r28_mcq), either mode. Their
     *  items are taps scored on the first answer (a Back would open a second one), and on a 360×640 phone the foot row
     *  Back makes would take the second card row and the replay pill out of reach; the coach keeps the corner hold, the fold
     *  and its replay. Every other task keeps its Back. */
    function backBtn(v) {
      if (r7.back_button !== true || v.phase !== 'running' || !v.task) return null;
      if (isPick(v.task) || isMcq(v.task)) return null;
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
    // Round 9 item 7: the cue is checked again on a scroll (the page or the body), a resize, a picture that came late
    if (r9Scroll && typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('scroll', function () { if (alive) scrollCheck(); }, true);
      window.addEventListener('resize', function () { if (alive) scrollCheck(); });
      el.addEventListener('load', function () { if (alive) scrollCheck(); }, true);
    }
    // Round 10 layout 2: a resize sizes the numbers again (before mnFit's own pass, which then fits them above the foot)
    var numRefit = null;
    if (r10Num && typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', function () {
        if (!alive) return;
        clearTimeout(numRefit);
        numRefit = later(function () { var s = el.querySelector('.sae-screen'); numFitOn(s); if (r8Mn) mnFit(s); }, 120);
      });
    }
    // Round 10 layout 1 (r10_urdu_fit): a resize, or a label shown or changed after the draw (the scroll cue, the coach's
    // menu, a gated Next), is fitted again
    if (r10Fit && typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', function () { if (alive) urFitSoon(); });
      if (typeof window.MutationObserver === 'function') {
        // only a change that shows Urdu words counts (the clock's digits change every frame)
        var urShown = function (n) { return !!n && UR_LETTER.test(n.textContent || ''); };
        new window.MutationObserver(function (recs) {
          if (alive && recs.some(function (r) { return r.type === 'attributes' ? urShown(r.target) : Array.prototype.some.call(r.addedNodes, urShown); })) urFitSoon();
        }).observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
      }
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
    /** vo (round 28): the voice's options; { clip_only: true } → the promise rejects when the clip cannot play. */
    function say(textObj, audioObj, inManual, vo) {
      if (!textObj && !audioObj) return Promise.resolve();
      if (manual && !inManual) return Promise.resolve();
      if (r8Lang && lang !== homeLang) { var tagged = langSaid(textObj, audioObj); textObj = tagged[0]; audioObj = tagged[1]; }
      var clipOnly = !!(vo && vo.clip_only);
      try {
        var raw = vo ? speakFn(textObj || null, audioObj || null, vo) : speakFn(textObj || null, audioObj || null);
        var p = clipOnly ? Promise.resolve(raw) : Promise.resolve(raw).catch(function () {});
        var settled = clipOnly ? p.catch(function () {}) : p;
        if (r9Scroll) { talk = settled; talkN++; settled.then(function () { talkN--; }); }
        if (r7.r8_highlight === true) { try { hlFollow(textObj, audioObj, settled); } catch (e) { /* the plain words */ } }
        return p;
      } catch (e) { return clipOnly ? Promise.reject(e) : Promise.resolve(); }
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
      if (isPick(t)) return sayClip(it, t, 'replay');
      if (isMcq(t) && Array.isArray(it.options)) return readOut(it, t, { replay: true }); // sa_r28_mcq: the runner's auto replay
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
    // ---------- round 28 (r28_letter_pick): the letter-sound picker's sound ----------
    function isPick(t) { return r28Pick && !!t && t.kind === 'pick' && t.mode === 'tap'; }
    /**
     * Round 28 (data only): how many of an item's answer cards the child can reach. At a picker item or a story question,
     * once drawn and settled (fonts ready, then two frames), a card counts when document.elementFromPoint at its centre
     * is the card or inside it. cards_reach (picker) / options_reach (story question) { n, hit, vw, vh, at, fold }: at
     * 'draw' once per item as it opens, and at 'offer' once more when the item first offers Next (reachOffered); fold:
     * the coach's fold for this item was open over the screen at the read (coach-led only). Nothing on a page that
     * cannot hit-test, or when the item has gone before the read.
     */
    function reachRead(v, t, at) {
      var type = isPick(t) ? 'cards_reach' : isMcq(t) ? 'options_reach' : null;
      if (!type || !v.item || typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') return;
      var k = keyOf(v), itemId = v.item.id, taskId = t.id;
      var sel = type === 'cards_reach' ? '.sae-pick-cards .sae-opt' : '.sae-mcq-opt';
      var fonts = document.fonts && document.fonts.ready ? Promise.resolve(document.fonts.ready) : Promise.resolve();
      fonts.then(null, function () {}).then(function () {
        nextFrame(function () {
          nextFrame(function () {
            if (!alive || lastKey !== k) return;
            var cards = el.querySelectorAll(sel);
            if (!cards.length) return;
            var hit = 0;
            Array.prototype.forEach.call(cards, function (c) {
              var b = c.getBoundingClientRect();
              var at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
              if (at && (at === c || c.contains(at))) hit++;
            });
            var w = typeof window !== 'undefined' ? window : {};
            var fold = manual && (pickFold === itemId || mcqFoldOpen(itemId));
            runner.log(type, { task_id: taskId, item_id: itemId,
              value: { n: cards.length, hit: hit, vw: Math.round(Number(w.innerWidth)) || null, vh: Math.round(Number(w.innerHeight)) || null, at: at, fold: !!fold } });
          });
        });
      });
    }
    /** The clip state of the item (or practice item) on show; a new item starts afresh. */
    function pickOf(it) {
      if (pickSt.id !== it.id) pickSt = { id: it.id, tok: 0, playing: false, end_at: null, replays: 0, call_at: null, el: null, dur_ms: null, pre_taps: 0 };
      return pickSt;
    }
    /** The item's sound, clip only (never the phone's voice), in coach-led too. → Promise<true> when it played, false
     *  when it could not (after the voice's one retry): stage 'prompt' (the item's first play) makes the item unavailable
     *  and shows the next; 'replay' keeps it open (runner.clipLost). A practice item's lost clip changes nothing. */
    function sayClip(it, t, stage) {
      if (!it) return Promise.resolve(false);
      // coach-led (lead ruling, SPEC A.6): the sound never starts while the coach's fold is open; it waits for the close
      if (manual && pickFold === it.id) {
        var gw = gen;
        return new Promise(function (ok) { pickFoldWait.push(ok); }).then(function () {
          return alive && gw === gen ? sayClip(it, t, stage) : false;
        });
      }
      var ps = pickOf(it);
      var tok = ++ps.tok;
      ps.playing = true;
      ps.stage = stage;
      ps.call_at = Date.now(); ps.end_at = null; ps.dur_ms = null;
      // round 28 (P3 Q4): the runner holds the auto replay and Next while the sound plays and restarts the item's clock at
      // its end, whoever asked for it (the runner ignores this off the item on show: practice, another item)
      var sounding = function (on) { if (typeof runner.clipPlaying === 'function') runner.clipPlaying(it.id, on); };
      sounding(true);
      var p = it.prompt_audio ? say(null, it.prompt_audio, true, { clip_only: true }) : Promise.reject(new Error('no clip'));
      // the voice's element for this clip (for where in the clip a tap lands), when the voice exposes it
      try { ps.el = typeof speakFn.audio === 'function' ? speakFn.audio() : null; } catch (e) { ps.el = null; }
      return p.then(function () {
        if (ps === pickSt && tok === ps.tok) {
          sounding(false);
          ps.playing = false; ps.end_at = Date.now();
          var d = ps.el && Number(ps.el.duration);
          ps.dur_ms = d && isFinite(d) && d > 0 ? d * 1000 : null;
        }
        return true;
      }, function () {
        if (ps === pickSt && tok === ps.tok) { ps.playing = false; sounding(false); }
        if (!alive) return false;
        var v = runner.view();
        if (v.phase === 'running' && v.item && v.item.id === it.id && typeof runner.clipLost === 'function') {
          var moved = runner.clipLost(it.id, stage === 'prompt' ? 'prompt' : 'replay');
          if (moved && stage === 'prompt' && !busy) draw();
        }
        return false;
      });
    }
    /** The task's clips (its items' and its practice's), loaded once at its entry; P1 waits for them, at most PICK_WARM_MS. */
    function pickReady(t) {
      if (!pickWarm[t.id]) {
        var list = (t.items || []).concat(t.practice || []).map(function (x) { return x && x.prompt_audio; }).filter(Boolean);
        var pre = typeof opts.preload === 'function' ? opts.preload : null;
        pickWarm[t.id] = !pre ? Promise.resolve() : Promise.race([
          Promise.resolve().then(function () { return pre(list, PICK_WARM_MS); }).then(null, function () { return null; }),
          delay(PICK_WARM_MS),
        ]);
      }
      return pickWarm[t.id];
    }
    /** The task's prompt timing map, fetched once at its entry (null until it arrives, or when there is none). */
    function pickTimesFor(t) {
      if (!Object.prototype.hasOwnProperty.call(pickTimes, t.id)) {
        pickTimes[t.id] = null;
        promptTimings().then(function (m) { pickTimes[t.id] = m || null; });
      }
      return pickTimes[t.id];
    }
    /** The child asked for the sound again (the big replay, or Jugnu's): counted and logged, the clip only. */
    function pickAgain(it, t, who) {
      if (busy || !alive) return;
      pickOf(it).replays++;
      runner.log('replay', { task_id: t.id, item_id: it.id, value: who || 'child' });
      sayClip(it, t, 'replay');
    }
    /**
     * A tap's replays and its time. With the prompt's timings (SPEC A.5): tap_ms = the tap's place in the clip minus the
     * end of the speech (negative while the sound plays), tap_before_sound when it came before speech start + 150 ms,
     * tap_ms_src 'timings'. Without them: 0 while the clip plays or before it began, else ms since it ended; 'file';
     * the speech start is then the 300 ms lead-in, so tap_before_sound before 300 + 150 ms.
     * The place in the clip: the playing element's time, else the time since the clip was asked for (0 before it was).
     */
    function pickMeta(it, t) {
      var ps = pickOf(it), now = Date.now();
      var tm = t ? pickTimesFor(t) : null;
      var e = tm && it.prompt_audio ? tm[it.prompt_audio] : null;
      var pos;
      if (ps.call_at == null) pos = 0;
      else if (ps.playing || ps.end_at == null) pos = ps.el && Number(ps.el.currentTime) > 0 ? Number(ps.el.currentTime) * 1000 : now - ps.call_at;
      else pos = (ps.dur_ms != null ? ps.dur_ms : ps.end_at - ps.call_at) + (now - ps.end_at);
      // No timing entry (the map absent, e.g. offline before it was cached): the clip-end rule for tap_ms, and the speech
      // start is the A.4 lead-in every v5 prompt is cut with (lead ruling), so the pre-sound window still holds.
      if (!e) {
        var f = { replays: ps.replays, tap_ms: ps.playing || ps.end_at == null ? 0 : Math.max(0, Math.round(now - ps.end_at)), tap_ms_src: 'file', since_fold_ms: pickGG.since(it.id) };
        // only before the clip is asked for or while it plays (one that ended was heard; one that failed never sounded)
        if (pos < PROMPT_LEAD_IN_MS + TAP_LEAD_IN_MS && (ps.call_at == null || ps.playing)) f.tap_before_sound = true;
        if (ps.pre_taps > 0) f.pre_taps = ps.pre_taps;
        return f;
      }
      var m = { replays: ps.replays, tap_ms: Math.round(pos - e.e), tap_ms_src: 'timings', since_fold_ms: pickGG.since(it.id) };
      if (pos < e.s + TAP_LEAD_IN_MS) m.tap_before_sound = true;
      if (ps.pre_taps > 0) m.pre_taps = ps.pre_taps;
      return m;
    }
    /**
     * Lead ruling (SPEC A.5 amended): a tap before speech_start_ms + TAP_LEAD_IN_MS is not a response to the sound. It is
     * logged (tap_before_sound, counted on the item's answer as pre_taps), never scored: no answer, no feedback, no
     * pressed lock (the real tap a moment later must land), the sound plays on and the item stays open. → true when
     * the tap was such a tap. Without a timing entry the window is the 300 ms lead-in + 150 ms.
     */
    function pickPreSound(it, t, value) {
      var m = pickMeta(it, t);
      if (!m.tap_before_sound) return false;
      pickOf(it).pre_taps++;
      runner.log('tap_before_sound', { task_id: t.id, item_id: it.id, value: value, tap_ms: m.tap_ms });
      return true;
    }
    /** Coach-led only, the switch's own line above the folded target on every picker screen. Text only: never spoken. */
    function pickCoachLine(t) {
      if (!manual || !isPick(t)) return null;
      return h('p', { class: 'sae-coach-says is-coach sae-pick-coach-line', lang: lang, dir: lang === 'ur' ? 'rtl' : 'ltr', text: C.pick_coach_line });
    }
    /**
     * Coach-led only, the picker's fold. Folded on every item; opened only by the coach, kept open across a redraw of the
     * same item, folded on the next. Lead ruling (SPEC A.6): on a live (scored) item the target letter is never on the
     * screen, so the open fold carries the replay only (the coach line sits just above it); the bank gives no letter
     * name as a word, so no written cue. On a practice item it still shows the sound and the letter («بَ → ب»).
     */
    function pickFoldEl(it, t, live) {
      if (!manual || !it) return null;
      var body = live
        ? h('button', { class: 'sae-pick-coach-replay', type: 'button', 'aria-label': C.replay_sound, title: C.replay_sound }, [h('span', { 'aria-hidden': 'true', text: '🔊' })])
        : h('p', { class: 'sae-say sae-coach-line', dir: dirOf(t), lang: taskLang(t), text: (it.prompt_text != null ? String(it.prompt_text) : '') + ' → ' + String(it.target) });
      var d = h('details', { class: 'sae-coach-says is-coach sae-pick-coach', open: pickFold === it.id }, [h('summary', { text: C.coach }), body]);
      // a fold no longer on the screen (redrawn before its toggle arrived) changes nothing
      d.addEventListener('toggle', function () { if (d.isConnected) pickFoldSet(it, t, d.open, 'summary', null); });
      return d;
    }
    /** The fold's state, logged once per change (a redraw of the open fold, or the browser's own late toggle, is none):
     *  fold_open {task_id, item_id}; fold_close {task_id, item_id, by: 'summary'|'tap'|'replay', card: the card index or
     *  null}. A close arms the ghost-click guard (pickGG). */
    function pickFoldSet(it, t, open, by, card) {
      var was = pickFold === it.id;
      if (open === was) return;
      pickFold = open ? it.id : null;
      pickFoldTask = open ? t.id : null;
      if (open) { runner.log('fold_open', { task_id: t.id, item_id: it.id }); return; }
      runner.log('fold_close', { task_id: t.id, item_id: it.id, by: by, card: card == null ? null : card });
      pickGG.closed(it.id, t.id);
      var w = pickFoldWait; pickFoldWait = [];
      w.forEach(function (ok) { ok(); });
    }
    /** Coach-led only: the open fold is modal. The first tap anywhere on the screen but its own label closes it and
     *  does nothing else (no answer, no sound, no Next); the fold's own replay closes it (by 'replay'), then the sound
     *  plays. Open or not is the fold element's own state at the tap (a summary tap opens it at once; its toggle event
     *  comes later). Closed: a tap within GHOST_MS of the close is swallowed and logged (ghost_tap), never scored. */
    function pickModal(scr, it, t) {
      if (!manual || !scr) return scr;
      scr.addEventListener('click', function (e) {
        var tg = e.target && e.target.closest ? e.target : null;
        var onSum = !!(tg && tg.closest('summary'));
        var d = scr.querySelector('details.sae-pick-coach');
        if (!(d ? d.open : pickFold === it.id)) {
          if (!onSum) pickGG.swallow(e); // the double tap's second half: never an answer, a replay or a Next
          return;
        }
        if (onSum) return; // the label's own toggle: by 'summary'
        e.stopImmediatePropagation();
        e.preventDefault();
        if (pickFold !== it.id) pickFoldSet(it, t, true); // opened in this frame: its toggle event has not come yet
        var card = tg ? tg.closest('.sae-pick-cards .sae-opt') : null;
        var all = card ? Array.prototype.slice.call(scr.querySelectorAll('.sae-pick-cards .sae-opt')) : [];
        var rep = !!(tg && tg.closest('.sae-pick-coach-replay'));
        pickFoldSet(it, t, false, rep ? 'replay' : 'tap', card ? all.indexOf(card) : null);
        if (d) d.open = false;
        if (rep) pickAgain(it, t, 'coach');
      }, true);
      return scr;
    }
    /** RDF manual: an item the auto run speaks, shown for the coach to read out (open, or folded where it is the answer).
     *  Round 28: a letter-sound item folds its sound and the letter («بَ → ب»). */
    function coachSays(it, folded, t) {
      if (isPick(t)) return pickFoldEl(it, t, false);
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
    if (r9Skip) el.classList.add('is-r9-skip'); // round 9 item 3 (sa.css "Round 9 item 3")
    // Round 9 item 7 (sa.css "Round 9 item 7": every rule under this class)
    if (r9Scroll) el.classList.add('is-r9-scroll');
    if (r28ToggleFit) el.classList.add('is-r28-toggle-fit'); // round 28 (sa.css "round 28, A11")
    if (r28CheckFit) el.classList.add('is-r28-check-fit'); // round 28 (sa.css "round 28, the check fit")
    if (r10Num) el.classList.add('is-r10-numfit'); // round 10 layout 2 (sa.css "Round 10 layout 2")
    // in the coach page's frame, under its corner hold (sa.css keeps the scrolling body below it)
    if (opts.ur_fit && opts.embed) el.classList.add('is-embed');
    // round 8 (items 25/26, r8_nudges): the speak / tap cue's styles (sa.css "Round 8")
    if (r7.r8_nudges === true) el.classList.add('is-r8-cues');
    // round 8 (item 32, r8_highlight): the word being said, lit
    if (r7.r8_highlight === true) el.classList.add('is-r8-hl');
    // round 9 item 6 (r9_comp_text): the story question's styles (sa.css "Round 9 item 6")
    if (r9Comp) el.classList.add('is-r9-comp');
    // round 10 layout 1 (r10_urdu_fit): urFitAll pads each Urdu label to its ink (sa.css "Round 10 layout 1")
    if (r10Fit) el.classList.add('is-r10-urfit');
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
      // round 28: not on the letter picker's or the spoken MCQ's item and practice screens (on a phone its row took the
      // first item's replay below the fold); every other screen keeps it, the instruction included
      if (v.task && (v.phase === 'running' || v.phase === 'practice') && (isPick(v.task) || isMcq(v.task))) return null;
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
      var g = h('div', { class: 'sae-opts sa-tiles' + (n > 4 ? ' is-five' : '') + (numTiles(options, t) ? ' is-r10-num' : ''), lang: tl, dir: tl === 'ur' ? 'rtl' : 'ltr' });
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
    /**
     * Round 10 layout 2 (r10_number_fit): a number on a maths screen is as large as its box allows. Today a card with
     * one or two characters is drawn large (.is-short) and a longer one, a 3-digit number too, at about half that, room
     * or not. ON, after drawing (and on a resize, and once the font has loaded), every number is set to the largest size
     * that fits its box, measured:
     *   - a card (a number or a sum): at most the size a 2-digit number has today, so a 3-digit number is as large as a
     *     2-digit one unless the card is too narrow, and a 1-digit one is no larger than today;
     *   - the choices (which is bigger, the missing number's): ONE size for the group, the largest that fits every tile,
     *     so the bigger number never looks smaller;
     *   - the missing number's row: one size for the row, the largest at which the whole row (its blank holding the
     *     longest number it can be given) fits its width, at most the row's size today (mnFit still shrinks it when a
     *     choice would sit under the foot).
     * Text grows in proportion to its size, so one measurement at a known size gives the size that fits.
     */
    var NUM_FILL_W = 0.92, NUM_FILL_H_CARD = 0.9, NUM_FILL_H_TILE = 0.8, NUM_CAP_TILE = 160, NUM_CAP_ROW = 96, NUM_MIN = 20;
    function isMaths(t) { return /^ma\./.test(String((t && t.id) || '')); }
    function numTiles(options, t) {
      return r10Num && isMaths(t) && Array.isArray(options) && options.length > 0 &&
        options.every(function (o) { return /^[\d\u06F0-\u06F9\u0660-\u0669.,\s-]+$/.test(String(o)); });
    }
    /** The 2-digit card's size today (sa.css .sae-onecell.is-short: clamp(72px, 30vw, 160px)). */
    function numCardCap() { return Math.min(160, Math.max(72, 0.3 * (window.innerWidth || 360))); }
    function contentBox(n) {
      var cs = getComputedStyle(n);
      var pad = function (k) { var v = parseFloat(cs[k]); return v > 0 ? v : 0; };
      return [n.clientWidth - pad('paddingLeft') - pad('paddingRight'), n.clientHeight - pad('paddingTop') - pad('paddingBottom')];
    }
    /**
     * One size for every ink of the group: the largest (to `cap`) at which each fits its own box. The boxes are
     * measured first, at the size the page gives the number, because a tile grows with what is in it; and a number
     * that fits at that size is never drawn smaller than it (a long sum keeps today's size on a phone).
     */
    function numGroup(inks, cap, fillH) {
      var k = Infinity;
      inks.forEach(function (ink) { ink.style.removeProperty('font-size'); });
      var boxes = inks.map(function (ink) { return contentBox(ink.parentNode); });
      var today = Infinity;
      inks.forEach(function (ink, i) {
        var r0 = ink.getBoundingClientRect(), f0 = parseFloat(getComputedStyle(ink).fontSize);
        today = f0 > 0 && r0.width <= boxes[i][0] && r0.height <= boxes[i][1] ? Math.min(today, f0) : 0;
      });
      inks.forEach(function (ink) { ink.style.fontSize = cap + 'px'; });
      inks.forEach(function (ink, i) {
        var b = boxes[i], r = ink.getBoundingClientRect();
        if (!(b[0] > 0 && b[1] > 0 && r.width > 0 && r.height > 0)) return;
        k = Math.min(k, (b[0] * NUM_FILL_W) / r.width, (b[1] * fillH) / r.height);
      });
      if (k === Infinity) { inks.forEach(function (ink) { ink.style.removeProperty('font-size'); }); return; }
      var fs = Math.max(NUM_MIN, Math.floor(cap * Math.min(1, k)), today === Infinity ? 0 : Math.floor(today));
      inks.forEach(function (ink) {
        ink.style.fontSize = fs + 'px';
        if (r8Layout) fitInk(ink, 0); // centred on its ink again at its new size
      });
    }
    function numRow(s) {
      var row = s.querySelector('.sae-seq.is-r8-mn');
      if (!row || !row.parentNode) return;
      var avail = row.clientWidth;
      if (!(avail > 0)) return;
      var longest = 2;
      Array.prototype.forEach.call(s.querySelectorAll('.sae-seq.is-r8-mn .sae-seq-tile:not(.sae-gap), .sae-opts .sae-opt'), function (n) {
        longest = Math.max(longest, String(n.textContent || '').trim().length);
      });
      // measured on a hidden copy at its natural width, the blank holding the longest number
      var F0 = 40;
      var probe = row.cloneNode(true);
      probe.removeAttribute('id');
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;width:max-content;max-width:none;font-size:' + F0 + 'px';
      Array.prototype.forEach.call(probe.querySelectorAll('.sae-seq-tile'), function (n) { n.style.flex = 'none'; });
      Array.prototype.forEach.call(probe.querySelectorAll('.sae-gap .sae-mn-ink'), function (n) { n.textContent = new Array(longest + 1).join('0'); });
      row.parentNode.appendChild(probe);
      var w = probe.getBoundingClientRect().width;
      probe.parentNode.removeChild(probe);
      if (!(w > 0)) return;
      // never smaller than the row's size today when the row (its blank holding the longest number) fits at that size
      var f0 = parseFloat(getComputedStyle(row).fontSize);
      var keep = f0 > 0 && (w * f0) / F0 <= avail ? Math.floor(f0) : 0;
      var fs = Math.max(NUM_MIN, keep, Math.min(NUM_CAP_ROW, Math.floor((avail * 0.96 * F0) / w)));
      row.style.setProperty('font-size', 'var(--mn-fs, ' + fs + 'px)');
    }
    function numFit(s) {
      if (!r10Num || !s || !s.querySelectorAll || typeof window === 'undefined') return;
      Array.prototype.forEach.call(s.querySelectorAll('.sae-onecell.is-r10-num > .sae-ink'), function (ink) {
        numGroup([ink], numCardCap(), NUM_FILL_H_CARD);
      });
      Array.prototype.forEach.call(s.querySelectorAll('.sae-opts.is-r10-num'), function (g) {
        var inks = Array.prototype.filter.call(g.querySelectorAll('.sae-opt > .sae-ink'), Boolean);
        if (inks.length) numGroup(inks, NUM_CAP_TILE, NUM_FILL_H_TILE);
      });
      if (r8Mn) numRow(s);
    }
    /** numFit now, and again once the page's fonts have loaded (measured in a stand-in font, a number is the wrong size). */
    function numFitOn(s) {
      numFit(s);
      if (!s || typeof document === 'undefined' || !document.fonts || !document.fonts.ready) return;
      document.fonts.ready.then(function () { if (alive && s.isConnected) { numFit(s); if (r8Mn) mnFit(s); } }, function () {});
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
    /** The offered Next. `go`: the round-28 screens' RDF-auto label, the word with its arrow (a child alone reads the
     *  arrow); every other screen, and coach-led, keeps «آگے» / "Next" — this helper is shared with the pre-round-28
     *  tap, keypad and keyboard items, whose label never changes. */
    function nextBtn(v, go) {
      shownOffer = !!v.offer_next;
      if (!v.offer_next) return null;
      return btn(go ? C.next_go : C.next, function () { runner.skip(); draw(); }, 'sae-secondary sa-next');
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

    function playIntro(t) { runner.instructionPlayed(); return say(introOf(t), undefined, jugnuInstructs(t)); }
    /** round 28: the picker's instruction carries a sound and the MCQ's says how the answers are read, so Jugnu says them
     *  (and the ready lines) in coach-led as in RDF auto; every other task's instruction in coach-led is the coach's. */
    function jugnuInstructs(t) { return manual && (isPick(t) || isMcq(t)); }
    /** The instruction, then the task's round-7b line (say then Next, the tick, the scroll), when there is one. */
    function playIntroAll(t) {
      var g = gen;
      var hl = hintOf(t);
      if (r10HintOnce && sayHint(hl)) hl = null;
      return playIntro(t).then(function () { if (hl && alive && g === gen) return say(hl); });
    }
    /** RDF manual: the coach's screen in front of each task (the words to read out), then the phone goes to the child. */
    function sCoachBrief(v) {
      var t = v.task;
      // round 28: the brief of a letter picker (r28_letter_pick) or a spoken MCQ (r28_mcq) carries is-r28-brief (the coach
      // page's frame room in sa.css); never on with the switches OFF
      var r28Brief = (r28Pick && t.kind === 'pick') || (r28Mcq && t.kind === 'mcq');
      return h('div', { class: 'sae-screen sae-coach-brief is-coach' + (r28Brief ? ' is-r28-brief' : ''), 'data-task': t.id }, [
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
        h('div', { class: 'sae-foot' }, [btn(C.handover_anon, function () { runner.instructionDone(); draw(); }, 'sae-primary'), skipInstrBtn(v)]),
      ]);
    }
    /**
     * Round 9 item 3 (r9_skip_instructions, RDF manual): the coach's Skip instructions on the part's instruction and
     * practice screens. The runner lands on the part's own Ready screen; the part itself is never skipped.
     */
    function skipInstrBtn(v) {
      if (!r9Skip || (v.phase !== 'instruction' && v.phase !== 'practice')) return null;
      return btn(C.skip_instr, function () { skipInstr(); draw(); }, 'sae-secondary is-coach sae-r9-skip');
    }
    function skipInstr() {
      if (!runner.skipInstructions || !runner.skipInstructions()) return false;
      hold = null;
      busy = false; // from the coach menu, a practice answer's feedback may still be in flight: Go must not wait for it
      gen++; // a practice line still being said is not followed by the next one
      return true;
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
      if (isPick(v.task)) return sPracticePick(v);
      if (isMcq(v.task)) return sMcq(v, hold ? hold.item : v.practice, hold, true); // sa_r28_mcq (B-12)
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
          skipInstrBtn(v),
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
      // r10_practice_next: the last answer waits for Jugnu's feedback only, not the FEEDBACK_MS floor
      var ended = r10Next && runner.view().phase === 'ready';
      if (ended) practiceEndAt = Date.now();
      var f = (r8Lang && p && p.feedback) || res.feedback || {};
      var said = res.ok ? (f.correct || f.right || copyLine('right'))
        : res.retry ? copyLine('try_again')
          : (f.wrong || copyLine('shown'));
      // A line naming an item of the other language is a chain of clips (RULING #31a): said one after another.
      var chain = Array.isArray(said) ? said : [said];
      hold = { item: p, value: value, res: res, text: shownNums(p && p.id, chain.map(tx).join(' ')) };
      try { if (opts.onFeedback) opts.onFeedback({ kind: 'practice', ok: !!res.ok }); } catch (e) { /* skin */ }
      draw();
      // round 28: the picker's and the spoken MCQ's practice feedback is said by Jugnu in coach-led too, as their sounds are
      // (a young child cannot read the line); today's tap practice in coach-led stays the coach's to read
      var fbSaid = appAsks || (manual && (isPick(t) || isMcq(t)));
      // round 28: the letter picker's last feedback (the right card shown; the right tap) keeps the FEEDBACK_MS floor
      // in both modes, under Jugnu's line, so the right card is on screen for a painted frame however short the line
      var floor = !ended || isPick(t) ? delay(FEEDBACK_MS) : null;
      Promise.all([floor, capped(sayChain(chain.map(function (x) { return [x, undefined, fbSaid]; })), 7000)]).then(function () {
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
        if (r10Next && practiceEndAt != null && Date.now() - practiceEndAt < DOUBLE_TAP_MS) return; // the same double tap
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

    // ---------- round 28 (r28_letter_pick): the letter-sound picker ----------
    /** Five letter cards of one size (phone 2 + 3, tablet one row; sa.css .sae-pick-cards), the letter only. */
    function pickCards(options, onPick, decorate, t) {
      return h('div', { class: 'sae-pick-cards' }, [tiles(options, onPick || function () {}, decorate, taskLang(t), t, null)]);
    }
    /** The one big replay under the cards: the sound again, nothing else. No words on it. */
    function pickReplay(it, t) {
      return h('button', { class: 'sae-pick-replay', type: 'button', 'aria-label': C.replay_sound, title: C.replay_sound, onclick: function () { pickAgain(it, t); } }, [
        h('span', { class: 'sae-pick-replay-i', 'aria-hidden': 'true', text: '🔊' }),
      ]);
    }
    function sRunPick(v) {
      var it = v.item, t = v.task;
      // both modes (lead rulings, every state): Next sits in the head row, never at the foot, and its place is held
      // (hidden) until it is offered, so the cards and the replay pill never move when it appears — in RDF auto the
      // Urdu foot button took the second card row and the replay under the fold on a 360×640 phone
      var coachNext = nextBtn(v, !manual) || (manual ? h('span', { class: 'sae-pick-next-slot', 'aria-hidden': 'true' })
        // RDF auto: the pill is sized to its label (the arrow is never clipped), so the held place carries the same label, unseen
        : h('span', { class: 'sae-btn sae-secondary sae-pick-next-slot', 'aria-hidden': 'true', text: C.next_go }));
      return pickModal(screen(v, 'sae-run sae-run-tap sae-pick' + (manual ? ' is-coach-led' : ''), [
        clock(v),
        // one compact row (the phone holds the five cards, the replay and Next without scrolling, coach-led too)
        // one head row in both modes: Jugnu, the title, Next's held place; the child's replay is the big pill under the
        // cards (A.3), so the head carries no second one — in RDF auto it had, and it left the Urdu title 88 px wide
        h('div', { class: 'sae-row sae-pick-head' }, [jugnu('idle', true), h('p', { class: 'sae-task-tag', text: tx(t.title) }), coachNext]),
        pickCoachLine(t),
        pickFoldEl(it, t, true),
        pickCards(it.options, function (o, b) {
          if (pickPreSound(it, t, o)) return; // before the sound: logged, never scored; the item stays open
          // the item's first play stalled mid-way: the cards are inert until it ends or is given up (a tap is dropped)
          var ps0 = pickOf(it);
          if (ps0.playing && ps0.stage === 'prompt' && clipStalled()) return;
          busy = true;
          b.classList.add('is-pressed');
          runner.answer(o, pickMeta(it, t));
          later(function () { busy = false; draw(); }, PICK_PRESS_MS);
        }, null, t),
        pickReplay(it, t),
      ], itemFoot(v, [])), it, t);
    }
    /** The model line(s) of the example, said by Jugnu in both modes (the coach never voices the sound). */
    function pickModelOf(p) { return Array.isArray(p.model) ? p.model.map(function (m) { return [m, m && m.audio, true]; }) : []; }
    /** P1: the sound, then the model line; then its Next (RDF auto: on by itself after PICK_AUTO_NEXT_MS). */
    function pickModel(p, t, k) {
      var g = gen;
      return sayClip(p, t, 'practice').then(function () {
        if (!alive || g !== gen || lastKey !== k) return null;
        return sayChain(pickModelOf(p)).then(function () {
          if (!alive || g !== gen || lastKey !== k) return;
          pickModelled = k;
          draw();
          if (!manual) later(function () { if (pickModelled === k) pickNext(k); }, PICK_AUTO_NEXT_MS);
        });
      });
    }
    function pickNext(k) {
      if (!alive || keyOf(runner.view()) !== k) return;
      if (runner.practiceModelled()) { pickModelled = null; draw(); }
    }
    function sPracticePick(v) {
      var p = hold ? hold.item : v.practice, t = v.task, fb = hold;
      var model = p.role === 'example' && !fb;
      var k = keyOf(v);
      var cards = pickCards(p.options, model ? null : function (o) { if (!pickPreSound(p, t, o)) practicePick(p, t, o); }, function (o, b) {
        if (model) { b.disabled = true; b.classList.add(String(o) === String(p.target) ? 'is-model' : 'is-dim'); return; }
        if (!fb) return;
        b.disabled = true;
        if (String(o) === String(fb.value)) b.classList.add(fb.res.ok ? 'is-right' : 'is-tried');
        if (fb.res.shown != null && String(o) === String(fb.res.shown)) b.classList.add('is-right', 'is-shown');
      }, t);
      // coach-led: the feedback line sits in the head row beside the chip (a phone holds the coach line, the fold, the
      // five cards and the replay pill; a line below the pill would push the screen into a scroll), so it comes and goes
      // without moving the cards or the pill
      var fbLine = feedbackLine(fb);
      // round 28, A8 (r9_skip_instructions, coach-led): the coach's Skip and A7's feedback line do not fit one phone row
      // together (the Urdu try-again line alone is 207 px). On a practice screen with no feedback showing, the Skip sits
      // in one place beside Jugnu and the chip.
      // The second wrong tap's line names the sound (the clip's own words, never cut), so while ANY practice feedback
      // shows coach-led (try again, second wrong, right; the Skip served or not) the chip and the Skip are not drawn and
      // the line, wrapping, takes their slots.
      var fbShown = manual && !!fb;
      var skip = fbShown ? null : skipInstrBtn(v);
      var chip = fbShown ? null : h('span', { class: 'sae-chip', text: C.practice });
      return pickModal(screen(v, 'sae-practice sae-pick' + (model ? ' is-model' : '') + (manual ? ' is-coach-led' : '') + (skip ? ' has-r9-skip' : ''), [
        h('div', { class: 'sae-row sae-pick-head' }, [
          jugnu(fb ? (fb.res.ok ? 'correct' : 'notyet') : 'idle', true),
          chip,
          manual ? fbLine : null,
          replayBtn(function () { gen++; if (model) pickModel(p, t, keyOf(runner.view())); else pickAgain(p, t); }),
          skip,
        ]),
        pickCoachLine(t),
        coachSays(p, true, t),
        cards,
        model ? null : pickReplay(p, t),
        manual ? null : fbLine,
      ], [model && pickModelled === k ? btn(C.next, function () { pickNext(k); }, 'sae-primary sa-next sae-pick-next') : null]), p, t);
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
      return h('div', { class: 'sae-onecell sa-onecell' + (Array.from(s).length <= 2 ? ' is-short' : '') + (r10Num && numeric && isMaths(t) ? ' is-r10-num' : ''), dir: numeric ? 'ltr' : dirOf(t), lang: numeric ? 'en' : taskLang(t), 'data-i': i == null ? null : String(i) }, [
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
    /**
     * Round 10 layout 1 (r10_urdu_fit). An Urdu label's line box is set by the font's ascent and descent, but Nastaliq's
     * ink runs well past both (a «ک» or «ھ» far above, the tail of «م» or «ے» below) and differs word to word, so a box
     * padded for the tallest word holds a short one low (the round 6 pill: 1.3em above, .4em below). Here each label is
     * measured by its own ink: a canvas gives the drawn word's height above and below its baseline, the letters' boxes
     * give where each line's baseline is, and the label's top and bottom padding are moved so the ink is in the middle
     * with at least UR_FIT_ROOM px (or .15em) on each side. The label keeps its size unless the ink needs more room. A
     * one-line pill is centred side to side the same way. Labels with no Urdu letter (numbers) are left alone, and so
     * are the letter cards, tiles and passage words (fitCells places those).
     */
    var UR_FIT_SEL = '.sae-btn, .sae-chip, .sae-choice, .sae-star-word, .sae-pic-w, .sae-more-w, .sae-r9-scroll-w, .sae-r8-lang-o, .sae-task-tag, ' +
      '.sae-fb, .sae-cap, .sae-coach-says > summary, .sae-r9-q, .sae-handback, .sae-r8-stuck, .sae-h1, .sae-sub, .sae-say, .sae-p, .sae-coach-line, ' +
      '.sae-coach-items > li';
    // a pill (a box drawn round one line) is centred side to side too; running text keeps its own alignment
    var UR_FIT_PILL = /(^|\s)sae-(btn|chip|choice|star-word|pic-w|more-w|r9-scroll-w|r8-lang-o|fb|cap|r9-q)(\s|$)/;
    var UR_LETTER = /[\u0621-\u063A\u0641-\u064A\u0671-\u06D3\u06D5]/; // an Arabic-script letter (not a digit)
    var UR_FIT_ROOM = 4;
    var urFitT = null;
    function urFitAll() {
      if (!r10Fit || !alive || typeof document === 'undefined' || !el.querySelectorAll) return;
      var g = document.createElement('canvas').getContext('2d');
      if (!g) return;
      var list = Array.prototype.filter.call(el.querySelectorAll(UR_FIT_SEL), function (n) {
        var l = n.closest('[lang]');
        return l && l.getAttribute('lang') === 'ur' && UR_LETTER.test(n.textContent || '') && !n.querySelector('.sae-ink, ' + UR_FIT_SEL);
      });
      list.forEach(function (n) { urFitOne(n, g, 0); });
      // the face may still be on its way: once it is, the ink is measured again
      if (list.length && document.fonts && document.fonts.load) {
        document.fonts.load(getComputedStyle(list[0]).font || '16px serif', '\u0627\u0628\u067E').then(function () {
          list.forEach(function (n) { if (alive && n.isConnected) urFitOne(n, g, 0); });
        }, function () {});
      }
    }
    function urFitSoon() {
      if (!r10Fit) return;
      clearTimeout(urFitT);
      urFitT = later(urFitAll, 30);
    }
    function urFitOne(n, g, tries) {
      var b = n.getBoundingClientRect();
      if (!b || !b.height || !b.width) return;
      var cs = getComputedStyle(n);
      g.font = cs.font; g.direction = 'rtl'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      // the page's word spacing (.12em on Urdu) widens the line: the canvas spaces the words the same way
      if ('wordSpacing' in g) g.wordSpacing = cs.wordSpacing && cs.wordSpacing !== 'normal' ? cs.wordSpacing : '0px';
      var asc = g.measureText('\u0627').fontBoundingBoxAscent;
      if (asc == null) return;
      var lines = urLines(n, asc);
      var ink = null;
      lines.forEach(function (ln) {
        if (ln.base == null) return;
        var m = g.measureText(ln.text);
        if (m.actualBoundingBoxAscent == null) return;
        var t = ln.base - m.actualBoundingBoxAscent, bt = ln.base + m.actualBoundingBoxDescent;
        var l = ln.left - (m.actualBoundingBoxLeft || 0), r = ln.left + (m.actualBoundingBoxRight || 0);
        ink = ink ? { t: Math.min(ink.t, t), b: Math.max(ink.b, bt), l: Math.min(ink.l, l), r: Math.max(ink.r, r) } : { t: t, b: bt, l: l, r: r };
      });
      if (!ink) return;
      var px = function (x) { var f = parseFloat(x); return isFinite(f) ? f : 0; };
      var room = Math.max(UR_FIT_ROOM, Math.round(px(cs.fontSize) * 0.15));
      var v = urSplit(ink.t - b.top - px(cs.borderTopWidth), b.bottom - px(cs.borderBottomWidth) - ink.b, px(cs.paddingTop), px(cs.paddingBottom), room);
      var gl = ink.l - b.left - px(cs.borderLeftWidth), gr = b.right - px(cs.borderRightWidth) - ink.r;
      var pl = px(cs.paddingLeft), pr = px(cs.paddingRight);
      // side to side: a one-line pill is centred; one line of running text only gets room where its swash runs out
      var hz = lines.length !== 1 ? null : UR_FIT_PILL.test(n.className || '') ? urSplit(gl, gr, pl, pr, room)
        : gl < room - 0.75 || gr < room - 0.75 ? { a: pl + Math.max(0, room - gl), b: pr + Math.max(0, room - gr), change: true } : null;
      if (!v.change && !(hz && hz.change)) return;
      if (v.change) { n.style.paddingTop = v.a + 'px'; n.style.paddingBottom = v.b + 'px'; }
      if (hz && hz.change) { n.style.paddingLeft = hz.a + 'px'; n.style.paddingRight = hz.b + 'px'; }
      // a box held at its min-height moves its ink half as far as an auto-height one: measure again until it is even
      if (tries < 3) urFitOne(n, g, tries + 1);
    }
    /** gaps a, b between the ink and the box's two sides, paddings pa, pb: the paddings that make the gaps even and >= room
     *  (an auto-sized box moves the ink by the whole padding change, a centred fixed one by half: both end even). */
    function urSplit(a, b, pa, pb, room) {
      var grow = Math.max(0, room - (a + b) / 2);
      var x = (b - a) / 2 + grow, y = (a - b) / 2 + grow;
      var lift = Math.max(0, -(pa + x), -(pb + y));
      x += lift; y += lift;
      return { a: Math.round((pa + x) * 10) / 10, b: Math.round((pb + y) * 10) / 10, change: Math.abs(x) > 0.75 || Math.abs(y) > 0.75 };
    }
    /** The label's lines (letters grouped by the line they are on): each line's text, left edge and baseline (an Urdu
     *  letter's box top + the face's ascent). */
    function urLines(n, asc) {
      var lines = [], rg = document.createRange(), last = null;
      var w = document.createTreeWalker(n, 4 /* text */, null, false), t;
      while ((t = w.nextNode())) {
        for (var i = 0; i < t.data.length; i++) {
          var ch = t.data.charAt(i);
          if (/\s/.test(ch)) { if (last) last.text += ' '; continue; }
          rg.setStart(t, i); rg.setEnd(t, i + 1);
          var r = rg.getBoundingClientRect();
          if (!r || (!r.width && !r.height)) continue;
          var cy = (r.top + r.bottom) / 2, ln = null;
          for (var k = 0; k < lines.length; k++) if (cy >= lines[k].top && cy <= lines[k].bottom) { ln = lines[k]; break; }
          if (!ln) { ln = { top: r.top, bottom: r.bottom, left: r.left, text: '', base: null }; lines.push(ln); }
          ln.left = Math.min(ln.left, r.left);
          ln.text += ch;
          if (ln.base == null && UR_LETTER.test(ch)) ln.base = r.top + asc;
          last = ln;
        }
      }
      lines.forEach(function (ln) { ln.text = ln.text.replace(/\s+$/, ''); });
      return lines;
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
          skipInstrBtn(v),
        ]),
        oneCell(p.show != null ? p.show : p.target, t, null),
        coachSays(p),
      ], [gatedBtn(v, C.next, function () {
        busy = true;
        var k = keyOf(runner.view());
        var tapAt = Date.now();
        // r8_practice_autoplay: the answer was said on arrival (the chip says it again), so Next just goes on
        (p.role === 'example' || autoAnswer(t, p) ? Promise.resolve() : capped(sayChain(modelOf(p)), 7000)).then(function () {
          busy = false;
          if (!alive || keyOf(runner.view()) !== k) return;
          runner.practiceAnswer(p.target);
          if (r10Next && runner.view().phase === 'ready') practiceEndAt = tapAt;
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
      var asked = compText(it, t);
      var mic = h('div', { class: 'sae-mic sa-mic' + (on ? ' is-on' : ''), 'aria-hidden': 'true' }, [h('span', { text: '🎤' })]);
      // r9_comp_text: the written question first, then Jugnu, the replay and the mic on one row (all in view on a phone)
      return screen(v, 'sae-run sae-run-oral' + (compWait(t) ? ' is-r8-wait' : '') + (asked ? ' is-r9-q' : ''), [
        h('p', { class: 'sae-task-tag', text: tx(t.title) }),
        asked,
        h('div', { class: 'sae-row' }, [jugnu('idle', true), replayBtn(function () { sayItem(it, t); }), asked ? mic : null]),
        asked ? null : coachSays(it),
        /^mental_/.test(t.subtask || '') && shownOf(it) != null ? labelOf(it, t) : null,
        asked ? null : mic,
        hintOf(t) ? hintEl(t, 'sae-sub') : h('p', { class: 'sae-sub', text: C.say_answer }),
      ], (compWait(t) ? [stuckEl()] : []).concat(itemFoot(v, [btn(compWait(t) ? C.next : C.answered, function () {
        busy = true;
        runner.answer('spoken');
        later(function () { busy = false; draw(); }, PRESS_MS);
      }, compWait(t) ? 'sae-primary sa-next' : 'sae-primary')])));
    }

    // ---------- round 28 (sa_r28_mcq): the spoken multiple choice (SPEC B-3, B-4 FINAL, B-12 to B-14) ----------
    // Jugnu reads the question (taps ignored, then a 600 ms swallow), then the four answers, each card lit while its own
    // clip plays (the audio element's playing/ended events, never a timer off a duration), 400 ms apart. A tap during the
    // answers holds a choice (is-chosen) and the read-out goes on; a later tap moves it (changes). After the last answer:
    // promptDone() (the item's clock starts), every card ready, and 600 ms on the held choice stands (is-pressed 400 ms,
    // then runner.answer(index, meta)). No choice yet: the first tap selects and stands 600 ms later. Replay re-reads it
    // all and keeps the choice. Coach-led: Jugnu still reads; the coach sees the words folded.
    var MCQ_SWALLOW_MS = 600, MCQ_GAP_MS = 400, MCQ_SETTLE_MS = 600, MCQ_PRESS_MS = 400, MCQ_WARM_MS = 5000;
    function isMcq(t) { return r28Mcq && !!t && t.kind === 'mcq'; }
    // Keep these word runs on one line: a teacher reads each as one unit (a name, an honorific, a paired or echo
    // compound), and on a phone the MCQ text could wrap inside one. An explicit list, never a suffix rule (a word
    // ending in «ئے» is also a verb such as «گئے»). The words, the shown text and so the clip key are unchanged.
    var MCQ_NOWRAP_RUNS = [
      ['دریائے', 'جہلم'],
      ['مٹھو', 'میاں'],
      ['ٹَیں', 'ٹَیں'],
      ['دانہ', 'پانی'],
      ['رنگ', 'برنگے'],
      ['جانور', '/پرندوں'], // the slash token stays with the word before it, never at a line start
    ];
    /** An MCQ text as its nodes: each listed run in ONE white-space:nowrap span; the text content byte-identical. */
    function mcqRuns(text) {
      var parts = String(text).split(/(\s+)/); // words at even indexes, the whitespace between them at odd ones
      var out = [], buf = '';
      for (var i = 0; i < parts.length; i += 2) {
        var n = 0;
        for (var r = 0; r < MCQ_NOWRAP_RUNS.length && !n; r++) {
          var run = MCQ_NOWRAP_RUNS[r], ok = true;
          for (var k = 0; k < run.length && ok; k++) ok = parts[i + 2 * k] === run[k];
          if (ok) n = run.length;
        }
        if (!n) { buf += parts[i] + (i + 1 < parts.length ? parts[i + 1] : ''); continue; }
        if (buf) out.push(buf);
        var w = h('span', { class: 'sae-nowrap', text: parts.slice(i, i + 2 * n - 1).join('') });
        w.style.whiteSpace = 'nowrap';
        out.push(w);
        i += 2 * (n - 1);
        buf = i + 1 < parts.length ? parts[i + 1] : '';
      }
      if (buf) out.push(buf);
      return out;
    }
    function mcqNow() { return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now(); }
    function mcqState(it, practice) {
      if (!mcq || mcq.item !== it.id) {
        mcq = { item: it.id, practice: !!practice, phase: 'listening', lit: -1, last_lit: -1, chosen: null, first_at: null,
          at_option: null, tap_ms: null, changes: 0, replays: 0, reads: 0, run: 0, read_end: null, settle: null };
      }
      return mcq;
    }
    function mcqReadingPhase(S) { return S.phase === 'listening' || S.phase === 'options'; }
    /** Lead ruling (B.3): after the first full read-out the cards never lock; only the first read is a locked one. */
    function mcqLocked(S) { return mcqReadingPhase(S) && S.read_end == null; }
    /** A card's state classes (B.3): waiting (dimmed) → speaking (lit) → ready → chosen (held) → pressed. */
    function mcqCls(c, S, i) {
      var chosen = S.chosen === i, locked = mcqLocked(S);
      c.classList.toggle('is-waiting', locked && !chosen && S.lit !== i);
      c.classList.toggle('is-speaking', S.lit === i);
      c.classList.toggle('is-ready', !locked && !chosen);
      c.classList.toggle('is-chosen', chosen);
      c.classList.toggle('is-pressed', chosen && S.phase === 'pressed');
      c.setAttribute('aria-pressed', chosen ? 'true' : 'false');
    }
    function mcqPaint() {
      var S = mcq;
      var box = S ? el.querySelector('.sae-mcq') : null;
      if (!box || box.getAttribute('data-item') !== S.item) return;
      box.classList.toggle('sae-mcq-listening', S.phase === 'listening' && S.read_end == null);
      Array.prototype.forEach.call(box.querySelectorAll('.sae-mcq-opt'), function (c, i) { mcqCls(c, S, i); });
      var rb = box.querySelector('.sae-mcq-replay');
      if (rb) rb.disabled = S.phase !== 'open';
      var j = box.querySelector('.sae-mcq-jugnu');
      if (j) j.classList.toggle('is-talking', mcqReadingPhase(S));
    }
    /** One line of the read-out, clip only (B-17: never the phone's voice, never a silent stand-in; a lost clip rejects);
     *  an option's card (k ≥ 0) is lit from its clip's playing to its ended, never unless the clip reached playing. */
    function mcqLine(S, k, textObj, clip, live) {
      if (!clip) return Promise.reject(new Error('no clip'));
      var p = say(null, clip, true, { clip_only: true });
      if (k < 0 && !mcqProbe) return p; // the stem has no card: it is followed only for the probe's hl 0 line
      var seen = null, on = false, fr = null, done = false;
      function light(a, b) {
        if (on === b || !live()) return;
        on = b;
        if (k >= 0) {
          S.lit = b ? k : -1;
          if (b) S.last_lit = k;
          mcqPaint();
        }
        // eslint-disable-next-line no-console
        if (mcqProbe) { try { console.debug('hl', k + 1, a ? (+a.currentTime || 0) : null); } catch (e) { /* no console */ } }
      }
      function step() {
        fr = null;
        if (done || !live()) return;
        var a = null;
        try { a = speakFn.audio(); } catch (e) { a = null; }
        if (a && a !== seen) {
          seen = a;
          var el2 = a;
          el2.addEventListener('playing', function () { if (!done) light(el2, true); });
          el2.addEventListener('ended', function () { if (seen === el2) light(el2, false); });
          if (el2.paused === false && !el2.ended && (+el2.currentTime || 0) > 0) light(el2, true);
        }
        fr = nextFrame(step);
      }
      if (typeof speakFn.audio === 'function') step();
      function off() { done = true; if (fr != null) cancelFrame(fr); light(seen, false); }
      return p.then(off, function (e) { off(); throw e; });
    }
    /** The read-out (the one place it lives): question, swallow, the four answers, then the answer window. */
    function readOut(it, t, o) {
      o = o || {};
      var S = mcqState(it, runner.view().phase === 'practice');
      if (S.phase === 'pressed' || S.phase === 'done') return Promise.resolve();
      if (S.reads > 0 && mcqReadingPhase(S)) return Promise.resolve(); // one read-out at a time
      if (o.replay && S.reads > 0) {
        if (!o.child && S.chosen != null) return Promise.resolve(); // the auto replay is for a child who has not chosen
        S.replays++;
      }
      S.reads++;
      // a re-read after the first full read-out: the runner's clocks wait for its end (both count from the last play)
      if (S.read_end != null && !S.practice && typeof runner.replayStart === 'function') runner.replayStart();
      var tok = ++S.run, g = gen;
      function live() { return alive && mcq === S && S.run === tok && g === gen; }
      if (S.settle != null) { clearTimeout(S.settle); S.settle = null; }
      S.phase = 'listening'; S.lit = -1; S.last_lit = -1;
      mcqPaint();
      var qClip = (it.prompt && it.prompt.audio) || it.prompt_audio || null;
      var clips = [qClip].concat(Array.isArray(it.option_audio) ? it.option_audio : []);
      var first = S.reads === 1;
      // B-17: before a question's first read-out its five clips are warmed; it begins when they are ready, at most 5 s
      var p = (first ? mcqWarm(clips) : Promise.resolve())
        .then(function () { if (live()) return mcqLine(S, -1, null, qClip, live); })
        .then(function () { if (live()) return delay(MCQ_SWALLOW_MS); });
      (it.options || []).forEach(function (opt, k, all) {
        p = p.then(function () {
          if (!live()) return null;
          S.phase = 'options';
          mcqPaint();
          var clip = Array.isArray(it.option_audio) ? it.option_audio[k] || null : null;
          return mcqLine(S, k, null, clip, live).then(function () { if (live() && k < all.length - 1) return delay(MCQ_GAP_MS); });
        });
      });
      return p.then(function () {
        if (!live()) return;
        S.read_end = mcqNow();
        if (S.first_at != null && S.tap_ms == null) S.tap_ms = Math.round(S.first_at - S.read_end);
        if (!S.practice && runner.promptDone) runner.promptDone(); // B-13: the item's clock starts at the end of the last answer
        S.phase = 'open';
        S.lit = -1;
        if (S.chosen != null) mcqSettle(S);
        draw();
      }, function () {
        // B-17: a clip lost after the voice's retry. The first read-out: the question is unavailable (never scored) and
        // the next one shows. A replay: logged lost, the question stays open with its cards. A practice item: the
        // child can still answer (the practice is never scored).
        if (!live()) return;
        S.lit = -1;
        var v = runner.view();
        if (first && !S.practice && typeof runner.clipLost === 'function' && v.item && v.item.id === S.item) {
          runner.clipLost(S.item, 'prompt');
          mcq = null;
          draw();
          return;
        }
        if (!S.practice && typeof runner.clipLost === 'function') runner.clipLost(S.item, 'replay');
        S.read_end = mcqNow();
        if (!S.practice && runner.promptDone) runner.promptDone(); // the clocks restart (a lost replay paused them)
        S.phase = 'open';
        if (S.chosen != null) mcqSettle(S);
        draw();
      });
    }
    /** B-17: the page's preload (the voice's, via opts.preload(list, ms)) for a question's clips, at most MCQ_WARM_MS. */
    function mcqWarm(list) {
      var pre = typeof opts.preload === 'function' ? opts.preload : null;
      var keys = list.filter(Boolean);
      if (!pre || !keys.length) return Promise.resolve();
      return capped(Promise.resolve().then(function () { return pre(keys, MCQ_WARM_MS); }), MCQ_WARM_MS);
    }
    function mcqTap(i) {
      var S = mcq;
      // the first read of the question ignores taps; after the first full read-out a tap always counts (lead ruling, B.3)
      var canTap = !!S && (S.phase === 'options' || S.phase === 'open' || (S.phase === 'listening' && S.read_end != null));
      if (!alive || busy || !S || !canTap || S.chosen === i) return;
      if (mcqFoldOpen(S.item) || mcqGhost()) return; // B.3: the open coach fold is modal: no answer while it is open
      if (mcqLocked(S) && clipStalled()) return; // the first read-out stalled mid-clip: the tap is dropped, never held
      if (S.chosen == null) {
        S.first_choice = i; // the first card tapped (data only; the choice that stands is scored)
        S.first_at = mcqNow();
        // 0 = the stem (a replayed question, or the swallow before option 1 lights); 1–4 = the option last lit
        S.at_option = S.phase === 'options' ? (S.last_lit < 0 ? 0 : S.last_lit + 1) : S.phase === 'listening' ? 0 : null;
        if (S.phase === 'open') S.tap_ms = Math.round(S.first_at - S.read_end);
      } else S.changes++;
      S.chosen = i;
      S.since_fold_ms = mcqGG.since(S.item); // the tap that stands: ms since this question's fold closed, else null
      mcqPaint();
      if (S.phase === 'open') mcqSettle(S);
    }
    function mcqSettle(S) {
      if (S.settle != null) return;
      S.settle = later(function () { S.settle = null; mcqStand(S); }, MCQ_SETTLE_MS);
    }
    /** The choice stands (600 ms after the read-out ended, or after the first later tap): it is recorded at once (scored
     *  exactly then, SPEC B-4 c), the card shows is-pressed for 400 ms (B-5), then the next question. A practice choice
     *  goes to the practice's feedback after the press. */
    function mcqStand(S) {
      if (mcq !== S || S.phase !== 'open' || S.chosen == null) return;
      S.phase = 'pressed';
      busy = true; // the clock loop waits: the pressed card stays on screen
      mcqPaint();
      if (!S.practice) runner.answer(S.chosen, { tap_ms: S.tap_ms, chosen_at_option: S.at_option, changes: S.changes, replays: S.replays, since_fold_ms: S.since_fold_ms == null ? null : S.since_fold_ms, first_choice: S.first_choice });
      later(function () {
        busy = false;
        if (mcq !== S) return;
        S.phase = 'done';
        var v = runner.view();
        if (S.practice) { if (v.phase === 'practice' && v.practice) practicePick(v.practice, v.task, S.chosen); return; }
        draw();
      }, MCQ_PRESS_MS);
    }
    /** The replay button or Jugnu: only once the read-out has ended (and never while a replay runs). */
    function mcqReplay() {
      var S = mcq;
      if (!alive || busy || !S || S.phase !== 'open') return;
      if (mcqFoldOpen(S.item) || mcqGhost()) return; // B.3: the open coach fold is modal: no replay while it is open
      var v = runner.view();
      var it = S.practice ? v.practice : v.item;
      if (!it || it.id !== S.item) return;
      runner.log('replay', { task_id: v.task.id, item_id: it.id, value: 'child' });
      readOut(it, v.task, { replay: true, child: true });
    }
    /** Round 9 (row 31, SPEC B-7 in the practice): the practice passage is its own step: Jugnu plays its clip with the
     *  passage on the screen and NO answer cards; it ends at the clip's end + the 600 ms settle (or the coach's Next in
     *  the head row), never on a child's tap; then the question draws as the scored screen does (no passage on it, the
     *  fold = prompt + options). The guard: a passage with no clip key, or a clip lost at play time, has no step: the
     *  question draws with its own clips. practice_passage {task_id, item_id, ms, audio, by} once (delivery only; audio =
     *  the passage clip reached its end at least once). */
    function mcqPassKey(t, it) { return (t && t.id) + '|' + (it && it.id); }
    function mcqPassAudio(it) {
      var p = it && it.passage;
      return p && typeof p === 'object' && typeof p.audio === 'string' && p.audio ? p.audio : null;
    }
    /** The passage step is on show for this practice item (its clip key present and the step not yet ended). */
    function mcqPassOn(it, t) {
      return !!(it && it.passage && mcqPassAudio(it) && !mcqPassDone[mcqPassKey(t, it)]);
    }
    function mcqPractice(it, t) {
      if (!it || !it.passage || mcqPassDone[mcqPassKey(t, it)]) return readOut(it, t, {});
      if (!mcqPassAudio(it)) { mcqPassLog(t, it, 0, false, 'no_clip'); return readOut(it, t, {}); } // the guard: no step
      var P = { item: it.id, task: t.id, key: mcqPassKey(t, it), t0: mcqNow(), run: 0, playing: false, settle: null, heard: false };
      mcqPass = P;
      return mcqPassPlay(P);
    }
    function mcqPassLog(t, it, ms, audio, by) {
      var k = mcqPassKey(t, it);
      if (mcqPassDone[k]) return;
      mcqPassDone[k] = true;
      runner.log('practice_passage', { task_id: t.id, item_id: it.id, ms: ms, audio: audio, by: by });
    }
    function mcqPassPaint() {
      var P = mcqPass;
      var box = P ? el.querySelector('.sae-mcq-passage-step') : null;
      if (!box || box.getAttribute('data-item') !== P.item) return;
      var rb = box.querySelector('.sae-mcq-replay');
      if (rb) rb.disabled = P.playing;
      var j = box.querySelector('.sae-mcq-jugnu');
      if (j) j.classList.toggle('is-talking', P.playing);
    }
    function mcqPassPlay(P) {
      var v = runner.view(), it = v.practice;
      if (!it || it.id !== P.item) return Promise.resolve();
      var tok = ++P.run, g = gen;
      function live() { return alive && mcqPass === P && P.run === tok && g === gen; }
      if (P.settle != null) { clearTimeout(P.settle); P.settle = null; }
      P.playing = true;
      mcqPassPaint();
      return say(null, mcqPassAudio(it), true, { clip_only: true }).then(function () {
        if (!live()) return;
        P.playing = false;
        var first = !P.heard;
        P.heard = true; // the clip reached its end once: from now on the coach's Next (no Skip drawn) can end the step
        if (first && manual) draw(); else mcqPassPaint();
        P.settle = later(function () { P.settle = null; if (live()) mcqPassEnd(P, 'clip_end', true); }, MCQ_SETTLE_MS);
      }, function () {
        if (live()) mcqPassEnd(P, 'clip_lost', P.heard); // B-17's path: the step ends, the question draws; audio = the clip reached its end once
      });
    }
    function mcqPassEnd(P, by, audio) {
      if (mcqPass !== P) return;
      mcqPass = null;
      if (P.settle != null) { clearTimeout(P.settle); P.settle = null; }
      var v = runner.view();
      var it = v.practice;
      if (v.phase !== 'practice' || !it || it.id !== P.item) { mcqPassDone[P.key] = true; return; }
      mcqPassLog(v.task, it, Math.round(mcqNow() - P.t0), audio, by);
      draw();
      readOut(it, v.task, {});
    }
    /** The child's replay (or Jugnu) in the passage step: the passage's clip again, nothing else; never while it plays. */
    function mcqPassReplay() {
      var P = mcqPass;
      if (!alive || busy || !P || P.playing) return;
      if (mcqFoldOpen(P.item) || mcqGhost()) return;
      runner.log('replay', { task_id: P.task, item_id: P.item, value: 'child', what: 'passage' });
      mcqPassPlay(P);
    }
    /** Coach-led: what Jugnu reads, folded (the coach never reads it out; the key is not marked). */
    /** SPEC B-14 (extended), coach-led only: the coach's own line above the fold. Text only: never spoken, no clip. */
    function mcqCoachLine() {
      if (!manual) return null;
      return h('p', { class: 'sae-coach-says is-coach sae-mcq-coach-line', lang: lang, dir: lang === 'ur' ? 'rtl' : 'ltr', text: C.mcq_coach_line });
    }
    function mcqFoldOpen(itemId) { return manual && !!mcqFold && mcqFold.item === itemId; }
    function mcqGhost() { return mcqGG.on(); }
    /** B.3 (lead ruling): the coach's fold, modal while open. fold_open / fold_close are logged once per open and once
     *  per close (a redraw keeps it open and logs nothing; an item that ends under an open fold logs its close). */
    function mcqCoach(it, t) {
      if (!manual) return null;
      var tl = taskLang(t), d = dirOf(t);
      if (mcqFold && mcqFold.item !== it.id) {
        runner.log('fold_close', { task_id: mcqFold.task, item_id: mcqFold.item, by: 'item', card: null }); // every open has its close
        mcqFold = null;
      }
      var fd = h('details', { class: 'sae-coach-says is-coach is-app sae-mcq-coach', open: mcqFoldOpen(it.id) }, [
        h('summary', { text: C.coach_app }),
        // one box under the summary: on a coach-led phone it opens over the screen (sa.css), never pushing the cards
        h('div', { class: 'sae-mcq-coach-body' }, [
          h('p', { class: 'sae-say sae-coach-line', lang: tl, dir: d }, mcqRuns(tx(it.prompt))),
          h('ol', { class: 'sae-mcq-coach-opts', lang: tl, dir: d }, (it.options || []).map(function (x) { return h('li', null, mcqRuns(String(x))); })),
        ]),
      ]);
      fd.addEventListener('toggle', function () {
        if (fd.open === mcqFoldOpen(it.id)) return; // a redraw's own toggle, or the same state again: nothing changed
        mcqFold = fd.open ? { item: it.id, task: t.id } : null;
        if (fd.open) { runner.log('fold_open', { task_id: t.id, item_id: it.id }); return; }
        mcqGG.closed(it.id, t.id);
        var by = mcqFoldBy || { by: 'summary', card: null }; // the card key always present (null: no card under the close)
        mcqFoldBy = null;
        runner.log('fold_close', { task_id: t.id, item_id: it.id, by: by.by, card: by.card });
      });
      return fd;
    }
    /** B.3: with the fold open, the first tap anywhere on the screen (a card, the question, the overlay, the replay,
     *  Jugnu, the Next, blank space) only closes it; the summary keeps its own toggle. The read-out goes on. */
    function mcqModal(s) {
      s.addEventListener('click', function (e) {
        var fd = s.querySelector('details.sae-mcq-coach');
        var sum = fd ? fd.querySelector('summary') : null;
        var onSum = !!(sum && e.target && sum.contains(e.target));
        // the double tap's second half (within GHOST_MS of the close) is swallowed: it never answers or skips
        if (!onSum && !(fd && fd.open) && mcqGG.swallow(e)) return; // never scored
        if (!fd || !fd.open || onSum) return;
        var card = e.target && e.target.closest ? e.target.closest('.sae-mcq-opt') : null;
        mcqFoldBy = { by: 'tap', card: card ? Number(card.getAttribute('data-index')) : null };
        fd.open = false;
        var ev = document.createEvent('Event');
        ev.initEvent('toggle', false, false);
        fd.dispatchEvent(ev);
        e.stopImmediatePropagation();
        e.preventDefault();
      }, true);
    }
    /** A screen whose four cards and question do not fit: the question card clamps to two lines first (B.3). */
    function mcqFit(s) {
      if (!s || !s.isConnected || typeof window === 'undefined') return;
      // coach-led phone (sa.css round 5): a one-line Urdu question has the room for its first line's whole ascender
      var q = manual ? s.querySelector('.sae-mcq-q[lang=ur]') : null;
      if (q && typeof document.createRange === 'function') {
        var rg = document.createRange();
        rg.selectNodeContents(q);
        var tops = {};
        Array.prototype.forEach.call(rg.getClientRects ? rg.getClientRects() : [], function (r) { if (r.width || r.height) tops[Math.round(r.top)] = 1; });
        q.classList.toggle('is-one-line', Object.keys(tops).length === 1);
        // the lines are counted in the Nastaliq face: a draw before it has loaded counts again once it has
        if (document.fonts && document.fonts.status !== 'loaded' && document.fonts.ready && !s.__mcqFontWait) {
          s.__mcqFontWait = true;
          document.fonts.ready.then(function () { if (alive) mcqFit(s); }, function () {});
        }
      }
      var doc = document.documentElement;
      if (doc && window.innerHeight && doc.scrollHeight > window.innerHeight + 1) s.classList.add('is-clamp');
    }
    function sMcq(v, it, fb, practice) {
      var t = v.task, tl = taskLang(t), d = dirOf(t);
      if (practice && !fb && mcqPassOn(it, t)) return sMcqPassage(v, it);
      var S = mcq && mcq.item === it.id ? mcq : { phase: 'listening', lit: -1, chosen: null };
      var reading = mcqReadingPhase(S);
      var cardsEl = h('div', { class: 'sae-mcq-opts', lang: tl, dir: d }, (it.options || []).map(function (o, i) {
        var b = h('button', { class: 'sae-mcq-opt sa-tile', type: 'button', 'data-index': String(i), lang: tl, dir: d }, [h('span', { class: 'sae-mcq-ink' }, mcqRuns(String(o)))]);
        if (fb) {
          b.disabled = true;
          if (Number(fb.value) === i) b.classList.add(fb.res.ok ? 'is-right' : 'is-tried');
          if (!fb.res.ok && !fb.res.retry && i === it.target_index) b.classList.add('is-right', 'is-shown');
        } else {
          b.addEventListener('click', function () { mcqTap(i); });
          mcqCls(b, S, i);
        }
        return b;
      }));
      var rb = h('button', { class: 'sae-replay sa-replay sae-mcq-replay', type: 'button', 'aria-label': C.replay_question, title: C.replay_question, onclick: mcqReplay }, [h('span', { 'aria-hidden': 'true', text: '🔁' })]);
      rb.disabled = !!fb || S.phase !== 'open';
      var j = jugnu(reading ? 'hello' : 'idle', true);
      j.classList.add('sae-mcq-jugnu');
      if (reading) j.classList.add('is-talking');
      j.addEventListener('click', mcqReplay);
      var next = null;
      if (!practice) {
        shownOffer = !!v.offer_next;
        if (v.offer_next && !reading && S.chosen == null) next = btn(manual ? C.next : C.next_go, function () { runner.skip(); draw(); }, 'sae-secondary sa-next sae-mcq-next' + (manual ? '' : ' sae-mcq-next-auto'));
      }
      // B.3 fit, both modes: Next sits in the head row beside the replay (laid over the row's end, out of the flow),
      // never in the foot, so its arrival never moves the cards or the replay — in RDF auto the Urdu foot button put
      // three of four options under the fold on a 360×640 phone
      var headNext = next;
      // round 8 (row 30): the coach's Skip instructions (r9, coach-led practice) takes the practice chip's place in the
      // head row, so Jugnu, the replay and the Skip keep one row at the served font on a 360 px phone; the practice
      // coach line already tells the coach it is practice
      var skipB = practice ? skipInstrBtn(v) : null;
      var s = screen(v, 'sae-run sae-mcq' + (practice ? ' sae-mcq-practice' : '') + (S.phase === 'listening' && S.read_end == null && !fb ? ' sae-mcq-listening' : ''), [
        t.title ? h('p', { class: 'sae-task-tag', text: tx(t.title) }) : null,
        h('div', { class: 'sae-row sae-mcq-head' }, [j, practice && !skipB ? h('span', { class: 'sae-chip', text: C.practice }) : null, rb, skipB, headNext]),
        mcqCoachLine(),
        mcqCoach(it, t),
        h('div', { class: 'sae-mcq-q', lang: tl, dir: d }, mcqRuns(tx(it.prompt))),
        cardsEl,
        practice ? feedbackLine(fb) : null,
      ], practice ? null : itemFoot(v, []));
      s.setAttribute('data-item', it.id);
      if (manual) mcqModal(s);
      Promise.resolve().then(function () { mcqFit(s); });
      return s;
    }
    /** Round 9 (row 31): the practice passage's step: Jugnu, the passage whole, no answer cards. The head row as the
     *  question's (Jugnu, the chip or the coach's Skip, the replay = the passage again); coach-led: the coach's line and
     *  the closed fold as on the question screen, and the coach's Next in the head when no Skip is drawn. */
    function sMcqPassage(v, it) {
      var t = v.task, tl = taskLang(t), d = dirOf(t);
      var P = mcqPass && mcqPass.item === it.id ? mcqPass : { playing: true };
      var rb = h('button', { class: 'sae-replay sa-replay sae-mcq-replay', type: 'button', 'aria-label': C.replay_question, title: C.replay_question, onclick: mcqPassReplay }, [h('span', { 'aria-hidden': 'true', text: '🔁' })]);
      rb.disabled = !!P.playing;
      var j = jugnu(P.playing ? 'hello' : 'idle', true);
      j.classList.add('sae-mcq-jugnu');
      if (P.playing) j.classList.add('is-talking');
      j.addEventListener('click', mcqPassReplay);
      var skipB = skipInstrBtn(v);
      // the coach's Next: coach-led, no Skip drawn, and only once the clip has ended (a stalled settle, a replay)
      var next = manual && !skipB && P.heard ? btn(C.next, function () { if (mcqPass && mcqPass.item === it.id) mcqPassEnd(mcqPass, 'coach_next', !!mcqPass.heard); }, 'sae-secondary sa-next sae-mcq-next') : null;
      var s = screen(v, 'sae-run sae-mcq sae-mcq-practice sae-mcq-passage-step', [
        t.title ? h('p', { class: 'sae-task-tag', text: tx(t.title) }) : null,
        h('div', { class: 'sae-row sae-mcq-head' }, [j, !skipB ? h('span', { class: 'sae-chip', text: C.practice }) : null, rb, skipB, next]),
        mcqCoachLine(),
        mcqCoach(it, t),
        h('p', { class: 'sae-mcq-passage', lang: tl, dir: d, text: tx(it.passage) }),
      ], null);
      s.setAttribute('data-item', it.id);
      if (manual) mcqModal(s);
      return s;
    }
    function sRunMcq(v) { return sMcq(v, v.item, null, false); }

    /** r9_comp_text: a story question in writing for the child (Jugnu still says it on arrival), in the task's language.
     *  Only the story's questions: a listening question written down would turn listening into reading. In RDF manual
     *  these are the coach's words too, so the coach's own copy gives way (one copy on the screen); a coach who reads
     *  the question keeps the cue to read it aloud. */
    function compText(it, t) {
      if (!r9Comp || !t || t.subtask !== 'reading_comprehension' || !itemWords(it)) return null;
      var said = it.prompt && typeof it.say !== 'string' ? (it.say || it.prompt) : null;
      var q = h('p', { class: 'sae-r9-q', lang: taskLang(t), dir: dirOf(t) }, [hlText(itemWords(it), said)]);
      if (manual && !appAsks) return h('div', { class: 'sae-r9-qbox' }, [h('p', { class: 'sae-chip', text: C.coach_read }), q]);
      return q;
    }

    // ---------- session gates ----------
    function tileBtn(label, onclick, cls) {
      return h('button', { class: 'sae-opt sa-tile sae-choice ' + (cls || ''), type: 'button', onclick: function (e) { if (!busy) onclick(e); } }, [label]);
    }
    /** Game mic check (RULING #13): a 2-s probe played back, then "did you hear yourself?". */
    function sMicCheck(v) {
      if (micCard) return sMicCard(v);
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
    /**
     * Round 28, O-115 (r28_mic_unknown, coach mode): the coach's mic card, on a phone with no stored check. «مائیک آزمائیں»
     * records 2 s and plays it back. A pass needs the probe's level above the floor (sa-mic.js FLOOR, unrounded) AND the
     * coach's «آواز سنائی دی»; at or under the floor the card says «آواز نہیں آئی» and offers no "heard". A phone with no
     * analyser passes on "heard" alone (unmeasured). «مائیک کے بغیر چلیں» shows after one try; in RDF auto it is held
     * like the coach's other controls, so a child's tap never takes it. The card shows once a run.
     */
    function sMicCard(v) {
      var st = micSt || (micSt = { stage: 'idle', tries: 0 });
      var without = st.tries > 0 && st.stage !== 'rec' ? withoutBtn() : null;
      if (st.stage === 'ask') {
        var pr = st.probe || {};
        var heardOk = pr.ok && !pr.denied;
        return screen(v, 'sae-miccheck is-coach is-ask' + (pr.denied ? ' is-denied' : ''), [
          // a blocked microphone is not a quiet one: the coach is told how to allow it. That line takes the heading's
          // place, so it and «دوبارہ کوشش کریں» sit above the fixed «مائیک کے بغیر چلیں» on a 360-wide phone
          pr.denied ? h('p', { class: 'sae-sub sae-micu-denied', text: C.micu_denied })
            : h('h1', { class: 'sae-h1', text: heardOk ? C.micu_ask : C.micu_none }),
          h('div', { class: 'sae-pics' }, [
            heardOk ? tileBtn(C.micu_heard, function () { micCardDone(true); }, 'is-yes') : null,
            tileBtn(C.micu_again, function () { micSt = { stage: 'idle', tries: st.tries }; probe(); }, 'is-again'),
          ]),
        ], [without], true);
      }
      var rec = st.stage === 'rec';
      var tryBtn = h('button', { class: 'sae-btn sae-primary sae-micu-try', type: 'button', onclick: function () { if (!busy && !rec) probe(); } },
        [h('span', { class: 'sae-micu-glyph', 'aria-hidden': 'true', text: '🎤' }), ' ', rec ? C.mic_speak : C.micu_try]);
      return screen(v, 'sae-miccheck is-coach', [
        h('h1', { class: 'sae-h1', text: C.micu_head }),
        tryBtn,
      ], [without], true);
    }
    function withoutBtn() {
      if (manual) return btn(C.micu_without, function () { micCardDone(false); }, 'sae-micu-without');
      // RDF auto: pressed and held, as the coach's corner
      var b = h('button', { class: 'sae-btn sae-micu-without is-hold', type: 'button', 'aria-label': C.hold }, [C.micu_without]);
      var t = null;
      function cancel() { if (t) { clearTimeout(t); t = null; } b.classList.remove('is-holding'); }
      b.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        cancel();
        b.classList.add('is-holding');
        t = later(function () { t = null; b.classList.remove('is-holding'); micCardDone(false); }, HOLD_MS);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (n) { b.addEventListener(n, cancel); });
      b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      return b;
    }
    /** pass: the coach heard it back and the level was above the floor (or not measurable). */
    function micCardDone(pass) {
      var pr = (micSt && micSt.probe) || {};
      var unmeasured = pr.measured === false && !pr.denied;
      micSt = null;
      if (pr.denied) runner.micChecked(false, null, 'denied');
      else runner.micChecked(!!pass, unmeasured ? null : (typeof pr.peak === 'number' ? pr.peak : 0), unmeasured ? 'unmeasured' : 'auto');
      draw();
    }
    function probe() {
      var tries = micSt && micSt.tries || 0;
      // the coach's card never fails on its own: no microphone to open is a try that heard nothing
      var denied = function () { micSt = { stage: 'ask', tries: tries + 1, probe: { ok: false, denied: true, measured: false, peak: 0 } }; draw(); };
      if (typeof opts.micProbe !== 'function') { if (micCard) denied(); else micDone(false, 0); return; }
      micSt = { stage: 'rec', tries: tries };
      draw();
      var p;
      try { p = Promise.resolve(opts.micProbe()); } catch (e) { p = Promise.reject(e); }
      p.then(function (r) {
        if (!alive || !micSt) return;
        r = r || {};
        micSt = { stage: 'ask', probe: { ok: !!r.ok, rms: typeof r.rms === 'number' ? r.rms : 0 } };
        if (micCard) {
          micSt.tries = tries + 1;
          micSt.probe.peak = typeof r.peak === 'number' ? r.peak : 0;
          micSt.probe.measured = r.measured !== false && !r.denied;
          micSt.probe.denied = r.denied === true;
          // a phone with no analyser: the probe passes unmeasured, and "heard" alone decides
          if (r.denied) micSt.probe.ok = false;
        }
        draw();
        // the card asks "did you hear it?" only when the screen offers "heard" (a level above the floor)
        playBack(r.url).then(function () { if (alive && micSt && micSt.stage === 'ask' && (!micCard || (micSt.probe.ok && !micSt.probe.denied))) say(line('mic_check_ask') || { en: COPY.en.mic_ask, ur: COPY.ur.mic_ask }); });
      }, function () { if (!alive) return; if (micCard) denied(); else micDone(false, 0); });
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
          r9Skip && (v.phase === 'instruction' || v.phase === 'practice')
            ? h('button', { class: 'sae-btn sae-secondary is-coach sae-r9-skip', type: 'button', onclick: function () { skipInstr(); closeCoach(); } }, [C.skip_instr]) : null,
          canEnd ? btn(r28EndTask ? C.end_task_r28 : C.end_task, function () { hold = null; listening = null; runner.coachEnd(); closeCoach(); }, 'sae-secondary sae-danger') : null,
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

    // ---------- round 9, item 7 (r9_scroll_cue): "scroll down" on a screen that runs past the bottom ----------
    var R9_SAY_GAP_MS = 400; // the cue line waits this long after Jugnu's last word on the screen
    /** The cue at the top of the screen's foot (above Next), else at its end; hidden until scrollCheck finds more below.
     *  The story keeps its own arrow (.sae-more): no second cue there. */
    function scrollCueOn(v, phase, s) {
      scrollCueOff();
      if (!s || s.querySelector('.sae-more')) return;
      var c = h('div', { class: 'sae-r9-scroll', role: 'note', hidden: '' }, [
        h('span', { class: 'sae-r9-scroll-ico', 'aria-hidden': 'true', text: '↓' }),
        h('span', { class: 'sae-r9-scroll-w', text: C.r9_scroll }),
      ]);
      var foot = null;
      for (var i = 0; i < s.children.length; i++) if (s.children[i].classList.contains('sae-foot')) foot = s.children[i];
      if (foot) foot.insertBefore(c, foot.firstChild);
      else s.appendChild(c);
      var sc = scrollCue = { s: s, el: c, ro: null, phase: phase, task: v.task || null, type: phase + (phase === 'running' && v.task ? ':' + v.task.mode : ''), asked: false };
      // a screen can grow after it is drawn (a picture, the Urdu font): watch its size where the browser can
      if (typeof window !== 'undefined' && typeof window.ResizeObserver === 'function') {
        try {
          sc.ro = new window.ResizeObserver(function () { if (alive && scrollCue === sc) scrollCheck(); });
          sc.ro.observe(s);
          var body = s.querySelector('.sae-body');
          if (body) { sc.ro.observe(body); Array.prototype.forEach.call(body.children, function (k) { sc.ro.observe(k); }); }
        } catch (e) { sc.ro = null; }
      }
      if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (alive && scrollCue === sc) scrollCheck(); }, function () {});
      scrollCheck();
      later(scrollCheck, 0);
    }
    function scrollCueOff() {
      var sc = scrollCue;
      scrollCue = null;
      if (sc && sc.ro) { try { sc.ro.disconnect(); } catch (e) { /* gone */ } }
    }
    /** More below in n (a scroll box): it overflows and its bottom is not in view. */
    function moreIn(n) { return !!n && n.scrollHeight > n.clientHeight + 4 && n.scrollTop + n.clientHeight < n.scrollHeight - 8; }
    /** sa_r28_cue_guard: moreIn on n's height less `less` px (the shown cue's own box). */
    function moreLess(n, less) { var sh = n ? n.scrollHeight - less : 0; return !!n && sh > n.clientHeight + 4 && n.scrollTop + n.clientHeight < sh - 8; }
    /** sa_r28_cue_guard: what the shown cue adds to the screen's height: its box, its margins and its parent's gap. */
    function cueBox(c) {
      if (c.hidden) return 0;
      var px = function (v) { var n = parseFloat(v); return isFinite(n) ? n : 0; };
      var add = c.offsetHeight || 0;
      try {
        var cs = getComputedStyle(c);
        add += px(cs.marginTop) + px(cs.marginBottom);
        var p = c.parentNode, ps = p && p.nodeType === 1 ? getComputedStyle(p) : null;
        var col = ps && ((/flex/.test(ps.display) && /^column/.test(ps.flexDirection)) || /grid/.test(ps.display));
        if (col && p.children.length > 1) add += px(ps.rowGap || ps.gap);
      } catch (_) { /* no styles: the box alone */ }
      return add;
    }
    /** The cue shown while more of the screen is below, in its body (when the body scrolls itself) or the page. */
    function scrollCheck() {
      var sc = scrollCue;
      if (!alive || !sc || !sc.el.isConnected) return;
      var body = sc.s.querySelector('.sae-body');
      var oy = '';
      if (body) { try { oy = getComputedStyle(body).overflowY; } catch (_) { oy = ''; } }
      var more = ((oy === 'auto' || oy === 'scroll') && moreIn(body)) || moreIn(document.scrollingElement || document.documentElement);
      if (r28CueGuard && !sc.el.hidden) {
        var less = cueBox(sc.el);
        more = ((oy === 'auto' || oy === 'scroll') && moreLess(body, less)) || moreLess(document.scrollingElement || document.documentElement, less);
      }
      if (sc.el.hidden === !more) return;
      sc.el.hidden = !more;
      if (more) scrollSay(sc);
    }
    /** Never on a screen whose recording may be open (a reading, a spoken answer, the mic checks), nor on one that
     *  moves itself on or is Jugnu's own opening; never in a coach-led run (the coach speaks there). */
    function scrollMaySpeak(sc) {
      if (manual || recording || oralRec) return false;
      if (/^(battery_intro|audio_check|mic_check|oral_practice|handover|refused|task_end|listen|silence_reminder)$/.test(sc.phase)) return false;
      if (sc.phase === 'running' && sc.task && (sc.task.mode === 'record' || sc.task.mode === 'oral')) return false;
      return true;
    }
    /** lines.r9_scroll_cue (when the battery has it): said once per screen type, after the screen's own words. */
    function scrollSay(sc) {
      var ln = line('r9_scroll_cue');
      if (!ln || sc.asked || scrollSaid[sc.type] || !scrollMaySpeak(sc)) return;
      sc.asked = true;
      (function wait() {
        var p = talk;
        Promise.resolve(p).then(function () {
          later(function () {
            if (scrollCue !== sc || !sc.el.isConnected) return;
            if (talkN > 0 || talk !== p) { wait(); return; } // more words started meanwhile: after them
            if (sc.el.hidden || scrollSaid[sc.type] || !scrollMaySpeak(sc)) { sc.asked = false; return; }
            scrollSaid[sc.type] = true;
            say(ln);
          }, R9_SAY_GAP_MS);
        });
      })();
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
      // round 28: the letter-sound picker's clips start loading as soon as its part begins
      if (isPick(t) && ['instruction', 'practice', 'ready', 'running'].indexOf(v.phase) >= 0) { pickReady(t); pickTimesFor(t); }
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
        if (typeof opts.micProbe !== 'function' && !micCard) later(function () { if (runner.view().phase === 'mic_check') { micSt = null; runner.micChecked(false, 0); draw(); } }, 0);
        else say(line('mic_check') || { en: COPY.en.mic_say, ur: COPY.ur.mic_say });
      } else if (v.phase === 'oral_practice') {
        var gp = gen;
        say(line('oral_practice') || { en: COPY.en.oral_try, ur: COPY.ur.oral_try }).then(function () { if (alive && gp === gen) startMeter(); });
      } else if (v.phase === 'keypad_warmup') say(line('keypad_warmup') || { en: COPY.en.kp_warm, ur: COPY.ur.kp_warm });
      else if (v.phase === 'instruction' && manual) {
        runner.log('coach_brief', { task_id: t.id });
        if (jugnuInstructs(t)) gateOn(keyOf(v), playIntroAll(t)); // round 28: Jugnu instructs the child (the sound)
        else say(copyLine('coach_will_instruct'), null, true);
      } else if (v.phase === 'instruction') gateOn(keyOf(v), playIntroAll(t));
      else if (v.phase === 'practice' && v.practice) {
        var first = t.practice.indexOf(v.practice) === 0;
        var k0 = keyOf(v);
        var said = sayChain([first && s.practice_intro && !manual ? [s.practice_intro] : null]).then(function () {
          if (!alive || lastKey !== k0 || hold) return null;
          // round 28: the letter-sound picker's example is modelled (the sound, the model line, then Next)
          if (isPick(t) && v.practice.role === 'example') {
            var ex = v.practice;
            return pickReady(t).then(function () { if (alive && lastKey === k0 && !hold) return pickModel(ex, t, k0); });
          }
          if (t.mode === 'record' && v.practice.role === 'example') return sayChain(modelOf(v.practice));
          // r8_practice_autoplay: the prompt (unless the task reads it only on replay), then the answer, no tap needed
          if (autoAnswer(t, v.practice)) {
            var gp2 = gen;
            return (t.say_on === 'replay' ? Promise.resolve() : sayItem(v.practice, t)).then(function () {
              if (alive && gp2 === gen && lastKey === k0) return sayChain(modelOf(v.practice));
            });
          }
          if (isMcq(t)) return mcqPractice(v.practice, t); // sa_r28_mcq: the passage's step (row 31), then the same read-out as the scored questions
          if (!(t.mode === 'record' && t.say_on === 'replay')) return sayItem(v.practice, t);
          return null;
        });
        if (t.mode === 'record') gateOn(k0, said); // the spoken practice's Next (a tap practice has none)
      } else if (v.phase === 'ready') {
        var intro = s.test_intro && !(r12IntroOnce && s.test_intro.once === true && introSaid) ? s.test_intro : null;
        var ji = jugnuInstructs(t);
        if (intro && intro.once === true && (!manual || ji)) introSaid = true;
        gateOn(keyOf(v), sayChain(manual && !ji ? [] : [intro ? [intro, undefined, ji] : null, s.begin ? [s.begin, undefined, ji] : null]));
      }
      else if (v.phase === 'running' && v.item) {
        reachRead(v, t, 'draw'); // round 28: the picker's and the story question's cards a child can reach
        if (isPick(t)) {
          // round 28: the sound 300 ms after the item shows (coach-led too); the wait for replay / Next starts at its end
          var kp = keyOf(v), gp3 = gen, itp = v.item;
          later(function () {
            if (gp3 !== gen || keyOf(runner.view()) !== kp) return;
            sayClip(itp, t, 'prompt').then(function (ok) { if (ok && alive && gp3 === gen && lastKey === kp && runner.promptDone) runner.promptDone(); });
          }, PICK_CLIP_AFTER_MS);
        } else if (isMcq(t)) {
          readOut(v.item, t, {}); // sa_r28_mcq: question, then the four answers lit in turn; promptDone() at its end
        } else if (t.mode === 'oral') {
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
      if (entered) {
        gen++; typed = ''; mcq = null; mcqPass = null;
        if (mcqFold) runner.log('fold_close', { task_id: mcqFold.task, item_id: mcqFold.item, by: 'item', card: null });
        mcqFold = null;
        // the picker's fold opened under the old item (e.g. in the 400 ms press window): its close, once; the new item
        // is drawn folded and nothing waits on the old fold
        if (pickFold != null) {
          runner.log('fold_close', { task_id: pickFoldTask, item_id: pickFold, by: 'item', card: null });
          pickFold = null; pickFoldTask = null;
          var pfw = pickFoldWait; pickFoldWait = [];
          pfw.forEach(function (ok) { ok(); });
        }
      }
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
          s = isMcq(v.task) ? sRunMcq(v) : v.task.mode === 'tap' ? (isPick(v.task) ? sRunPick(v) : sRunTap(v)) : v.task.mode === 'keypad' ? sRunKeypad(v) : v.task.mode === 'keyboard' ? sRunKeyboard(v) : v.task.mode === 'oral' ? sRunOral(v) : sRunRecord(v);
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
      if (r9Scroll) scrollCueOn(v, showPhase, s);
      if (mode === 'proctored' && showPhase !== 'handover' && showPhase !== 'refused') {
        coachLayer(v).forEach(function (n) { el.appendChild(n); });
        if (coachMenu) el.appendChild(sCoachMenu(v));
      }
      if (r10Fit) urFitAll();
      if (r8Digits) latinScreen(el, v.task);
      if (r10Num) numFitOn(s);
      if (r8Mn) mnFit(s);
      el.setAttribute('data-phase', showPhase);
      el.setAttribute('data-task-mode', v.task ? v.task.mode : '');
      if (entered) { lastKey = key; enter(v); }
      // round 28 (data only): the reach read again when the item first offers Next, once per item
      if (showPhase === 'running' && v.item && v.offer_next && reachOffered !== key) { reachOffered = key; reachRead(v, v.task, 'offer'); }
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
        if (r9Scroll) scrollCueOff();
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
