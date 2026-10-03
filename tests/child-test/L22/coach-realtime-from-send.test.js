'use strict';
/**
 * bd-s1oo0.30 (L22) — in --realtime mode the child's speaking time starts when the bot SENT the
 * block's prompt, not when the driver happened to SEE it.
 *
 * In sandbox mode the driver reads the bot's replies back from Axiom: the prompt reaches it a median
 * 4.0 s (p90 5.2 s) after the bot sent it (sandbox5-syn-2032, sandbox2-l22-*). A phone shows it at
 * once. Holding the note's full length from the moment Axiom showed the prompt added that lag to every
 * block of every child, and the run reported it as the coach's time. The hold now runs from the
 * prompt's `sent_ms` (the bot's own clock, carried on every Axiom item).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTimeline } = require('../../../bot/scripts/e2e/child-test-sim/timeline');
const { runVisit } = require('../../../bot/scripts/e2e/child-test-sim/coach');

const LAG_MS = 4000;   // the prompt is seen this long after the bot sent it

function laggedBot() {
  let seq = 0; const out = [];
  const emit = (item) => out.push({ seq: ++seq, sent_ms: Date.now() - LAG_MS, ...item });
  const prompt = (b) => emit({ type: 'interactive.button', txt: `*${b}*`, btns: ['Stop'],
    raw: { interactive: { action: { buttons: [{ type: 'reply', reply: { id: 'ctst_stop', title: 'Stop' } }] } } } });
  const NEXT = { urdu: 'english', english: 'maths' };
  let block = null;
  return {
    pollMs: 1,
    async sendText() { emit({ type: 'interactive.list', txt: 'Grade 3', btns: ['Children'], list: { rows: [{ id: 'ctst_child:d9', title: 'رول ۹ · c' }] }, raw: {} }); },
    async pickRow() { emit({ type: 'interactive.button', txt: 'present?', btns: ['Present'], raw: { interactive: { action: { buttons: [{ type: 'reply', reply: { id: 'ctst_pres:d9:p', title: 'Present' } }] } } } }); },
    async tapButton() { block = 'urdu'; prompt('urdu'); },
    async sendMedia() {
      emit({ type: 'text', txt: `🎧 ${block}`, btns: [], raw: { type: 'text' } });
      if (NEXT[block]) { block = NEXT[block]; return prompt(block); }
      return emit({ type: 'interactive.button', txt: 'photo?', btns: ['No photo'], raw: { interactive: { action: { buttons: [{ type: 'reply', reply: { id: 'ctst_nophoto:s1', title: 'No photo' } }] } } } });
    },
    async poll(after) { return out.filter((i) => i.seq > after); },
  };
}

test('each note is held for its length counted from the prompt\'s send time, so Axiom\'s lag is not added', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l22-fx-'));
  for (const b of ['urdu', 'english', 'maths']) fs.writeFileSync(path.join(dir, `${b}.ogg`), 'x');
  const tl = createTimeline(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'l22-tl-')), 'timeline.jsonl'));
  const holds = [];
  const sleep = async (ms) => { if (ms >= 1000) holds.push(ms); };
  const res = await runVisit({ transport: laggedBot(), timeline: tl, fixtures: [{ id: 'fx', dir }], checks: 'none',
    realtime: true, audioSeconds: () => 60, sleep, timeoutMs: 5000 });
  expect(res.ok).toBe(true);
  expect(holds).toHaveLength(3);
  // 60 s of speaking, of which ~4 s had already passed when the driver saw the prompt
  for (const ms of holds) {
    expect(ms).toBeLessThanOrEqual(60000 - LAG_MS + 250);
    expect(ms).toBeGreaterThanOrEqual(60000 - LAG_MS - 1000);
  }
});

test('a prompt with no send time (the dry-mode mock) still holds the note\'s full length', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l22-fx-'));
  for (const b of ['urdu', 'english', 'maths']) fs.writeFileSync(path.join(dir, `${b}.ogg`), 'x');
  const tl = createTimeline(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'l22-tl-')), 'timeline.jsonl'));
  const bot = laggedBot();
  const poll = bot.poll;
  bot.poll = async (after) => (await poll(after)).map(({ sent_ms, ...it }) => it);
  const holds = [];
  const res = await runVisit({ transport: bot, timeline: tl, fixtures: [{ id: 'fx', dir }], checks: 'none',
    realtime: true, audioSeconds: () => 60, sleep: async (ms) => { if (ms >= 1000) holds.push(ms); }, timeoutMs: 5000 });
  expect(res.ok).toBe(true);
  expect(holds).toEqual([60000, 60000, 60000]);
});
