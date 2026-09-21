/**
 * bd-60104 — the auto-merge tombstone has to FIT users.phone_number.
 *
 * The shell-merge path retires the destination account by parking it on a
 * sentinel phone:
 *
 *   .update({ ...retireMergedPatch(userId), phone_number: `merged:${target.id}` })
 *
 * `merged:` + a full uuid is 43 characters. `users.phone_number` is
 * VARCHAR(20), so every one of those writes died with Postgres 22001 (value
 * too long). The retire runs FIRST — the survivor cannot take the number until
 * it is free — so the handler returned `_refuse('failed')` and nothing after it
 * ran: no phone move, no audit row, no escalation.
 *
 * Measured on production 2026-09-21: 13 `teacher_edit_phone_commit` taps by 7
 * coaches, 1 success. The one that worked was CASE_FREE, which skips the retire
 * block entirely — so every `free` merge worked and no `shell` merge ever could.
 *
 * Two assertions, because either alone lets the bug back in:
 *   1. the schema column is wide enough for the value the code writes;
 *   2. the value the code writes is the full uuid — NOT a truncation. The
 *      operator's `phone-merge-apply.py` worked around the cap with an 8-hex
 *      slice, which fits but is not collision-proof and loses the pointer back
 *      to the retired row.
 */

const fs = require('fs');
const path = require('path');

const SCHEMA = path.join(__dirname, '..', '..', 'infrastructure', 'supabase', '00_complete-schema.sql');
const HANDLER = path.join(
  __dirname, '..', '..', 'bot', 'shared', 'handlers', 'observe-visit-flow.handler.js');

/** The width of users.phone_number as the schema declares it. */
function phoneNumberWidth() {
  const sql = fs.readFileSync(SCHEMA, 'utf8');
  // The FIRST `CREATE TABLE ... users (` block — other tables carry their own
  // phone_number and must not be matched instead.
  const start = sql.search(/CREATE TABLE IF NOT EXISTS users \(/);
  expect(start).toBeGreaterThan(-1);
  const body = sql.slice(start, sql.indexOf(');', start));
  const m = body.match(/phone_number\s+VARCHAR\((\d+)\)/i);
  if (!m) {
    // TEXT (no cap) is also a valid fix — report it as unbounded.
    if (/phone_number\s+TEXT/i.test(body)) return Infinity;
    throw new Error('users.phone_number not found in schema');
  }
  return Number(m[1]);
}

describe('bd-60104 — shell-merge tombstone fits users.phone_number', () => {
  const UUID_LEN = 36;                       // 8-4-4-4-12
  const TOMBSTONE_LEN = 'merged:'.length + UUID_LEN;   // 43

  it('writes the tombstone as merged: + the WHOLE uuid, never a truncation', () => {
    const src = fs.readFileSync(HANDLER, 'utf8');
    // The literal as it appears in the retire write.
    expect(src).toContain('phone_number: `merged:${target.id}`');
    // A slice() would fit the old column but reintroduces collisions.
    expect(src).not.toMatch(/merged:\$\{target\.id\.slice/);
  });

  it('declares phone_number wide enough for that 43-char tombstone', () => {
    const width = phoneNumberWidth();
    expect(width).toBeGreaterThanOrEqual(TOMBSTONE_LEN);
  });

  it('leaves headroom beyond the exact tombstone length', () => {
    // Exactly 43 would fit today and break on any prefix change. The migration
    // goes to 64 so the next sentinel does not need another DDL.
    expect(phoneNumberWidth()).toBeGreaterThanOrEqual(64);
  });
});
