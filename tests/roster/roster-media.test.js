/**
 * /roster — decrypting a PhotoPicker upload.
 *
 * Flows deliver PhotoPicker files as a CDN URL plus encryption metadata, never as
 * bytes. The endpoint must download, verify two hashes and an HMAC, then AES-CBC
 * decrypt. Every one of those checks exists to stop us feeding a corrupted or
 * substituted image to the extractor and writing the result into a school roster,
 * so each is tested for failing loudly rather than passing quietly.
 *
 * The fixtures are built by ENCRYPTING here and decrypting through the module, so
 * this is a real round trip rather than a mock agreeing with itself.
 */

const crypto = require('crypto');
const { decryptMedia } = require('../../bot/shared/services/roster/roster-media');

const b64 = (b) => Buffer.from(b).toString('base64');

/** Build a valid encrypted CDN payload exactly as WhatsApp does. */
function seal(plaintext) {
  const encryptionKey = crypto.randomBytes(32);
  const hmacKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv('aes-256-cbc', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const mac = crypto.createHmac('sha256', hmacKey)
    .update(Buffer.concat([iv, ciphertext]))
    .digest()
    .subarray(0, 10);
  const cdnFile = Buffer.concat([ciphertext, mac]);

  return {
    cdnFile,
    media: {
      media_id: 'm-1',
      file_name: 'page1.jpg',
      cdn_url: 'https://cdn.example/whatsapp/page1',
      encryption_metadata: {
        encryption_key: b64(encryptionKey),
        hmac_key: b64(hmacKey),
        iv: b64(iv),
        encrypted_hash: b64(crypto.createHash('sha256').update(cdnFile).digest()),
        plaintext_hash: b64(crypto.createHash('sha256').update(plaintext).digest()),
      },
    },
  };
}

const fetcherFor = (bytes) => jest.fn().mockResolvedValue(bytes);

describe('decryptMedia', () => {
  const PLAIN = Buffer.from('a pretend register photograph, several bytes long');

  it('round-trips a genuine payload back to the original bytes', async () => {
    const { cdnFile, media } = seal(PLAIN);
    const out = await decryptMedia(media, { fetch: fetcherFor(cdnFile) });
    expect(out.data.equals(PLAIN)).toBe(true);
    expect(out.mediaId).toBe('m-1');
    expect(out.fileName).toBe('page1.jpg');
  });

  it('downloads from the cdn_url it was given, and nowhere else', async () => {
    const { cdnFile, media } = seal(PLAIN);
    const fetch = fetcherFor(cdnFile);
    await decryptMedia(media, { fetch });
    expect(fetch).toHaveBeenCalledWith('https://cdn.example/whatsapp/page1');
  });

  it('rejects a CDN file that does not match encrypted_hash', async () => {
    const { cdnFile, media } = seal(PLAIN);
    const tampered = Buffer.from(cdnFile);
    tampered[0] ^= 0xff;
    await expect(decryptMedia(media, { fetch: fetcherFor(tampered) }))
      .rejects.toThrow(/cdn file hash/i);
  });

  it('rejects a payload whose HMAC does not verify', async () => {
    const { cdnFile, media } = seal(PLAIN);
    const bad = { ...media, encryption_metadata: { ...media.encryption_metadata, hmac_key: b64(crypto.randomBytes(32)) } };
    // keep encrypted_hash consistent so the HMAC check is what fails, not the hash
    await expect(decryptMedia(bad, { fetch: fetcherFor(cdnFile) }))
      .rejects.toThrow(/hmac/i);
  });

  it('rejects when the decrypted bytes do not match plaintext_hash', async () => {
    const { cdnFile, media } = seal(PLAIN);
    const bad = {
      ...media,
      encryption_metadata: {
        ...media.encryption_metadata,
        plaintext_hash: b64(crypto.createHash('sha256').update('something else').digest()),
      },
    };
    await expect(decryptMedia(bad, { fetch: fetcherFor(cdnFile) }))
      .rejects.toThrow(/decrypted/i);
  });

  it('refuses a non-https cdn_url rather than fetching it', async () => {
    const { cdnFile, media } = seal(PLAIN);
    const bad = { ...media, cdn_url: 'http://cdn.example/page1' };
    const fetch = fetcherFor(cdnFile);
    await expect(decryptMedia(bad, { fetch })).rejects.toThrow(/https/i);
    expect(fetch).not.toHaveBeenCalled();
  });
});
