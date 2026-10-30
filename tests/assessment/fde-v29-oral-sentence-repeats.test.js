/**
 * v28 G2 Urdu (bd-5jmnfj.4.58.4): the oral poem's line 9 and its answer «بلبل گانا گائے گی» repeat the written
 * Q4 i sentence «بلبل گانا گائے گی۔». A heard poem line or answer must not be a sentence the child reads on the
 * written paper. oralSentenceRepeats flags the written item, whole-sentence match after stripping punctuation;
 * answerRepeats carries the flag, so the writer re-asks that written section like any other give-away.
 */

const { oralSentenceRepeats } = require('../../bot/shared/services/assessment/fde-oral-sentence-repeats');
const { answerRepeats, writtenGiveaways } = require('../../bot/shared/services/assessment/fde-answer-repeats');

const POEM = 'کالے بادل آئیں گے\nآکر مینہ برسائیں گے\nبلبل گانا گائے گی۔\nکوئل راگ سنائے گی\nکالے بادل آئیں گے';
const paper = (written, oralItems = [{ ask: 'بلبل کیا کرے گی؟', answer: 'بلبل گانا گائے گی۔' }]) => ({
  unseen: { objective: { Verbs: written } },
  _layout: {
    sections: [{ id: 'A', slots: [{ slot: 'g2.urdu.A.Q4', type: 'Verbs' }] }],
    oral: {
      tasks: [{ id: 'poem', kind: 'listening' }, { id: 'holidays', kind: 'speaking' }],
      content: [{ id: 'poem', script: POEM, items: oralItems }, { id: 'holidays', items: [{ ask: 'آپ کہاں گئے؟', answer: 'میں نانی کے گھر گیا۔' }] }],
    },
  },
});
const q = (question) => ({ slot: 'g2.urdu.A.Q4', question, answer: 'x' });

describe('G2 Urdu oral poem against the written stems', () => {
  test('Q4 i printing a poem line is flagged, whatever the punctuation', () => {
    const flags = oralSentenceRepeats(paper([q('بلبل گانا گائے گی۔'), q('بچہ کھانا کھاتا ہے۔')]));
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ slot: 'g2.urdu.A.Q4', reason: 'giveaway', printed: true });
    expect(flags[0].words).toEqual(['بلبل گانا گائے گی']);
    expect(flags[0].with).toEqual(['oral-poem']);
  });

  test('a poem answer equal to a written stem is flagged even when the poem lines differ', () => {
    const ex = paper([q('بلبل گانا گائے گی۔')]);
    ex._layout.oral.content[0].script = 'کالے بادل آئیں گے\nکوئل راگ سنائے گی';
    expect(oralSentenceRepeats(ex)).toHaveLength(1);
  });

  test('different sentences, and a partial overlap, are not flagged', () => {
    expect(oralSentenceRepeats(paper([q('بچہ کھانا کھاتا ہے۔'), q('بلبل گانا گاتی ہے۔'), q('گانا')]))).toEqual([]);
  });

  test('a speaking task is not a heard poem; a paper with no oral part is clean', () => {
    const ex = paper([q('میں نانی کے گھر گیا۔')]);
    expect(oralSentenceRepeats(ex)).toEqual([]);
    delete ex._layout.oral;
    expect(oralSentenceRepeats(ex)).toEqual([]);
  });

  test('answerRepeats carries it and the written section is the one to re-ask', () => {
    const flags = answerRepeats(paper([q('بلبل گانا گائے گی۔')]));
    const hit = flags.find((f) => f.with.includes('oral-poem'));
    expect(hit.slot).toBe('g2.urdu.A.Q4');
    expect(writtenGiveaways(flags).map((f) => f.slot)).toContain('g2.urdu.A.Q4');
  });
});
