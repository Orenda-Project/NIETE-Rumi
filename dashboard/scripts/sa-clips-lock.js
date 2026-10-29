#!/usr/bin/env node
'use strict';
/**
 * The bytes the battery's service worker answers cache-first (dashboard/sa/sw.js strategyFor 'static'), fingerprinted
 * under the SESSION cache name they were taken with: dashboard/sa/clips.lock.json.
 *
 * A phone keeps those files in caches.open(SESSION) and never asks again for a URL it holds, so a file re-made under the
 * same name (a clip re-voiced under its key, a battery file edited) reaches a phone that already took it only when
 * SESSION changes. tests/sa-clips-lock.service.test.js fails when a locked file's bytes changed while sw.js still names
 * the locked SESSION. A new file is a new URL and needs no bump; a switch flip changes a served battery without changing
 * these bytes and is not caught here.
 *
 *   node dashboard/scripts/sa-clips-lock.js          # after bumping SESSION in sw.js: rewrite the lock
 *
 * It refuses to rewrite the lock under the same SESSION when a locked file changed (bump SESSION first).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const SA = path.join(REPO, 'dashboard', 'sa');
const LOCK = path.join(SA, 'clips.lock.json');
// What sw.js serves cache-first: Jugnu's clips and word timings (/sa/v<n>/), the pictures, and the battery files.
const ROOTS = [
  { dir: SA, keep: (rel) => /^v\d+\//.test(rel) || /\.(mp3|m4a|ogg|webp|png|woff2)$/.test(rel) },
  { dir: path.join(REPO, 'bot', 'shared', 'data', 'child-test', 'sa'), keep: (rel) => /^sa\.(coach|game)\.[^/]+\.(en|ur)\.json$/.test(rel) },
];

function walk(dir, base = dir, out = []) {
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const d of names) {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) walk(full, base, out);
    else if (d.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

/** { '<path from the repo root>': '<sha1 of the bytes>' } for every file the worker answers cache-first. */
function digest(repo = REPO) {
  const files = {};
  for (const r of ROOTS) {
    const dir = path.join(repo, path.relative(REPO, r.dir));
    for (const rel of walk(dir).filter((x) => !/(^|\/)CLAUDE(\.index)?\.md$/.test(x) && r.keep(x)).sort()) {
      const full = path.join(dir, rel);
      files[path.relative(repo, full).split(path.sep).join('/')] = crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex');
    }
  }
  return files;
}

/** The SESSION cache name sw.js declares. */
function session(repo = REPO) {
  const m = /^var SESSION = '([^']+)';/m.exec(fs.readFileSync(path.join(repo, 'dashboard', 'sa', 'sw.js'), 'utf8'));
  if (!m) throw new Error('sw.js declares no SESSION');
  return m[1];
}

/** Locked files whose bytes differ now, or are gone (a new file is not listed: it is a new URL). */
function changed(lock, files) {
  return Object.keys(lock.files).filter((p) => files[p] !== lock.files[p]);
}

function main() {
  const now = digest();
  const sess = session();
  let lock = null;
  try { lock = JSON.parse(fs.readFileSync(LOCK, 'utf8')); } catch (_) { lock = null; }
  if (lock && lock.session === sess) {
    const diff = changed(lock, now);
    if (diff.length) {
      console.error(`${diff.length} locked file(s) changed under ${sess}; bump SESSION in dashboard/sa/sw.js first:\n  ${diff.slice(0, 20).join('\n  ')}`);
      process.exit(1);
    }
  }
  const body = { session: sess, about: 'dashboard/scripts/sa-clips-lock.js', files: now };
  fs.writeFileSync(LOCK, JSON.stringify(body, null, 1) + '\n');
  console.log(`${LOCK}: ${Object.keys(now).length} files under ${sess}`);
}

if (require.main === module) main();

module.exports = { digest, session, changed, LOCK };
