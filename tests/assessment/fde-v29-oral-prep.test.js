/**
 * v28 G1 Urdu oral project (bd-5jmnfj.4.58.4): the 10-mark project needs a picture or object the child made, but
 * the teacher's before-exam notes never told the teacher to have the class make one, so the criterion «کام بچے کا
 * اپنا» could not be checked. A task that needs child-made work carries a `prep` note; prepLines puts it in the
 * box «Teacher: before the exam», and the G1 project task carries the note and the lesson-title rule (defect 6:
 * «ہماری کتاب کے خیال: میں خاص ہوں کتاب۔» was model text with a stray word after the title).
 */

const { prepLines } = require('../../bot/shared/services/assessment/fde-oral-prep');
const g1 = require('../../bot/shared/services/assessment/patterns/early/g1-urdu');
const g2 = require('../../bot/shared/services/assessment/patterns/early/g2-urdu');
const { oralPrompt } = require('../../bot/shared/services/assessment/fde-early-prompt');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const visible = (html) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('G1 Urdu project: the teacher has the class make the work first', () => {
  test('the project task carries a note in both languages naming the day or two before', () => {
    const t = g1.oral.tasks.find((x) => x.id === 'project');
    expect(t.prep_ur).toMatch(/ایک دو دن پہلے/);
    expect(t.prep_ur).toMatch(/کلاس میں/);
    expect(t.prep_en).toMatch(/day or two before/);
    expect(t.prep_en).toMatch(/in class/);
  });

  test('prepLines gives the note of each task that has one, in the paper language', () => {
    expect(prepLines(g1.oral, 'ur')).toEqual([g1.oral.tasks.find((x) => x.id === 'project').prep_ur]);
    expect(prepLines(g1.oral, 'en')).toHaveLength(1);
    expect(prepLines(g2.oral, 'ur')).toEqual([]);
    expect(prepLines(null, 'ur')).toEqual([]);
  });

  test('the key\'s before-the-exam box prints it', () => {
    const P = Patterns.get('fde_g1_2026').subjects.urdu;
    const tree = { unseen: { objective: {}, subjective: {} } };
    P.sections.forEach((sec) => sec.slots.forEach((slot) => {
      const list = (tree.unseen[slot.category][slot.type] = tree.unseen[slot.category][slot.type] || []);
      for (let i = 0; i < slot.generate; i += 1) {
        list.push({ slot: slot.slot, question: `سوال ${i + 1}`, marks: slot.marks_each, blooms: Object.keys(sec.levels)[0], answer: 'جواب', scheme: { points: [{ kind: 'K', text: 'درست', marks: slot.marks_each }] } });
      }
    }));
    const { examJson } = applyLayout(tree, P, { kind: 'fde', chapters: null, pages: null }, { now: '2026-10-30T07:00:00.000Z' });
    examJson._layout.subject = 'urdu';
    examJson._layout.oral = { ...P.oral, content: P.oral.tasks.map((t) => ({ id: t.id, items: [{ ask: 'س؟', answer: 'ج' }] })) };
    const key = visible(R.renderMarkingScheme({ examJson, grade: 1, subject: 'urdu' }));
    expect(key).toContain('امتحان سے ایک دو دن پہلے');
  });
});

describe('G1 Urdu project script grammar (defect 6)', () => {
  test('the project ask names the lesson title inside a whole sentence, never after a colon or with a stray word', () => {
    const ask = g1.oral.tasks.find((x) => x.id === 'project').ask;
    expect(ask).toMatch(/lesson title/);
    expect(ask).toMatch(/whole Urdu sentence/);
    expect(ask).toMatch(/never after a colon/);
  });

  test('the oral prompt carries the same rule for every spoken line', () => {
    expect(oralPrompt({ oral: g1.oral, grade: 1, P: g1, pageContent: 'book' })).toMatch(/title or name from the book is written inside a complete sentence/);
  });
});
