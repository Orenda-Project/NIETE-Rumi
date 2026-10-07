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

describe('above the fold: directly under the share row', () => {
  const order = (h) => (h.match(/id="wq-(share|chal|hubdoor|class|schools|more|turn)"/g) || []).map((x) => x.slice(7, -1));
  test('a teacher quiz: share, then the door (the second action), then the rest', () => {
    expect(order(page({ lang: 'en', store: store(DOOR) }).html())).toEqual(['share', 'hubdoor', 'chal', 'class', 'schools', 'more', 'turn']);
  });
  test('a video quiz keeps "Watch more" first; the door still comes right after "Share to class group"', () => {
    const h = page({ lang: 'en', store: store(DOOR), video: { url: 'https://r2.test/v.mp4' } }).html();
    expect(order(h)).toEqual(['more', 'share', 'hubdoor', 'chal', 'class', 'schools', 'turn']);
  });
});

const evs = (p) => p.fetches.filter((f) => f.url === '/api/wq/e').flatMap((f) => JSON.parse(f.init.body).events);

describe('a tap opens this child\'s hub', () => {
  test('asks the server with the session token only, then opens the link it returns', async () => {
    const p = page({ lang: 'en', store: store(DOOR), api: { hubdoor: { href: '/h/tok.abc' } } });
    p.els['#wq-hubdoor'].fire('click');
    await flush(); await flush();
    const call = p.fetches.find((f) => f.url.indexOf('hubdoor') >= 0);
    expect(JSON.parse(call.init.body)).toEqual({ st: 's1' });
    expect(p.hist.assigned).toEqual(['/h/tok.abc?from=door']);
    expect(evs(p)).toContainEqual(expect.objectContaining({ n: 'hub_door_tap', ok: true }));
  });
  test('the server says no (door switched off meanwhile): no navigation, a toast, and the card stops offering it', async () => {
    const p = page({ lang: 'en', store: store(DOOR), api: { hubdoor: { __status: 404, error: 'no_door' } } });
    p.els['#wq-hubdoor'].fire('click');
    await flush(); await flush();
    expect(p.hist.assigned).toEqual([]);
    expect(p.toasts().length).toBe(1);
    expect(JSON.parse(p.ls.get('wq_s_TEST')).result.hub_door).toBe(false);
    expect(evs(p)).toContainEqual(expect.objectContaining({ n: 'hub_door_tap', ok: false }));
  });
  test('never a link that is not a hub page', async () => {
    const p = page({ lang: 'en', store: store(DOOR), api: { hubdoor: { href: 'https://evil.example/x' } } });
    p.els['#wq-hubdoor'].fire('click');
    await flush(); await flush();
    expect(p.hist.assigned).toEqual([]);
  });
});

describe('the first screen of a class child\'s card is score, the name notice, "Share to class group", the door', () => {
  const NOTES = { ...DOOR, card: { ...RESULT.card, nth: 3, practice: true, kept: { correct: 2, total: 5 } } };
  const at = (h, x) => h.indexOf(x);
  const PRIV = 'Only your first name goes on the card.';
  test('the name notice sits directly above Share; the door is next; the place-in-class note comes after the door', () => {
    const h = page({ lang: 'en', store: store(NOTES) }).html();
    const door = at(h, 'id="wq-hubdoor"');
    expect(at(h, 'wq-scorecard')).toBeLessThan(at(h, PRIV));
    expect(at(h, PRIV)).toBeLessThan(at(h, 'id="wq-share"'));
    expect(h.slice(at(h, PRIV), at(h, 'id="wq-share"'))).not.toMatch(/<(p|div|button)\b[^>]*>/);
    expect(at(h, 'id="wq-share"')).toBeLessThan(door);
    expect(door).toBeLessThan(at(h, 'wq-nth'));
    expect(at(h, 'wq-nth')).toBeLessThan(at(h, 'id="wq-chal"'));
  });
  test('Urdu: the same order', () => {
    const h = page({ lang: 'ur', store: store(NOTES) }).html();
    expect(at(h, 'کارڈ پر صرف آپ کا پہلا نام')).toBeLessThan(at(h, 'id="wq-share"'));
    expect(at(h, 'id="wq-share"')).toBeLessThan(at(h, 'id="wq-hubdoor"'));
    expect(at(h, 'id="wq-hubdoor"')).toBeLessThan(at(h, 'wq-nth'));
  });
  test('the card\'s topic carries the one-line hook for short phones', () => {
    expect(page({ lang: 'en', store: store(NOTES) }).html()).toMatch(/<p class="wq-sub wq-ctopic">Plants<\/p>/);
  });
  test('no door (switch off): the card keeps today\'s order (notes, then the actions)', () => {
    const h = page({ lang: 'en', store: store({ ...NOTES, hub_door: undefined }) }).html();
    expect(at(h, 'wq-nth')).toBeLessThan(at(h, 'id="wq-share"'));
    expect(at(h, PRIV)).toBeLessThan(at(h, 'id="wq-share"'));
  });
  test('a video quiz card is unchanged: Watch more first, the notes above the actions', () => {
    const h = page({ lang: 'en', store: store(NOTES), video: { url: 'https://r2.test/v.mp4' } }).html();
    expect(at(h, 'wq-nth')).toBeLessThan(at(h, 'id="wq-more"'));
    expect(at(h, 'id="wq-more"')).toBeLessThan(at(h, 'id="wq-share"'));
  });
});
