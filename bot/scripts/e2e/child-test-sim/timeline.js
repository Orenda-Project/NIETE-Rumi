/**
 * timeline — one JSON line per thing that happened in a simulated coach visit.
 *
 *   { t_ms, iso, since_prev_ms, dir: 'out'|'in'|'mark', kind, step, child?, block?, detail? }
 *
 * `out` is the coach's send, `in` is a bot message the driver saw, `mark` is a driver milestone
 * (child_done, visit_done). summarise() turns a timeline into the per-child breakdown and the
 * `rtt_samples` that sim/timing_model.py --measured reads.
 */
'use strict';
const fs = require('fs');
const path = require('path');

function createTimeline(file, opts = {}) {
  const clock = opts.clock || (() => Date.now());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let t0 = null; let prev = null;
  const events = [];
  return {
    file,
    events,
    log(ev) {
      const now = clock();
      if (t0 === null) t0 = now;
      const rec = { t_ms: now - t0, iso: new Date(now).toISOString(), since_prev_ms: prev === null ? 0 : now - prev, ...ev };
      prev = now;
      events.push(rec);
      fs.appendFileSync(file, JSON.stringify(rec) + '\n');
      return rec;
    },
  };
}

const RTT_CLASS = { text: 'rtt_text_reply', button: 'rtt_text_reply', list: 'rtt_text_reply',
  audio: 'rtt_media_ack', image: 'rtt_media_ack', document: 'rtt_media_ack', flow: 'rtt_flow_screen' };
const sec = (ms) => Math.round(ms) / 1000;

/** Per send: seconds until the FIRST bot message after it. Per child: start→done and per-block acks. */
function summarise(events) {
  const ev = [...events].sort((a, b) => a.t_ms - b.t_ms);
  const rtt = { rtt_text_reply: [], rtt_media_ack: [], rtt_flow_screen: [] };
  const perChild = {};
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    if (e.child && !perChild[e.child]) perChild[e.child] = { start_s: sec(e.t_ms), blocks: {} };
    if (e.dir !== 'out') continue;
    const reply = ev.slice(i + 1).find((x) => x.dir === 'in');
    const nextOut = ev.slice(i + 1).find((x) => x.dir === 'out');
    if (!reply || (nextOut && nextOut.t_ms < reply.t_ms)) continue;   // a send that drew no reply of its own
    const s = sec(reply.t_ms - e.t_ms);
    const cls = RTT_CLASS[e.kind];
    if (cls) rtt[cls].push(s);
    if (e.child && e.block) perChild[e.child].blocks[e.block] = { ack_s: s };
  }
  for (const e of ev) {
    if (e.dir === 'mark' && e.step === 'child_done' && perChild[e.child]) {
      perChild[e.child].done_s = sec(e.t_ms);
      perChild[e.child].elapsed_s = Math.round((perChild[e.child].done_s - perChild[e.child].start_s) * 1000) / 1000;
    }
  }
  const total = ev.length ? sec(ev[ev.length - 1].t_ms - ev[0].t_ms) : 0;
  const q = (xs, f) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(f * (xs.length - 1))] : null);
  const stats = {};
  for (const [k, xs] of Object.entries(rtt)) stats[k] = { n: xs.length, p50: q(xs, 0.5), p90: q(xs, 0.9), max: xs.length ? Math.max(...xs) : null };
  return { total_s: total, per_child: perChild, rtt_samples: rtt, rtt_stats: stats };
}

module.exports = { createTimeline, summarise };
