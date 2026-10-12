#!/usr/bin/env node
/* local-r2.js — the mock lane's per-run file store, standing in for Cloudflare R2 (bd-z3ze4.1).
 *
 *   node bot/scripts/e2e/local-r2.js <port> <dir>
 *
 * The bot reaches R2 through @aws-sdk/client-s3 (Put/Get/Head/Delete/ListObjectsV2 + presigned GETs) and builds
 * path-style links `${R2_ENDPOINT}/${bucket}/${key}`. On a local run R2_ENDPOINT points here instead:
 *
 *   WRITE (PUT, DELETE)  → <dir> only. Nothing a run writes ever reaches the real bucket.
 *   READ  (GET, HEAD)    → <dir> if the run wrote the key; else the BASE snapshot (LOCAL_R2_BASE_DIR: files pulled
 *                          once per machine with the seed — read-only, never written); else READ-THROUGH to the
 *                          upstream bucket (staging),
 *                          read-only — the pre-rendered lesson-plan PDFs, training media and cassette mirror the
 *                          seeded rows point at. A key the run deleted stays deleted (no fall-through).
 *   LIST                 → the run's keys merged with upstream's, minus the run's deletes.
 *
 * Upstream is optional: LOCAL_R2_UPSTREAM_ENDPOINT / _BUCKET / _KEY_ID / _SECRET. Those credentials live in this
 * process only — the bot is given dummy local ones. Without them every miss is a plain 404.
 * Signatures are not checked: it binds 127.0.0.1 and serves one test run.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const [port, root] = [Number(process.argv[2]), process.argv[3]];
// One line per READ-THROUGH (`GET|HEAD\t<key>\t<bytes>`): the staging files a run actually needed — what an
// offline file snapshot would have to carry (bd-z3ze4.4). A file the run wrote itself is never listed.
const READ_LOG = process.env.LOCAL_R2_READ_LOG;
const logRead = (method, key, bytes) => { if (READ_LOG) try { fs.appendFileSync(READ_LOG, `${method}\t${key}\t${bytes == null ? '' : bytes}\n`); } catch (_) { /* never fail a read over the log */ } };
if (!port || !root) { console.error('usage: local-r2.js <port> <dir>'); process.exit(2); }
const OBJ = path.join(root, 'objects'), META = path.join(root, 'meta'), GONE = path.join(root, 'deleted');
for (const d of [OBJ, META, GONE]) fs.mkdirSync(d, { recursive: true });

// The per-machine file snapshot (<base>/<bucket>/<key>), pulled with the seed (bd-z3ze4.5): what lets a run
// serve the staging files it needs with no upstream — offline, no staging credential.
const BASE = process.env.LOCAL_R2_BASE_DIR || '';
const basePath = (b, k) => (BASE ? path.join(BASE, safe(b, k)) : '');
const UP = process.env.LOCAL_R2_UPSTREAM_ENDPOINT ? {
  endpoint: process.env.LOCAL_R2_UPSTREAM_ENDPOINT, bucket: process.env.LOCAL_R2_UPSTREAM_BUCKET,
  id: process.env.LOCAL_R2_UPSTREAM_KEY_ID, secret: process.env.LOCAL_R2_UPSTREAM_SECRET } : null;
let _up = null;
const upstream = () => {
  if (!UP) return null;
  if (!_up) {
    const { S3Client } = require('@aws-sdk/client-s3');
    _up = new S3Client({ region: 'auto', endpoint: UP.endpoint, credentials: { accessKeyId: UP.id, secretAccessKey: UP.secret } });
  }
  return _up;
};

// A key may hold any characters; it is stored under a path that cannot escape <dir>.
const safe = (bucket, key) => {
  const rel = path.posix.normalize(`${bucket}/${key}`).replace(/^(\.\.(\/|$))+/, '');
  return rel;
};
const objPath = (b, k) => path.join(OBJ, safe(b, k));
const metaPath = (b, k) => path.join(META, safe(b, k) + '.json');
const gonePath = (b, k) => path.join(GONE, safe(b, k));
const ensureDir = (f) => fs.mkdirSync(path.dirname(f), { recursive: true });

const TYPES = { pdf: 'application/pdf', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4', html: 'text/html', txt: 'text/plain' };
const guessType = (key) => TYPES[String(key).split('.').pop().toLowerCase()] || 'application/octet-stream';
const xml = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/xml' }); res.end('<?xml version="1.0" encoding="UTF-8"?>\n' + body); };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const noSuchKey = (res, key, head) => {
  if (head) { res.writeHead(404); return res.end(); }
  xml(res, 404, `<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message><Key>${esc(key)}</Key></Error>`);
};

// The SDK uploads with `content-encoding: aws-chunked` (flexible checksums): `<hex size>[;ext]\r\n<data>\r\n`
// repeated, then `0\r\n` and trailer headers. Unwrap it, or every stored object is corrupted.
function decodeAwsChunked(buf) {
  const out = []; let i = 0;
  while (i < buf.length) {
    const eol = buf.indexOf('\r\n', i);
    if (eol < 0) break;
    const size = parseInt(buf.slice(i, eol).toString().split(';')[0], 16);
    if (!size) break;
    out.push(buf.slice(eol + 2, eol + 2 + size));
    i = eol + 2 + size + 2;
  }
  return Buffer.concat(out);
}
const readBody = (req) => new Promise((resolve, reject) => {
  const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => resolve(Buffer.concat(parts))); req.on('error', reject);
});

function parse(req) {
  const u = new URL(req.url, 'http://local');
  // path-style /<bucket>/<key>; a virtual-host request (bucket.<host>) is accepted too
  const host = String(req.headers.host || '').split(':')[0];
  let bucket, key;
  if (host && !/^(\d+\.){3}\d+$/.test(host) && host !== 'localhost' && host.includes('.')) {
    bucket = host.split('.')[0]; key = decodeURIComponent(u.pathname.slice(1));
  } else {
    const p = u.pathname.slice(1); const slash = p.indexOf('/');
    bucket = decodeURIComponent(slash < 0 ? p : p.slice(0, slash)); key = slash < 0 ? '' : decodeURIComponent(p.slice(slash + 1));
  }
  return { u, bucket, key };
}

async function serveObject(res, bucket, key, head) {
  const f = objPath(bucket, key);
  if (fs.existsSync(f)) {
    const m = JSON.parse(fs.readFileSync(metaPath(bucket, key), 'utf8'));
    res.writeHead(200, { 'content-type': m.contentType, 'content-length': m.size, etag: m.etag, 'last-modified': new Date(m.lastModified).toUTCString() });
    return head ? res.end() : fs.createReadStream(f).pipe(res);
  }
  if (fs.existsSync(gonePath(bucket, key))) return noSuchKey(res, key, head);
  const bf = basePath(bucket, key);
  if (bf && fs.existsSync(bf) && fs.statSync(bf).isFile()) {
    const st = fs.statSync(bf);
    res.writeHead(200, { 'content-type': guessType(key), 'content-length': st.size, 'last-modified': st.mtime.toUTCString() });
    return head ? res.end() : fs.createReadStream(bf).pipe(res);
  }
  if (!upstream()) return noSuchKey(res, key, head);
  try {
    const { GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
    const r = await upstream().send(new (head ? HeadObjectCommand : GetObjectCommand)({ Bucket: UP.bucket || bucket, Key: key }));
    const h = { 'content-type': r.ContentType || 'application/octet-stream' };
    if (r.ContentLength != null) h['content-length'] = r.ContentLength;
    if (r.ETag) h.etag = r.ETag;
    if (r.LastModified) h['last-modified'] = new Date(r.LastModified).toUTCString();
    res.writeHead(200, h);
    logRead(head ? 'HEAD' : 'GET', key, r.ContentLength);
    if (head) return res.end();
    r.Body.pipe(res);
  } catch (e) {
    const status = e.$metadata && e.$metadata.httpStatusCode;
    if (e.name === 'NoSuchKey' || e.name === 'NotFound' || status === 404) return noSuchKey(res, key, head);
    console.error(`[local-r2] upstream ${head ? 'HEAD' : 'GET'} ${key} failed: ${e.name} ${e.message}`);
    if (head) { res.writeHead(502); return res.end(); }
    xml(res, 502, `<Error><Code>UpstreamError</Code><Message>${esc(e.message)}</Message></Error>`);
  }
}

function walk(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const f = path.join(dir, d.name);
    return d.isDirectory() ? walk(f, base) : [path.relative(base, f).split(path.sep).join('/')];
  });
}

async function list(res, bucket, u) {
  const prefix = u.searchParams.get('prefix') || '';
  const items = new Map();
  for (const rel of walk(path.join(OBJ, bucket))) {
    if (!rel.startsWith(prefix)) continue;
    const m = JSON.parse(fs.readFileSync(metaPath(bucket, rel), 'utf8'));
    items.set(rel, { size: m.size, etag: m.etag, lastModified: m.lastModified });
  }
  const gone = new Set(walk(path.join(GONE, bucket)));
  if (upstream()) {
    try {
      const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
      let token, pages = 0;
      do {   // bounded: a lane run lists one feature's prefix, never the whole bucket
        const r = await upstream().send(new ListObjectsV2Command({ Bucket: UP.bucket || bucket, Prefix: prefix, ContinuationToken: token }));
        for (const o of r.Contents || []) {
          if (!items.has(o.Key) && !gone.has(o.Key)) items.set(o.Key, { size: o.Size, etag: o.ETag, lastModified: o.LastModified });
        }
        token = r.IsTruncated ? r.NextContinuationToken : undefined;
      } while (token && ++pages < 10);
    } catch (e) { console.error(`[local-r2] upstream LIST ${prefix} failed: ${e.message}`); }
  }
  const keys = [...items.keys()].sort();
  xml(res, 200, `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${esc(bucket)}</Name><Prefix>${esc(prefix)}</Prefix>`
    + `<KeyCount>${keys.length}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>`
    + keys.map((k) => { const o = items.get(k); return `<Contents><Key>${esc(k)}</Key><LastModified>${new Date(o.lastModified).toISOString()}</LastModified>`
      + `<ETag>${esc(o.etag || '')}</ETag><Size>${o.size || 0}</Size><StorageClass>STANDARD</StorageClass></Contents>`; }).join('')
    + '</ListBucketResult>');
}

http.createServer(async (req, res) => {
  try {
    if (req.url === '/__health') { res.writeHead(200); return res.end('ok'); }
    const { u, bucket, key } = parse(req);
    if (req.method === 'GET' && !key && u.searchParams.has('list-type')) return list(res, bucket, u);
    if (!bucket || !key) { res.writeHead(400); return res.end(); }
    if (req.method === 'PUT') {
      let buf = await readBody(req);
      if (/aws-chunked/i.test(req.headers['content-encoding'] || '') || req.headers['x-amz-decoded-content-length']) buf = decodeAwsChunked(buf);
      const f = objPath(bucket, key); ensureDir(f); fs.writeFileSync(f, buf);
      const etag = '"' + crypto.createHash('md5').update(buf).digest('hex') + '"';
      const m = metaPath(bucket, key); ensureDir(m);
      fs.writeFileSync(m, JSON.stringify({ contentType: req.headers['content-type'] || 'application/octet-stream', size: buf.length, etag, lastModified: Date.now() }));
      fs.rmSync(gonePath(bucket, key), { force: true });
      res.writeHead(200, { etag }); return res.end();
    }
    if (req.method === 'DELETE') {
      fs.rmSync(objPath(bucket, key), { force: true }); fs.rmSync(metaPath(bucket, key), { force: true });
      const g = gonePath(bucket, key); ensureDir(g); fs.writeFileSync(g, '');
      res.writeHead(204); return res.end();
    }
    if (req.method === 'GET' || req.method === 'HEAD') return serveObject(res, bucket, key, req.method === 'HEAD');
    res.writeHead(405); res.end();
  } catch (e) {
    console.error('[local-r2] ' + (e.stack || e.message));
    if (!res.headersSent) { res.writeHead(500); } res.end();
  }
}).listen(port, '127.0.0.1', () => console.log(`[local-r2] listening on 127.0.0.1:${port} → ${root}${UP ? ' (read-through: ' + UP.endpoint + ')' : ''}`));
