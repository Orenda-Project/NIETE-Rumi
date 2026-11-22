/**
 * bd-5jmnfj.38.35 (A5e) — G7 General Science ch1 asked 7/7/6 and the extended-answer slot was turned into
 * short answers to fit the time, silently. The shortfall against the request is now recorded as an issue.
 */
const Rules = require('../../bot/shared/services/assessment/free-secondary-rules');
const { typeShortfall } = require('../../bot/shared/services/assessment/free-secondary-mix');

const T = (mcq, srq, erq) => [{ id: 'mcq', count: mcq }, { id: 'srq', count: srq }, { id: 'erq', count: erq }];

describe('typeShortfall', () => {
  it('is empty when the planned mix is the requested mix', () => {
    expect(typeShortfall(T(7, 7, 6), T(7, 7, 6))).toEqual([]);
  });
  it('names each type that is short, with how many were asked and planned', () => {
    const out = typeShortfall(T(7, 7, 6), T(7, 11, 2));
    expect(out).toEqual([{ n: 0, check: 'type-shortfall', id: 'erq', requested: 6, planned: 2,
      text: expect.stringMatching(/erq.*6.*2/) }]);
  });
  it('sees the real conversion made by sizeTypes on a 7/7/6 request', () => {
    const sized = Rules.sizeTypes(T(7, 7, 6), 7);
    const out = typeShortfall(T(7, 7, 6), sized.types);
    expect(sized.converted).toBeGreaterThan(0);
    expect(out.map((o) => o.id)).toContain('erq');
  });
});
