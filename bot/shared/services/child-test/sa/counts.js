'use strict';
/**
 * Round 8, item 35 (switch sa_r8_counts, app_settings, OFF by default): the content owner's question counts per
 * subsection of the RDF forms (rdf_auto / rdf_manual run the same W3 tasks).
 *
 *   practice  the first n practice items stay (the example first); the rest are dropped from the end.
 *   add       scored items taken from the battery's own spare items (the same official instrument the task's items
 *             come from), picked by their src index, else by what they show; appended after today's items, so
 *             today's item ids keep their meaning.
 *   question_timeout_s  the story questions: 15 s per question (one replay as today; the answer button moves on early).
 *
 * withCounts(battery) never changes its input. A battery without these tasks (another form) comes back as it was.
 * The scorer (score.js) reads the same plan through countsTask(), so a result scored later has the form the phone ran.
 */
const PLAN = {
  'ur.letter_sounds5': { practice: 1 },
  'ur.words4': { practice: 2, add: { from: 'ur.words', at: [4] } },
  'en.letter_names5': { practice: 1 },
  'en.letter_sounds5': { practice: 1 },
  'en.words4': { practice: 2, add: { from: 'en.words', at: [4] } },
  'ma.discrimination2': { add: { from: 'ma.discrimination', at: [2] } },
  'ma.add2i': { add: { from: 'ma.add2', at: [2, 3, 4] } },
  'ma.sub2i': { add: { from: 'ma.sub2', at: [2, 3, 4] } },
  'ma.mul2i': { add: { from: 'ma.fluency_l34', shown: ['6 × 6 =', '7 × 8 ='] } },
  'ur.story_comp_w3': { question_timeout_s: 15 },
  'en.story_comp_w3': { question_timeout_s: 15 },
};

const pad = (n) => String(n).padStart(2, '0');
const srcAt = (it, i) => new RegExp(`\\.items\\[${i}\\]$`).test(String(it.src || ''));

/** A spare item in the shape the W3 task's own items have (show / target / answer; a sum keeps its say + clip). */
function asItem(task, spare, id) {
  if (Array.isArray(spare.options) && !spare.say) return { id, target: spare.target, options: spare.options.slice(), src: spare.src };
  if (spare.shown != null) {
    const show = String(spare.shown).replace(/\s*=\s*$/, '').replace(/ - /g, ' − ');
    return { id, show, target: spare.target, answer: spare.target, src: spare.src, say: spare.say, prompt_audio: spare.prompt_audio };
  }
  return { id, show: spare.target, target: spare.target, answer: spare.target, src: spare.src };
}

/** The spares a plan names, from the battery's own tasks; null when one is missing (the task then stays as it is). */
function sparesFor(battery, add) {
  const from = battery.tasks.find((t) => t && t.id === add.from);
  if (!from || !Array.isArray(from.items)) return null;
  const picked = add.at ? add.at.map((i) => from.items.find((it) => srcAt(it, i)))
    : add.shown.map((s) => from.items.find((it) => it.shown === s));
  return picked.every(Boolean) ? picked : null;
}

/** One task with the counts applied (the same object when the plan has nothing for it). */
function countsTask(battery, task) {
  const plan = task && PLAN[task.id];
  if (!plan) return task;
  const out = { ...task };
  if (plan.practice != null && Array.isArray(task.practice)) out.practice = task.practice.slice(0, plan.practice);
  if (plan.question_timeout_s != null) out.question_timeout_s = plan.question_timeout_s;
  if (plan.add) {
    const spares = sparesFor(battery, plan.add);
    if (!spares) return task;
    const items = task.items.slice();
    spares.forEach((s) => items.push(asItem(task, s, `${task.id}.${pad(items.length + 1)}`)));
    out.items = items;
    if (Array.isArray(task.grid)) out.grid = items.map((it) => it.show);
  }
  return out;
}

function withCounts(battery) {
  if (!battery || !Array.isArray(battery.tasks) || !battery.tasks.some((t) => t && PLAN[t.id])) return battery;
  return { ...battery, tasks: battery.tasks.map((t) => countsTask(battery, t)) };
}

module.exports = { PLAN, withCounts, countsTask };
