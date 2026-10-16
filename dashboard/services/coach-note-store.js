'use strict';
/**
 * The teacher's voice note for her coach (v10 coaching test, bd-v0toag.38.9), kept in R2 under
 * coach-visit-notes/<request id>.<ext> until the coach says "I have visited".
 *
 * Uses the portal's own @aws-sdk (dashboard/package.json) and the same R2_* env as r2.service.js. The SDK
 * and client are loaded on first use, so requiring this never depends on R2 being set up. No bucket → every
 * call throws, and the caller sends the ping without a note.
 */
function loadSdk() {
  const s3 = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const client = new s3.S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  });
  return { client, getSignedUrl, PutObjectCommand: s3.PutObjectCommand, GetObjectCommand: s3.GetObjectCommand, DeleteObjectCommand: s3.DeleteObjectCommand };
}

function createNoteStore(opts = {}) {
  let sdk = opts.sdk || null;
  const use = () => {
    const Bucket = opts.bucket !== undefined ? opts.bucket : process.env.R2_BUCKET_NAME;
    if (!Bucket) throw new Error('coach note store: no R2 bucket');
    if (!sdk) sdk = loadSdk();
    return { Bucket, sdk };
  };
  return {
    async put(buf, key, type) {
      const { Bucket, sdk: s } = use();
      await s.client.send(new s.PutObjectCommand({ Bucket, Key: key, Body: buf, ContentType: type }));
    },
    async presign(key, seconds) {
      const { Bucket, sdk: s } = use();
      return s.getSignedUrl(s.client, new s.GetObjectCommand({ Bucket, Key: key }), { expiresIn: seconds });
    },
    async del(key) {
      const { Bucket, sdk: s } = use();
      await s.client.send(new s.DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}

let _store = null;
const noteStore = () => (_store || (_store = createNoteStore()));

module.exports = { createNoteStore, noteStore };
