'use strict';
/**
 * The content switches applied to a battery file as /sa/batteries/ serves it (app_settings, each OFF by default):
 *
 *   sa_practice_all_maths   A11: every maths task practises first. ON: a task's practice_v2 (an official item in no
 *                           scored set, item-bank.sa-extra.v1.json maths.practice) becomes its practice, and the
 *                           disabled demo copy of item 1 (script.demo_item) stays. OFF: both are dropped, so the
 *                           engine runs the practice it ran before.
 *
 * Pure: applySwitches(battery, on) never changes its input.
 */
const SWITCHES = { practiceAllMaths: 'sa_practice_all_maths' };

function applySwitches(battery, on = {}) {
  if (!battery || !Array.isArray(battery.tasks)) return battery;
  const tasks = battery.tasks.map((t) => {
    const demo = !!(t.script && t.script.demo_item);
    if (!t.practice_v2 && !demo) return t;
    const o = { ...t };
    if (on.practiceAllMaths) {
      if (o.practice_v2) o.practice = o.practice_v2;
    } else if (demo) {
      const { demo_item: _d, ...script } = o.script;
      o.script = script;
    }
    delete o.practice_v2;
    return o;
  });
  return { ...battery, tasks };
}

module.exports = { SWITCHES, applySwitches };
