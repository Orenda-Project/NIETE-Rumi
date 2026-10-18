'use strict';
/**
 * Every Urdu string the shared link's landing (/k/<t>) and its card draw: the closed text the landing's own small
 * Urdu face (dashboard/lib/web-quiz-landing-face.js) is cut for. One list, read by the build (build.py) and by the
 * guard test (dashboard/tests/web-quiz-landing-face.service.test.js), so a copy change without a rebuild goes red.
 *
 *   - the card's words, COPY.ur (each deed, the sticker line, the return line and its button), and the words the
 *     return link types (CARD_RETURN_WORDS.ur), from bot/shared/services/quiz/web-quiz-card-image.js
 *   - the activity marks (MARK[kind].ur)
 *   - the landing's own words (CARD_LANDING.ur in dashboard/routes/web-quiz.routes.js)
 *
 * NOT here, by design: the child's first name. It is open text (any name a teacher typed), which a closed cut cannot
 * shape, so the landing draws it in the system face (see the module's comment).
 *
 * `node strings.js` prints the list as JSON.
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const REPO = path.join(__dirname, '..', '..', '..');
const CARD = path.join(REPO, 'bot', 'shared', 'services', 'quiz', 'web-quiz-card-image.js');
const ROUTES = path.join(REPO, 'dashboard', 'routes', 'web-quiz.routes.js');

// The card module needs the database client and the logger only when it is called; for its word lists it loads
// with both stubbed (no env, no network).
function loadCard() {
  const orig = Module._load;
  Module._load = function load(req, parent, ...rest) {
    if (/config[\\/]supabase$/.test(req)) return {};
    if (/utils[\\/]logger$/.test(req)) return { logToFile() {}, logError() {}, logWarn() {} };
    return orig.call(this, req, parent, ...rest);
  };
  try {
    return require(CARD);
  } finally {
    Module._load = orig;
  }
}

// CARD_LANDING's object literal, read from the routes' source (the routes do not export it). null when absent.
function cardLanding(src) {
  const at = src.indexOf('const CARD_LANDING = {');
  if (at < 0) return null;
  const end = src.indexOf('\n};', at);
  const literal = src.slice(at + 'const CARD_LANDING = '.length, end + 2);
  // eslint-disable-next-line no-new-func
  return new Function(`return (${literal});`)();
}

const URDU = /[؀-ۿ]/;
function landingStrings({ card = loadCard(), routesSrc = fs.readFileSync(ROUTES, 'utf8') } = {}) {
  const out = [];
  const add = (s) => { if (typeof s === 'string' && URDU.test(s)) out.push(s); };
  Object.values(card.COPY.ur).forEach(add);
  if (card.CARD_RETURN_WORDS) add(card.CARD_RETURN_WORDS.ur);
  if (card.MARK) Object.values(card.MARK).forEach((m) => add(m && m.ur));
  const cl = cardLanding(routesSrc);
  if (cl && cl.ur) Object.values(cl.ur).forEach(add);
  return [...new Set(out)].sort();
}

module.exports = { landingStrings, cardLanding };

if (require.main === module) process.stdout.write(`${JSON.stringify(landingStrings(), null, 1)}\n`);
