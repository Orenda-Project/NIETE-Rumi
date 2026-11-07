/**
 * bd-5jmnfj.39.1: a slot the teacher writes before photocopying (G5 Islamiat Q3, the dua or
 * durood the child translates). The model writes nothing there, so the slot is full by
 * definition: it prints a labelled space with the teacher's note, and the key tells her
 * she marks it herself. No sacred text is ever generated or printed by the engine.
 */

const TeacherSlot = require('../../bot/shared/services/assessment/fde-teacher-slot');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const Q3 = Patterns.get('fde_g5_2027').subjects.islamiat.sections[1].slots[0];
const text = (v) => String(v);
const ctx = { medium: 'ur' };

describe('a teacher-filled slot', () => {
  it('counts as holding the items it must answer; any other slot counts its items', () => {
    expect(TeacherSlot.counted(Q3, 0)).toBe(1);
    expect(TeacherSlot.counted({ attempt: 5, teacher_fills: false }, 3)).toBe(3);
    expect(TeacherSlot.counted({ attempt: 5 }, 3)).toBe(3);
  });

  it('prints the head, the teacher note and a writing space of the slot\'s lines', () => {
    const html = TeacherSlot.paperBlock(Q3, '<div class="slot-head">HEAD</div>', ctx, text);
    expect(html).toContain('HEAD');
    expect(html).toContain(Q3.teacher_note_ur);
    expect(html).toContain(`data-slot="${Q3.slot}"`);
    expect((html.match(/class="fill-line"/g) || []).length).toBe(Q3.lines);
  });

  it('gives the marking scheme one row saying the teacher marks it, with its marks', () => {
    const row = TeacherSlot.keyRow(Q3, 'سوال نمبر 3', ctx, text);
    expect(row).toContain(`data-row="${Q3.slot}"`);
    expect(row).toContain(Q3.key_note_ur);
    expect(row).toContain('10');
  });

  it('every other slot gets no row and no block from here', () => {
    expect(TeacherSlot.keyRow({ slot: 'x', teacher_fills: false }, 'Q', ctx, text)).toBe('');
  });
});
