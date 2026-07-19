#!/usr/bin/env node
/**
 * FEAT-102 — NIETE leader-role seed / migration.
 *
 * The ICT leader family for /observe is Coach / Principal / AEO (operator
 * decision 2026-07-19) — the same LEADER_ROLES the observe gate already
 * accepts (school_leader | supervisor | coach | principal | aeo). NO bespoke
 * `human_coach` role: the 62 ICT coaches were bulk-enrolled with
 * role='human_coach', which is NOT in LEADER_ROLES, so they would be denied
 * /observe. This re-maps them to 'coach'.
 *
 * `users.role` is a free-text column — no DDL, no enum. Idempotent: once the
 * re-map is done there are 0 human_coach rows, so a re-run is a no-op.
 * Reversible: `coach` → `human_coach` maps exactly these 62 back (there were
 * 0 pre-existing `coach` rows at migration time — verified 2026-07-19).
 *
 * SAFETY: dry-run by default. Pass --apply to write.
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-niete-leader-roles.js [--apply]
 */

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APPLY = process.argv.includes('--apply');

if (!URL || !KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function roleCounts() {
  const r = await fetch(`${URL}/rest/v1/users?select=role&role=not.is.null`, { headers: H });
  const rows = await r.json();
  return rows.reduce((m, x) => ((m[x.role] = (m[x.role] || 0) + 1), m), {});
}

(async () => {
  console.log('Before:', await roleCounts());
  if (!APPLY) {
    console.log('DRY RUN — pass --apply to re-map role=human_coach → coach. No changes made.');
    return;
  }
  // Re-map. Prefer=return=representation so PostgREST returns the updated rows (count).
  const res = await fetch(`${URL}/rest/v1/users?role=eq.human_coach`, {
    method: 'PATCH',
    headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ role: 'coach' }),
  });
  if (!res.ok) {
    console.error('PATCH failed:', res.status, await res.text());
    process.exit(1);
  }
  const updated = await res.json();
  console.log(`Re-mapped ${Array.isArray(updated) ? updated.length : '?'} rows human_coach → coach.`);
  console.log('After:', await roleCounts());
})();
