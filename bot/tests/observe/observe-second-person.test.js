/**
 * FEAT-053 bd-34 — the coach-the-coach feedback speaks TO the officer, never
 * ABOUT them. Rida (2026-07-14): "if I am the officer who is getting coaching
 * feedback, it should be addressing me in second person rather than saying
 * the officer did this and that." Her actual concern text opened
 * "Afisa alimpokea mwalimu…" — narrating her in third person.
 */
const { buildCoachFeedbackPrompt } = require('../../shared/services/observe/observe-coach-feedback');

describe('feedback prompt mandates second person (bd-34)', () => {
  const p = buildCoachFeedbackPrompt('nakala ya mazungumzo', { language: 'sw' });

  test('states the second-person rule with concrete examples', () => {
    expect(p).toMatch(/nafsi ya pili|second person/i);   // the rule, named
    expect(p).toMatch(/"?ulisema"?|"?ulifanya"?/);        // the RIGHT form exemplified
    expect(p).toMatch(/afisa alifanya|afisa alisema/i);   // the WRONG form named as forbidden
  });

  test('the rule sits in the KANUNI (binding) section, not a suggestion', () => {
    const kanuni = p.slice(p.indexOf('KANUNI'));
    expect(kanuni).toMatch(/nafsi ya pili/i);
  });
});
