'use strict';
/**
 * The coach player against L4's real conversation (machine.js), as the mock-lane run of 2 Oct showed it:
 *
 *   list (ctst_child:<drawId>, titles «رول ۹ · …» in Urdu digits) → tap → Present/Absent/Refused buttons
 *   → per block: N card IMAGES, then the prompt (buttons ctst_fb / ctst_stop / ctst_menu)
 *   → voice note → text ack «🎧 ملا · …» → next block's cards + prompt
 *   → after maths: the photo ask (button ctst_nophoto:<sessionId>) and the list again
 *   → strip photo → «saved» text → «done» text.
 *
 * Seen on 2 Oct: the player took a card image as the voice-note ack and sent all three notes in 5 s,
 * so the bot stored all three as the Urdu block (one row, overwritten twice). The player must wait
 * for each block's prompt before recording it, and read roll numbers written in Urdu digits.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTimeline, summarise } = require('../../../bot/scripts/e2e/child-test-sim/timeline');
const { runVisit, rollOf } = require('../../../bot/scripts/e2e/child-test-sim/coach');

const URDU = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

function l4Bot({ rolls = [9, 23, 13], alternates = [3, 4], cardsPerBlock = 2 } = {}) {
  let seq = 0; const out = []; const got = [];
  let now = 0;
  const emit = (item, delay = 1000) => { now = Math.max(now, Date.now()) + delay; out.push({ seq: ++seq, sent_ms: now, ...item }); };
  const text = (txt, d) => emit({ type: 'text', txt, btns: [], raw: { type: 'text', text: { body: txt } } }, d);
  const image = (d) => emit({ type: 'image', txt: '', btns: [], raw: { type: 'image' } }, d);
  const btn = (txt, buttons, d) => emit({ type: 'interactive.button', txt, btns: buttons.map((b) => b.title),
    raw: { interactive: { action: { buttons: buttons.map((b) => ({ type: 'reply', reply: b })) } } } }, d);
  const state = { rows: [...rolls], alts: [...alternates], absent: new Set(), cur: null, block: null, sessions: 0 };
  const list = () => emit({ type: 'interactive.list', txt: 'Grade 3', btns: ['Children'], list: { rows: [
    ...state.rows.map((r) => ({ id: `ctst_child:d${r}`, title: `رول ${URDU(r)} · Child 3A-${String(r).padStart(2, '0')}` })),
    ...state.alts.map((r) => ({ id: `ctst_alt:d${r}`, title: `رول ${URDU(r)} · Child 3A-${String(r).padStart(2, '0')}` })),
  ] }, raw: {} });
  const block = (b) => { state.block = b; for (let i = 0; i < cardsPerBlock; i++) image(6000); btn(`*${b}*`, [{ id: 'ctst_stop', title: 'Stop' }, { id: 'ctst_menu', title: 'Menu' }], 6000); };
  const NEXT = { urdu: 'english', english: 'maths' };
  return {
    got, out,
    transport: {
      pollMs: 500,
      async sendText(t) { got.push(['text', t]); list(); },
      async pickRow(id) {
        got.push(['row', id]); state.cur = Number(/d(\d+)$/.exec(id)[1]);
        btn(`*بچہ ۱ از ۵* رول ${URDU(state.cur)} · Child 3A-${String(state.cur).padStart(2, '0')}`, [{ id: `ctst_pres:d${state.cur}:p`, title: 'Present' }, { id: `ctst_pres:d${state.cur}:a`, title: 'Absent' }, { id: `ctst_pres:d${state.cur}:r`, title: 'Refused' }]);
      },
      async tapButton(id) {
        got.push(['button', id]);
        const [, , code] = /^ctst_pres:d(\d+):([par])$/.exec(id);
        if (code === 'p') { state.sessions += 1; return block('urdu'); }
        state.absent.add(state.cur); text('absent; next promoted'); return list();
      },
      async sendMedia(kind) {
        got.push([kind, state.block]);
        if (kind === 'image') { text('photo saved', 2000); return text('child done', 1000); }
        text(`🎧 ملا · ${state.block}`, 3000);
        if (NEXT[state.block]) return block(NEXT[state.block]);
        state.block = null;
        btn('photo?', [{ id: 'ctst_nophoto:s1', title: 'No photo' }], 1000);
        return list();
      },
      async poll(after) { return out.filter((i) => i.seq > after); },
    },
  };
}

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'l12-l4-')), 'timeline.jsonl');
const fx = (id) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `l12-fx-${id}-`));
  for (const b of ['urdu', 'english', 'maths']) fs.writeFileSync(path.join(dir, `${b}.ogg`), 'x');
  return { id, dir, strip: path.join(dir, 'urdu.ogg') };
};

test('rollOf reads Urdu and Arabic-Indic digits as well as ASCII', () => {
  expect(rollOf({ title: 'رول ۲۳ · Child 3A-23' })).toBe(23);
  expect(rollOf({ title: 'Roll 7' })).toBe(7);
  expect(rollOf({ title: 'رقم ١٢' })).toBe(12);
});

test('each block\'s voice note is sent only after that block\'s prompt, never on a card image', async () => {
  const bot = l4Bot();
  const tl = createTimeline(tmp());
  const res = await runVisit({ transport: bot.transport, timeline: tl, fixtures: [fx('a')], checks: 'none', sleep: async () => {}, timeoutMs: 5000 });
  expect(res.error).toBeUndefined();
  expect(res.ok).toBe(true);
  expect(bot.got.filter(([k]) => k === 'audio')).toEqual([['audio', 'urdu'], ['audio', 'english'], ['audio', 'maths']]);
  expect(bot.got.filter(([k]) => k === 'image')).toEqual([['image', null]]);
  const ready = tl.events.filter((e) => e.dir === 'mark' && e.step === 'ready').map((e) => e.block);
  expect(ready).toEqual(['urdu', 'english', 'maths', 'photo']);
  const s = summarise(tl.events);
  expect(s.rtt_samples.rtt_block_ready.length).toBe(3);   // note sent → the next block (or the photo ask) is ready
  expect(Math.min(...s.rtt_samples.rtt_block_ready)).toBeGreaterThanOrEqual(12);   // ack + 2 paced cards + prompt
});

test('an absent child in Urdu digits takes the next row; the roll is logged, never the name', async () => {
  const bot = l4Bot();
  const tl = createTimeline(tmp());
  const res = await runVisit({ transport: bot.transport, timeline: tl, fixtures: [fx('a')], absentRolls: [9], checks: 'none', sleep: async () => {}, timeoutMs: 5000 });
  expect(res.ok).toBe(true);
  expect(res.absent).toEqual([{ roll: 9 }]);
  expect(res.children).toEqual([{ fixture: 'a', roll: 23 }]);
  expect(bot.got.filter(([k]) => k === 'button').map(([, id]) => id)).toEqual(['ctst_pres:d9:a', 'ctst_pres:d23:p']);
  expect(fs.readFileSync(tl.file, 'utf8')).not.toMatch(/Child 3A/);
});

test('after an absence the NEWEST list is used, not the one left over from the last child\'s maths', async () => {
  // child 1 (roll 9) is tested — the bot re-sends the list after maths; roll 23 is absent — the bot's NEW
  // list carries an alternate topped up (roll 4); the third child must come from that newest list
  const bot = l4Bot({ rolls: [9, 23], alternates: [3] });
  const origTap = bot.transport.tapButton;
  bot.transport.tapButton = async (id) => {
    await origTap(id);
    if (/:a$/.test(id)) bot.out[bot.out.length - 1].list.rows.push({ id: 'ctst_alt:d4', title: 'رول ۴ · Child 3A-04' });
  };
  const tl = createTimeline(tmp());
  const res = await runVisit({ transport: bot.transport, timeline: tl, fixtures: [fx('a'), fx('b'), fx('c')], absentRolls: [23], checks: 'none', sleep: async () => {}, timeoutMs: 5000 });
  expect(res.error).toBeUndefined();
  expect(res.children.map((c) => c.roll)).toEqual([9, 3, 4]);
});
