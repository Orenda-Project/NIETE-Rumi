'use strict';
/**
 * Training/portal media URLs — one definition, shared by portal.routes.js and the Training Library
 * (bd-s42dye.1). Moved out of portal.routes.js verbatim so the library presigns EXACTLY as the module
 * route does, without requiring that 8,600-line module.
 */
const { generatePresignedUrl, isValidR2Url } = require('../services/r2.service');

/** R2 URLs are presigned; other http(s) URLs pass through; anything else is null. */
async function resolveMediaUrl(url, expiresIn = 3600, options) {
  if (!url) return null;
  if (isValidR2Url(url)) return generatePresignedUrl(url, expiresIn, options);
  if (/^https?:\/\//i.test(url)) return url;
  return null;
}

/** True when a module's source_media_url points at a PDF document. */
function isPdfSourceUrl(url) {
  return !!url && /\.pdf(\?|$)/i.test(url);
}

module.exports = { resolveMediaUrl, isPdfSourceUrl };
