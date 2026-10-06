/**
 * The page's half of "the picture travels with the share": the card link carries its picture id (so the
 * group's link preview IS the card), the picture is fetched when the card opens, and a browser that can
 * share files sends it with the message. WhatsApp's own browser cannot (no navigator.share): there the
 * fallback screen shows the picture the link will preview as, and offers to save it.
 * Runs the whole shipped page in the harness's vm.
 */
const { page, flush } = require('./wq-page-harness');

const CARD = 'c.DwjiGhssTV6PkKGyw9Tl9g.abcdefghijkl';
const INVITE = 'i.CHAL12.mnopqrstuvwx';
const MINE = 'l.DwjiGhssTV6PkKGyw9Tl9g.yzabcdefghij';
const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 }, art: { card: CARD, invite: INVITE, class: MINE } };
const finished = () => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: RESULT } });
const waHref = (p) => {
  const m = /id="wq-wa" href="([^"]+)"/.exec(p.html());
  return m ? decodeURIComponent(m[1].replace(/&amp;/g, '&')) : null;
};

describe('in WhatsApp\'s browser (no share sheet)', () => {
  test('the card link carries the card picture, so the group\'s preview is the card', () => {
    const p = page({ lang: 'en', store: finished() });
    p.els['#wq-share'].fire('click');
    expect(waHref(p)).toContain(`https://example.test/q/TEST?a=${CARD}`);
  });

  test('the fallback shows the picture the link will preview as, and a Save button for the square file', () => {
    const p = page({ lang: 'en', store: finished() });
    p.els['#wq-share'].fire('click');
    expect(p.html()).toContain(`<img class="wq-artprev" src="/q/TEST/art/card.jpg?a=${encodeURIComponent(CARD)}" alt="">`);
    expect(p.html()).toMatch(new RegExp(`<a class="wq-btn wq-soft" id="wq-save" href="/q/TEST/art/card\\.jpg\\?a=${encodeURIComponent(CARD)}&amp;f=sq" download="[^"]+\\.jpg">`));
  });

  test('the card opening warms the picture (the crawler finds it drawn); no file is fetched where none can be shared', () => {
    const p = page({ lang: 'en', store: finished() });
    const art = p.fetches.map((f) => f.url).filter((u) => u.indexOf('/art/') >= 0);
    expect(art).toContain(`/q/TEST/art/card.jpg?a=${encodeURIComponent(CARD)}`);
    expect(art.some((u) => /f=sq/.test(u))).toBe(false);
  });

  test('a finish without picture ids (an older bot) shares exactly as before', () => {
    const p = page({ lang: 'en', store: { wq_s_TEST: { ...finished().wq_s_TEST, result: { ...RESULT, art: undefined } } } });
    p.els['#wq-share'].fire('click');
    expect(waHref(p)).toMatch(/https:\/\/example\.test\/q\/TEST$/);
    expect(p.html()).not.toContain('wq-artprev');
  });
});

describe('where the browser can share a file (Web Share Level 2)', () => {
  function sharing() {
    const shared = [];
    const nav = {
      canShare: (d) => Boolean(d && d.files && d.files.length),
      share: (d) => { shared.push(d); return Promise.resolve(); },
    };
    return { shared, nav };
  }

  test('"Share to class group": the square card goes WITH the message and the card link', async () => {
    const { shared, nav } = sharing();
    const p = page({ lang: 'en', store: finished(), nav });
    await flush(); await flush();
    p.els['#wq-share'].fire('click');
    await flush();
    expect(shared).toHaveLength(1);
    expect(shared[0].files[0]).toMatchObject({ name: 'card.jpg', type: 'image/jpeg' });
    expect(shared[0].text).toContain(`https://example.test/q/TEST?a=${CARD}`);
    expect(p.fetches.map((f) => f.url)).toContain(`/q/TEST/art/card.jpg?a=${encodeURIComponent(CARD)}&f=sq`);
  });

  test('"Challenge a friend": the invite picture travels with the challenge link', async () => {
    const { shared, nav } = sharing();
    const p = page({ lang: 'en', store: finished(), nav });
    await flush(); await flush();
    p.els['#wq-chal'].fire('click');
    await flush();
    expect(shared[0].files[0].name).toBe('invite.jpg');
    expect(shared[0].text).toContain('https://example.test/q/CHAL12');
  });

  test('the league table share sends the child\'s own class picture', async () => {
    const { shared, nav } = sharing();
    const p = page({ lang: 'en', store: finished(), nav, board: { finishers_n: 2, class_avg_pct: 70, rows: [], more_n: 0 } });
    p.wq.board();
    await flush(); await flush(); await flush();
    p.els['#wq-share-t'].fire('click');
    await flush();
    expect(shared[0].files[0].name).toBe('class.jpg');
    expect(shared[0].text).toContain('https://example.test/q/TEST/class');
  });

  test('the picture not fetched yet: the text share, never a wait that loses the tap', async () => {
    const shared = [];
    const nav = { canShare: () => true, share: (d) => { shared.push(d); return Promise.resolve(); } };
    const p = page({ lang: 'en', store: finished(), nav });
    p.els['#wq-share'].fire('click');   // before the fetch settles
    await flush();
    expect(shared[0].files).toBeUndefined();
    expect(shared[0].url).toBe(`https://example.test/q/TEST?a=${CARD}`);
  });
});

describe('the class link changes as the class plays', () => {
  test('the shared /class link carries ?v=<finishers>, so WhatsApp re-fetches the preview instead of an old table', async () => {
    const p = page({ lang: 'en', store: finished(), board: { finishers_n: 14, class_avg_pct: 70, rows: [], more_n: 0 } });
    p.wq.board();
    await flush(); await flush(); await flush();
    p.els['#wq-share-t'].fire('click');
    expect(waHref(p)).toContain('https://example.test/q/TEST/class?v=14');
  });
});

describe("the invited friend's landing shows the picture the link previewed as", () => {
  const CH = { first: 'Amal', correct: 7, total: 8 };
  test('the invite picture sits above the challenge line, its alt the same words', () => {
    const p = page({ lang: 'en', art: { invite: INVITE }, challenge: CH });
    const h = p.html();
    expect(h).toMatch(new RegExp(`<img class="wq-chpic" src="/q/TEST/art/invite\\.jpg\\?a=${encodeURIComponent(INVITE)}" alt="[^"]*Amal[^"]*7[^"]*">`));
    expect(h.indexOf('wq-chpic')).toBeLessThan(h.indexOf('class="wq-banner"'));
  });

  test('a picture that cannot load is removed, never a broken image', () => {
    const p = page({ lang: 'en', art: { invite: INVITE }, challenge: CH });
    const img = p.els['.wq-chpic'];
    expect(img.listeners.error).toHaveLength(1);
  });

  test('the class code (no challenge) shows no picture', () => {
    const p = page({ lang: 'en', art: { class: 'l.TEST.abcdefghijkl' } });
    expect(p.html()).not.toContain('wq-chpic');
  });
});

describe('the school league share', () => {
  const SCH = 's.TEST.qrstuvwxyzab';
  test('carries the school picture and ?v=<the hour in Pakistan>, so the preview is this hour\'s board', async () => {
    const p = page({
      lang: 'en', store: finished(), art: { schools: SCH },
      board: { finishers_n: 2, class_avg_pct: 70, rows: [], more_n: 0 },
      api: { 'schools/': { rows: [{ place: 1, name: 'School Alpha', sector: 'B.K', points: 40, kids: 3, move: 0, mine: true }], mine: { place: 1, name: 'School Alpha', sector: 'B.K', points: 40, kids: 3, move: 0 }, ranked_n: 1, zero_n: 0 } },
    });
    p.wq.board();
    await flush(); await flush(); await flush();
    p.els['#wq-schools'].fire('click');
    await flush(); await flush(); await flush();
    p.els['#wq-share-s'].fire('click');
    const hour = new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 13).replace(/[-T]/g, '');
    expect(waHref(p)).toContain(`https://example.test/q/TEST/schools?v=${hour}`);
    expect(p.html()).toContain(`<img class="wq-artprev" src="/q/TEST/art/schools.jpg?a=${encodeURIComponent(SCH)}" alt="">`);
  });
});
