// Focused count survey — uses Supabase count queries instead of paged selects,
// so we get accurate totals across the whole table (avoids the 1000-row default cap).

const path = require('path');
const fs = require('fs');
function loadEnv(p) {
  const txt = fs.readFileSync(p, 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadEnv(process.env.NIETE_ENV_PATH || path.resolve(__dirname, '..', '..', '..', '.env'));

const supabase = require('../../shared/config/supabase');

(async () => {
  // Total rows
  const { count: total } = await supabase.from('curriculum_lp_ast').select('*', { count: 'exact', head: true });
  console.log(`curriculum_lp_ast total rows: ${total}`);

  // Total enabled
  const { count: enabled } = await supabase.from('curriculum_lp_ast').select('*', { count: 'exact', head: true }).eq('is_enabled', true);
  console.log(`  enabled: ${enabled}`);

  // Iterate unique publishers via a paged query using RPC-free technique
  const pubs = new Set();
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase.from('curriculum_lp_ast').select('publisher, curriculum_key, grade, subject, is_enabled, pdf_r2_key_en').range(from, from + pageSize - 1);
    if (error) { console.error(error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    for (const r of data) pubs.add(`${r.publisher}|${r.curriculum_key}`);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  console.log(`\nDistinct publisher|curriculum pairs seen: ${pubs.size}`);
  for (const p of [...pubs].sort()) console.log(`  ${p.replace('|', ' · ')}`);

  // Per-publisher counts via count queries (accurate)
  console.log(`\nPer-publisher counts:`);
  for (const p of [...pubs].sort()) {
    const [pub, cur] = p.split('|');
    const { count: c } = await supabase.from('curriculum_lp_ast').select('*', { count: 'exact', head: true })
      .eq('publisher', pub).eq('curriculum_key', cur);
    const { count: enC } = await supabase.from('curriculum_lp_ast').select('*', { count: 'exact', head: true })
      .eq('publisher', pub).eq('curriculum_key', cur).eq('is_enabled', true);
    const { count: cachedC } = await supabase.from('curriculum_lp_ast').select('*', { count: 'exact', head: true })
      .eq('publisher', pub).eq('curriculum_key', cur).not('pdf_r2_key_en', 'is', null);
    console.log(`  ${pub.padEnd(20)} ${cur.padEnd(15)}  ${c} total, ${enC} enabled, ${cachedC} cached`);
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(2); });
