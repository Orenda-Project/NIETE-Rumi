'use strict';
const { logToFile } = require('../utils/logger');

/**
 * Shared-secret auth for every route in this router.
 *
 * Rejects when INTERNAL_API_KEY is unset. Without that check a bot missing the
 * variable would compare `undefined === undefined` for a caller that sent no
 * header, and the endpoint would be open to anyone who found the URL.
 */
function requireInternalKey(req, res, next) {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) {
    logToFile('❌ Internal API called but INTERNAL_API_KEY is not set — refusing', {
      path: req.path,
    });
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  if (req.headers['x-api-key'] !== expected) {
    logToFile('❌ Unauthorized internal API call', { path: req.path, ip: req.ip });
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  return next();
}

module.exports = { requireInternalKey };
