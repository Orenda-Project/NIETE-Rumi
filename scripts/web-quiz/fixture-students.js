#!/usr/bin/env node
'use strict';
/**
 * fixture-students — the web quiz's test children, as JSON, for a reader outside the bot (a statement built from an
 * offline pull). The same rule the weekly numbers use (bot/shared/services/quiz/web-quiz-fixture.js), checked in order:
 * meta.test on a run row, a "Testwala" name, a configured seed list, a configured test teacher's class or a child
 * that teacher created.
 *
 *   node scripts/web-quiz/fixture-students.js                    # the whole population
 *   node scripts/web-quiz/fixture-students.js --runs runs.json   # also rule 1 over an offline pull of run rows
 *                                                                # (a JSON array of rows with meta, student_id,
 *                                                                #  canonical_id and class_id)
 *
 * stdout: {"rule":"meta.test|name|list|teacher","student_ids":[...],"counts":{"meta_test":n,"name":n,"list":n,"teacher":n}}
 * Ids and counts only, never a name or a phone. READ-ONLY. Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the
 * environment (read through the bot's own client; nothing else is loaded here). Exit 0; 2 = usage or no env;
 * 3 = a table could not be read (the JSON still prints; stderr names the table, and its rules left nothing out).
 */
const fs = require('fs');

const RULE = 'meta.test|name|list|teacher';

async function main({ argv = process.argv.slice(2), env = process.env, io = process } = {}) {
  const say = (s) => io.stderr.write(`${s}\n`);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    say('fixture-students: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set; refusing to run');
    return 2;
  }
  let rows;
  const at = argv.indexOf('--runs');
  if (at !== -1) {
    const file = argv[at + 1];
    if (!file) { say('usage: fixture-students.js [--runs <runs.json>]'); return 2; }
    try {
      const got = JSON.parse(fs.readFileSync(file, 'utf8'));
      rows = Array.isArray(got) ? got : (got && Array.isArray(got.rows) ? got.rows : null);
    } catch (e) { rows = null; }
    if (!rows) { say('fixture-students: --runs must name a JSON array of run rows'); return 2; }
  }
  const { fixtureStudentIds } = require('../../bot/shared/services/quiz/web-quiz-fixture');
  const ids = await fixtureStudentIds({ rows });
  io.stdout.write(`${JSON.stringify({ rule: RULE, student_ids: [...ids].sort(), counts: ids.counts })}\n`);
  if (ids.unreadable.length) {
    say(`fixture-students: could not read ${ids.unreadable.join(', ')}; the rules reading it left nothing out`);
    return 3;
  }
  return 0;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }, (e) => { process.stderr.write(`fixture-students: ${e.message}\n`); process.exitCode = 1; });
}

module.exports = { main, RULE };
