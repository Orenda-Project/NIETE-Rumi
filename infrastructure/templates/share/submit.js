#!/usr/bin/env node
'use strict';
/**
 * Submit the "Send on WhatsApp" share templates (this folder's *.json) to ONE WABA, or list their status.
 *
 *   WHATSAPP_TOKEN=… WABA_ID=… node infrastructure/templates/share/submit.js            submit every file here
 *   WHATSAPP_TOKEN=… WABA_ID=… node infrastructure/templates/share/submit.js --only share_paper_v1      (or share_paper_v1_en: one language)
 *   WHATSAPP_TOKEN=… WABA_ID=… node infrastructure/templates/share/submit.js --status   name, language, status, reason
 *   DRY_RUN=1 …                                                                          print, submit nothing
 *
 * A DOCUMENT or IMAGE header needs a sample file at submission. This uploads a generated one (a one-page PDF saying
 * "Sample", a plain PNG: no teacher data) through Meta's resumable upload, under the app that owns the token, and puts
 * the handle in the header's example. The real file is supplied at send time. The token is never printed.
 * Templates are per WABA: run this once per environment (sandbox, staging, production).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const GRAPH = 'https://graph.facebook.com/v21.0';
const DIR = __dirname;
const TOKEN = process.env.WHATSAPP_TOKEN || '';
const WABA = process.env.WABA_ID || '';
const DRY = process.env.DRY_RUN === '1';
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

async function graph(method, url, { body, headers = {}, raw } = {}) {
  const res = await fetch(url.startsWith('http') ? url : `${GRAPH}${url}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw || (body ? JSON.stringify(body) : undefined),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

/** A one-page PDF that says "Sample". */
function samplePdf() {
  const text = 'BT /F1 28 Tf 72 720 Td (Sample) Tj ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** A plain 400×300 PNG in the NIETE green. */
function samplePng() {
  const w = 400; const h = 300;
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [0x47, 0xba, 0x7d]).flat())]);
  const idat = zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

async function upload(appId, name, type, bytes) {
  const q = new URLSearchParams({ file_name: name, file_length: String(bytes.length), file_type: type });
  const s = await graph('POST', `/${appId}/uploads?${q}`);
  if (!s.data.id) throw new Error(`upload session refused: ${JSON.stringify(s.data.error || s.data)}`);
  const u = await graph('POST', `/${s.data.id}`, { raw: bytes, headers: { Authorization: `OAuth ${TOKEN}`, file_offset: '0' } });
  if (!u.data.h) throw new Error(`upload refused: ${JSON.stringify(u.data.error || u.data)}`);
  return u.data.h;
}

async function status() {
  const r = await graph('GET', `/${WABA}/message_templates?fields=name,language,status,category,rejected_reason&limit=250`);
  const rows = (r.data.data || []).filter((t) => t.name.startsWith('share_')).sort((a, b) => `${a.name}${a.language}`.localeCompare(`${b.name}${b.language}`));
  for (const t of rows) console.log(`${t.name.padEnd(32)} ${t.language.padEnd(3)} ${t.status.padEnd(9)} ${t.category}${t.rejected_reason && t.rejected_reason !== 'NONE' ? ` ${t.rejected_reason}` : ''}`);
  if (!rows.length) console.log('(no share_* templates on this WABA)', r.status !== 200 ? JSON.stringify(r.data.error) : '');
}

async function submit() {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).filter((f) => !only || f.startsWith(only)).sort();
  if (!files.length) throw new Error('no template files matched');
  const app = await graph('GET', '/app?fields=id,name');
  if (!app.data.id) throw new Error(`cannot read the token's app: ${JSON.stringify(app.data.error || app.data)}`);
  const docs = files.map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));
  const formats = new Set(docs.map((d) => (d.components.find((c) => c.type === 'HEADER') || {}).format));
  const handles = {};
  if (!DRY) {
    if (formats.has('DOCUMENT')) handles.DOCUMENT = await upload(app.data.id, 'sample.pdf', 'application/pdf', samplePdf());
    if (formats.has('IMAGE')) handles.IMAGE = await upload(app.data.id, 'sample.png', 'image/png', samplePng());
  }
  for (const d of docs) {
    const header = d.components.find((c) => c.type === 'HEADER');
    if (header && handles[header.format]) header.example = { header_handle: [handles[header.format]] };
    if (DRY) { console.log(`[dry] ${d.name} ${d.language} ${d.category} header=${header && header.format}`); continue; }
    const r = await graph('POST', `/${WABA}/message_templates`, { body: d });
    console.log(r.data.id ? `ok   ${d.name} ${d.language} → ${r.data.status} (${r.data.category})` : `FAIL ${d.name} ${d.language} → ${JSON.stringify(r.data.error || r.data)}`);
    await new Promise((res) => setTimeout(res, 1000));
  }
}

(async () => {
  if (!TOKEN || !WABA) { console.error('Set WHATSAPP_TOKEN and WABA_ID (the token of THAT WABA).'); process.exit(1); }
  await (args.includes('--status') ? status() : submit());
})().catch((err) => { console.error(err.message); process.exit(1); });
