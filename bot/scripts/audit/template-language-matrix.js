#!/usr/bin/env node
/**
 * Template × language audit — READ ONLY.
 *
 * Why this exists: WhatsApp templates take a language code, chosen independently
 * at each call site, and Meta does NOT fall back. Sending a template in a
 * language that has no APPROVED variant on the account is a hard failure, not a
 * degraded send. So before any language work changes which code we pass, we need
 * to know what actually exists — per account, because staging and production are
 * different WABAs.
 *
 * Reads WABA_ID + WHATSAPP_TOKEN from the environment. Performs GETs only.
 *
 *   node bot/scripts/audit/template-language-matrix.js
 *   node bot/scripts/audit/template-language-matrix.js --json
 */

require('dotenv').config();

const GRAPH = 'https://graph.facebook.com/v21.0';
const OFFER = ['ur', 'en']; // the languages this deployment serves

/**
 * Meta template language codes are NOT our internal namespace. Meta uses
 * locale-shaped codes — 'en_US', 'en_GB', 'en' are all distinct entries, and a
 * template approved as 'en_US' will NOT match a send that asks for 'en'. So
 * coverage has to be judged on the base language, and the exact code Meta holds
 * has to be carried back to the caller. Assuming 'en' would have reported this
 * account's only template as missing in English when it is in fact approved.
 */
function metaBase(code) {
  return String(code || '').toLowerCase().split(/[-_]/)[0];
}

async function fetchAllTemplates(wabaId, token) {
  const out = [];
  let url = `${GRAPH}/${wabaId}/message_templates?fields=name,language,status,category&limit=200`;
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    if (!res.ok) {
      const msg = body?.error?.message || JSON.stringify(body).slice(0, 300);
      throw new Error(`Graph API ${res.status}: ${msg}`);
    }
    out.push(...(body.data || []));
    url = body.paging?.next || null;
  }
  return out;
}

function buildMatrix(templates) {
  const byName = new Map();
  for (const t of templates) {
    if (!byName.has(t.name)) byName.set(t.name, {});
    byName.get(t.name)[t.language] = t.status;
  }
  return byName;
}

(async () => {
  const wabaId = process.env.WABA_ID;
  const token = process.env.WHATSAPP_TOKEN;
  const label = process.env.BOT_NAME || process.env.NODE_ENV || 'unknown env';

  if (!wabaId || !token) {
    console.error('WABA_ID and WHATSAPP_TOKEN must be set. Nothing was called.');
    process.exit(2);
  }

  let templates;
  try {
    templates = await fetchAllTemplates(wabaId, token);
  } catch (err) {
    console.error(`Could not read templates for WABA ${wabaId}: ${err.message}`);
    process.exit(1);
  }

  const matrix = buildMatrix(templates);
  const names = [...matrix.keys()].sort();

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ waba: wabaId, env: label, templates: Object.fromEntries(matrix) }, null, 2));
    return;
  }

  const langs = [...new Set(templates.map((t) => t.language))].sort(
    (a, b) => (OFFER.indexOf(b) - OFFER.indexOf(a)) || a.localeCompare(b)
  );

  console.log(`\nWABA ${wabaId}  (${label})`);
  console.log(`${templates.length} template entries · ${names.length} distinct names · languages present: ${langs.join(', ') || 'none'}\n`);

  const pad = Math.min(46, Math.max(18, ...names.map((n) => n.length)));
  console.log('  ' + 'template'.padEnd(pad) + langs.map((l) => l.padEnd(12)).join(''));
  console.log('  ' + '-'.repeat(pad + langs.length * 12));

  const gaps = [];
  const covered = [];
  for (const name of names) {
    const row = matrix.get(name);
    let line = '  ' + name.slice(0, pad).padEnd(pad);
    for (const l of langs) {
      const st = row[l];
      line += (st ? (st === 'APPROVED' ? 'APPROVED' : st) : '—').padEnd(12);
    }
    console.log(line);
    for (const want of OFFER) {
      // Judge on the base language, and report the exact Meta code that covers
      // it — that code is what a send must pass.
      const hit = Object.entries(row).find(
        ([code, status]) => metaBase(code) === want && status === 'APPROVED'
      );
      if (hit) {
        covered.push({ name, language: want, metaCode: hit[0] });
      } else {
        const near = Object.keys(row).find((code) => metaBase(code) === want);
        gaps.push({ name, language: want, status: near ? `${near}=${row[near]}` : 'missing' });
      }
    }
  }

  console.log('\n  Offer coverage (' + OFFER.join(' + ') + '):');
  if (covered.length) {
    console.log('    APPROVED — send using the exact Meta code shown:');
    for (const c of covered) console.log(`      ${c.name}  ${c.language}  ->  "${c.metaCode}"`);
  }
  if (!gaps.length) {
    console.log('    no gaps: every template is approved in both offered languages');
  } else {
    console.log('    GAPS:');
    for (const g of gaps) console.log(`      ${g.name}  ${g.language}  ->  ${g.status}`);
    console.log(`\n    ${gaps.length} gap(s). Each is either a submission task or a template we must never`);
    console.log('    send in that language — decide per template, do not assume fallback.');
  }
  console.log('');
})();
