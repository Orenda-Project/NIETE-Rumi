#!/usr/bin/env node
/**
 * READ ONLY. How often does a coach actually type a removal reason?
 *
 * The removal screen has always offered an optional "Why?" box whose value is
 * stored at `leader_roster_audit.detail->>'reason'`. Nothing in this repo ever
 * SELECTs that table, so "is the reason used" cannot be answered from the code
 * — only from the rows. Run before deciding whether one reason per batch is a
 * loss or a non-event.
 *
 *   node scripts/audit-reason-usage.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}
console.log('project ref:', new URL_(URL).ref);

function URL_(u) {
  const m = String(u).match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  return { ref: m ? m[1] : '(unrecognised)' };
}

async function page(offset, limit) {
  const res = await fetch(
    `${URL}/rest/v1/leader_roster_audit?select=action,detail,created_at&order=created_at.asc`
    + `&offset=${offset}&limit=${limit}`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
  );
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

(async () => {
  // Paginated on purpose: PostgREST caps a default page at 1,000 and says nothing.
  const rows = [];
  for (let off = 0; ; off += 1000) {
    const batch = await page(off, 1000);
    rows.push(...batch);
    if (batch.length < 1000) break;
  }

  const removals = rows.filter((r) => r.action === 'remove');
  const withReason = removals.filter((r) => {
    const v = r.detail && r.detail.reason;
    return v != null && String(v).trim() !== '';
  });

  console.log(`rows total:            ${rows.length}`);
  console.log(`  removals:            ${removals.length}`);
  console.log(`  removals w/ reason:  ${withReason.length}`);
  if (removals.length) {
    console.log(`  fill rate:           ${((withReason.length / removals.length) * 100).toFixed(1)}%`);
  }
  console.log('\nreasons actually typed (verbatim, deduped):');
  const seen = new Map();
  for (const r of withReason) {
    const v = String(r.detail.reason).trim();
    seen.set(v, (seen.get(v) || 0) + 1);
  }
  if (!seen.size) console.log('  (none)');
  for (const [v, n] of [...seen.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)} × ${JSON.stringify(v)}`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
