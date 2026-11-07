'use strict';
// Part of assessment-generation.service.js (see its header); split for the 300-line limit, bd-5jmnfj.37.
const { firstAsk } = require('./section-calls');

// Urdu: the text the model writes itself (a model answer, a passage, a scheme point) never carries
// a religious maxim, hadith, verse or act of worship. Matched on _heldNorm text, whole words. The
// operator-allowed classes («اللہ تعالیٰ کرے», «میری دعا ہے کہ», greetings, «دعا» in a letter) are
// not in the list; «ایمان داری» (honesty) is not «ایمان کا حصہ».
// The imperative and the obligation; «پڑھوں گا», «پڑھیں گے», «پڑھو گے» are a future, not an exhortation.
const URDU_EXHORT = '(?:و(?!ں| گ[ےیا])|یں(?! گ[ےیا])|ا کرو|ا کریں|نا چاہی|نی چاہی|نے چاہی)';
const HELD_TERMS_URDU_AUTHORED = Object.freeze([
  { term: 'ایمان کا حصہ', pattern: 'ایمان کا حصہ' },
  { term: 'نصف ایمان', pattern: 'نصف ایمان' },
  { term: 'حدیث', pattern: 'حدیث(?:یں|وں|ی)?|احادیث' },
  { term: 'فرمایا', pattern: 'فرمای[اے]' },
  { term: 'قرآن', pattern: 'قران(?:ی|ے)?' },
  { term: 'آیت', pattern: 'ایت(?:یں|وں)?|ایات' },
  { term: 'ارشاد', pattern: 'ارشاد' },
  // v38 G4 Urdu Q5 accept «اللہ کی بنائی ہوئی کائنات»: a creator premise is the model's own religious claim.
  // «اللہ تعالیٰ کرے» (a wish) is operator-allowed and does not match.
  { term: 'اللہ کی بنائی', pattern: 'اللہ(?: تعالی)?(?: کی بنا(?:ئ|ی)|(?: نے| ہی نے)[^۔.!?؟]{0,40}?(?:پیدا ک|بنا(?:ی|ئ)))', open: true },
  // Worship is held as an exhortation or an obligation («نماز پڑھو», «پڑھنی چاہیے», «روزہ رکھنا فرض ہے»);
  // a narrated routine («صبح اٹھ کر نماز پڑھتا») is the prompt line's, not a maxim.
  { term: 'نماز پڑھ', pattern: `نماز ?پڑھ${URDU_EXHORT}`, open: true },
  { term: 'روزہ رکھ', pattern: `روز[ہے] ?رکھ${URDU_EXHORT}`, open: true },
  // «فرض» is also "duty" («اپنا فرض سمجھا»): only the obligation predicate is held.
  { term: 'فرض', pattern: '(?:نماز|روز[ہے])[^۔.!?؟]{0,40}?(?:پر (?:فرض|لازم)|(?:فرض|لازم) ہ(?:ے|یں))' },
].concat(require('../fde-religious-terms').SUPPLICATION_HELD).map(({ term, pattern, open }) => Object.freeze({
  term, re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})${open ? '' : '(?![\\p{L}\\p{N}])'}`, 'u'),
})));

// Maths Section A's slot rule asks for 3 to 5 recall MCQs; the ToS floor needs at least 8.
const MATHS_RECALL_FROM = '3 to 5 of them pure recall';
const MATHS_RECALL_TO = 'at least 8 of them pure recall';
// Social Studies Q1's slot rule asks for 3 to 5 recall MCQs; its level count asks for at least 16.
const SST_RECALL_FROM = '3 to 5 pure recall';
const SST_RECALL_TO = 'exactly 8 of them pure recall';

/** "1 mark each", "1.25 marks each", "20 marks (parts 10 + 8 + 2)". */
function _marksPhrase(slot) {
  if (Array.isArray(slot.parts) && slot.parts.length) {
    return `${slot.marks_each} marks (parts ${slot.parts.join(' + ')})`;
  }
  return `${slot.marks_each} mark${Number(slot.marks_each) === 1 ? '' : 's'} each`;
}

/** One slot as the model is asked for it: every field read from the pattern, nothing typed. */
function _slotBlock(slot, lang) {
  const label = lang === 'ur' && slot.label_ur ? `${slot.label_en} (${slot.label_ur})` : slot.label_en;
  const asked = firstAsk(slot);
  const lines = [
    `• ${label} — generate EXACTLY ${asked} item${asked === 1 ? '' : 's'} under unseen.${slot.category}."${slot.type}"; `
      + `tag every item "slot": "${slot.slot}"; ${_marksPhrase(slot)}.`,
  ];
  if (slot.attempt < slot.generate) {
    lines.push(`  Choice: the child chooses ${slot.attempt} of ${slot.generate}; make all ${slot.generate} the same difficulty.`);
  }
  if (asked > slot.generate) {
    lines.push(`  Spares: the last ${asked - slot.generate} are spares, the same difficulty; the paper prints the first ${slot.generate} `
      + 'that ask nothing another item on this paper asks.');
  }
  if (slot.prompt_rule) lines.push(`  Rule: ${slot.prompt_rule}`);
  const g = slot.grain;
  if (g) {
    lines.push(`  Grain: ${g.kind}; numbers: ${g.number_size}; steps: ${g.steps}; `
      + `${g.unit_choice ? 'the child chooses the unit' : 'the unit is not the child\'s choice'}.`);
  }
  if (Array.isArray(slot.families) && slot.families.length) {
    lines.push(`  Families, in this order: ${slot.families.map((f) => `units ${f.units}: ${f.kinds.join(', ')}`).join('; ')}.`);
  }
  if (Array.isArray(slot.kinds) && slot.kinds.length) {
    lines.push(`  Kinds, one each in this order: ${slot.kinds.join(', ')}.`);
  }
  if (Array.isArray(slot.parts_spec)) {
    const parts = slot.parts_spec.map((p) => {
      const pick = p.pick ? ` (${Object.entries(p.pick).map(([k, n]) => `${k}: ${n}`).join(', ')})` : '';
      return `${p.key}: ${p.n} × ${p.marks_each}${pick}`;
    });
    lines.push(`  Parts: ${parts.join('; ')}.`);
  }
  if (Array.isArray(slot.alternatives)) {
    const fixed = slot.alternatives.find((a) => a.kind === 'fixed');
    if (fixed) lines.push('  Its other alternative is printed from the pattern with no key; do not write it.');
  }
  return lines.join('\n');
}

/** The closed composition lists, for a section that sets composition from them. */
function _closedLists(P, slots) {
  if (!P.closed_lists || !slots.some((s) => s.shape === 'composition')) return null;
  const lists = Object.entries(P.closed_lists).map(([name, items]) => `  closed_lists.${name}: ${items.join(' | ')}`);
  return `Composition topics come only from these closed lists, exactly as written:\n${lists.join('\n')}`;
}

// Social Studies p.29: two of the table's own cells, matched with the page store's spacing (and any zero-width mark) removed.
const SST_TIER_CELLS = ['مویشیمنڈیاں', 'تجاوزاتہٹانا'];
function _holdsTierTable(pageContent) {
  const flat = String(pageContent || '').replace(/[\s\u200b-\u200f]+/g, '');
  return SST_TIER_CELLS.every((cell) => flat.includes(cell));
}
// Pages that name a government tier (pp 26-33 in the page store) can ask a which-government item.
const SST_TIER_NAMED = /(?:وفاقی|صوبائی|مقامی)[\s\u200b-\u200f]*حکومت/;
const SST_Q1 = 'social_studies.A.Q1';

module.exports = {
  HELD_TERMS_URDU_AUTHORED, MATHS_RECALL_FROM, MATHS_RECALL_TO, SST_Q1, SST_RECALL_FROM, SST_RECALL_TO,
  SST_TIER_NAMED, _closedLists, _holdsTierTable, _slotBlock,
};
