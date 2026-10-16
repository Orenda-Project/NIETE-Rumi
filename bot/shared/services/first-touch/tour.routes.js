'use strict';
/**
 * POST /api/ft/tour {t, action, how?} — the maker page's tour banner (TOUR.md §2-§5), mounted on the maker router
 * (behind its switch, internal key and body parsers). WHO comes only from the maker token.
 *
 *   show     → door.keys.markTourShown (a no-op when the quiz_tour row exists); tour_shown only when it made the row
 *   dismiss  → door.keys.markTourDismissed; tour_dismissed with how ∈ {ok, chip, prefill} (anything else → 400)
 *   replay   → tour_replayed only; NO write
 *
 * 204 on success; a stale token → 410, a forged one → 404 (authoriseJson); a throw → 503 {error:'mk.error'}.
 * Events: onboard.maker with maker.routes' fields (step, grade:null, subject:null, qlang:null, lang, via,
 * quiz_id:null, ukey from the token's uk, w:'s') plus `how` on tour_dismissed only. Never a phone, uid, kid or dk.
 * Never sends a message. The only writer is door.keys.
 */
const { logEvent } = require('../../utils/structured-logger');
const Keys = require('./door.keys');

const HOWS = Object.freeze(['ok', 'chip', 'prefill']);
const CARD_KINDS = Object.freeze(['lp', 'coach', 'exam']);
const CARD_SCREENS = Object.freeze(['ready', 'foot']);

function tourEvent(step, p, extra = {}) {
  try {
    logEvent('onboard.maker', {
      step, grade: null, subject: null, qlang: null, lang: p.lang, via: p.via, quiz_id: null,
      ukey: typeof p.uk === 'string' ? p.uk : null, w: 's', ...extra,
    });
  } catch (_) { /* a failed log never decides a response */ }
}

// Each action: (payload, body) → the status to answer.
const ACTIONS = Object.freeze({
  show: async (p) => {
    const { created } = await Keys.markTourShown(p.uid);
    if (created) tourEvent('tour_shown', p);
    return 204;
  },
  dismiss: async (p, b) => {
    if (!HOWS.includes(b.how)) return 400;
    await Keys.markTourDismissed(p.uid);
    tourEvent('tour_dismissed', p, { how: b.how });
    return 204;
  },
  replay: async (p) => {
    tourEvent('tour_replayed', p);
    return 204;
  },
  // ── cards: the three branch cards and the forward line (TOUR §6, §7) — event only, never a write ──
  card: async (p, b) => {
    if (!CARD_KINDS.includes(b.card) || !CARD_SCREENS.includes(b.screen)) return 400;
    tourEvent(`card_${b.card}`, p, { screen: b.screen });
    return 204;
  },
  forward: async (p) => {
    tourEvent('forward_tap', p);
    return 204;
  },
  // ── end cards ──
});

/** Registers the route. `deps` = maker.routes' { headers, handleJson, authoriseJson }. */
function mount(router, { headers, handleJson, authoriseJson }) {
  router.post('/api/ft/tour', handleJson(async (req, res) => {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const p = authoriseJson(b.t, res);
    if (!p) return;
    const run = Object.prototype.hasOwnProperty.call(ACTIONS, b.action) ? ACTIONS[b.action] : null;
    const status = run ? await run(p, b) : 400;
    headers(res);
    if (status === 204) res.status(204).end();
    else res.status(status).json({ error: 'mk.error' });
  }));
}

module.exports = { mount, ACTIONS, HOWS };
