/**
 * fake-bot-v3 — an in-process stand-in for the bot's side of a battery-v3 visit (CONTRACT §19 v2 journey + §21.4,
 * §21.6), used by `driver.js --battery v3 --mode dry` and the coach's tests. It is a TRANSPORT (sendText, tapButton,
 * sendMedia, submitFlow, poll), so runVisitV3 drives it exactly as it drives the sandbox bot.
 *
 *   /egra → list [ctst_start] → ctst_start → setup picture [ctst_go] → ctst_go → presence [ctst_pres:dN:p|a|r]
 *   → per task: one plain step text naming the task's title (a gap task: one honest line instead, no note expected)
 *   → a voice note, or "skip"/«چھوڑیں», moves to the next task → after task 18: "done" + the next presence
 *   → after the last child: "All done", the results text, then review pages (one Flow message each) until "Saved".
 *
 * It checks the coach's moves (a note sent where a gap was, a skip on a recorded task) and refuses them, so a dry
 * run fails loudly where the real bot would answer differently. Names are synthetic ("Child Name N").
 */
'use strict';

const { TASKS_V3 } = require('../../../shared/services/child-test/tasks');
const SKIP_RX = /^\s*(skip|next|چھوڑیں|اگلا)\s*$/i;
const PAGE = 15;

function createFakeBotV3({ titles = {}, gaps = [], children = 5, reviewItemsPerChild = 3, lang = 'en', reviewTask = 'ma.discrimination' } = {}) {
  const outbox = [];
  const received = [];
  let seq = 0;
  let child = 0;          // 1-based, 0 before the first presence
  let task = -1;          // index into TASKS_V3 of the step on screen
  let stepsSent = 0;
  let page = 0;
  let done = false;
  const titleOf = (t) => (titles[t] && (titles[t][lang] || titles[t].en)) || t;
  const push = (it) => outbox.push({ seq: ++seq, sent_ms: Date.now(), ...it });
  const text = (txt) => push({ type: 'text', txt });
  const buttons = (txt, ids) => push({ type: 'interactive.button', txt, btns: ids,
    raw: { interactive: { body: { text: txt }, action: { buttons: ids.map((id) => ({ reply: { id, title: id } })) } } } });
  const presence = (n) => buttons(`*Child ${n} of ${children} · Child Name ${n} · 3-A*`, [`ctst_pres:d${n}:p`, `ctst_pres:d${n}:a`, `ctst_pres:d${n}:r`]);

  // review items: reviewItemsPerChild per child, on one task, items i0..; pages of 15
  const items = [];
  for (let c = 1; c <= children; c += 1) {
    for (let i = 0; i < reviewItemsPerChild; i += 1) items.push({ key: `s${c}|${reviewTask}|i${i}`, who: `Child Name ${c} · Maths which is bigger`, q: `Which is bigger: ${10 + i} or ${20 - i}?` });
  }
  const pages = [];
  for (let i = 0; i < items.length; i += PAGE) pages.push(items.slice(i, i + PAGE));

  function sendPage(p) {
    const list = pages[p - 1];
    const data = { heading: `Answers to check · ${p}/${pages.length}`, review_ref: `rv_fake#p${p}` };
    for (let i = 1; i <= PAGE; i += 1) {
      const c = list[i - 1];
      Object.assign(data, { [`i${i}_v`]: Boolean(c), [`i${i}_who`]: c ? c.who : '—', [`i${i}_q`]: c ? c.q : '—', [`i${i}_h`]: 'Heard: nothing clear', [`i${i}_k`]: c ? c.key : '' });
    }
    const token = `coach-sim:child-test-check:rv_fake${p}`;
    const header = pages.length > 1 ? `${list.length} answers need your ear · ${p}/${pages.length}` : `${list.length} answers need your ear`;
    push({ type: 'interactive.flow', txt: header, flow: { id: 'REVIEW-FLOW', token, data },
      raw: { interactive: { header: { text: header }, action: { parameters: { flow_token: token, flow_action_payload: { screen: 'REVIEW', data } } } } } });
  }

  /** Move to the next task of this child: gap tasks get their honest line; after the 18th, the child is done. */
  function nextTask() {
    for (;;) {
      task += 1;
      if (task >= TASKS_V3.length) return childDone();
      stepsSent += 1;
      const t = TASKS_V3[task];
      if (gaps.includes(t)) { text(`${titleOf(t)}: this part is not in the test yet. Moving on.`); continue; }
      text(`*Child Name ${child}* · ${t.split('.')[0]} · ${titleOf(t)}\n1. Tap 🎤 …\nSend.`);
      return null;
    }
  }
  function childDone() {
    task = -1;
    if (child < children) {
      child += 1;
      presence(child);
      return null;
    }
    done = true;
    text(`🎉 All ${children} children done. Thank the teachers.`);
    text('*Child Name 1*\nUrdu: listening 4/6 · …');
    if (pages.length) { page = 1; sendPage(1); }
    return null;
  }
  const refuse = (why) => { text(`(fake bot refused: ${why})`); throw new Error(`fake-bot-v3: ${why}`); };

  return {
    name: 'fake-v3',
    pollMs: 1,
    received,
    get stepsSent() { return stepsSent; },
    async sendText(t) {
      received.push({ kind: 'text', text: t });
      if (/^\/egra$/i.test(String(t).trim())) return buttons(`Grade 3 · ${children} children`, ['ctst_start', 'ctst_send_teachers']);
      if (SKIP_RX.test(t)) {
        if (task < 0 || done) return refuse('skip with no step open');
        text('Skipped.');
        return nextTask();
      }
      return null;
    },
    async tapButton(id) {
      received.push({ kind: 'button', id });
      if (id === 'ctst_start') return buttons('Before the first child …', ['ctst_go']);
      if (id === 'ctst_go') { child = 1; return presence(1); }
      const m = /^ctst_pres:d(\d+):([par])$/.exec(id);
      if (m && Number(m[1]) === child && m[2] === 'p') { task = -1; return nextTask(); }
      return refuse(`unexpected button ${id}`);
    },
    async pickRow(id) { received.push({ kind: 'list', id }); return refuse('v3 has no list rows'); },
    async sendMedia(kind, file) {
      received.push({ kind, file });
      if (kind !== 'audio' || task < 0 || done) return refuse(`a ${kind} with no step open`);
      return nextTask();
    },
    async submitFlow(flowId, response) {
      received.push({ kind: 'flow', flowId, response });
      if (!page) return refuse('a Flow submit with no review open');
      if (page < pages.length) { page += 1; sendPage(page); return null; }
      page = 0;
      text('✓ Saved. The marks for this visit are complete. Thank you.');
      return null;
    },
    async poll(after) { return outbox.filter((it) => it.seq > after); },
    reset: async () => ({ ok: true }),
  };
}

module.exports = { createFakeBotV3, TASKS_V3 };
