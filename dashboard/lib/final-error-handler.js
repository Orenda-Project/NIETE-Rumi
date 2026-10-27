/**
 * bd-nmwmr4.2 — the dashboard's last Express error handler, mounted at the end of index.js.
 *
 * A malformed JSON body (`{not json`, or a bare JSON string under strict mode) makes
 * express.json() throw `entity.parse.failed` before any router runs, so this handler sees it
 * on every path, signed in or out. It used to render `error` without `isAuthenticated`, the
 * view threw a ReferenceError, and Express's default handler printed the template source and
 * the container path to the caller as a 500. Now: a client body error is a 400 JSON with no
 * caching, and the view render can no longer throw (views/error.ejs defaults its locals too).
 */
function finalErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).set('Cache-Control', 'private, no-store')
      .json({ success: false, error: 'Malformed JSON body.' });
  }

  console.error('Server error:', err);
  return res.status(500).set('Cache-Control', 'private, no-store').render('error', {
    title: 'Server Error',
    message: 'An unexpected error occurred',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
    isAuthenticated: !!(req.session && req.session.isAuthenticated),
  });
}

module.exports = { finalErrorHandler };
