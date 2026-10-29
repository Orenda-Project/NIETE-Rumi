/**
 * v28 G5 Urdu key rubrics (bd-5jmnfj.4.58.4). The key prints a composition's marking rows from the
 * composition-criteria template, not from scheme.points, so v28's عنوان fix (which edited scheme.points) never
 * reached them:
 *   G5 Urdu Q7 (picture description): the template row «عنوان» 1 printed although the instruction asks for no
 *   title, and the scene name «پارک کی سیر» printed in the key as if it were question text.
 *   G5 Urdu Q8 (dialogue): the template row asked «کم از کم آٹھ باتیں» against a stem of دس سے بارہ جملے.
 * adjustCriteria drops the unasked title row (its mark joins the first row kept) and takes the stem's count.
 */

const fs = require('fs');
const path = require('path');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const { criteriaFor } = require('../../bot/shared/services/assessment/composition-criteria');
const { adjustCriteria, keyStemHidden } = require('../../bot/shared/services/assessment/fde-g5-criteria');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const P = Patterns.get('fde_g5_2027');
const slotOf = (id) => P.subjects.urdu.sections.flatMap((s) => s.slots).find((s) => s.slot === id);
const sum = (rows) => rows.reduce((s, r) => s + r.marks, 0);

describe('G5 Urdu Q7: no title row when the instruction asks for no title', () => {
  const rows = () => criteriaFor('picture_description', 10, 'ur');

  test('the real slot: the عنوان row goes, its mark joins the first row kept, total 10', () => {
    const out = adjustCriteria(rows(), slotOf('urdu.C.Q7'));
    expect(out.map((r) => r.name)).not.toContain('عنوان');
    expect(out).toHaveLength(4);
    expect(out[0].name).toBe('تصویر کا بیان');
    expect(out[0].marks).toBe(5);
    expect(sum(out)).toBe(10);
  });

  test('kept when the instruction asks for a title', () => {
    const slot = { ...slotOf('urdu.C.Q7'), instruction_ur: 'عنوان لکھ کر تصویر کی وضاحت لکھیں۔' };
    expect(adjustCriteria(rows(), slot)).toEqual(rows());
  });

  test('English rows are untouched', () => {
    const en = criteriaFor('picture_description', 6, 'en');
    expect(adjustCriteria(en, { slot: 'english.C.Q10', instruction_en: 'Describe the picture.' })).toEqual(en);
  });

  test('the scene name is not printed in the key for a picture description', () => {
    expect(keyStemHidden(slotOf('urdu.C.Q7'))).toBe(true);
    expect(keyStemHidden(slotOf('urdu.C.Q8'))).toBe(false);
    expect(keyStemHidden(null)).toBe(false);
  });
});

describe('G5 Urdu Q8: the dialogue row follows the stem count', () => {
  const rows = () => criteriaFor('dialogue', 10, 'ur');

  test('«کم از کم آٹھ باتیں» becomes the stem\'s «دس سے بارہ جملے»', () => {
    const out = adjustCriteria(rows(), slotOf('urdu.C.Q8'));
    expect(out.map((r) => r.name).join('|')).not.toMatch(/آٹھ/);
    expect(out.map((r) => r.name).join('|')).toMatch(/مواد: دس سے بارہ جملے اور نتیجہ/);
    expect(out.map((r) => r.marks)).toEqual(rows().map((r) => r.marks));
  });

  test('a slot whose stem gives no count keeps the template row', () => {
    expect(adjustCriteria(rows(), { slot: 'urdu.C.Q9', or_parts_ur: ['اپنے دوست سے مکالمہ لکھیں۔'] })).toEqual(rows());
  });
});

describe('the printed Urdu key (real pattern, fixture items)', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'urdu.json'), 'utf8'));
  const laid = applyLayout(raw, P.subjects.urdu, { kind: 'fde' }, { now: '2026-10-20T07:12:00.000Z' });
  const html = R.renderMarkingScheme({ examJson: normaliseScheme(laid.examJson).examJson, grade: 5, subject: 'urdu' });
  const rowOf = (slot) => (html.match(new RegExp(`<tr data-row="${slot}"[\\s\\S]*?</tr>`, 'g')) || []).join('');

  test('Q7 prints no عنوان row and no scene name', () => {
    const q7 = rowOf('urdu.C.Q7');
    expect(q7).toMatch(/تصویر کا بیان/);
    expect(q7).not.toMatch(/عنوان/);
    expect(q7).not.toMatch(/اسکول میں کھیلوں کا دن/);
  });

  test('Q8 prints the stem count and never «آٹھ باتیں»', () => {
    const q8 = rowOf('urdu.C.Q8');
    expect(q8).toMatch(/دس سے بارہ جملے/);
    expect(q8).not.toMatch(/آٹھ باتیں/);
  });
});
