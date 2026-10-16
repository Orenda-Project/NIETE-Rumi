/**
 * The fast first page's wire (app_settings web_quiz_fast on): compression.
 *
 * The hosting edge compresses a whole, buffered answer only; a page sent in two parts (the head now, the quiz when
 * the bot answers) reached the phone uncompressed. So the portal compresses it itself — br, else gzip — and flushes
 * the compressor after each write so the phone can paint the head while the bot works.
 */
const zlib = require('zlib');

// br quality 5: about gzip's speed, ~6% smaller on these pages; a 50 KB page compresses in ~0.5 ms (q11: ~134 ms).
const BR_PARAMS = { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT };

/** Opens the streamed answer (status 200, html) and returns { write(text) — sent at once, end(text) }. */
function open(req, res) {
  res.vary('Accept-Encoding');
  res.status(200).type('html');
  // br whenever the phone takes it (a phone lists gzip first; the order is not a preference), else gzip.
  const enc = req.acceptsEncodings('br') === 'br' ? 'br' : req.acceptsEncodings('gzip') === 'gzip' ? 'gzip' : null;
  if (!enc) return { write: (s) => res.write(s), end: (s) => res.end(s) };
  const z = enc === 'br' ? zlib.createBrotliCompress({ params: BR_PARAMS }) : zlib.createGzip();
  res.set('Content-Encoding', enc);
  z.on('error', () => res.destroy());
  res.on('close', () => { if (!res.writableFinished) z.destroy(); });
  z.pipe(res);
  return {
    write: (s) => { z.write(s); z.flush(enc === 'gzip' ? zlib.constants.Z_SYNC_FLUSH : zlib.constants.BROTLI_OPERATION_FLUSH); },
    end: (s) => z.end(s),
  };
}

module.exports = { open };
