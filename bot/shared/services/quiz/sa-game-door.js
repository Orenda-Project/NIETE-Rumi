'use strict';
/**
 * The big flight's row in the games door (switch sa_game, default OFF; sa-game/flag.js).
 *
 *   addRow(out, who, { token, kid, lang })   the games door's answer with one row appended:
 *     { kind: 'bigtest', href: '/sa-game/<hub token>?kid=<chip>&lang=<en|ur>', name }
 *
 * The switch comes from the hub's warm switch cache only (the door has just filled it): no read, no wait. Off, a cold
 * cache, a failed door (no rows, `err`), no verified child, a token or chip of the wrong shape, or any throw: `out`
 * itself, untouched. The game page resolves the child again from the same token and chip (never from the href's words).
 * The row's words never name a test (the child's screen carries no test words).
 */
const Flag = require('../sa-game/flag');

const NAME = Object.freeze({ en: "Jugnu's big flight", ur: 'جگنو کی بڑی اڑان' });
const TOKEN_RX = /^[A-Za-z0-9_-]{8,1000}\.[A-Za-z0-9_-]{16,64}$/;
const CHIP_RX = /^[0-9a-f]{16}$/;

function addRow(out, who, { token, kid, lang } = {}) {
  try {
    if (!out || !Array.isArray(out.games) || out.err || !who || !who.studentId) return out;
    if (!TOKEN_RX.test(String(token || '')) || !CHIP_RX.test(String(kid || ''))) return out;
    if (!Flag.now()) return out;
    const l = lang === 'ur' ? 'ur' : 'en';
    const href = `/sa-game/${token}?kid=${kid}&lang=${l}`;
    return { ...out, games: [...out.games, { kind: 'bigtest', href, name: NAME[l] }] };
  } catch (_) {
    return out;
  }
}

module.exports = { addRow, NAME, TOKEN_RX, CHIP_RX };
