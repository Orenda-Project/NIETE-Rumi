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
