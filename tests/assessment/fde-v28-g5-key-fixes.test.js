/**
 * v27 Grade 5 keys that paid for what the paper never asked (bd-5jmnfj.4.58.3):
 *   Science Q2 (a), the food chain, paid 1.5 marks for "Draws arrows" on a paper that prints no arrows and
 *   whose children are told never to draw them; G5 Urdu Q7 paid one mark for a title (عنوان) when the
 *   instruction asks for none. keyFixes drops the point, keeps the item's total by moving the marks to the
 *   first remaining point, and strips the arrows clause from the model answer.
 */

const { keyFixes } = require('../../bot/shared/services/assessment/fde-g5-key-fixes');

const paper = (byType, slots) => ({
  unseen: { subjective: byType },
  _layout: { sections: [{ id: 'B', slots }] },
});
const itemsOf = (ex) => Object.values(ex.unseen.subjective).flat();
const total = (q) => q.scheme.points.reduce((s, p) => s + p.marks, 0);

describe('Science Q2 (a): no marks for arrows', () => {
  const chain = () => paper({
    'Draw and Label': [{
      slot: 'science.B.Q2a', question: 'A food chain', marks: 7,
      answer: 'Grass, grasshopper, frog, snake, with arrows showing the flow of energy; each living thing labelled.',
      scheme: { points: [
        { kind: 'L', text: 'Names four living things in a feeding order', marks: 2 },
        { kind: 'L', text: 'Draws arrows pointing from the food to the one that eats it', marks: 1.5 },
        { kind: 'L', text: 'Starts with a plant', marks: 1.5 },
        { kind: 'L', text: 'Labels each living thing', marks: 2 },
      ] },
    }],
  }, [{ slot: 'science.B.Q2a', type: 'Draw and Label', instruction_en: 'Draw and label any one.' }]);

  test('the arrows point goes, its marks move to the first point, the total stays 7', () => {
    const before = itemsOf(chain())[0];
    const { examJson, notes } = keyFixes(chain());
    const q = itemsOf(examJson)[0];
    expect(q.scheme.points.map((p) => p.text)).not.toEqual(expect.arrayContaining([expect.stringMatching(/arrows?/i)]));
    expect(q.scheme.points).toHaveLength(3);
    expect(q.scheme.points[0].marks).toBe(3.5);
    expect(total(q)).toBe(total(before));
    expect(notes.some((n) => /science\.B\.Q2a/.test(n) && /arrow/i.test(n))).toBe(true);
  });

  test('the model answer loses its arrows clause and keeps the chain', () => {
    const { examJson } = keyFixes(chain());
    const q = itemsOf(examJson)[0];
    expect(q.answer).not.toMatch(/arrows?/i);
    expect(q.answer).toMatch(/Grass, grasshopper, frog, snake/);
    expect(q.answer).toMatch(/each living thing labelled/);
  });
});

describe('Urdu Q7: no mark for a title the instruction does not ask for', () => {
  const q7 = (instruction_ur) => paper({
    'Picture Description': [{
      slot: 'urdu.C.Q7', question: 'پارک کی سیر', marks: 10,
      scheme: { points: [
        { kind: 'K', text: 'مناسب عنوان', marks: 1 },
        { kind: 'K', text: 'چھ مددگار الفاظ کا درست استعمال', marks: 6 },
        { kind: 'K', text: 'تصویر کے مطابق جملے', marks: 3 },
      ] },
    }],
  }, [{ slot: 'urdu.C.Q7', type: 'Picture Description', instruction_ur }]);

  test('dropped when the instruction has no عنوان; marks move to the first remaining point', () => {
    const { examJson, notes } = keyFixes(q7('کوئی سے چھ مددگار الفاظ کی مدد سے تصویر کی وضاحت لکھیں۔'));
    const q = itemsOf(examJson)[0];
    expect(q.scheme.points.map((p) => p.text)).toEqual(['چھ مددگار الفاظ کا درست استعمال', 'تصویر کے مطابق جملے']);
    expect(q.scheme.points[0].marks).toBe(7);
    expect(total(q)).toBe(10);
    expect(notes.some((n) => /urdu\.C\.Q7/.test(n))).toBe(true);
  });

  test('kept when the instruction asks for a title', () => {
    const { examJson, notes } = keyFixes(q7('عنوان لکھ کر تصویر کی وضاحت لکھیں۔'));
    expect(itemsOf(examJson)[0].scheme.points).toHaveLength(3);
    expect(notes).toEqual([]);
  });
});
