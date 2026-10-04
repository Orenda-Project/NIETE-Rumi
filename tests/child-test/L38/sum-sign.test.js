/**
 * The committed bank stores sums as {a, b, answer} with no operator (CONTRACT §21.3): the task says
 * which. The renderer read an `op` field that only the test fixture had, so every subtraction sheet
 * and coach card printed "+" ("4 + 3 =" on the quick-subtraction page; "19 + 6 = 13" on the card).
 * Found on the contact sheet, 4 Oct night (bd-s1oo0.50.4).
 */
const REAL = require('../../../bot/shared/data/child-test/item-bank.v3.json');
const v3 = require('../../../bot/shared/services/child-test/render/v3');

const text = (h) => h.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&minus;/g, '−').replace(/\s+/g, ' ');

describe('v3 print: the sign comes from the task when the bank has no op', () => {
  for (const g of ['3', '5']) {
    const M = REAL.sets.A.maths[g];
    it(`grade ${g}: subtraction sheets and the coach card print −, addition sheets print +`, () => {
      const book = text(v3.buildBookletHtml({ bank: REAL, set: 'A', booklet: `ma${g}` }));
      const card = text(v3.buildCoachCardHtml({ bank: REAL, set: 'A', card: `ma${g}` }));
      for (const k of ['sub1', 'sub2']) {
        const x = M[k].items[0];
        expect(x.op).toBeUndefined();
        expect(book).toContain(`${x.a} − ${x.b} =`);
        expect(book).not.toContain(`${x.a} + ${x.b} =`);
        expect(card).toContain(`${x.a} − ${x.b} = ${x.answer}`);
      }
      for (const k of ['add1', 'add2']) {
        const x = M[k].items[0];
        expect(book).toContain(`${x.a} + ${x.b} =`);
        expect(card).toContain(`${x.a} + ${x.b} = ${x.answer}`);
      }
    });
  }
});
