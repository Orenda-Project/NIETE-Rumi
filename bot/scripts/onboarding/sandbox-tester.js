#!/usr/bin/env node
'use strict';
/**
 * bd-8kxvg5 — add a tester to NIETE SANDBOX in one command (Make my own: portal G1-5 + 6-12, and the WhatsApp door).
 *
 *   railway run -p 0aef0655-1f90-4aab-9cca-e4daec46f2b4 -e sandbox -s bot \
 *     node bot/scripts/onboarding/sandbox-tester.js --phone 03XXXXXXXXX [--name "Their name"] [--password Xxxxxxx1]
 *
 * Makes (or updates) that number as an ICT teacher, grades 3 and 6-8, in the sandbox test school with a Grade 3 and
 * a Grade 6 class, a test user, with Make my own on. --password also sets a portal password (8+ chars, one number).
 * Refuses to run anywhere but sandbox (shared/services/sandbox-tester.js assertSandbox). Idempotent: run it again
 * for the same number and nothing is duplicated.
 */
const { assertSandbox, parseArgs, addTester } = require('../../shared/services/sandbox-tester');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertSandbox(process.env); // before the supabase client (and its boot gate) is even loaded
  const bcrypt = require('bcryptjs');
  const db = require('../../shared/config/supabase');
  const classes = require('../../shared/services/classes/class.service');
  const out = await addTester(args, { db, classes, hash: (pw) => bcrypt.hash(pw, 10), env: process.env });
  console.log(JSON.stringify({ ok: true, ...out, userId: `${out.userId.slice(0, 8)}…` }));
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(`sandbox-tester: ${err.message}`);
  process.exit(1);
});
