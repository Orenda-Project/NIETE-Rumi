'use strict';
/**
 * bd-zrdvmi.44.1 — ICT feedback sheet, Lesson Plan row 728: "No paraphrasing there" on the G9
 * English poem 'Travel'. bd-zrdvmi.6 added brief rule 12 (a poem lesson teaches a paraphrase of the
 * poem, in class); on 21 Nov main's code wrote that lesson again with the word only in the
 * differentiation and marking notes. A brief rule the model may skip is not a fix, so the ladder
 * checks it here, as lp612-reading-step.js does for reading time.
 *
 * A poem READING lesson (title names a poem / نظم, skill is a reading type) must, in class (any
 * section but homework), have the teacher model a paraphrase AND give the pupils one to do.
 * A miss is a `POEM_PARAPHRASE:` defect, so it buys a revision round. Pure: no I/O.
 */

const POEM_READING_SKILLS = new Set(['tafheem', 'reading_comprehension', 'buland_khwani']);
const POEM_TITLE = /\bpoem\b|نظم/i;
const PARAPHRASE = /paraphras|in (?:plain|simple|everyday|their own|your own|our own) words|مفہوم|تشریح|آسان الفاظ|سادہ الفاظ|اپنے الفاظ/i;
/** Blocks where pupils do the work (We Do / You Do). */
const PUPIL_SECTIONS = new Set(['activity']);

function textOf(node, out = []) {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((n) => textOf(n, out));
  else if (node && typeof node === 'object') Object.values(node).forEach((n) => textOf(n, out));
  return out.join(' ');
}

function isPoemReading(title, skillType) {
  return POEM_READING_SKILLS.has(skillType) && POEM_TITLE.test(String(title || ''));
}

/**
 * @param {object} doc        the lp_doc
 * @param {string} skillType  the segment's skill_type
 * @param {string} title      the segment's subtopic_title
 * @returns {string[]} zero or one `POEM_PARAPHRASE: …` defect
 */
function poemParaphraseDefects(doc, skillType, title) {
  if (!isPoemReading(title, skillType) || !doc || !Array.isArray(doc.sections)) return [];
  let teacher = false;
  let pupils = false;
  for (const sec of doc.sections) {
    if (!sec || sec.id === 'homework') continue;
    for (const b of sec.blocks || []) {
      if (!b || typeof b !== 'object' || !PARAPHRASE.test(textOf(b))) continue;
      if (PUPIL_SECTIONS.has(sec.id)) pupils = true;
      else teacher = true;
    }
  }
  if (teacher && pupils) return [];
  const missing = [!teacher && 'the teacher modelling it', !pupils && 'a We Do / You Do step where pupils paraphrase one stanza themselves']
    .filter(Boolean).join(' and ');
  return [`POEM_PARAPHRASE: this is a poem reading lesson and the class never paraphrases the poem (missing: ${missing}). `
    + "Before the devices and the central idea, go stanza by stanza: the poet's words, then the same idea in plain "
    + 'everyday words (say "paraphrase" / «مفہوم»), and have pupils paraphrase one stanza in their own words. '
    + 'A paraphrase only in homework, differentiation or the key does not count.'];
}

module.exports = { POEM_READING_SKILLS, isPoemReading, poemParaphraseDefects };
