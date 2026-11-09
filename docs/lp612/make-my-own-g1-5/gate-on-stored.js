// bd-snkn32.4 — does the grades 1–5 gate (checkK5Rewrite) pass each stored day plan against itself? A refusal here
// would be a false refusal in production. Read-only on the sandbox DB. Usage: node gate-on-stored.js (env: SUPABASE_*)
const path = require('path');
const root = path.join(__dirname, '../../..');
const { checkK5Rewrite } = require(path.join(root, 'bot/shared/services/lp-k5-own'));
const cat = require(path.join(root, 'bot/data/lp_catalog.json'));
const lang = {}; for (const b of cat.books) for (const c of b.chapters) for (const l of c.lessons) lang[l.lesson_id] = b.language;
(async () => {
  const H = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` };
  const out = { checked: 0, refused: {}, byLang: { en: 0, ur: 0 } };
  for (let off = 0; off < 6000; off += 500) {
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/niete_lp_asset_sources?select=lesson_id,slide_script&offset=${off}&limit=500`, { headers: H });
    const rows = await r.json(); if (!rows.length) break;
    for (const row of rows) {
      const L = lang[row.lesson_id]; if (!L || !row.slide_script || !row.slide_script.iDo) continue;
      out.checked++; out.byLang[L === 'ur' ? 'ur' : 'en']++;
      const reasons = checkK5Rewrite(row.slide_script, row.slide_script, { lang: L === 'ur' ? 'ur' : 'en' });
      for (const x of reasons) (out.refused[x] = out.refused[x] || []).push(row.lesson_id);
    }
  }
  for (const k of Object.keys(out.refused)) out.refused[k] = { n: out.refused[k].length, e: out.refused[k].slice(0, 4) };
  console.log(JSON.stringify(out, null, 1));
})();
