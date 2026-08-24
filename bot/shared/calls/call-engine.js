'use strict';
/**
 * The live-call engine: session registry + lifecycle state machine (bd-1hae7.1,
 * .3, .4, .16).
 *
 * Everything that touches a native module or the network is injected — sessions
 * (wrtc + Realtime), the Graph calls API, the admission gate, the busy-text
 * hook. So the entire lifecycle, including every failure branch, is exercised
 * with fakes in unit tests: no wrtc load, no sockets, no Graph.
 *
 * The invariants it exists to hold:
 *   - A concurrency slot is NEVER leaked. Every failure path closes the session
 *     and deletes it from the registry; sessions that die on their own (media
 *     drop, watchdog, ICE failure) remove themselves via onClose.
 *   - The admission gate fails CLOSED. If the budget ledger is unreachable we
 *     decline the call rather than take an ungoverned one.
 *   - A deploy does not cut live calls dead — drain() stops admitting, waits out
 *     the calls in flight, and only then lets the process exit.
 */

const DEFAULT_MAX_CONCURRENT = 5;
const DEFAULT_DRAIN_GRACE_MS = 60000;

class CallEngine {
  /**
   * @param {object}   deps
   * @param {Function} deps.createSession  ({callId, from, callerName}) => session
   * @param {object}   deps.callsApi       { preAccept, accept, reject, terminate }
   * @param {Function} [deps.gate]         async ({from, callId}) => {allowed, reason}
   * @param {Function} [deps.onBusy]       async ({from, callId, reason}) => void
   * @param {Function} [deps.onCallEnd]    async ({waCallId, ...}) => void
   * @param {object}   [deps.logger]
   * @param {object}   [deps.config]       { maxConcurrent, drainGraceMs }
   */
  constructor({ createSession, callsApi, gate, onBusy, onCallEnd, logger, config = {} }) {
    this.createSession = createSession;
    this.callsApi = callsApi;
    this.gate = gate;
    this.onBusy = onBusy;
    this.onCallEnd = onCallEnd;
    this.log = logger || { info: () => {}, warn: () => {}, error: () => {} };
    this.maxConcurrent = config.maxConcurrent || DEFAULT_MAX_CONCURRENT;
    this.drainGraceMs = config.drainGraceMs === undefined ? DEFAULT_DRAIN_GRACE_MS : config.drainGraceMs;

    this._sessions = new Map();   // wa_call_id → session
    // Calls already reported through onCallEnd. A call that fails at setup is
    // closed immediately; a stray terminate for it must not close it twice.
    this._ended = new Set();
    this._draining = false;
    this._drainWaiters = [];
  }

  get activeCount() {
    return this._sessions.size;
  }

  get isDraining() {
    return this._draining;
  }

  /**
   * Handle one WhatsApp `calls` webhook event.
   * @returns {Promise<{action:'accepted'|'rejected'|'failed'|'terminated'|'ignored', reason?:string}>}
   */
  async handleEvent(call, meta = {}) {
    if (!call || !call.id) return { action: 'ignored', reason: 'no_call_id' };

    switch (call.event) {
      case 'connect':
        return this._onConnect(call, meta);
      case 'terminate':
        return this._onTerminate(call);
      default:
        this.log.info('[calls] lifecycle event', { callId: call.id, event: call.event, status: call.status });
        return { action: 'ignored', reason: 'unhandled_event' };
    }
  }

  async _onConnect(call, meta) {
    const callId = call.id;
    const from = call.from || 'unknown';

    const offer = call.session && call.session.sdp;
    if (!offer) {
      this.log.warn('[calls] connect with no SDP offer — ignoring', { callId });
      return { action: 'ignored', reason: 'no_sdp' };
    }

    // A retried webhook must not open a second session on one call.
    if (this._sessions.has(callId)) {
      this.log.warn('[calls] duplicate connect for a live call — ignoring', { callId });
      return { action: 'ignored', reason: 'duplicate' };
    }

    if (this._draining) {
      await this._decline(callId, from, 'draining');
      return { action: 'rejected', reason: 'draining' };
    }

    // Admission gate: budget, per-caller cap, anything else that says no.
    // Fails CLOSED — an unreachable ledger means we decline, never that we take
    // an ungoverned call.
    if (this.gate) {
      let verdict;
      try {
        verdict = await this.gate({ from, callId });
      } catch (err) {
        this.log.error('[calls] admission gate threw — declining (fail closed)', { callId, error: err.message });
        await this._decline(callId, from, 'gate_error');
        return { action: 'rejected', reason: 'gate_error' };
      }
      if (!verdict || !verdict.allowed) {
        const reason = (verdict && verdict.reason) || 'not_allowed';
        this.log.info('[calls] declined by gate', { callId, from, reason });
        await this._decline(callId, from, reason);
        return { action: 'rejected', reason };
      }
    }

    if (this._sessions.size >= this.maxConcurrent) {
      this.log.info('[calls] all lines busy — declining', { callId, from, active: this._sessions.size });
      await this._decline(callId, from, 'busy');
      return { action: 'rejected', reason: 'busy' };
    }

    const session = this.createSession({ callId, from, callerName: meta.callerName || call.caller_name });
    // Self-removal covers every death the webhook never tells us about: media
    // drop, ICE failure, silence watchdog, max-duration.
    session.onClose = () => { this._sessions.delete(callId); this._notifyDrain(); };
    this._sessions.set(callId, session);

    const startedAt = Date.now();
    try {
      const sdpAnswer = await session.createAnswer(offer);

      // pre_accept warms the media path so audio flows the instant we accept —
      // an optimisation, so its failure is logged and stepped over.
      try {
        await this.callsApi.preAccept(callId, sdpAnswer);
      } catch (err) {
        this.log.warn('[calls] pre_accept failed (continuing to accept)', { callId, error: err.message });
      }

      await this.callsApi.accept(callId, sdpAnswer);
      this.log.info('[calls] accepted', { callId, from, setupMs: Date.now() - startedAt });
      return { action: 'accepted' };
    } catch (err) {
      this.log.error('[calls] failed to accept — freeing the line', { callId, error: err.message });
      try { session.close(); } catch (_) { /* best effort */ }
      this._sessions.delete(callId);
      this._notifyDrain();
      try { await this.callsApi.terminate(callId); } catch (_) { /* the call may already be gone */ }

      // Close the audit row. Meta never connected this call, so no `terminate`
      // webhook is coming — without this the row sits at 'in_progress' forever
      // and the cost ledger never counts it.
      this._ended.add(callId);
      if (this.onCallEnd) {
        try {
          await this.onCallEnd({
            waCallId: callId,
            from,
            endedAt: new Date(),
            durationSeconds: Math.round((Date.now() - startedAt) / 1000),
            status: 'failed',
            transcript: undefined,
          });
        } catch (hookErr) {
          this.log.warn('[calls] end hook failed on the failure path', { callId, error: hookErr.message });
        }
      }
      return { action: 'failed', reason: err.message };
    }
  }

  async _onTerminate(call) {
    const callId = call.id;
    const session = this._sessions.get(callId);

    // Read the transcript BEFORE closing — teardown clears session state.
    const transcript = session && session.getTranscript ? session.getTranscript() : undefined;
    const from = (session && session.ctx && session.ctx.from) || call.from;

    if (session) {
      try { session.close(); } catch (_) { /* best effort */ }
    }
    this._sessions.delete(callId);
    this._notifyDrain();

    if (this.onCallEnd && !this._ended.has(callId)) {
      this._ended.add(callId);
      try {
        await this.onCallEnd({
          waCallId: callId,
          from,
          endedAt: new Date(),
          durationSeconds: call.duration,
          status: call.status,
          transcript,
        });
      } catch (err) {
        this.log.warn('[calls] end hook failed', { callId, error: err.message });
      }
    }

    this.log.info('[calls] terminated', { callId, status: call.status, duration: call.duration });
    return { action: 'terminated' };
  }

  /** Decline a call we are not taking, and tell the caller on WhatsApp why. */
  async _decline(callId, from, reason) {
    try {
      await this.callsApi.reject(callId);
    } catch (err) {
      this.log.warn('[calls] reject failed', { callId, error: err.message });
    }
    if (this.onBusy) {
      // The follow-up text is a courtesy — its failure must never change the
      // outcome of the decline.
      try {
        await this.onBusy({ from, callId, reason });
      } catch (err) {
        this.log.warn('[calls] overflow text failed', { callId, error: err.message });
      }
    }
  }

  /**
   * Stop admitting calls and wait for the ones in flight (SIGTERM). Resolves as
   * soon as the last call ends, or after the grace window — whichever comes
   * first — closing anything still up so the process can exit.
   */
  async drain() {
    this._draining = true;
    if (this._sessions.size === 0) return undefined;

    this.log.info('[calls] draining', { active: this._sessions.size, graceMs: this.drainGraceMs });
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._drainWaiters = this._drainWaiters.filter((w) => w !== waiter);
        resolve();
      }, this.drainGraceMs);
      const waiter = () => {
        if (this._sessions.size === 0) {
          clearTimeout(timer);
          this._drainWaiters = this._drainWaiters.filter((w) => w !== waiter);
          resolve();
        }
      };
      this._drainWaiters.push(waiter);
    });

    // Anything left after the grace window gets closed so we exit cleanly.
    for (const [callId, session] of this._sessions.entries()) {
      this.log.warn('[calls] drain grace expired — closing', { callId });
      try { session.close(); } catch (_) { /* best effort */ }
      this._sessions.delete(callId);
    }
    return undefined;
  }

  _notifyDrain() {
    for (const waiter of [...this._drainWaiters]) waiter();
  }
}

module.exports = CallEngine;
