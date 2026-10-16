/**
 * The Jugnu card on the scorecard (wq-card.js): a tap proves the card was seen. A child who taps Play before the
 * observer has seen half the card still sends door_shown first, then door_tap, so a tap is never counted without
 * its view. door_shown stays once per page view. Runs the whole shipped page in the harness's vm.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page } = require('./wq-page-harness');

const CARD_JS = path.join(__dirname, '..', 'public', 'wq', 'wq-card.js');
const CHILD = { first: '<Name> Testwala', chip: 'c1', animal: 'owl' };
const JC = { card: { first: '<Name> Testwala', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 }, hub_door: true, jugnu_card: true, jugnu_ev: true };
const store = (result) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result, vdone: true } });

// The page with an IntersectionObserver that has not fired yet (the card is not half in view when the child taps).
function withCard(result) {
  const io = { cb: null };
  const p = page({ lang: 'en', store: store(result) });
  p.ctx.IntersectionObserver = function IO(fn) { io.cb = fn; this.observe = () => {}; this.disconnect = () => {}; };
  vm.runInContext(fs.readFileSync(CARD_JS, 'utf8'), p.ctx);
  p.wq.card();
  return { p, io };
}
const doorEvs = (p) => { p.fireWin('pagehide'); return p.fetches.filter((f) => f.url === '/api/wq/e').flatMap((f) => JSON.parse(f.init.body).events).filter((e) => /^door_/.test(e.n)); };

describe('the card: a tap before the observer fires sends door_shown first', () => {
  test('tap before half in view: door_shown then door_tap, each once', () => {
    const { p } = withCard(JC);
    p.els['#wq-jc-go'].fire('click');
    const d = doorEvs(p);
    expect(d.map((e) => e.n)).toEqual(['door_shown', 'door_tap']);
    expect(d[0]).toMatchObject({ door: 'card', surface: 'scorecard', slot: 1 });
  });
  test('the observer firing after that tap adds no second door_shown', () => {
    const { p, io } = withCard(JC);
    p.els['#wq-jc-go'].fire('click');
    io.cb([{ isIntersecting: true, intersectionRatio: 0.9 }]);
    expect(doorEvs(p).map((e) => e.n)).toEqual(['door_shown', 'door_tap']);
  });
  test('seen first, then tapped: one door_shown, one door_tap, as before', () => {
    const { p, io } = withCard(JC);
    io.cb([{ isIntersecting: true, intersectionRatio: 0.6 }]);
    p.els['#wq-jc-go'].fire('click');
    expect(doorEvs(p).map((e) => e.n)).toEqual(['door_shown', 'door_tap']);
  });
  test('events off: a tap sends no door event', () => {
    const { p } = withCard({ ...JC, jugnu_ev: undefined });
    p.els['#wq-jc-go'].fire('click');
    expect(doorEvs(p)).toEqual([]);
  });
});
