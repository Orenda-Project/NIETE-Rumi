/**
 * The Jugnu card's event batches on the scorecard (wq-card.js drawn by wq.js, with wq-tel.js; the whole shipped page
 * in the harness's vm). With the card's events on (finish's jugnu_ev, the bot's web_quiz_events_v2), the hub token
 * the card is given for this child (POST hubdoor's /c/<hub token>?kid=<chip> link) and that chip ride every POST
 * /api/wq/e body sent from then on as `ht` / `chip`, on the batch, never on an event: through the page-session
 * telemetry (wq-tel.js ids()) and through wq.js's own {events} body alike. Events off: every body is today's (the
 * snapshot was written against the code before the change); events on: the bodies are today's plus those two fields.
 * The clock and the random page-session id are the only parts masked. The bot API (fetch) is the faked boundary.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page, flush } = require('./wq-page-harness');

const CARD_JS = path.join(__dirname, '..', 'public', 'wq', 'wq-card.js');
const CHILD = { first: 'Zara Testwala', chip: 'c1', animal: 'owl' };
const RESULT = { card: { first: 'Zara Testwala', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 }, hub_door: true, jugnu_card: true };
const HT = 'fakehubtoken.NotARealSignature000';
const KID = '00000000000000b7';
const HREF = `/c/${HT}?kid=${KID}&via=quiz_card`;
const store = (result) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result, vdone: true }, wq_d: 'AAAAAAAAAAAAAAAAAAAAAA' });

// The scorecard with the card, a tap, Play (the server answers the challenge link), then the page goes away.
async function walk({ tel, ev }) {
  const p = page({ lang: 'en', tel, store: store(ev ? { ...RESULT, jugnu_ev: true } : RESULT), api: { hubdoor: { href: HREF, animal: 'owl' } } });
  vm.runInContext(fs.readFileSync(CARD_JS, 'utf8'), p.ctx);
  p.wq.card();
  p.els['#wq-jc-go'].fire('click');
  p.els['#wq-jc-play'].fire('click');
  await flush(); await flush();
  p.fireWin('pagehide');
  return p;
}
// The clock (t, sm and the dwell times) and the random page-session id masked; every other byte as sent.
const mask = (s) => s.replace(/"(t|sm|ms|vis_ms|total_ms)":\d+/g, '"$1":0').replace(/"(ps|pps)":"[a-z0-9]{12}"/g, '"$1":"ps"');
const bodies = (p) => p.fetches.filter((f) => f.url === '/api/wq/e').map((f) => mask(f.init.body));
const without = (s) => { const o = JSON.parse(s); delete o.ht; delete o.chip; return JSON.stringify(o); };

describe('card events off (no jugnu_ev): every body is today\'s', () => {
  test.each([['telemetry on', true], ['telemetry off', false]])('%s', async (_l, tel) => {
    const p = await walk({ tel, ev: false });
    expect(p.hist.assigned).toEqual([HREF + '&lang=en']);
    expect(bodies(p)).toMatchSnapshot();
    expect(bodies(p).join('')).not.toContain(HT);
  });
});

describe('card events on (jugnu_ev): the bodies are today\'s, plus ht = the card\'s hub token and chip = its kid', () => {
  test.each([['telemetry on', true], ['telemetry off', false]])('%s', async (_l, tel) => {
    const p = await walk({ tel, ev: true });
    const b = bodies(p);
    // Today's bodies, byte for byte once the two new fields are taken off (the events themselves are untouched).
    expect(b.map(without)).toMatchSnapshot();
    const door = b.map((s) => JSON.parse(s)).filter((x) => x.events.some((e) => e.n === 'door_tap'));
    expect(door).toHaveLength(1);
    expect(door[0]).toMatchObject({ ht: HT, chip: KID });
    for (const s of b) for (const e of JSON.parse(s).events) expect('ht' in e || 'chip' in e).toBe(false);
  });

  test('a link the card does not recognise: nothing is set, the bodies stay today\'s', async () => {
    const p = page({ lang: 'en', store: store({ ...RESULT, jugnu_ev: true }), api: { hubdoor: { href: 'https://elsewhere.test/x', animal: 'owl' } } });
    vm.runInContext(fs.readFileSync(CARD_JS, 'utf8'), p.ctx);
    p.wq.card();
    p.els['#wq-jc-go'].fire('click');
    p.els['#wq-jc-play'].fire('click');
    await flush(); await flush();
    p.fireWin('pagehide');
    expect(bodies(p).join('')).not.toMatch(/"ht"|"chip"/);
  });
});
