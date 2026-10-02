'use strict';
/**
 * A reply read from Axiom is seen seconds after the bot sent it (ingest lag). The round trip the
 * timing model needs is coach-send → bot-send, so an inbound item that carries the bot's own
 * `sent_ms` is placed on the timeline at that time, with the time the driver saw it kept beside it.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTimeline, summarise } = require('../../../bot/scripts/e2e/child-test-sim/timeline');
const { runVisit } = require('../../../bot/scripts/e2e/child-test-sim/coach');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'l12-tl-')), 'timeline.jsonl');

test('an event with `at` is stamped at that time; the clock time is kept as seen_ms', () => {
  let now = 10000;
  const tl = createTimeline(tmp(), { clock: () => now });
  tl.log({ dir: 'out', kind: 'text', step: 'start' });
  now = 14000;
  const rec = tl.log({ dir: 'in', kind: 'text', at: 11500 });
  expect(rec.t_ms).toBe(1500);
  expect(rec.seen_ms).toBe(4000);
  expect(summarise(tl.events).rtt_samples.rtt_text_reply).toEqual([1.5]);
});

test('the coach player passes an item\'s sent_ms through, so the measured RTT is to the bot\'s send', async () => {
  let now = 50000;
  const sleep = async (ms) => { now += ms; };
  const tl = createTimeline(tmp(), { clock: () => now });
  const list = { seq: 1, type: 'interactive.list', txt: 'Today', btns: ['Children'], list: { rows: [{ id: 'ctst_child:d1', title: '4 · c' }] }, raw: {} };
  let sent = false;
  const transport = {
    pollMs: 1000,
    async sendText() { now += 10; sent = now; },
    // Axiom shows the list 6 s after the bot sent it 2 s after the coach's /egra
    async poll() { return sent && now >= sent + 6000 ? [{ ...list, sent_ms: sent + 2000 }] : []; },
    async pickRow() { throw new Error('stop here'); },
  };
  await runVisit({ transport, timeline: tl, fixtures: [{ id: 'fx1', dir: '/nope' }], sleep, timeoutMs: 60000 });
  const s = summarise(tl.events);
  expect(s.rtt_samples.rtt_text_reply[0]).toBe(2);
});
