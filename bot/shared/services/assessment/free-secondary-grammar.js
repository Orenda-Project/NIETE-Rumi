'use strict';
/**
 * bd-5jmnfj.38.31 (a8) — a written item whose stem names the word class, tense or form while its scheme
 * awards a mark for identifying that type (a7 G8 Q15-20, panel A7c): the stem already prints what the
 * mark is for. Pure: reads the paper, no I/O.
 */

const { items } = require('./free-secondary-checks');

const URDU_TERMS = new Set(['اسم', 'صفت', 'فعل', 'ضمیر', 'حرف', 'مذکر', 'مؤنث', 'مونث', 'واحد', 'جمع', 'ماضی', 'حال', 'مستقبل',
  'متعلق', 'تمیز', 'فاعل', 'مفعول', 'معروف', 'مجہول']);
const ENGLISH = /\b(noun|pronoun|verb|adjective|adverb|preposition|conjunction|interjection|tense|singular|plural|active|passive|article)s?\b/i;
const TYPE_MARK = /قسم|\btypes?\b|\bkinds?\b|\bcategory\b|\bclass\b/i;
const DIACRITICS = /[ً-ٰٟ]/g;

function namedTerm(question) {
  const english = String(question || '').match(ENGLISH);
  if (english) return english[0];
  const tokens = String(question || '').replace(DIACRITICS, '').split(/[\s،۔:'"‘’“”().,!?؟-]+/);
  return tokens.find((t) => URDU_TERMS.has(t)) || null;
}

const schemeText = (item) => [...(Array.isArray(item.marking_points) ? item.marking_points.map((p) => p && p.point) : []),
  ...(Array.isArray(item.mark_bands) ? item.mark_bands.map((b) => b && b.descriptor) : [])].join(' \n ');

/** Written items whose stem names the type while a marking point or band awards identifying it. */
function statedType(examJson) {
  return items(examJson).filter((e) => !e.isMcq).flatMap(({ n, item }) => {
    const term = namedTerm(item.question);
    if (!term || !TYPE_MARK.test(schemeText(item))) return [];
    return [{ n, check: 'stated-type', text: `the stem already names the type ("${term}") but a marking point or band awards a mark for identifying it; award that mark for something the student must work out instead (a second example, or using the word in a sentence of their own), keeping the item's marks` }];
  });
}

module.exports = { statedType };
