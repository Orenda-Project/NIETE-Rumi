/**
 * The quiz page's event batch when the Jugnu card's events are on (finish's jugnu_ev) and the page-session telemetry
 * is off (web_quiz_rich_telemetry; boot `rt` not true): the batch body carries this quiz's session token (`st`) and
 * this phone's device ref (`dr`), so the relay can key the card's door lines to the child. Before, only wq-tel.js
 * put them on a batch, and only with that telemetry on. With the card's events off the body is as before
 * ({events} only). No event changes and nothing new reaches the child's screen. Runs the whole shipped page.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page } = require('./wq-page-harness');

const CARD_JS = path.join(__dirname, '..', 'public', 'wq', 'wq-card.js');
const DEV = 'AbCdEfGhIjKlMnOpQrStUv';   // a well-formed device ref (22 url-safe characters)
const CHILD = { first: '<Name> Testwala', chip: 'c1', animal: 'owl' };
const RESULT = { card: { first: '<Name> Testwala', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 }, hub_door: true, jugnu_card: true };
const store = (result) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result, vdone: true }, wq_d: DEV });

function cardPage(result) {
  const p = page({ lang: 'en', store: store(result) });
  vm.runInContext(fs.readFileSync(CARD_JS, 'utf8'), p.ctx);
  p.wq.card();
  return p;
}
const bodies = (p) => { p.fireWin('pagehide'); return p.fetches.filter((f) => f.url === '/api/wq/e').map((f) => JSON.parse(f.init.body)); };

describe('the card\'s events ride a batch that names the quiz session and the phone', () => {
  test('jugnu_ev on, page-session telemetry off: st and dr on the batch, the door lines in it', () => {
    const b = bodies(cardPage({ ...RESULT, jugnu_ev: true }));
    expect(b.length).toBeGreaterThan(0);
    const withDoor = b.find((x) => x.events.some((e) => e.n === 'door_shown'));
    expect(withDoor).toBeDefined();
    expect(withDoor.st).toBe('s1');
    expect(withDoor.dr).toBe(DEV);
  });
  test('golden: jugnu_ev off, the batch is {events} only, as before', () => {
    const b = bodies(cardPage({ ...RESULT }));
    expect(b.length).toBeGreaterThan(0);
    for (const x of b) expect(Object.keys(x)).toEqual(['events']);
  });
  test('no device ref on this phone: st only, never an empty or made-up dr', () => {
    const p = page({ lang: 'en', store: { wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: { ...RESULT, jugnu_ev: true }, vdone: true } } });
    vm.runInContext(fs.readFileSync(CARD_JS, 'utf8'), p.ctx);
    p.wq.card();
    const withDoor = bodies(p).find((x) => x.events.some((e) => e.n === 'door_shown'));
    expect(withDoor.st).toBe('s1');
    expect(withDoor).not.toHaveProperty('dr');
  });
});
