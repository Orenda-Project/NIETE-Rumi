'use strict';
/**
 * The switch as the SA routers read it (sa_engine, sa_game): the house reader (web-quiz-brotli-flag.js) never waits, so
 * it answers OFF until its first read lands and for 30 s after any failed read. For the engine's and the game's own
 * files that meant, once in a while, the portal's page instead of a script (a child's game hung on "Getting the islands
 * ready…"). steady(on) reads the same switch, plus:
 *   - whenReady() waits for the first read (call it once per process before the first answer);
 *   - once ON was read, a later OFF answer is believed only after holdMs (default 60 s), so a failed read does not
 *     flap; a real OFF lands within holdMs + the reader's 30 s.
 * Never read ON → always OFF: the OFF path is unchanged.
 */
const HOLD_MS = 60 * 1000;

function steady(on, { holdMs = HOLD_MS, now = Date.now } = {}) {
  let lastOnAt = -Infinity;
  let warming = null;
  function read() {
    const t = now();
    if (on()) { lastOnAt = t; return true; }
    return t - lastOnAt < holdMs;
  }
  read.whenReady = () => {
    if (!warming) {
      on();
      warming = Promise.resolve(typeof on.ready === 'function' ? on.ready() : null).then(() => read(), () => read());
    }
    return warming;
  };
  /** Express middleware: the first request of the process waits for the first read; later ones never wait. */
  read.warm = () => {
    let warm = false;
    return (req, res, next) => {
      if (warm) return next();
      return read.whenReady().then(() => { warm = true; next(); }, () => { warm = true; next(); });
    };
  };
  return read;
}

module.exports = { HOLD_MS, steady };
