/**
 * The class table and the school league join the one share (app_settings web_quiz_share_v4: the quiz payload's or
 * the finish's `share_v4`; default OFF). Their Share opens the finish card's sheet (WQFC.shareArt): the screen's own
 * picture, the same words and link today's share sends. The sheet's script is fetched when either screen opens with
 * the switch on, so a cold class link has it by the tap. Off, or the script not there yet: today's share, unchanged.
 * Runs the whole shipped page in the harness's vm.
 */
const { page, flush } = require('./wq-page-harness');

const CARD = 'c.DwjiGhssTV6PkKGyw9Tl9g.abcdefghijkl';
const MINE = 'l.DwjiGhssTV6PkKGyw9Tl9g.yzabcdefghij';
const SCH = 's.TEST.qrstuvwxyzab';
const CHILD = { first: 'Noor Testwala', chip: 'c1', animal: 'owl' };
const RESULT = { card: { first: 'Noor Testwala', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 }, art: { card: CARD, class: MINE } };
const finished = (extra = {}) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: { ...RESULT, ...extra } } });
const BOARD = { finishers_n: 14, class_avg_pct: 70, rows: [], more_n: 0 };
const SCHOOLS = { 'schools/': { rows: [{ place: 1, name: 'School Alpha', sector: 'B.K', points: 40, kids: 3, move: 0, mine: true }], mine: { place: 1, name: 'School Alpha', sector: 'B.K', points: 40, kids: 3, move: 0 }, ranked_n: 1, zero_n: 0 } };
const hour = () => new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 13).replace(/[-T]/g, '');

function withSheet(p) {
  const calls = [];
  p.ctx.WQFC = { shareArt: (o) => calls.push(o) };
  return calls;
}
async function openBoard(opts) {
  const p = page({ lang: 'en', board: BOARD, ...opts });
  p.added = [];
  p.ctx.document.head = { appendChild: (e) => p.added.push(e) };
  p.wq.board();
  await flush(); await flush(); await flush();
  return p;
}
async function openSchools(opts) {
  const p = await openBoard({ art: { schools: SCH }, api: SCHOOLS, ...opts });
  p.els['#wq-schools'].fire('click');
  await flush(); await flush(); await flush();
  return p;
}
const sheetScripts = (p) => p.added.filter((e) => /\/wq\/wq-finish-card\.js/.test(String(e.src || '')));

describe('switch on: the class table and the league open the one sheet', () => {
  test.each([['the quiz payload', { bootExtra: { share_v4: true } }, {}], ['the finish', {}, { share_v4: true }]])('the class table (%s says on): its picture, its words, its /class link', async (_, opts, res) => {
    const p = await openBoard({ store: finished(res), ...opts });
    const calls = withSheet(p);
    p.els['#wq-share-t'].fire('click');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ lang: 'en', src: 'table', url: 'https://example.test/q/TEST/class?v=14', img: `/q/TEST/art/class.jpg?a=${encodeURIComponent(MINE)}`, save: `/q/TEST/art/class.jpg?a=${encodeURIComponent(MINE)}&f=sq` });
    expect(calls[0].text).toBe(p.wq.T.tableLine('Plants', 'Class 3-B'));
    expect(typeof calls[0].ev).toBe('function');
    // the sheet, not today's fallback screen
    expect(p.html()).not.toContain('id="wq-wa"');
  });
  test('the league: its picture and its hourly /schools link', async () => {
    const p = await openSchools({ store: finished(), bootExtra: { share_v4: true } });
    const calls = withSheet(p);
    p.els['#wq-share-s'].fire('click');
    // (the harness keeps one element per selector across the league's two draws, so each draw's tap is heard)
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toMatchObject({ lang: 'en', src: 'schools', url: `https://example.test/q/TEST/schools?v=${hour()}`, img: `/q/TEST/art/schools.jpg?a=${encodeURIComponent(SCH)}` });
    expect(calls[0].text).toBe(p.wq.T.schoolsLine('School Alpha', 1));
  });
  test('Urdu: the sheet is asked in the page\'s language', async () => {
    const p = await openBoard({ lang: 'ur', store: finished(), bootExtra: { share_v4: true } });
    const calls = withSheet(p);
    p.els['#wq-share-t'].fire('click');
    expect(calls[0].lang).toBe('ur');
  });
  test('a cold class link (no finish on this phone): the sheet\'s script is fetched when the table opens', async () => {
    const p = await openBoard({ bootExtra: { share_v4: true } });
    expect(sheetScripts(p)).toHaveLength(1);
  });
  test('the script not there yet at the tap: today\'s share runs, never a dead button', async () => {
    const p = await openBoard({ store: finished(), bootExtra: { share_v4: true } });
    p.els['#wq-share-t'].fire('click');
    expect(p.html()).toContain('id="wq-wa"');
  });
});

describe('switch off: today\'s share, exactly', () => {
  test.each([['absent', {}], ['false', { share_v4: false }], ['a string', { share_v4: 'true' }], ['one', { share_v4: 1 }]])('share_v4 %s: no sheet, no script fetched, today\'s fallback with the picture', async (_, extra) => {
    const p = await openBoard({ store: finished(), bootExtra: extra });
    const calls = withSheet(p);
    p.els['#wq-share-t'].fire('click');
    expect(calls).toHaveLength(0);
    expect(sheetScripts(p)).toHaveLength(0);
    expect(p.html()).toContain('id="wq-wa"');
    expect(p.html()).toContain(`<img class="wq-artprev" src="/q/TEST/art/class.jpg?a=${encodeURIComponent(MINE)}" alt="">`);
  });
  test('the league with the switch off: today\'s share', async () => {
    const p = await openSchools({ store: finished() });
    const calls = withSheet(p);
    p.els['#wq-share-s'].fire('click');
    expect(calls).toHaveLength(0);
    expect(p.html()).toContain(`<img class="wq-artprev" src="/q/TEST/art/schools.jpg?a=${encodeURIComponent(SCH)}" alt="">`);
  });
});
