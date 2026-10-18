'use strict';
/**
 * The read-along player, fetched with the Jugnu page that can use it. The bot names `ra_pre` on a menu only with
 * app_settings web_quiz_ra_preload on, a passage that can be served and the read-along on; the page then carries one
 * preload line in its head, at the same address wq-trail.js asks for later (its RA_V is this file's hash, a test keeps
 * the two in step), so the early fetch is the one the page reuses. Any other menu: the page as it was.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public', 'wq');

function readAlongVersion() {
  try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(PUBLIC_DIR, 'wq-readalong.js'))).digest('hex').slice(0, 10); } catch (_) { return '0'; }
}

function raPreloadTag(menu) {
  if (!menu || menu.ra_pre !== true || !(menu.v2 && menu.v2.story)) return '';
  if (!Array.isArray(menu.exercises) || !menu.exercises.some((e) => e && e.id === 'read')) return '';
  return `\n<link rel="preload" as="script" href="/wq/wq-readalong.js?v=${readAlongVersion()}">`;
}

/** The Jugnu page with that line last in its head; the same string when there is none. */
function withRaPreload(html, menu) {
  const tag = raPreloadTag(menu);
  return tag ? html.replace('\n</head>', `${tag}\n</head>`) : html;
}

module.exports = { withRaPreload, raPreloadTag, readAlongVersion };
