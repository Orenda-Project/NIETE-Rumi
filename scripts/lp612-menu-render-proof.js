#!/usr/bin/env node
/**
 * bd-3uiev proof: run the REAL lp612 chapter/segment builders over the REAL
 * staging corpus and report what every row would render as.
 *
 * Not a reimplementation — it stubs only the Supabase client, feeding the actual
 * service the rows the live table holds, so what it prints is what the endpoint
 * would put on the wire.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/lp612-menu-render-proof.js [--json out.json]
 */
'use strict';

const path = require('path');
const Module = require('module');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const TABLE = 'niete_lp612_segments';

async function fetchAll() {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const qs = new URLSearchParams({ select: '*', is_current: 'eq.true', limit: '1000', offset: String(offset) });
    const res = await fetch(`${URL}/rest/v1/${TABLE}?${qs}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const batch = await res.json();
    out.push(...batch);
    if (batch.length < 1000) return out;
  }
}

// ── stub the service's two side-effecting deps, load the real builder ────────
let ROWS = [];
const SERVICE = path.resolve(__dirname, '..', 'bot', 'shared', 'services', 'lp612-catalog.service.js');
const SUPA = path.resolve(__dirname, '..', 'bot', 'shared', 'config', 'supabase.js');
const LOGGER = path.resolve(__dirname, '..', 'bot', 'shared', 'utils', 'logger.js');

function builder() {
  const st = { filters: [], or: null };
  const b = {
    select: () => b, eq: (c, v) => { st.filters.push([c, v]); return b; },
    in: () => b, or: (e) => { st.or = e; return b; }, order: () => b, limit: () => b,
    then: (res, rej) => {
      let rows = ROWS.filter((r) => st.filters.every(([c, v]) => r[c] === v));
      if (st.or) {
        const m = /grade\.eq\.(\d+)/.exec(st.or);
        if (m) {
          const g = Number(m[1]);
          rows = rows.filter((r) => r.grade === g || (r.also_grades || []).includes(g));
        }
      }
      return Promise.resolve({ data: rows, error: null }).then(res, rej);
    },
  };
  return b;
}

const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  const resolved = (() => { try { return Module._resolveFilename(req, parent, isMain); } catch { return null; } })();
  if (resolved === SUPA) return { from: () => builder() };
  if (resolved === LOGGER) return { logToFile: () => {} };
  return origLoad.apply(this, arguments);
};

const Catalog = require(SERVICE);
const cps = (s) => [...String(s == null ? '' : s)].length;

(async () => {
  ROWS = await fetchAll();
  console.log(`servable rows: ${ROWS.length}\n`);

  const books = new Map();
  for (const r of ROWS) {
    for (const g of [r.grade, ...(r.also_grades || [])]) {
      if (g == null || !r.subject) continue;
      books.set(`${g}|${r.subject}`, [g, r.subject]);
    }
  }

  const report = [];
  let chapters = 0; let ellipsis = 0; let lost = 0; let dupTitles = 0;
  for (const [g, subject] of [...books.values()].sort()) {
    const items = await Catalog.buildChapterItems(g, subject);
    const seen = new Map();
    for (const it of items) {
      const mc = it['main-content'];
      chapters += 1;
      const row = { grade: g, subject, id: it.id, ...mc };
      if ((mc.title || '').includes('…')) ellipsis += 1;
      if ((mc.metadata || '').includes('…')) lost += 1;
      seen.set(mc.title, (seen.get(mc.title) || 0) + 1);
      report.push(row);
      if (cps(mc.title) > 30 || cps(mc.description || '') > 20 || cps(mc.metadata || '') > 80) {
        console.log('CAP VIOLATION', JSON.stringify(row));
      }
    }
    for (const [t, n] of seen) if (n > 1) { dupTitles += 1; console.log(`DUPLICATE TITLE  g${g} ${subject}  ${JSON.stringify(t)} x${n}`); }
  }

  console.log(`chapters rendered            : ${chapters}`);
  console.log(`title lines ending in '…'    : ${ellipsis}`);
  console.log(`metadata lines still clipped : ${lost}`);
  console.log(`duplicate titles within a book: ${dupTitles}`);

  // segments
  let segs = 0; let segEcho = 0; let segKindLost = 0;
  for (const [g, subject] of [...books.values()].sort()) {
    const chs = await Catalog.buildChapterItems(g, subject);
    for (const ch of chs) {
      let page = 1;
      for (;;) {
        const { items, hasMore } = await Catalog.buildSegmentItems(g, subject, ch.id, page);
        for (const it of items) {
          if (it.id === '__more__') continue;
          const mc = it['main-content'];
          segs += 1;
          if (mc.metadata && mc.title && mc.metadata.replace(/^‏/, '') === mc.title.replace(/^‏/, '')) segEcho += 1;
          const src = ROWS.find((r) => r.segment_id === it.id);
          if (src && src.lp_type && src.lp_type !== 'content'
              && !(mc.metadata || '').includes(src.lp_type.replace(/_/g, ' '))) segKindLost += 1;
          if (cps(mc.title) > 30 || cps(mc.description || '') > 20 || cps(mc.metadata || '') > 80) {
            console.log('SEG CAP VIOLATION', JSON.stringify({ ...mc, id: it.id }));
          }
        }
        if (!hasMore) break;
        page += 1;
      }
    }
  }
  console.log(`\nsegments rendered            : ${segs}`);
  console.log(`metadata echoing the title   : ${segEcho}`);
  console.log(`lp_type marker lost to clip  : ${segKindLost}`);

  const i = process.argv.indexOf('--json');
  if (i > -1 && process.argv[i + 1]) {
    require('fs').writeFileSync(process.argv[i + 1], JSON.stringify(report, null, 1));
    console.log(`\nwrote ${report.length} chapter rows -> ${process.argv[i + 1]}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
