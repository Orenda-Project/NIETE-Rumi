'use strict';
/**
 * bd-pw1ccr.8.4 — the one-off 2 Nov formative-assessment video to the teachers of the topic-nudge A/B.
 * bd-pw1ccr.12 — both arms hear it: every teacher in a school of niete_topic_nudge_ab_assignment, control (A, from
 * v10 groups A+C) and treatment (B, from v10 groups B+D). The dry run prints the split and the cost: the template's
 * category comes from its approved status (deps.templateStatus); MARKETING is costed at Meta's Pakistan rate,
 * anything else, or a status that cannot be read, prints "rate unknown". No other rate is ever assumed.
 *
 * Audience: teachers (role 'teacher', not deleted, not test users, a real phone) whose school is in the test.
 * One message per phone. Nothing to families, principals or schools outside the test.
 * Switch: app_settings.fa_video_broadcast_enabled (V1.8.5, false). Fails closed. Only --live checks it.
 * Modes:  (default) dry run: prints the counts, sends and writes nothing.
 *         --to <n,n>  review copies to operator/test numbers only; no switch, no log rows.
 *         --live      the broadcast; needs the switch on and --video. Logged to broadcast_logs/_messages,
 *                     so a re-run skips everyone already sent this template.
 * Pure of I/O: the db client, upload, send, print and sleep come in as deps (scripts/broadcast-fa-video.js).
 */

const { TEMPLATE, sendComponents } = require('../../templates/fa-video.template');

const FLAG_KEY = 'fa_video_broadcast_enabled';
const GROUP_TABLE = 'niete_topic_nudge_ab_assignment';
const PAGE = 1000;
const CHUNK = 200;
const PACE_MS = 120;
const RATE_USD = { MARKETING: 0.0473 }; // Meta, Pakistan, per delivered template message

// Operator/test numbers (docs/environments.md) come from the env, never source: the repo is public.
function testNumbersFrom(env) {
  return String(env.FA_VIDEO_TEST_NUMBERS || '').split(',').map((n) => n.trim()).filter(Boolean);
}

function parseArgs(argv) {
  const at = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const to = at('--to');
  return {
    live: argv.includes('--live'),
    to: to ? to.split(',').map((s) => s.trim()).filter(Boolean) : [],
    video: at('--video') || null,
  };
}

function isOn(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { /* keep the raw string */ }
  }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

async function switchOn(db) {
  try {
    const { data, error } = await db.from('app_settings').select('key,value').eq('key', FLAG_KEY).maybeSingle();
    if (error) return false;
    return Boolean(data && isOn(data.value));
  } catch (_) {
    return false;
  }
}

async function rows(label, build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

async function audience(db) {
  const groupOf = new Map((await rows('test schools', () => db.from(GROUP_TABLE).select('school_id, ab_group')))
    .map((r) => [r.school_id, r.ab_group]));
  const schools = [...groupOf.keys()];
  const byPhone = new Map();
  for (let i = 0; i < schools.length; i += CHUNK) {
    // eslint-disable-next-line no-await-in-loop
    const users = await rows('test teachers', () => db.from('users')
      .select('id, school_id, phone_number, is_test_user')
      .in('school_id', schools.slice(i, i + CHUNK))
      .eq('role', 'teacher')
      .is('deleted_at', null));
    // is_test_user filtered here: .neq would drop the NULL rows, which is most real teachers.
    for (const u of users) {
      const phone = u.phone_number || '';
      if (u.is_test_user === true || !/^\d{10,15}$/.test(phone) || byPhone.has(phone)) continue;
      byPhone.set(phone, { id: u.id, phone_number: phone, group: groupOf.get(u.school_id) });
    }
  }
  return [...byPhone.values()];
}

async function alreadySent(db) {
  const logs = await rows('earlier runs', () => db.from('broadcast_logs').select('id').eq('template_name', TEMPLATE.name));
  const ids = logs.map((l) => l.id);
  if (!ids.length) return new Set();
  const sent = await rows('earlier sends', () => db.from('broadcast_messages')
    .select('user_id, status').in('broadcast_id', ids).eq('status', 'sent'));
  return new Set(sent.map((m) => m.user_id));
}

async function must(label, p) {
  const { data, error } = await p;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function sendAll(recipients, components, d, onEach) {
  let sent = 0;
  let failed = 0;
  for (const r of recipients) {
    // eslint-disable-next-line no-await-in-loop
    const res = await d.send(r.phone_number, components);
    if (res && res.ok) sent += 1; else failed += 1;
    // eslint-disable-next-line no-await-in-loop
    if (onEach) await onEach(r, res || { ok: false, error: 'no response' });
    // eslint-disable-next-line no-await-in-loop
    await d.sleep(PACE_MS);
  }
  return { sent, failed };
}

async function testSend(opts, d) {
  const allowed = d.testNumbers || [];
  if (!allowed.length) throw new Error('--to: no operator/test numbers set; put them in FA_VIDEO_TEST_NUMBERS');
  const bad = opts.to.filter((n) => !allowed.includes(n));
  if (bad.length) throw new Error(`--to takes operator/test numbers only; not a test number: ${bad.join(', ')}`);
  if (!opts.video) throw new Error('--to needs --video <mp4>');
  const components = sendComponents(await d.upload(opts.video));
  const r = await sendAll(opts.to.map((p) => ({ phone_number: p })), components, d);
  d.print(`test send: ${r.sent} sent, ${r.failed} failed`);
  return { mode: 'test', ...r };
}

async function liveSend(todo, opts, d) {
  const components = sendComponents(await d.upload(opts.video));
  const log = await must('broadcast_logs insert', d.db.from('broadcast_logs').insert({
    admin_username: 'scripts/broadcast-fa-video.js (bd-pw1ccr.8.4)',
    message_content: TEMPLATE.body,
    filters: { ab_table: GROUP_TABLE, ab_groups: ['A', 'B'], role: 'teacher' },
    template_name: TEMPLATE.name,
    total_recipients: todo.length,
    status: 'sending',
    started_at: new Date().toISOString(),
  }).select('id').single());
  const r = await sendAll(todo, components, d, (u, res) => must('broadcast_messages insert', d.db.from('broadcast_messages').insert({
    broadcast_id: log.id,
    user_id: u.id,
    phone_number: u.phone_number,
    message_id: res.id || null,
    status: res.ok ? 'sent' : 'failed',
    error_message: res.ok ? null : String(res.error || 'send failed'),
    sent_at: res.ok ? new Date().toISOString() : null,
  })));
  await must('broadcast_logs update', d.db.from('broadcast_logs').update({
    sent_count: r.sent, failed_count: r.failed, status: 'completed', completed_at: new Date().toISOString(),
  }).eq('id', log.id));
  d.print(`live: ${r.sent} sent, ${r.failed} failed (broadcast_logs ${log.id})`);
  return { mode: 'live', broadcastId: log.id, ...r };
}

async function readTemplate(d) {
  try {
    const t = d.templateStatus ? await d.templateStatus() : null;
    return { status: (t && t.status) || null, category: (t && t.category) || null };
  } catch (_) {
    return { status: null, category: null };
  }
}

function costLine(toSend, category) {
  const rate = RATE_USD[category];
  if (rate === undefined) return { costUsd: null, line: `cost: rate unknown for category ${category || 'unread'}` };
  const costUsd = Math.round(toSend * rate * 100) / 100;
  return { costUsd, line: `cost: ${toSend} x $${rate} (${category}, Pakistan) = $${costUsd.toFixed(2)}` };
}

async function run(argv, d) {
  const opts = parseArgs(argv);
  if (opts.to.length) return testSend(opts, d);
  const on = await switchOn(d.db);
  const all = await audience(d.db);
  const done = await alreadySent(d.db);
  const todo = all.filter((u) => !done.has(u.id));
  const t = await readTemplate(d);
  const cost = costLine(todo.length, t.category);
  const counts = {
    switchOn: on, audience: all.length, alreadySent: all.length - todo.length, toSend: todo.length,
    control: all.filter((u) => u.group === 'A').length, treatment: all.filter((u) => u.group === 'B').length,
    templateStatus: t.status, category: t.category, costUsd: cost.costUsd,
  };
  d.print(`${TEMPLATE.name}: teachers in the test ${counts.audience} (control (A+C) ${counts.control}, `
    + `treatment (B+D) ${counts.treatment}), already sent ${counts.alreadySent}, to send ${counts.toSend}; `
    + `switch ${FLAG_KEY} is ${on ? 'ON' : 'OFF'}`);
  d.print(`template ${t.status || 'status unread'}; ${cost.line}`);
  if (!opts.live) return { mode: 'dry-run', ...counts };
  if (!on) throw new Error(`${FLAG_KEY} is off: nothing sent. Turn it on for the send, then off again.`);
  if (!opts.video) throw new Error('--live needs --video <mp4>');
  return { ...counts, ...(await liveSend(todo, opts, d)) };
}

module.exports = { FLAG_KEY, testNumbersFrom, parseArgs, switchOn, audience, alreadySent, run };
