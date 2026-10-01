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
 */
const { AsyncLocalStorage } = require('async_hooks');
const { logToFile } = require('../utils/logger');

const DEFAULT_DEFER_MS = 2000;
const TYPING_LIFETIME_MS = 25000;   // WhatsApp drops "typing…" on its own after ~25 s
const storage = new AsyncLocalStorage();

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
  }

  arm() {
    this.timer = setTimeout(() => this.deadline(), this.deferMs);
    if (this.timer && typeof this.timer.unref === 'function') this.timer.unref();
  }

  deadline() {
    this.timer = null;
    if (this.state !== 'pending') return;
    if (this.holds > 0) { this.due = true; return; }
    this.show();
  }

  show() {
    if (this.state !== 'pending') return Promise.resolve();
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
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
    if (showIfDue && scope.holds === 0 && scope.due) { scope.due = false; scope.show(); }
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

/** Upper bound on waiting for the typing POST before the caller queues its job. */
const ANSWER_LATER_WAIT_MS = 3000;

/**
 * The reply to this inbound message will come from another process (an SQS job queued next).
 * Shows "typing…" now and keeps it past the dispatch's end. Await it BEFORE queueing the job, so
 * the indicator cannot reach WhatsApp after the job's own message (typing then would hang ~25 s
 * over an answer already on screen). No-op when there is no pending scope — typing already showing,
 * or the request already answered — or outside a webhook request (a portal call, a worker).
 * Never throws.
 *
 * @returns {Promise<boolean>} true when this call put "typing…" up
 */
async function answerLater() {
  try {
    const scope = current();
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
};
