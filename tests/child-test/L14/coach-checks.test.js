/**
 * Child test L14 (bd-s1oo0.18) — the driver's coach submits a REAL check, not a placeholder.
 *
 * runVisit gets a checkPlayer (check-play.playCheck behind it): for every check card the bot sends,
 * the coach plays the Flow, every action lands on the timeline with the child's fixture id, then the
 * completion goes to the webhook with the endpoint's response_json. `--checks inline` checks each
 * child as soon as its card is in; `batch` at the end. summarise() reports each child's check time.
 *
 * Mocked: the transport (a scripted L4-style bot). Real: coach.js, timeline.js, driver.pickFixtures.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runVisit } = require('../../../bot/scripts/e2e/child-test-sim/coach');
const { createTimeline, summarise } = require('../../../bot/scripts/e2e/child-test-sim/timeline');
const { pickFixtures, checksMode } = require('../../../bot/scripts/e2e/child-test-sim/driver');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'l14-coach-'));
const fx = path.join(tmp, 'AA_one');
fs.mkdirSync(fx);
for (const b of ['urdu', 'english', 'maths']) fs.writeFileSync(path.join(fx, `${b}.ogg`), 'x');
const strip = path.join(tmp, 'strip-g3-00-d1.jpg');
fs.writeFileSync(strip, 'x');

const btn = (ids) => ({ type: 'interactive.button', txt: '', raw: { interactive: { action: { buttons: ids.map((id) => ({ reply: { id, title: id } })) } } } });
const text = (t) => ({ type: 'text', txt: t });

/** An L4-style bot, one child (roll 14), as a list of replies per coach send. */
function scriptedBot() {
  const card = { type: 'interactive.flow', txt: 'جانچ: رول ۱۴\nاردو: ۴۱ الفاظ', flow: { id: 'FLOW-1', token: 'coach-1:child-test-check:sess-9' } };
  const replies = [
    [{ type: 'interactive.list', txt: '', list: { rows: [{ id: 'ctst_child:d1', title: 'رول ۱۴ · Someone' }, { id: 'ctst_alt:d2', title: 'رول ۲ · Other' }] } }],
    [btn(['ctst_pres:d1:p', 'ctst_pres:d1:a'])],
    [btn(['ctst_stop'])],
    [text('ok'), btn(['ctst_stop'])],
    [text('ok'), btn(['ctst_stop'])],
    [text('ok'), btn(['ctst_nophoto:s'])],
    [text('ok'), text('done'), card],
    [text('saved')],
  ];
  const outbox = []; let seq = 0; let step = 0;
  const push = () => { for (const it of replies[step++] || []) outbox.push({ ...it, seq: ++seq }); };
  const calls = { submitFlow: [] };
  return {
    calls,
    pollMs: 1,
    sendText: async () => push(),
    pickRow: async () => push(),
    tapButton: async () => push(),
    sendMedia: async () => push(),
    submitFlow: async (id, response) => { calls.submitFlow.push({ id, response }); push(); },
    poll: async (after) => outbox.filter((x) => x.seq > after),
  };
}

function player() {
  const seen = [];
  const fn = async (card, ctx) => {
    seen.push({ token: card.flow.token, ...ctx });
    return { ok: true, check_s: 41.5, session_id: 'sess-9', response_json: { flow_token: card.flow.token, child_test: 'checked', session_id: 'sess-9' },
      actions: [{ action: 'open_check', cost_s: 3 }, { action: 'confirm_screen', screen: 'URDU', cost_s: 10 }, { action: 'type_count', screen: 'URDU', field: 'u_wc', reason: 'fill_empty', cost_s: 4 },
        { action: 'choose_radio', screen: 'URDU', field: 'u_fs1', reason: 'no_key', cost_s: 2.5 }],
      rtts: [{ action: 'INIT', ms: 120 }] };
  };
  fn.seen = seen;
  return fn;
}

describe('runVisit with a check player', () => {
  for (const mode of ['batch', 'inline']) {
    test(`${mode}: the card is played, its actions timed, and the completion carries the endpoint's response_json`, async () => {
      const transport = scriptedBot();
      const tl = createTimeline(path.join(tmp, `${mode}.jsonl`));
      const checkPlayer = player();
      const res = await runVisit({ transport, timeline: tl, fixtures: [{ id: 'AA_one', dir: fx, grade: 3, strip }], checks: checksMode(mode), checkPlayer, timeoutMs: 2000, sleep: async () => {} });
      expect(res).toMatchObject({ ok: true, checksSubmitted: 1 });
      expect(checkPlayer.seen).toEqual([{ token: 'coach-1:child-test-check:sess-9', child: 'AA_one', roll: 14 }]);
      expect(transport.calls.submitFlow).toEqual([{ id: 'FLOW-1', response: { flow_token: 'coach-1:child-test-check:sess-9', child_test: 'checked', session_id: 'sess-9' } }]);
      const acts = tl.events.filter((e) => e.step === 'check_action');
      expect(acts.map((e) => [e.child, e.action, e.reason || null])).toEqual([['AA_one', 'open_check', null], ['AA_one', 'confirm_screen', null], ['AA_one', 'type_count', 'fill_empty'], ['AA_one', 'choose_radio', 'no_key']]);
      const s = summarise(tl.events);
      expect(s.per_child.AA_one.check).toMatchObject({ check_s: 41.5, actions: 4, typed: 1, ticked: 0, chosen: 1, ok: true });
      // a field the fixture has no key for (a section the May audio never had) is counted apart, with its cost
      expect(s.per_child.AA_one.check).toMatchObject({ nokey: 1, nokey_s: 2.5 });
      expect(s.checks).toMatchObject({ n: 1, total_s: 41.5 });
    });
  }

  test('a check the player could not finish is logged and not submitted', async () => {
    const transport = scriptedBot();
    const tl = createTimeline(path.join(tmp, 'fail.jsonl'));
    const checkPlayer = async () => ({ ok: false, reason: 'screen URDU refused', actions: [], rtts: [], check_s: 0 });
    const res = await runVisit({ transport, timeline: tl, fixtures: [{ id: 'AA_one', dir: fx, grade: 3, strip }], checks: 'batch', checkPlayer, timeoutMs: 2000, sleep: async () => {} });
    expect(transport.calls.submitFlow).toEqual([]);
    expect(res.checksFailed).toEqual([{ child: 'AA_one', roll: 14, reason: 'screen URDU refused' }]);
    expect(tl.events.some((e) => e.step === 'check_done' && e.ok === false)).toBe(true);
  });
});

describe('driver options', () => {
  test('--checks inline is the coach.js "interleaved" mode; batch and none pass through', () => {
    expect(checksMode('inline')).toBe('interleaved');
    expect(checksMode('batch')).toBe('batch');
    expect(checksMode('none')).toBe('none');
    expect(() => checksMode('sometimes')).toThrow(/--checks/);
  });

  test('pickFixtures --grade keeps only that grade (the visit\'s grade decides the passage)', () => {
    const dir = path.join(tmp, 'fixtures');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '_manifest.json'), JSON.stringify([
      { fixture_id: 'a', grade: 5, band: 'fluent' }, { fixture_id: 'b', grade: 3, band: 'fluent' },
      { fixture_id: 'c', grade: 3, band: 'non_reader' }, { fixture_id: 'd', grade: 5, band: 'non_reader' },
    ]));
    expect(pickFixtures(dir, 5, null, 3).map((f) => f.id).sort()).toEqual(['b', 'c']);
    expect(pickFixtures(dir, 5, null).length).toBe(4);
  });
});

describe('a second run on the same stack', () => {
  test('replies already in the outbox before the run starts are not taken as this run\'s', async () => {
    const transport = scriptedBot();
    // the previous run's list and acks are still in the mock outbox
    await transport.sendText('/egra');
    const stale = (await transport.poll(0)).length;
    expect(stale).toBeGreaterThan(0);
    const tl = createTimeline(path.join(tmp, 'stale.jsonl'));
    const res = await runVisit({ transport, timeline: tl, fixtures: [{ id: 'AA_one', dir: fx, grade: 3, strip }], checks: 'none', timeoutMs: 300, sleep: async () => {} });
    // the scripted bot answers the real /egra with the NEXT reply (buttons), never a fresh list, so a
    // driver that skipped the backlog times out waiting for the list instead of riding the stale one
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/today's list/);
    expect(tl.events.filter((e) => e.dir === 'in').every((e) => e.seq > stale)).toBe(true);
  });
});
