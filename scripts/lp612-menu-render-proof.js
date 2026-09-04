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

// Offline mode: rebuild the corpus from a previous run's --json snapshot, which
// carries each row's SOURCE fields. Chapter-step only (a snapshot records
// chapters, not subtopics), and it is a snapshot rather than the live table —
// state which you used when you quote the numbers.
const fromIdx = process.argv.indexOf('--from-json');
const FROM_JSON = fromIdx > -1 ? process.argv[fromIdx + 1] : null;

if (!FROM_JSON && (!URL || !KEY)) {
  console.error('need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, or --from-json <snapshot>');
  process.exit(1);
}

const TABLE = 'niete_lp612_segments';

/** Turn a snapshot's chapter rows back into the segment rows the builder reads. */
function rowsFromSnapshot(file) {
  const snap = JSON.parse(require('fs').readFileSync(file, 'utf8'));
  const out = [];
  for (const r of snap) {
    const s = r.source || {};
    // The snapshot stores a lesson COUNT per chapter; the builder counts rows,
    // so emit that many.
    const digits = String(r.description || '').replace(/[^0-9۰-۹]/g, '');
    const n = Math.max(1, Number([...digits].map((c) => (/[۰-۹]/.test(c) ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(c) : c)).join('')) || 1);
    for (let i = 0; i < n; i += 1) {
      out.push({
        segment_id: `${r.grade}_${r.subject}_${r.id}_${i}`,
        grade: r.grade,
        also_grades: [],
        subject: r.subject,
        language: s.rtl ? 'ur' : 'en',
        chapter_number: s.number,
        chapter_title: s.name,
        chapter_key: r.id,
        part: s.part,
        subtopic_title: s.name,
        menu_title: s.name,
        printed_page_start: 1,
        printed_page_end: 2,
        order_index: i + 1,
        lp_type: 'content',
        is_current: true,
        is_religious: false,
      });
    }
  }
  return out;
}

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
const { MORE_ROW_ID } = require(path.resolve(__dirname, '..', 'bot', 'shared', 'services', 'lp-v8-catalog.service.js'));
const cps = (s) => [...String(s == null ? '' : s)].length;

(async () => {
  ROWS = FROM_JSON ? rowsFromSnapshot(FROM_JSON) : await fetchAll();
  console.log(FROM_JSON
    ? `servable rows: ${ROWS.length}  (rebuilt from snapshot ${FROM_JSON} — chapter step only)\n`
    : `servable rows: ${ROWS.length}\n`);

  const books = new Map();
  for (const r of ROWS) {
    for (const g of [r.grade, ...(r.also_grades || [])]) {
      if (g == null || !r.subject) continue;
      books.set(`${g}|${r.subject}`, [g, r.subject]);
    }
  }

  /** Every chapter row of a book, across its pages. */
  async function allChapters(g, subject) {
    const out = [];
    for (let page = 1; ; page += 1) {
      const { items, hasMore } = await Catalog.buildChapterItems(g, subject, page);
      out.push(...items.filter((i) => i.id !== MORE_ROW_ID));
      if (!hasMore) return out;
    }
  }

  const report = [];
  let chapters = 0; let ellipsis = 0; let lost = 0; let dupTitles = 0;
  // bd-tnvpg: the row SHAPE must not vary with the data. A book whose rows do
  // not all use the same set of fields is the "some in the upper field, some in
  // the smaller subtitle field" the operator reported.
  let shapeSplits = 0; let nameFieldSplits = 0;
  for (const [g, subject] of [...books.values()].sort()) {
    const items = await allChapters(g, subject);
    const seen = new Map();
    const shapes = new Set();
    const nameFields = new Set();
    for (const it of items) {
      const mc0 = it['main-content'];
      shapes.add(Object.keys(mc0).sort().join(','));
      const src0 = ROWS.find((r) => r.chapter_key === it.id && r.subject === subject
        && (r.grade === g || (r.also_grades || []).includes(g))) || {};
      const nm = src0.chapter_title || '';
      // Which field is this row's NAME actually rendered in?
      for (const f of ['title', 'description', 'metadata']) {
        if (nm && String(mc0[f] || '').replace(/^‏/, '').startsWith(nm.slice(0, 12))) nameFields.add(f);
      }
    }
    if (shapes.size > 1) {
      shapeSplits += 1;
      console.log(`SHAPE SPLIT      g${g} ${subject}  ${[...shapes].map((s) => `{${s}}`).join(' vs ')}`);
    }
    if (nameFields.size > 1) {
      nameFieldSplits += 1;
      console.log(`NAME FIELD SPLIT g${g} ${subject}  name appears in ${[...nameFields].join(' and ')}`);
    }
    for (const it of items) {
      const mc = it['main-content'];
      chapters += 1;
      // The SOURCE fields ride along so a comparison render can rebuild the
      // pre-fix row from the same data instead of hand-transcribing it — the
      // two panels then cannot drift apart or show different chapters.
      const src = ROWS.find((r) => r.chapter_key === it.id
        && r.subject === subject
        && (r.grade === g || (r.also_grades || []).includes(g))) || {};
      const row = {
        grade: g,
        subject,
        id: it.id,
        ...mc,
        source: {
          number: src.chapter_number ?? null,
          name: src.chapter_title || '',
          part: src.part || null,
          rtl: src.language === 'ur',
        },
      };
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
  console.log(`books whose rows differ in SHAPE: ${shapeSplits}`);
  console.log(`books where the NAME changes field: ${nameFieldSplits}`);

  // segments
  let segs = 0; let segEcho = 0; let segKindLost = 0;
  for (const [g, subject] of [...books.values()].sort()) {
    const chs = await allChapters(g, subject);
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
