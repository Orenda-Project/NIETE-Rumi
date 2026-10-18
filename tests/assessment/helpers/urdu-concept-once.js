/**
 * The Urdu Q1 items the full syllabus no longer prints because they ask the antonym or the synonym
 * concept a second time (a concept is asked once on every scope). Read by the layout's own concept
 * rows, against every lesson; the first item of each concept stays. Tests of other rules subtract
 * these from what they expect a full-syllabus layout to keep.
 */
const { conceptOf } = require('../../../bot/shared/services/assessment/fde-layout');
const Patterns = require('../../../bot/shared/services/assessment/patterns');

const LESSONS = Patterns.get('fde_g5_2027').subjects.urdu.lessons;
const ONCE = new Set(['antonym', 'synonym']);

// `list`: Q1 items in reply order. Returns the stems of the repeats.
function conceptRepeats(list) {
  const seen = new Set();
  const out = [];
  for (const q of list) {
    const c = conceptOf(q, LESSONS);
    if (!ONCE.has(c)) continue;
    if (seen.has(c)) out.push(q.question);
    seen.add(c);
  }
  return out;
}

module.exports = { conceptRepeats };
