#!/usr/bin/env node
'use strict';
/**
 * strip-dry — a by-hand run of the web quiz's weekly health numbers (bot/shared/services/quiz/web-quiz-strip.js
 * weeklyStrip) that WRITES NOTHING: the strip's rows go to stdout instead of web_quiz_strip_weekly, so a new line can be
 * read on a database the day it lands instead of at the next Monday tick. Same reads as the real run, same rows.
 *
 *   node scripts/web-quiz/strip-dry.js --week 2026-W42    # that ISO week (PKT)
 *   node scripts/web-quiz/strip-dry.js                    # the current ISO week (PKT), named on stderr
 *
 * stdout: one JSON line per row, {"week","line","cell","value","n"}, then a last line
 * {"week","lines":<rows>,"skipped":[<line names not computed>],"wrote":0}. Counts and shares only, never an id, a
 * name or a phone. READ-ONLY. Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (read through the
 * bot's own client; nothing else is loaded here). Exit 0; 2 = usage or no env.
 */
const WEEK_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;

async function main({ argv = process.argv.slice(2), env = process.env, io = process, now = Date.now() } = {}) {
  const say = (s) => io.stderr.write(`${s}\n`);
  let week = null;
  const at = argv.indexOf('--week');
  if (at !== -1) {
    week = argv[at + 1];
    if (!week || !WEEK_RE.test(week)) { say('usage: strip-dry.js [--week <YYYY-Www>]'); return 2; }
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    say('strip-dry: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set; refusing to run');
    return 2;
  }
  const Strip = require('../../bot/shared/services/quiz/web-quiz-strip');
  if (!week) {
    week = Strip.isoWeekOf(now);
    say(`strip-dry: no --week given; the current ISO week (PKT), ${week}`);
  }
  const rows = [];
  const out = await Strip.weeklyStrip({ week, now, sink: async (lines) => { rows.push(...lines); } });
  for (const l of rows) io.stdout.write(`${JSON.stringify({ week: l.week, line: l.line, cell: l.cell, value: l.value, n: l.n })}\n`);
  io.stdout.write(`${JSON.stringify({ week, lines: rows.length, skipped: out.skipped, wrote: 0 })}\n`);
  return 0;
}

if (require.main === module) {
  // exit when done: the bot's clients (Redis) may hold the event loop open
  main().then((code) => process.exit(code), (e) => { process.stderr.write(`strip-dry: ${e.message}\n`); process.exit(1); });
}

module.exports = { main, WEEK_RE };
