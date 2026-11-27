/**
 * bd-q261rec (queue #261) — a classroom recording uploaded from the PORTAL in PIECES, so a slow or broken line resumes.
 *
 * WHY
 * ---
 * Until now the phone sent a recording as ONE PUT of the whole file straight to R2 (portal-coaching.presignUpload). On a
 * weak line a 40-minute lesson (10–40 MB) can take many minutes; one drop and the next try starts again from byte 0
 * (production, 25 Nov: four failed tries in a row on one recording, each from zero). Now:
 *
 *   1. begin   the phone says the file's size and its piece size; it gets the FINAL key (the same classroom_audio
 *              portal_<id> key presignUpload mints, so nothing downstream changes) and the piece count. Asked again with
 *              that key (after a drop, a reload, a killed app), it also gets the pieces the server already holds.
 *   2. sign    a presigned PUT per piece it still has to send (a few at a time).
 *   3. PUT     each piece, a plain byte range of the file, to upload_pieces/<uid>/<id>/<nnnn>.
 *   4. join    the bot checks every piece is there at its exact size (and, when the phone sent them, each piece's sha256),
 *              joins them in order into the final key, and deletes the pieces. The joined file is byte-identical to the
 *              phone's: pieces are byte ranges, not audio segments, so webm, m4a or wav join by plain concatenation.
 *
 * Then the existing start (/coaching/start, /observe/start, the debrief talk) runs with { key } exactly as before.
 *
 * STATELESS. The final key names the upload (its portal_<id>), and the piece prefix is derived from it and the user, so
 * no table or row is needed: R2 itself says what has arrived. Piece keys live in their own tree (upload_pieces/), never
 * under classroom_audio/, so PORTAL_KEY_RX never matches one and no session can point at a piece.
 *
 * Pieces never joined (a recording deleted on the phone, a send abandoned) stay under upload_pieces/ until an R2
 * lifecycle rule on that prefix removes them (an operator setting on the bucket; see the #261 report).
 *
 * IDENTITY: every function takes the userId the PORTAL read from its session, and every key is checked to be that
 * user's own (isOwnPortalKey) before anything is signed, listed or joined.
 */

const crypto = require('crypto');
const coaching = require('./portal-coaching.service');

const PIECES_ROOT = 'upload_pieces';
const PIECE_CONTENT_TYPE = 'application/octet-stream';
/** 64 KiB .. 8 MiB: small enough for a 2G line to finish one in about a minute, large enough to keep the count low. */
const MIN_PIECE_BYTES = 64 * 1024;
const MAX_PIECE_BYTES = 8 * 1024 * 1024;
const MAX_PIECES = 2000;
/** Pieces signed per request: a few minutes of sending, so a link rarely expires before it is used. */
const MAX_SIGN = 50;
/** A piece link lives an hour: on a slow line the last of a batch may be sent long after it was signed. */
const PIECE_TTL_SECONDS = 60 * 60;

const ID_RX = /\/portal_([A-Za-z0-9-]+)\.[a-z0-9]+$/;

function withDefaults(deps = {}) {
  const lazy = {
    r2: () => require('../../storage/r2'),
    log: () => require('../../utils/logger').logToFile,
    now: () => () => new Date(),
    newId: () => () => crypto.randomUUID(),
  };
  const d = {};
  for (const [name, load] of Object.entries(lazy)) {
    Object.defineProperty(d, name, { enumerable: true, get: () => (deps[name] !== undefined ? deps[name] : load()) });
  }
  return d;
}

/** The upload's id (portal_<id>) from a final key of this user's, or null when the key is not theirs. */
function uploadIdOf(userId, key) {
  if (!coaching.isOwnPortalKey(userId, key, 'audio')) return null;
  const m = String(key).match(ID_RX);
  return m ? m[1] : null;
}

function piecePrefix(userId, id) {
  return `${PIECES_ROOT}/${userId}/${id}/`;
}

function pieceKey(userId, id, n) {
  return `${piecePrefix(userId, id)}${String(n).padStart(4, '0')}`;
}

/** The content type the final key is stored under: the audio type of its extension. */
function contentTypeOf(key) {
  return coaching.AUDIO_TYPES[coaching.extOf(key)] || 'application/octet-stream';
}

const isInt = (v) => Number.isInteger(v);

/** Size and piece size checked; the piece count, or { reason }. */
function shape(sizeBytes, pieceBytes) {
  const size = Number(sizeBytes);
  const piece = Number(pieceBytes);
  if (!isInt(size) || size <= 0) return { reason: 'bad_size' };
  if (size > coaching.MAX_UPLOAD_BYTES) return { reason: 'too_large' };
  if (!isInt(piece) || piece < MIN_PIECE_BYTES || piece > MAX_PIECE_BYTES) return { reason: 'bad_piece_size' };
  const pieces = Math.ceil(size / piece);
  if (pieces > MAX_PIECES) return { reason: 'too_many_pieces' };
  return { size, piece, pieces };
}

/** The size piece n must have: pieceBytes, except the last, which holds the rest. */
function expectedSize(n, size, piece, pieces) {
  return n === pieces - 1 ? size - piece * (pieces - 1) : piece;
}

/** What R2 holds under the upload's piece prefix: n → bytes. */
async function heldPieces(d, userId, id) {
  const prefix = piecePrefix(userId, id);
  const out = new Map();
  for (const o of await d.r2.listObjects(prefix)) {
    const tail = String(o.key).slice(prefix.length);
    if (/^\d{4,}$/.test(tail)) out.set(Number(tail), Number(o.size));
  }
  return out;
}

function say(d, line, fields) {
  try { d.log(line, fields, 'info'); } catch (_) { /* logging never decides */ }
}

/**
 * Start an upload in pieces, or (with `key`) pick one up again.
 * @param {{userId, filename, sizeBytes, pieceBytes, key?}} args
 * @returns {{status:'ok', key, contentType, pieceBytes, pieces, have:number[], joined:boolean}
 *         | {status:'invalid', reason}}
 */
async function beginPieces({ userId, filename, sizeBytes, pieceBytes, key }, deps) {
  if (!userId) return { status: 'invalid', reason: 'no_user' };
  const d = withDefaults(deps);
  let finalKey = key;
  let id;
  if (key != null) {
    id = uploadIdOf(userId, key);
    if (!id) return { status: 'invalid', reason: 'not_yours' };
  } else if (!coaching.AUDIO_TYPES[coaching.extOf(filename)]) {
    return { status: 'invalid', reason: 'not_audio' };
  }
  const s = shape(sizeBytes, pieceBytes);
  if (s.reason) return { status: 'invalid', reason: s.reason };

  if (key == null) {
    id = d.newId();
    finalKey = coaching.buildUploadKey(userId, coaching.extOf(filename), d.now(), id, 'audio');
  }
  const contentType = contentTypeOf(finalKey);
  const base = { status: 'ok', key: finalKey, contentType, pieceBytes: s.piece, pieces: s.pieces };

  if (key != null) {
    // Already joined (the answer to an earlier join was lost): nothing left to send.
    const head = await d.r2.headObject(finalKey);
    if (head && head.exists && Number(head.sizeBytes) === s.size) {
      say(d, '🧩 pieces.begin', { userId, key: finalKey, sizeBytes: s.size, pieces: s.pieces, have: s.pieces, resumed: true, joined: true });
      return { ...base, have: [], joined: true };
    }
    // Joined already as a DIFFERENT file (a recording that grew after it was sent): never written over, since a session
    // may point at it. The phone starts a fresh upload (a new key).
    if (head && head.exists) return { status: 'invalid', reason: 'key_taken' };
    const held = await heldPieces(d, userId, id);
    const have = [...held.entries()]
      .filter(([n, size]) => n < s.pieces && size === expectedSize(n, s.size, s.piece, s.pieces))
      .map(([n]) => n).sort((a, b) => a - b);
    say(d, '🧩 pieces.begin', { userId, key: finalKey, sizeBytes: s.size, pieces: s.pieces, have: have.length, resumed: true });
    return { ...base, have, joined: false };
  }
  say(d, '🧩 pieces.begin', { userId, key: finalKey, sizeBytes: s.size, pieces: s.pieces, have: 0, resumed: false });
  return { ...base, have: [], joined: false };
}

/**
 * Sign a PUT for each piece asked for.
 * @param {{userId, key, pieces:number[], attempt?}} args  attempt: the phone's try for the first of them (1 = first)
 * @returns {{status:'ok', contentType, expiresIn, urls:{n, url}[]} | {status:'invalid', reason}}
 */
async function signPieces({ userId, key, pieces, attempt }, deps) {
  if (!userId) return { status: 'invalid', reason: 'no_user' };
  const id = uploadIdOf(userId, key);
  if (!id) return { status: 'invalid', reason: 'not_yours' };
  if (!Array.isArray(pieces) || !pieces.length || pieces.length > MAX_SIGN
    || !pieces.every((n) => isInt(n) && n >= 0 && n < MAX_PIECES)) {
    return { status: 'invalid', reason: 'bad_pieces' };
  }
  const d = withDefaults(deps);
  const urls = [];
  for (const n of pieces) {
    // eslint-disable-next-line no-await-in-loop
    urls.push({ n, url: await d.r2.getPresignedUploadUrl(pieceKey(userId, id, n), PIECE_CONTENT_TYPE, PIECE_TTL_SECONDS) });
  }
  const tries = isInt(Number(attempt)) && Number(attempt) > 0 ? Math.min(Number(attempt), 1000) : 1;
  say(d, tries > 1 ? '🧩 pieces.sign (retry)' : '🧩 pieces.sign', { userId, key, first: pieces[0], count: pieces.length, attempt: tries });
  return { status: 'ok', contentType: PIECE_CONTENT_TYPE, expiresIn: PIECE_TTL_SECONDS, urls };
}

/**
 * Join the pieces into the final key. Every piece must be there at its exact size; with `digests` (sha256 hex per
 * piece, from the phone) each must match too, or it is deleted and named so the phone sends it again.
 * @param {{userId, key, sizeBytes, pieceBytes, digests?: string[]}} args
 * @returns {{status:'ok', key, sizeBytes, sha256?, already?:true}
 *         | {status:'invalid', reason:'pieces_missing', missing:number[]}
 *         | {status:'invalid', reason:'pieces_mismatch', bad:number[]}
 *         | {status:'invalid', reason}}
 */
async function joinPieces({ userId, key, sizeBytes, pieceBytes, digests }, deps) {
  if (!userId) return { status: 'invalid', reason: 'no_user' };
  const id = uploadIdOf(userId, key);
  if (!id) return { status: 'invalid', reason: 'not_yours' };
  const s = shape(sizeBytes, pieceBytes);
  if (s.reason) return { status: 'invalid', reason: s.reason };
  const d = withDefaults(deps);
  const started = Date.now();

  const held = await heldPieces(d, userId, id);
  const head = await d.r2.headObject(key);
  if (head && head.exists && Number(head.sizeBytes) === s.size) {
    // Joined already (a retried join whose first answer was lost): the same answer, and any piece left is cleared.
    await Promise.all([...held.keys()].map((n) => d.r2.deleteKey(pieceKey(userId, id, n))));
    return { status: 'ok', key, sizeBytes: s.size, already: true };
  }

  const missing = [];
  for (let n = 0; n < s.pieces; n += 1) {
    if (held.get(n) !== expectedSize(n, s.size, s.piece, s.pieces)) missing.push(n);
  }
  if (missing.length) {
    say(d, '🧩 pieces.join missing', { userId, key, pieces: s.pieces, missing: missing.length, first: missing[0] });
    return { status: 'invalid', reason: 'pieces_missing', missing: missing.slice(0, 500) };
  }

  const want = Array.isArray(digests) && digests.length === s.pieces ? digests : null;
  const parts = [];
  const bad = [];
  for (let n = 0; n < s.pieces; n += 1) {
    // eslint-disable-next-line no-await-in-loop
    const buf = await d.r2.downloadFromR2(pieceKey(userId, id, n));
    if (want && /^[0-9a-f]{64}$/i.test(String(want[n] || ''))
      && crypto.createHash('sha256').update(buf).digest('hex') !== String(want[n]).toLowerCase()) {
      bad.push(n);
    }
    parts.push(buf);
  }
  if (bad.length) {
    await Promise.all(bad.map((n) => d.r2.deleteKey(pieceKey(userId, id, n))));
    say(d, '🧩 pieces.join mismatch', { userId, key, pieces: s.pieces, bad: bad.length, first: bad[0] });
    return { status: 'invalid', reason: 'pieces_mismatch', bad };
  }

  const joined = Buffer.concat(parts, s.size);
  const sha256 = crypto.createHash('sha256').update(joined).digest('hex');
  await d.r2.uploadBuffer(joined, key, contentTypeOf(key), { metadata: { sha256, pieces: String(s.pieces) } });
  await Promise.all([...held.keys()].map((n) => d.r2.deleteKey(pieceKey(userId, id, n))));
  say(d, '🧩 pieces.joined', { userId, key, pieces: s.pieces, sizeBytes: s.size, sha256, ms: Date.now() - started });
  return { status: 'ok', key, sizeBytes: s.size, sha256 };
}

module.exports = {
  PIECES_ROOT,
  PIECE_CONTENT_TYPE,
  MIN_PIECE_BYTES,
  MAX_PIECE_BYTES,
  MAX_PIECES,
  MAX_SIGN,
  uploadIdOf,
  pieceKey,
  beginPieces,
  signPieces,
  joinPieces,
};
