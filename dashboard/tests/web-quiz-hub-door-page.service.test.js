/**
 * The results card's door to the child's own hub ("My quizzes, videos and challenges"): shown when finish said
 * so (result.hub_door), never on a friend's challenge run or while answers wait to be sent; a tap asks the server
 * for this child's hub link (POST hubdoor {st}) and opens it. Runs the whole shipped page in the harness's vm.
 */
const { page, flush } = require('./wq-page-harness');

const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 } };
const store = (result, extra = {}) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result, vdone: true, ...extra } });
const DOOR = { ...RESULT, hub_door: true };

describe('the card offers the hub', () => {
  test('EN: the door is on the card, after the shares and before the next player\'s turn', () => {
    const h = page({ lang: 'en', store: store(DOOR) }).html();
    expect(h).toContain('id="wq-hubdoor"');
    expect(h).toContain('My quizzes, videos and challenges');
    expect(h.indexOf('id="wq-share"')).toBeLessThan(h.indexOf('id="wq-hubdoor"'));
    expect(h.indexOf('id="wq-hubdoor"')).toBeLessThan(h.indexOf('id="wq-turn"'));
  });
  test('UR: in Urdu', () => {
    expect(page({ lang: 'ur', store: store(DOOR) }).html()).toContain('میرے کوئز، ویڈیوز اور چیلنج');
  });
  test('not offered: finish did not say so, or answers still wait to be sent', () => {
    expect(page({ lang: 'en', store: store(RESULT) }).html()).not.toContain('wq-hubdoor');
    expect(page({ lang: 'en', store: store(DOOR, { queue: [{ qid: 'q1' }] }) }).html()).not.toContain('wq-hubdoor');
  });
});

describe('a tap opens this child\'s hub', () => {
  test('asks the server with the session token only, then opens the link it returns', async () => {
    const p = page({ lang: 'en', store: store(DOOR), api: { hubdoor: { href: '/h/tok.abc' } } });
    p.els['#wq-hubdoor'].fire('click');
    await flush(); await flush();
    const call = p.fetches.find((f) => f.url.indexOf('hubdoor') >= 0);
    expect(JSON.parse(call.init.body)).toEqual({ st: 's1' });
    expect(p.hist.assigned).toEqual(['/h/tok.abc']);
  });
  test('the server says no (door switched off meanwhile): no navigation, a toast, and the card stops offering it', async () => {
    const p = page({ lang: 'en', store: store(DOOR), api: { hubdoor: { __status: 404, error: 'no_door' } } });
    p.els['#wq-hubdoor'].fire('click');
    await flush(); await flush();
    expect(p.hist.assigned).toEqual([]);
    expect(p.toasts().length).toBe(1);
    expect(JSON.parse(p.ls.get('wq_s_TEST')).result.hub_door).toBe(false);
  });
  test('never a link that is not a hub page', async () => {
    const p = page({ lang: 'en', store: store(DOOR), api: { hubdoor: { href: 'https://evil.example/x' } } });
    p.els['#wq-hubdoor'].fire('click');
    await flush(); await flush();
    expect(p.hist.assigned).toEqual([]);
  });
});
