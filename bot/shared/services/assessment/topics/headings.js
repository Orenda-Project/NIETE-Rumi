'use strict';
/**
 * Language skill types -> the heading a teacher sees (spec §4.1), in a fixed order,
 * and skill-label text inside a topic cell -> skill type. Pure.
 */
const HEADINGS = {
  english: {
    phonics: ['Phonics', 1],
    reading_comprehension: ['Reading', 2],
    pre_reading: ['Reading', 2],
    vocabulary_grammar: ['Vocabulary & grammar', 3],
    oral_communication: ['Oral communication', 4],
    writing: ['Writing', 5],
  },
  urdu: {
    arkaan_saazi: ['ارکان سازی', 1],
    qawaid: ['قواعد', 2],
    buland_khwani: ['بلند خوانی', 3],
    tafheem: ['تفہیم', 4],
    alfaaz_maani: ['الفاظ و معانی', 5],
    takhleeqi_likhai: ['تخلیقی لکھائی', 6],
  },
};

const LABELS = {
  english: [
    ['phonics', 'phonics'], ['reading', 'reading_comprehension'], ['grammar', 'vocabulary_grammar'],
    ['vocabulary', 'vocabulary_grammar'], ['oral', 'oral_communication'], ['speaking', 'oral_communication'],
    ['writing', 'writing'],
  ],
  urdu: [
    ['ارکان سازی', 'arkaan_saazi'], ['قواعد', 'qawaid'], ['بلند خوانی', 'buland_khwani'], ['تفہیم', 'tafheem'],
    ['نئے الفاظ', 'alfaaz_maani'], ['الفاظ و معانی', 'alfaaz_maani'], ['تخلیقی', 'takhleeqi_likhai'],
    ['تخیل کی تختی', 'takhleeqi_likhai'],
  ],
};

function headingFor(subject, skill) {
  const table = HEADINGS[subject];
  if (!table) throw new Error(`no skill headings for subject "${subject}"`);
  const hit = table[skill];
  if (!hit) throw new Error(`no heading for skill type "${skill}" in ${subject}`);
  return { heading: hit[0], headingOrder: hit[1] };
}

function skillFromLabel(subject, label) {
  if (!label || !LABELS[subject]) return null;
  const text = label.toLowerCase();
  const hit = LABELS[subject].find(([needle]) => text.includes(needle));
  return hit ? hit[1] : null;
}

module.exports = { headingFor, skillFromLabel };
