const { mapItems, itemsOf, slotTypes, URDU_EARLY } = require('../../bot/shared/services/assessment/fde-early-urdu-walk');

const ex = () => ({
  unseen: { subjective: { Verbs: [{ slot: 'g2.urdu.A.Q4', question: 'a' }, { slot: 'g2.english.A.Q1', question: 'b' }] } },
  _layout: { sections: [{ slots: [{ slot: 'g2.urdu.A.Q4', type: 'Verbs' }] }] },
});

describe('early Urdu walk', () => {
  test('maps only early Urdu items, passing the slot type, and does not change the input', () => {
    const input = ex();
    const out = mapItems(input, (q, type) => ({ ...q, type }));
    expect(out.unseen.subjective.Verbs[0].type).toBe('Verbs');
    expect(out.unseen.subjective.Verbs[1].type).toBeUndefined();
    expect(input.unseen.subjective.Verbs[0].type).toBeUndefined();
  });
  test('itemsOf lists a slot\'s items; slotTypes reads the layout; the pattern matches G1 and G2 Urdu only', () => {
    expect(itemsOf(ex(), 'g2.urdu.A.Q4')).toHaveLength(1);
    expect(slotTypes(ex()).get('g2.urdu.A.Q4')).toBe('Verbs');
    expect(URDU_EARLY.test('g1.urdu.B.Q10')).toBe(true);
    expect(URDU_EARLY.test('g2.english.A.Q1')).toBe(false);
  });
});
