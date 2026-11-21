'use strict';
/**
 * The content switches applied to a battery file as /sa/batteries/ serves it (app_settings, each OFF by default):
 *
 *   sa_practice_all_maths   A11: every maths task practises first. ON: a task's practice_v2 (an official item in no
 *                           scored set, item-bank.sa-extra.v1.json maths.practice) becomes its practice, and the
 *                           disabled demo copy of item 1 (script.demo_item) stays. OFF: both are dropped, so the
 *                           engine runs the practice it ran before.
 *   sa_passage_rotation     A02: the coach forms' passage, its questions and the listening story carry variants[]
 *                           (fielded, sourced texts); ON keeps them for the page to pick one per child, OFF drops
 *                           them, so every child reads the form's own (Set A) texts.
 *   sa_rdf_w3_forms         W3: the coach forms' RDF auto / RDF manual lists (rdf_auto, rdf_manual, rdf_variants,
 *                           rdf_w3_absent), their own tasks (w3: true) and the two lines they add. OFF drops all of it,
 *                           so the battery is the one built without the W3 items.
 *
 *   sa_one_at_a_time        W3: a read-aloud grid shows one cell at a time (and spoken maths one sum at a time);
 *   sa_passage_punct        W3: the passage is drawn from its own text, with its punctuation and the page's spacing;
 *   sa_rdf_manual           W3: block rdf_manual runs coach-led (the coach gives the instructions).
 *   sa_voice_gate_v2        the refusal screen ("the voice is not ready") offers Try again, which prepares again.
 *   sa_comp_all_questions   round 4: the passage's questions by the Rawalpindi rule (10+ words read → every question).
 *   sa_coach_last_word      round 4: the coach marks the last word read, found from the recording; the tap confirms.
 *   sa_section_recording    round 4: an oral task is one recording from Begin to its end, with each question's marks.
 *   sa_cell_pace            round 4: a one-at-a-time item moves on after 3 s with no voice (not 3 s from show), never before 5 s.
 *   sa_cell_next_only       round 5: an Urdu/English letter or word shown one at a time moves on only on Next (wins over sa_cell_pace).
 *   sa_auto_child_last_word round 5: in RDF auto the child taps the last word (kept as the check); the coach's screen is manual's.
 *   sa_app_asks             round 6: in RDF manual Jugnu asks every question and item prompt; the coach gives the instructions only.
 *   sa_ur_fit               round 6: every Urdu word on the screens whole, inside its box, clear of pictures and the foot
 *                           (sa.css "Round 6", the page's .is-ur-fit).
 *   sa_auto_no_last_word    round 7: RDF auto has no last-word step (the scorer reads the recording); the passage's
 *                           questions are all asked. RDF manual keeps the coach's screen.
 *                           ON, each adds battery.ui.<one_at_a_time|passage_punct|rdf_manual> = true for the engine;
 *                           all three OFF, the battery has no ui key, byte for byte as before.
 *
 *   Round 7b (the tester's 27 Oct list), one per item, each ON adds battery.ui.<flag> = true for the engine:
 *   sa_back_button          item 1: a Back button on the child's item screens, both modes; the new answer replaces the old.
 *   sa_end_test_restart     item 2: the coach's corner End test works; the child stays on the list with Restart test.
 *   sa_end_section          item 3: coach-led (RDF manual): End this section skips to the next section, the test goes on.
 *   sa_silence_repeat       item 4: RDF auto, no sound heard: Jugnu reminds the child to answer out loud, one repeat.
 *   sa_incomplete_move_on   item 5 (the tester's final rule): RDF auto, a part the child did not finish skips the rest of
 *                           its subject; the child goes on to the next subject (Urdu → English → maths).
 *   sa_t_sound_ta           item 6: the English letter sound of T says "ta".
 *   sa_say_then_next        item 7: the instructions say: say the answer (or press the button), then press Next.
 *   sa_story_scroll         item 8: the story shows a down arrow while there is more text; the instructions say so.
 *   sa_audio_gated_next     item 9: Next works only once Jugnu's instructions have played in full.
 *   sa_tick_prompt          item 10: the missing-number instructions say to press the tick after typing the number.
 *   Every skip and stop is one kept event on the session (bot sa-api.service.js STOP_TYPES).
 *
 *   Round 8 (the reviewer's 28 Oct list), the child's screens, one per item, each ON adds battery.ui.r8_<flag> = true:
 *   sa_r8_reading_no_done   item 14: entering a reading screen, nothing about "done" is spoken.
 *   sa_r8_comp_wait_next    item 28: the story questions never move on by themselves; the child answers, then Next.
 *   sa_r8_practice_autoplay item 11: each practice screen says its answer on arrival, no button press.
 *   sa_r8_latin_digits      items 29/3/34: every number shown in 0-9; a sum reads as a blank to fill (1 + 3 = ___).
 *   sa_r8_missing_number    item 30: the number row large, the choices beneath, a tapped choice floats into the blank.
 *   sa_r8_layout            items 6/12/21: bigger pictures and tap targets per phone/tablet, less bold, letter cards centred.
 *   sa_r8_story_snap        item 15: the story scrolls one part at a time; no swipe skips an unread part.
 *   sa_r8_nudges            items 25/26: each screen shows whether it wants speaking (mic + level) or tapping (hand).
 *   sa_r8_highlight         item 32: the instruction's words light up as Jugnu says them (when a timing file is there).
 *   sa_r8_lang_switch       item 4: Urdu <-> English can be switched mid-test, from the next screen on.
 *   sa_r8_reading_position  items 17/19/20: RDF auto, the story's questions by the voice heard while the child read: under
 *                           1 s voiced they are skipped (skipped_no_voice); otherwise asked, Done or time up.
 *   sa_r8_timeup_continue   a part's clock running out ends that part only; the rest of its subject goes on.
 *   sa_r8_counts            item 35: the RDF forms' practice / scored counts per subsection and 15 s per story question
 *                           (bot/shared/services/child-test/sa/counts.js, which the scorer reads too).
 *   sa_r8_ios_mic           the game's mic check on an iPhone: the meter's AudioContext is made inside the tap and resumed
 *                           (dashboard/sa/sa-mic.js); the coach's pre-flight reads the same row (portal /sa/switches).
 *   sa_r9_audio             round 9 item 2 (Jugnu very low on some phones): the recorder opens the microphone for each
 *                           recording only, so no echo-cancelled input holds the phone in call mode while Jugnu speaks
 *                           (dashboard/sa/sa-rec.js idle_release).
 *
 *   Round 9 (the reviewer's 2 Nov list), the test screens, one per item, each ON adds battery.ui.r9_<flag> = true:
 *   sa_r9_question_time     item 4: every per-question wait that moves a question on by itself is doubled, never under
 *                           30 s; Next still moves on early. A part with its own clock (the one-minute reads and sums,
 *                           the measure) keeps its timings.
 *   sa_r9_comp_text         item 6: the story's questions are written on the screen as well as spoken.
 *   sa_r9_scroll_cue        item 7: a screen whose content runs past the bottom shows a scroll cue until the end is in view.
 *   sa_r9_skip_instructions item 3: coach-led (RDF manual), the coach can skip a part's instructions (never the part);
 *                           one skip_instructions event on the session.
 *
 *   Round 10 (the reviewers' 6 Nov list), the test screens, one per item, each ON adds battery.ui.r10_<flag> = true:
 *   sa_r10_hint_once        audio 1: "say each one out loud, then press Next" is heard once per task, in the instruction;
 *                           the hint line stays on the screen but is not said again after it.
 *   sa_r10_practice_next    timing 1: when a practice section ends, Next works at once (a double tap still moves one screen).
 *   sa_r10_urdu_fit         layout 1: an Urdu word sits centred in its button or bubble, the whole Nastaliq glyph inside.
 *   sa_r10_number_fit       layout 2: maths numbers are sized to the space they have (a 3-digit number as large as it fits).
 *   Round 10, content only (no ui flag):
 *   sa_r10_fluency_no_practice  task design 1: the timed one-minute mental maths has no practice section (its practice
 *                           items did not look like the real ones). ON: that part's practice and practice line are dropped,
 *                           so the engine goes from the instruction to Ready (sa-core instructionDone); the other parts keep
 *                           theirs. OFF: the battery as before.
 *
 *   Round 10 (the reviewers' 6 Nov list), Jugnu's voice (dashboard/sa/sa-voice.js), each ON adds battery.ui.r10_<flag> = true:
 *   sa_r10_bigger_audio     audio 3 ("Which is bigger" silent): Jugnu speaks through his own elements, unlocked by the
 *                           child's taps, so a line that starts with no tap behind it (a screen that moves on by itself) is
 *                           no longer refused by an Android in-app browser; a refused clip is kept as voice_held.
 *   sa_r10_practice_gap     audio 4 (a break before the right answer): a practice task's answers are loaded before they are
 *                           said, so the answer starts as "The answer is:" ends (brings sa_r10_bigger_audio's elements with it).
 *
 *   Round 12 (the Urdu reviewer, 12 Nov), the Whole battery's "your turn" line, ON adds battery.ui.r12_intro_once = true:
 *   sa_r12_intro_once       the line every Whole-battery part says on its Ready screen ("Now it is your turn. Jugnu will not
 *                           say if an answer is right until the end.", scripts.js COMMON.test_intro) is said once per run, on
 *                           the first Ready screen that carries it; later ones say only their begin line (sa-ui.js). The parts
 *                           that carry it are marked test_intro.once; the words are unchanged, and a line of a part's own
 *                           (listening, every RDF part) is not marked.
 *
 *   Round 13 (the Urdu reviewer, 12 Nov: a part the child cannot finish ends its subject), ONE app_settings row whose value
 *   picks the meaning, read by two readers (R13_ALL, R13_EARLY), so the reviewer's answer is a data change:
 *   sa_r13_whole_stop       "all" (or true): battery.ui.r13_whole_stop = 'all', round 7b's "not finished", a time-up included
 *                           (a timed part whose minute ends before its last item, the story's minute); "early":
 *                           battery.ui.r13_whole_stop = 'early', only a part the test ended early (the early-stop rule, the
 *                           silence stop, a spoken question left unanswered). The engine applies it to the Whole battery
 *                           only (the page's block full); RDF auto, RDF manual and the B-blocks keep their own rule.
 *
 *   Round 13b (the Urdu reviewer, 12 Nov: one unanswered spoken question must not end the subject; two in a row do), ONE
 *   app_settings row holding an integer N, read by four readers (r13OralRule2..5, MATCH), so N is a data change:
 *   sa_r13_oral_rule        N (2 to 5, a number or its string): battery.ui.r13_oral_rule = N. A spoken part (listening, the
 *                           story's questions, segmentation) ends its subject only when N questions in a row ran out with
 *                           nobody pressing "I've answered" / Next. No row, 1 or anything else: OFF (today: one is enough).
 *                           The engine applies it wherever the move-on rule runs (sa-core.js opts.oral_in_a_row).
 *
 *   Round 20 (the Urdu reviewer, 13 Nov: a child silent through a section moves on to the next subject), ONE app_settings
 *   row holding an integer N, read by three readers (r20SilenceStop1..3, MATCH), so N is a data change:
 *   sa_r20_silence_stop     N (1 to 3, a number or its string): battery.ui.r20_silence_stop = N. RDF auto: N silent Urdu or
 *                           English letter/word parts in a row (each after its one reminder and repeat) end the subject
 *                           (sa-core.js opts.silence_in_a_row). No row, 0 or anything else: OFF.
 *   sa_r20_auto_end_section battery.ui.r20_auto_end_section = true: the coach's End this section (sa_end_section) works in
 *                           RDF auto too.
 *
 *   Round 28, A11 (screen fit), each ON adds battery.ui.r28_<flag> = true for the engine:
 *   sa_r28_cue_guard        the round-9 scroll cue, once shown, takes its own box off what it measures, so it goes as soon
 *                           as the screen's own content is in view and never stays drawn over nothing (sa-ui.js scrollCheck).
 *   sa_r28_toggle_fit       round 8's language toggle keeps its 56 px button inside a 44 px top bar on every screen, and a
 *                           head row holding a tappable keeps its distance from the toggle's hit area (sa.css, round 28 A11).
 *   sa_r28_check_fit        the Urdu sound check fits a phone-height frame: its question, hint, Jugnu row and the two picture
 *                           tiles sized so both tiles are whole and tappable without scrolling (sa.css, round 28, the check fit).
 *   sa_r28_end_task_copy    battery.ui.r28_end_task_copy = true: the coach's hold menu says End this task in Urdu as
 *                           «یہ کام ختم کریں», apart from the portal's End this section (sa-ui.js sCoachMenu).
 *   sa_r28_mic_unknown      battery.ui.r28_mic_unknown = true: in coach mode a phone with no stored mic check is not a
 *                           phone with no mic; the first recorded task shows the coach's mic card (try it, hear it back;
 *                           a pass needs a level above the floor), and only the coach's "go on without" skips
 *                           (sa-engine.js micState, sa-ui.js sMicCheck, sa-mic.js).
 *
 * Pure: applySwitches(battery, on) never changes its input.
 */
const SWITCHES = {
  practiceAllMaths: 'sa_practice_all_maths', passageRotation: 'sa_passage_rotation',
  oneAtATime: 'sa_one_at_a_time', passagePunct: 'sa_passage_punct', rdfManual: 'sa_rdf_manual', rdfW3Forms: 'sa_rdf_w3_forms',
  voiceGateV2: 'sa_voice_gate_v2', compAllQuestions: 'sa_comp_all_questions',
  cellPace: 'sa_cell_pace', sectionRecording: 'sa_section_recording',
  coachLastWord: 'sa_coach_last_word', cellNextOnly: 'sa_cell_next_only', autoChildLastWord: 'sa_auto_child_last_word',
  appAsks: 'sa_app_asks',
  urFit: 'sa_ur_fit',
  autoNoLastWord: 'sa_auto_no_last_word',
  // round 7b
  backButton: 'sa_back_button', endTestRestart: 'sa_end_test_restart', endSection: 'sa_end_section',
  silenceRepeat: 'sa_silence_repeat', incompleteMoveOn: 'sa_incomplete_move_on', tSoundTa: 'sa_t_sound_ta',
  sayThenNext: 'sa_say_then_next', storyScroll: 'sa_story_scroll', audioGatedNext: 'sa_audio_gated_next',
  tickPrompt: 'sa_tick_prompt',
  // round 8
  r8ReadingNoDone: 'sa_r8_reading_no_done', r8CompWaitNext: 'sa_r8_comp_wait_next', r8PracticeAutoplay: 'sa_r8_practice_autoplay',
  r8LatinDigits: 'sa_r8_latin_digits', r8MissingNumber: 'sa_r8_missing_number', r8Layout: 'sa_r8_layout',
  r8StorySnap: 'sa_r8_story_snap', r8Nudges: 'sa_r8_nudges', r8Highlight: 'sa_r8_highlight', r8LangSwitch: 'sa_r8_lang_switch',
  r8ReadingPosition: 'sa_r8_reading_position', r8TimeupContinue: 'sa_r8_timeup_continue', r8Counts: 'sa_r8_counts',
  r8IosMic: 'sa_r8_ios_mic',
  // round 9
  r9Audio: 'sa_r9_audio',
  r9QuestionTime: 'sa_r9_question_time', r9CompText: 'sa_r9_comp_text', r9ScrollCue: 'sa_r9_scroll_cue',
  r9SkipInstructions: 'sa_r9_skip_instructions',
  // round 10
  r10HintOnce: 'sa_r10_hint_once', r10PracticeNext: 'sa_r10_practice_next', r10UrduFit: 'sa_r10_urdu_fit',
  r10NumberFit: 'sa_r10_number_fit',
  // round 10 (Jugnu's voice)
  r10BiggerAudio: 'sa_r10_bigger_audio', r10PracticeGap: 'sa_r10_practice_gap',
  r10FluencyNoPractice: 'sa_r10_fluency_no_practice',
  // round 12
  r12IntroOnce: 'sa_r12_intro_once',
  // round 13: one row, two readers (R13_ALL / R13_EARLY); the value picks the definition
  r13WholeStopAll: 'sa_r13_whole_stop', r13WholeStopEarly: 'sa_r13_whole_stop',
  // round 13b: one row, four readers (MATCH); the value is N
  r13OralRule2: 'sa_r13_oral_rule', r13OralRule3: 'sa_r13_oral_rule', r13OralRule4: 'sa_r13_oral_rule', r13OralRule5: 'sa_r13_oral_rule',
  // round 20: one row, three readers (MATCH); the value is N. And the coach's End this section in RDF auto
  r20SilenceStop1: 'sa_r20_silence_stop', r20SilenceStop2: 'sa_r20_silence_stop', r20SilenceStop3: 'sa_r20_silence_stop',
  r20AutoEndSection: 'sa_r20_auto_end_section',
  // round 28 (the 17 Nov evaluation meeting): the listen-and-tap letter sounds, the spoken MCQ, the ceiling extension
  r28LetterPick: 'sa_r28_letter_pick', r28Mcq: 'sa_r28_mcq', r28Ceiling: 'sa_r28_ceiling',
  // round 28, E-3: the story's clock stops at Done, not at the last-word tap (sa-core.js finish)
  r28StoryClock: 'sa_r28_story_clock',
  // round 28, A11: the scroll cue never holds itself; the language toggle inside a 44 px top bar (sa-ui.js, sa.css)
  r28CueGuard: 'sa_r28_cue_guard', r28ToggleFit: 'sa_r28_toggle_fit',
  // round 28, the check fit: the Urdu sound check fits a phone-height frame (sa.css)
  r28CheckFit: 'sa_r28_check_fit',
  // round 28: the hold menu's Urdu End this task no longer reads as the portal's End this section (sa-ui.js sCoachMenu)
  r28EndTaskCopy: 'sa_r28_end_task_copy',
  // round 28, O-115: an unknown microphone in coach mode is tried, never taken as none (sa-engine.js, sa-ui.js)
  r28MicUnknown: 'sa_r28_mic_unknown',
};
/** sa_r13_whole_stop's value → which reader is ON (anything else: both OFF). */
const R13_ALL = (v) => v === true || v === 'all';
const R13_EARLY = (v) => v === 'early';
/** sa_r13_oral_rule's value → ON for exactly N (a whole number 2..5, or its string). */
const ORAL_N = [2, 3, 4, 5];
const oralIs = (n) => (v) => v === n || v === String(n);
/** sa_r20_silence_stop's value → ON for exactly N (a whole number 1..3, or its string). */
const SILENCE_N = [1, 2, 3];
const MATCH = { r13WholeStopAll: R13_ALL, r13WholeStopEarly: R13_EARLY,
  ...Object.fromEntries(ORAL_N.map((n) => [`r13OralRule${n}`, oralIs(n)])),
  ...Object.fromEntries(SILENCE_N.map((n) => [`r20SilenceStop${n}`, oralIs(n)])) };
const UI = { oneAtATime: 'one_at_a_time', passagePunct: 'passage_punct', rdfManual: 'rdf_manual', voiceGateV2: 'voice_gate_v2',
  compAllQuestions: 'comp_all_questions', cellPace: 'cell_pace',
  sectionRecording: 'section_recording', coachLastWord: 'coach_last_word', cellNextOnly: 'cell_next_only',
  autoChildLastWord: 'auto_child_last_word', appAsks: 'app_asks', urFit: 'ur_fit', autoNoLastWord: 'auto_no_last_word',
  backButton: 'back_button', endTestRestart: 'end_test_restart', endSection: 'end_section', silenceRepeat: 'silence_repeat',
  incompleteMoveOn: 'incomplete_move_on', tSoundTa: 't_sound_ta', sayThenNext: 'say_then_next', storyScroll: 'story_scroll',
  audioGatedNext: 'audio_gated_next', tickPrompt: 'tick_prompt',
  r8ReadingNoDone: 'r8_reading_no_done', r8CompWaitNext: 'r8_comp_wait_next', r8PracticeAutoplay: 'r8_practice_autoplay',
  r8LatinDigits: 'r8_latin_digits', r8MissingNumber: 'r8_missing_number', r8Layout: 'r8_layout', r8StorySnap: 'r8_story_snap',
  r8Nudges: 'r8_nudges', r8Highlight: 'r8_highlight', r8LangSwitch: 'r8_lang_switch',
  r8ReadingPosition: 'r8_reading_position', r8TimeupContinue: 'r8_timeup_continue', r8Counts: 'r8_counts',
  r8IosMic: 'r8_ios_mic', r9Audio: 'r9_audio',
  r9QuestionTime: 'r9_question_time', r9CompText: 'r9_comp_text', r9ScrollCue: 'r9_scroll_cue',
  r9SkipInstructions: 'r9_skip_instructions',
  r10HintOnce: 'r10_hint_once', r10PracticeNext: 'r10_practice_next', r10UrduFit: 'r10_urdu_fit', r10NumberFit: 'r10_number_fit',
  r10BiggerAudio: 'r10_bigger_audio', r10PracticeGap: 'r10_practice_gap', r12IntroOnce: 'r12_intro_once',
  r20AutoEndSection: 'r20_auto_end_section',
  r28LetterPick: 'r28_letter_pick', r28Mcq: 'r28_mcq', r28Ceiling: 'r28_ceiling', r28StoryClock: 'r28_story_clock',
  r28CueGuard: 'r28_cue_guard', r28ToggleFit: 'r28_toggle_fit', r28CheckFit: 'r28_check_fit',
  r28EndTaskCopy: 'r28_end_task_copy', r28MicUnknown: 'r28_mic_unknown' };
const { applyR7a } = require('./sa-r7a-content');
const { withCounts } = require('../../bot/shared/services/child-test/sa/counts');
const { COMMON } = require('../../bot/shared/services/child-test/sa/scripts');

const W3_KEYS = ['rdf_auto', 'rdf_manual', 'rdf_variants', 'rdf_w3_absent'];
// Round 7b (sa_silence_repeat): Jugnu's reminder, voiced in both sets (dashboard/sa/v1|v2/<lang>/<key>.mp3, keyed as the bank
// builder keys a line: sha1(lang|text)[:12]); added to the battery's lines while the switch is ON.
const SILENCE_LINE = {
  en: { text: 'Jugnu could not hear you. Say each answer out loud. Let us do this part again.', audio: 'sa/v1/en/90d23fdca65f.mp3' },
  ur: { text: 'جگنو آپ کی آواز نہیں سن سکا۔ ہر جواب اونچی آواز میں بولیں۔ آئیے یہ حصہ دوبارہ کرتے ہیں۔', audio: 'sa/v1/ur/dc59290fb3f6.mp3' },
};
const W3_LINES = ['coach_will_instruct', 'please_go_on'];

/** Round 10, sa_r10_fluency_no_practice: the one-minute mental maths without its practice (and its practice line). */
function withoutFluencyPractice(task) {
  if (!task || task.subtask !== 'mental_math_fluency' || !Array.isArray(task.practice) || !task.practice.length) return task;
  const { practice_intro: _p, ...script } = task.script || {};
  return { ...task, practice: [], ...(task.script ? { script } : {}) };
}

/** Round 12, sa_r12_intro_once: the part's test_intro marked once when it is the common "your turn" line in `lang`. */
function withIntroOnce(task, lang) {
  const ti = task && task.script && task.script.test_intro;
  if (!ti || !COMMON.test_intro[lang] || ti.text !== COMMON.test_intro[lang]) return task;
  return { ...task, script: { ...task.script, test_intro: { ...ti, once: true } } };
}

/** OFF: the battery less everything the W3 forms added. */
function withoutW3(battery) {
  if (!battery.rdf_auto && !battery.tasks.some((t) => t.w3)) return battery;
  const out = { ...battery, tasks: battery.tasks.filter((t) => !t.w3) };
  for (const k of W3_KEYS) delete out[k];
  if (out.lines) out.lines = Object.fromEntries(Object.entries(out.lines).filter(([k]) => !W3_LINES.includes(k)));
  return out;
}

/**
 * Round 28 (the 17 Nov evaluation meeting), three switches, each OFF by default. The built battery file carries
 * everything the round adds, marked, and this strips it while the switch is OFF, so a phone with the switches OFF
 * receives today's battery byte for byte (dashboard/tests/sa-r28-off-identity.service.test.js):
 *
 *   sa_r28_letter_pick  a task `r28: 'letter_pick'` (kind 'pick': Jugnu says a sound, the child taps one of five
 *                       letters, scored on the phone). ON: it takes the place of the task it `replaces`
 *                       (`<lang>.letter_sounds5`) in `tasks` and in the RDF lists (rdf_auto / rdf_manual); OFF: dropped.
 *   sa_r28_mcq          a task `r28: 'mcq'` (kind 'mcq': the story questions as four spoken options to tap). ON: in the
 *                       place of `<lang>.story_comp_w3`; OFF: dropped.
 *   sa_r28_ceiling      a timed task's items past today's first N: the committed task keeps `items` / `grid` / `stop`
 *                       as today and adds `base_n: N`, `ext_items: [...]` (each `ext: true`, `src`) and `ext_stop` (the
 *                       scorer's first-row rule past N). ON: the served task's `items` are `items.concat(ext_items)`,
 *                       `grid` is rebuilt from them, `base_n` stays (the screens read it); OFF: `ext_items`, `ext_stop`
 *                       and `base_n` go and `items` / `grid` are exactly today's.
 *   r28_tasks           the builder's list of the round's task ids (how they reach `tasks[]`): never served.
 *   lines_r28           the round's own lines, each `{ text, audio, r28: <kind> }`: a line joins `lines` (without the
 *                       `r28` key) when its kind's switch is ON; the `lines_r28` key never reaches a phone.
 *   r28_accept          on the EN familiar words: each item's `accept` holds the local forms that keep the same word,
 *                       which the scorer reads from the battery file (the words prompt); a phone never receives them,
 *                       OFF or ON, so the task goes out without `r28_accept` and its items (and ext_items) without `accept`.
 *   Each ON adds battery.ui.r28_<x> = true for the engine (UI). A battery with nothing of round 28 comes back as it is.
 */
const R28_KINDS = { r28LetterPick: 'letter_pick', r28Mcq: 'mcq' };
const hasExt = (t) => Boolean(t && (t.base_n != null || Array.isArray(t.ext_items) || t.ext_stop != null));
const noAccept = (x) => { if (!x || !('accept' in x)) return x; const { accept: _a, ...rest } = x; return rest; };
const withoutAccept = (t) => {
  if (!t || !t.r28_accept) return t;
  const { r28_accept: _r, ...rest } = t;
  return { ...rest, items: t.items.map(noAccept), ...(Array.isArray(t.ext_items) ? { ext_items: t.ext_items.map(noAccept) } : {}) };
};
function withR28(battery, on) {
  const tasks = battery.tasks.map(withoutAccept);
  const hasTask = tasks.some((t) => t && t.r28);
  if (!hasTask && !battery.tasks.some((t) => t && (hasExt(t) || t.r28_accept)) && !battery.lines_r28 && !battery.r28_tasks) return battery;
  const kinds = new Set(Object.entries(R28_KINDS).filter(([k]) => on[k] === true).map(([, kind]) => kind));
  // ON: the new task sits where the task it replaces sat; OFF: it is dropped.
  const byOld = new Map(tasks.filter((t) => t && t.r28 && kinds.has(t.r28) && t.replaces).map((t) => [t.replaces, t]));
  const placed = new Set();
  let out = [];
  for (const t of tasks) {
    if (!t) { out.push(t); continue; }
    if (t.r28) { if (kinds.has(t.r28) && !t.replaces) out.push(t); continue; }
    const by = byOld.get(t.id);
    if (by) { out.push(by); placed.add(by.id); } else out.push(t);
  }
  // a replacement whose old task is not in this battery still runs when ON (appended, as the lists name it)
  for (const by of byOld.values()) if (!placed.has(by.id)) out.push(by);
  out = out.map((t) => {
    if (!hasExt(t)) return t;
    const { base_n, ext_items: ext, ext_stop: _s, ...rest } = t;
    if (!on.r28Ceiling || !Array.isArray(ext) || !ext.length) return rest;
    const items = (Array.isArray(t.items) ? t.items : []).concat(ext);
    return { ...rest, ...(base_n != null ? { base_n } : {}), items, ...(Array.isArray(t.grid) ? { grid: items.map((it) => (it.show != null ? it.show : it.target)) } : {}) };
  });
  const swap = (list) => (Array.isArray(list) ? list.map((id) => (byOld.has(id) ? byOld.get(id).id : id)) : list);
  const { lines_r28: extraLines, r28_tasks: _ids, ...rest } = battery;
  const lines = { ...(battery.lines || {}) };
  for (const [k, l] of Object.entries(extraLines || {})) {
    if (!l || !kinds.has(l.r28)) continue;
    const { r28: _k, ...line } = l;
    lines[k] = line;
  }
  const result = { ...rest, tasks: out };
  for (const key of ['rdf_auto', 'rdf_manual']) if (Array.isArray(battery[key])) result[key] = swap(battery[key]);
  if (battery.lines || Object.keys(lines).length) result.lines = lines;
  return result;
}

function applySwitches(input, on = {}) {
  if (!input || !Array.isArray(input.tasks)) return input;
  const r28 = withR28(input, on);
  const w3 = on.rdfW3Forms ? r28 : withoutW3(r28);
  // round 8, sa_r8_counts: the RDF forms' counts (only W3 tasks carry them, so nothing changes without sa_rdf_w3_forms)
  const battery = on.r8Counts === true ? withCounts(w3) : w3;
  const fluencyOff = (t) => (on.r10FluencyNoPractice === true ? withoutFluencyPractice(t) : t);
  const introOnce = (t) => (on.r12IntroOnce === true ? withIntroOnce(t, battery.lang) : t);
  const tasks = battery.tasks.map((t) => {
    const demo = !!(t.script && t.script.demo_item);
    if (!t.practice_v2 && !demo && !t.variants) return t;
    const o = { ...t };
    if (!on.passageRotation) delete o.variants;
    if (on.practiceAllMaths) {
      if (o.practice_v2) o.practice = o.practice_v2;
    } else if (demo) {
      const { demo_item: _d, ...script } = o.script;
      o.script = script;
    }
    delete o.practice_v2;
    return o;
  }).map(fluencyOff).map(introOnce);
  const ui = Object.keys(UI).filter((k) => on[k] === true);
  // round 13: the Whole battery's definition of "not finished" (all wins if both readers answer ON)
  const r13 = on.r13WholeStopAll === true ? 'all' : (on.r13WholeStopEarly === true ? 'early' : null);
  if (r13) ui.push('r13WholeStop');
  // round 13b: how many spoken questions in a row left unanswered end the subject (the smallest N read ON)
  const oralN = ORAL_N.find((n) => on[`r13OralRule${n}`] === true) || null;
  if (oralN) ui.push('r13OralRule');
  // round 20: how many silent letter/word parts in a row end the subject (the smallest N read ON)
  const silenceN = SILENCE_N.find((n) => on[`r20SilenceStop${n}`] === true) || null;
  if (silenceN) ui.push('r20SilenceStop');
  // round 7b, the child's screens: the lines and the T clip their switches add (sa-r7a-content.js); none when OFF
  if (!ui.length) return applyR7a({ ...battery, tasks }, on);
  // round 7b, sa_silence_repeat: Jugnu's reminder line in the battery's own language
  const line = on.silenceRepeat === true ? SILENCE_LINE[battery.lang] : null;
  const lines = line ? { ...(battery.lines || {}), silence_repeat: { ...line } } : null;
  return applyR7a({ ...battery, tasks, ...(lines ? { lines } : {}), ui: { ...(battery.ui || {}), ...Object.fromEntries(ui.map((k) => (k === 'r13WholeStop' ? ['r13_whole_stop', r13] : k === 'r13OralRule' ? ['r13_oral_rule', oralN] : k === 'r20SilenceStop' ? ['r20_silence_stop', silenceN] : [UI[k], true]))) } }, on);
}

module.exports = { SWITCHES, MATCH, R13_ALL, R13_EARLY, applySwitches };
