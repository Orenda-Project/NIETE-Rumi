'use strict';
/**
 * bd-5knlj — the two-button LP prompt reads "Do YOU have a lesson plan?" and its
 * Yes path demands a document. On a leader observation the tapper is a COACH
 * standing beside the teacher's PAPER plan: 71% of observations ended "No".
 * The observation variant asks about the teacher's plan and says a photo works.
 */
const { buildLPSelectionList } = require('../../bot/shared/services/coaching/lp-coaching/lp-selection-list.service');

describe('the Yes/No prompt on a leader observation', () => {
  it('asks about the TEACHER\'s plan and offers the photo route', () => {
    const p = buildLPSelectionList('cs-1', [], 'en', null, { isObservation: true });
    expect(p.type).toBe('buttons');
    expect(p.body).toMatch(/teacher/i);
    expect(p.body).toMatch(/photo/i);
  });
  it('the teacher self-record copy is unchanged', () => {
    const p = buildLPSelectionList('cs-1', [], 'en', null);
    expect(p.body).toBe('Do you have a lesson plan for this class?');
  });
  it('the Urdu observation variant exists and stays within button caps', () => {
    const p = buildLPSelectionList('cs-1', [], 'ur', null, { isObservation: true });
    expect(p.body).toMatch(/استاد/);
    p.buttons.forEach((b) => expect([...b.title].length).toBeLessThanOrEqual(20));
  });
});

describe('the list with recent plans: "Upload new" names all three ways in', () => {
  const recent = [{ id: 'a1', lesson_id: 'grade_4_math_ch5_seg3', topic: 'Comparing fractions', grade: 4, subject: 'math', chapter_number: 5, created_at: new Date().toISOString() }];
  const uploadRow = (lang) => buildLPSelectionList('cs-1', recent, lang, null, { isObservation: true })
    .listData.action.sections.flatMap((s) => s.rows).find((r) => r.id === 'lp_upload_cs-1');

  it('says a photo, a PDF, or typing it all work, within the row cap', () => {
    const r = uploadRow('en');
    expect(r.title).toBe('Upload new');
    expect(r.description).toMatch(/photo/i);
    expect(r.description).toMatch(/PDF/);
    expect(r.description).toMatch(/type/i);
    expect([...r.description].length).toBeLessThanOrEqual(72);
  });
  it('the Urdu row says the same', () => {
    const r = uploadRow('ur');
    expect(r.description).toMatch(/تصویر/);
    expect(r.description).toMatch(/PDF/);
    expect([...r.description].length).toBeLessThanOrEqual(72);
  });
});
