/**
 * Web quiz page: the school leaderboard (M16). From the class table or "today", a child opens
 * every school's points this week, their own school marked and pinned; a school with nothing
 * yet sees "be the first", never a bottom rank. Runs the whole shipped page in the harness's vm;
 * the bot API is the faked boundary.
 */
const { page, flush, rule } = require('./wq-page-harness');

const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 } };
const finished = () => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: RESULT } });
const row = (place, name, points, kids, move, extra = {}) => ({ place, name, sector: 'Sector One', points, kids, move, ...extra });
const BOARD = {
  week_start: '2026-10-05',
  rows: [
    row(1, 'School <Bravo>', 1240, 87, 1),
    row(2, 'School Alpha', 610, 40, -1, { mine: true }),
    row(3, 'School Charlie', 15, 1, 'new'),
  ],
  mine: { place: 2, name: 'School Alpha', sector: 'Sector One', points: 610, kids: 40, move: -1 },
  ranked_n: 3, zero_n: 312,
};
const GHOST = { week_start: '2026-10-05', rows: [row(1, 'School Bravo', 40, 2, null)], mine: { place: null, name: 'School Delta', sector: null, points: 0, kids: 0, move: null, ghost: true }, ranked_n: 1, zero_n: 3 };
const events = (p) => p.fetches.filter((f) => f.url === '/api/wq/e').flatMap((f) => JSON.parse(f.init.body).events);

async function open(lang, body, from = 'board') {
  const p = page({ lang, store: finished(), board: { finishers_n: 0, rows: [] }, api: { '/schools/TEST': body } });
  if (from === 'board') { p.wq.board(); await flush(); } else { p.wq.today(); }
  p.els['#wq-schools'].fire('click');
  await flush();
  return p;
}

describe('the way in', () => {
  test('the card, the class table and "today" all offer "School league"', async () => {
    const p = page({ lang: 'en', store: finished(), board: { finishers_n: 0, rows: [] } });
    expect(p.moment()).toBe('M10');
    expect(p.html()).toContain('id="wq-schools"');
    expect(p.html()).toContain('School league');
    p.wq.board();
    await flush();
    expect(p.html()).toContain('id="wq-schools"');
    p.wq.today();
    expect(p.html()).toContain('id="wq-schools"');
  });

  test('the shared link /q/<CODE>/schools opens straight on the league, with the session token when there is one', async () => {
    const p = page({ lang: 'en', store: finished(), view: 'schools', api: { '/schools/TEST': BOARD } });
    await flush();
    expect(p.moment()).toBe('M16');
    expect(p.fetches.some((f) => f.url === '/api/wq/schools/TEST?st=s1')).toBe(true);
  });
});

describe('the board (M16)', () => {
  test('every school ranked: points, children, movement; my school marked and pinned; the zero tail as a count', async () => {
    const p = await open('en', BOARD);
    expect(p.fetches.some((f) => f.url === '/api/wq/schools/TEST?st=s1')).toBe(true);
    expect(p.moment()).toBe('M16');
    const h = p.html();
    expect(h).toContain('School league');
    expect(h).toContain('This week · 10 points for playing, up to 10 for your score');
    expect(h).toContain('School &lt;Bravo&gt;');
    expect(h).toContain('1,240 points');
    expect(h).toContain('87 children played');
    expect(h).toMatch(/<li class="wq-srow wq-you"[^>]*id="wq-mine"/);
    expect(h).toContain('YOUR SCHOOL');
    expect(h).toMatch(/class="wq-move wq-up"[^>]*>▲1</);
    expect(h).toMatch(/class="wq-move wq-down"[^>]*>▼1</);
    expect(h).toMatch(/class="wq-move wq-new"[^>]*>NEW</);
    expect(h).toMatch(/<details class="wq-zero-list"><summary>312 schools still to start<\/summary>/);
    // the summary line at the top: my place and my points
    expect(h).toMatch(/<div class="wq-card wq-mycard" id="wq-mycard">[^]*School Alpha<\/bdi> is #2 this week[^]*▼1 since yesterday[^]*610 points[^]*40 children played/);
  });

  test('my school pins to the top or the bottom of the screen when scrolled away (CSS sticky)', () => {
    const r = rule('.wq-srow.wq-you');
    expect(r).toMatch(/position:sticky/);
    expect(r).toMatch(/top:0/);
    expect(r).toMatch(/bottom:0/);
    // sticky pins to the nearest scrolling ancestor: the app shell must clip, not become a scroll container
    expect(rule('.wq-app')).toMatch(/overflow-x:clip/);
  });

  test('my school with nothing yet: a ghost row with "be the first", no rank number', async () => {
    const p = await open('en', GHOST);
    const h = p.html();
    // at the top, above the fold, and never as a rank
    expect(h).toMatch(/<div class="wq-card wq-mycard wq-zero" id="wq-mine">[^]*No one from <bdi>School Delta<\/bdi> has played yet this week\. Be the first!/);
    expect(h.indexOf('id="wq-mine"')).toBeLessThan(h.indexOf('wq-slist'));
    expect(h).not.toMatch(/wq-srow[^"]*wq-you/);
  });

  test('no school has played yet: says so kindly; with my ghost card on top it is not said twice', async () => {
    const p = await open('en', { rows: [], mine: null, ranked_n: 0, zero_n: 465 });
    expect(p.html()).toContain('No school has played yet this week. Yours can be first!');
    const q = await open('en', { ...GHOST, rows: [] });
    expect(q.html()).toContain('Be the first!');
    expect(q.html()).not.toContain('No school has played yet');
  });

  test('a school with nothing yet invites rather than shares a place', async () => {
    const p = await open('en', GHOST);
    expect(p.html()).toMatch(/id="wq-share-s">Invite my school to play</);
    p.els['#wq-share-s'].fire('click');
    await flush();
    expect(p.html()).toContain('No one from School Delta has played yet this week. Be the first:');
  });

  test('Urdu: the same board in Urdu, names isolated', async () => {
    const p = await open('ur', BOARD, 'today');
    const h = p.html();
    expect(h).toContain('اسکولوں کی لیگ');
    expect(h).toContain('آپ کا اسکول');
    expect(h).toContain('1,240 پوائنٹس');
    expect(h).toContain('87 بچوں نے کھیلا');
    expect(h).toContain('<bdi><span class="wq-lat" lang="en">School &lt;Bravo&gt;</span></bdi>');
    expect(h).toContain('1 بچے نے کھیلا');
  });

  test('500 schools render', async () => {
    const rows = Array.from({ length: 500 }, (_, i) => row(i + 1, `School ${i}`, 1000 - i, 5, null, i === 480 ? { mine: true } : {}));
    const p = await open('en', { rows, mine: { place: 481, name: 'School 480', points: 520, kids: 5, move: null }, ranked_n: 500, zero_n: 0 });
    expect((p.html().match(/class="wq-srow/g) || []).length).toBe(500);
    expect(p.html()).not.toContain('still to start');
  });

  test('share sends our place with the quiz link and is logged; view is logged with counts only', async () => {
    const p = await open('en', BOARD);
    p.els['#wq-share-s'].fire('click');
    await flush();
    expect(p.html()).toContain('School Alpha is #2 of all schools this week. Play and help us climb:');
    expect(p.html()).toContain('https://example.test/q/TEST/schools');
    p.ctx.document.visibilityState = 'hidden';
    p.fireDoc('visibilitychange');
    const ev = events(p);
    expect(ev).toEqual(expect.arrayContaining([
      expect.objectContaining({ n: 'leaderboard_view', src: 'class', i: 2, seq: 3 }),
      expect.objectContaining({ n: 'leaderboard_share', src: 'schools' }),
    ]));
    expect(JSON.stringify(ev)).not.toMatch(/School Alpha/);
  });

  test('back returns to where the child came from; an error offers a retry', async () => {
    const p = await open('en', BOARD);
    p.els['#wq-back'].fire('click');
    expect(p.moment()).toBe('M11-wait');
    const q = await open('en', { __status: 503 });
    expect(q.moment()).toBe('M16-error');
    expect(q.html()).toContain('id="wq-retry"');
  });
});

describe('the hook and the filters', () => {
  test('the points this finish added, on my school card', async () => {
    const p = await open('en', { ...BOARD, added: 14 });
    expect(p.fetches.some((f) => f.url === '/api/wq/schools/TEST?st=s1')).toBe(true);
    expect(p.html()).toMatch(/id="wq-mycard">[^]*\+14 points for <bdi>School Alpha<\/bdi>!/);
  });

  test('"My sector" keeps only my sector\'s schools; "All" brings them back', async () => {
    const rows = [row(1, 'North One', 100, 5, null), { ...row(2, 'Mine', 80, 4, null, { mine: true }), sector: 'Sector Two' }, { ...row(3, 'Same Sector', 60, 3, null), sector: 'Sector Two' }];
    const p = await open('en', { rows, mine: { place: 2, name: 'Mine', sector: 'Sector Two', points: 80, kids: 4, move: null }, ranked_n: 3, zero_n: 0 });
    expect(p.html()).toContain('North One');
    p.els['#wq-sector'].fire('click');
    expect(p.html()).not.toContain('North One');
    expect(p.html()).toContain('Same Sector');
    p.els['#wq-all'].fire('click');
    expect(p.html()).toContain('North One');
  });

  test('nobody ranked yet: no sector chips (nothing to filter)', async () => {
    const p = await open('en', { rows: [], mine: { ...GHOST.mine, sector: 'Sector One' }, ranked_n: 0, zero_n: 11 });
    expect(p.html()).not.toContain('id="wq-sector"');
    expect(p.html()).toContain('Be the first!');
  });

  test('nobody ranked yet (every Monday morning): the schools still to start are still shown, folded', async () => {
    const p = await open('en', { rows: [], mine: { ...GHOST.mine }, ranked_n: 0, zero_n: 11, zero_names: ['Quiet One', 'Quiet Two'] });
    expect(p.html()).toMatch(/<details class="wq-zero-list"><summary>11 schools still to start<\/summary><ul><li><bdi>Quiet One<\/bdi>/);
    const q = await open('en', { rows: [], mine: null, ranked_n: 0, zero_n: 465 });
    expect(q.html()).toContain('No school has played yet this week. Yours can be first!');
    expect(q.html()).toContain('465 schools still to start');
  });

  test('no sector known: no sector chip', async () => {
    const p = await open('en', GHOST);
    expect(p.html()).not.toContain('id="wq-sector"');
  });

  test('the schools still to start open as a list of names, no numbers', async () => {
    const p = await open('en', { ...BOARD, zero_names: ['Quiet <One>', 'Quiet Two'] });
    expect(p.html()).toMatch(/<details class="wq-zero-list"><summary>312 schools still to start<\/summary><ul><li><bdi>Quiet &lt;One&gt;<\/bdi><\/li><li><bdi>Quiet Two<\/bdi><\/li><\/ul><\/details>/);
  });
});

describe('a cold recipient of the league link', () => {
  test('who never played gets "Play and add points for <school>", which opens the quiz; a child who played does not', async () => {
    const p = page({ lang: 'en', store: {}, view: 'schools', api: { '/schools/TEST': BOARD } });
    await flush();
    expect(p.moment()).toBe('M16');
    expect(p.html()).toMatch(/id="wq-play-s">Play and add points for <bdi>School Alpha<\/bdi><\/button>/);
    p.els['#wq-play-s'].fire('click');
    expect(p.moment()).toBe('M3');
    const u = page({ lang: 'ur', store: {}, view: 'schools', api: { '/schools/TEST': BOARD } });
    await flush();
    expect(u.html()).toContain('کھیلیں اور <bdi><span class="wq-lat" lang="en">School Alpha</span></bdi> کے پوائنٹس بڑھائیں');
    const played = await open('en', BOARD);
    expect(played.html()).not.toContain('id="wq-play-s"');
  });
});
