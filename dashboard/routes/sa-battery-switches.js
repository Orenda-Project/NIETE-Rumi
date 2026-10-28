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
};
const UI = { oneAtATime: 'one_at_a_time', passagePunct: 'passage_punct', rdfManual: 'rdf_manual', voiceGateV2: 'voice_gate_v2',
  compAllQuestions: 'comp_all_questions', cellPace: 'cell_pace',
  sectionRecording: 'section_recording', coachLastWord: 'coach_last_word', cellNextOnly: 'cell_next_only',
  autoChildLastWord: 'auto_child_last_word', appAsks: 'app_asks', urFit: 'ur_fit', autoNoLastWord: 'auto_no_last_word',
  backButton: 'back_button', endTestRestart: 'end_test_restart', endSection: 'end_section', silenceRepeat: 'silence_repeat',
  incompleteMoveOn: 'incomplete_move_on', tSoundTa: 't_sound_ta', sayThenNext: 'say_then_next', storyScroll: 'story_scroll',
  audioGatedNext: 'audio_gated_next', tickPrompt: 'tick_prompt',
  r8ReadingNoDone: 'r8_reading_no_done', r8CompWaitNext: 'r8_comp_wait_next', r8PracticeAutoplay: 'r8_practice_autoplay',
  r8LatinDigits: 'r8_latin_digits', r8MissingNumber: 'r8_missing_number', r8Layout: 'r8_layout', r8StorySnap: 'r8_story_snap',
  r8Nudges: 'r8_nudges', r8Highlight: 'r8_highlight', r8LangSwitch: 'r8_lang_switch' };
const { applyR7a } = require('./sa-r7a-content');

const W3_KEYS = ['rdf_auto', 'rdf_manual', 'rdf_variants', 'rdf_w3_absent'];
// Round 7b (sa_silence_repeat): Jugnu's reminder, voiced in both sets (dashboard/sa/v1|v2/<lang>/<key>.mp3, keyed as the bank
// builder keys a line: sha1(lang|text)[:12]); added to the battery's lines while the switch is ON.
const SILENCE_LINE = {
  en: { text: 'Jugnu could not hear you. Say each answer out loud. Let us do this part again.', audio: 'sa/v1/en/90d23fdca65f.mp3' },
  ur: { text: 'جگنو آپ کی آواز نہیں سن سکا۔ ہر جواب اونچی آواز میں بولیں۔ آئیے یہ حصہ دوبارہ کرتے ہیں۔', audio: 'sa/v1/ur/dc59290fb3f6.mp3' },
};
const W3_LINES = ['coach_will_instruct', 'please_go_on'];

/** OFF: the battery less everything the W3 forms added. */
function withoutW3(battery) {
  if (!battery.rdf_auto && !battery.tasks.some((t) => t.w3)) return battery;
  const out = { ...battery, tasks: battery.tasks.filter((t) => !t.w3) };
  for (const k of W3_KEYS) delete out[k];
  if (out.lines) out.lines = Object.fromEntries(Object.entries(out.lines).filter(([k]) => !W3_LINES.includes(k)));
  return out;
}

function applySwitches(input, on = {}) {
  if (!input || !Array.isArray(input.tasks)) return input;
  const battery = on.rdfW3Forms ? input : withoutW3(input);
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
  });
  const ui = Object.keys(UI).filter((k) => on[k] === true);
  // round 7b, the child's screens: the lines and the T clip their switches add (sa-r7a-content.js); none when OFF
  if (!ui.length) return applyR7a({ ...battery, tasks }, on);
  // round 7b, sa_silence_repeat: Jugnu's reminder line in the battery's own language
  const line = on.silenceRepeat === true ? SILENCE_LINE[battery.lang] : null;
  const lines = line ? { ...(battery.lines || {}), silence_repeat: { ...line } } : null;
  return applyR7a({ ...battery, tasks, ...(lines ? { lines } : {}), ui: { ...(battery.ui || {}), ...Object.fromEntries(ui.map((k) => [UI[k], true])) } }, on);
}

module.exports = { SWITCHES, applySwitches };
