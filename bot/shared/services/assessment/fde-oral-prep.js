'use strict';
/**
 * Before-exam notes an oral task asks of the teacher (bd-5jmnfj.4.58.4). The G1 Urdu project (10 marks) needs a
 * picture or object the child made, and the 4-mark «کام بچے کا اپنا» criterion can only be judged if the teacher
 * saw it made. A task carries `prep_en` / `prep_ur`; the key's "Teacher: before the exam" box prints them.
 * Pure: the oral part in, the notes (strings) out.
 */

/** The prep notes of an oral part's tasks, in task order, in `lang` ('ur' or 'en'). */
function prepLines(oral, lang) {
  const tasks = oral && Array.isArray(oral.tasks) ? oral.tasks : [];
  return tasks.map((t) => t && t[`prep_${lang === 'ur' ? 'ur' : 'en'}`]).filter((l) => typeof l === 'string' && l.trim());
}

module.exports = { prepLines };
