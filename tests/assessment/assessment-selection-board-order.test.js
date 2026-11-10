'use strict';
/**
 * bd-cmd4sl: the editor lists a board (G6-12 FBISE/FDE) paper in the order the PDF prints it — Section A, B, C,
 * slot by slot — not by question type.
 *
 * The editor's list is Selection.indexQuestions. It ordered a board paper by type name (assessment-order), and
 * board types (srq, erq, grammar, essay…) mostly tie there, so the order fell back to jsonb's key order
 * (shortest key first, then bytewise): `erq` (Section C) came before `srq` (Section B), while the PDF, which
 * walks `_layout`, printed B before C. A type both sections use (SSC-II English `grammar`) sits in one list, so
 * no type ranking can split it: only the slot each item carries can.
 */
const path = '../../bot/shared/services/assessment/';
const { buildLayout } = require(`${path}board-layout`);
const { indexQuestions } = require(`${path}assessment-selection`);
const ssc1 = require(`${path}patterns/board/fbise-ssc1`);
const ssc2 = require(`${path}patterns/board/fbise-ssc2`);

const firstVariant = (pat, key) => pat.subjects[key].variants[0];

/** Object keys in the order Postgres jsonb hands them back: shorter first, then bytewise. */
function jsonbOrder(obj) {
  if (Array.isArray(obj)) return obj.map(jsonbOrder);
  if (!obj || typeof obj !== 'object') return obj;
  const keys = Object.keys(obj).sort((a, b) => Buffer.byteLength(a) - Buffer.byteLength(b) || Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return Object.fromEntries(keys.map((k) => [k, jsonbOrder(obj[k])]));
}

/** A paper as the board writer stores it: unseen.<category>.<type>[], each item stamped with its slot. */
function paperFor(pattern, subject) {
  const L = buildLayout(pattern, firstVariant(pattern, subject), { subject, sections: [] });
  const unseen = {};
  for (const s of L.slots) {
    if (!s.generate) continue;
    const cat = (unseen[s.category] = unseen[s.category] || {});
    const list = (cat[s.type] = cat[s.type] || []);
    for (let i = 0; i < Math.min(s.generate, 2); i += 1) list.push({ question: `${s.slot} item ${i + 1}`, marks: s.marks_each, slot: s.slot });
  }
  return { L, examJson: jsonbOrder({ unseen, _layout: L }) };
}

/** The slots, section by section, in the layout's order: the order the PDF prints them. */
const printedSlots = (L) => L.sections.flatMap((sec) => L.slots.filter((s) => s.section === sec.id && s.generate).map((s) => s.slot));
const sectionOf = (L) => (slot) => L.slots.find((s) => s.slot === slot).section;
const runs = (xs) => xs.filter((x, i) => i === 0 || x !== xs[i - 1]);

describe('editor list of a board paper follows the printed sections (bd-cmd4sl)', () => {
  test('SSC-I biology: Section B (srq) is listed before Section C (erq)', () => {
    const { L, examJson } = paperFor(ssc1, 'biology');
    const items = indexQuestions(examJson);
    expect(runs(items.map((q) => sectionOf(L)(q.question.slot)))).toEqual(['A', 'B', 'C']);
  });

  test('SSC-II English: a type both sections use (grammar) is split back into its own slots', () => {
    const { L, examJson } = paperFor(ssc2, 'english');
    const items = indexQuestions(examJson);
    expect(runs(items.map((q) => q.question.slot))).toEqual(printedSlots(L));
    expect(runs(items.map((q) => sectionOf(L)(q.question.slot)))).toEqual(['A', 'B', 'C']);
  });

  test('ids do not change: the same addresses, only listed in another order', () => {
    const { examJson } = paperFor(ssc2, 'english');
    const { _layout, ...bare } = examJson;
    const ids = (xs) => xs.map((q) => q.id).sort();
    expect(ids(indexQuestions(examJson))).toEqual(ids(indexQuestions(bare)));
  });

  test('numbers run 1..n down the new order; a removed item keeps its place and has no number', () => {
    const { examJson } = paperFor(ssc1, 'biology');
    const first = indexQuestions(examJson)[0];
    const [cat, type, index] = first.id.split('.').slice(1);
    examJson.unseen[cat][type][Number(index)].removed = true;
    const items = indexQuestions(examJson);
    expect(items[0]).toMatchObject({ id: first.id, removed: true, number: null });
    expect(items.filter((q) => !q.removed).map((q) => q.number)).toEqual(items.slice(1).map((_, i) => i + 1));
  });

  test('a standard (non-board) paper keeps its type order', () => {
    const tree = { seen: { subjective: { 'Short Questions': [{ question: 's', marks: 2 }] }, objective: { MCQs: [{ question: 'm', marks: 1 }] } } };
    expect(indexQuestions(tree).map((q) => q.type)).toEqual(['MCQs', 'Short Questions']);
  });
});
