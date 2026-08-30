'use strict';
/**
 * /roster — recovering the bytes of a PhotoPicker upload.
 *
 * A Flow never hands the endpoint an image. It hands over a CDN URL and a bag of
 * encryption metadata, and the endpoint has to fetch, verify and decrypt. The
 * scheme is WhatsApp's standard media encryption:
 *
 *   ciphertext = cdnFile[:-10]              (the last 10 bytes are a truncated MAC)
 *   sha256(cdnFile)              == encrypted_hash
 *   HMAC-SHA256(hmac_key, iv||ciphertext)[:10] == cdnFile[-10:]
 *   plaintext = AES-256-CBC(encryption_key, iv) then PKCS#7 unpad
 *   sha256(plaintext)            == plaintext_hash
 *
 * All three checks are enforced. This image is about to be read by a model whose
 * output becomes a school's student roster, so a corrupted or substituted file has
 * to fail loudly here rather than quietly become 40 wrong names.
 */

const crypto = require('crypto');

const MAX_BYTES = 12 * 1024 * 1024; // a register page; the Flow itself caps at 10 MB

/** Default fetcher. Kept injectable so the crypto can be tested without a network. */
async function httpsFetch(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`roster-media: CDN responded ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('roster-media: CDN file exceeds the size cap');
  return buf;
}

const dec = (v) => Buffer.from(String(v || ''), 'base64');

/**
 * @param {{media_id:string, file_name:string, cdn_url:string, encryption_metadata:object}} media
 * @param {{fetch?:Function}} [deps]
 * @returns {Promise<{mediaId:string, fileName:string, data:Buffer}>}
 */
async function decryptMedia(media, deps = {}) {
  const get = deps.fetch || httpsFetch;
  const meta = (media && media.encryption_metadata) || {};
  const url = String((media && media.cdn_url) || '');

  // Never fetch a Flow-supplied URL over plaintext http, and never off a non-URL.
  if (!/^https:\/\//i.test(url)) {
    throw new Error('roster-media: cdn_url must be https');
  }

  const cdnFile = await get(url);
  if (!Buffer.isBuffer(cdnFile) || cdnFile.length <= 10) {
    throw new Error('roster-media: CDN file is empty or too short to carry a MAC');
  }

  const ciphertext = cdnFile.subarray(0, cdnFile.length - 10);
  const mac = cdnFile.subarray(cdnFile.length - 10);

  const encryptedHash = crypto.createHash('sha256').update(cdnFile).digest().toString('base64');
  if (encryptedHash !== meta.encrypted_hash) {
    throw new Error('roster-media: CDN file hash verification failed');
  }

  const iv = dec(meta.iv);
  const expectedMac = crypto.createHmac('sha256', dec(meta.hmac_key))
    .update(Buffer.concat([iv, ciphertext]))
    .digest()
    .subarray(0, 10);
  if (!crypto.timingSafeEqual(expectedMac, mac)) {
    throw new Error('roster-media: HMAC verification failed');
  }

  const decipher = crypto.createDecipheriv('aes-256-cbc', dec(meta.encryption_key), iv);
  const data = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  const plainHash = crypto.createHash('sha256').update(data).digest().toString('base64');
  if (plainHash !== meta.plaintext_hash) {
    throw new Error('roster-media: decrypted data hash verification failed');
  }

  return { mediaId: media.media_id, fileName: media.file_name, data };
}

module.exports = { decryptMedia, MAX_BYTES };
