'use strict';
/**
 * WhatsApp send pacing — per recipient, shared by every process — and a bounded
 * retry for Meta's rate-limit refusals.
 *
 * WHY. Meta lets a business send roughly ONE message every 6 seconds to one
 * phone ("pair rate limit"; short bursts tolerated) and answers anything faster
 * with error 131056. Nothing paced sends per phone, and every sender turned the
 * refusal into a plain `false`, so the message was lost. Production, 30 days:
 * 11,711 sends refused with 131056 — training answers (4 sends per tap), LP
 * bundles (3-4 at once), child quizzes (~31 in a few minutes, a third of them
 * reactions nothing counted) — while the business-wide limits (130429, 131048)
 * never fired: the busiest second was 32 sends against Meta's 80.
 *
 * WHAT. whatsapp.service.js hands every `/messages` POST to `send()` below:
 *
 *   1. RESERVE a slot in the recipient's schedule. One Lua call on Redis, using
 *      Redis's own clock, so the bot and every worker replica draw from the SAME
 *      budget and two concurrent sends to one phone get two different slots. The
 *      schedule is GCRA ("virtual scheduling"): the phone's next free time moves
 *      forward one INTERVAL per send, and a send may go once that time is within
 *      BURST intervals of now. A reply to a quiet phone therefore waits 0 ms;
 *      only a phone that has just had BURST sends is spaced out.
 *   2. BEST-EFFORT sends (a reaction) only go when the phone has room right now.
 *      They are never waited for and never retried.
 *   3. RETRY only what Meta explicitly refused for rate: 131056 pushes the whole
 *      phone's schedule back (every sender to that phone backs off, not just this
 *      one) and retries once the penalty has passed; 130429/131048 back off and
 *      retry. Anything else — another code, a network error, a timeout — is
 *      returned untouched: Meta may have accepted it, and a retry could deliver it
 *      twice. A refused send created no message, so its retry cannot duplicate one.
 *   4. SHED a send whose phone is already queued further out than MAX_WAIT: that
 *      is a runaway loop, not a conversation.
 *
 * Redis is a convenience, never a dependency: unavailable or failing, the send
 * goes straight out (today's behaviour) and the retry still works.
 *
 * Every tunable is read at call time, so a Railway variable takes effect on the
 * next restart without a code change:
 *   WA_PAIR_PACING              'off' disables reservations (retry stays on)
 *   WA_PAIR_INTERVAL_MS         6000   sustained spacing per phone (Meta: 1 per 6 s)
 *   WA_PAIR_BURST               8      sends a quiet phone may receive back to back
 *   WA_PAIR_MAX_WAIT_MS         120000 shed a send that would wait longer
 *   WA_RATE_LIMIT_MAX_ATTEMPTS  3      attempts per send, first included
 *   WA_RATE_LIMIT_RETRY_BASE_MS 6000   first backoff; doubles per attempt, plus jitter
 */

const crypto = require('crypto');
const { logToFile } = require('../utils/logger');
const { metaErrorCodeOf } = require('../config/meta-messaging-window');

/** Meta codes that mean "refused for rate — nothing was sent, try later". */
const PAIR_LIMIT = 131056;
const RETRYABLE_CODES = new Set([130429, PAIR_LIMIT, 131048]);

/** A proactive wait shorter than this is ordinary pacing, not worth a log line. */
const PACED_LOG_THRESHOLD_MS = 1000;

/** The reservation is one Redis round trip (~1-3 ms on a private network). */
const RESERVE_TIMEOUT_MS = 750;

/**
 * One atomic reservation per call. KEYS[1] = the phone's schedule key.
 * ARGV: interval_ms, burst, max_wait_ms, mode, penalty_ms. Modes:
 *   'wait'          reserve the next slot unless it is further out than max_wait
 *   'try'           reserve only if the send can go right now (best-effort)
 *   'force_if_late' always reserve; granted=2 says the slot was further out than
 *                   max_wait, so the caller sends now instead of waiting
 *   'penalize'      push the phone's schedule back by penalty_ms (after a 131056)
 * Returns { delay_ms, granted (0 no | 1 yes | 2 yes, late) }. The stored value is the phone's
 * "theoretical arrival time" (TAT) in ms on Redis's clock; the key expires once
 * that time has passed, because an expired key and a TAT in the past mean the
 * same thing: the phone has its full burst again.
 */
// replicate_commands(): TIME is non-deterministic, and before Redis 5 a script
// could not write after reading it unless it asked for effects replication.
// Redis 5+ does this by default and 7+ keeps the call as a no-op.
const RESERVE_LUA = `
redis.replicate_commands()
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local interval = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local maxWait = tonumber(ARGV[3])
local mode = ARGV[4]
local tau = (burst - 1) * interval
local tat = tonumber(redis.call('GET', KEYS[1]) or '0')
if tat < now then tat = now end
if mode == 'penalize' then
  local floor = now + tonumber(ARGV[5]) + tau
  if tat < floor then tat = floor end
  redis.call('SET', KEYS[1], tat, 'PX', math.ceil(tat - now) + 1000)
  return {0, 1}
end
local delay = tat - tau - now
if delay < 0 then delay = 0 end
if delay > 0 and mode == 'try' then return {delay, 0} end
local granted = 1
if delay > maxWait then
  if mode ~= 'force_if_late' then return {delay, 0} end
  granted = 2
end
local nextTat = tat + interval
redis.call('SET', KEYS[1], nextTat, 'PX', math.ceil(nextTat - now) + 1000)
return {delay, granted}
`;

/** A numeric env value, or `fallback` when unset, unparseable or below `min`. */
function num(raw, fallback, min) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

function config() {
  return {
    pacing: String(process.env.WA_PAIR_PACING || 'on').toLowerCase() !== 'off',
    intervalMs: num(process.env.WA_PAIR_INTERVAL_MS, 6000, 1),
    burst: Math.floor(num(process.env.WA_PAIR_BURST, 8, 1)),
    maxWaitMs: num(process.env.WA_PAIR_MAX_WAIT_MS, 120000, 0),
    maxAttempts: Math.floor(num(process.env.WA_RATE_LIMIT_MAX_ATTEMPTS, 3, 1)),
    retryBaseMs: num(process.env.WA_RATE_LIMIT_RETRY_BASE_MS, 6000, 0),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const digitsOf = (to) => String(to || '').replace(/\D/g, '');

/** A stable, non-reversible id for a phone: log lines carry this, never the number. */
function toHash(to) {
  const d = digitsOf(to);
  return d ? crypto.createHash('sha1').update(d).digest('hex').slice(0, 12) : null;
}

const pairKey = (to) => `wa:pair:${toHash(to)}`;

/** Only the Cloud API's send endpoint is paced — never /media uploads or reads. */
function isMessagesUrl(url) {
  return typeof url === 'string' && /\/messages(\?|$)/.test(url);
}

/** 'text', 'image', 'interactive:button', 'reaction', … — from the request body. */
function kindOf(payload) {
  if (!payload || typeof payload !== 'object') return 'unknown';
  if (!payload.type) return payload.status ? 'status' : 'unknown';
  if (payload.type === 'interactive' && payload.interactive && payload.interactive.type) {
    return `interactive:${payload.interactive.type}`;
  }
  return payload.type;
}

// ─── call site ─────────────────────────────────────────────────────────────
// The error Meta returns names no feature. The stack captured when the send
// started does: `site` is an Error created synchronously in the transport
// wrapper, and V8 renders its (async-aware) stack only when a log line reads
// it — so a send that is never refused pays for an object allocation, nothing
// more.
// `at fn (/path/file.js:12:3)` or `at /path/file.js:12:3`; paths may contain spaces.
const FRAME_RE = /^at (?:async )?(?:(.*?) \()?(?:file:\/\/)?(.+?):(\d+):\d+\)?$/;
const OWN_FILES = /(whatsapp\.service|whatsapp-send-pacer)\.js$/;

/** `WhatsAppService.sendMessage` / `fetch [as sendMessage]` → `sendMessage`. */
function frameName(fn) {
  const alias = fn.match(/\[as ([^\]]+)\]/);
  return (alias ? alias[1] : fn).replace(/^(?:async )?(?:Function|WhatsAppService|Object)\./, '').trim();
}

function describeSite(site) {
  const out = { callSite: 'unknown', method: 'unknown' };
  if (!site || !site.stack) return out;
  const frames = String(site.stack).split('\n').slice(1)
    .map((l) => l.trim().match(FRAME_RE)).filter(Boolean)
    .map((m) => ({ fn: frameName(m[1] || ''), file: m[2], line: m[3] }));
  const method = frames.find((f) => /whatsapp\.service\.js$/.test(f.file) && /^(send|show)/.test(f.fn));
  if (method) out.method = method.fn;
  const caller = frames.find((f) => !OWN_FILES.test(f.file) && !f.file.startsWith('node:'));
  if (caller) {
    const base = caller.file.split(/[\\/]/).pop();
    out.callSite = `${base}:${caller.line}${caller.fn ? ` ${caller.fn}` : ''}`;
  }
  return out;
}

function emit(level, event, meta, data) {
  logToFile(event, {
    event,
    ...describeSite(meta.site),
    kind: meta.kind,
    toHash: toHash(meta.to),
    ...data,
  }, level);
}

// ─── the recipient's schedule (Redis) ───────────────────────────────────────
let lastDegradedLogAt = 0;

/**
 * Ask Redis for a slot. `null` means "no answer" (Redis down, script failed,
 * pacing off, no recipient) and the caller proceeds as if there were no pacing.
 * @returns {Promise<{delayMs:number, granted:boolean}|null>}
 */
async function reserve(to, mode, cfg, penaltyMs = 0) {
  if (!cfg.pacing || !digitsOf(to)) return null;
  let redis;
  try {
    redis = require('./cache/railway-redis.service');
  } catch (_) {
    return null;
  }
  if (!redis || typeof redis.evalScript !== 'function' || !redis.isAvailable()) return null;
  // A slow Redis must not become a slow reply: past the timeout the send goes
  // unpaced, exactly as it would with Redis down.
  let timer;
  const res = await Promise.race([
    redis.evalScript(
      RESERVE_LUA,
      [pairKey(to)],
      [cfg.intervalMs, cfg.burst, cfg.maxWaitMs, mode, Math.max(0, Math.round(penaltyMs))],
    ),
    new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), RESERVE_TIMEOUT_MS); }),
  ]);
  clearTimeout(timer);
  if (!Array.isArray(res)) {
    const now = Date.now();
    if (now - lastDegradedLogAt > 60000) {
      lastDegradedLogAt = now;
      logToFile('⚠️ WhatsApp send pacing unavailable — sending unpaced', {
        reason: res === 'timeout' ? `redis slower than ${RESERVE_TIMEOUT_MS} ms` : 'redis script failed',
      }, 'warn');
    }
    return null;
  }
  const granted = Number(res[1]);
  return { delayMs: Math.max(0, Number(res[0]) || 0), granted: granted === 1 || granted === 2, late: granted === 2 };
}

/** First backoff ≈ base, then doubling, each with up to +50% jitter. */
function backoffMs(attempt, cfg) {
  const base = cfg.retryBaseMs * (2 ** (attempt - 1));
  return Math.round(base + Math.random() * (cfg.retryBaseMs / 2));
}

/** Outcomes a caller's transport wrapper turns back into its own failure shape. */
const LOCAL = Object.freeze({ SKIPPED: 'skipped', SHED: 'shed' });

/**
 * Budgets for a send that an HTTP response is WAITING on — a WhatsApp Flow's
 * data_exchange (Meta allows ~10 s), or the portal's password-reset call (10 s
 * client timeout). Pacing must never hold such a send for the phone's next
 * slot: 6 s per message once its burst is spent, up to MAX_WAIT. So:
 *
 *   maxWaitMs  the longest it may wait for its slot. 1500 ms: the rest of a
 *              request (a DB read, the Graph call itself) must still fit.
 *   ifLate     what happens when the slot is further out than that:
 *     'skip'   not sent at all (whatsapp.paced outcome 'skipped'). For an ack
 *              whose content follows — "🎬 Sending your video…" before the video.
 *     'send'   sent NOW, unpaced — exactly what every send did before pacing —
 *              and it still takes a slot, so what follows is paced behind it
 *              (whatsapp.paced outcome 'unpaced'). For a send that IS the
 *              deliverable: skipping it would lose the thing the user asked for.
 *
 * A budgeted send is never retried: the shortest backoff (~6 s) alone would
 * blow the budget. A 131056 still pushes the phone back, so the content that
 * follows the response backs off.
 */
const SYNC_BUDGET_WAIT_MS = 1500;
const SYNC_BUDGET = Object.freeze({
  SKIP_IF_LATE: Object.freeze({ maxWaitMs: SYNC_BUDGET_WAIT_MS, ifLate: 'skip' }),
  SEND_IF_LATE: Object.freeze({ maxWaitMs: SYNC_BUDGET_WAIT_MS, ifLate: 'send' }),
});

/** A caller's budget, normalised; null when the send is not budgeted. */
function budgetOf(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const maxWaitMs = Number(raw.maxWaitMs);
  if (!Number.isFinite(maxWaitMs) || maxWaitMs < 0) return null;
  return { maxWaitMs, ifLate: raw.ifLate === 'send' ? 'send' : 'skip' };
}

/**
 * Pace, send, and retry a rate-limit refusal.
 *
 * `attempt()` performs ONE POST and resolves `{ value, code }` — `code` is the
 * Meta error code when Meta refused, else null — or `{ error, code }` for a
 * transport that throws. It may also reject (network error): that is passed
 * through untouched and never retried.
 *
 * Resolves `{ value }` / rejects with the transport's own error, exactly as
 * the un-paced call would have; or `{ local: 'skipped' | 'shed' }` when the send
 * was never attempted.
 *
 * @param {{to?: string, kind?: string, bestEffort?: boolean, site?: Error,
 *          budget?: {maxWaitMs: number, ifLate: 'skip'|'send'}}} meta
 * @param {() => Promise<{value?: *, error?: Error, code: number|null}>} attempt
 */
async function send(meta, attempt) {
  const cfg = config();
  const m = { ...meta, kind: meta.kind || 'unknown' };
  const budget = m.bestEffort ? null : budgetOf(m.budget);

  let mode = 'wait';
  let slotCfg = cfg;
  if (m.bestEffort) mode = 'try';
  else if (budget) {
    mode = budget.ifLate === 'send' ? 'force_if_late' : 'wait';
    slotCfg = { ...cfg, maxWaitMs: Math.min(cfg.maxWaitMs, budget.maxWaitMs) };
  }

  const slot = await reserve(m.to, mode, slotCfg);
  if (slot && !slot.granted) {
    if (m.bestEffort) {
      emit('info', 'whatsapp.paced', m, { outcome: LOCAL.SKIPPED, delayMs: slot.delayMs });
      return { local: LOCAL.SKIPPED };
    }
    if (budget) {
      // 'skip': the ack is not sent, and it took no slot.
      emit('info', 'whatsapp.paced', m, {
        outcome: LOCAL.SKIPPED, reason: 'sync_budget', delayMs: slot.delayMs, budgetMs: budget.maxWaitMs,
      });
      return { local: LOCAL.SKIPPED };
    }
    emit('error', 'whatsapp.rate_limited', m, {
      code: 'local_max_wait', outcome: LOCAL.SHED, attempt: 0, delayMs: slot.delayMs, gaveUp: true,
    });
    return { local: LOCAL.SHED };
  }
  if (slot && slot.late) {
    // 'send': out now, unpaced; the slot it took paces whatever follows.
    emit('info', 'whatsapp.paced', m, {
      outcome: 'unpaced', reason: 'sync_budget', delayMs: slot.delayMs, budgetMs: budget.maxWaitMs,
    });
  } else if (slot && slot.delayMs > 0) {
    if (slot.delayMs >= PACED_LOG_THRESHOLD_MS) {
      emit('info', 'whatsapp.paced', m, { outcome: 'waited', delayMs: slot.delayMs });
    }
    await sleep(slot.delayMs);
  }

  for (let n = 1; ; n += 1) {
    // eslint-disable-next-line no-await-in-loop
    const out = await attempt();
    const code = out && out.code;
    const settle = () => {
      if (out && out.error) throw out.error;
      return { value: out && out.value };
    };
    if (!RETRYABLE_CODES.has(code)) return settle();
    if (m.bestEffort) {
      // A reaction Meta refused is not worth a retry — nor an error-level line.
      emit('warn', 'whatsapp.rate_limited', m, { code, attempt: n, delayMs: 0, gaveUp: true, bestEffort: true });
      return settle();
    }
    if (budget) {
      // No retry inside a response's budget. Push the phone back so the content
      // that follows the response backs off; a lost deliverable is an error, a
      // lost ack only a warning.
      if (code === PAIR_LIMIT) {
        // eslint-disable-next-line no-await-in-loop
        await reserve(m.to, 'penalize', cfg, backoffMs(1, cfg));
      }
      emit(budget.ifLate === 'send' ? 'error' : 'warn', 'whatsapp.rate_limited', m, {
        code, attempt: n, delayMs: 0, gaveUp: true, reason: 'sync_budget',
      });
      return settle();
    }
    if (n >= cfg.maxAttempts) {
      emit('error', 'whatsapp.rate_limited', m, { code, attempt: n, delayMs: 0, gaveUp: true });
      return settle();
    }

    let delayMs = backoffMs(n, cfg);
    if (code === PAIR_LIMIT) {
      // Push the PHONE back, not just this send: every other sender to it now
      // waits too, and it comes back at the sustained rate with no burst. The
      // retry then takes the next slot like any other send.
      // eslint-disable-next-line no-await-in-loop
      await reserve(m.to, 'penalize', cfg, delayMs);
      // eslint-disable-next-line no-await-in-loop
      const again = await reserve(m.to, 'wait', cfg);
      if (again && !again.granted) {
        emit('error', 'whatsapp.rate_limited', m, {
          code, attempt: n, delayMs: again.delayMs, gaveUp: true, outcome: LOCAL.SHED,
        });
        return settle();
      }
      if (again) delayMs = again.delayMs;
    }
    emit('warn', 'whatsapp.rate_limited', m, { code, attempt: n, delayMs });
    // eslint-disable-next-line no-await-in-loop
    await sleep(delayMs);
  }
}

/** Meta's error code from a parsed fetch response body. */
function metaCodeOfBody(data) {
  const code = data && data.error && data.error.code;
  return Number.isFinite(Number(code)) ? Number(code) : null;
}

module.exports = {
  // whatsapp.service.js's paced transports
  send,
  // callers whose HTTP response waits on a send (Flow endpoints, the portal)
  SYNC_BUDGET,
  isMessagesUrl,
  kindOf,
  metaCodeOfBody,
  metaErrorCodeOf,
  // the real-Redis contract test (tests/whatsapp/send-pacing.redis.test.js)
  RESERVE_LUA,
  pairKey,
  reserve,
  config,
};
