'use strict';
/**
 * inbound-typing — the "typing…" indicator for ONE inbound message, shown only while a reply that
 * is a MESSAGE is genuinely on its way (bd-0wrn4).
 *
 * WHY. The webhook sent the typing indicator on every inbound message, right after the 👍 receipt
 * and before any handler ran. WhatsApp clears "typing…" when we send a message, or after ~25 s;
 * there is no "stop typing" call. Since the Meta bill cut (1 Oct 2026) many taps are answered by a
 * free reaction alone — a survey 👍, "Taught it today", "Yes, I'll try!", "Not now", "Send now" 📨,
 * "Add another" 📸, a child's repeat voice note — or by nothing at all (a duplicate tap, a sticker,
 * a closed Flow, a 👎 reason). On every one of those "typing…" sat in the chat header for ~25 s and
 * vanished with nothing arriving: the bot looked about to say something and never did.
 *
 * WHAT. One scope per inbound message, opened by the webhook where it used to send the indicator:
 *   - the READ RECEIPT goes at once (the typing call used to carry it, so the blue ticks are kept);
 *   - "typing…" is DEFERRED by DEFER_MS and sent only if, by then, none of these has happened:
 *       · a message to this person went out  → the reply is on screen (typing after it would be wrong);
 *       · a reaction to this person went out → the reaction IS the reply;
 *       · the webhook's dispatch finished    → nothing more is coming from this request.
 *     A slow reply still gets "typing…", DEFER_MS after the point it used to appear.
 * Only sends made INSIDE the request count, and only to the same number (AsyncLocalStorage, the
 * pattern of runWithCorrelation / actor-context) — a coach's report going to the teacher does not
 * answer the coach.
 *
 * DEFER_MS = 2000, by evidence. niete-logs, production, 7 days to 1 Oct 2026, 14,226 taps on the
 * paths that are now reaction-only (survey 👍/👎, "Taught it today"/planned/not yet, photo Yes/Add
 * another, coaching Yes-analyze, Send now, quiz/LP "No thanks"): measured from where typing used to
 * be shown (right after the 👍), the handler reached its acknowledgement in p50 1.19 s, p90 1.51 s,
 * p95 1.73 s, p99 2.95 s — 95.7% within 2.0 s (88.9% within 1.5 s). Photo receipts: 98% within 2 s.
 * The 0.8–1.5 s first proposed would still have shown "typing…" on one tap in nine.
 * INBOUND_TYPING_DEFER_MS overrides it; 0 restores the old behaviour exactly (typing at once).
 *
 * WHAT A HANDLER AUTHOR NEEDS TO KNOW
 *   - Explicit WhatsAppService.showTypingIndicator() is never deferred. A handler that reacts and
 *     THEN works for seconds before a message ("📝 reaction + typing") calls it on purpose.
 *   - startContinuousTypingIndicator(from, message.id) inside the request waits for the same
 *     deadline (its 20 s refresh is unchanged), so the text / voice / image handlers inherit this.
 *   - hold(): a handler that cannot yet tell whether it will answer silently (a 👎 reason window
 *     is open) keeps "typing…" back until release().
 *   - handOff(): work that continues AFTER the dispatch returns (setImmediate) and will answer with
 *     a message keeps the scope open past the dispatch's end.
 *   - answerLater(): the answer comes from ANOTHER PROCESS (an SQS job), so no send this scope can
 *     see will ever settle it. "typing…" goes up at once — awaited, so it reaches WhatsApp before
 *     the caller queues the job that answers (it can never land after that answer) — and the
 *     dispatch's end does not cancel it. Meta bill cut FX1 (bd-w2daa.22): the LP-pick outcome
 *     that now rides on the analysis job's Step 2/5.
 *   - nothingComing(): the handler now KNOWS this turn sends nothing more — settle at once, so
 *     "typing…" never goes up however long the handler still runs. { answeredElsewhere: true } when
 *     another request's message answers this one (a photo absorbed into its burst's one prompt).
 *     Too late (typing already shown) is logged honestly: silentAfterTyping.
 *   - expectSilence(to, untilMs): this person's turns may end in silence until untilMs (the
 *     app-redirect quiet hour). At the deadline their "typing…" is HELD until a door decides —
 *     nothingComing() → never shown; replyComing() → shown at once; a message → that message,
 *     no typing first — or QUIET_HOLD_MS passes, and it is shown as before. Meta bill cut FX3
 *     (bd-w2daa.24): the text handler reaches its door ~2.7 s in (sandbox, 1 Oct 15:53:08Z), so a
 *     silent quiet-hour turn showed ~25 s of "typing…" over nothing. Per replica, in memory: a
 *     restart or another replica just means today's behaviour for that turn.
 *   - doorDeciding(): a quiet-hour door has started deciding (the text handler's intent classifier)
 *     and WILL call replyComing() or nothingComing(). The hold then lasts until it does, not
 *     QUIET_HOLD_MS — backstop: WhatsApp's own typing lifetime. Meta bill cut FX4 (bd-w2daa.26):
 *     a free-text lesson-plan request in the quiet hour was classified 12.6 s in (sandbox,
 *     1 Oct 18:39:00Z), far past FX3's 3 s, so "typing…" showed and lingered over silence.
 *   - showNow(): this tap's door is one whose answer comes from ANOTHER PROCESS (an LP outcome
 *     deferred onto the analysis job), but it reaches answerLater() only after seconds of lookups
 *     — on sandbox the recent-LP "Yes" got there 2.24 s in (1 Oct 18:23:20.567Z → 22.811Z), so the
 *     2 s deadline had already shown "typing…". The webhook calls this the moment it knows the door,
 *     so "typing…" goes up at once; answerLater() then hands that same indicator to the job.
 *   - A tap whose WHOLE answer is a reaction is listed in reaction-only-taps.js. The webhook settles
 *     it (nothingComing) as soon as it reads the tap id, before any handler runs. Do not rely on the
 *     reaction landing inside the deadline: a slow write made it miss (FX7, bd-w2daa.31, TRIAGE #46).
 *     A tap that only SOMETIMES messages stays out and calls nothingComing() at its own branch point,
 *     before its slow work.
 */
const { AsyncLocalStorage } = require('async_hooks');
const { logToFile } = require('../utils/logger');

const DEFAULT_DEFER_MS = 2000;
const TYPING_LIFETIME_MS = 25000;   // WhatsApp drops "typing…" on its own after ~25 s
const storage = new AsyncLocalStorage();

/**
 * How long past the deadline a quiet-hour turn holds "typing…" for its door to decide. Sandbox,
 * 1 Oct 15:53:08Z: the decision came 0.7 s after the 2 s deadline; 3 s covers that with margin.
 * INBOUND_TYPING_QUIET_HOLD_MS overrides; 0 disables the hold.
 */
const DEFAULT_QUIET_HOLD_MS = 3000;
const MAX_QUIET_ENTRIES = 5000;
const quietUntil = new Map();   // digits → epoch ms the expected silence ends

function quietHoldMs() {
  const n = Number(process.env.INBOUND_TYPING_QUIET_HOLD_MS);
  return process.env.INBOUND_TYPING_QUIET_HOLD_MS !== undefined && Number.isFinite(n) && n >= 0 ? n : DEFAULT_QUIET_HOLD_MS;
}

function quietFor(digits) {
  const until = quietUntil.get(digits);
  if (!until) return false;
  if (until <= Date.now()) { quietUntil.delete(digits); return false; }
  return true;
}

function deferMs() {
  const raw = process.env.INBOUND_TYPING_DEFER_MS;
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_DEFER_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DEFER_MS;
}

const digitsOf = (phone) => String(phone || '').replace(/\D/g, '');

class Scope {
  constructor(to, messageId, delay, sender) {
    this.sender = sender;     // the WhatsApp service (injected: it requires this module)
    this.to = to;
    this.digits = digitsOf(to);
    this.messageId = messageId;
    this.deferMs = delay;
    this.openedAt = Date.now();
    this.state = 'pending';   // pending → shown | settled
    this.answeredBy = null;   // 'message' | 'reaction' | 'dispatch_end'
    this.firstReply = null;   // first outbound to this person: 'message' | 'reaction'
    this.messageAfterTyping = false;
    this.holds = 0;
    this.due = false;
    this.handedOff = false;
    this.answeredElsewhere = false;   // answerLater(): the reply is another process's send
    this.timer = null;
    this.reported = false;
    this.quietChecked = false;   // expectSilence() consulted (or overruled by replyComing())
    this.quietHeld = false;      // typing held at the deadline for a door's decision
    this.quietTimer = null;
    this.quietHeldEver = false;
    this.doorDeciding = false;   // doorDeciding(): a quiet-hour door will settle this turn itself
    this.silentReason = null;    // nothingComing() — why this turn ends silent
    this.silentAfterTyping = false;
  }

  arm() {
    this.timer = setTimeout(() => this.deadline(), this.deferMs);
    if (this.timer && typeof this.timer.unref === 'function') this.timer.unref();
  }

  deadline() {
    this.timer = null;
    if (this.state !== 'pending') return;
    if (this.holds > 0) { this.due = true; return; }
    if (!this.quietChecked) {
      this.quietChecked = true;
      const bound = this.quietBound();
      if (quietHoldMs() > 0 && quietFor(this.digits)) {
        this.due = true;
        this.quietHeld = true;
        this.quietHeldEver = true;
        this.quietTimer = setTimeout(() => this.quietExpired(), bound);
        if (this.quietTimer && typeof this.quietTimer.unref === 'function') this.quietTimer.unref();
        return;
      }
    }
    this.show();
  }

    /** The hold's bound: a door that is deciding gets until WhatsApp would drop typing anyway. */
  quietBound() {
    return this.doorDeciding ? TYPING_LIFETIME_MS : quietHoldMs();
  }

  /** No door decided within the bound — show "typing…", as without the hold. */
  quietExpired() {
    this.quietTimer = null;
    if (this.state !== 'pending' || !this.quietHeld) return;
    this.quietHeld = false;
    if (this.holds === 0 && this.due) { this.due = false; this.show(); }
  }

  clearQuiet() {
    this.quietHeld = false;
    if (this.quietTimer) { clearTimeout(this.quietTimer); this.quietTimer = null; }
  }

  /** nothingComing(): this turn sends nothing more. */
  silent(reason, answeredElsewhere) {
    if (!this.silentReason) this.silentReason = reason || 'unspecified';
    if (this.state === 'pending') {
      this.holds = 0;
      this.due = false;
      this.settle('nothing');
      return;
    }
    if (this.state === 'shown') {
      if (answeredElsewhere) this.answeredElsewhere = true;
      else if (!this.messageAfterTyping) this.silentAfterTyping = true;
    }
  }

  show() {
    if (this.state !== 'pending') return Promise.resolve();
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.clearQuiet();
    this.state = 'shown';
    this.shownAfterMs = Date.now() - this.openedAt;
    let sent = Promise.resolve();
    try {
      sent = Promise.resolve(this.sender.showTypingIndicator(this.to, this.messageId)).catch(() => {});
    } catch (_) { /* typing is a courtesy; never break the request over it */ }
    if (this.handedOff) {
      // The dispatch already ended; report once the reply lands, or when "typing…" has expired.
      const t = setTimeout(() => this.report(), TYPING_LIFETIME_MS);
      if (t && typeof t.unref === 'function') t.unref();
    }
    return sent;
  }

  settle(by) {
    if (this.state !== 'pending') return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.clearQuiet();
    this.state = 'settled';
    this.answeredBy = by;
    this.settledAfterMs = Date.now() - this.openedAt;
  }

  noteReply(kind) {
    if (!this.firstReply) this.firstReply = kind;
    if (kind === 'message' && this.state === 'shown') this.messageAfterTyping = true;
    this.settle(kind);
    if (this.handedOff && (kind === 'message' || this.state === 'settled')) this.report();
  }

  /**
   * One line per inbound message. `lingered` is the bug this module exists for: typing went up and
   * no message followed it inside the request — Axiom counts it (msg == "inbound_typing.done").
   */
  report() {
    if (this.reported) return;
    this.reported = true;
    logToFile('inbound_typing.done', {
      typing: this.state === 'shown' ? 'shown' : 'skipped',
      answeredBy: this.answeredBy,
      firstReply: this.firstReply || 'none',
      // A reply from another process is invisible here, so it cannot count as lingering.
      lingered: this.state === 'shown' && !this.messageAfterTyping && !this.answeredElsewhere,
      answeredElsewhere: this.answeredElsewhere,
      silentReason: this.silentReason,
      silentAfterTyping: this.silentAfterTyping,
      quietHeld: this.quietHeldEver,
      deferMs: this.deferMs,
      shownAfterMs: this.shownAfterMs ?? null,
      settledAfterMs: this.settledAfterMs ?? null,
      handedOff: this.handedOff,
    });
  }
}

/**
 * Run one webhook request inside a typing context. The scope itself is opened later, by open(),
 * at the point the webhook used to send the indicator — so the webhook's own 👍 is not a "reply".
 */
function withRequest(fn) {
  return storage.run({ scope: null }, fn);
}

function current() {
  const store = storage.getStore();
  return (store && store.scope) || null;
}

/**
 * Open the scope for the inbound message being handled: read receipt now, "typing…" at the deadline
 * unless answered first. Outside withRequest() (no context to watch the replies) it falls back to
 * the old behaviour: typing at once.
 *
 * @param {string} to - the sender's number
 * @param {string} messageId - their inbound wamid
 * @param {{showTypingIndicator: Function, markAsRead?: Function}} WhatsAppService - passed in, not
 *   required here: whatsapp.service requires this module, and a require cycle is a cold-start trap.
 */
function open(to, messageId, WhatsAppService) {
  const store = storage.getStore();
  const delay = deferMs();
  if (!WhatsAppService || typeof WhatsAppService.showTypingIndicator !== 'function') return null;
  if (!store || delay <= 0 || !messageId) {
    try {
      Promise.resolve(WhatsAppService.showTypingIndicator(to, messageId)).catch(() => {});
    } catch (_) { /* best-effort */ }
    return null;
  }
  const scope = new Scope(to, messageId, delay, WhatsAppService);
  store.scope = scope;
  try {
    if (typeof WhatsAppService.markAsRead === 'function') {
      Promise.resolve(WhatsAppService.markAsRead(messageId)).catch(() => {});
    }
  } catch (_) { /* best-effort */ }
  scope.arm();
  return scope;
}

/**
 * Called by the WhatsApp service's transports for every Cloud API /messages POST. A message or a
 * reaction to the person whose message is being handled answers it. Status posts (read receipt,
 * typing) carry no `to` and are ignored. Never throws.
 */
function noteOutbound(payload) {
  try {
    const scope = current();
    if (!scope || !payload || typeof payload !== 'object' || !payload.to) return;
    if (digitsOf(payload.to) !== scope.digits) return;
    scope.noteReply(payload.type === 'reaction' ? 'reaction' : 'message');
  } catch (_) { /* never break a send */ }
}

/**
 * startContinuousTypingIndicator asks this before its first beat. True = the scope owns that beat
 * (it is still waiting on its deadline for this same message), so the caller must not show it now.
 */
function claimFirstBeat(to, messageId) {
  const scope = current();
  return Boolean(
    scope && scope.state === 'pending' && messageId && scope.messageId === messageId
    && digitsOf(to) === scope.digits,
  );
}

/**
 * Keep "typing…" back while the handler cannot yet tell whether it will answer silently. Returns an
 * idempotent release(showIfDue = true): when the handler now knows a reply is coming, release() and
 * typing shows at once if the deadline passed while held. On the way out of a SILENT answer, call
 * release(false) — or nothing: endDispatch() settles a held scope without typing.
 */
function hold() {
  const scope = current();
  if (!scope || scope.state !== 'pending') return () => {};
  scope.holds += 1;
  let released = false;
  return (showIfDue = true) => {
    if (released) return;
    released = true;
    scope.holds = Math.max(0, scope.holds - 1);
    if (showIfDue && scope.holds === 0 && scope.due && !scope.quietHeld) { scope.due = false; scope.show(); }
  };
}

/** True while this request's scope is still waiting (nothing answered, no typing shown yet). */
function isPending() {
  const scope = current();
  return Boolean(scope && scope.state === 'pending');
}

/** Work continues after the dispatch returns and will answer with a message: keep the scope open. */
function handOff() {
  const scope = current();
  if (scope && scope.state === 'pending') scope.handedOff = true;
}

/**
 * This tap's answer comes from another process and the handler will say so (answerLater()) — but
 * only after its lookups. Put "typing…" up NOW for a still-pending scope. Never throws.
 */
function showNow() {
  try {
    const scope = current();
    if (scope && scope.state === 'pending') scope.show();
  } catch (_) { /* typing is a courtesy */ }
}

/**
 * A quiet-hour door has started deciding and will call replyComing() or nothingComing(): hold
 * "typing…" until it does (backstop TYPING_LIFETIME_MS), not just QUIET_HOLD_MS. Only changes a
 * scope this person's quiet hour applies to. Logs inbound_typing.door_deciding (where, scope state,
 * ms since the inbound, quietHeld) when the scope is in a quiet hour or there is no scope. Never throws.
 *
 * @param {string} [where] - which door (log only): 'text_handler' | 'intent'
 */
function doorDeciding(where = 'unspecified') {
  try {
    const scope = current();
    // FX6 (bd-w2daa.28): one line per call, so a run can tell "too late" from "no scope" (Rule 12).
    if (scope && quietFor(scope.digits)) {
      logToFile('inbound_typing.door_deciding', {
        where,
        scope: scope.state,
        msSinceInbound: Date.now() - scope.openedAt,
        quietHeld: scope.quietHeld,
      });
    } else if (!scope) {
      logToFile('inbound_typing.door_deciding', { where, scope: 'none' });
    }
    if (!scope || scope.state !== 'pending') return;
    scope.doorDeciding = true;
    if (scope.quietHeld && scope.quietTimer) {
      // Already held at the deadline: stretch the bound from the moment the hold began.
      clearTimeout(scope.quietTimer);
      scope.quietTimer = setTimeout(() => scope.quietExpired(), TYPING_LIFETIME_MS);
      if (scope.quietTimer && typeof scope.quietTimer.unref === 'function') scope.quietTimer.unref();
    }
  } catch (_) { /* typing is a courtesy */ }
}

/** Upper bound on waiting for the typing POST before the caller queues its job. */
const ANSWER_LATER_WAIT_MS = 3000;

/**
 * The reply to this inbound message will come from another process (an SQS job queued next).
 * Shows "typing…" now and keeps it past the dispatch's end. Await it BEFORE queueing the job, so
 * the indicator cannot reach WhatsApp after the job's own message (typing then would hang ~25 s
 * over an answer already on screen). "typing…" already up for this message (showNow(), or the
 * deadline beat the handler to it) and no message since → that indicator is handed to the job as
 * it is (FX4: it used to be reported as lingering, and the deferral logged typing:false). No-op
 * when the request was already answered, or outside a webhook request (a portal call, a worker).
 * Never throws.
 *
 * @returns {Promise<boolean>} true when "typing…" is up and handed to the job
 */
async function answerLater() {
  try {
    const scope = current();
    if (scope && scope.state === 'shown' && !scope.messageAfterTyping) {
      scope.handedOff = true;
      scope.answeredElsewhere = true;
      return true;
    }
    if (!scope || scope.state !== 'pending') return false;
    scope.handedOff = true;
    scope.answeredElsewhere = true;
    const sent = scope.show();
    let timer;
    await Promise.race([
      sent,
      new Promise((resolve) => { timer = setTimeout(resolve, ANSWER_LATER_WAIT_MS); }),
    ]);
    clearTimeout(timer);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * This turn sends nothing more (a quiet-hour redirect, a photo absorbed into its burst). Settles a
 * pending scope so "typing…" never goes up. Never throws; a no-op outside a webhook request.
 *
 * @param {{reason?: string, answeredElsewhere?: boolean}} [opts] - answeredElsewhere: another
 *   request's message answers this turn (and clears the chat's "typing…" when it lands)
 */
function nothingComing({ reason, answeredElsewhere = false } = {}) {
  try {
    const scope = current();
    if (scope) scope.silent(reason, answeredElsewhere);
  } catch (_) { /* typing is a courtesy */ }
}

/**
 * A door that might have answered silently has decided it will NOT: a held quiet-hour "typing…"
 * shows now (or at the deadline if that has not come yet). Never throws.
 */
function replyComing() {
  try {
    const scope = current();
    if (!scope || scope.state !== 'pending') return;
    scope.quietChecked = true;
    if (scope.quietHeld) {
      scope.clearQuiet();
      if (scope.holds === 0 && scope.due) { scope.due = false; scope.show(); }
    }
  } catch (_) { /* typing is a courtesy */ }
}

/**
 * This person's turns may end silent until untilMs (the app-redirect quiet hour): hold their
 * "typing…" at the deadline for a door's decision. Never throws.
 */
function expectSilence(to, untilMs) {
  try {
    const digits = digitsOf(to);
    const until = Number(untilMs);
    if (!digits || !Number.isFinite(until)) return;
    if (until <= Date.now()) { quietUntil.delete(digits); return; }
    if (quietUntil.size >= MAX_QUIET_ENTRIES && !quietUntil.has(digits)) {
      const now = Date.now();
      for (const [d, u] of quietUntil) if (u <= now) quietUntil.delete(d);
      if (quietUntil.size >= MAX_QUIET_ENTRIES) quietUntil.delete(quietUntil.keys().next().value);
    }
    quietUntil.set(digits, until);
  } catch (_) { /* best-effort */ }
}

/** Milliseconds since this request's scope opened (just after the 👍), or null outside one. */
function msSinceInbound() {
  const scope = current();
  return scope ? Date.now() - scope.openedAt : null;
}

/** The webhook's dispatch is over. Unless handed off, nothing else will answer — no typing. */
function endDispatch() {
  const scope = current();
  if (!scope) return;
  if (scope.handedOff && scope.state === 'pending') return;   // reported on show/settle
  scope.settle('dispatch_end');
  scope.report();
}

module.exports = {
  withRequest, open, noteOutbound, claimFirstBeat, hold, isPending, handOff, answerLater, endDispatch,
  nothingComing, replyComing, expectSilence, showNow, doorDeciding, msSinceInbound,
  DEFAULT_QUIET_HOLD_MS, TYPING_LIFETIME_MS,
};
