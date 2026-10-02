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
};
const isPresent = (id) => /present/i.test(id || '') || /^ctst_pres:.*:p$/.test(id || '');
const isAbsent = (id) => /absent/i.test(id || '') || /^ctst_pres:.*:a$/.test(id || '');
function buttonsOf(it) {
  const a = it.raw && it.raw.interactive && it.raw.interactive.action;
  return ((a && a.buttons) || []).map((b) => ({ id: b.reply && b.reply.id, title: b.reply && b.reply.title }));
}
// the roll is the first number in the row title (L4: "<roll> · <name>"; CONTRACT fake: "Roll <n>"); never log the title itself
const rollOf = (row) => Number((/(\d+)/.exec(row.title || '') || /(\d+)$/.exec(row.id || '') || [])[1]);
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
  const result = { ok: false, children: [], absent: [], checksSubmitted: 0 };

  async function pump() {
    const items = await transport.poll(cursor);
    for (const it of items) {
      cursor = Math.max(cursor, it.seq || cursor + 1);
      tl.log({ dir: 'in', kind: it.type, seq: it.seq, detail: (it.txt || '').slice(0, 80), btns: it.btns });
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
  async function waitChecks(n) {
    const deadline = Date.now() + timeoutMs;
    while (pendingChecks.length < n) {
      if (Date.now() > deadline) throw new Error(`timeout waiting for: ${n} check cards (have ${pendingChecks.length})`);
      await pump(); await sleep(transport.pollMs || 300);
    }
  }
  const byRoll = {};
  async function submitCheck(card) {
    const roll = Number((/(\d+)$/.exec(card.flow.token || '') || [])[1]);
    // a token that names no roll (a session-keyed token) is matched to the children in the order their checks arrive
    const child = byRoll[roll] || (result.children[result.checksSubmitted] || {}).fixture || `check-${result.checksSubmitted + 1}`;
    const response = opts.checkResponse ? opts.checkResponse(card, child) : { flow_token: card.flow.token, ctst_action: 'confirm' };
    await transport.submitFlow(card.flow.id, response);
    tl.log({ dir: 'out', kind: 'flow', step: 'check', child, roll });
    await waitFor('check saved', match.ack, { child });
    result.checksSubmitted += 1;
  }

  try {
    await transport.sendText(opts.startText || '/egra');
    tl.log({ dir: 'out', kind: 'text', step: 'start' });
    let list = await waitFor("today's list", match.list);
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
          list = await waitFor('list after absent', match.list);
          continue;
        }
        const b = btns.find((x) => isPresent(x.id));
        await transport.tapButton(b.id, b.title);
        tl.log({ dir: 'out', kind: 'button', step: 'present', child: fx.id, roll });
        await waitFor('urdu prompt', match.ack, { child: fx.id });
        byRoll[roll] = fx.id;
        for (const block of ['urdu', 'english', 'maths']) {
          const file = path.join(fx.dir, `${block}.ogg`);
          if (!fs.existsSync(file)) throw new Error(`fixture ${fx.id} has no ${block}.ogg`);
          if (realtime) await sleep(audioSeconds(file) * 1000);
          await transport.sendMedia('audio', file);
          tl.log({ dir: 'out', kind: 'audio', step: 'block', child: fx.id, block, bytes: fs.statSync(file).size });
          await waitFor(`${block} ack`, match.ack, { child: fx.id });
        }
        if (fx.strip) {
          await transport.sendMedia('image', fx.strip);
          tl.log({ dir: 'out', kind: 'image', step: 'strip', child: fx.id, block: 'strip' });
          await waitFor('strip ack', match.ack, { child: fx.id });
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
    if (checksMode === 'batch' || result.checksSubmitted < result.children.length) {
      await waitChecks(result.children.length - result.checksSubmitted);
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

module.exports = { runVisit, DEFAULT_MATCH };
