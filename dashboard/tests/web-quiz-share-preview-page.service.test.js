/**
 * The page's half of a fast link preview: when the card opens, the links the child may share are fetched once
 * with HEAD, so the edge knows those codes before WhatsApp's preview fetch arrives. A challenge code is new at
 * finish; nobody has opened it yet, so without this the sender's preview waited for the whole quiz.
 * Runs the whole shipped page in the harness's vm.
 */
const { page } = require('./wq-page-harness');

const CARD = 'c.DwjiGhssTV6PkKGyw9Tl9g.abcdefghijkl';
const INVITE = 'i.CHAL12.mnopqrstuvwx';
const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 }, art: { card: CARD, invite: INVITE } };
const finished = (result = RESULT) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result } });
const heads = (p) => p.fetches.filter((f) => f.init && f.init.method === 'HEAD').map((f) => f.url);

describe('the card opening warms the links it offers to share', () => {
  test('the challenge link and the class card link are each fetched once with HEAD', () => {
    const p = page({ lang: 'en', store: finished() });
    const h = heads(p);
    expect(h.filter((u) => /\/q\/CHAL12$/.test(u))).toHaveLength(1);
    expect(h.filter((u) => u.indexOf(`/q/TEST?a=${encodeURIComponent(CARD)}`) >= 0)).toHaveLength(1);
  });

  test('coming back to the card does not fetch them again', () => {
    const p = page({ lang: 'en', store: finished() });
    p.els['#wq-share'].fire('click');
    p.els['#wq-back'].fire('click');
    expect(heads(p).filter((u) => /\/q\/CHAL12$/.test(u))).toHaveLength(1);
  });

  test('an Urdu card warms the same way', () => {
    const p = page({ lang: 'ur', store: finished() });
    expect(heads(p).filter((u) => /\/q\/CHAL12$/.test(u))).toHaveLength(1);
  });
});
