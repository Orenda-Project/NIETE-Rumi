/**
 * Web quiz page: one phone, many children. After a child finishes, the phone reopens the quiz on that
 * child's card (M10). The card offers "Someone else's turn": it forgets the finished child's session ON
 * THIS PAGE (never on the server: their result stays theirs) and goes to the landing, where the next child
 * picks themselves. Runs the whole shipped page in the harness's vm; the bot API is the faked boundary.
 */
const { page } = require('./wq-page-harness');

const TOOBA = { first: 'Tooba', chip: 't1', animal: 'turtle' };
const RESULT = { card: { first: 'Tooba', animal: 'turtle', correct: 4, total: 5, stars: 4 }, challenge_code: 'CHAL12', score: { correct: 4, total: 5 } };
const finished = (extra = {}) => ({ wq_kids: [TOOBA], wq_s_TEST: { st: 's1', child: TOOBA, answers: { q1: { slot: 'A', ok: true } }, queue: [], result: RESULT, ...extra } });
const store = (p, k) => { const v = p.ctx.localStorage.getItem(k); return v == null ? null : JSON.parse(v); };

describe('"Someone else\'s turn" on the finished card', () => {
  test('EN: the reopened card offers it; a tap leaves the card for the landing and forgets the session on this page only', () => {
    const p = page({ lang: 'en', store: finished() });
    expect(p.moment()).toBe('M10');
    expect(p.html()).toContain('id="wq-turn"');
    expect(p.html()).toContain('Someone else&#39;s turn');
    p.els['#wq-turn'].fire('click');
    expect(p.moment()).not.toBe('M10');
    const s = store(p, 'wq_s_TEST');
    expect(s.st).toBeFalsy();
    expect(s.result).toBeFalsy();
    expect(s.child).toBeFalsy();
    expect(s.answers).toEqual({});
    // Tooba is still remembered on this phone: their card stays on the landing
    expect(store(p, 'wq_kids')).toEqual([TOOBA]);
    expect(p.fetches.filter((f) => /\/api\/wq\/session/.test(f.url))).toHaveLength(0);
  });

  test('UR copy is gender-neutral', () => {
    const p = page({ lang: 'ur', store: finished() });
    expect(p.html()).toContain('کسی اور کی باری');
  });

  test('answers still waiting to be sent: no button, so a finished child\'s unsent answers are never dropped', () => {
    const p = page({ lang: 'en', store: finished({ queue: [{ qid: 'q5', slot: 'B', ms: 900, seq: 5 }] }) });
    expect(p.moment()).toBe('M10');
    expect(p.html()).not.toContain('id="wq-turn"');
  });
});
