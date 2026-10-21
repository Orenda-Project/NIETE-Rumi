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
 *
 *   sa_one_at_a_time        W3: a read-aloud grid shows one cell at a time (and spoken maths one sum at a time);
 *   sa_passage_punct        W3: the passage is drawn from its own text, with its punctuation and the page's spacing;
 *   sa_rdf_manual           W3: block rdf_manual runs coach-led (the coach gives the instructions).
 *                           ON, each adds battery.ui.<one_at_a_time|passage_punct|rdf_manual> = true for the engine;
 *                           all three OFF, the battery has no ui key, byte for byte as before.
 *
 * Pure: applySwitches(battery, on) never changes its input.
 */
const SWITCHES = {
  practiceAllMaths: 'sa_practice_all_maths', passageRotation: 'sa_passage_rotation',
  oneAtATime: 'sa_one_at_a_time', passagePunct: 'sa_passage_punct', rdfManual: 'sa_rdf_manual',
};
const UI = { oneAtATime: 'one_at_a_time', passagePunct: 'passage_punct', rdfManual: 'rdf_manual' };

function applySwitches(battery, on = {}) {
  if (!battery || !Array.isArray(battery.tasks)) return battery;
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
