'use strict';
/**
 * Storybook files in storage: page pictures, covers, word bands and page voices.
 *
 *   story/<env>/<book id>/<stem>-<hash8>.<ext>     hash8 = the first 8 hex of sha256(bytes)
 *
 * Content-addressed, so a file never changes under its name: a re-render or a re-voice is a new name, and the
 * reader's copy can be kept for a year (`/s/<book id>/<file>` on the portal streams it with an immutable header).
 * BUCKET: the quiz-audio bucket (WEB_QUIZ_AUDIO_BUCKET, else R2_BUCKET_NAME), as clips. ENV: the Railway
 * environment's name (deployEnv), so sandbox writes under story/sandbox/. Nothing here is ever in the repository.
 * Dependency-free apart from r2.js, which is required only when a file is uploaded: the portal reads the name rules.
 */
const crypto = require('crypto');

const BOOK_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE_RX = /^[a-z0-9-]+\.(webp|ogg|mp3)$/;
const IMMUTABLE = 'public, max-age=31536000, immutable';
const PREFIX = 'story';

function deployEnv(env = process.env) {
  const raw = env.RAILWAY_ENVIRONMENT_NAME || env.NODE_ENV || 'dev';
  return String(raw).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'dev';
}

function storyKey({ env = deployEnv(), bookId, file }) {
  if (!BOOK_RX.test(String(bookId || ''))) throw new Error('storyKey: bad book id');
  if (!FILE_RX.test(String(file || ''))) throw new Error('storyKey: bad file name');
  return `${PREFIX}/${deployEnv({ RAILWAY_ENVIRONMENT_NAME: env })}/${bookId}/${file}`;
}

// The namespace of every book id (a fixed random uuid): a book's id is uuid v5 of its catalogue id, so the id is known
// before the book is loaded (the voice files name it) and is the same in every database the book is loaded into.
const BOOK_NS = '3f0c7a52-6d1e-4b8e-9a57-1c2d9e4b7a10';

/** RFC 4122 v5: sha1(namespace bytes + name), version 5, variant 10. */
function uuidV5(ns, name) {
  const h = crypto.createHash('sha1').update(Buffer.from(ns.replace(/-/g, ''), 'hex')).update(String(name), 'utf8').digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

function bookIdFor(sourceId) {
  if (!sourceId || typeof sourceId !== 'string') throw new Error('bookIdFor: no source id');
  return uuidV5(BOOK_NS, sourceId);
}

/** 'p01.webp' + bytes → 'p01-<hash8>.webp'. */
function hashedName(file, buf) {
  const m = /^([a-z0-9-]+)\.([a-z0-9]+)$/.exec(String(file || ''));
  if (!m) throw new Error('hashedName: bad file name');
  const h8 = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
  return `${m[1]}-${h8}.${m[2]}`;
}

function storyBucket(env = process.env) {
  return String(env.WEB_QUIZ_AUDIO_BUCKET || '').trim() || env.R2_BUCKET_NAME || null;
}

/** Upload one file under its content hash; → {file, key, url, bytes}. Throws when storage refuses. */
async function uploadStoryFile(buf, { env, bookId, file, contentType }) {
  const name = hashedName(file, buf);
  const key = storyKey({ env, bookId, file: name });
  const bucket = storyBucket();
  await require('../../storage/r2').uploadBuffer(buf, key, contentType, { bucket: bucket || undefined, cacheControl: IMMUTABLE });
  return { file: name, key, url: storyFileUrl({ bookId, file: name }), bytes: buf.length };
}

/** The same-origin address of a stored file, or null when there is none. */
function storyFileUrl({ bookId, file }) {
  return file ? `/s/${bookId}/${file}` : null;
}

module.exports = { BOOK_RX, FILE_RX, IMMUTABLE, BOOK_NS, uuidV5, bookIdFor, deployEnv, storyKey, hashedName, storyBucket, uploadStoryFile, storyFileUrl };
