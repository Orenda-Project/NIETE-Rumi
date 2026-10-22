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
 *   sa_section_recording    round 4: an oral task is one recording from Begin to its end, with each question's marks.
 *   sa_cell_pace            round 4: a one-at-a-time item moves on after 3 s with no voice (not 3 s from show), never before 5 s.
 *                           ON, each adds battery.ui.<one_at_a_time|passage_punct|rdf_manual> = true for the engine;
 *                           all three OFF, the battery has no ui key, byte for byte as before.
 *
 * Pure: applySwitches(battery, on) never changes its input.
 */
const SWITCHES = {
  practiceAllMaths: 'sa_practice_all_maths', passageRotation: 'sa_passage_rotation',
  oneAtATime: 'sa_one_at_a_time', passagePunct: 'sa_passage_punct', rdfManual: 'sa_rdf_manual', rdfW3Forms: 'sa_rdf_w3_forms',
  voiceGateV2: 'sa_voice_gate_v2', compAllQuestions: 'sa_comp_all_questions',
  cellPace: 'sa_cell_pace', sectionRecording: 'sa_section_recording',
};
const UI = { oneAtATime: 'one_at_a_time', passagePunct: 'passage_punct', rdfManual: 'rdf_manual', voiceGateV2: 'voice_gate_v2',
  compAllQuestions: 'comp_all_questions', cellPace: 'cell_pace',
  sectionRecording: 'section_recording' };
const W3_KEYS = ['rdf_auto', 'rdf_manual', 'rdf_variants', 'rdf_w3_absent'];
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
  if (!ui.length) return { ...battery, tasks };
  return { ...battery, tasks, ui: { ...(battery.ui || {}), ...Object.fromEntries(ui.map((k) => [UI[k], true])) } };
}

module.exports = { SWITCHES, applySwitches };
