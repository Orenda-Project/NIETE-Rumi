/**
 * coach — plays one coach's five-child visit against a bot, through a transport (transports.js), and
 * writes every step to a timeline (timeline.js).
 *
 * It keys on CONTRACT v0.2 conventions only, so it runs unchanged against the fake peer bot and the real
 * L4 handler: today's list is an interactive list with `ctst_child_*` rows; tapping a child brings buttons
 * with a `*present*` id (and `*absent*` / `*refused*`); each block's voice note and the strip photo each
 * draw one bot reply; a check arrives as a Flow card whose token starts `ctst_check`. Matchers can be
 * overridden (opts.match) when L4/L6 settle different ids.
 *
 * Children are identified by fixture id and roll number only — never a name.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULT_MATCH = {
  // CONTRACT style (ctst_child_<n>, *present*) and L4's machine.js style (ctst_child:<drawId>, ctst_pres:<drawId>:p|a|r)
  list: (it) => it.type === 'interactive.list' && (it.list && it.list.rows || []).some((r) => /^ctst_(child|alt)[_:]/.test(r.id)),
  childRow: (r) => /^ctst_child[_:]/.test(r.id),
  altRow: (r) => /^ctst_alt[_:]/.test(r.id),
  presentButtons: (it) => it.type === 'interactive.button' && buttonsOf(it).some((b) => isPresent(b.id)),
  checkCard: (it) => it.type === 'interactive.flow' && !!it.flow,
  ack: (it) => it.type === 'text' || it.type === 'interactive.button' || it.type === 'image',
  // L4 protocol (machine.js): each block is N card images, THEN this prompt; a voice note is answered by
  // a TEXT ack; after maths comes the photo ask. A card image is never an ack.
  l4List: (it) => (it.list && it.list.rows || []).some((r) => /^ctst_(child|alt):/.test(r.id)),
  l4Prompt: (it) => it.type === 'interactive.button' && buttonsOf(it).some((b) => b.id === 'ctst_stop' || b.id === 'ctst_fb'),
  l4PhotoAsk: (it) => it.type === 'interactive.button' && buttonsOf(it).some((b) => /^ctst_nophoto:/.test(b.id || '')),
  l4Text: (it) => it.type === 'text',
};
const isPresent = (id) => /present/i.test(id || '') || /^ctst_pres:.*:p$/.test(id || '');
const isAbsent = (id) => /absent/i.test(id || '') || /^ctst_pres:.*:a$/.test(id || '');
function buttonsOf(it) {
  const a = it.raw && it.raw.interactive && it.raw.interactive.action;
  return ((a && a.buttons) || []).map((b) => ({ id: b.reply && b.reply.id, title: b.reply && b.reply.title }));
}
// the roll is the first number in the row title (L4: «رول ۹ · <name>», Urdu digits; CONTRACT fake: "Roll <n>"); never log the title itself
const asciiDigits = (s) => String(s || '').replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
  .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
const rollOf = (row) => Number((/(\d+)/.exec(asciiDigits(row.title)) || /(\d+)$/.exec(row.id || '') || [])[1]);
// the name part of a row title («رول ۹ · <name>»): redacted from every logged detail
const nameOf = (row) => { const m = /·\s*(.+)$/.exec(row.title || ''); return m ? m[1].trim() : null; };
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

function audioSeconds(file) {
  try {
    const { execFileSync } = require('child_process');
    return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim()) || 0;
  } catch (e) { return 0; }
}

async function runVisit(opts) {
  const { transport, timeline: tl, fixtures } = opts;
  const match = { ...DEFAULT_MATCH, ...(opts.match || {}) };
  const timeoutMs = opts.timeoutMs || 120000;
  const absentRolls = new Set(opts.absentRolls || []);
  const checksMode = opts.checks || 'batch';
  const realtime = !!opts.realtime;                   // hold each voice note's own length before sending it
  const sleep = opts.sleep || sleepMs;
  const inbox = []; const pendingChecks = []; let cursor = 0;
  const names = new Set();
  const redact = (txt) => { let t = String(txt || ''); for (const n of names) t = t.split(n).join('‹child›'); return t; };
  let l4 = false;   // switched on by the first list that carries L4's ids
  const result = { ok: false, children: [], absent: [], checksSubmitted: 0, checksFailed: [] };

  async function pump() {
    const items = await transport.poll(cursor);
    for (const it of items) {
      cursor = Math.max(cursor, it.seq || cursor + 1);
      for (const r of (it.list && it.list.rows) || []) { const n = nameOf(r); if (n) { names.add(n); rollByName[n] = rollOf(r); } }
      tl.log({ dir: 'in', kind: it.type, seq: it.seq, detail: redact(it.txt).slice(0, 80), btns: it.btns,
        ...(typeof it.sent_ms === 'number' ? { at: it.sent_ms } : {}), ...(it.send_ok === false ? { send_ok: false } : {}) });
      if (match.checkCard(it)) pendingChecks.push(it); else inbox.push(it);
    }
  }
  async function waitFor(label, pred, extra = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = inbox.findIndex(pred);
      if (i !== -1) return inbox.splice(i, 1)[0];
      if (Date.now() > deadline) throw new Error(`timeout waiting for: ${label}` + (extra.child ? ` (${extra.child})` : ''));
      await pump();
      if (inbox.findIndex(pred) === -1) await sleep(transport.pollMs || 300);
    }
  }
  // Lists pile up (L4 re-sends one after every maths note): take the NEWEST, drop the stale ones.
  async function newestList(label) {
    await waitFor(label, match.list).then((it) => inbox.unshift(it));
    await pump();
    const lists = inbox.filter(match.list);
    for (const l of lists) inbox.splice(inbox.indexOf(l), 1);
    return lists[lists.length - 1];
  }
  async function waitChecks(n) {
    const deadline = Date.now() + timeoutMs;
    while (pendingChecks.length < n) {
      if (Date.now() > deadline) throw new Error(`timeout waiting for: ${n} check cards (have ${pendingChecks.length})`);
      await pump(); await sleep(transport.pollMs || 300);
    }
  }
  // Wait for the bot to say "go on" after a send; log how long that took as a `ready` mark (rtt_block_ready).
  async function ready(label, pred, sentAt, extra) {
    const it = await waitFor(label, pred, extra);
    const at = typeof it.sent_ms === 'number' ? it.sent_ms : Date.now();
    tl.log({ dir: 'mark', step: 'ready', block: extra.block, child: extra.child, wait_s: Math.round(at - sentAt) / 1000 });
    return it;
  }
  const byRoll = {};
  const rollByName = {};
  // The check card's header names the child by roll («جانچ: رول ۱۴»), or by the name the list showed.
  function rollOfCard(card) {
    const head = String(card.txt || '').split('\n')[0];
    for (const [n, r] of Object.entries(rollByName)) if (n && head.includes(n)) return r;
    const m = /(\d+)/.exec(asciiDigits(head));
    return m ? Number(m[1]) : NaN;
  }
  async function submitCheck(card) {
    const roll = rollOfCard(card);
    // a card that names no roll is matched to the children in the order their checks arrive
    const child = byRoll[roll] || (result.children[result.checksSubmitted + result.checksFailed.length] || {}).fixture || `check-${result.checksSubmitted + 1}`;
    let response = { flow_token: card.flow.token, ctst_action: 'confirm' };
    if (opts.checkPlayer) {
      // the real check (check-play.js): the Flow played screen by screen, each coach action priced
      const played = await opts.checkPlayer(card, { child, roll: Number.isFinite(roll) ? roll : null });
      for (const a of played.actions || []) {
        tl.log({ dir: 'mark', step: 'check_action', child, action: a.action, ...(a.screen ? { screen: a.screen } : {}), ...(a.field ? { field: a.field } : {}),
          ...(a.reason ? { reason: a.reason } : {}), cost_s: a.cost_s });
      }
      const rtt = (played.rtts || []).map((r) => r.ms / 1000);
      tl.log({ dir: 'mark', step: 'check_done', child, roll, ok: !!played.ok, check_s: played.check_s, rtt_s: rtt, ...(played.ok ? {} : { detail: played.reason }) });
      if (!played.ok) { result.checksFailed.push({ child, roll, reason: played.reason }); return; }
      response = played.response_json;
    } else if (opts.checkResponse) {
      response = opts.checkResponse(card, child);
    }
    await transport.submitFlow(card.flow.id, response);
    tl.log({ dir: 'out', kind: 'flow', step: 'check', child, roll });
    await waitFor('check saved', match.ack, { child });
    result.checksSubmitted += 1;
  }
  const checksDone = () => result.checksSubmitted + result.checksFailed.length;

  try {
    await transport.sendText(opts.startText || '/egra');
    tl.log({ dir: 'out', kind: 'text', step: 'start' });
    let list = await waitFor("today's list", match.list);
    l4 = match.l4List(list);
    const done = new Set();
    for (const fx of fixtures) {
      let tested = false;
      while (!tested) {
        const rows = list.list.rows || [];
        const row = rows.find((r) => match.childRow(r) && !done.has(r.id)) || rows.find((r) => match.altRow(r) && !done.has(r.id));
        if (!row) throw new Error('no child left on the list for fixture ' + fx.id);
        done.add(row.id);
        const roll = rollOf(row);
        await transport.pickRow(row.id, row.title);
        tl.log({ dir: 'out', kind: 'list', step: 'pick_child', child: fx.id, roll });
        const btnMsg = await waitFor('present/absent buttons', match.presentButtons, { child: fx.id });
        const btns = buttonsOf(btnMsg);
        if (absentRolls.has(roll)) {
          const b = btns.find((x) => isAbsent(x.id));
          await transport.tapButton(b.id, b.title);
          tl.log({ dir: 'out', kind: 'button', step: 'absent', roll });
          result.absent.push({ roll });
          list = await newestList('list after absent');
          continue;
        }
        const b = btns.find((x) => isPresent(x.id));
        await transport.tapButton(b.id, b.title);
        const presentAt = Date.now();
        tl.log({ dir: 'out', kind: 'button', step: 'present', child: fx.id, roll });
        if (l4) await ready('urdu prompt', match.l4Prompt, presentAt, { child: fx.id, block: 'urdu' });
        else await waitFor('urdu prompt', match.ack, { child: fx.id });
        byRoll[roll] = fx.id;
        const NEXT = { urdu: 'english', english: 'maths', maths: 'photo' };
        for (const block of ['urdu', 'english', 'maths']) {
          const file = path.join(fx.dir, `${block}.ogg`);
          if (!fs.existsSync(file)) throw new Error(`fixture ${fx.id} has no ${block}.ogg`);
          if (realtime) await sleep(audioSeconds(file) * 1000);
          const sentAt = Date.now();
          await transport.sendMedia('audio', file);
          tl.log({ dir: 'out', kind: 'audio', step: 'block', child: fx.id, block, bytes: fs.statSync(file).size });
          if (!l4) { await waitFor(`${block} ack`, match.ack, { child: fx.id }); continue; }
          await waitFor(`${block} ack`, match.l4Text, { child: fx.id });
          await ready(`${NEXT[block]} ready`, block === 'maths' ? match.l4PhotoAsk : match.l4Prompt, sentAt, { child: fx.id, block: NEXT[block] });
        }
        if (fx.strip) {
          await transport.sendMedia('image', fx.strip);
          tl.log({ dir: 'out', kind: 'image', step: 'strip', child: fx.id, block: 'strip' });
          await waitFor('strip ack', l4 ? match.l4Text : match.ack, { child: fx.id });
          if (l4) await waitFor('child done', match.l4Text, { child: fx.id });
        }
        tl.log({ dir: 'mark', step: 'child_done', child: fx.id, roll });
        result.children.push({ fixture: fx.id, roll });
        tested = true;
        if (checksMode === 'interleaved') {
          await pump();
          while (pendingChecks.length) await submitCheck(pendingChecks.shift());
        }
      }
    }
    if (checksMode !== 'none' && (checksMode === 'batch' || checksDone() < result.children.length)) {
      await waitChecks(result.children.length - checksDone());
      while (pendingChecks.length) await submitCheck(pendingChecks.shift());
    }
    tl.log({ dir: 'mark', step: 'visit_done' });
    result.ok = true;
  } catch (e) {
    tl.log({ dir: 'mark', step: 'error', detail: e.message });
    result.error = e.message;
  }
  return result;
}

module.exports = { runVisit, DEFAULT_MATCH, rollOf };
